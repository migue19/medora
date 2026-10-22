/**
 * Seed idempotente: crea la clínica inicial y su propietario si no existen.
 * No cambia contraseñas, nombres ni roles existentes.
 * Con SEED_DEMO_DATA=true agrega un médico, un servicio y un horario de demostración
 * (sólo si la clínica aún no tiene médicos).
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from './common/crypto';

function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim() || fallback;
  if (!v) throw new Error(`Falta la variable ${name}`);
  return v;
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env('DATABASE_URL'), options: '-c TimeZone=UTC' }) });
  try {
    const slug = env('SEED_CLINIC_SLUG');
    const clinicName = env('SEED_CLINIC_NAME');
    const email = env('SEED_OWNER_EMAIL').toLowerCase();
    const ownerName = env('SEED_OWNER_NAME', 'Propietario');
    const password = env('SEED_OWNER_PASSWORD');
    if (password.length < 12) throw new Error('SEED_OWNER_PASSWORD debe tener al menos 12 caracteres');

    const clinic = (await prisma.clinic.findUnique({ where: { slug } }))
      ?? (await prisma.clinic.create({ data: { slug, name: clinicName } }));
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, name: ownerName, passwordHash: await hashPassword(password) } });
    }
    const membership = await prisma.membership.findUnique({
      where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
    });
    if (!membership) {
      await prisma.membership.create({ data: { userId: user.id, clinicId: clinic.id, role: 'OWNER' } });
    }
    console.log(`Clínica «${clinic.name}» (${clinic.slug}) lista. Propietario: ${email}`);

    if (process.env.SEED_DEMO_DATA === 'true') {
      const doctors = await prisma.doctor.count({ where: { clinicId: clinic.id } });
      if (doctors === 0) {
        await prisma.$transaction(async (tx) => {
          const service = await tx.service.upsert({
            where: { clinicId_name: { clinicId: clinic.id, name: 'Consulta general (demo)' } },
            update: {},
            create: { clinicId: clinic.id, name: 'Consulta general (demo)', durationMinutes: 30, priceCents: 50000 },
          });
          const doctor = await tx.doctor.create({
            data: { clinicId: clinic.id, displayName: 'Dra. Demo Medora', slug: 'demo-medora', specialty: 'Medicina general' },
          });
          await tx.doctorService.create({ data: { doctorId: doctor.id, serviceId: service.id, clinicId: clinic.id } });
          const location = (await tx.location.findFirst({ where: { clinicId: clinic.id } }))
            ?? (await tx.location.create({ data: { clinicId: clinic.id, name: 'Sede principal' } }));
          const rules = [1, 2, 3, 4, 5].flatMap((weekday) => [
            { weekday, startMinute: 9 * 60, endMinute: 14 * 60 },
            { weekday, startMinute: 16 * 60, endMinute: 19 * 60 },
          ]);
          await tx.scheduleRule.createMany({
            data: rules.map((r) => ({ ...r, doctorId: doctor.id, clinicId: clinic.id, locationId: location.id })),
          });
        });
        console.log('Datos de demostración creados (médico, servicio y horario L-V).');
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
