import { CarrierError, type CarrierAdapter, type CarrierCapabilities, type NormalizedQuote, type NormalizedTrackingEvent, type ShipmentRequest, type TrackingContext } from '../types.js';
import type { DhlExpressRatesClient } from './dhl-express-rates.client.js';
import type { DhlTrackingClient } from './dhl-tracking.client.js';

/**
 * DHL adapter composed from independently configured DHL APIs:
 *  - Unified Shipment Tracking (DHL_TRACKING_API_KEY)
 *  - MyDHL Express rating (DHL_EXPRESS_* credentials)
 * Booking through MyDHL is not implemented; DHL bookings are recorded manually.
 */
export class DhlAdapter implements CarrierAdapter {
  readonly code = 'DHL' as const;
  readonly name = 'DHL';
  readonly providerId = 'dhl';
  readonly capabilities: CarrierCapabilities;

  constructor(
    private readonly rates?: DhlExpressRatesClient,
    private readonly tracking?: DhlTrackingClient,
  ) {
    this.capabilities = { quotes: !!rates, booking: false, tracking: !!tracking, cancellation: false };
  }

  /** SANDBOX when any configured DHL API points at a test environment, otherwise LIVE. */
  get mode() {
    const sandbox = this.rates?.isSandbox || this.tracking?.isDemoKey;
    return sandbox ? ('SANDBOX' as const) : ('LIVE' as const);
  }

  async getQuotes(req: ShipmentRequest, signal: AbortSignal): Promise<NormalizedQuote[]> {
    if (!this.rates) throw new CarrierError('DHL', 'NOT_CONFIGURED', 'DHL Express rating credentials are not configured');
    return this.rates.getQuotes(req, signal);
  }

  async getTracking(ctx: TrackingContext, signal: AbortSignal): Promise<NormalizedTrackingEvent[]> {
    if (!this.tracking) throw new CarrierError('DHL', 'NOT_CONFIGURED', 'DHL tracking API key is not configured');
    return this.tracking.getTracking(ctx, signal);
  }
}
