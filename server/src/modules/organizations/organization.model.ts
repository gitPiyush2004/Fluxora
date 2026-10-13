import mongoose, { Schema } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';

export const ORG_ROLES = ['ADMIN', 'MEMBER'] as const;

/** Default thresholds (hours) a shipment may remain in a status before a STUCK_IN_STATUS alert fires. */
export const DEFAULT_STUCK_THRESHOLDS_HOURS = {
  BOOKED: 72,
  PICKED_UP: 48,
  IN_TRANSIT: 168,
  OUT_FOR_DELIVERY: 24,
  DELAYED: 72,
  EXCEPTION: 24,
};

const settingsSchema = new Schema(
  {
    defaultCurrency: { type: String, enum: SUPPORTED_CURRENCIES, default: 'USD' },
    /** cm³ per kg. 5000 is the common express-parcel divisor; 6000 is also widely used. */
    volumetricDivisor: { type: Number, default: 5000, min: 1000, max: 10000 },
    recommendationWeights: {
      cost: { type: Number, default: 50, min: 0, max: 100 },
      transit: { type: Number, default: 30, min: 0, max: 100 },
      reliability: { type: Number, default: 20, min: 0, max: 100 },
    },
    /** Minimum delivered shipments per carrier before an on-time rate is used as "reliability". */
    reliabilityMinSamples: { type: Number, default: 5, min: 1, max: 1000 },
    exceptionRules: {
      stuckThresholdsHours: {
        BOOKED: { type: Number, default: DEFAULT_STUCK_THRESHOLDS_HOURS.BOOKED },
        PICKED_UP: { type: Number, default: DEFAULT_STUCK_THRESHOLDS_HOURS.PICKED_UP },
        IN_TRANSIT: { type: Number, default: DEFAULT_STUCK_THRESHOLDS_HOURS.IN_TRANSIT },
        OUT_FOR_DELIVERY: { type: Number, default: DEFAULT_STUCK_THRESHOLDS_HOURS.OUT_FOR_DELIVERY },
        DELAYED: { type: Number, default: DEFAULT_STUCK_THRESHOLDS_HOURS.DELAYED },
        EXCEPTION: { type: Number, default: DEFAULT_STUCK_THRESHOLDS_HOURS.EXCEPTION },
      },
      /** Hours without any tracking update before an in-flight shipment is flagged. */
      trackingStaleHours: { type: Number, default: 36, min: 1 },
      /** Grace period after the expected delivery date before flagging it as overdue. */
      overdueGraceHours: { type: Number, default: 0, min: 0 },
    },
  },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    settings: { type: settingsSchema, default: () => ({}) },
    /** Contains seeded demonstration data. */
    isDemo: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
organizationSchema.index({ slug: 1 }, { unique: true });

export const Organization = mongoose.model('Organization', organizationSchema);

const membershipSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ORG_ROLES, required: true, default: 'MEMBER' },
  },
  { timestamps: true },
);
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });

export const Membership = mongoose.model('Membership', membershipSchema);

const inviteSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, enum: ORG_ROLES, required: true, default: 'MEMBER' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REVOKED'], default: 'PENDING' },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
);
inviteSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
inviteSchema.index({ email: 1, status: 1 });

export const Invite = mongoose.model('Invite', inviteSchema);
