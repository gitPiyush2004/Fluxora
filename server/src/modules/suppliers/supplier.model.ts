import mongoose, { Schema } from 'mongoose';
import { COUNTRY_CODES } from '../../utils/geo.js';

const supplierSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    supplierRef: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    contactPerson: { type: String, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    phone: { type: String, trim: true, maxlength: 40 },
    country: { type: String, required: true, enum: COUNTRY_CODES },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 300 },
    isActive: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

supplierSchema.index({ organizationId: 1, supplierRef: 1 }, { unique: true });
supplierSchema.index({ organizationId: 1, isActive: 1, name: 1 });

export const Supplier = mongoose.model('Supplier', supplierSchema);
