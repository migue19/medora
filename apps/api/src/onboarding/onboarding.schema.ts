/**
 * Formulario de alta de clínica: forma de los datos, limpieza y validación.
 * Al guardar un borrador sólo se limpia (forma y tamaños); al enviar e importar se exige lo indispensable.
 * Las referencias entre secciones usan `key` (identificador corto que genera la página), no nombres.
 */

export const ROLES = ['OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR'] as const;
export const VISIT_TYPES = ['ANY', 'FIRST', 'FOLLOW_UP'] as const;
export const REMINDER_CHOICES = [2880, 1440, 240, 120, 60];

export interface Block { weekday: number; startMinute: number; endMinute: number }

export interface OnboardingData {
  clinic: {
    name: string; slug: string; phone: string; email: string;
    website: string; instagram: string; googleMaps: string;
  };
  locations: {
    key: string; name: string; address: string; neighborhood: string; city: string; postalCode: string;
    phone: string; mapUrl: string; hours: Block[]; rooms: string[];
  }[];
  team: { key: string; name: string; email: string; role: (typeof ROLES)[number]; doctorKey: string }[];
  doctors: {
    key: string; displayName: string; specialty: string; licenseNumber: string; locationKeys: string[]; bio: string;
    education: string[]; certifications: string[]; languages: string[]; conditions: string[]; insurers: string[];
  }[];
  services: {
    key: string; name: string; durationMinutes: number; priceCents: number; visitType: (typeof VISIT_TYPES)[number]; telemedicine: boolean;
    doctorKeys: string[]; prices: { doctorKey: string; locationKey: string; priceCents: number }[];
  }[];
  schedules: { doctorKey: string; weekday: number; startMinute: number; endMinute: number; locationKey: string; room: string }[];
  timeOff: { doctorKey: string; from: string; to: string; reason: string }[];
  rules: { bookingEnabled: boolean; minNoticeMinutes: number; horizonDays: number; patientCancelMinMinutes: number };
  communication: { reminderOffsets: number[]; reviewsEnabled: boolean; whatsapp: boolean; moderator: string };
  privacy: { noticeUrl: string; noticeText: string; officerName: string; officerEmail: string; approved: boolean; directory: boolean };
  contacts: { responsibleName: string; responsiblePhone: string; responsibleEmail: string; receptionName: string; receptionPhone: string };
}

export interface Issue { section: string; message: string; required: boolean }

// ----------------------------------------------------------------- limpieza

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const list = <T>(v: unknown, max: number, map: (x: unknown) => T): T[] => (Array.isArray(v) ? v.slice(0, max).map(map) : []);
const words = (v: unknown, max: number) => list(v, max, (x) => str(x, 120)).filter(Boolean);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const key = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '');
const block = (x: unknown): Block => {
  const b = obj(x);
  return { weekday: int(b.weekday, 1, 7, 1), startMinute: int(b.startMinute, 0, 1440, 540), endMinute: int(b.endMinute, 0, 1440, 840) };
};

