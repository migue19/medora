import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  Client, Harness, ORIGIN, TZ, createClinicWithOwner, linkToken, loginStaff, nextMonday, resetDb, startHarness,
} from './harness';
import { OnboardingService } from '../../src/onboarding/onboarding.service';

let h: Harness;
let service: OnboardingService;
before(async () => { h = await startHarness(); service = h.app.get(OnboardingService); });
after(async () => { await h.close(); });
beforeEach(async () => {
  await resetDb(h.prisma);
  await h.prisma.$executeRawUnsafe('TRUNCATE "OnboardingPhoto", "ClinicOnboarding" CASCADE');
  h.mail.sent.length = 0;
});

const anon = () => new Client(h.base);
const mon = (s: number, e: number) => ({ weekday: 1, startMinute: s, endMinute: e });

/** Alta completa y válida: dos sedes, dos médicos, consultorios, precios especiales y un bloqueo. */
function fullData() {
  return {
    clinic: { name: 'Clínica del Valle', slug: 'clinica-del-valle', phone: '33 1234 5678', email: 'Contacto@Valle.mx', website: '', instagram: '', googleMaps: '' },
    locations: [
      { key: 'centro', name: 'Sede Centro', address: 'Av. Juárez 100', neighborhood: 'Centro', city: 'Guadalajara', postalCode: '44100', phone: '', mapUrl: 'https://maps.app.goo.gl/x', hours: [mon(480, 1200), { weekday: 3, startMinute: 480, endMinute: 1200 }], rooms: ['Consultorio 1', 'Consultorio 2'] },
      { key: 'norte', name: 'Sede Norte', address: 'Blvd. Norte 2500', neighborhood: '', city: 'Zapopan', postalCode: '', phone: '', mapUrl: '', hours: [{ weekday: 2, startMinute: 540, endMinute: 900 }], rooms: [] },
    ],
    team: [
      { key: 't1', name: 'Laura Dueña', email: 'laura@valle.mx', role: 'OWNER', doctorKey: '' },
      { key: 't2', name: 'Rosa Recepción', email: 'rosa@valle.mx', role: 'RECEPTION', doctorKey: '' },
      { key: 't3', name: 'Ana López', email: 'ana@valle.mx', role: 'DOCTOR', doctorKey: 'ana' },
    ],
    doctors: [
      { key: 'ana', displayName: 'Dra. Ana López', specialty: 'Cardiología', licenseNumber: '1234567', locationKeys: ['centro', 'norte'], bio: 'Cardióloga.', education: ['UNAM'], certifications: [], languages: ['Español', 'Inglés'], conditions: ['Hipertensión'], insurers: ['GNP'] },
      { key: 'beto', displayName: 'Dr. Beto Ruiz', specialty: 'Pediatría', licenseNumber: '', locationKeys: ['centro'], bio: '', education: [], certifications: [], languages: [], conditions: [], insurers: [] },
    ],
    services: [
      { key: 's1', name: 'Consulta', durationMinutes: 30, priceCents: 70000, visitType: 'ANY', doctorKeys: ['ana', 'beto'], prices: [{ doctorKey: 'ana', locationKey: 'norte', priceCents: 90000 }] },
    ],
    schedules: [
      { doctorKey: 'ana', ...mon(540, 660), locationKey: 'centro', room: 'Consultorio 1' },
      { doctorKey: 'ana', weekday: 2, startMinute: 600, endMinute: 720, locationKey: 'norte', room: '' },
      { doctorKey: 'beto', ...mon(540, 660), locationKey: 'centro', room: 'Consultorio 2' },
    ],
    timeOff: [{ doctorKey: 'beto', from: '2027-01-04', to: '2027-01-08', reason: 'Vacaciones' }],
    rules: { bookingEnabled: true, minNoticeMinutes: 60, horizonDays: 60, patientCancelMinMinutes: 120 },
    communication: { reminderOffsets: [1440, 120], reviewsEnabled: true, whatsapp: false, moderator: 'Laura' },
    privacy: { noticeUrl: 'https://valle.mx/privacidad', noticeText: '', officerName: 'Laura Dueña', officerEmail: 'laura@valle.mx', approved: true },
    contacts: { responsibleName: 'Laura Dueña', responsiblePhone: '33 1234 5678', responsibleEmail: 'laura@valle.mx', receptionName: 'Rosa', receptionPhone: '' },
  };
}

async function newLink() {
  const r = await service.create('Clínica del Valle', 'contacto@valle.mx');
  return { id: r.id, token: r.link.split('#')[1] };
}

const required = (issues: { required: boolean; message: string }[]) => issues.filter((i) => i.required).map((i) => i.message);

