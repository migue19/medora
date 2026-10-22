import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, addStaff, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID, registerPatient, resetDb,
  startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-expediente';
let owner: Client;
let ownerCreds: { email: string; password: string };
let doctorId: string;
let otherDoctorId: string;
let ana: Client; // médico tratante
let luis: Client; // otro médico
let rec: Client;
let patientId: string;
let appointmentId: string;

beforeEach(async () => {
  await resetDb(h.prisma);
  await h.prisma.$executeRawUnsafe('TRUNCATE "ClinicalAccessLog", "ClinicalFile", "Prescription", "ClinicalNote", "Allergy", "ClinicalHistoryVersion", "ClinicalProfile" CASCADE');
  const created = await createClinicWithOwner(h.prisma, SLUG);
  ownerCreds = created;
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  const serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana López', specialty: 'Medicina general', licenseNumber: '1234567', serviceIds: [serviceId], education: ['Médico Cirujano, UNAM'] })).body.id;
  otherDoctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dr. Luis Pérez', specialty: 'Pediatría', serviceIds: [serviceId] })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 780 }] });
  const a = await addStaff(h, owner, { name: 'Ana López', email: 'ana@exp.mx', role: 'DOCTOR', password: 'medico-seguro-123' });
  const l = await addStaff(h, owner, { name: 'Luis Pérez', email: 'luis@exp.mx', role: 'DOCTOR', password: 'medico-seguro-123' });
  await addStaff(h, owner, { name: 'Recepción', email: 'rec@exp.mx', role: 'RECEPTION', password: 'recepcion-segura-1' });
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { membershipId: a.membershipId });
  await owner.patch(`/api/clinic/doctors/${otherDoctorId}`, { membershipId: l.membershipId });
  ana = await loginStaff(h.base, 'ana@exp.mx', 'medico-seguro-123', SLUG);
  luis = await loginStaff(h.base, 'luis@exp.mx', 'medico-seguro-123', SLUG);
  rec = await loginStaff(h.base, 'rec@exp.mx', 'recepcion-segura-1', SLUG);
  const patient = await registerPatient(h.base, 'María Fernanda Gómez');
  const booked = await patient.post(`/api/public/clinics/${SLUG}/appointments`, {
    requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(nextMonday(), '09:00'),
  });
  appointmentId = booked.body.appointment.id;
  patientId = booked.body.appointment.clinicPatientId;
});

const rec_ = (c: Client, path = '') => `/api/clinic/patients/${patientId}/record${path}`;

test('acceso: sólo el médico tratante y quien autorice el propietario; los intentos negados quedan en la bitácora', async () => {
  assert.equal((await rec.get(rec_(rec))).status, 403);
  assert.equal((await luis.get(rec_(luis))).status, 403, 'otro médico sin citas con el paciente');
  assert.equal((await owner.get(rec_(owner))).status, 403, 'el propietario no ve expedientes sin autorizarse');
  const first = await ana.get(rec_(ana));
  assert.equal(first.status, 200);
  assert.equal(first.body.canWrite, true);

  // El propietario se autoriza: lee, pero no documenta (no es médico).
  const me = (await owner.get('/api/clinic/members')).body.find((m: { user: { email: string } }) => m.user.email === ownerCreds.email);
  assert.equal((await owner.patch(`/api/clinic/members/${me.id}/clinical-access`, { clinicalAccess: true })).status, 200);
  const asOwner = await owner.get(rec_(owner));
  assert.deepEqual([asOwner.status, asOwner.body.canWrite], [200, false]);
  assert.equal((await owner.post(rec_(owner, '/allergies'), { substance: 'Penicilina', severity: 'GRAVE' })).status, 403);
  const recMember = (await owner.get('/api/clinic/members')).body.find((m: { role: string }) => m.role === 'RECEPTION');
  assert.equal((await owner.patch(`/api/clinic/members/${recMember.id}/clinical-access`, { clinicalAccess: true })).status, 403);
  assert.equal((await ana.patch(`/api/clinic/members/${me.id}/clinical-access`, { clinicalAccess: false })).status, 403);

  const log = (await ana.get(rec_(ana, '/log'))).body as { userName: string; action: string }[];
  const actions = log.map((r) => `${r.userName}:${r.action}`).reverse();
  assert.deepEqual(actions, [
    'Recepción:DENIED', 'Luis Pérez:DENIED', `Dueño ${SLUG}:DENIED`, 'Ana López:VIEW_RECORD', `Dueño ${SLUG}:VIEW_RECORD`, `Dueño ${SLUG}:DENIED`,
  ]);
  const audit = (await owner.get('/api/clinic/clinical-audit?from=2000-01-01&to=2100-01-01')).body;
  assert.equal(audit[0].patient.name, 'María Fernanda Gómez');
  assert.equal((await ana.get('/api/clinic/clinical-audit?from=2000-01-01&to=2100-01-01')).status, 403);
  // La bitácora no se puede alterar ni borrar, ni siquiera directo en la base.
  await assert.rejects(h.prisma.clinicalAccessLog.deleteMany({}), /no se pueden borrar/);
  await assert.rejects(h.prisma.clinicalAccessLog.updateMany({ data: { userName: 'otro' } }), /no se puede modificar/);
});

