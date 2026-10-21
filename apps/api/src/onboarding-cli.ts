/**
 * Alta de clínicas desde el servidor:
 *   node dist/onboarding-cli.js crear "Clínica del Valle" contacto@clinica.mx
 *   node dist/onboarding-cli.js listar
 *   node dist/onboarding-cli.js ver <id>
 *   node dist/onboarding-cli.js importar <id>
 * En producción: docker compose --profile tools run --rm tools node dist/onboarding-cli.js <comando>
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config';
import { buildAppModule } from './app.module';
import { OnboardingService } from './onboarding/onboarding.service';

const DAY = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  // El comando nunca envía correos por sí mismo: los encola y los manda el trabajador de la API.
  const config = { ...loadConfig(), jobsPollMs: 0 };
  const app = await NestFactory.createApplicationContext(buildAppModule(config), { logger: ['error', 'warn'] });
  const onboarding = app.get(OnboardingService);
  try {
    switch (command) {
      case 'crear': {
        const [label, email] = args;
        if (!label) throw new Error('Uso: crear "<nombre de la clínica>" [correo de contacto]');
        const r = await onboarding.create(label, email ?? null);
        console.log(`Alta creada: ${r.id}\nEnlace para la clínica (privado, vence ${r.expiresAt.toISOString().slice(0, 10)}):\n${r.link}`);
        break;
      }
      case 'listar': {
        const rows = await onboarding.list();
        if (!rows.length) console.log('No hay altas.');
        for (const r of rows) {
          console.log(`${r.id}  ${r.status.padEnd(9)}  ${r.label}${r.contactEmail ? ` <${r.contactEmail}>` : ''}  actualizada ${r.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
        }
        break;
      }
      case 'ver': {
        const { row, data: d, issues } = await onboarding.get(args[0]);
        console.log(`${d.clinic.name || row.label} (${d.clinic.slug || 'sin identificador'}) · ${row.status}`);
        console.log(`Contacto: ${d.contacts.responsibleName} ${d.contacts.responsiblePhone} ${d.contacts.responsibleEmail}`);
        console.log(`\nSedes (${d.locations.length}):`);
        for (const l of d.locations) console.log(`  - ${l.name}: ${l.address} · consultorios: ${l.rooms.join(', ') || 'ninguno'}`);
        console.log(`Equipo (${d.team.length}):`);
        for (const t of d.team) console.log(`  - ${t.name} <${t.email}> ${t.role}`);
        console.log(`Médicos (${d.doctors.length}):`);
        for (const x of d.doctors) {
          const blocks = d.schedules.filter((s) => s.doctorKey === x.key)
            .map((s) => `${DAY[s.weekday - 1]} ${hhmm(s.startMinute)}-${hhmm(s.endMinute)} ${d.locations.find((l) => l.key === s.locationKey)?.name ?? '?'}${s.room ? `/${s.room}` : ''}`);
          console.log(`  - ${x.displayName} · ${x.specialty}\n      ${blocks.join(' · ') || 'sin horario'}`);
        }
        console.log(`Servicios (${d.services.length}):`);
        for (const s of d.services) console.log(`  - ${s.name}: ${s.durationMinutes} min, $${(s.priceCents / 100).toFixed(2)}${s.prices.length ? ` (+${s.prices.length} precios especiales)` : ''}`);
        const blocking = issues.filter((i) => i.required);
        console.log(blocking.length ? `\nPendientes indispensables (${blocking.length}):` : '\nSin pendientes indispensables: se puede importar.');
        for (const i of blocking) console.log(`  - [${i.section}] ${i.message}`);
        break;
      }
      case 'importar': {
        const r = await onboarding.import(args[0]);
        console.log(`Importada: ${r.url}`);
        console.log(Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join(' · '));
        console.log('Las invitaciones y la activación del propietario se envían en los próximos segundos.');
        break;
      }
      default:
        console.log('Comandos: crear "<nombre>" [correo] · listar · ver <id> · importar <id>');
    }
  } catch (e) {
    const issues = (e as { response?: { issues?: { section: string; message: string }[] } }).response?.issues;
    console.error(e instanceof Error ? e.message : e);
    for (const i of issues ?? []) console.error(`  - [${i.section}] ${i.message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
