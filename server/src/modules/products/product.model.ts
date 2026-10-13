import mongoose, { Schema } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';

export const UNITS_OF_MEASURE = ['EA', 'BOX', 'CARTON', 'PALLET', 'KG', 'M', 'L', 'SET', 'PAIR', 'ROLL'] as const;

const productSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    category: { type: String, trim: true, maxlength: 80 },
    unitOfMeasure: { type: String, enum: UNITS_OF_MEASURE, required: true, default: 'EA' },
    /** Integer minor units of `currency`. */
    defaultUnitCostMinor: {
      type: Number, required: true, min: 0,
      validate: { validator: Number.isSafeInteger, message: 'Unit cost must be an integer amount of minor units' },
    },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    isActive: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

productSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
productSchema.index({ organizationId: 1, isActive: 1, category: 1 });

export const Product = mongoose.model('Product', productSchema);
