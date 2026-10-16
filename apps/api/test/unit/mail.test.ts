import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from '../../src/mail/ics';
import { appointmentEmail, formatWhen, verifyEmail } from '../../src/mail/templates';
import { backoffMs } from '../../src/jobs/jobs.service';

test('ics: escapa texto, usa CRLF y pliega líneas a 75 octetos', () => {
  const ics = buildIcs({
    uid: 'abc@medora', sequence: 2, method: 'PUBLISH',
    start: new Date('2026-10-26T15:00:00Z'), end: new Date('2026-10-26T15:30:00Z'),
    summary: 'Consulta; general, con ñandú',
    location: 'Clínica Médica Integral del Valle de México, Av. Insurgentes Sur 1234, piso 5, consultorio 502',
    organizerEmail: 'no-reply@nut.com.mx', organizerName: 'Clínica "A"',
    stamp: new Date('2026-10-15T00:00:00Z'),
  });
  assert.ok(ics.includes('\r\nSUMMARY:Consulta\\; general\\, con ñandú\r\n'));
  assert.ok(ics.includes('DTSTART:20261026T150000Z'));
  assert.ok(ics.includes('SEQUENCE:2'));
  assert.ok(ics.includes('ORGANIZER;CN="Clínica A":mailto:no-reply@nut.com.mx'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(ics.split('\r\n').some((l) => l.startsWith(' ')), 'la dirección larga se pliega');
});

test('plantillas: escapan HTML y formatean fecha y precio en español', () => {
  const v = verifyEmail({ name: '<script>Ana</script>', link: 'https://medora.test/verificar#t' });
  assert.ok(!v.html.includes('<script>Ana'));
  assert.ok(v.html.includes('&lt;script&gt;Ana'));
  assert.equal(formatWhen(new Date('2026-10-26T15:00:00Z'), 'America/Mexico_City'), 'lunes 26 de octubre de 2026 a las 09:00 h');
  const a = appointmentEmail({
    kind: 'CREATED', patientName: 'Ana', clinic: { name: 'C', address: null, phone: null, timezone: 'America/Mexico_City' },
    doctorName: 'Dr. X', serviceName: 'Consulta', startsAt: new Date('2026-10-26T15:00:00Z'), priceCents: 123450,
  });
  assert.match(a.text, /Precio: \$1,234\.50/);
});

test('reintentos con espera exponencial y tope de una hora', () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(3), 120_000);
  assert.equal(backoffMs(20), 60 * 60_000);
});

test('teléfonos a formato de WhatsApp', async () => {
  const { toWhatsAppNumber } = await import('../../src/notifications/whatsapp.transport');
  assert.equal(toWhatsAppNumber('55 1234 5678', '52'), '525512345678');
  assert.equal(toWhatsAppNumber('(33) 1111-2222', '52'), '523311112222');
  assert.equal(toWhatsAppNumber('+1 415 555 0100', '52'), '14155550100');
  assert.equal(toWhatsAppNumber('52 55 1234 5678', '52'), '525512345678');
  assert.equal(toWhatsAppNumber('1234', '52'), null);
});
