import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSlots, fitsWeeklySchedule, localInstant, parseLocalDate } from '../../src/scheduling/availability';

const TZ = 'America/Mexico_City'; // UTC-6 sin horario de verano
const PAST = new Date('2000-01-01T00:00:00Z');
const FAR = new Date('2100-01-01T00:00:00Z');
// 2026-10-19 es lunes.
const MONDAY = '2026-10-19';

test('genera horarios por bloque y duración en hora local', () => {
  const [day] = computeSlots({
    timezone: TZ, rules: [{ weekday: 1, startMinute: 540, endMinute: 660 }], durationMinutes: 30,
    busy: [], fromDate: MONDAY, days: 1, earliest: PAST, latest: FAR,
  });
  assert.equal(day.date, MONDAY);
  assert.deepEqual(day.slots.map((s) => s.time), ['09:00', '09:30', '10:00', '10:30']);
  assert.equal(day.slots[0].startsAt, '2026-10-19T15:00:00.000Z');
});

test('no genera un horario que no cabe completo en el bloque', () => {
  const [day] = computeSlots({
    timezone: TZ, rules: [{ weekday: 1, startMinute: 540, endMinute: 625 }], durationMinutes: 40,
    busy: [], fromDate: MONDAY, days: 1, earliest: PAST, latest: FAR,
  });
  assert.deepEqual(day.slots.map((s) => s.time), ['09:00', '09:40']);
});

test('excluye horarios ocupados, anticipación mínima y horizonte', () => {
  const rules = [{ weekday: 1, startMinute: 540, endMinute: 720 }];
  const busy = [{ start: new Date('2026-10-19T15:45:00Z'), end: new Date('2026-10-19T16:15:00Z') }];
  const [day] = computeSlots({
    timezone: TZ, rules, durationMinutes: 30, busy, fromDate: MONDAY, days: 1,
    earliest: new Date('2026-10-19T15:30:00Z'), latest: new Date('2026-10-19T17:00:00Z'),
  });
  // 09:00 antes de la anticipación; 09:30-10:00 y 10:00-10:30 chocan con 09:45-10:15; 11:30 después del horizonte.
  assert.deepEqual(day.slots.map((s) => s.time), ['10:30', '11:00']);
});

test('respeta el día de la semana ISO y varios días', () => {
  const result = computeSlots({
    timezone: TZ, rules: [{ weekday: 7, startMinute: 600, endMinute: 630 }], durationMinutes: 30,
    busy: [], fromDate: MONDAY, days: 7, earliest: PAST, latest: FAR,
  });
  assert.equal(result.length, 7);
  const withSlots = result.filter((d) => d.slots.length);
  assert.deepEqual(withSlots.map((d) => d.date), ['2026-10-25']);
});

test('omite horas locales inexistentes por horario de verano', () => {
  const ny = 'America/New_York'; // 2026-03-08 02:00 no existe
  const day = parseLocalDate('2026-03-08', ny)!;
  assert.equal(localInstant(day, 120), null);
  const [d] = computeSlots({
    timezone: ny, rules: [{ weekday: 7, startMinute: 60, endMinute: 240 }], durationMinutes: 60,
    busy: [], fromDate: '2026-03-08', days: 1, earliest: PAST, latest: FAR,
  });
  assert.deepEqual(d.slots.map((s) => s.time), ['01:00', '03:00']);
});

test('fecha inválida no genera horarios', () => {
  assert.deepEqual(computeSlots({
    timezone: TZ, rules: [], durationMinutes: 30, busy: [], fromDate: '2026-02-30', days: 1, earliest: PAST, latest: FAR,
  }), []);
});

test('fitsWeeklySchedule valida citas del personal', () => {
  const rules = [{ weekday: 1, startMinute: 540, endMinute: 600 }];
  assert.equal(fitsWeeklySchedule(new Date('2026-10-19T15:10:00Z'), 30, TZ, rules), true);
  assert.equal(fitsWeeklySchedule(new Date('2026-10-19T15:40:00Z'), 30, TZ, rules), false);
  assert.equal(fitsWeeklySchedule(new Date('2026-10-20T15:10:00Z'), 30, TZ, rules), false);
});
