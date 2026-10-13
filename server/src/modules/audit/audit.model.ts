import mongoose, { Schema, Types } from 'mongoose';

export const AUDIT_ENTITY_TYPES = ['SUPPLIER', 'PRODUCT', 'PURCHASE_ORDER', 'SHIPMENT', 'ALERT', 'ORGANIZATION', 'MEMBERSHIP'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Append-only activity log. Updates and deletes are blocked at the model layer. */
const auditLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    entityType: { type: String, enum: AUDIT_ENTITY_TYPES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true, maxlength: 64 },
    summary: { type: String, required: true, maxlength: 500 },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, maxlength: 120 },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 });

const blockMutation = function () {
  throw new Error('Audit logs are append-only');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditLogSchema.pre(op, blockMutation);
}

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export interface AuditActor {
  userId?: Types.ObjectId;
  name?: string;
}

export async function recordAudit(params: {
  organizationId: Types.ObjectId;
  entityType: AuditEntityType;
  entityId: Types.ObjectId;
  action: string;
  summary: string;
  actor?: AuditActor;
  details?: unknown;
}): Promise<void> {
  await AuditLog.create({
    organizationId: params.organizationId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    summary: params.summary,
    actorId: params.actor?.userId,
    actorName: params.actor?.name,
    details: params.details,
  });
}

export async function listAudit(organizationId: Types.ObjectId, entityType: AuditEntityType, entityId: Types.ObjectId, limit = 100) {
  return AuditLog.find({ organizationId, entityType, entityId }).sort({ createdAt: -1 }).limit(limit).lean();
}
