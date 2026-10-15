'use client';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Kind = 'staff' | 'patient';
const REFRESH: Record<Kind, string> = { staff: '/api/auth/refresh', patient: '/api/patient/auth/refresh' };

/**
 * Sesión en memoria: el token de acceso nunca se guarda en localStorage.
 * El refresh vive en una cookie HttpOnly con ruta restringida.
 */
export class Session<T = unknown> {
  token: string | null = null;
  data: T | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly kind: Kind) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  set(payload: { accessToken: string } & T) {
    this.token = payload.accessToken;
    this.data = payload;
    this.listeners.forEach((l) => l());
  }

  clear() {
    this.token = null;
    this.data = null;
    this.listeners.forEach((l) => l());
  }

  /** Intenta restaurar la sesión desde la cookie de refresh (una sola petición a la vez). */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const res = await fetch(REFRESH[this.kind], { method: 'POST', credentials: 'same-origin' });
        if (!res.ok) { this.clear(); return false; }
        this.set(await res.json());
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => { this.refreshing = null; }, 0);
      }
    })();
    return this.refreshing;
  }

  async request<R = any>(method: string, path: string, body?: unknown, retry = true): Promise<R> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(path, {
        method, headers, credentials: 'same-origin', cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Sin conexión. Revisa tu red e inténtalo de nuevo.');
    }
    if (res.status === 401 && retry && !path.includes('/auth/')) {
      if (await this.refresh()) return this.request(method, path, body, false);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = json && typeof json.message === 'string' ? json.message : `Error ${res.status}`;
      throw new ApiError(res.status, res.status === 500 ? 'Ocurrió un error inesperado.' : msg);
    }
    return json as R;
  }

  get = <R = any>(p: string) => this.request<R>('GET', p);
  post = <R = any>(p: string, b: unknown = {}) => this.request<R>('POST', p, b);
  patch = <R = any>(p: string, b: unknown) => this.request<R>('PATCH', p, b);
  put = <R = any>(p: string, b: unknown) => this.request<R>('PUT', p, b);
  del = <R = any>(p: string) => this.request<R>('DELETE', p);
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return null; }
}

export interface StaffSessionData {
  user: { id: string; name: string; email: string };
  membership: { id: string; role: 'OWNER' | 'ADMIN' | 'RECEPTION' | 'DOCTOR'; doctorId: string | null };
  clinic: { id: string; name: string; slug: string; timezone: string };
}

export interface PatientSessionData {
  patient: { id: string; name: string; email: string; phone: string };
}

export const staffSession = new Session<StaffSessionData>('staff');
export const patientSession = new Session<PatientSessionData>('patient');

export async function publicGet<R = any>(path: string): Promise<R> {
  return new Session('patient').request<R>('GET', path, undefined, false);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado.';
}
