'use client';
import { useState } from 'react';
import { errorMessage, patientSession } from '@/lib/api';

/** Aviso para pacientes con el correo sin confirmar: reenviar el enlace o actualizar tras confirmarlo. */
export function VerifyEmailNotice({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    setBusy(true); setMsg(null);
    try {
      await patientSession.post('/api/patient/me/resend-verification');
      setMsg({ ok: true, text: `Te enviamos un enlace nuevo a ${email}.` });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setMsg(null);
    await patientSession.refresh();
    if (!patientSession.data?.patient.emailVerified) setMsg({ ok: false, text: 'Todavía no vemos tu correo confirmado. Abre el enlace que te enviamos.' });
    setBusy(false);
  }

  return (
    <div className="alert warn stack" role="status">
      <span>Confirma tu correo <strong>{email}</strong> para poder reservar. Busca el mensaje de Medora (revisa también spam).</span>
      <div className="row">
        <button onClick={resend} disabled={busy}>Reenviar enlace</button>
        <button className="ghost" onClick={check} disabled={busy}>Ya lo confirmé</button>
      </div>
      {msg && <span className={msg.ok ? '' : 'small'}>{msg.text}</span>}
    </div>
  );
}
