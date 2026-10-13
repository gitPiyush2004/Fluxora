import { stableHash } from '../../../utils/dates.js';
import type { ShipmentStatus } from '../../../modules/shipments/shipment.rules.js';
import { carrierFetch } from '../http.js';
import { statusFromDescription } from '../status-mapping.js';
import { CarrierError, type NormalizedTrackingEvent, type TrackingContext } from '../types.js';

/**
 * DHL Shipment Tracking – Unified API.
 * Docs: https://developer.dhl.com/api-reference/shipment-tracking
 *   GET {base}/track/shipments?trackingNumber=...   header: DHL-API-Key
 * Free developer keys are rate-limited (documented: 250 calls/day, 1 call / 5 s).
 * The key "demo-key" returns mocked responses only.
 */
export const DHL_TRACKING_PROVIDER = 'dhl-unified-tracking';

interface DhlEvent {
  timestamp?: string;
  location?: { address?: { addressLocality?: string; countryCode?: string } };
  statusCode?: string;
  status?: string;
  description?: string;
}

interface DhlTrackingResponse {
  shipments?: { id?: string; service?: string; events?: DhlEvent[]; estimatedTimeOfDelivery?: string }[];
}

function mapStatus(statusCode: string | undefined, description: string): ShipmentStatus | undefined {
  switch (statusCode) {
    case 'delivered':
      return 'DELIVERED';
    case 'failure':
      return 'EXCEPTION';
    case 'transit':
      return statusFromDescription(description) ?? 'IN_TRANSIT';
    case 'pre-transit':
      return statusFromDescription(description) === 'PICKED_UP' ? 'PICKED_UP' : undefined;
    default:
      return statusFromDescription(description);
  }
}

export class DhlTrackingClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  /** DHL's public "demo-key" only returns mocked data. */
  get isDemoKey(): boolean {
    return this.apiKey === 'demo-key';
  }

  async getTracking(ctx: TrackingContext, signal: AbortSignal): Promise<NormalizedTrackingEvent[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/track/shipments?trackingNumber=${encodeURIComponent(ctx.trackingNumber)}`;
    const body = await carrierFetch<DhlTrackingResponse>('DHL', url, { headers: { 'DHL-API-Key': this.apiKey, Accept: 'application/json' } }, signal);
    const shipment = body?.shipments?.[0];
    if (!shipment) throw new CarrierError('DHL', 'VALIDATION', 'DHL returned no shipment for this tracking number');
    const retrievedAt = new Date().toISOString();
    return (shipment.events ?? [])
      .filter((e) => e.timestamp)
      .map((e) => {
        const description = e.description || e.status || 'Status update';
        return {
          externalEventId: `dhl:${stableHash(`${e.timestamp}|${e.statusCode}|${description}`).toString(36)}`,
          occurredAt: new Date(e.timestamp!).toISOString(),
          location: { city: e.location?.address?.addressLocality, country: e.location?.address?.countryCode },
          description,
          status: mapStatus(e.statusCode, description),
          rawStatusCode: e.statusCode,
          isException: e.statusCode === 'failure',
          provenance: {
            sourceType: this.isDemoKey ? 'SANDBOX_QUOTE' : 'LIVE_QUOTE',
            provider: DHL_TRACKING_PROVIDER,
            retrievedAt,
            isSimulated: false,
            limitations: this.isDemoKey ? ['DHL demo-key returns mocked responses, not real shipment data.'] : [],
            externalReference: shipment.id,
          },
        } satisfies NormalizedTrackingEvent;
      })
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
