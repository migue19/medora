import {
  Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { MAIL_TRANSPORT, MailTransport, OutgoingEmail } from '../mail/mail.transport';

/** Tiempo que un trabajador se reserva un trabajo; si muere, otro lo retoma al vencer. */
const LEASE_MS = 5 * 60_000;
const BATCH = 10;

export interface JobInput {
  type: 'email.send';
  payload: OutgoingEmail;
  /** Evita encolar dos veces el mismo efecto (p. ej. un evento de cita). */
  dedupeKey?: string;
  runAt?: Date;
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

/** Reintentos: 30 s, 1 min, 2 min… hasta 1 h. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempt - 1, 0), 60 * 60_000);
}

@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Cola');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
  ) {}

  /** Encola dentro de la transacción del cambio de negocio. Con dedupeKey repetida no hace nada. */
  async enqueue(tx: Tx | PrismaService, job: JobInput): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "Job" (id, type, payload, "dedupeKey", "runAt")
      VALUES (gen_random_uuid(), ${job.type}, ${JSON.stringify(job.payload)}::jsonb, ${job.dedupeKey ?? null},
              ${job.runAt ?? new Date()})
      ON CONFLICT ("dedupeKey") DO NOTHING`;
  }

  onApplicationBootstrap(): void {
    if (this.config.jobsPollMs <= 0) return;
    const tick = () => {
      if (this.stopped) return;
      this.runOnce()
        .catch((e) => this.logger.error(`Error del trabajador: ${errorText(e)}`))
        .finally(() => { if (!this.stopped) this.timer = setTimeout(tick, this.config.jobsPollMs); });
    };
    this.timer = setTimeout(tick, this.config.jobsPollMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** Procesa los trabajos vencidos. Devuelve cuántos procesó. Seguro con varios trabajadores. */
  runOnce(now = new Date()): Promise<number> {
    const run = (async () => {
      let total = 0;
      for (;;) {
        const jobs = await this.claim(now);
        if (jobs.length === 0) return total;
        for (const job of jobs) await this.execute(job);
        total += jobs.length;
      }
    })();
    this.running = run.finally(() => { if (this.running === run) this.running = null; });
    return run;
  }

  private claim(now: Date): Promise<ClaimedJob[]> {
    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET "lockedUntil" = ${new Date(now.getTime() + LEASE_MS)}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM "Job"
        WHERE "completedAt" IS NULL AND "failedAt" IS NULL AND "runAt" <= ${now}
          AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
        ORDER BY "runAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts, "maxAttempts"`;
  }

  private async execute(job: ClaimedJob): Promise<void> {
    try {
      await this.handle(job);
      // El cuerpo puede llevar tokens y datos de la cita: se conserva sólo el destinatario y el asunto.
      await this.prisma.$executeRaw`
        UPDATE "Job" SET "completedAt" = now(), "lockedUntil" = NULL, "lastError" = NULL,
          payload = jsonb_build_object('to', payload->'to', 'subject', payload->'subject')
        WHERE id = ${job.id}::uuid AND attempts = ${job.attempts}`;
    } catch (e) {
      const message = errorText(e).slice(0, 1000);
      const final = job.attempts >= job.maxAttempts;
      this.logger.warn(`Trabajo ${job.type} ${job.id} falló (intento ${job.attempts}): ${message}`);
      await this.prisma.$executeRaw`
        UPDATE "Job" SET "lockedUntil" = NULL, "lastError" = ${message},
          "runAt" = ${new Date(Date.now() + backoffMs(job.attempts))},
          "failedAt" = ${final ? new Date() : null}
        WHERE id = ${job.id}::uuid AND attempts = ${job.attempts}`;
    }
  }

  private async handle(job: ClaimedJob): Promise<void> {
    switch (job.type) {
      case 'email.send':
        await this.mail.send(job.payload as unknown as OutgoingEmail);
        return;
      default:
        throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
    }
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
