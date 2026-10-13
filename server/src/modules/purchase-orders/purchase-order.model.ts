import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { COUNTRY_CODES } from '../../utils/geo.js';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { UNITS_OF_MEASURE } from '../products/product.model.js';
import { PO_STATUSES } from './purchase-order.rules.js';

const minorInt = { validator: Number.isSafeInteger, message: 'Amounts must be integer minor units' };

const lineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product' },
  sku: { type: String, trim: true, maxlength: 64 },
  description: { type: String, required: true, trim: true, maxlength: 300 },
  quantity: { type: Number, required: true, min: 0.001 },
  unitOfMeasure: { type: String, enum: UNITS_OF_MEASURE, default: 'EA' },
  unitPriceMinor: { type: Number, required: true, min: 0, validate: minorInt },
  lineTotalMinor: { type: Number, required: true, min: 0, validate: minorInt },
  receivedQuantity: { type: Number, default: 0, min: 0 },
});

const addressSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, required: true, enum: COUNTRY_CODES },
  },
  { _id: false },
);

const receiptSchema = new Schema(
  {
    receivedAt: { type: Date, required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedByName: { type: String },
    note: { type: String, maxlength: 500 },
    lines: [{ _id: false, lineId: { type: Schema.Types.ObjectId, required: true }, quantity: { type: Number, required: true } }],
  },
  { timestamps: false },
);

const purchaseOrderSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    poNumber: { type: String, required: true, trim: true, maxlength: 40 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    orderDate: { type: Date, required: true },
    expectedDeliveryDate: { type: Date },
    destination: { type: addressSchema, required: true },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    lines: {
      type: [lineSchema],
      validate: { validator: (v: unknown[]) => v.length >= 1 && v.length <= 200, message: 'A purchase order needs 1–200 lines' },
    },
    subtotalMinor: { type: Number, required: true, min: 0, validate: minorInt },
    taxRateBps: { type: Number, default: 0, min: 0, max: 10_000 },
    taxMinor: { type: Number, required: true, min: 0, validate: minorInt },
    additionalChargesMinor: { type: Number, default: 0, min: 0, validate: minorInt },
    totalMinor: { type: Number, required: true, min: 0, validate: minorInt },
    notes: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: PO_STATUSES, required: true, default: 'DRAFT' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    readyToShipAt: { type: Date },
    receivedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, maxlength: 500 },
    receipts: { type: [receiptSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

purchaseOrderSchema.index({ organizationId: 1, poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ organizationId: 1, status: 1, orderDate: -1 });
purchaseOrderSchema.index({ organizationId: 1, supplierId: 1, orderDate: -1 });

export type PurchaseOrderAttrs = InferSchemaType<typeof purchaseOrderSchema>;
export type PurchaseOrderDoc = HydratedDocument<PurchaseOrderAttrs>;
export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
