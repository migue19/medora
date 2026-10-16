import {
  BadRequestException, Body, ConflictException, Controller, HttpCode, Inject, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { sha256 } from '../common/crypto';
import { assertOrigin, clientIp } from '../common/http';
import { tokenLimiter } from '../auth/limits';
import { Actor, AppointmentsService } from './appointments.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class TokenDto {
  @IsString() @Length(20, 200) token: string;
}

class CancelDto extends TokenDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reason?: string;
}

const INVALID = 'El enlace no es válido o ya venció. Para cambios, entra a tu portal o comunícate con la clínica.';

/**
 * Enlace del recordatorio: confirmar asistencia o cancelar sin iniciar sesión.
 * Consultar no gasta el enlace; confirmar o cancelar sí (un solo uso).
 */
@Controller('api/public/appointment-actions')
export class AppointmentActionsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
  ) {}

  @Post('inspect')
  @HttpCode(200)
  async inspect(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const { token, appointment: a } = await this.load(dto.token);
    const now = new Date();
    const current = a.status === 'BOOKED' && a.startsAt.getTime() === token.startsAt.getTime();
    const usable = current && !token.usedAt && a.startsAt > now;
    return {
      clinic: { name: a.clinic.name, phone: a.clinic.phone, address: a.clinic.address, timezone: a.clinic.timezone },
      doctor: { displayName: a.doctor.displayName, specialty: a.doctor.specialty },
      patientName: a.clinicPatient.name,
      serviceName: a.serviceName,
      startsAt: a.startsAt,
      status: a.status,
      confirmed: a.confirmedAt !== null,
      /** El horario cambió después de enviar este enlace. */
      outdated: a.status === 'BOOKED' && !current,
      used: token.usedAt !== null,
      canConfirm: usable && a.confirmedAt === null,
      canCancel: usable && a.startsAt.getTime() - now.getTime() >= a.clinic.patientCancelMinMinutes * 60_000,
      cancelMinMinutes: a.clinic.patientCancelMinMinutes,
    };
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const { appointment, actor, release } = await this.claim(dto.token);
    try {
      const updated = await this.appointments.confirm({ appointment, actor });
      return { status: updated.status, confirmed: updated.confirmedAt !== null };
    } catch (e) {
      await release();
      throw e;
    }
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(@Body() dto: CancelDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const { appointment, actor, clinic, release } = await this.claim(dto.token);
    try {
      const updated = await this.appointments.cancel({
        appointment, actor, reason: dto.reason || 'Cancelada por el paciente desde el recordatorio',
        minMinutesBefore: clinic.patientCancelMinMinutes,
      });
      return { status: updated.status };
    } catch (e) {
      await release();
      throw e;
    }
  }

  private async load(raw: string) {
    const token = await this.prisma.appointmentActionToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: {
        appointment: {
          include: {
            clinic: true,
            doctor: { select: { displayName: true, specialty: true } },
            clinicPatient: { select: { id: true, name: true, patientAccountId: true } },
          },
        },
      },
    });
    if (!token || token.expiresAt <= new Date()) throw new BadRequestException(INVALID);
    return { token, appointment: token.appointment };
  }

  /**
   * Gasta el enlace con una actualización condicional. Si la acción posterior falla (p. ej. fuera del
   * plazo de cancelación) el enlace se devuelve para que pueda intentarse otra vez.
   */
  private async claim(raw: string) {
    const { token, appointment: a } = await this.load(raw);
    if (a.status !== 'BOOKED') throw new ConflictException('La cita ya no está vigente');
    if (a.startsAt.getTime() !== token.startsAt.getTime()) {
      throw new ConflictException('La cita cambió de horario. Usa el enlace del recordatorio más reciente.');
    }
    const claimed = await this.prisma.appointmentActionToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BadRequestException('Este enlace ya se usó.');
    const actor: Actor = {
      kind: 'PATIENT', id: a.clinicPatient.patientAccountId ?? a.clinicPatient.id, name: a.clinicPatient.name,
    };
    const { clinic, doctor: _doctor, clinicPatient: _patient, ...appointment } = a;
    return {
      appointment, clinic, actor,
      release: () => this.prisma.appointmentActionToken.update({ where: { id: token.id }, data: { usedAt: null } }),
    };
  }
}
