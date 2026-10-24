/**
 * Clínica de demostración con datos ficticios para grabar videos y manuales (sólo en local).
 * Levanta la API en memoria con transportes falsos (no sale ningún correo ni WhatsApp) y la llena por HTTP,
 * como lo haría el personal. Uso:
 *   DEMO_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/medora_dev node dist-test/test/demo/demo-seed.js
 * Escribe las credenciales del propietario en marketing/.demo-credentials.json (fuera de git).
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DateTime } from 'luxon';
import { createApp } from '../../src/bootstrap';
import { hashPassword } from '../../src/common/crypto';
import { MemoryTransport } from '../../src/mail/mail.transport';
import { MemoryWhatsApp } from '../../src/notifications/whatsapp.transport';
import { MemoryGateway } from '../../src/payments/gateway';
import { MemoryVideo } from '../../src/video/video.provider';
import { MemoryBilling } from '../../src/billing/billing.gateway';
import { MemoryCfdi } from '../../src/billing/cfdi';
import { MemoryWebhooks } from '../../src/integrations/webhook.transport';
import { MemoryCalendar } from '../../src/integrations/calendar.providers';
import { MemoryPush } from '../../src/integrations/push.service';
import { Client, ORIGIN } from '../integration/harness';

const TZ = 'America/Mexico_City';
const SLUG = 'clinica-aurora';
const OWNER_EMAIL = 'andres.morales@aurora.example';

const DOCTORS = [
  { key: 'andres', displayName: 'Dr. Andrés Morales', specialty: 'Cardiología', license: '7845123', owner: true,
    bio: 'Cardiólogo con 15 años de experiencia en prevención cardiovascular, hipertensión y arritmias.',
    education: ['Médico Cirujano, UNAM', 'Especialidad en Cardiología, Instituto Nacional de Cardiología'],
    certifications: ['Consejo Mexicano de Cardiología'], languages: ['Español', 'Inglés'],
    conditions: ['Hipertensión', 'Arritmias', 'Colesterol alto'], insurers: ['GNP', 'AXA', 'MetLife'] },
  { key: 'sofia', displayName: 'Dra. Sofía Ramírez', specialty: 'Pediatría', license: '8932011',
    bio: 'Pediatra dedicada al control del niño sano, vacunación y enfermedades respiratorias.',
    education: ['Médico Cirujano, IPN', 'Especialidad en Pediatría, Hospital Infantil de México'],
    certifications: ['Consejo Mexicano de Certificación en Pediatría'], languages: ['Español'],
    conditions: ['Asma', 'Gripe', 'Alergias'], insurers: ['GNP', 'Seguros Monterrey'] },
  { key: 'valeria', displayName: 'Dra. Valeria Torres', specialty: 'Ginecología', license: '9120457',
    bio: 'Ginecóloga y obstetra: control prenatal, anticoncepción y salud de la mujer.',
    education: ['Médico Cirujano, Universidad La Salle', 'Especialidad en Ginecología y Obstetricia, IMSS'],
    certifications: ['Consejo Mexicano de Ginecología y Obstetricia'], languages: ['Español', 'Inglés'],
    conditions: ['Embarazo', 'Síndrome de ovario poliquístico'], insurers: ['AXA', 'MetLife'] },
  { key: 'jorge', displayName: 'Dr. Jorge Castillo', specialty: 'Medicina general', license: '6654390',
    bio: 'Médico general: chequeos, enfermedades crónicas y certificados médicos.',
    education: ['Médico Cirujano, UAM'], certifications: [], languages: ['Español'],
    conditions: ['Diabetes', 'Hipertensión', 'Infección de garganta'], insurers: [] },
  { key: 'lucia', displayName: 'Dra. Lucía Hernández', specialty: 'Dermatología', license: '9988112',
    bio: 'Dermatóloga clínica: acné, manchas y revisión de lunares.',
    education: ['Médico Cirujano, Universidad Anáhuac', 'Especialidad en Dermatología, Centro Dermatológico Pascua'],
    certifications: ['Consejo Mexicano de Dermatología'], languages: ['Español', 'Inglés'],
    conditions: ['Acné', 'Dermatitis', 'Psoriasis'], insurers: ['GNP'] },
];

const SERVICES = [
  { key: 'cardio', name: 'Consulta de cardiología', durationMinutes: 30, priceCents: 120000, telemedicine: true, doctors: ['andres'] },
  { key: 'ecg', name: 'Electrocardiograma', durationMinutes: 30, priceCents: 90000, doctors: ['andres'] },
  { key: 'pedia', name: 'Consulta pediátrica', durationMinutes: 30, priceCents: 70000, telemedicine: true, doctors: ['sofia'] },
  { key: 'gine', name: 'Consulta ginecológica', durationMinutes: 40, priceCents: 100000, doctors: ['valeria'] },
  { key: 'prenatal', name: 'Control prenatal', durationMinutes: 30, priceCents: 90000, doctors: ['valeria'] },
  { key: 'general', name: 'Consulta general', durationMinutes: 30, priceCents: 50000, telemedicine: true, doctors: ['jorge'] },
  { key: 'derma', name: 'Consulta dermatológica', durationMinutes: 30, priceCents: 95000, telemedicine: true, doctors: ['lucia'] },
];

// Lunes a viernes 9-14 y 16-19:30, sábado 9-13.
const RULES = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, startMinute: 540, endMinute: 840 }, { weekday, startMinute: 960, endMinute: 1170 },
]).concat([{ weekday: 6, startMinute: 540, endMinute: 780 }]);

const PATIENTS = [
  'Mariana López García', 'Carlos Fernández Ruiz', 'Ana Paula Mendoza', 'Ricardo Gómez Salinas', 'Daniela Ortiz Vega',
  'Fernando Aguilar Ríos', 'Gabriela Navarro Cruz', 'Luis Alberto Reyes', 'Paola Jiménez Soto', 'Miguel Ángel Herrera',
  'Sofía Castro Medina', 'Javier Rojas Peña', 'Valentina Flores Díaz', 'Diego Martínez Luna', 'Camila Vargas Ibarra',
  'Roberto Sánchez Mora', 'Alejandra Domínguez', 'Emilio Guerrero Paz', 'Natalia Romero Leal', 'Héctor Delgado Cano',
  'Regina Campos Ochoa', 'Arturo Cervantes Gil', 'Fernanda Ruiz Esquivel', 'Tomás Villalobos', 'Isabel Montes Arriaga',
];

// Quienes opinan tienen cuenta en línea; nombres distintos para no duplicar fichas en la demo.
const REVIEWERS = ['Lorena Pacheco Ruiz', 'Andrés Quiroga Mena', 'Patricia Solís Lara', 'Óscar Benítez Duarte', 'Mónica Treviño Ávila', 'Raúl Espinoza Tapia'];

const COMMENTS = [
  'Muy puntual y explica todo con calma. Me sentí muy bien atendida.',
  'Excelente trato, el consultorio está impecable. Agendar en línea fue facilísimo.',
  'Resolvió todas mis dudas y me dio seguimiento por correo. Lo recomiendo.',
  'Me atendieron a la hora exacta. Muy profesional.',
  'Súper amable con mi hijo, lo volveremos a llevar.',
  'Buena consulta, aunque tuve que esperar 10 minutos. Muy recomendable.',
];

function fail(what: string, r: { status: number; body: unknown }): never {
  throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
}
async function ok<T = any>(what: string, p: Promise<{ status: number; body: T }>): Promise<T> {
  const r = await p;
  if (r.status >= 300) fail(what, r);
  return r.body;
}
const phone = (i: number) => `55 ${String(4100 + i * 37).padStart(4, '0')} ${String(2200 + i * 53).padStart(4, '0')}`;
const email = (name: string) => `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(' ').slice(0, 2).join('.')}@correo.example`;

async function main() {
  const databaseUrl = process.env.DEMO_DATABASE_URL;
  if (!databaseUrl) throw new Error('Define DEMO_DATABASE_URL');
  if (!/127\.0\.0\.1|localhost/.test(databaseUrl)) throw new Error('Sólo se ejecuta contra una base local');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: '-c TimeZone=UTC' }) });
  if (await prisma.clinic.findUnique({ where: { slug: SLUG } })) throw new Error(`Ya existe ${SLUG}; borra la base demo para repetir`);

  const app = await createApp({
    databaseUrl, jwtSecret: new TextEncoder().encode(randomBytes(32).toString('hex')), webOrigin: ORIGIN,
    cookieSecure: false, port: 0, host: '127.0.0.1', production: false, trustProxy: false, rateLimitEnabled: false,
    mail: { from: 'Tepahti <no-reply@medora.example>', smtp: null },
    whatsapp: { token: 'demo', phoneNumberId: '0', template: 'recordatorio_cita', reviewTemplate: 'invitacion_opinion', language: 'es_MX', apiVersion: 'v25.0', defaultCountryCode: '52' },
    payments: { secretKey: 'sk_test_demo', webhookSecret: 'whsec_demo' },
    video: { apiKey: 'demo' },
    recordsKey: Buffer.alloc(32, 7),
    invoicing: { user: 'demo', password: 'demo', sandbox: true, expeditionPlace: '03100', series: 'MED', resicoRetention: false },
    superadmins: [], calendars: { google: null, microsoft: null }, push: null, jobsPollMs: 0,
  } as never, false, {
    mail: new MemoryTransport(), whatsapp: new MemoryWhatsApp(), payments: new MemoryGateway(), video: new MemoryVideo(),
    billing: new MemoryBilling(), cfdi: new MemoryCfdi(), webhooks: new MemoryWebhooks(), calendars: { GOOGLE: new MemoryCalendar() }, push: new MemoryPush(),
  });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  try {
    // Clínica y propietario (que también es médico, como en un consultorio).
    const password = randomBytes(12).toString('base64url');
    const clinic = await prisma.clinic.create({
      data: { slug: SLUG, name: 'Clínica Aurora', billingExempt: true, verification: 'VERIFIED', timezone: TZ },
    });
    const user = await prisma.user.create({ data: { email: OWNER_EMAIL, name: 'Andrés Morales', passwordHash: await hashPassword(password) } });
    const membership = await prisma.membership.create({ data: { userId: user.id, clinicId: clinic.id, role: 'OWNER' } });

    const owner = new Client(base);
    owner.token = (await ok('login', owner.post('/api/auth/login', { email: OWNER_EMAIL, password, clinicSlug: SLUG }))).accessToken;

    await ok('clínica', owner.patch('/api/clinic', {
      phone: '55 5200 1800', address: 'Av. Coyoacán 1622, Col. Del Valle, Benito Juárez, CDMX',
      bookingEnabled: true, remindersEnabled: true, reminderOffsets: [1440, 120], reviewsEnabled: true, directoryEnabled: true,
      minNoticeMinutes: 60, horizonDays: 60, weeklyReport: true,
    }));
    const location = (await ok<any[]>('sedes', owner.get('/api/clinic/locations')))[0];
    await ok('sede', owner.patch(`/api/clinic/locations/${location.id}`, {
      name: 'Sede Del Valle', address: 'Av. Coyoacán 1622, Col. Del Valle, Benito Juárez, CDMX', phone: '55 5200 1800',
      city: 'Benito Juárez', neighborhood: 'Del Valle', latitude: 19.3754, longitude: -99.1712,
    }));

    const serviceIds: Record<string, string> = {};
    for (const s of SERVICES) {
      serviceIds[s.key] = (await ok('servicio', owner.post('/api/clinic/services', {
        name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents, telemedicine: s.telemedicine ?? false,
      }))).id;
    }
    const doctorIds: Record<string, string> = {};
    for (const d of DOCTORS) {
      const services = SERVICES.filter((s) => s.doctors.includes(d.key)).map((s) => serviceIds[s.key]);
      const doc = await ok('médico', owner.post('/api/clinic/doctors', {
        displayName: d.displayName, specialty: d.specialty, licenseNumber: d.license, bio: d.bio, serviceIds: services,
        education: d.education, certifications: d.certifications, languages: d.languages, conditions: d.conditions, insurers: d.insurers,
        ...(d.owner ? { membershipId: membership.id } : {}),
      }));
      doctorIds[d.key] = doc.id;
      await ok('horario', owner.put(`/api/clinic/doctors/${doc.id}/schedule`, { rules: RULES.map((r) => ({ ...r, locationId: location.id })) }));
    }

    // Pacientes registrados por recepción (fichas telefónicas): los de la lista y más combinaciones de nombres.
    const FIRST = ['Laura', 'José', 'María Fernanda', 'Juan Pablo', 'Adriana', 'Eduardo', 'Claudia', 'Sergio', 'Verónica', 'Pablo', 'Karla', 'Manuel', 'Rocío'];
    const LAST = ['Medina', 'Salazar', 'Robles', 'Cárdenas', 'Fuentes', 'Ibarra', 'Molina', 'Valdez', 'Zamora', 'Peña'];
    const names = [...PATIENTS];
    for (let i = 0; names.length < 90; i++) names.push(`${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]} ${LAST[(i * 7 + 2) % LAST.length]}`);
    const patientIds: string[] = [];
    for (const [i, name] of [...new Set(names)].entries()) {
      const p = await ok('paciente', owner.post('/api/clinic/patients', { name, phone: phone(i), email: i >= PATIENTS.length ? email(name).replace('@', `${i}@`) : email(name), whatsappConsent: true }));
      patientIds.push(p.id);
    }

    // Citas: agenda llena como la de una clínica activa. Historial de 12 días hábiles y las próximas dos semanas.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const now = DateTime.now().setZone(TZ);
    const today = now.startOf('day');
    const bookable = (d: DateTime) => d.weekday <= 5;
    const book = async (doctorKey: string, serviceKey: string, startsAt: DateTime, patient: string, modality = 'IN_PERSON') =>
      ok('cita', owner.post('/api/clinic/appointments', {
        requestId: randomUUID(), doctorId: doctorIds[doctorKey], serviceId: serviceIds[serviceKey], clinicPatientId: patient,
        startsAt: startsAt.toUTC().toISO(), modality,
      }));
    const servicesOf: Record<string, string[]> = { andres: ['cardio', 'cardio', 'ecg'], sofia: ['pedia'], valeria: ['gine', 'prenatal'], jorge: ['general'], lucia: ['derma'] };
    // Horarios de cada médico en pasos del servicio más largo que ofrece.
    const daySlots = (date: DateTime, doctorKey: string) => {
      const step = Math.max(...servicesOf[doctorKey].map((k) => SERVICES.find((x) => x.key === k)!.durationMinutes));
      return RULES.filter((r) => r.weekday === date.weekday).flatMap((r) => {
        const out: DateTime[] = [];
        for (let m = r.startMinute; m + step <= r.endMinute; m += step) out.push(date.set({ hour: Math.floor(m / 60), minute: m % 60 }));
        return out;
      });
    };
    // Origen: casi la mitad llega por internet (página de la clínica, directorio, widget y Google).
    const origin = () => {
      const x = rand();
      return x < 0.55 ? null : x < 0.75 ? 'web' : x < 0.86 ? 'directorio' : x < 0.94 ? 'widget' : 'google';
    };
    const sourceData = (channel: string | null) => (channel ? { source: 'ONLINE' as const, channel } : {});

    // Horario libre de paso: se agenda ahí y la cita se mueve al pasado, así que se puede reutilizar.
    let parking = today.plus({ days: 30 }).set({ hour: 10 });
    while (!bookable(parking)) parking = parking.plus({ days: 1 });

    let future = 0;
    let past = 0;
    for (let day = -16; day <= 14; day++) {
      const date = today.plus({ days: day });
      if (!bookable(date)) continue;
      for (const doctorKey of Object.keys(servicesOf)) {
        for (const at of daySlots(date, doctorKey)) {
          const serviceKey = pick(servicesOf[doctorKey]);
          // Cada paciente se atiende con un médico, así nunca tiene dos citas a la misma hora.
          const patient = pick(patientIds.filter((_, i) => i % 5 === Object.keys(servicesOf).indexOf(doctorKey)));
          const channel = origin();
          if (at > now.plus({ hours: 1 })) {
            if (rand() > 0.55) continue; // deja horarios libres para reservar
            const video = SERVICES.find((x) => x.key === serviceKey)?.telemedicine && rand() < 0.15 ? 'VIDEO' : 'IN_PERSON';
            const a = await book(doctorKey, serviceKey, at, patient, video);
            // Quienes ya recibieron el recordatorio (próximos 3 días) confirmaron en buena parte.
            const confirmed = day <= 3 && rand() < 0.5;
            await prisma.appointment.update({ where: { id: a.appointment?.id ?? a.id }, data: { ...sourceData(channel), ...(confirmed ? { confirmedAt: new Date() } : {}) } });
            future++;
          } else if (at < now) {
            if (rand() > 0.82) continue;
            const a = await book(doctorKey, serviceKey, parking, patient);
            const dur = SERVICES.find((x) => x.key === serviceKey)!.durationMinutes;
            const x = rand();
            const status = x < 0.06 ? 'NO_SHOW' : x < 0.11 ? 'CANCELLED' : 'COMPLETED';
            await prisma.appointment.update({
              where: { id: a.appointment?.id ?? a.id },
              data: {
                startsAt: at.toJSDate(), endsAt: at.plus({ minutes: dur }).toJSDate(), status, ...sourceData(channel),
                ...(status === 'CANCELLED' ? { cancelReason: 'El paciente tuvo un imprevisto' } : {}),
              },
            });
            past++;
          }
        }
      }
    }

    // Expediente: historia, alergias y una nota firmada por cada paciente atendido por el Dr. Morales (dueño y médico).
    const attended = await prisma.appointment.findMany({
      where: { doctorId: doctorIds.andres, status: 'COMPLETED' }, orderBy: { startsAt: 'asc' }, select: { id: true, clinicPatientId: true },
    });
    const seen = new Set<string>();
    for (const [i, a] of attended.entries()) {
      if (seen.has(a.clinicPatientId) || seen.size >= 25) continue;
      seen.add(a.clinicPatientId);
      const rec = `/api/clinic/patients/${a.clinicPatientId}/record`;
      await ok('historia', owner.patch(`${rec}/profile`, {
        birthDate: `19${60 + (i * 7) % 35}-0${1 + (i % 9)}-1${i % 9}`, sex: i % 2 ? 'M' : 'F', bloodType: ['O+', 'A+', 'B+', 'O-'][i % 4],
        history: { heredofamiliares: 'Padre con hipertensión arterial.', personalesPatologicos: 'Niega cirugías previas.' },
      }));
      if (i % 3 === 0) await ok('alergia', owner.post(`${rec}/allergies`, { substance: 'Penicilina', reaction: 'Ronchas', severity: 'MODERADA' }));
      const note = await ok('nota', owner.post(`${rec}/notes`, {
        appointmentId: a.id,
        subjective: 'Acude a revisión. Refiere cefalea ocasional y cifras de presión elevadas en casa.',
        objective: 'Consciente, orientado. Ruidos cardiacos rítmicos, sin soplos.',
        assessment: 'Hipertensión arterial en control.',
        plan: 'Dieta baja en sodio, caminar 30 minutos diarios. Control en 1 mes.',
        vitals: { systolic: 138, diastolic: 88, heartRate: 76, weightKg: 78 },
        diagnoses: [{ code: 'I10', description: 'Hipertensión esencial (primaria)' }],
      }));
      await ok('firma', owner.post(`${rec}/notes/${note.id}/sign`, {}));
      // Sólo en la demo local: fecha la nota el día de su consulta (los disparadores de inmutabilidad lo impedirían).
      await prisma.$transaction([
        prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
        prisma.$executeRawUnsafe(`UPDATE "ClinicalNote" n SET "createdAt" = a."startsAt" + interval '25 minutes', "signedAt" = a."startsAt" + interval '28 minutes'
          FROM "Appointment" a WHERE n.id = '${note.id}' AND a.id = '${a.id}'`),
      ]);
    }

    // Pacientes con cuenta en línea que opinan sobre su consulta atendida.
    for (const [i, comment] of COMMENTS.entries()) {
      const name = REVIEWERS[i];
      const patient = new Client(base);
      const reg = await ok('registro', patient.post('/api/patient/auth/register', {
        name, email: `opina.${i}.${randomUUID().slice(0, 6)}@correo.example`, phone: phone(40 + i), password: randomBytes(12).toString('base64url'),
      }));
      patient.token = reg.accessToken;
      await prisma.patientAccount.update({ where: { id: reg.patient.id }, data: { emailVerifiedAt: new Date() } });
      const [doctorKey, serviceKey] = ([['andres', 'cardio'], ['sofia', 'pedia'], ['valeria', 'gine'], ['jorge', 'general'], ['lucia', 'derma']] as const)[i % 5];
            const av = await patient.get(`/api/public/clinics/${SLUG}/doctors/${doctorIds[doctorKey]}/availability?serviceId=${serviceIds[serviceKey]}&from=${parking.toISODate()}&days=1`);
      const booked = await ok('reserva', patient.post(`/api/public/clinics/${SLUG}/appointments`, {
        requestId: randomUUID(), doctorId: doctorIds[doctorKey], serviceId: serviceIds[serviceKey], startsAt: av.body.days[0].slots[0].startsAt,
      }));
      const id = booked.appointment.id;
      const at = today.minus({ days: 24 + i }).set({ hour: 12, minute: 30 });
      await prisma.appointment.update({ where: { id }, data: { startsAt: at.toJSDate(), endsAt: at.plus({ minutes: 30 }).toJSDate(), status: 'COMPLETED' } });
      await ok('opinión', patient.post(`/api/patient/appointments/${id}/review`, {
        ratingPunctuality: i === 5 ? 4 : 5, ratingTreatment: 5, ratingFacilities: i % 2 ? 5 : 4, comment,
      }));
    }

    // Paciente con cuenta lista para grabar una reserva en línea (sin citas próximas).
    const patientEmail = 'mariana.lopez@correo.example';
    const patientPassword = randomBytes(12).toString('base64url');
    const reg = await ok('paciente demo', new Client(base).post('/api/patient/auth/register', {
      name: 'Mariana López', email: patientEmail, phone: '55 4127 3381', password: patientPassword,
    }));
    await prisma.patientAccount.update({ where: { id: reg.patient.id }, data: { emailVerifiedAt: new Date() } });

    const dir = join(__dirname, '../../../../../marketing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.demo-credentials.json'), JSON.stringify({
      clinicSlug: SLUG, email: OWNER_EMAIL, password, patient: { email: patientEmail, password: patientPassword },
    }, null, 2), { mode: 0o600 });
    console.log(`Clínica demo lista: ${DOCTORS.length} médicos, ${patientIds.length} pacientes, ${future} citas próximas, ${past} en el historial, ${COMMENTS.length} opiniones.`);
    console.log('Credenciales en marketing/.demo-credentials.json');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
