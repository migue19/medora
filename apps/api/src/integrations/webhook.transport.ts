import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface WebhookRequest { url: string; headers: Record<string, string>; body: string }
export interface WebhookTransport {
  /** Rechaza URLs que no sean HTTPS públicas. */
  validate(url: string): Promise<void>;
  post(req: WebhookRequest): Promise<{ status: number }>;
}
export const WEBHOOK_TRANSPORT = Symbol('WEBHOOK_TRANSPORT');

/** Direcciones internas (loopback, privadas, link-local, CGNAT, metadatos de la nube): un webhook no puede apuntar ahí. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** La URL debe ser HTTPS y resolver sólo a direcciones públicas (evita que Tepahti llame a su propia red). */
export async function assertPublicHttps(url: string): Promise<void> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('URL inválida'); }
  if (u.protocol !== 'https:') throw new Error('El webhook debe usar https://');
  if (u.username || u.password) throw new Error('La URL no puede llevar usuario ni contraseña');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new Error('No se pudo resolver el dominio del webhook');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error('El webhook no puede apuntar a una dirección interna');
}

export class HttpWebhookTransport implements WebhookTransport {
  validate(url: string) { return assertPublicHttps(url); }

  async post(req: WebhookRequest) {
    await assertPublicHttps(req.url);
    const res = await fetch(req.url, {
      method: 'POST', headers: req.headers, body: req.body, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status };
  }
}

/** Receptor simulado para pruebas. */
export class MemoryWebhooks implements WebhookTransport {
  received: WebhookRequest[] = [];
  respond = 200;
  async validate(url: string) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('El webhook debe usar https://');
    if (isPrivateAddress(u.hostname.replace(/^\[|\]$/g, '')) || u.hostname === 'localhost') throw new Error('El webhook no puede apuntar a una dirección interna');
  }
  async post(req: WebhookRequest) {
    this.received.push(req);
    return { status: this.respond };
  }
}
