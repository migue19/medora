export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Propietario', ADMIN: 'Administrador', RECEPTION: 'Recepción', DOCTOR: 'Médico',
};

export const STATUS_LABEL: Record<string, string> = {
  BOOKED: 'Agendada', CANCELLED: 'Cancelada', COMPLETED: 'Atendida', NO_SHOW: 'No asistió',
};

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function money(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
}

export function fmtTime(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDate(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return cap(new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', ...opts,
  }).format(new Date(iso)));
}

/** Fecha YYYY-MM-DD de hoy en la zona horaria indicada. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fecha YYYY-MM-DD como texto legible (sin depender de la zona del navegador). */
export function fmtDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return cap(new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`)));
}

export function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total <= 1440 ? total : null;
}

/** Convierte una fecha y hora locales de una zona horaria a ISO UTC. */
export function zonedToUtcIso(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const target = Date.UTC(y, mo - 1, d, h, mi);
    guess += target - asUtc;
  }
  return new Date(guess).toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** «Lun–Vie 08:00–20:00 · Sáb 09:00–14:00»: agrupa días seguidos con el mismo horario. */
export function weeklyLabel(blocks: { weekday: number; startMinute: number; endMinute: number }[]): string {
  const ranges = (w: number) => blocks.filter((h) => h.weekday === w).sort((a, b) => a.startMinute - b.startMinute)
    .map((h) => `${minutesToHHMM(h.startMinute)}–${minutesToHHMM(h.endMinute)}`).join(', ');
  const days = [...new Set(blocks.map((h) => h.weekday))].sort();
  const groups: { from: number; to: number; text: string }[] = [];
  for (const w of days) {
    const last = groups[groups.length - 1];
    if (last && last.to === w - 1 && last.text === ranges(w)) last.to = w;
    else groups.push({ from: w, to: w, text: ranges(w) });
  }
  const day = (w: number) => WEEKDAYS[w - 1].slice(0, 3);
  return groups.map((g) => `${g.from === g.to ? day(g.from) : `${day(g.from)}–${day(g.to)}`} ${g.text}`).join(' · ');
}
