import type { Currency } from '../../utils/money.js';
import type { ServiceLevel, ShipmentStatus, ShipmentType, SpecialHandling } from '../../modules/shipments/shipment.rules.js';

export const CARRIER_CODES = ['DHL', 'FEDEX', 'UPS', 'DSV', 'KUEHNE_NAGEL', 'CEVA'] as const;
export type CarrierCode = (typeof CARRIER_CODES)[number];

/**
 * Where a price came from. SIMULATED is Fluxora demonstration data and must never be
 * presented as a carrier offer.
 */
export const QUOTE_SOURCE_TYPES = ['LIVE_QUOTE', 'CONTRACT_RATE', 'SANDBOX_QUOTE', 'ESTIMATED', 'SIMULATED'] as const;
export type QuoteSourceType = (typeof QUOTE_SOURCE_TYPES)[number];

export interface Provenance {
  sourceType: QuoteSourceType;
  /** Adapter/provider identifier, e.g. "dhl-express-mydhl", "fluxora-simulator". */
  provider: string;
  /** When the provider produced this data (preserved when served from cache). */
  retrievedAt: string;
  isSimulated: boolean;
  validUntil?: string;
  limitations: string[];
  externalReference?: string;
  fromCache?: boolean;
}

export interface Place {
  city: string;
  postalCode?: string;
  country: string;
}

/** Normalized shipment request handed to every adapter. */
export interface ShipmentRequest {
  origin: Place;
  destination: Place;
  shipmentType: ShipmentType;
  packageCount: number;
  actualWeightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  requiredDeliveryDate?: Date;
  servicePreference?: ServiceLevel;
  cargoValueMinor?: number;
  cargoCurrency?: Currency;
  insuranceRequired: boolean;
  specialHandling: SpecialHandling[];
  maxBudgetMinor?: number;
  currency: Currency;
  shipDate: Date;
}

export interface ChargeLine {
  label: string;
  amountMinor: number;
}

/** Hard constraints declared by a provider for a given service (used for eligibility). */
export interface ServiceConstraints {
  shipmentTypes?: ShipmentType[];
  maxWeightPerPackageKg?: number;
  maxTotalWeightKg?: number;
  maxLengthCm?: number;
  specialHandling?: SpecialHandling[];
}

export interface NormalizedQuote {
  carrierCode: CarrierCode;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  serviceLevel: ServiceLevel;
  currency: Currency;
  totalMinor: number;
  breakdown: ChargeLine[];
  transitDays: number | null;
  estimatedDeliveryDate: string | null;
  billableWeightKg?: number;
  volumetricWeightKg?: number | null;
  constraints?: ServiceConstraints;
  provenance: Provenance;
}

export interface BookingRequest {
  shipmentReference: string;
  quote: {
    serviceCode: string;
    serviceLevel: ServiceLevel;
    transitDays: number | null;
    estimatedDeliveryDate: string | null;
    externalReference?: string;
  };
  request: ShipmentRequest;
  idempotencyKey: string;
}

export interface BookingResult {
  bookingReference: string;
  trackingNumber?: string;
  expectedDeliveryDate?: string;
  isSimulated: boolean;
  cancellable: boolean;
  provenance: Provenance;
}

export interface NormalizedTrackingEvent {
  /** Provider-unique id (or a stable hash) used to de-duplicate repeated polls. */
  externalEventId: string;
  occurredAt: string;
  location?: { city?: string; country?: string; description?: string };
  description: string;
  /** Internal status the event implies, if any. */
  status?: ShipmentStatus;
  rawStatusCode?: string;
  isException?: boolean;
  provenance: Provenance;
}

/** Shipment context available to tracking providers (the simulator needs it; real APIs don't). */
export interface TrackingContext {
  trackingNumber: string;
  bookedAt?: Date;
  expectedDeliveryDate?: Date;
  origin: Place;
  destination: Place;
  serviceLevel?: ServiceLevel;
  simulationStep?: number;
  simulationOutcome?: string;
}

export interface CarrierCapabilities {
  quotes: boolean;
  booking: boolean;
  tracking: boolean;
  cancellation: boolean;
}

export type AdapterMode = 'LIVE' | 'SANDBOX' | 'SIMULATED' | 'UNAVAILABLE';

export interface CarrierAdapter {
  readonly code: CarrierCode;
  readonly name: string;
  readonly providerId: string;
  readonly mode: AdapterMode;
  readonly capabilities: CarrierCapabilities;
  getQuotes(request: ShipmentRequest, signal: AbortSignal): Promise<NormalizedQuote[]>;
  bookShipment?(booking: BookingRequest, signal: AbortSignal): Promise<BookingResult>;
  getTracking?(context: TrackingContext, signal: AbortSignal): Promise<NormalizedTrackingEvent[]>;
  cancelBooking?(bookingReference: string, signal: AbortSignal): Promise<{ cancelled: boolean; message?: string }>;
}

export type CarrierErrorKind = 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH' | 'VALIDATION' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'NOT_CONFIGURED' | 'UNKNOWN';

export class CarrierError extends Error {
  constructor(
    public readonly carrierCode: CarrierCode,
    public readonly kind: CarrierErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'CarrierError';
  }
}
