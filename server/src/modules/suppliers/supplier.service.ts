import type { Types } from 'mongoose';
import { notFound } from '../../utils/errors.js';
import { escapeRegex, pageMeta } from '../../utils/pagination.js';
import { listAudit, recordAudit, type AuditActor } from '../audit/audit.model.js';
import { PurchaseOrder } from '../purchase-orders/purchase-order.model.js';
import { Supplier } from './supplier.model.js';
import type { SupplierInput, SupplierListQuery } from './supplier.schemas.js';

export async function listSuppliers(organizationId: Types.ObjectId, q: SupplierListQuery) {
  const filter: Record<string, unknown> = { organizationId };
  if (q.status !== 'all') filter.isActive = q.status === 'active';
  if (q.country) filter.country = q.country;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { supplierRef: rx }, { email: rx }, { city: rx }, { contactPerson: rx }];
  }
  const [items, total] = await Promise.all([
    Supplier.find(filter)
      .sort({ [q.sortBy]: q.sortDir === 'asc' ? 1 : -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Supplier.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

/** Supplier with its 10 most recent purchase orders and activity log. */
export async function getSupplierDetail(organizationId: Types.ObjectId, id: string) {
  const supplier = await Supplier.findOne({ _id: id, organizationId }).lean();
  if (!supplier) throw notFound('Supplier');
  const [recentOrders, activity] = await Promise.all([
    PurchaseOrder.find({ organizationId, supplierId: supplier._id })
      .select('poNumber status orderDate totalMinor currency')
      .sort({ orderDate: -1 })
      .limit(10)
      .lean(),
    listAudit(organizationId, 'SUPPLIER', supplier._id, 50),
  ]);
  return { ...supplier, recentOrders, activity };
}

export async function createSupplier(organizationId: Types.ObjectId, actor: AuditActor, input: SupplierInput) {
  const supplier = await Supplier.create({ ...input, organizationId });
  await recordAudit({ organizationId, entityType: 'SUPPLIER', entityId: supplier._id, action: 'CREATED', summary: `Supplier ${supplier.name} created`, actor });
  return supplier;
}

export async function updateSupplier(organizationId: Types.ObjectId, id: string, actor: AuditActor, input: Partial<SupplierInput>) {
  const supplier = await Supplier.findOneAndUpdate({ _id: id, organizationId }, { $set: input }, { returnDocument: 'after', runValidators: true });
  if (!supplier) throw notFound('Supplier');
  await recordAudit({
    organizationId, entityType: 'SUPPLIER', entityId: supplier._id, action: 'UPDATED',
    summary: 'Supplier details updated', actor, details: { fields: Object.keys(input) },
  });
  return supplier;
}

export async function setSupplierActive(organizationId: Types.ObjectId, id: string, actor: AuditActor, isActive: boolean) {
  const supplier = await Supplier.findOneAndUpdate({ _id: id, organizationId }, { $set: { isActive } }, { returnDocument: 'after' });
  if (!supplier) throw notFound('Supplier');
  await recordAudit({
    organizationId, entityType: 'SUPPLIER', entityId: supplier._id, action: isActive ? 'ACTIVATED' : 'DEACTIVATED',
    summary: `Supplier ${isActive ? 'activated' : 'deactivated'}`, actor,
  });
  return supplier;
}
