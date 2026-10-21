'use client';
import { useEffect, useState } from 'react';
import { StaffSessionData, staffSession } from '@/lib/api';
import { PatientChooser } from './NewAppointment';
import { PatientProfile } from './PatientProfile';
import type { Doctor } from './shared';

export function Patients({ session }: { session: StaffSessionData }) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { staffSession.get<Doctor[]>('/api/clinic/doctors').then(setDoctors).catch(() => undefined); }, []);

  if (selected) return <PatientProfile session={session} id={selected} doctors={doctors} onBack={() => setSelected(null)} />;
  return (
    <div className="stack">
      <p className="muted">Busca por nombre, teléfono, correo o etiqueta para ver el historial, las notas y agendar. Los pacientes que reservan en línea aparecen aquí automáticamente.</p>
      <div className="card">
        <PatientChooser onChoose={(p) => setSelected(p.id)} />
      </div>
    </div>
  );
}