test('el enlace carga, guarda solo y lista lo que falta; enviar exige lo indispensable', async () => {
  const { token } = await newLink();
  assert.equal((await anon().post('/api/public/onboarding/load', { token: 'x'.repeat(64) })).status, 400);
  assert.equal((await anon().req('POST', '/api/public/onboarding/load', { token }, { origin: 'https://evil.mx' })).status, 403);
  const loaded = await anon().post('/api/public/onboarding/load', { token });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.data.clinic.name, 'Clínica del Valle');
  assert.ok(required(loaded.body.issues).includes('Agrega al menos una sede.'));

  // Borrador a medias: se guarda tal cual, sin campos ajenos.
  const partial = { clinic: { name: 'Clínica del Valle', slug: 'Clinica Del Valle', hacker: true }, locations: [{ key: 'c', name: 'Centro' }] };
  const saved = await anon().put('/api/public/onboarding/save', { token, data: partial });
  assert.equal(saved.status, 200);
  assert.ok(required(saved.body.issues).some((m) => /sólo admite minúsculas/.test(m)));
  assert.ok(required(saved.body.issues).includes('Centro: falta la dirección.'));
  const again = await anon().post('/api/public/onboarding/load', { token });
  assert.equal(again.body.data.clinic.hacker, undefined);
  assert.equal(again.body.data.locations[0].name, 'Centro');

  const early = await anon().post('/api/public/onboarding/submit', { token });
  assert.equal(early.status, 400);
  assert.ok(early.body.issues.length > 5);

  process.env.ONBOARDING_NOTIFY_EMAIL = 'altas@medora.test';
  assert.equal((await anon().put('/api/public/onboarding/save', { token, data: fullData() })).body.issues.filter((i: { required: boolean }) => i.required).length, 0);
  const sent = await anon().post('/api/public/onboarding/submit', { token });
  assert.equal(sent.status, 200);
  delete process.env.ONBOARDING_NOTIFY_EMAIL;
  const [notice] = await h.deliver();
  assert.equal(notice.to, 'altas@medora.test');
  assert.match(notice.subject, /Alta enviada: Clínica del Valle/);
  // Se puede seguir corrigiendo hasta que se importe.
  assert.equal((await anon().put('/api/public/onboarding/save', { token, data: fullData() })).status, 200);
});

test('validaciones cruzadas: identificador usado, consultorio doble, horario fuera de la sede', async () => {
  await createClinicWithOwner(h.prisma, 'clinica-del-valle');
  const { token } = await newLink();
  const d = fullData();
  d.schedules.push({ doctorKey: 'beto', weekday: 1, startMinute: 600, endMinute: 690, locationKey: 'centro', room: 'Consultorio 1' });
  d.schedules.push({ doctorKey: 'ana', weekday: 3, startMinute: 1140, endMinute: 1260, locationKey: 'centro', room: '' });
  d.team.push({ key: 't4', name: 'Otra', email: 'ROSA@valle.mx', role: 'ADMIN', doctorKey: '' });
  const r = await anon().put('/api/public/onboarding/save', { token, data: d });
  const msgs = required(r.body.issues);
  assert.ok(msgs.includes('El identificador «clinica-del-valle» ya lo usa otra clínica.'), msgs.join('\n'));
  assert.ok(msgs.some((m) => /consultorio «Consultorio 1» está asignado a dos médicos el lunes/.test(m)));
  assert.ok(msgs.some((m) => /Dr\. Beto Ruiz: tiene bloques que se traslapan/.test(m)));
  assert.ok(msgs.some((m) => /queda fuera del horario de atención de Sede Centro/.test(m)));
  assert.ok(msgs.includes('El correo rosa@valle.mx aparece dos veces.'));
});

test('fotos de los médicos durante el alta', async () => {
  const { token } = await newLink();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const upload = async (bytes: Buffer) => {
    const form = new FormData();
    form.append('token', token);
    form.append('doctorKey', 'ana');
    form.append('photo', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'foto.png');
    return (await fetch(`${h.base}/api/public/onboarding/photo`, { method: 'POST', body: form, headers: { origin: ORIGIN } })).status;
  };
  assert.equal(await upload(Buffer.from('texto')), 400);
  assert.equal(await upload(png), 201);
  const view = await fetch(`${h.base}/api/public/onboarding/photo/view`, {
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ token, doctorKey: 'ana' }),
  });
  assert.equal(view.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await view.arrayBuffer()), png);
  assert.ok((await anon().post('/api/public/onboarding/load', { token })).body.photos.ana);
  assert.equal((await anon().post('/api/public/onboarding/photo/delete', { token, doctorKey: 'ana' })).status, 204);
  assert.deepEqual((await anon().post('/api/public/onboarding/load', { token })).body.photos, {});
});

