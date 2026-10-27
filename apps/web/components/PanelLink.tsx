'use client';
import Link from 'next/link';
import { staffSession } from '@/lib/api';
import { useSession } from '@/lib/hooks';

/** Botón de acceso del personal: con la sesión abierta va directo al panel, sin pasar por el login. */
export function PanelLink({ className = 'btn', children }: { className?: string; children: React.ReactNode }) {
  const { data } = useSession(staffSession);
  return data
    ? <Link className={className} href="/panel">Ir al panel</Link>
    : <Link className={className} href="/login">{children}</Link>;
}
