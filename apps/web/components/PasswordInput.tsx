'use client';
import { InputHTMLAttributes, useState } from 'react';

/** Campo de contraseña con botón para mostrarla u ocultarla. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="pw-field">
      <input {...props} type={visible ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="pw-toggle" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible} title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVisible((v) => !v)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}
