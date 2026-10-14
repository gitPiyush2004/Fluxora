// API entity types (mirrors the server's response shapes).

export type Role = 'ADMIN' | 'MEMBER';
export type ShipmentStatus = 'DRAFT' | 'QUOTED' | 'BOOKED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELAYED' | 'EXCEPTION' | 'CANCELLED';
export type ShipmentType = 'PARCEL' | 'BOX' | 'PALLET' | 'FREIGHT';
export type ServiceLevel = 'ECONOMY' | 'STANDARD' | 'EXPRESS';
export type SpecialHandling = 'DANGEROUS_GOODS' | 'TEMPERATURE_CONTROLLED' | 'FRAGILE' | 'OVERSIZED' | 'LIFTGATE';
export type PoStatus = 'DRAFT' | 'APPROVED' | 'READY_TO_SHIP' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export type QuoteSourceType = 'LIVE_QUOTE' | 'CONTRACT_RATE' | 'SANDBOX_QUOTE' | 'ESTIMATED' | 'SIMULATED';
export type CarrierCode = 'DHL' | 'FEDEX' | 'UPS' | 'DSV' | 'KUEHNE_NAGEL' | 'CEVA';
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type AlertType = 'STUCK_IN_STATUS' | 'PAST_EXPECTED_DELIVERY' | 'CARRIER_EXCEPTION' | 'TRACKING_STALE';

export interface Weights {
  cost: number;
  transit: number;
  reliability: number;
}

export interface OrgSettings {
  defaultCurrency: string;
  volumetricDivisor: number;
  recommendationWeights: Weights;
  reliabilityMinSamples: number;
  exceptionRules: {
    stuckThresholdsHours: Record<string, number>;
    trackingStaleHours: number;
    overdueGraceHours: number;
  };
}

export interface Me {
  user: { id: string; email: string; name: string; avatarUrl: string | null };
  organization: { id: string; name: string; slug: string; isDemo: boolean; settings: OrgSettings };
  role: Role;
  organizations: { id: string; name: string; role: Role }[];
  csrfToken: string;
}

export interface AuthConfig {
  googleClientId: string | null;
  emailSignInEnabled: boolean;
}

export interface Place {
  name?: string;
  address?: string;
  city: string;
  postalCode?: string;
  country: string;
}

export interface Supplier {
  _id: string;
  supplierRef: string;
  name: string;
  contactPerson?: string;
  email: string;
  phone?: string;
  country: string;
  city: string;
  postalCode?: string;
  address?: string;
  isActive: boolean;
  isDemo?: boolean;
  createdAt: string;
}

export interface Product {
  _id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unitOfMeasure: string;
  defaultUnitCostMinor: number;
  currency: string;
  isActive: boolean;
  isDemo?: boolean;
}

export interface PoLine {
  _id: string;
  productId?: string;
  sku?: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  receivedQuantity: number;
}

export interface AuditEntry {
  _id: string;
  action: string;
  summary: string;
  actorName?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  _id: string;
  poNumber: string;
  supplierId: Supplier | string;
  orderDate: string;
  expectedDeliveryDate?: string;
  destination: Place;
  currency: string;
  lines: PoLine[];
  subtotalMinor: number;
  taxRateBps: number;
  taxMinor: number;
  additionalChargesMinor: number;
  totalMinor: number;
  notes?: string;
  status: PoStatus;
  approvedAt?: string;
  readyToShipAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  receipts: { _id: string; receivedAt: string; receivedByName?: string; note?: string; lines: { lineId: string; quantity: number }[] }[];
  isDemo?: boolean;
  createdAt: string;
  __v: number;
  shipments?: ShipmentSummary[];
  activity?: AuditEntry[];
}

export interface ShipmentSummary {
  _id: string;
  reference: string;
  status: ShipmentStatus;
  carrierName?: string;
  serviceName?: string;
  expectedDeliveryDate?: string;
  deliveredAt?: string;
  freightCostMinor?: number;
  currency: string;
  createdAt: string;
  quoteIsSimulated?: boolean;
  items?: { description: string; quantity: number }[];
}

export interface Shipment {
  _id: string;
  reference: string;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  origin: Place;
  destination: Place;
  shipmentType: ShipmentType;
  packageCount: number;
  /** Absent on shipments added only for tracking. */
  actualWeightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  volumetricWeightKg?: number;
  billableWeightKg?: number;
  contentsDescription?: string;
  items: { poLineId?: string; sku?: string; description: string; quantity: number; unitOfMeasure?: string }[];
  requiredDeliveryDate?: string;
  servicePreference?: ServiceLevel;
  cargoValueMinor?: number;
  cargoCurrency?: string;
  insuranceRequired: boolean;
  specialHandling: SpecialHandling[];
  maxBudgetMinor?: number;
  currency: string;
  notes?: string;
  status: ShipmentStatus;
  statusChangedAt: string;
  selectedQuoteId?: string;
  carrierCode?: CarrierCode;
  carrierName?: string;
  serviceName?: string;
  serviceLevel?: ServiceLevel;
  quoteSourceType?: QuoteSourceType;
  quoteIsSimulated?: boolean;
  freightCostMinor?: number;
  booking?: { reference?: string; bookedAt?: string; provider?: string; isSimulated?: boolean; cancellable?: boolean };
  trackingNumber?: string;
  trackingMode: 'NONE' | 'LIVE' | 'SIMULATED' | 'MANUAL';
  expectedDeliveryDate?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  lastTrackingUpdateAt?: string;
  lastTrackingError?: string;
  lastKnownLocation?: string;
  cancellationReason?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
  purchaseOrder?: { _id: string; poNumber: string; status: PoStatus; totalMinor: number; currency: string } | null;
  openAlerts?: Alert[];
  eventCount?: number;
}

