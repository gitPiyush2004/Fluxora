import mongoose, { Schema, Types } from 'mongoose';

/**
 * Atomic per-organization sequence counters used for human-readable references
 * (PO-2026-00001, SHP-2026-000001). Uniqueness is additionally enforced by
 * unique indexes on the referencing collections.
 */
const counterSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);
counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const Counter = mongoose.models.Counter ?? mongoose.model('Counter', counterSchema);

export async function nextSequence(organizationId: Types.ObjectId | string, key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { organizationId, key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean<{ seq: number }>();
  return doc!.seq;
}

export async function nextReference(
  organizationId: Types.ObjectId | string,
  prefix: string,
  width: number,
  now = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const seq = await nextSequence(organizationId, `${prefix}-${year}`);
  return `${prefix}-${year}-${String(seq).padStart(width, '0')}`;
}
