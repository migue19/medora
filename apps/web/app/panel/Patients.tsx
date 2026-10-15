'use client';
import { useEffect, useState } from 'react';
import { StaffSessionData, staffSession } from '@/lib/api';
import { NewAppointment, PatientChooser } from './NewAppointment';
import type { ClinicPatient, Doctor } from './shared';

export function Patients({ session }: { session: StaffSessionData }) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patient, setPatient] = useState<ClinicPatient | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { staffSession.get<Doctor[]>('/api/clinic/doctors').then(setDoctors).catch(() => undefined); }, []);

  return (
    <div className="stack">
      <p className="muted">Busca o registra pacientes que llaman por teléfono y agenda su cita. Los pacientes que reservan en línea aparecen aquí automáticamente.</p>
      {notice && <div className="alert ok" role="status">{notice}</div>}
      <div className="card">
        {patient ? (
          <NewAppointment session={session} doctors={doctors} patient={patient}
            onClose={(msg) => { setPatient(null); if (msg) setNotice(msg); }} />
        ) : <PatientChooser onChoose={(p) => { setPatient(p); setNotice(null); }} />}
      </div>
    </div>
  );
}
