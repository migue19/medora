import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, addStaff, createClinicWithOwner, loginStaff, registerPatient, resetDb, startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { await resetDb(h.prisma); });

test('login del personal: origen, credenciales y clínica', async () => {
  const { email, password } = await createClinicWithOwner(h.prisma, 'clinica-a');
  const c = new Client(h.base);
  assert.equal((await c.req('POST', '/api/auth/login', { email, password, clinicSlug: 'clinica-a' }, { origin: 'https://evil.mx' })).status, 403);
  assert.equal((await c.post('/api/auth/login', { email, password: 'incorrecta-123', clinicSlug: 'clinica-a' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email, password, clinicSlug: 'otra-clinica' })).status, 401);
  const ok = await c.post('/api/auth/login', { email, password, clinicSlug: 'clinica-a' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.membership.role, 'OWNER');
  assert.equal(ok.body.passwordHash, undefined);
  assert.match(ok.cookie!, /HttpOnly/);
  assert.match(ok.cookie!, /SameSite=Strict/);
  assert.match(ok.cookie!, /Path=\/api\/auth/);
  c.token = ok.body.accessToken;
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await c.post('/api/auth/login', { email, password, clinicSlug: 'clinica-a', extra: 1 })).status, 400);
});

test('rotación de refresh, detección de reutilización y logout', async () => {
  const { email, password } = await createClinicWithOwner(h.prisma, 'clinica-a');
  const c = await loginStaff(h.base, email, password, 'clinica-a');
  const firstCookie = c.cookies.get('medora_staff_rt')!;
  const r1 = await c.post('/api/auth/refresh');
  assert.equal(r1.status, 200);
  const secondCookie = c.cookies.get('medora_staff_rt')!;
  assert.notEqual(firstCookie, secondCookie);
  c.token = r1.body.accessToken;
  assert.equal((await c.get('/api/me')).status, 200);

  // Reutilizar el token anterior revoca toda la familia, incluidos los JWT emitidos.
  const attacker = new Client(h.base);
  attacker.cookies.set('medora_staff_rt', firstCookie);
  assert.equal((await attacker.post('/api/auth/refresh')).status, 401);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/auth/refresh')).status, 401);

  const c2 = await loginStaff(h.base, email, password, 'clinica-a');
  assert.equal((await c2.req('POST', '/api/auth/logout', {}, { origin: null })).status, 403);
  assert.equal((await c2.post('/api/auth/logout')).status, 204);
  assert.equal((await c2.get('/api/me')).status, 401);
});

test('cambio de contraseña revoca sesiones', async () => {
  const { email, password } = await createClinicWithOwner(h.prisma, 'clinica-a');
  const c = await loginStaff(h.base, email, password, 'clinica-a');
  assert.equal((await c.patch('/api/me/password', { currentPassword: 'mala-123456789', newPassword: 'nueva-contraseña-1' })).status, 401);
  assert.equal((await c.patch('/api/me/password', { currentPassword: password, newPassword: 'nueva-contraseña-1' })).status, 204);
  assert.equal((await c.get('/api/me')).status, 401);
  await loginStaff(h.base, email, 'nueva-contraseña-1', 'clinica-a');
});

test('registro, login y sesión de pacientes separada del personal', async () => {
  const p = await registerPatient(h.base, 'Ana Pérez');
  const me = await p.get('/api/patient/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.name, 'Ana Pérez');
  // El JWT de paciente no sirve para rutas del personal.
  assert.equal((await p.get('/api/me')).status, 401);
  const dup = new Client(h.base);
  const again = await dup.post('/api/patient/auth/register', {
    name: 'Otra', email: me.body.email.toUpperCase(), phone: '5512345678', password: 'paciente-seguro-1',
  });
  assert.equal(again.status, 409);
  assert.equal((await dup.post('/api/patient/auth/register', {
    name: 'Corta', email: 'corta@test.mx', phone: '5512345678', password: 'corta',
  })).status, 400);
  const login = await dup.post('/api/patient/auth/login', { email: me.body.email, password: 'paciente-seguro-1' });
  assert.equal(login.status, 200);
  const refreshed = await dup.post('/api/patient/auth/refresh');
  assert.equal(refreshed.status, 200);
  dup.token = refreshed.body.accessToken;
  assert.equal((await dup.post('/api/patient/auth/logout')).status, 204);
  assert.equal((await dup.get('/api/patient/me')).status, 401);
});

test('jerarquía de roles en el equipo', async () => {
  const { email, password } = await createClinicWithOwner(h.prisma, 'clinica-a');
  const owner = await loginStaff(h.base, email, password, 'clinica-a');
  const admin = await addStaff(h, owner, { name: 'Admin', email: 'admin@test.mx', password: 'administrador-1', role: 'ADMIN' });
  assert.equal((await owner.post('/api/clinic/invitations', { name: 'Dup', email: 'ADMIN@test.mx', role: 'RECEPTION' })).status, 409);
  assert.equal((await owner.post('/api/clinic/invitations', { name: 'Otro dueño', email: 'o2@test.mx', role: 'OWNER' })).status, 403);
  const adminClient = await loginStaff(h.base, 'admin@test.mx', 'administrador-1', 'clinica-a');
  assert.equal((await adminClient.post('/api/clinic/invitations', { name: 'Admin2', email: 'a2@test.mx', role: 'ADMIN' })).status, 403);
  const rec = { body: { id: (await addStaff(h, adminClient, { name: 'Recepción', email: 'rec@test.mx', password: 'recepcionista-1', role: 'RECEPTION' })).membershipId } };
  const recClient = await loginStaff(h.base, 'rec@test.mx', 'recepcionista-1', 'clinica-a');
  assert.equal((await recClient.get('/api/clinic/members')).status, 403);
  assert.equal((await recClient.post('/api/clinic/services', { name: 'X', durationMinutes: 30, priceCents: 0 })).status, 403);
  // Desactivar revoca sus sesiones.
  assert.equal((await adminClient.patch(`/api/clinic/members/${rec.body.id}`, { active: false })).status, 200);
  assert.equal((await recClient.get('/api/clinic')).status, 401);
  assert.equal((await adminClient.patch(`/api/clinic/members/${admin.membershipId}`, { active: false })).status, 403);
});
