/** Evento iCalendar (RFC 5545) para agregar la cita al calendario. */
export interface IcsEvent {
  uid: string;
  /** Se incrementa en cada reprogramación o cancelación para que el calendario actualice el evento. */
  sequence: number;
  method: 'PUBLISH' | 'CANCEL';
  start: Date;
  end: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  organizerEmail: string;
  organizerName: string;
  stamp?: Date;
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tepahti//Citas//ES',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utc(e.stamp ?? new Date())}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SUMMARY:${text(e.summary)}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
    `ORGANIZER;CN=${param(e.organizerName)}:mailto:${e.organizerEmail}`,
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function param(value: string): string {
  return `"${value.replace(/["\r\n]/g, '')}"`;
}

/** Líneas de máximo 75 octetos; las continuaciones empiezan con un espacio. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
