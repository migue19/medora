import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma.service';
import { AppointmentsService, MAX_AVAILABILITY_DAYS } from '../appointments/appointments.service';
import { ReviewsService } from '../reviews/reviews.service';

/** Igual que directory_norm() en la base: minúsculas, sin acentos, espacios simples. */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Igual que directory_slug() en la base. */
export const toSlug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'para', 'y', 'con', 'a', 'un', 'una', 'dr', 'dra', 'doctor', 'doctora', 'medico', 'medica']);
export const PAGE_SIZE = 10;
/** Tope de candidatos que se ordenan en memoria (precio, disponibilidad). */
const MAX_CANDIDATES = 200;
/** Con orden por disponibilidad o filtro «cuándo», se calcula la próxima cita de estos primeros. */
const MAX_AVAILABILITY_SCAN = 60;

export type DirectorySort = 'relevancia' | 'disponibilidad' | 'precio' | 'distancia' | 'calificacion';
export type DirectoryWhen = 'hoy' | 'manana' | 'semana';

export interface DirectoryQuery {
  q?: string; especialidad?: string; padecimiento?: string; ciudad?: string; colonia?: string; aseguradora?: string;
  precioMax?: number; videoconsulta?: boolean; cuando?: DirectoryWhen;
  lat?: number; lng?: number; radioKm?: number; orden?: DirectorySort; pagina?: number;
}

interface CatalogEntry { id: string; slug: string; name: string; synonyms: string[]; keys: string[] }

interface Candidate {
  id: string; clinicId: string; displayName: string; slug: string; specialty: string; licenseNumber: string | null;
  conditions: string[]; insurers: string[]; languages: string[];
  clinicName: string; clinicSlug: string; timezone: string; score: number; explicit: boolean; distanceKm: number | null;
  photoAt: Date | null;
}

interface NextSlots { date: string; slots: { startsAt: string; time: string; locationId?: string }[] }

/** Directorio público: médicos de clínicas que activaron su participación, con búsqueda y próxima cita. */
@Injectable()
export class DirectoryService {
  private catalog: { at: number; specialties: CatalogEntry[]; conditions: CatalogEntry[] } | null = null;
  private nextCache = new Map<string, { at: number; value: NextSlots | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    private readonly reviews: ReviewsService,
  ) {}

  clearCache() {
    this.nextCache.clear();
  }

  /** Catálogo de especialidades y padecimientos (cambia sólo con migraciones: caché de 10 min). */
  async loadCatalog() {
    if (this.catalog && Date.now() - this.catalog.at < 10 * 60_000) return this.catalog;
    const entry = (r: { id: string; slug: string; name: string; synonyms: string[] }): CatalogEntry => ({
      ...r, keys: [r.name, ...r.synonyms].map(norm),
    });
    const [specialties, conditions] = await Promise.all([
      this.prisma.specialty.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.condition.findMany({ orderBy: { name: 'asc' } }),
    ]);
    this.catalog = { at: Date.now(), specialties: specialties.map(entry), conditions: conditions.map(entry) };
    return this.catalog;
  }

  /** Sugerencias para el buscador: especialidades y padecimientos que empiezan o contienen el texto. */
  async suggest(q: string) {
    const text = norm(q);
    if (text.length < 2) return { specialties: [], conditions: [] };
    const { specialties, conditions } = await this.loadCatalog();
    const rank = (e: CatalogEntry) => {
      if (e.keys.some((k) => k === text)) return 0;
      if (e.keys.some((k) => k.startsWith(text))) return 1;
      if (e.keys.some((k) => k.split(' ').some((w) => w.startsWith(text)))) return 2;
      return 9;
    };
    const pick = (list: CatalogEntry[]) => list.map((e) => ({ e, r: rank(e) })).filter((x) => x.r < 9)
      .sort((a, b) => a.r - b.r || a.e.name.localeCompare(b.e.name, 'es')).slice(0, 6).map(({ e }) => ({ slug: e.slug, name: e.name }));
    return { specialties: pick(specialties), conditions: pick(conditions) };
  }

