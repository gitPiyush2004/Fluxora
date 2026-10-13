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
 * UPS REST APIs (https://developer.ups.com/, specs: github.com/UPS-API/api-documentation).
 *   OAuth:  POST {base}/security/v1/oauth/token          (client_credentials, HTTP Basic auth)
 *   Rates:  POST {base}/api/rating/v2409/Shoptimeintransit  (all services + transit times)
 *   Track:  GET  {base}/api/track/v1/details/{trackingNumber}
 * Base URLs: https://wwwcie.ups.com (test), https://onlinetools.ups.com (production).
 *
 * STATUS: implemented from UPS's published OpenAPI specs and covered by mocked tests;
 * NOT verified against live credentials in this repository. Booking (Shipping API) is
 * not implemented — UPS bookings are recorded manually.
 */
export const UPS_PROVIDER = 'ups-rest';

/** UPS service codes → readable names (the rate response only returns the code). */
const SERVICE_NAMES: Record<string, string> = {
  '01': 'Next Day Air', '02': '2nd Day Air', '03': 'Ground', '07': 'Worldwide Express', '08': 'Worldwide Expedited',
  '11': 'Standard', '12': '3 Day Select', '13': 'Next Day Air Saver', '14': 'Next Day Air Early', '54': 'Worldwide Express Plus',
  '59': '2nd Day Air A.M.', '65': 'Worldwide Saver',
};

/** UPS activity status types D, P and X are definite; I (in transit) is refined from the description. */
const UPS_STATUS: Record<string, ShipmentStatus> = { D: 'DELIVERED', P: 'PICKED_UP', X: 'EXCEPTION' };

function levelFor(serviceCode: string): ServiceLevel {
  if (['03', '11'].includes(serviceCode)) return 'STANDARD';
  if (['08', '12'].includes(serviceCode)) return 'ECONOMY';
  return 'EXPRESS';
}

interface UpsRatedShipment {
  Service?: { Code?: string };
  TotalCharges?: { CurrencyCode?: string; MonetaryValue?: string };
  NegotiatedRateCharges?: { TotalCharge?: { CurrencyCode?: string; MonetaryValue?: string } };
  TimeInTransit?: { ServiceSummary?: { EstimatedArrival?: { BusinessDaysInTransit?: string; Arrival?: { Date?: string } } } };
}

interface UpsActivity {
  date?: string;
  time?: string;
  gmtOffset?: string;
  location?: { address?: { city?: string; countryCode?: string } };
  status?: { type?: string; code?: string; description?: string };
}

/** "20210210" + "071356" + "-05:00" → "2021-02-10T07:13:56-05:00" */
function upsTimestamp(date: string, time = '000000', offset = 'Z'): string {
  const t = time.padStart(6, '0');
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}${offset}`;
}

export class UpsAdapter implements CarrierAdapter {
  readonly code = 'UPS' as const;
  readonly name = 'UPS';
  readonly providerId = UPS_PROVIDER;
  readonly capabilities: CarrierCapabilities = { quotes: true, booking: false, tracking: true, cancellation: false };
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly accountNumber: string | undefined,
    private readonly baseUrl: string,
  ) {}

  get mode() {
    return this.baseUrl.includes('wwwcie') ? ('SANDBOX' as const) : ('LIVE' as const);
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }

  /** Headers every UPS API call needs. */
  private async headers(signal: AbortSignal) {
    return {
      Authorization: `Bearer ${await this.accessToken(signal)}`,
      'Content-Type': 'application/json',
      transId: crypto.randomUUID().replace(/-/g, ''),
      transactionSrc: 'fluxora',
    };
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await carrierFetch<{ access_token?: string; expires_in?: string }>(
      'UPS',
      `${this.base}/security/v1/oauth/token`,
      { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' },
      signal,
    );
    if (!res?.access_token) throw new CarrierError('UPS', 'AUTH', 'UPS did not return an access token');
    this.token = { value: res.access_token, expiresAt: Date.now() + Number(res.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async getQuotes(req: ShipmentRequest, signal: AbortSignal): Promise<NormalizedQuote[]> {
    if (!this.accountNumber) throw new CarrierError('UPS', 'NOT_CONFIGURED', 'UPS_ACCOUNT_NUMBER is required for rate quotes');
    const address = (p: ShipmentRequest['origin']) => ({ City: p.city, PostalCode: p.postalCode, CountryCode: p.country });
    const perPackageKg = Math.round((req.actualWeightKg / req.packageCount) * 10) / 10;
    const pkg = {
      PackagingType: { Code: '02' }, // customer-supplied package
      PackageWeight: { UnitOfMeasurement: { Code: 'KGS', Description: 'Kilograms' }, Weight: String(perPackageKg) },
      ...(req.lengthCm && req.widthCm && req.heightCm
        ? { Dimensions: { UnitOfMeasurement: { Code: 'CM', Description: 'Centimeters' }, Length: String(Math.ceil(req.lengthCm)), Width: String(Math.ceil(req.widthCm)), Height: String(Math.ceil(req.heightCm)) } }
        : {}),
    };
    const payload = {
      RateRequest: {
        Shipment: {
          Shipper: { ShipperNumber: this.accountNumber, Address: address(req.origin) },
          ShipFrom: { Address: address(req.origin) },
          ShipTo: { Address: address(req.destination) },
          NumOfPieces: String(req.packageCount),
          Package: Array.from({ length: Math.min(req.packageCount, 200) }, () => pkg),
          ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
          ShipmentTotalWeight: { UnitOfMeasurement: { Code: 'KGS', Description: 'Kilograms' }, Weight: String(req.actualWeightKg) },
          DeliveryTimeInformation: { PackageBillType: '03', Pickup: { Date: req.shipDate.toISOString().slice(0, 10).replace(/-/g, '') } },
        },
      },
    };
    const res = await carrierFetch<{ RateResponse?: { RatedShipment?: UpsRatedShipment[] } }>(
      'UPS',
      `${this.base}/api/rating/v2409/Shoptimeintransit`,
      { method: 'POST', headers: await this.headers(signal), body: JSON.stringify(payload) },
      signal,
    );
    const retrievedAt = new Date().toISOString();
    const sandbox = this.mode === 'SANDBOX';
    return (res?.RateResponse?.RatedShipment ?? []).flatMap((r): NormalizedQuote[] => {
      const negotiated = r.NegotiatedRateCharges?.TotalCharge;
      const charge = negotiated ?? r.TotalCharges;
      const currency = charge?.CurrencyCode as Currency | undefined;
      if (!charge?.MonetaryValue || !currency || !SUPPORTED_CURRENCIES.includes(currency)) return [];
      const code = r.Service?.Code ?? 'UNKNOWN';
      const arrival = r.TimeInTransit?.ServiceSummary?.EstimatedArrival;
      return [
        {
          carrierCode: 'UPS',
          carrierName: 'UPS',
          serviceCode: code,
          serviceName: `UPS ${SERVICE_NAMES[code] ?? code}`,
          serviceLevel: levelFor(code),
          currency,
          totalMinor: Math.round(Number(charge.MonetaryValue) * 10 ** CURRENCY_EXPONENT[currency]),
          breakdown: [],
          transitDays: arrival?.BusinessDaysInTransit ? Number(arrival.BusinessDaysInTransit) : null,
          estimatedDeliveryDate: arrival?.Arrival?.Date ? new Date(upsTimestamp(arrival.Arrival.Date)).toISOString() : null,
          provenance: {
            sourceType: sandbox ? 'SANDBOX_QUOTE' : negotiated ? 'CONTRACT_RATE' : 'LIVE_QUOTE',
            provider: UPS_PROVIDER,
            retrievedAt,
            isSimulated: false,
            limitations: sandbox ? ['UPS test environment — prices are test data, not bookable offers.'] : [],
          },
        },
      ];
    });
  }

  async getTracking(ctx: TrackingContext, signal: AbortSignal): Promise<NormalizedTrackingEvent[]> {
    const res = await carrierFetch<{ trackResponse?: { shipment?: { package?: { activity?: UpsActivity[] }[] }[] } }>(
      'UPS',
      `${this.base}/api/track/v1/details/${encodeURIComponent(ctx.trackingNumber)}?locale=en_US`,
      { headers: await this.headers(signal) },
      signal,
    );
    const activities = res?.trackResponse?.shipment?.[0]?.package?.[0]?.activity ?? [];
    const retrievedAt = new Date().toISOString();
    return activities
      .filter((a) => a.date)
      .map((a) => {
        const description = a.status?.description ?? 'Status update';
        const type = a.status?.type ?? '';
        return {
          externalEventId: `ups:${stableHash(`${a.date}${a.time}|${a.status?.code}|${description}`).toString(36)}`,
          occurredAt: new Date(upsTimestamp(a.date!, a.time, a.gmtOffset)).toISOString(),
          location: { city: a.location?.address?.city, country: a.location?.address?.countryCode },
          description,
          status: UPS_STATUS[type] ?? statusFromDescription(description) ?? (type === 'I' ? 'IN_TRANSIT' : undefined),
          rawStatusCode: a.status?.code,
          isException: type === 'X',
          provenance: { sourceType: this.mode === 'SANDBOX' ? 'SANDBOX_QUOTE' : 'LIVE_QUOTE', provider: UPS_PROVIDER, retrievedAt, isSimulated: false, limitations: [] },
        } satisfies NormalizedTrackingEvent;
      })
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