/** Deja los datos con la forma esperada (sin campos desconocidos y con tamaños acotados). */
export function clean(raw: unknown): OnboardingData {
  const d = obj(raw);
  const c = obj(d.clinic); const r = obj(d.rules); const m = obj(d.communication); const p = obj(d.privacy); const k = obj(d.contacts);
  return {
    clinic: {
      name: str(c.name, 120), slug: str(c.slug, 60).toLowerCase(), phone: str(c.phone, 30), email: str(c.email, 254).toLowerCase(),
      website: str(c.website, 300), instagram: str(c.instagram, 300), googleMaps: str(c.googleMaps, 500),
    },
    locations: list(d.locations, 10, (x) => {
      const l = obj(x);
      return {
        key: key(l.key), name: str(l.name, 120), address: str(l.address, 240), neighborhood: str(l.neighborhood, 80),
        city: str(l.city, 80), postalCode: str(l.postalCode, 10), phone: str(l.phone, 30), mapUrl: str(l.mapUrl, 500),
        hours: list(l.hours, 42, block), rooms: words(l.rooms, 30).map((r) => r.slice(0, 60)),
      };
    }),
    team: list(d.team, 60, (x) => {
      const t = obj(x);
      return {
        key: key(t.key), name: str(t.name, 120), email: str(t.email, 254).toLowerCase(),
        role: (ROLES as readonly string[]).includes(t.role as string) ? (t.role as OnboardingData['team'][number]['role']) : 'RECEPTION',
        doctorKey: key(t.doctorKey),
      };
    }),
    doctors: list(d.doctors, 50, (x) => {
      const o = obj(x);
      return {
        key: key(o.key), displayName: str(o.displayName, 120), specialty: str(o.specialty, 120), licenseNumber: str(o.licenseNumber, 30),
        locationKeys: list(o.locationKeys, 10, key).filter(Boolean), bio: str(o.bio, 1000),
        education: words(o.education, 20), certifications: words(o.certifications, 20), languages: words(o.languages, 20),
        conditions: words(o.conditions, 40), insurers: words(o.insurers, 40),
      };
    }),
    services: list(d.services, 60, (x) => {
      const s = obj(x);
      return {
        key: key(s.key), name: str(s.name, 120), durationMinutes: int(s.durationMinutes, 0, 480, 30),
        priceCents: int(s.priceCents, 0, 99_999_999, 0),
        visitType: (VISIT_TYPES as readonly string[]).includes(s.visitType as string) ? (s.visitType as OnboardingData['services'][number]['visitType']) : 'ANY',
        telemedicine: bool(s.telemedicine, false),
        doctorKeys: list(s.doctorKeys, 50, key).filter(Boolean),
        prices: list(s.prices, 100, (y) => {
          const q = obj(y);
          return { doctorKey: key(q.doctorKey), locationKey: key(q.locationKey), priceCents: int(q.priceCents, 0, 99_999_999, 0) };
        }),
      };
    }),
    schedules: list(d.schedules, 400, (x) => {
      const s = obj(x);
      return { ...block(s), doctorKey: key(s.doctorKey), locationKey: key(s.locationKey), room: str(s.room, 60) };
    }),
    timeOff: list(d.timeOff, 100, (x) => {
      const t = obj(x);
      const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
      return { doctorKey: key(t.doctorKey), from: date(t.from), to: date(t.to), reason: str(t.reason, 200) };
    }),
    rules: {
      bookingEnabled: bool(r.bookingEnabled, true), minNoticeMinutes: int(r.minNoticeMinutes, 0, 10080, 60),
      horizonDays: int(r.horizonDays, 1, 365, 60), patientCancelMinMinutes: int(r.patientCancelMinMinutes, 0, 10080, 120),
    },
    communication: {
      // Sin elección previa (alta nueva) se sugieren 24 h y 2 h; una lista vacía explícita se respeta.
      reminderOffsets: Array.isArray(m.reminderOffsets)
        ? [...new Set(list(m.reminderOffsets, 5, (x) => int(x, 0, 10080, 0)).filter((x) => REMINDER_CHOICES.includes(x)))].slice(0, 3)
        : [1440, 120],
      reviewsEnabled: bool(m.reviewsEnabled, true), whatsapp: bool(m.whatsapp, false), moderator: str(m.moderator, 120),
    },
    privacy: {
      noticeUrl: str(p.noticeUrl, 500), noticeText: str(p.noticeText, 20000), officerName: str(p.officerName, 120),
      officerEmail: str(p.officerEmail, 254).toLowerCase(), approved: bool(p.approved, false), directory: bool(p.directory, true),
    },
    contacts: {
      responsibleName: str(k.responsibleName, 120), responsiblePhone: str(k.responsiblePhone, 30),
      responsibleEmail: str(k.responsibleEmail, 254).toLowerCase(), receptionName: str(k.receptionName, 120),
      receptionPhone: str(k.receptionPhone, 30),
    },
  };
}

// --------------------------------------------------------------- validación

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{8,20}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Lista de pendientes. `required` = impide enviar e importar; el resto son recomendaciones.
 * `takenSlugs`: identificadores web ya usados por otras clínicas.
 */
