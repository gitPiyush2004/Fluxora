import mongoose, { Schema } from 'mongoose';
import { SHIPMENT_STATUSES } from '../shipments/shipment.rules.js';

export const EVENT_TYPES = ['CREATED', 'UPDATED', 'QUOTED', 'QUOTE_SELECTED', 'BOOKED', 'BOOKING_FAILED', 'TRACKING', 'STATUS_CHANGE', 'CANCELLED', 'NOTE'] as const;
export const EVENT_SOURCE_TYPES = ['CARRIER_API', 'SIMULATED', 'USER', 'SYSTEM'] as const;

/**
 * Append-only shipment history. One document per event (never embedded in the shipment,
 * so histories are unbounded-safe). Updates and deletes are rejected at the model layer.
 */
const shipmentEventSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    occurredAt: { type: Date, required: true },
    description: { type: String, required: true, maxlength: 500 },
    location: {
      city: { type: String, maxlength: 120 },
      country: { type: String, maxlength: 2 },
      description: { type: String, maxlength: 200 },
    },
    previousStatus: { type: String, enum: SHIPMENT_STATUSES },
    newStatus: { type: String, enum: SHIPMENT_STATUSES },
    source: {
      type: { type: String, enum: EVENT_SOURCE_TYPES, required: true },
      provider: { type: String, maxlength: 60 },
      isSimulated: { type: Boolean, required: true },
      sandbox: { type: Boolean, default: false },
    },
    /** Provider event id / stable hash — de-duplicates repeated tracking polls. */
    externalEventId: { type: String, maxlength: 200 },
    rawStatusCode: { type: String, maxlength: 60 },
    isException: { type: Boolean, default: false },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, maxlength: 120 },
    metadata: { type: Schema.Types.Mixed },
    /** When Fluxora recorded the event (occurredAt is when it happened). */
    recordedAt: { type: Date, default: () => new Date(), immutable: true },
  },
  { versionKey: false },
);

shipmentEventSchema.index({ organizationId: 1, shipmentId: 1, occurredAt: -1 });
shipmentEventSchema.index({ organizationId: 1, occurredAt: -1 });
shipmentEventSchema.index(
  { shipmentId: 1, externalEventId: 1 },
  { unique: true, partialFilterExpression: { externalEventId: { $type: 'string' } } },
);

const appendOnly = function () {
  throw new Error('Shipment events are append-only');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  shipmentEventSchema.pre(op, appendOnly);
}

export const ShipmentEvent = mongoose.model('ShipmentEvent', shipmentEventSchema);