test('importar crea la clínica completa, activa al propietario e invita al equipo', async () => {
  const { id, token } = await newLink();
  await anon().put('/api/public/onboarding/save', { token, data: fullData() });
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  await service.savePhoto(token, 'ana', 'image/png', png);

  const r = await service.import(id);
  assert.equal(r.slug, 'clinica-del-valle');
  assert.deepEqual(r.counts, { sedes: 2, consultorios: 2, medicos: 2, servicios: 1, bloques: 3, bloqueos: 1, equipo: 3 });
  await assert.rejects(service.import(id), /ya se importó/);
  assert.equal((await anon().put('/api/public/onboarding/save', { token, data: fullData() })).status, 409);

  // Página pública lista, con sedes, perfil, foto y precios por sede.
  const profile = (await anon().get('/api/public/clinics/clinica-del-valle')).body;
  assert.deepEqual(profile.locations.map((l: { name: string }) => l.name), ['Sede Centro', 'Sede Norte']);
  const ana = profile.doctors.find((x: { slug: string }) => x.slug === 'ana-lopez');
  assert.ok(ana.photoUrl);
  assert.deepEqual(ana.languages, ['Español', 'Inglés']);
  assert.deepEqual(Object.values(ana.services[0].priceByLocation).sort(), [70000, 90000]);
  const monday = nextMonday();
  const slots = (await anon().get(`/api/public/clinics/clinica-del-valle/doctors/${ana.id}/availability?serviceId=${ana.services[0].id}&from=${monday}&days=2`)).body;
  assert.equal(slots.days[0].slots[0].time, '09:00');
  assert.equal(slots.days[1].slots[0].time, '10:00');
  const beto = await h.prisma.doctor.findFirstOrThrow({ where: { slug: 'beto-ruiz' }, include: { timeOffs: true, scheduleRules: { include: { room: true } } } });
  assert.equal(beto.scheduleRules[0].room?.name, 'Consultorio 2');
  assert.equal(DateTime.fromJSDate(beto.timeOffs[0].startsAt, { zone: TZ }).toISO()?.slice(0, 16), '2027-01-04T00:00');
  const clinic = await h.prisma.clinic.findUniqueOrThrow({ where: { slug: 'clinica-del-valle' } });
  assert.deepEqual([clinic.reminderOffsets, clinic.reviewsEnabled, clinic.phone], [[1440, 120], true, '33 1234 5678']);

  // Correos: activación del propietario e invitaciones.
  const mails = await h.deliver();
  const activation = mails.find((m) => m.to === 'laura@valle.mx')!;
  assert.match(activation.subject, /activa tu cuenta/);
  assert.match(activation.text, /\/restablecer\?tipo=personal#/);
  assert.match(activation.text, /identificador de clínica «clinica-del-valle»/);
  assert.equal(mails.filter((m) => /Te invitaron/.test(m.subject)).length, 2);

  // El propietario no puede entrar hasta elegir su contraseña.
  assert.equal((await anon().post('/api/auth/login', { email: 'laura@valle.mx', password: 'cualquier-cosa-1', clinicSlug: 'clinica-del-valle' })).status, 401);
  assert.equal((await anon().post('/api/auth/reset', { token: linkToken(activation), password: 'propietaria-segura-1' })).status, 204);
  const owner = await loginStaff(h.base, 'laura@valle.mx', 'propietaria-segura-1', 'clinica-del-valle');
  assert.equal((await owner.get('/api/me')).body.membership.role, 'OWNER');

  // La médica acepta su invitación y queda vinculada a su perfil.
  const invite = mails.find((m) => m.to === 'ana@valle.mx')!;
  assert.equal((await anon().post('/api/auth/invitations/accept', { token: linkToken(invite), password: 'medica-segura-001' })).status, 200);
  const dra = await loginStaff(h.base, 'ana@valle.mx', 'medica-segura-001', 'clinica-del-valle');
  assert.equal((await dra.get('/api/me')).body.membership.doctorId, ana.id);
});

test('no se importa con pendientes indispensables y un fallo no deja nada a medias', async () => {
  const { id, token } = await newLink();
  const d = fullData();
  d.doctors[1].locationKeys = [];
  await anon().put('/api/public/onboarding/save', { token, data: d });
  await assert.rejects(service.import(id), /pendientes/);
  assert.equal(await h.prisma.clinic.count({ where: { slug: 'clinica-del-valle' } }), 0);

  // Propietario que ya usa Tepahti en otra clínica: entra con su contraseña; no se le cambia.
  const other = await createClinicWithOwner(h.prisma, 'otra-clinica');
  const ok = fullData();
  ok.team[0].email = other.email;
  await anon().put('/api/public/onboarding/save', { token, data: ok });
  await service.import(id);
  const mail = (await h.deliver()).find((m) => m.to === other.email)!;
  assert.match(mail.text, /\/login\?clinica=clinica-del-valle/);
  await loginStaff(h.base, other.email, other.password, 'clinica-del-valle');
});
