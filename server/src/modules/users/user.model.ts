import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';

const userSchema = new Schema(
  {
    /** Google account subject identifier (stable, unique per Google account). */
    googleSub: { type: String },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    emailVerified: { type: Boolean, default: false },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    avatarUrl: { type: String, maxlength: 2048 },
    /** Last organization the user worked in; used as the default after sign-in. */
    lastOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    lastLoginAt: { type: Date },
    /** Fictional user created by the seed script (removed and recreated on every seed). */
    isDemoUser: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleSub: 1 }, { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } } });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = mongoose.model('User', userSchema);
