import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { VIDEO_PROVIDER, VideoProvider } from './video.provider';
import { readVideoLinkToken, videoLinkToken } from './link';
import { entitlements } from '../billing/plans';
import { PushService } from '../integrations/push.service';

/** La sala abre 15 min antes y cierra 30 min después del fin de la cita. */
export const OPENS_BEFORE_MINUTES = 15;
export const CLOSES_AFTER_MINUTES = 30;
/** El paciente «está en la sala» si dio señales de vida en este lapso. */
export const PRESENCE_SECONDS = 60;

export const CONSENT_VERSION = 'tele-2026-10';
export const CONSENT_TEXT = [
  'Acepto recibir atención médica a distancia por videollamada.',
  'Entiendo que el médico no puede explorarme físicamente y que, si lo considera necesario, me pedirá acudir en persona o a urgencias.',
  'Me conectaré desde un lugar privado; la llamada no se graba y mis datos se tratan conforme al aviso de privacidad de la clínica.',
  'En una emergencia no usaré la videoconsulta: llamaré al 911.',
];

type VideoAppointment = Awaited<ReturnType<VideoService['load']>>;

@Injectable()
export class VideoService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  get available() {
    return this.config.video !== null;
  }

  linkToken(appointmentId: string) {
    return videoLinkToken(this.config.jwtSecret, appointmentId);
  }

  /** Cita a partir del enlace del correo (o null si el enlace no es válido). */
  appointmentIdFromLink(token: string) {
    return readVideoLinkToken(this.config.jwtSecret, token);
  }

  load(appointmentId: string) {
    return this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        clinic: { select: { name: true, timezone: true, phone: true, plan: true, subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true, billingExempt: true } },
        doctor: { select: { id: true, displayName: true, specialty: true, membershipId: true } },
        clinicPatient: { select: { name: true, patientAccountId: true } },
      },
    });
  }

  window(a: { startsAt: Date; endsAt: Date }) {
    return {
      opensAt: new Date(a.startsAt.getTime() - OPENS_BEFORE_MINUTES * 60_000),
      closesAt: new Date(a.endsAt.getTime() + CLOSES_AFTER_MINUTES * 60_000),
    };
  }

  /** Datos para la pantalla previa a entrar (sin abrir la sala). */
  info(a: NonNullable<VideoAppointment>, now = new Date()) {
    const { opensAt, closesAt } = this.window(a);
    return {
      appointmentId: a.id, clinicPatientId: a.clinicPatientId, status: a.status, modality: a.modality, startsAt: a.startsAt, endsAt: a.endsAt,
      serviceName: a.serviceName, clinic: { name: a.clinic.name, timezone: a.clinic.timezone, phone: a.clinic.phone },
      doctor: { displayName: a.doctor.displayName, specialty: a.doctor.specialty }, patientName: a.clinicPatient.name,
      opensAt, closesAt, open: now >= opensAt && now <= closesAt,
      consentGiven: a.videoConsentAt !== null, consentText: CONSENT_TEXT, consentVersion: CONSENT_VERSION,
      available: this.available && entitlements(a.clinic).plan.features.telemedicine,
    };
  }

  private assertJoinable(a: NonNullable<VideoAppointment>, now: Date) {
    if (!this.available || !entitlements(a.clinic).plan.features.telemedicine) throw new ConflictException('Las videoconsultas no están disponibles por ahora');
    if (a.modality !== 'VIDEO') throw new ConflictException('Esta cita es presencial');
    if (a.status !== 'BOOKED') throw new ConflictException('La cita ya no está vigente');
    const { opensAt, closesAt } = this.window(a);
    if (now < opensAt) throw new ConflictException(`La sala abre ${OPENS_BEFORE_MINUTES} minutos antes de la cita`);
    if (now > closesAt) throw new ConflictException('La sala de esta cita ya cerró');
  }

  private room(a: NonNullable<VideoAppointment>) {
    const { opensAt, closesAt } = this.window(a);
    return this.provider.ensureRoom(`medora-${a.id}`, opensAt, closesAt);
  }

  /** El paciente entra: requiere su consentimiento informado (una vez por cita). */
  async patientJoin(a: NonNullable<VideoAppointment>, consent: boolean, now = new Date()) {
    this.assertJoinable(a, now);
    if (!a.videoConsentAt && !consent) {
      throw new BadRequestException('Para entrar necesitamos tu consentimiento para la consulta a distancia');
    }
    const room = await this.room(a);
    const token = await this.provider.token(room.name, { userName: a.clinicPatient.name, owner: false, expires: this.window(a).closesAt });
    // Primera vez que entra: aviso inmediato al médico (aunque no tenga la agenda abierta).
    if (!a.patientJoinedAt && a.doctor.membershipId) {
      await this.push.notify([a.doctor.membershipId], {
        title: 'Paciente en la sala de espera', body: `${a.clinicPatient.name} entró a la videoconsulta`,
        url: `/consulta?cita=${a.id}&rol=medico`, tag: `video-${a.id}`,
      }, `video:${a.id}`);
    }
    await this.prisma.appointment.update({
      where: { id: a.id },
      data: {
        patientSeenAt: now, patientJoinedAt: a.patientJoinedAt ?? now,
        ...(a.videoConsentAt ? {} : { videoConsentAt: now, videoConsentVersion: CONSENT_VERSION }),
      },
    });
    return { url: room.url, token };
  }

  /** El médico (o propietario/administración) entra como anfitrión. */
  async doctorJoin(a: NonNullable<VideoAppointment>, userName: string, now = new Date()) {
    this.assertJoinable(a, now);
    const room = await this.room(a);
    const token = await this.provider.token(room.name, { userName, owner: true, expires: this.window(a).closesAt });
    await this.prisma.appointment.update({ where: { id: a.id }, data: { doctorJoinedAt: a.doctorJoinedAt ?? now } });
    return { url: room.url, token };
  }

  /** Señal de vida del paciente en la sala (para avisar al médico que ya está esperando). */
  async heartbeat(a: NonNullable<VideoAppointment>, now = new Date()) {
    const { opensAt, closesAt } = this.window(a);
    if (a.modality !== 'VIDEO' || a.status !== 'BOOKED' || now < opensAt || now > closesAt) return { ok: false };
    await this.prisma.appointment.update({ where: { id: a.id }, data: { patientSeenAt: now } });
    return { ok: true };
  }

  /** ¿El paciente está ahora en la sala? */
  static waiting(a: { modality: string; patientSeenAt: Date | null }, now = new Date()) {
    return a.modality === 'VIDEO' && a.patientSeenAt !== null && now.getTime() - a.patientSeenAt.getTime() <= PRESENCE_SECONDS * 1000;
  }
}
