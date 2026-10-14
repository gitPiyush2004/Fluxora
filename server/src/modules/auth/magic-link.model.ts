import mongoose, { Schema } from 'mongoose';

/**
 * One-time email sign-in token. Only a SHA-256 hash is stored, so a database leak does not
 * reveal usable links. Tokens expire after 15 minutes and MongoDB deletes them via a TTL index.
 */
const magicLinkTokenSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
});

magicLinkTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MagicLinkToken = mongoose.model('MagicLinkToken', magicLinkTokenSchema);
