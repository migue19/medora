import { PrismaService, Tx } from '../prisma.service';

/**
 * Precio de un servicio para un médico en una sede.
 * Gana el más específico: médico+sede > médico > sede > precio base del servicio.
 */
export async function resolvePrice(
  tx: Tx | PrismaService, service: { id: string; priceCents: number }, doctorId: string, locationId: string,
): Promise<number> {
  return (await pricesFor(tx, service, doctorId, [locationId]))[locationId];
}

/** Precio resuelto en cada sede indicada. */
export async function pricesFor(
  tx: Tx | PrismaService, service: { id: string; priceCents: number }, doctorId: string, locationIds: string[],
): Promise<Record<string, number>> {
  const overrides = await tx.servicePrice.findMany({
    where: {
      serviceId: service.id,
      OR: [{ doctorId }, { doctorId: null }],
    },
  });
  const result: Record<string, number> = {};
  for (const locationId of locationIds) {
    const rank = (o: { doctorId: string | null; locationId: string | null }) =>
      o.doctorId && o.locationId === locationId ? 3 : o.doctorId && !o.locationId ? 2 : !o.doctorId && o.locationId === locationId ? 1 : 0;
    const best = overrides.filter((o) => rank(o) > 0).sort((a, b) => rank(b) - rank(a))[0];
    result[locationId] = best?.priceCents ?? service.priceCents;
  }
  return result;
}