  /** Un texto que es exactamente una especialidad o un padecimiento se busca como tal. */
  private async resolveText(q: string) {
    const text = norm(q);
    const { specialties, conditions } = await this.loadCatalog();
    const specialty = specialties.find((e) => e.keys.includes(text));
    if (specialty) return { specialty, condition: undefined };
    const condition = conditions.find((e) => e.keys.includes(text));
    return { specialty: undefined, condition };
  }

  /** Especialidades y ciudades con médicos en el directorio (portada, filtros, páginas por especialidad y mapa del sitio). */
  async overview() {
    const eligible = this.eligibleSql();
    const [specialties, cities] = await Promise.all([
      this.prisma.$queryRaw<{ slug: string; name: string; doctors: number }[]>`
        SELECT s.slug, s.name, count(*)::int AS doctors FROM "Doctor" d JOIN "Clinic" c ON c.id = d."clinicId"
        JOIN "Specialty" s ON s.id = d."specialtyId" WHERE ${eligible} GROUP BY s.slug, s.name ORDER BY count(*) DESC, s.name`,
      this.prisma.$queryRaw<{ slug: string; name: string; doctors: number }[]>`
        SELECT directory_slug(l.city) AS slug, mode() WITHIN GROUP (ORDER BY l.city) AS name, count(DISTINCT d.id)::int AS doctors
        FROM "Doctor" d JOIN "Clinic" c ON c.id = d."clinicId"
        JOIN "ScheduleRule" r ON r."doctorId" = d.id JOIN "Location" l ON l.id = r."locationId" AND l.active
        WHERE ${eligible} AND l.city IS NOT NULL AND directory_slug(l.city) <> ''
        GROUP BY directory_slug(l.city) ORDER BY count(DISTINCT d.id) DESC, 2`,
    ]);
    const combos = await this.prisma.$queryRaw<{ specialty: string; city: string; updatedAt: Date }[]>`
      SELECT DISTINCT s.slug AS specialty, directory_slug(l.city) AS city, max(d."updatedAt") AS "updatedAt"
      FROM "Doctor" d JOIN "Clinic" c ON c.id = d."clinicId" JOIN "Specialty" s ON s.id = d."specialtyId"
      JOIN "ScheduleRule" r ON r."doctorId" = d.id JOIN "Location" l ON l.id = r."locationId" AND l.active
      WHERE ${eligible} AND l.city IS NOT NULL AND directory_slug(l.city) <> ''
      GROUP BY s.slug, directory_slug(l.city)`;
    return { specialties, cities, combos };
  }

  /** Médico visible en el directorio: clínica participante y con reservas, servicio activo y horario en una sede activa. */
  private eligibleSql() {
    return Prisma.sql`d.active AND c.active AND c."directoryEnabled" AND c."bookingEnabled"
      AND EXISTS (SELECT 1 FROM "DoctorService" ds JOIN "Service" s ON s.id = ds."serviceId" WHERE ds."doctorId" = d.id AND s.active)
      AND EXISTS (SELECT 1 FROM "ScheduleRule" r JOIN "Location" l ON l.id = r."locationId" WHERE r."doctorId" = d.id AND l.active)`;
  }

