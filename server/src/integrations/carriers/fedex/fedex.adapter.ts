import { stableHash } from '../../../utils/dates.js';
import type { ServiceLevel, ShipmentStatus } from '../../../modules/shipments/shipment.rules.js';
import { CURRENCY_EXPONENT, SUPPORTED_CURRENCIES, type Currency } from '../../../utils/money.js';
import { carrierFetch } from '../http.js';
import { statusFromDescription } from '../status-mapping.js';
import {
  CarrierError,
  type CarrierAdapter,
  type CarrierCapabilities,
  type NormalizedQuote,
  type NormalizedTrackingEvent,
  type ShipmentRequest,
  type TrackingContext,
} from '../types.js';

/**
 * FedEx REST APIs (https://developer.fedex.com/).
 *   OAuth:  POST {base}/oauth/token  (client_credentials)
 *   Rates:  POST {base}/rate/v1/rates/quotes
 *   Track:  POST {base}/track/v1/trackingnumbers
 * Base URLs: https://apis-sandbox.fedex.com (test), https://apis.fedex.com (production).
 *
 * STATUS: implemented from FedEx's published API documentation and covered by mocked
 * tests; NOT verified against live credentials in this repository. Booking (Ship API)
 * is not implemented — FedEx bookings are recorded manually.
 */
export const FEDEX_PROVIDER = 'fedex-rest';

interface TokenCache {
  token: string;
  expiresAt: number;
}

const TRANSIT_WORDS: Record<string, number> = {
  ONE_DAY: 1, TWO_DAYS: 2, THREE_DAYS: 3, FOUR_DAYS: 4, FIVE_DAYS: 5, SIX_DAYS: 6, SEVEN_DAYS: 7,
  EIGHT_DAYS: 8, NINE_DAYS: 9, TEN_DAYS: 10, ELEVEN_DAYS: 11, TWELVE_DAYS: 12, THIRTEEN_DAYS: 13, FOURTEEN_DAYS: 14,
};

const FEDEX_STATUS: Record<string, ShipmentStatus> = {
  PU: 'PICKED_UP', IT: 'IN_TRANSIT', AR: 'IN_TRANSIT', DP: 'IN_TRANSIT', OD: 'OUT_FOR_DELIVERY', DL: 'DELIVERED',
  DE: 'EXCEPTION', SE: 'EXCEPTION', CA: 'EXCEPTION', DY: 'DELAYED', DD: 'DELAYED',
};

function levelFor(serviceType: string): ServiceLevel {
  if (/ECONOMY|GROUND/i.test(serviceType)) return /GROUND/i.test(serviceType) ? 'STANDARD' : 'ECONOMY';
  if (/PRIORITY|OVERNIGHT|EXPRESS|FIRST/i.test(serviceType)) return 'EXPRESS';
  return 'STANDARD';
}