export function check(d: OnboardingData, takenSlugs: string[] = []): Issue[] {
  const out: Issue[] = [];
  const need = (section: string, message: string) => out.push({ section, message, required: true });
  const tip = (section: string, message: string) => out.push({ section, message, required: false });

  // 1. Clínica
  if (d.clinic.name.length < 2) need('clinica', 'Escribe el nombre de la clínica.');
  if (!d.clinic.slug) need('clinica', 'Elige el identificador para la dirección web.');
  else if (!SLUG.test(d.clinic.slug) || d.clinic.slug.length < 3) need('clinica', 'El identificador sólo admite minúsculas, números y guiones (mínimo 3).');
  else if (takenSlugs.includes(d.clinic.slug)) need('clinica', `El identificador «${d.clinic.slug}» ya lo usa otra clínica.`);
  if (!PHONE.test(d.clinic.phone)) need('clinica', 'Escribe un teléfono válido de la clínica.');
  if (!EMAIL.test(d.clinic.email)) need('clinica', 'Escribe un correo válido de la clínica.');

  // 2. Sedes
  const locKeys = new Set(d.locations.map((l) => l.key));
  if (!d.locations.length) need('sedes', 'Agrega al menos una sede.');
  const locNames = new Set<string>();
  d.locations.forEach((l, i) => {
    const name = l.name || `Sede ${i + 1}`;
    if (l.name.length < 2) need('sedes', `${name}: falta el nombre.`);
    if (locNames.has(l.name.toLowerCase())) need('sedes', `Hay dos sedes llamadas «${l.name}».`);
    locNames.add(l.name.toLowerCase());
    if (l.address.length < 5) need('sedes', `${name}: falta la dirección.`);
    if (!l.hours.length) need('sedes', `${name}: falta el horario de atención.`);
    if (l.mapUrl && !/^https:\/\/\S+$/.test(l.mapUrl)) need('sedes', `${name}: el enlace del mapa debe empezar con https://`);
    if (l.phone && !PHONE.test(l.phone)) need('sedes', `${name}: el teléfono no es válido.`);
    for (const h of l.hours) {
      if (h.startMinute >= h.endMinute || h.startMinute % 5 || h.endMinute % 5) need('sedes', `${name}: revisa el horario del ${DAY[h.weekday - 1]}.`);
    }
    if (overlaps(l.hours)) need('sedes', `${name}: hay bloques de horario que se traslapan el mismo día.`);
    if (new Set(l.rooms.map((r) => r.toLowerCase())).size !== l.rooms.length) need('sedes', `${name}: hay consultorios repetidos.`);
  });

  // 3. Equipo
  const owners = d.team.filter((t) => t.role === 'OWNER');
  if (owners.length !== 1) need('equipo', 'Indica exactamente un propietario.');
  const emails = new Set<string>();
  d.team.forEach((t, i) => {
    const who = t.name || `Integrante ${i + 1}`;
    if (t.name.length < 2) need('equipo', `${who}: falta el nombre.`);
    if (!EMAIL.test(t.email)) need('equipo', `${who}: el correo no es válido.`);
    else if (emails.has(t.email)) need('equipo', `El correo ${t.email} aparece dos veces.`);
    emails.add(t.email);
    if (t.role === 'DOCTOR' && t.doctorKey && !d.doctors.some((x) => x.key === t.doctorKey)) need('equipo', `${who}: el médico vinculado ya no existe.`);
  });

  // 4. Médicos
  const docKeys = new Set(d.doctors.map((x) => x.key));
  if (!d.doctors.length) need('medicos', 'Agrega al menos un médico.');
  d.doctors.forEach((x, i) => {
    const who = x.displayName || `Médico ${i + 1}`;
    if (x.displayName.length < 2) need('medicos', `${who}: falta el nombre.`);
    if (x.specialty.length < 2) need('medicos', `${who}: falta la especialidad.`);
    if (!x.locationKeys.length) need('medicos', `${who}: indica en qué sedes atiende.`);
    if (x.locationKeys.some((k) => !locKeys.has(k))) need('medicos', `${who}: una de sus sedes ya no existe.`);
    if (!x.bio) tip('medicos', `${who}: una presentación breve ayuda a los pacientes a elegir.`);
    if (!x.licenseNumber) tip('medicos', `${who}: agrega su cédula profesional.`);
  });

  // 5. Servicios
  if (!d.services.length) need('servicios', 'Agrega al menos un servicio.');
  d.services.forEach((s, i) => {
    const what = s.name || `Servicio ${i + 1}`;
    if (s.name.length < 2) need('servicios', `${what}: falta el nombre.`);
    if (s.durationMinutes < 5 || s.durationMinutes % 5) need('servicios', `${what}: la duración debe ser de 5 a 480 minutos, en múltiplos de 5.`);
    if (!s.doctorKeys.length) need('servicios', `${what}: indica qué médicos lo ofrecen.`);
    if (s.doctorKeys.some((k) => !docKeys.has(k))) need('servicios', `${what}: uno de sus médicos ya no existe.`);
    for (const p of s.prices) {
      if (!p.doctorKey && !p.locationKey) need('servicios', `${what}: cada precio especial necesita sede, médico o ambos.`);
      if ((p.doctorKey && !docKeys.has(p.doctorKey)) || (p.locationKey && !locKeys.has(p.locationKey))) need('servicios', `${what}: un precio especial apunta a un médico o sede que ya no existe.`);
    }
    if (new Set(s.prices.map((p) => `${p.doctorKey}|${p.locationKey}`)).size !== s.prices.length) need('servicios', `${what}: hay precios especiales repetidos.`);
  });
  const names = d.services.map((s) => s.name.toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) need('servicios', 'Hay dos servicios con el mismo nombre.');
  d.doctors.forEach((x) => {
    if (x.displayName && !d.services.some((s) => s.doctorKeys.includes(x.key))) need('servicios', `${x.displayName}: no tiene ningún servicio.`);
  });

  // 6. Horarios
  d.doctors.forEach((x) => {
    const mine = d.schedules.filter((s) => s.doctorKey === x.key);
    const who = x.displayName || 'Un médico';
    if (!mine.length) need('horarios', `${who}: falta su horario semanal.`);
    if (overlaps(mine)) need('horarios', `${who}: tiene bloques que se traslapan el mismo día.`);
  });
  d.schedules.forEach((s) => {
    const doctor = d.doctors.find((x) => x.key === s.doctorKey);
    const loc = d.locations.find((l) => l.key === s.locationKey);
    const who = doctor?.displayName || 'Un bloque';
    const when = `${DAY[s.weekday - 1]} ${hhmm(s.startMinute)}–${hhmm(s.endMinute)}`;
    if (!doctor) need('horarios', 'Hay un bloque de horario sin médico.');
    if (!loc) need('horarios', `${who}, ${when}: falta la sede.`);
    if (s.startMinute >= s.endMinute || s.startMinute % 5 || s.endMinute % 5) need('horarios', `${who}, ${when}: revisa las horas (múltiplos de 5 minutos).`);
    if (loc && doctor && !doctor.locationKeys.includes(loc.key)) need('horarios', `${who}, ${when}: no atiende en ${loc.name}.`);
    if (loc?.hours.length && !loc.hours.some((h) => h.weekday === s.weekday && s.startMinute >= h.startMinute && s.endMinute <= h.endMinute)) {
      need('horarios', `${who}, ${when}: queda fuera del horario de atención de ${loc.name}.`);
    }
    if (loc && s.room && !loc.rooms.some((r) => r.toLowerCase() === s.room.toLowerCase())) need('horarios', `${who}, ${when}: el consultorio «${s.room}» no existe en ${loc.name}.`);
  });
  // Un consultorio no puede estar con dos médicos a la misma hora.
  const withRoom = d.schedules.filter((s) => s.room && s.locationKey);
  for (let i = 0; i < withRoom.length; i++) {
    for (let j = i + 1; j < withRoom.length; j++) {
      const a = withRoom[i]; const b = withRoom.at(j)!;
      if (a.locationKey === b.locationKey && a.room.toLowerCase() === b.room.toLowerCase() && a.weekday === b.weekday && a.doctorKey !== b.doctorKey
        && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        need('horarios', `El consultorio «${a.room}» está asignado a dos médicos el ${DAY[a.weekday - 1]} a la misma hora.`);
      }
    }
  }
  d.timeOff.forEach((t) => {
    if (!docKeys.has(t.doctorKey) || !t.from || !t.to || t.from > t.to) need('horarios', 'Revisa un día bloqueado: médico y fechas (desde ≤ hasta).');
  });

  // 7–10
  if (!d.communication.reminderOffsets.length && d.rules.bookingEnabled) tip('comunicacion', 'Sin recordatorios aumentan las inasistencias; sugerimos 24 h y 2 h antes.');
  if (!d.privacy.noticeUrl && !d.privacy.noticeText) need('privacidad', 'Comparte el aviso de privacidad (enlace o texto).');
  if (d.privacy.noticeUrl && !/^https?:\/\/\S+$/.test(d.privacy.noticeUrl)) need('privacidad', 'El enlace del aviso de privacidad no es válido.');
  if (d.privacy.officerName.length < 2 || !EMAIL.test(d.privacy.officerEmail)) need('privacidad', 'Indica el responsable de datos personales (nombre y correo).');
  if (!d.privacy.approved) need('privacidad', 'Falta el visto bueno para publicar la página de la clínica.');
  if (d.contacts.responsibleName.length < 2 || !PHONE.test(d.contacts.responsiblePhone)) need('contactos', 'Indica la persona responsable de la prueba y su teléfono.');
  return out;
}

function overlaps(blocks: Block[]): boolean {
  const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  return sorted.some((b, i) => i > 0 && sorted.at(i - 1)!.weekday === b.weekday && b.startMinute < sorted.at(i - 1)!.endMinute);
}