test('historia clínica, alergias y nota SOAP: firmada ya no cambia; las correcciones van en adenda', async () => {
  assert.equal((await ana.patch(rec_(ana, '/profile'), { curp: 'NO-ES-CURP' })).status, 400);
  const p1 = await ana.patch(rec_(ana, '/profile'), {
    birthDate: '1985-04-12', sex: 'F', curp: 'GOMF850412MDFMRR09', bloodType: 'O+',
    history: { heredofamiliares: 'Madre con diabetes tipo 2', personalesPatologicos: 'Niega', otraCosa: 'se ignora' },
  });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  await ana.patch(rec_(ana, '/profile'), { history: { heredofamiliares: 'Madre con DM2; padre hipertenso' } });
  assert.equal(await h.prisma.clinicalHistoryVersion.count({ where: { clinicPatientId: patientId } }), 2);
  const allergy = (await ana.post(rec_(ana, '/allergies'), { substance: 'Penicilina', reaction: 'Urticaria', severity: 'GRAVE' })).body;
  await ana.patch(rec_(ana, `/allergies/${allergy.id}`), { active: false });

  assert.equal((await ana.post(rec_(ana, '/notes'), { vitals: { systolic: 400 } })).status, 400);
  assert.equal((await ana.post(rec_(ana, '/notes'), { diagnoses: [{ code: 'XYZ', description: 'Mal' }] })).status, 400);
  assert.equal((await ana.post(rec_(ana, '/notes'), { appointmentId: randomUUID() })).status, 400);
  const note = await ana.post(rec_(ana, '/notes'), {
    appointmentId, subjective: 'Cefalea de 3 días', objective: 'Sin datos de alarma',
    vitals: { systolic: 120, diastolic: 80, heartRate: 72, temperature: 36.6, weightKg: 64.5, heightCm: 162 },
    diagnoses: [{ code: 'g44.2', description: 'Cefalea debida a tensión' }],
  });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  assert.deepEqual(note.body.diagnoses, [{ code: 'G44.2', description: 'Cefalea debida a tensión' }]);
  assert.equal((await luis.patch(rec_(luis, `/notes/${note.body.id}`), { plan: 'x' })).status, 403);
  await ana.patch(rec_(ana, `/notes/${note.body.id}`), { assessment: 'Cefalea tensional', plan: 'Analgésico y reposo' });
  assert.equal((await ana.post(rec_(ana, `/notes/${note.body.id}/sign`))).status, 200);
  assert.equal((await ana.patch(rec_(ana, `/notes/${note.body.id}`), { plan: 'Cambio' })).status, 409);
  // Ni directo en la base.
  await assert.rejects(h.prisma.clinicalNote.update({ where: { id: note.body.id }, data: { plan: 'alterado' } }), /firmada/);
  await assert.rejects(h.prisma.clinicalNote.delete({ where: { id: note.body.id } }), /no se pueden borrar/);
  const addendum = await ana.post(rec_(ana, '/notes'), { amendsId: note.body.id, plan: 'Agregar control en 7 días' });
  assert.equal(addendum.status, 201);

  const record = (await ana.get(rec_(ana))).body;
  assert.deepEqual([record.profile.sex, record.profile.history.heredofamiliares, record.profile.history.otraCosa], ['F', 'Madre con DM2; padre hipertenso', undefined]);
  assert.deepEqual(record.allergies.map((a: { substance: string; active: boolean }) => [a.substance, a.active]), [['Penicilina', false]]);
  assert.deepEqual(record.notes.map((n: { amendsId: string | null; doctorName: string }) => [Boolean(n.amendsId), n.doctorName]), [[true, 'Dra. Ana López'], [false, 'Dra. Ana López']]);
  // Ya tratada por la Dra. Ana a través de su nota, el Dr. Luis sigue sin acceso.
  assert.equal((await luis.get(rec_(luis))).status, 403);

  const search = (await ana.get('/api/clinic/icd10?q=diabetes')).body as { code: string }[];
  assert.ok(search.some((d) => d.code === 'E11.9'));
  assert.equal((await ana.get('/api/clinic/icd10?q=I10')).body[0].code, 'I10');
  assert.equal((await rec.get('/api/clinic/icd10?q=I10')).status, 403);
});

