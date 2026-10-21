'use client';
import { FormEvent, useEffect, useState } from 'react';
import { errorMessage, staffSession } from '@/lib/api';
import { Locations } from './Locations';

interface Clinic {
  name: string; slug: string; phone: string | null; address: string | null; timezone: string; bookingEnabled: boolean;
  minNoticeMinutes: number; horizonDays: number; patientCancelMinMinutes: number;
  remindersEnabled: boolean; reminderOffsets: number[]; whatsappEnabled: boolean; whatsappAvailable: boolean;
}

/** Anticipaciones disponibles para los recordatorios (máximo 3). */
const OFFSETS = [
  { minutes: 2880, label: '48 horas antes' },
  { minutes: 1440, label: '24 horas antes' },
  { minutes: 240, label: '4 horas antes' },
  { minutes: 120, label: '2 horas antes' },
  { minutes: 60, label: '1 hora antes' },
];

export function ClinicSettings() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); staffSession.get<Clinic>('/api/clinic').then(setClinic).catch((e) => setMsg({ ok: false, text: errorMessage(e) })); }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setMsg(null);
    try {
      const updated = await staffSession.patch<Clinic>('/api/clinic', {
        name: f.get('name'), phone: f.get('phone'), address: f.get('address'), bookingEnabled: f.get('bookingEnabled') === 'on',
        minNoticeMinutes: Math.round(Number(f.get('minNoticeHours')) * 60),
        horizonDays: Number(f.get('horizonDays')),
        patientCancelMinMinutes: Math.round(Number(f.get('cancelHours')) * 60),
      });
      setClinic(updated);
      setMsg({ ok: true, text: 'Configuración guardada.' });
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }); }
  }

  if (!clinic) return <p className="muted">{msg?.text ?? 'Cargando…'}</p>;
  const link = `${origin}/c/${clinic.slug}`;

  return (
    <div className="stack">
      <div className="card stack">
        <h3>Página de reservas</h3>
        <p className="small">Comparte este enlace con tus pacientes (WhatsApp, redes, Google Maps):</p>
        <div className="row"><code style={{ wordBreak: 'break-all' }}>{link}</code>
          <button onClick={() => navigator.clipboard?.writeText(link)}>Copiar</button>
          <a className="btn" href={`/c/${clinic.slug}`} target="_blank" rel="noreferrer">Abrir</a></div>
      </div>
      <Locations />
      <Reminders clinic={clinic} onSaved={setClinic} />
      <form className="card stack" onSubmit={save}>
        <h3>Datos y reglas de reserva</h3>
        <div className="grid">
          <label>Nombre<input name="name" required minLength={2} maxLength={120} defaultValue={clinic.name} /></label>
          <label>Teléfono<input name="phone" maxLength={30} defaultValue={clinic.phone ?? ''} inputMode="tel" /></label>
          <label>Dirección<input name="address" maxLength={240} defaultValue={clinic.address ?? ''} /></label>
        </div>
        <div className="grid">
          <label>Anticipación mínima para reservar (horas)<input name="minNoticeHours" type="number" min={0} max={168} step={0.5} defaultValue={clinic.minNoticeMinutes / 60} /></label>
          <label>Reservar hasta (días hacia adelante)<input name="horizonDays" type="number" min={1} max={365} defaultValue={clinic.horizonDays} /></label>
          <label>Cancelar/reprogramar en línea hasta (horas antes)<input name="cancelHours" type="number" min={0} max={168} step={0.5} defaultValue={clinic.patientCancelMinMinutes / 60} /></label>
        </div>
        <label className="check"><input type="checkbox" name="bookingEnabled" defaultChecked={clinic.bookingEnabled} />Aceptar reservas en línea</label>
        <p className="muted small">Zona horaria: {clinic.timezone}</p>
        {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
        <div><button className="primary">Guardar</button></div>
      </form>
    </div>
  );
}

function Reminders({ clinic, onSaved }: { clinic: Clinic; onSaved: (c: Clinic) => void }) {
  const [enabled, setEnabled] = useState(clinic.remindersEnabled);
  const [offsets, setOffsets] = useState<number[]>(clinic.reminderOffsets);
  const [whatsapp, setWhatsapp] = useState(clinic.whatsappEnabled);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(minutes: number, on: boolean) {
    setOffsets((list) => (on ? [...list, minutes] : list.filter((m) => m !== minutes)).sort((a, b) => b - a));
  }

  async function save() {
    setMsg(null);
    try {
      const updated = await staffSession.patch<Clinic>('/api/clinic', { remindersEnabled: enabled, reminderOffsets: offsets, whatsappEnabled: whatsapp });
      onSaved(updated);
      setMsg({ ok: true, text: 'Recordatorios guardados. Aplican a las citas que se agenden o reprogramen desde ahora.' });
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }); }
  }

  return (
    <div className="card stack">
      <h3>Recordatorios a pacientes</h3>
      <p className="small muted">Cada recordatorio incluye un enlace para confirmar asistencia o cancelar (dentro del plazo de cancelación en línea). Verás en la agenda quién confirmó.</p>
      <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enviar recordatorios</label>
      <div className="row">
        {OFFSETS.map((o) => (
          <label key={o.minutes} className="check">
            <input type="checkbox" disabled={!enabled || (!offsets.includes(o.minutes) && offsets.length >= 3)}
              checked={offsets.includes(o.minutes)} onChange={(e) => toggle(o.minutes, e.target.checked)} />{o.label}
          </label>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={whatsapp} disabled={!enabled || (!clinic.whatsappAvailable && !whatsapp)} onChange={(e) => setWhatsapp(e.target.checked)} />
        También por WhatsApp (sólo a pacientes que dieron su consentimiento)
      </label>
      {!clinic.whatsappAvailable && <p className="small muted">WhatsApp aún no está conectado en este servidor. Los recordatorios salen por correo.</p>}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div><button className="primary" onClick={save} disabled={enabled && offsets.length === 0}>Guardar recordatorios</button></div>
    </div>
  );
}