export interface Provenance {
  sourceType: QuoteSourceType;
  provider: string;
  retrievedAt: string;
  isSimulated: boolean;
  validUntil?: string;
  limitations: string[];
  externalReference?: string;
  fromCache?: boolean;
}

export interface Quote {
  id: string;
  carrierCode: CarrierCode;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  serviceLevel: ServiceLevel;
  currency: string;
  totalMinor: number;
  breakdown: { label: string; amountMinor: number }[];
  transitDays?: number;
  estimatedDeliveryDate?: string;
  billableWeightKg?: number;
  volumetricWeightKg?: number;
  provenance: Provenance;
  eligibility: { eligible: boolean; reasons: string[] };
  reliability?: { onTimeRate?: number; sampleSize: number; minSamples: number };
  isExpired: boolean;
}

export type Metric = 'cost' | 'transit' | 'reliability';

export interface RankedQuote {
  id: string;
  score: number;
  components: Record<Metric, number | null>;
  contributions: Record<Metric, number | null>;
  badges: ('CHEAPEST' | 'FASTEST' | 'BEST_BALANCED')[];
  explanation: string[];
  tradeoffs: string[];
}

export interface CurrencyGroup {
  currency: string;
  appliedWeights: Record<Metric, number>;
  excludedMetrics: { metric: Metric; reason: string }[];
  quotes: RankedQuote[];
  order: Record<'CHEAPEST' | 'FASTEST' | 'BALANCED', string[]>;
  cheapestId: string | null;
  fastestId: string | null;
  bestBalancedId: string | null;
}

export interface ProviderOutcome {
  carrierCode: CarrierCode;
  carrierName: string;
  provider: string | null;
  mode: string;
  status: 'OK' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH' | 'NOT_CONFIGURED' | 'UNSUPPORTED';
  message?: string;
  quoteCount: number;
  durationMs: number;
  fromCache: boolean;
}

export interface QuoteResponse {
  quoteRequestId: string;
  shipmentId: string | null;
  createdAt: string;
  request: ShipmentSpec;
  weightEstimate: { actualWeightKg: number; volumetricWeightKg: number | null; billableWeightKg: number; basis: 'ACTUAL' | 'VOLUMETRIC'; divisor: number; note: string };
  providers: ProviderOutcome[];
  quotes: Quote[];
  recommendation: { weights: Weights; groups: CurrencyGroup[]; notes: string[] };
  allSimulated: boolean;
}

export interface ShipmentSpec {
  origin: Place;
  destination: Place;
  shipmentType: ShipmentType;
  packageCount: number;
  actualWeightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  requiredDeliveryDate?: string | null;
  servicePreference?: ServiceLevel | null;
  cargoValueMinor?: number | null;
  cargoCurrency?: string | null;
  insuranceRequired: boolean;
  specialHandling: SpecialHandling[];
  maxBudgetMinor?: number | null;
  currency: string;
}

export interface ShipmentEvent {
  _id: string;
  shipmentId: string | { _id: string; reference: string };
  type: string;
  occurredAt: string;
  recordedAt: string;
  description: string;
  location?: { city?: string; country?: string; description?: string };
  previousStatus?: ShipmentStatus;
  newStatus?: ShipmentStatus;
  source: { type: 'CARRIER_API' | 'SIMULATED' | 'USER' | 'SYSTEM'; provider?: string; isSimulated: boolean; sandbox?: boolean };
  isException?: boolean;
  actorName?: string;
}

export interface Alert {
  _id: string;
  shipmentId: string;
  shipmentReference: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  recommendedAction: string;
  status: AlertStatus;
  detectedAt: string;
  acknowledgedAt?: string;
  acknowledgedByName?: string;
  resolvedAt?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  autoResolved?: boolean;
  isSimulatedSource?: boolean;
}

export interface CarrierIntegration {
  code: CarrierCode;
  name: string;
  quotes: string;
  booking: string;
  tracking: string;
  cancellation: string;
  requirements: string[];
  portal: string;
  notes: string[];
}

export interface Member {
  userId: string;
  role: Role;
  email?: string;
  name?: string;
  avatarUrl?: string;
  joinedAt: string;
  lastLoginAt?: string;
}
