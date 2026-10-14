import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { COUNTRY_CODES } from '../../utils/geo.js';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { SERVICE_LEVELS, SHIPMENT_STATUSES, SHIPMENT_TYPES, SPECIAL_HANDLING } from './shipment.rules.js';

const minorInt = { validator: (v: number | null | undefined) => v == null || Number.isSafeInteger(v), message: 'Amounts must be integer minor units' };

const locationSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, required: true, enum: COUNTRY_CODES },
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    reference: { type: String, required: true, trim: true, maxlength: 40 },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    purchaseOrderNumber: { type: String, maxlength: 40 },

    origin: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },

    shipmentType: { type: String, enum: SHIPMENT_TYPES, required: true },
    packageCount: { type: Number, required: true, min: 1, max: 10_000 },
    /** Total actual (scale) weight of all packages in kg. Optional only for tracked-only shipments. */
    actualWeightKg: { type: Number, min: 0.01, max: 1_000_000 },
    /** Dimensions of a single package in cm (all packages assumed identical). */
    lengthCm: { type: Number, min: 1, max: 2000 },
    widthCm: { type: Number, min: 1, max: 2000 },
    heightCm: { type: Number, min: 1, max: 2000 },
    volumetricWeightKg: { type: Number },
    billableWeightKg: { type: Number },

    contentsDescription: { type: String, trim: true, maxlength: 500 },
    items: [
      {
        _id: false,
        poLineId: { type: Schema.Types.ObjectId },
        sku: { type: String, maxlength: 64 },
        description: { type: String, required: true, maxlength: 300 },
        quantity: { type: Number, required: true, min: 0 },
        unitOfMeasure: { type: String, maxlength: 16 },
      },
    ],

    requiredDeliveryDate: { type: Date },
    servicePreference: { type: String, enum: SERVICE_LEVELS, default: 'STANDARD' },
    cargoValueMinor: { type: Number, min: 0, validate: minorInt },
    cargoCurrency: { type: String, enum: SUPPORTED_CURRENCIES },
    insuranceRequired: { type: Boolean, default: false },
    specialHandling: [{ type: String, enum: SPECIAL_HANDLING }],
    maxBudgetMinor: { type: Number, min: 0, validate: minorInt },
    /** Currency used for quotes, budget and freight cost. */
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    /** Bumped whenever route/package/requirement fields change; older quotes become unusable. */
    specUpdatedAt: { type: Date, default: () => new Date() },
    status: { type: String, enum: SHIPMENT_STATUSES, required: true, default: 'DRAFT' },
    statusChangedAt: { type: Date, default: () => new Date() },

    // Selected offer (copied from the quote for durability; quotes can expire).
    selectedQuoteId: { type: Schema.Types.ObjectId, ref: 'CarrierQuote' },
    carrierCode: { type: String, maxlength: 40 },
    carrierName: { type: String, maxlength: 120 },
    serviceName: { type: String, maxlength: 160 },
    serviceLevel: { type: String, enum: SERVICE_LEVELS },
    quoteSourceType: { type: String },
    quoteIsSimulated: { type: Boolean },
    freightCostMinor: { type: Number, min: 0, validate: minorInt },

    booking: {
      reference: { type: String, maxlength: 120 },
      bookedAt: { type: Date },
      provider: { type: String, maxlength: 40 },
      isSimulated: { type: Boolean },
      cancellable: { type: Boolean },
    },
    /** Idempotency key currently holding the booking lock (prevents concurrent double bookings). */
    bookingLock: { type: String, maxlength: 200 },
    trackingNumber: { type: String, trim: true, maxlength: 120 },
    trackingMode: { type: String, enum: ['NONE', 'LIVE', 'SIMULATED', 'MANUAL'], default: 'NONE' },
    simulation: {
      nextStep: { type: Number, default: 0 },
      outcome: { type: String },
    },

    expectedDeliveryDate: { type: Date },
    pickedUpAt: { type: Date },
    deliveredAt: { type: Date },
    lastTrackingUpdateAt: { type: Date },
    lastTrackingPollAt: { type: Date },
    lastTrackingError: { type: String, maxlength: 300 },
    lastKnownLocation: { type: String, maxlength: 200 },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, maxlength: 500 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

shipmentSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
shipmentSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
shipmentSchema.index({ organizationId: 1, createdAt: -1 });
shipmentSchema.index({ organizationId: 1, carrierCode: 1, status: 1 });
shipmentSchema.index({ organizationId: 1, purchaseOrderId: 1 });
shipmentSchema.index({ organizationId: 1, expectedDeliveryDate: 1 });
shipmentSchema.index({ trackingNumber: 1 }, { sparse: true });

export type ShipmentAttrs = InferSchemaType<typeof shipmentSchema>;
export type ShipmentDoc = HydratedDocument<ShipmentAttrs>;
export const Shipment = mongoose.model('Shipment', shipmentSchema);
