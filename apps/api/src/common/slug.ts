import { PrismaService, Tx } from '../prisma.service';

/** «Dra. Ana María López» → «ana-maria-lopez» (sin título, acentos ni signos). Igual que la migración. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(dra?|doctora?)\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 70)
    .replace(/^-+|-+$/g, '');
  return s || 'medico';
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slug libre dentro de la clínica: añade -2, -3… si ya existe. */
export async function uniqueDoctorSlug(tx: Tx | PrismaService, clinicId: string, base: string, excludeId?: string): Promise<string> {
  const taken = new Set(
    (await tx.doctor.findMany({
      where: { clinicId, slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { slug: true },
    })).map((d) => d.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
