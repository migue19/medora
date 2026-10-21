'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { StaffSessionData, staffSession } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { ROLE_LABEL } from '@/lib/format';
import { Agenda } from './Agenda';
import { Patients } from './Patients';
import { Waitlist } from './Waitlist';
import { Doctors } from './Doctors';
import { Services } from './Services';
import { Team } from './Team';
import { ClinicSettings } from './ClinicSettings';
import { Account } from './Account';

type Role = StaffSessionData['membership']['role'];
const TABS: { id: string; label: string; roles: Role[] }[] = [
  { id: 'agenda', label: 'Agenda', roles: ['OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR'] },
  { id: 'patients', label: 'Pacientes', roles: ['OWNER', 'ADMIN', 'RECEPTION'] },
  { id: 'waitlist', label: 'Lista de espera', roles: ['OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR'] },
  { id: 'doctors', label: 'Médicos y horarios', roles: ['OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR'] },
  { id: 'services', label: 'Servicios', roles: ['OWNER', 'ADMIN'] },
  { id: 'team', label: 'Equipo', roles: ['OWNER', 'ADMIN'] },
  { id: 'clinic', label: 'Clínica', roles: ['OWNER', 'ADMIN'] },
  { id: 'account', label: 'Mi cuenta', roles: ['OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR'] },
];

export default function Panel() {
  const router = useRouter();
  const { data: session, ready } = useSession(staffSession);
  const [tab, setTab] = useState('agenda');

  useEffect(() => { if (ready && !session) router.replace('/login'); }, [ready, session, router]);

  if (!session) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);

  const role = session.membership.role;
  const tabs = TABS.filter((t) => t.roles.includes(role));

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    staffSession.clear();
    router.replace('/login');
  }

  return (
    <>
      <Header>
        <span className="small"><strong>{session.clinic.name}</strong> · {session.user.name} <span className="badge">{ROLE_LABEL[role]}</span></span>
        <button className="ghost" onClick={logout}>Salir</button>
      </Header>
      <main className="container section">
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {tab === 'agenda' && <Agenda session={session} />}
        {tab === 'patients' && <Patients session={session} />}
        {tab === 'waitlist' && <Waitlist session={session} />}
        {tab === 'doctors' && <Doctors session={session} />}
        {tab === 'services' && <Services />}
        {tab === 'team' && <Team session={session} />}
        {tab === 'clinic' && <ClinicSettings />}
        {tab === 'account' && <Account />}
      </main>
    </>
  );
}
