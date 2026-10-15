import { DateTime } from 'luxon';

export interface WeeklyRule {
  weekday: number; // 1 = lunes … 7 = domingo
  startMinute: number;
  endMinute: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  timezone: string;
  rules: WeeklyRule[];
  durationMinutes: number;
  busy: Interval[];
  fromDate: string; // YYYY-MM-DD en hora local de la clínica
  days: number;
  earliest: Date; // ahora + anticipación mínima
  latest: Date; // límite del horizonte de reserva
}

export interface DaySlots {
  date: string;
  slots: { startsAt: string; endsAt: string; time: string }[];
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/** Fecha local (YYYY-MM-DD) válida o null. */
export function parseLocalDate(date: string, timezone: string): DateTime | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = DateTime.fromISO(date, { zone: timezone });
  return d.isValid ? d.startOf('day') : null;
}

/**
 * Construye un instante a partir de una fecha local y minutos desde medianoche.
 * Devuelve null si esa hora local no existe (salto por horario de verano).
 */
export function localInstant(day: DateTime, minuteOfDay: number): DateTime | null {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  if (hour >= 24) return null;
  const dt = day.set({ hour, minute, second: 0, millisecond: 0 });
  if (!dt.isValid || dt.hour !== hour || dt.minute !== minute || !dt.hasSame(day, 'day')) return null;
  return dt;
}

/**
 * Genera los horarios disponibles. Cada bloque del horario semanal se divide en
 * intervalos de la duración del servicio, a partir de su hora de inicio.
 */
export function computeSlots(q: SlotQuery): DaySlots[] {
  const first = parseLocalDate(q.fromDate, q.timezone);
  if (!first) return [];
  const busy = q.busy.map((b) => [b.start.getTime(), b.end.getTime()] as const);
  const earliest = q.earliest.getTime();
  const latest = q.latest.getTime();
  const result: DaySlots[] = [];

  for (let i = 0; i < q.days; i++) {
    const day = first.plus({ days: i });
    const rules = q.rules
      .filter((r) => r.weekday === day.weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    const slots: DaySlots['slots'] = [];
    for (const rule of rules) {
      for (let m = rule.startMinute; m + q.durationMinutes <= rule.endMinute; m += q.durationMinutes) {
        const start = localInstant(day, m);
        if (!start) continue;
        const end = start.plus({ minutes: q.durationMinutes });
        const s = start.toMillis();
        const e = end.toMillis();
        if (s < earliest || s > latest) continue;
        if (busy.some(([bs, be]) => overlaps(s, e, bs, be))) continue;
        slots.push({
          startsAt: start.toUTC().toISO()!,
          endsAt: end.toUTC().toISO()!,
          time: start.toFormat('HH:mm'),
        });
      }
    }
    result.push({ date: day.toISODate()!, slots });
  }
  return result;
}

/**
 * Para citas capturadas por el personal: la cita debe caber completa dentro de
 * un bloque del horario semanal del día local de inicio.
 */
export function fitsWeeklySchedule(
  start: Date, durationMinutes: number, timezone: string, rules: WeeklyRule[],
): boolean {
  const local = DateTime.fromJSDate(start, { zone: timezone });
  const minute = local.hour * 60 + local.minute;
  const end = local.plus({ minutes: durationMinutes });
  if (!end.hasSame(local, 'day') && !(end.hour === 0 && end.minute === 0)) return false;
  return rules.some(
    (r) => r.weekday === local.weekday && minute >= r.startMinute && minute + durationMinutes <= r.endMinute,
  );
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}
