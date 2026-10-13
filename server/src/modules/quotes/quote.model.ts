import mongoose, { Schema } from 'mongoose';
import { CARRIER_CODES, QUOTE_SOURCE_TYPES } from '../../integrations/carriers/types.js';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { SERVICE_LEVELS } from '../shipments/shipment.rules.js';

const provenanceSchema = new Schema(
  {
    sourceType: { type: String, enum: QUOTE_SOURCE_TYPES, required: true },
    provider: { type: String, required: true },
    retrievedAt: { type: Date, required: true },
    isSimulated: { type: Boolean, required: true },
    validUntil: { type: Date },
    limitations: [{ type: String }],
    externalReference: { type: String },
    fromCache: { type: Boolean, default: false },
  },
  { _id: false },
);

/** A single carrier offer returned for a quote request (immutable snapshot). */
const carrierQuoteSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    quoteRequestId: { type: Schema.Types.ObjectId, ref: 'QuoteRequest', required: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    carrierCode: { type: String, enum: CARRIER_CODES, required: true },
    carrierName: { type: String, required: true },
    serviceCode: { type: String, required: true },
    serviceName: { type: String, required: true },
    serviceLevel: { type: String, enum: SERVICE_LEVELS, required: true },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    totalMinor: { type: Number, required: true, min: 0 },
    breakdown: [{ _id: false, label: String, amountMinor: Number }],
    transitDays: { type: Number },
    estimatedDeliveryDate: { type: Date },
    billableWeightKg: { type: Number },
    volumetricWeightKg: { type: Number },
    constraints: { type: Schema.Types.Mixed },
    provenance: { type: provenanceSchema, required: true },
    eligibility: {
      eligible: { type: Boolean, required: true },
      reasons: [{ type: String }],
    },
    reliability: {
      onTimeRate: { type: Number },
      sampleSize: { type: Number, default: 0 },
      minSamples: { type: Number },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
carrierQuoteSchema.index({ organizationId: 1, quoteRequestId: 1 });
carrierQuoteSchema.index({ organizationId: 1, shipmentId: 1, createdAt: -1 });

export const CarrierQuote = mongoose.model('CarrierQuote', carrierQuoteSchema);

/** One comparison run: the normalized request plus each provider's outcome. */
const quoteRequestSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    request: { type: Schema.Types.Mixed, required: true },
    providers: [
      {
        _id: false,
        carrierCode: String,
        carrierName: String,
        provider: String,
        mode: String,
        status: { type: String, enum: ['OK', 'EMPTY', 'ERROR', 'TIMEOUT', 'RATE_LIMITED', 'AUTH', 'NOT_CONFIGURED', 'UNSUPPORTED'] },
        message: String,
        quoteCount: Number,
        durationMs: Number,
        fromCache: Boolean,
      },
    ],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
quoteRequestSchema.index({ organizationId: 1, createdAt: -1 });
quoteRequestSchema.index({ organizationId: 1, shipmentId: 1, createdAt: -1 });

export const QuoteRequest = mongoose.model('QuoteRequest', quoteRequestSchema);
