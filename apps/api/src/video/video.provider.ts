/** Sala de videoconsulta por cita. */
export interface VideoRoom { name: string; url: string }

export interface VideoProvider {
  /** Crea la sala o actualiza su ventana (al reprogramar). */
  ensureRoom(name: string, notBefore: Date, expires: Date): Promise<VideoRoom>;
  /** Pase para una persona: el médico es «owner» (puede silenciar o sacar a alguien). */
  token(room: string, p: { userName: string; owner: boolean; expires: Date }): Promise<string>;
}

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** Daily (daily.co): salas privadas, sólo con pase, con prueba de cámara y micrófono antes de entrar. */
export class DailyVideo implements VideoProvider {
  constructor(private readonly apiKey: string, private readonly base = 'https://api.daily.co/v1') {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    if (res.status >= 400 && res.status !== 404) {
      throw new Error(`Daily ${method} ${path}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { status: res.status, data };
  }

  async ensureRoom(name: string, notBefore: Date, expires: Date): Promise<VideoRoom> {
    const properties = {
      nbf: unix(notBefore), exp: unix(expires), eject_at_room_exp: true, enable_prejoin_ui: true,
      enable_chat: true, enable_screenshare: true, max_participants: 4, lang: 'es',
    };
    const existing = await this.call<{ url: string }>('GET', `/rooms/${name}`);
    const r = existing.status === 404
      ? await this.call<{ url: string; name: string }>('POST', '/rooms', { name, privacy: 'private', properties })
      : await this.call<{ url: string; name: string }>('POST', `/rooms/${name}`, { privacy: 'private', properties });
    return { name, url: r.data.url };
  }

  async token(room: string, p: { userName: string; owner: boolean; expires: Date }): Promise<string> {
    const r = await this.call<{ token: string }>('POST', '/meeting-tokens', {
      properties: {
        room_name: room, user_name: p.userName.slice(0, 60), is_owner: p.owner, exp: unix(p.expires),
        eject_at_token_exp: true, enable_prejoin_ui: true, lang: 'es',
      },
    });
    return r.data.token;
  }
}

/** Sin llave de Daily: la telemedicina no está disponible. */
export class DisabledVideo implements VideoProvider {
  ensureRoom(): Promise<VideoRoom> { throw new Error('Las videoconsultas no están configuradas'); }
  token(): Promise<string> { throw new Error('Las videoconsultas no están configuradas'); }
}

/** Proveedor simulado para pruebas. */
export class MemoryVideo implements VideoProvider {
  rooms = new Map<string, { notBefore: Date; expires: Date }>();
  tokens: { room: string; userName: string; owner: boolean; expires: Date }[] = [];

  async ensureRoom(name: string, notBefore: Date, expires: Date): Promise<VideoRoom> {
    this.rooms.set(name, { notBefore, expires });
    return { name, url: `https://medora.daily.test/${name}` };
  }

  async token(room: string, p: { userName: string; owner: boolean; expires: Date }): Promise<string> {
    this.tokens.push({ room, ...p });
    return `pase-${this.tokens.length}`;
  }
}

export function createVideo(config: { apiKey: string } | null): VideoProvider {
  return config ? new DailyVideo(config.apiKey) : new DisabledVideo();
}
