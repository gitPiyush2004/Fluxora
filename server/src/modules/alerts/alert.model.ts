import mongoose, { Schema } from 'mongoose';
import { ALERT_SEVERITIES, ALERT_TYPES } from './exception-rules.js';

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;

const alertSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true },
    shipmentReference: { type: String, required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    message: { type: String, required: true, maxlength: 500 },
    recommendedAction: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ALERT_STATUSES, required: true, default: 'OPEN' },
    detectedAt: { type: Date, required: true },
    /** Stable key for the condition, e.g. "<shipmentId>:STUCK_IN_STATUS:IN_TRANSIT". */
    dedupeKey: { type: String, required: true },
    /** Set to dedupeKey while unresolved; unset when resolved → unique index blocks duplicates. */
    openKey: { type: String },
    isSimulatedSource: { type: Boolean, default: false },
    acknowledgedAt: { type: Date },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedByName: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedByName: { type: String },
    resolutionNote: { type: String, maxlength: 1000 },
    autoResolved: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

alertSchema.index({ organizationId: 1, openKey: 1 }, { unique: true, partialFilterExpression: { openKey: { $type: 'string' } } });
alertSchema.index({ organizationId: 1, status: 1, detectedAt: -1 });
alertSchema.index({ organizationId: 1, shipmentId: 1, detectedAt: -1 });

export const Alert = mongoose.model('Alert', alertSchema);
