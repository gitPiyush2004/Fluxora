import mongoose, { Schema } from 'mongoose';

/**
 * Idempotency ledger for booking requests. The unique (organizationId, idempotencyKey)
 * index guarantees a repeated request (double-click, network retry) is executed once;
 * replays return the stored outcome.
 */
const bookingRecordSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true },
    idempotencyKey: { type: String, required: true, maxlength: 200 },
    mode: { type: String, enum: ['PROVIDER', 'MANUAL'], required: true },
    status: { type: String, enum: ['PENDING', 'SUCCEEDED', 'FAILED'], required: true },
    carrierCode: { type: String },
    provider: { type: String },
    isSimulated: { type: Boolean },
    bookingReference: { type: String },
    trackingNumber: { type: String },
    error: { code: String, message: String },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
  },
  { timestamps: true },
);
bookingRecordSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });
bookingRecordSchema.index({ organizationId: 1, shipmentId: 1, createdAt: -1 });

export const BookingRecord = mongoose.model('BookingRecord', bookingRecordSchema);