export class FedexAdapter implements CarrierAdapter {
  readonly code = 'FEDEX' as const;
  readonly name = 'FedEx';
  readonly providerId = FEDEX_PROVIDER;
  readonly capabilities: CarrierCapabilities = { quotes: true, booking: false, tracking: true, cancellation: false };
  private token: TokenCache | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly accountNumber: string | undefined,
    private readonly baseUrl: string,
  ) {}

  get mode() {
    return this.baseUrl.includes('sandbox') ? ('SANDBOX' as const) : ('LIVE' as const);
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.token;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
    const res = await carrierFetch<{ access_token?: string; expires_in?: number }>(
      'FEDEX',
      `${this.base}/oauth/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      signal,
    );
    if (!res?.access_token) throw new CarrierError('FEDEX', 'AUTH', 'FedEx did not return an access token');
    this.token = { token: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 };
    return this.token.token;
  }

  async getQuotes(req: ShipmentRequest, signal: AbortSignal): Promise<NormalizedQuote[]> {
    if (!this.accountNumber) throw new CarrierError('FEDEX', 'NOT_CONFIGURED', 'FEDEX_ACCOUNT_NUMBER is required for rate quotes');
    const token = await this.accessToken(signal);
    const perPackageKg = Math.round((req.actualWeightKg / req.packageCount) * 100) / 100;
    const pkg = {
      weight: { units: 'KG', value: perPackageKg },
      ...(req.lengthCm && req.widthCm && req.heightCm
        ? { dimensions: { length: Math.ceil(req.lengthCm), width: Math.ceil(req.widthCm), height: Math.ceil(req.heightCm), units: 'CM' } }
        : {}),
    };
    const payload = {
      accountNumber: { value: this.accountNumber },
      requestedShipment: {
        shipper: { address: { postalCode: req.origin.postalCode, city: req.origin.city, countryCode: req.origin.country } },
        recipient: { address: { postalCode: req.destination.postalCode, city: req.destination.city, countryCode: req.destination.country } },
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: ['ACCOUNT', 'LIST'],
        shipDateStamp: req.shipDate.toISOString().slice(0, 10),
        requestedPackageLineItems: Array.from({ length: Math.min(req.packageCount, 99) }, () => pkg),
      },
      returnTransitTimes: true,
    };
    const res = await carrierFetch<{
      output?: {
        rateReplyDetails?: {
          serviceType?: string;
          serviceName?: string;
          ratedShipmentDetails?: { rateType?: string; totalNetCharge?: number; currency?: string; shipmentRateDetail?: { currency?: string } }[];
          commit?: { dateDetail?: { dayFormat?: string } };
          operationalDetail?: { transitTime?: string; deliveryDate?: string };
        }[];
      };
    }>(
      'FEDEX',
      `${this.base}/rate/v1/rates/quotes`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' }, body: JSON.stringify(payload) },
      signal,
    );
    const retrievedAt = new Date().toISOString();
    const sandbox = this.mode === 'SANDBOX';
    return (res?.output?.rateReplyDetails ?? []).flatMap((d): NormalizedQuote[] => {
      const rated = d.ratedShipmentDetails?.find((r) => r.rateType === 'ACCOUNT') ?? d.ratedShipmentDetails?.[0];
      const currency = (rated?.currency ?? rated?.shipmentRateDetail?.currency) as Currency | undefined;
      if (rated?.totalNetCharge == null || !currency || !SUPPORTED_CURRENCIES.includes(currency)) return [];
      const eta = d.commit?.dateDetail?.dayFormat ?? d.operationalDetail?.deliveryDate;
      return [
        {
          carrierCode: 'FEDEX',
          carrierName: 'FedEx',
          serviceCode: d.serviceType ?? 'UNKNOWN',
          serviceName: d.serviceName ?? d.serviceType ?? 'FedEx',
          serviceLevel: levelFor(d.serviceType ?? ''),
          currency,
          totalMinor: Math.round(rated.totalNetCharge * 10 ** CURRENCY_EXPONENT[currency]),
          breakdown: [],
          transitDays: d.operationalDetail?.transitTime ? (TRANSIT_WORDS[d.operationalDetail.transitTime] ?? null) : null,
          estimatedDeliveryDate: eta ? new Date(eta).toISOString() : null,
          provenance: {
            sourceType: sandbox ? 'SANDBOX_QUOTE' : rated.rateType === 'ACCOUNT' ? 'CONTRACT_RATE' : 'LIVE_QUOTE',
            provider: FEDEX_PROVIDER,
            retrievedAt,
            isSimulated: false,
            limitations: sandbox ? ['FedEx sandbox — prices are test data, not bookable offers.'] : [],
          },
        },
      ];
    });
  }

  async getTracking(ctx: TrackingContext, signal: AbortSignal): Promise<NormalizedTrackingEvent[]> {
    const token = await this.accessToken(signal);
    const res = await carrierFetch<{
      output?: { completeTrackResults?: { trackResults?: { scanEvents?: { date?: string; eventType?: string; eventDescription?: string; derivedStatusCode?: string; scanLocation?: { city?: string; countryCode?: string } }[] }[] }[] };
    }>(
      'FEDEX',
      `${this.base}/track/v1/trackingnumbers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: ctx.trackingNumber } }] }),
      },
      signal,
    );
    const scans = res?.output?.completeTrackResults?.[0]?.trackResults?.[0]?.scanEvents ?? [];
    const retrievedAt = new Date().toISOString();
    return scans
      .filter((s) => s.date)
      .map((s) => {
        const description = s.eventDescription ?? s.eventType ?? 'Status update';
        const code = s.eventType ?? s.derivedStatusCode ?? '';
        return {
          externalEventId: `fedex:${stableHash(`${s.date}|${code}|${description}`).toString(36)}`,
          occurredAt: new Date(s.date!).toISOString(),
          location: { city: s.scanLocation?.city, country: s.scanLocation?.countryCode },
          description,
          status: FEDEX_STATUS[code] ?? statusFromDescription(description),
          rawStatusCode: code,
          isException: ['DE', 'SE', 'CA'].includes(code),
          provenance: { sourceType: this.mode === 'SANDBOX' ? 'SANDBOX_QUOTE' : 'LIVE_QUOTE', provider: FEDEX_PROVIDER, retrievedAt, isSimulated: false, limitations: [] },
        } satisfies NormalizedTrackingEvent;
      })
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