  async search(query: DirectoryQuery, now = new Date()) {
    const page = Math.max(1, Math.min(query.pagina ?? 1, 50));
    let sort: DirectorySort = query.orden ?? 'relevancia';
    const { specialties, conditions } = await this.loadCatalog();

    let specialty = query.especialidad ? specialties.find((e) => e.slug === query.especialidad) : undefined;
    let condition = query.padecimiento ? conditions.find((e) => e.slug === query.padecimiento) : undefined;
    let words: string[] = [];
    if (query.q && norm(query.q)) {
      const resolved = await this.resolveText(query.q);
      if (resolved.specialty && !specialty) specialty = resolved.specialty;
      else if (resolved.condition && !condition) condition = resolved.condition;
      else words = [...new Set(norm(query.q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 6);
    }
    const geo = query.lat !== undefined && query.lng !== undefined
      ? { lat: query.lat, lng: query.lng, radius: Math.min(Math.max(query.radioKm ?? 10, 1), 100) } : null;
    if (sort === 'distancia' && !geo) sort = 'relevancia';

    const filters: Prisma.Sql[] = [this.eligibleSql()];
    if (query.especialidad && !specialty) filters.push(Prisma.sql`false`);
    if (query.padecimiento && !condition) filters.push(Prisma.sql`false`);
    if (specialty) filters.push(Prisma.sql`d."specialtyId" = ${specialty.id}::uuid`);
    // Un padecimiento lo atienden quienes lo declaran y las especialidades del catálogo que lo tratan.
    if (condition) {
      filters.push(Prisma.sql`(EXISTS (SELECT 1 FROM "DoctorCondition" dc WHERE dc."doctorId" = d.id AND dc."conditionId" = ${condition.id}::uuid)
        OR d."specialtyId" IN (SELECT cs."specialtyId" FROM "ConditionSpecialty" cs WHERE cs."conditionId" = ${condition.id}::uuid))`);
    }
    for (const w of words) {
      // Cada palabra debe aparecer (o parecerse, por errores de dedo) en el médico o en el nombre de la clínica.
      filters.push(Prisma.sql`(d."searchText" LIKE ${`%${w}%`} OR ${w} <% d."searchText" OR directory_norm(c.name) LIKE ${`%${w}%`})`);
    }
    const locFilters: Prisma.Sql[] = [];
    if (query.ciudad) locFilters.push(Prisma.sql`directory_slug(l.city) = ${toSlug(query.ciudad)}`);
    if (query.colonia) locFilters.push(Prisma.sql`directory_slug(l.neighborhood) = ${toSlug(query.colonia)}`);
    if (locFilters.length) {
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM "ScheduleRule" r JOIN "Location" l ON l.id = r."locationId"
        WHERE r."doctorId" = d.id AND l.active AND ${Prisma.join(locFilters, ' AND ')})`);
    }
    if (query.aseguradora && norm(query.aseguradora)) {
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(d.insurers) i WHERE directory_norm(i) LIKE ${`%${norm(query.aseguradora)}%`})`);
    }
    if (query.videoconsulta) {
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM "DoctorService" ds JOIN "Service" s ON s.id = ds."serviceId"
        WHERE ds."doctorId" = d.id AND s.active AND s.telemedicine)`);
    }
    const distance = geo ? Prisma.sql`(SELECT min(6371 * 2 * asin(sqrt(
        power(sin(radians(l.latitude - ${geo.lat}) / 2), 2) +
        cos(radians(${geo.lat})) * cos(radians(l.latitude)) * power(sin(radians(l.longitude - ${geo.lng}) / 2), 2))))
      FROM "ScheduleRule" r JOIN "Location" l ON l.id = r."locationId"
      WHERE r."doctorId" = d.id AND l.active AND l.latitude IS NOT NULL)` : Prisma.sql`NULL::float8`;
    const score = words.length
      ? Prisma.sql`(${Prisma.join(words.map((w) => Prisma.sql`word_similarity(${w}, d."searchText")`), ' + ')})`
      : Prisma.sql`0::float8`;
    const explicit = condition
      ? Prisma.sql`EXISTS (SELECT 1 FROM "DoctorCondition" dc WHERE dc."doctorId" = d.id AND dc."conditionId" = ${condition.id}::uuid)`
      : Prisma.sql`false`;

    const rows = await this.prisma.$queryRaw<Candidate[]>`
      SELECT * FROM (
        SELECT d.id, d."clinicId", d."displayName", d.slug, d.specialty, d."licenseNumber", d.conditions, d.insurers, d.languages,
          c.name AS "clinicName", c.slug AS "clinicSlug", c.timezone,
          ${score} AS score, ${explicit} AS explicit, ${distance} AS "distanceKm",
          (SELECT p."updatedAt" FROM "DoctorPhoto" p WHERE p."doctorId" = d.id) AS "photoAt"
        FROM "Doctor" d JOIN "Clinic" c ON c.id = d."clinicId"
        WHERE ${Prisma.join(filters, ' AND ')}
      ) x
      ${geo ? Prisma.sql`WHERE x."distanceKm" <= ${geo.radius}` : Prisma.empty}
      ORDER BY x.explicit DESC, x.score DESC, x."displayName"
      LIMIT ${MAX_CANDIDATES}`;

    const details = await this.details(rows);
    let list = rows.map((r) => ({ r, ...details.get(r.id)! })).filter((x) => x.service);
    if (query.precioMax !== undefined) list = list.filter((x) => x.priceFromCents <= query.precioMax!);
    const ratings = await this.reviews.summaries(list.map((x) => x.r.id));

    // Próxima cita: para toda la lista si se ordena o filtra por ella; si no, sólo para la página.
    const needsAll = sort === 'disponibilidad' || query.cuando !== undefined;
    let next = new Map<string, NextSlots | null>();
    if (needsAll) {
      list = list.slice(0, MAX_AVAILABILITY_SCAN);
      next = await this.nextFor(list.map((x) => ({ doctor: x.r, serviceId: x.service!.id })), now);
      if (query.cuando) {
        list = list.filter((x) => {
          const n = next.get(x.r.id);
          if (!n) return false;
          const today = DateTime.fromJSDate(now, { zone: x.r.timezone }).startOf('day');
          const limit = today.plus({ days: query.cuando === 'hoy' ? 1 : query.cuando === 'manana' ? 2 : 7 });
          return DateTime.fromISO(n.date, { zone: x.r.timezone }) < limit;
        });
      }
    }

    const rating = (id: string) => ratings.get(id);
    const byName = (a: (typeof list)[number], b: (typeof list)[number]) => a.r.displayName.localeCompare(b.r.displayName, 'es');
    const firstSlot = (id: string) => next.get(id)?.slots[0]?.startsAt ?? '9999';
    list.sort((a, b) => {
      switch (sort) {
        case 'precio': return a.priceFromCents - b.priceFromCents || byName(a, b);
        case 'distancia': return (a.r.distanceKm ?? 1e9) - (b.r.distanceKm ?? 1e9) || byName(a, b);
        case 'calificacion': return (rating(b.r.id)?.average ?? 0) - (rating(a.r.id)?.average ?? 0)
          || (rating(b.r.id)?.count ?? 0) - (rating(a.r.id)?.count ?? 0) || byName(a, b);
        case 'disponibilidad': return firstSlot(a.r.id).localeCompare(firstSlot(b.r.id)) || byName(a, b);
        default: return 0; // ya vienen por relevancia
      }
    });

    const total = list.length;
    const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!needsAll) next = await this.nextFor(pageItems.map((x) => ({ doctor: x.r, serviceId: x.service!.id })), now);

    return {
      total, page, pageSize: PAGE_SIZE, sort,
      resolved: {
        specialty: specialty ? { slug: specialty.slug, name: specialty.name } : null,
        condition: condition ? { slug: condition.slug, name: condition.name } : null,
      },
      results: pageItems.map(({ r, service, locations, priceFromCents, telemedicine }) => ({
        doctor: {
          id: r.id, displayName: r.displayName, slug: r.slug, specialty: r.specialty, licenseNumber: r.licenseNumber,
          photoUrl: r.photoAt ? `/api/public/doctors/${r.id}/photo?v=${new Date(r.photoAt).getTime()}` : null,
          conditions: r.conditions.slice(0, 6), insurers: r.insurers, languages: r.languages,
        },
        clinic: { name: r.clinicName, slug: r.clinicSlug, timezone: r.timezone },
        rating: rating(r.id) ?? null,
        distanceKm: r.distanceKm === null ? null : Math.round(r.distanceKm * 10) / 10,
        locations, priceFromCents, telemedicine,
        service: service!,
        next: next.get(r.id) ?? null,
      })),
    };
  }

  /** Sedes, servicio principal, precio «desde» y videoconsulta de cada candidato (pocas consultas para toda la lista). */
  private async details(rows: Candidate[]) {
    const ids = rows.map((r) => r.id);
    const [links, rules, prices] = await Promise.all([
      this.prisma.doctorService.findMany({ where: { doctorId: { in: ids }, service: { active: true } }, include: { service: true } }),
      this.prisma.scheduleRule.findMany({ where: { doctorId: { in: ids }, location: { active: true } }, include: { location: true } }),
      this.prisma.servicePrice.findMany({
        where: { service: { active: true, doctors: { some: { doctorId: { in: ids } } } } },
      }),
    ]);
    const result = new Map<string, {
      service: { id: string; name: string; durationMinutes: number; visitType: string; priceCents: number } | null;
      locations: { id: string; name: string; address: string | null; neighborhood: string | null; city: string | null }[];
      priceFromCents: number; telemedicine: boolean;
    }>();
    for (const r of rows) {
      const locs = [...new Map(rules.filter((x) => x.doctorId === r.id).map((x) => [x.location.id, x.location])).values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'));
      const services = links.filter((l) => l.doctorId === r.id).map((l) => l.service);
      // Precio resuelto como en la reserva: médico+sede > médico > sede > base.
      const priceAt = (s: { id: string; priceCents: number }, locationId: string) => {
        const rank = (o: { doctorId: string | null; locationId: string | null }) =>
          o.doctorId === r.id && o.locationId === locationId ? 3 : o.doctorId === r.id && !o.locationId ? 2 : !o.doctorId && o.locationId === locationId ? 1 : 0;
        const best = prices.filter((p) => p.serviceId === s.id && rank(p) > 0).sort((a, b) => rank(b) - rank(a))[0];
        return best?.priceCents ?? s.priceCents;
      };
      const priced = services.map((s) => ({ s, price: Math.min(...locs.map((l) => priceAt(s, l.id))) }));
      // Servicio para «próxima cita»: el de primera vez o general más económico, luego el más corto.
      const main = [...priced].sort((a, b) =>
        Number(a.s.visitType === 'FOLLOW_UP') - Number(b.s.visitType === 'FOLLOW_UP') || a.price - b.price
        || a.s.durationMinutes - b.s.durationMinutes || a.s.name.localeCompare(b.s.name, 'es'))[0];
      result.set(r.id, {
        service: main ? { id: main.s.id, name: main.s.name, durationMinutes: main.s.durationMinutes, visitType: main.s.visitType, priceCents: main.price } : null,
        locations: locs.map((l) => ({ id: l.id, name: l.name, address: l.address, neighborhood: l.neighborhood, city: l.city })),
        priceFromCents: main?.price ?? 0,
        telemedicine: services.some((s) => s.telemedicine),
      });
    }
    return result;
  }

  /** Primer día con horarios (hasta 4) en las próximas dos semanas. Caché de 1 min por médico y servicio. */
  private async nextFor(items: { doctor: Candidate; serviceId: string }[], now: Date) {
    const out = new Map<string, NextSlots | null>();
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        out.set(item.doctor.id, await this.nextSlots(item.doctor, item.serviceId, now));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out;
  }

  private async nextSlots(doctor: Candidate, serviceId: string, now: Date): Promise<NextSlots | null> {
    const key = `${doctor.id}:${serviceId}`;
    const cached = this.nextCache.get(key);
    if (cached && now.getTime() - cached.at < 60_000 && now.getTime() >= cached.at) return cached.value;
    const from = DateTime.fromJSDate(now, { zone: doctor.timezone }).toISODate()!;
    const { days } = await this.appointments.availability({
      clinicId: doctor.clinicId, doctorId: doctor.id, serviceId, from, days: MAX_AVAILABILITY_DAYS, now,
    });
    const day = days.find((d) => d.slots.length > 0);
    const value = day ? { date: day.date, slots: day.slots.slice(0, 4).map(({ startsAt, time, locationId }) => ({ startsAt, time, locationId })) } : null;
    if (this.nextCache.size > 5000) this.clearCache();
    this.nextCache.set(key, { at: now.getTime(), value });
    return value;
  }
}
