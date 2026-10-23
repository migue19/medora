/** Datos de timbrado (Facturama, API de un solo emisor: el RFC y el CSD son los de la cuenta). */
export interface InvoicingConfig {
  user: string;
  password: string;
  sandbox: boolean;
  /** Código postal del lugar de expedición (el domicilio fiscal del emisor). */
  expeditionPlace: string;
  series: string;
  /** Retención de ISR de 1.25 % cuando el emisor es RESICO y el receptor persona moral (confirmar con el contador). */
  resicoRetention: boolean;
}

export interface CfdiRequest {
  /** 04 tarjeta de crédito, 28 de débito, 03 transferencia. */
  paymentForm: '03' | '04' | '28';
  receiver: { rfc: string; name: string; cfdiUse: string; fiscalRegime: string; zipCode: string };
  description: string;
  identification: string;
  /** Total cobrado, IVA incluido. */
  totalCents: number;
}

export interface CfdiProvider {
  issue(req: CfdiRequest): Promise<{ id: string; uuid: string | null }>;
  download(id: string, format: 'pdf' | 'xml'): Promise<Buffer>;
}

export const CFDI_PROVIDER = Symbol('CFDI_PROVIDER');

/** Error del PAC por datos inválidos (RFC, régimen, CP…): no se arregla reintentando. */
export class CfdiRejected extends Error {}

const money = (cents: number) => Math.round(cents) / 100;

/** Subtotal e IVA que suman exactamente el total cobrado (precios con IVA incluido). */
export function splitVat(totalCents: number) {
  const guess = Math.round(totalCents / 1.16);
  for (let s = guess - 3; s <= guess + 3; s++) {
    if (s + Math.round(s * 0.16) === totalCents) return { subtotal: s, vat: totalCents - s };
  }
  return { subtotal: guess, vat: totalCents - guess };
}

/** Cuerpo del CFDI 4.0 (ingreso, PUE) en el formato de la API de Facturama. */
export function cfdiBody(req: CfdiRequest, cfg: Pick<InvoicingConfig, 'expeditionPlace' | 'series' | 'resicoRetention'>) {
  const { subtotal, vat } = splitVat(req.totalCents);
  const retainIsr = cfg.resicoRetention && req.receiver.rfc.length === 12;
  const isr = retainIsr ? Math.round(subtotal * 0.0125) : 0;
  const taxes = [
    { Total: money(vat), Name: 'IVA', Base: money(subtotal), Rate: 0.16, IsRetention: false },
    ...(retainIsr ? [{ Total: money(isr), Name: 'ISR', Base: money(subtotal), Rate: 0.0125, IsRetention: true }] : []),
  ];
  return {
    NameId: '1', Serie: cfg.series, CfdiType: 'I', Currency: 'MXN', ExpeditionPlace: cfg.expeditionPlace,
    PaymentForm: req.paymentForm, PaymentMethod: 'PUE', Exportation: '01',
    Receiver: {
      Rfc: req.receiver.rfc, Name: req.receiver.name, CfdiUse: req.receiver.cfdiUse,
      FiscalRegime: req.receiver.fiscalRegime, TaxZipCode: req.receiver.zipCode,
    },
    Items: [{
      // 81112106: Proveedores de servicios de aplicación (software como servicio). E48: unidad de servicio.
      ProductCode: '81112106', IdentificationNumber: req.identification, Description: req.description,
      Unit: 'Servicio', UnitCode: 'E48', UnitPrice: money(subtotal), Quantity: 1, Subtotal: money(subtotal),
      TaxObject: '02', Taxes: taxes, Total: money(subtotal + vat - isr),
    }],
  };
}

export class FacturamaCfdi implements CfdiProvider {
  private readonly base: string;
  private readonly auth: string;

  constructor(private readonly cfg: InvoicingConfig) {
    this.base = cfg.sandbox ? 'https://apisandbox.facturama.mx' : 'https://api.facturama.mx';
    this.auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}`;
  }

  async issue(req: CfdiRequest) {
    const res = await fetch(`${this.base}/3/cfdis`, {
      method: 'POST', headers: { authorization: this.auth, 'content-type': 'application/json' },
      body: JSON.stringify(cfdiBody(req, this.cfg)), signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      Id?: string; Complement?: { TaxStamp?: { Uuid?: string } }; Message?: string; ModelState?: Record<string, string[]>;
    };
    if (!res.ok) {
      const details = [body.Message, ...Object.values(body.ModelState ?? {}).flat()].filter(Boolean).join(' ').slice(0, 450);
      const message = `Facturama ${res.status}: ${details || 'error al timbrar'}`;
      throw res.status >= 400 && res.status < 500 ? new CfdiRejected(message) : new Error(message);
    }
    return { id: body.Id!, uuid: body.Complement?.TaxStamp?.Uuid ?? null };
  }

  async download(id: string, format: 'pdf' | 'xml') {
    const res = await fetch(`${this.base}/cfdi/${format}/issued/${encodeURIComponent(id)}`, {
      headers: { authorization: this.auth }, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Facturama ${res.status} al descargar el ${format.toUpperCase()}`);
    const body = (await res.json()) as { Content: string };
    return Buffer.from(body.Content, 'base64');
  }
}

/** Sin cuenta de Facturama configurada: las facturas quedan pendientes. */
export class DisabledCfdi implements CfdiProvider {
  issue(): Promise<{ id: string; uuid: string | null }> { throw new CfdiRejected('La facturación no está configurada'); }
  download(): Promise<Buffer> { throw new Error('La facturación no está configurada'); }
}

/** PAC simulado para pruebas. */
export class MemoryCfdi implements CfdiProvider {
  issued: { id: string; req: CfdiRequest }[] = [];
  reject: string | null = null;
  async issue(req: CfdiRequest) {
    if (this.reject) throw new CfdiRejected(this.reject);
    const id = `cfdi-${this.issued.length + 1}`;
    this.issued.push({ id, req });
    return { id, uuid: `UUID-${this.issued.length}` };
  }
  async download(id: string, format: 'pdf' | 'xml') {
    return Buffer.from(format === 'pdf' ? `%PDF-1.4 ${id}` : `<cfdi:Comprobante id="${id}"/>`);
  }
}

export function createCfdi(cfg: InvoicingConfig | null): CfdiProvider {
  return cfg ? new FacturamaCfdi(cfg) : new DisabledCfdi();
}