test('receta: PDF con código, verificación pública sin datos sensibles y anulación', async () => {
  await ana.post(rec_(ana, '/allergies'), { substance: 'Sulfas', severity: 'MODERADA' });
  const note = (await ana.post(rec_(ana, '/notes'), { subjective: 'Faringitis', vitals: { weightKg: 64, temperature: 38.1 } })).body;
  assert.equal((await ana.post(rec_(ana, '/prescriptions'), { items: [] })).status, 400);
  const rx = await ana.post(rec_(ana, '/prescriptions'), {
    noteId: note.id, diagnosis: 'J02.9 Faringitis aguda',
    items: [{ drug: 'Paracetamol', presentation: 'Tabletas 500 mg', dose: '1 tableta', route: 'oral', frequency: 'cada 8 horas', duration: '3 días', instructions: 'Con alimentos' }],
    instructions: 'Abundantes líquidos.',
  });
  assert.equal(rx.status, 201, JSON.stringify(rx.body));
  assert.match(rx.body.code, /^[A-Z2-9]{10}$/);

  const pdf = await fetch(`${h.base}${rec_(ana, `/prescriptions/${rx.body.id}/pdf`)}`, { headers: { authorization: `Bearer ${ana.token}` } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 3000);

  const verify = await new Client(h.base).get(`/api/public/prescriptions/${rx.body.code.toLowerCase()}`);
  assert.equal(verify.status, 200);
  assert.deepEqual([verify.body.patientInitials, verify.body.doctor.licenseNumber, verify.body.voided, verify.body.items[0].drug], ['M. F. G.', '1234567', false, 'Paracetamol']);
  assert.equal(JSON.stringify(verify.body).includes('Sulfas'), false, 'sin alergias ni diagnóstico en la verificación');
  assert.equal(JSON.stringify(verify.body).includes('Faringitis'), false);
  assert.equal((await new Client(h.base).get('/api/public/prescriptions/NOEXISTE00')).status, 404);

  // Inmutable: sólo se anula (y sólo quien la emitió).
  await assert.rejects(h.prisma.prescription.update({ where: { id: rx.body.id }, data: { instructions: 'otra' } }), /sólo se puede anular/);
  assert.equal((await luis.post(rec_(luis, `/prescriptions/${rx.body.id}/void`), { reason: 'Error' })).status, 403);
  assert.equal((await ana.post(rec_(ana, `/prescriptions/${rx.body.id}/void`), { reason: 'Dosis equivocada' })).status, 200);
  assert.equal((await new Client(h.base).get(`/api/public/prescriptions/${rx.body.code}`)).body.voided, true);
  const actions = ((await ana.get(rec_(ana, '/log'))).body as { action: string }[]).map((r) => r.action);
  for (const a of ['PRESCRIBE', 'PRINT_PRESCRIPTION', 'VOID_PRESCRIPTION']) assert.ok(actions.includes(a), a);
});

test('adjuntos cifrados: se guardan cifrados, se descargan íntegros y queda registro', async () => {
  const content = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('Resultado de laboratorio: glucosa 98 mg/dL')]);
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'application/pdf' }), 'laboratorio.pdf');
  const up = await fetch(`${h.base}${rec_(ana, '/files')}`, { method: 'POST', headers: { authorization: `Bearer ${ana.token}` }, body: form });
  assert.equal(up.status, 201);
  const file = await up.json() as { id: string; size: number };
  const stored = await h.prisma.clinicalFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(Buffer.from(stored.data).includes(Buffer.from('glucosa')), false, 'en la base sólo hay texto cifrado');
  const down = await fetch(`${h.base}${rec_(ana, `/files/${file.id}`)}`, { headers: { authorization: `Bearer ${ana.token}` } });
  assert.deepEqual(Buffer.from(await down.arrayBuffer()), content);
  const bad = new FormData();
  bad.append('file', new Blob([Buffer.from('MZ ejecutable')]), 'virus.exe');
  assert.equal((await fetch(`${h.base}${rec_(ana, '/files')}`, { method: 'POST', headers: { authorization: `Bearer ${ana.token}` }, body: bad })).status, 400);
  assert.equal((await fetch(`${h.base}${rec_(rec, `/files/${file.id}`)}`, { headers: { authorization: `Bearer ${rec.token}` } })).status, 403);
  await assert.rejects(h.prisma.clinicalFile.update({ where: { id: file.id }, data: { filename: 'otro.pdf' } }), /no se puede modificar/);
  const actions = ((await ana.get(rec_(ana, '/log'))).body as { action: string }[]).map((r) => r.action);
  assert.ok(actions.includes('UPLOAD_FILE') && actions.includes('DOWNLOAD_FILE'));
});
