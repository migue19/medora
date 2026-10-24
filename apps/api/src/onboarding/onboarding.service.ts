import { coordinatesFromMapUrl } from '../locations/locations.controller';
import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { randomToken, sha256 } from '../common/crypto';
import { slugify, uniqueDoctorSlug } from '../common/slug';
import { MailService } from '../mail/mail.service';
import { AuthTokensService } from '../auth/auth-tokens.service';
import { INVITATION_TTL_MS } from '../clinic/clinic.controller';
import { OnboardingData, Issue, check, clean } from './onboarding.schema';

export const ONBOARDING_TTL_MS = 90 * 24 * 60 * 60_000;
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60_000;
/** Quien invita en nombre de Tepahti al importar (no es un usuario real). */
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

const INVALID = 'El enlace del alta no es válido o ya venció. Pide uno nuevo a Tepahti.';

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly authTokens: AuthTokensService,
  ) {}

  /** Crea un enlace privado de alta. Devuelve el enlace completo (sólo se muestra una vez). */
  async create(label: string, contactEmail: string | null) {
    const token = randomToken();
    const row = await this.prisma.clinicOnboarding.create({
      data: {
        label: label.trim().slice(0, 120), contactEmail: contactEmail?.trim().toLowerCase() || null,
        tokenHash: sha256(token), expiresAt: new Date(Date.now() + ONBOARDING_TTL_MS),
        data: { clinic: { name: label.trim().slice(0, 120), email: contactEmail?.trim().toLowerCase() ?? '' } },
      },
    });
    return { id: row.id, link: `${this.config.webOrigin}/alta#${token}`, expiresAt: row.expiresAt };
  }

  private async byToken(token: string) {
    const row = await this.prisma.clinicOnboarding.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.expiresAt <= new Date()) throw new BadRequestException(INVALID);
    return row;
  }

  private async takenSlugs(own: string): Promise<string[]> {
    if (!own) return [];
    const clinic = await this.prisma.clinic.findUnique({ where: { slug: own }, select: { id: true } });
    return clinic ? [own] : [];
  }

  async issues(data: OnboardingData): Promise<Issue[]> {
    return check(data, await this.takenSlugs(data.clinic.slug));
  }

  async load(token: string) {
    const row = await this.byToken(token);
    const data = clean(row.data);
    const photos = await this.prisma.onboardingPhoto.findMany({ where: { onboardingId: row.id }, select: { doctorKey: true, updatedAt: true } });
    return {
      status: row.status, label: row.label, data, issues: await this.issues(data), submittedAt: row.submittedAt, updatedAt: row.updatedAt,
      photos: Object.fromEntries(photos.map((p) => [p.doctorKey, p.updatedAt.getTime()])),
    };
  }

  /** Guarda el borrador tal como esté; devuelve los pendientes. Una vez importada ya no se edita. */
  async save(token: string, raw: unknown) {
    const row = await this.byToken(token);
    if (row.status === 'IMPORTED') throw new ConflictException('Esta alta ya se cargó en Tepahti; los cambios se hacen desde el panel.');
    const data = clean(raw);
    const saved = await this.prisma.clinicOnboarding.update({
      where: { id: row.id }, data: { data: data as unknown as Prisma.InputJsonValue },
    });
    return { savedAt: saved.updatedAt, status: saved.status, issues: await this.issues(data) };
  }

  /** Envía para revisión: exige lo indispensable. Se puede seguir corrigiendo y volver a enviar hasta que se importe. */
  async submit(token: string) {
    const row = await this.byToken(token);
    if (row.status === 'IMPORTED') throw new ConflictException('Esta alta ya se cargó en Tepahti.');
    const data = clean(row.data);
    const issues = (await this.issues(data)).filter((i) => i.required);
    if (issues.length) throw new BadRequestException({ message: 'Faltan datos indispensables', issues });
    await this.prisma.$transaction(async (tx) => {
      await tx.clinicOnboarding.update({ where: { id: row.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
      const notify = process.env.ONBOARDING_NOTIFY_EMAIL?.trim();
      if (notify) {
        await this.mail.onboardingSubmitted(tx, {
          email: notify, label: row.label, clinicName: data.clinic.name, id: row.id,
          contact: [data.contacts.responsibleName, data.contacts.responsiblePhone, data.contacts.responsibleEmail].filter(Boolean).join(' · '),
        });
      }
    });
    return { status: 'SUBMITTED' as const };
  }

  async savePhoto(token: string, doctorKey: string, mimeType: string, bytes: Buffer) {
    const row = await this.byToken(token);
    if (row.status === 'IMPORTED') throw new ConflictException('Esta alta ya se cargó en Tepahti.');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(doctorKey)) throw new BadRequestException('Médico inválido');
    const data = new Uint8Array(bytes);
    const photo = await this.prisma.onboardingPhoto.upsert({
      where: { onboardingId_doctorKey: { onboardingId: row.id, doctorKey } },
      create: { onboardingId: row.id, doctorKey, mimeType, data }, update: { mimeType, data },
    });
    return { version: photo.updatedAt.getTime() };
  }

  async photo(token: string, doctorKey: string) {
    const row = await this.byToken(token);
    const p = await this.prisma.onboardingPhoto.findUnique({ where: { onboardingId_doctorKey: { onboardingId: row.id, doctorKey } } });
    if (!p) throw new NotFoundException('Sin foto');
    return p;
  }

  async deletePhoto(token: string, doctorKey: string) {
    const row = await this.byToken(token);
    await this.prisma.onboardingPhoto.deleteMany({ where: { onboardingId: row.id, doctorKey } });
  }

  // ---------------------------------------------------------------- comandos

  async list() {
    return this.prisma.clinicOnboarding.findMany({
      select: { id: true, label: true, contactEmail: true, status: true, submittedAt: true, importedAt: true, updatedAt: true, expiresAt: true, clinicId: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const row = await this.prisma.clinicOnboarding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Alta no encontrada');
    const data = clean(row.data);
    return { row, data, issues: await this.issues(data) };
  }

  /**
   * Carga el alta en Tepahti en una sola transacción: clínica, sedes, consultorios, servicios, precios, médicos
   * (perfil y foto), horarios y bloqueos. Después invita al equipo por correo; el propietario recibe un enlace
   * para elegir su contraseña. Si algo falla no queda nada a medias.
   */
  async import(id: string) {
    const { row, data: d, issues } = await this.get(id);
    if (row.status === 'IMPORTED') throw new ConflictException('Esta alta ya se importó.');
    const blocking = issues.filter((i) => i.required);
    if (blocking.length) throw new BadRequestException({ message: 'El alta tiene datos indispensables pendientes', issues: blocking });
    const photos = await this.prisma.onboardingPhoto.findMany({ where: { onboardingId: id } });

    return this.prisma.$transaction(async (tx) => {
      const first = d.locations.at(0)!;
      const clinic = await tx.clinic.create({
        data: {
          slug: d.clinic.slug, name: d.clinic.name, phone: d.clinic.phone, address: first.address,
          bookingEnabled: d.rules.bookingEnabled, minNoticeMinutes: d.rules.minNoticeMinutes, horizonDays: d.rules.horizonDays,
          patientCancelMinMinutes: d.rules.patientCancelMinMinutes,
          remindersEnabled: d.communication.reminderOffsets.length > 0,
          reminderOffsets: d.communication.reminderOffsets.length ? [...d.communication.reminderOffsets].sort((a, b) => b - a) : [1440, 120],
          reviewsEnabled: d.communication.reviewsEnabled, directoryEnabled: d.privacy.directory,
          whatsappEnabled: d.communication.whatsapp && this.config.whatsapp !== null,
        },
      });

      const locationId = new Map<string, string>();
      const roomId = new Map<string, string>();
      for (const [i, l] of d.locations.entries()) {
        const loc = await tx.location.create({
          data: {
            clinicId: clinic.id, name: l.name, address: l.address || null, phone: l.phone || null, mapUrl: l.mapUrl || null, sortOrder: i,
            neighborhood: l.neighborhood || null, city: l.city || null, postalCode: /^\d{5}$/.test(l.postalCode) ? l.postalCode : null,
            ...coordinatesFromMapUrl(l.mapUrl),
          },
        });
        locationId.set(l.key, loc.id);
        if (l.hours.length) await tx.locationHours.createMany({ data: l.hours.map((h) => ({ ...h, locationId: loc.id })) });
        for (const name of l.rooms) {
          const room = await tx.room.create({ data: { clinicId: clinic.id, locationId: loc.id, name } });
          roomId.set(`${l.key}|${name.toLowerCase()}`, room.id);
        }
      }

      const doctorId = new Map<string, string>();
      for (const x of d.doctors) {
        const doctor = await tx.doctor.create({
          data: {
            clinicId: clinic.id, displayName: x.displayName, specialty: x.specialty, licenseNumber: x.licenseNumber || null,
            bio: x.bio || null, education: x.education, certifications: x.certifications, languages: x.languages,
            conditions: x.conditions, insurers: x.insurers,
            slug: await uniqueDoctorSlug(tx, clinic.id, slugify(x.displayName)),
          },
        });
        doctorId.set(x.key, doctor.id);
        const photo = photos.find((p) => p.doctorKey === x.key);
        if (photo) await tx.doctorPhoto.create({ data: { doctorId: doctor.id, mimeType: photo.mimeType, data: photo.data } });
      }

      for (const s of d.services) {
        const service = await tx.service.create({
          data: { clinicId: clinic.id, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents, visitType: s.visitType, telemedicine: s.telemedicine },
        });
        await tx.doctorService.createMany({ data: s.doctorKeys.map((k) => ({ doctorId: doctorId.get(k)!, serviceId: service.id, clinicId: clinic.id })) });
        if (s.prices.length) {
          await tx.servicePrice.createMany({
            data: s.prices.map((p) => ({
              clinicId: clinic.id, serviceId: service.id, priceCents: p.priceCents,
              doctorId: p.doctorKey ? doctorId.get(p.doctorKey)! : null, locationId: p.locationKey ? locationId.get(p.locationKey)! : null,
            })),
          });
        }
      }

      await tx.scheduleRule.createMany({
        data: d.schedules.map((s) => ({
          clinicId: clinic.id, doctorId: doctorId.get(s.doctorKey)!, weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute,
          locationId: locationId.get(s.locationKey)!, roomId: s.room ? roomId.get(`${s.locationKey}|${s.room.toLowerCase()}`) ?? null : null,
        })),
      });
      // Días completos en hora local de la clínica: desde el inicio del primer día hasta el fin del último.
      for (const t of d.timeOff) {
        const startsAt = DateTime.fromISO(t.from, { zone: clinic.timezone }).startOf('day').toJSDate();
        const endsAt = DateTime.fromISO(t.to, { zone: clinic.timezone }).startOf('day').plus({ days: 1 }).toJSDate();
        await tx.timeOff.create({
          data: { clinicId: clinic.id, doctorId: doctorId.get(t.doctorKey)!, startsAt, endsAt, reason: t.reason || 'Bloqueo', createdById: SYSTEM_ID },
        });
      }

      // Equipo: el propietario activa su cuenta; los demás reciben invitación (los médicos quedan vinculados al aceptar).
      const owner = d.team.find((t) => t.role === 'OWNER')!;
      const existing = await tx.user.findUnique({ where: { email: owner.email } });
      const user = existing ?? await tx.user.create({
        // Contraseña imposible de adivinar: la elige con el enlace de activación.
        data: { email: owner.email, name: owner.name, passwordHash: `unset$${randomToken()}` },
      });
      await tx.membership.create({ data: { userId: user.id, clinicId: clinic.id, role: 'OWNER' } });
      // Quien ya usa Tepahti en otra clínica entra con su contraseña de siempre; no se le cambia.
      const activation = existing ? null : await this.authTokens.issue(tx, 'STAFF_RESET_PASSWORD', { userId: user.id }, user.email, ACTIVATION_TTL_MS);
      await this.mail.ownerActivation(tx, { email: user.email, name: user.name, clinicName: clinic.name, slug: clinic.slug, token: activation });

      for (const t of d.team.filter((m) => m.role !== 'OWNER')) {
        const token = randomToken();
        const invitation = await tx.staffInvitation.create({
          data: {
            clinicId: clinic.id, email: t.email, name: t.name, role: t.role, tokenHash: sha256(token), invitedById: SYSTEM_ID,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
            doctorId: t.role === 'DOCTOR' && t.doctorKey ? doctorId.get(t.doctorKey) ?? null : null,
          },
        });
        await this.mail.staffInvitation(tx, {
          email: t.email, name: t.name, clinicName: clinic.name, timezone: clinic.timezone, role: t.role,
          inviterName: 'Tepahti', token, expiresAt: invitation.expiresAt,
        });
      }

      await tx.clinicOnboarding.update({ where: { id }, data: { status: 'IMPORTED', importedAt: new Date(), clinicId: clinic.id } });
      return {
        clinicId: clinic.id, slug: clinic.slug, url: `${this.config.webOrigin}/c/${clinic.slug}`,
        counts: {
          sedes: d.locations.length, consultorios: roomId.size, medicos: d.doctors.length, servicios: d.services.length,
          bloques: d.schedules.length, bloqueos: d.timeOff.length, equipo: d.team.length,
        },
      };
    }, { timeout: 60_000 });
  }
}

