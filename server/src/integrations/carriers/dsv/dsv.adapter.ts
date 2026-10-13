import { stableHash } from '../../../utils/dates.js';
import type { ShipmentStatus } from '../../../modules/shipments/shipment.rules.js';
import { carrierFetch } from '../http.js';
import { CarrierError, type CarrierAdapter, type CarrierCapabilities, type NormalizedTrackingEvent, type TrackingContext } from '../types.js';

/**
 * DSV Generic Tracking API v2 (https://developer.dsv.com/, "Tracking – Air, Sea, Road (EU), Rail").
 *   Token:  POST {base}/oauth/v1/token   (myDSV username/password, header DSV-Subscription-Key)
 *   Track:  GET  {base}/tracking/v2/shipments/bookingId/{bookingId}
 * Base URLs: https://api.dsv.com/my-demo (demo), https://api.dsv.com/my (production).
 *
 * Tracking only: DSV's Quote API is asynchronous (offers arrive later), so DSV prices
 * stay simulated. The tracking number of a DSV shipment is its DSV booking ID.
 */
export const DSV_PROVIDER = 'dsv-generic-tracking';

/** DSV transport event codes → internal statuses. Unlisted codes are informational. */
const DSV_STATUS: Record<string, ShipmentStatus> = {
  PCF: 'PICKED_UP', PUP: 'PICKED_UP', IRP: 'PICKED_UP',
  DEP: 'IN_TRANSIT', ARV: 'IN_TRANSIT', GIC: 'IN_TRANSIT', GOC: 'IN_TRANSIT', FLO: 'IN_TRANSIT', FUL: 'IN_TRANSIT',
  OFD: 'OUT_FOR_DELIVERY',
  DCF: 'DELIVERED', DLV: 'DELIVERED',
  NDE: 'EXCEPTION', NCE: 'EXCEPTION', Z72: 'EXCEPTION', HPD: 'EXCEPTION',
};

/** Planned dates, not things that happened — never recorded as tracking events. */
const PLANNED_CODES = new Set(['ETA', 'ETD', 'ESTIMATED_DELIVERY', 'ESTIMATED_PICKUP', 'REQUESTED_DELIVERY', 'REQUESTED_PICKUP']);

interface DsvEvent {
  eventDate?: string;
  eventCode?: string;
  eventDescription?: string;
  cancelled?: boolean;
  location?: { countryCode?: string; place?: string };
}

export class DsvAdapter implements CarrierAdapter {
  readonly code = 'DSV' as const;
  readonly name = 'DSV';
  readonly providerId = DSV_PROVIDER;
  readonly capabilities: CarrierCapabilities = { quotes: false, booking: false, tracking: true, cancellation: false };
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly tokenKey: string,
    private readonly trackingKey: string,
    private readonly baseUrl: string,
  ) {}

  get mode() {
    return this.baseUrl.includes('my-demo') ? ('SANDBOX' as const) : ('LIVE' as const);
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }

  /** DSV access tokens last 10 minutes; we simply log in again when one expires. */
  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({ client_id: this.username, client_secret: this.password, grant_type: 'client_credentials' });
    const res = await carrierFetch<{ access_token?: string; expires_in?: number }>(
      'DSV',
      `${this.base}/oauth/v1/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DSV-Subscription-Key': this.tokenKey }, body },
      signal,
    );
    if (!res?.access_token) throw new CarrierError('DSV', 'AUTH', 'DSV did not return an access token');
    this.token = { value: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 600) * 1000 };
    return this.token.value;
  }

  async getQuotes(): Promise<never> {
    throw new CarrierError('DSV', 'UNSUPPORTED', 'DSV quotes are not integrated (the DSV Quote API is asynchronous)');
  }

  async getTracking(ctx: TrackingContext, signal: AbortSignal): Promise<NormalizedTrackingEvent[]> {
    const token = await this.accessToken(signal);
    const res = await carrierFetch<{ bookingId?: string; events?: DsvEvent[] }>(
      'DSV',
      `${this.base}/tracking/v2/shipments/bookingId/${encodeURIComponent(ctx.trackingNumber)}`,
      { headers: { Authorization: `Bearer ${token}`, 'DSV-Subscription-Key': this.trackingKey, Accept: 'application/json' } },
      signal,
    );
    const retrievedAt = new Date().toISOString();
    const sandbox = this.mode === 'SANDBOX';
    return (res?.events ?? [])
      .filter((e) => e.eventDate && !e.cancelled && !PLANNED_CODES.has(e.eventCode ?? ''))
      .map((e) => {
        const code = e.eventCode ?? '';
        const description = e.eventDescription || code || 'Status update';
        // DSV sends offsets like "+0000"; add the colon so every runtime parses them the same way.
        const occurredAt = new Date(e.eventDate!.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();
        return {
          externalEventId: `dsv:${stableHash(`${e.eventDate}|${code}|${description}`).toString(36)}`,
          occurredAt,
          location: { city: e.location?.place, country: e.location?.countryCode },
          description,
          status: DSV_STATUS[code],
          rawStatusCode: code,
          isException: DSV_STATUS[code] === 'EXCEPTION',
          provenance: {
            sourceType: sandbox ? 'SANDBOX_QUOTE' : 'LIVE_QUOTE',
            provider: DSV_PROVIDER,
            retrievedAt,
            isSimulated: false,
            limitations: sandbox ? ['DSV demo environment — test shipments, not real cargo.'] : [],
            externalReference: res?.bookingId,
          },
        } satisfies NormalizedTrackingEvent;
      })
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
