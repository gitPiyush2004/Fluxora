import { Types } from 'mongoose';
import { nextReference } from '../../utils/counters.js';
import { conflict, invalidTransition, notFound, validationError } from '../../utils/errors.js';
import { calculatePurchaseOrderTotals } from '../../utils/money.js';
import { escapeRegex, pageMeta } from '../../utils/pagination.js';
import { listAudit, recordAudit, type AuditActor } from '../audit/audit.model.js';
import { Product } from '../products/product.model.js';
import { Shipment } from '../shipments/shipment.model.js';
import { OPEN_STATUSES } from '../shipments/shipment.rules.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { PurchaseOrder, type PurchaseOrderDoc } from './purchase-order.model.js';
import type { PoInput, PoListQuery, ReceiptInput } from './purchase-order.schemas.js';
import {
  applyReceipt,
  canTransitionPo,
  PO_EDITABLE_STATUSES,
  PO_RECEIVABLE_STATUSES,
  type PoStatus,
} from './purchase-order.rules.js';


async function buildLines(organizationId: Types.ObjectId, input: PoInput) {
  if (input.expectedDeliveryDate && input.expectedDeliveryDate < input.orderDate) {
    throw validationError('Expected delivery date cannot be before the order date', [{ path: 'expectedDeliveryDate', message: 'Must be on or after the order date' }]);
  }
  const supplier = await Supplier.findOne({ _id: input.supplierId, organizationId }).lean();
  if (!supplier) throw validationError('Supplier not found', [{ path: 'supplierId', message: 'Unknown supplier' }]);
  if (!supplier.isActive) throw validationError('Supplier is inactive', [{ path: 'supplierId', message: 'Choose an active supplier' }]);

  const productIds = input.lines.map((l) => l.productId).filter((v): v is string => !!v);
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds }, organizationId }).lean()
    : [];
  const lines = input.lines.map((l, i) => {
    const product = l.productId ? products.find((p) => String(p._id) === l.productId) : undefined;
    if (l.productId && !product) throw validationError('Unknown product', [{ path: `lines.${i}.productId`, message: 'Product not found' }]);
    return {
      productId: product?._id,
      sku: product?.sku,
      description: l.description,
      quantity: l.quantity,
      unitOfMeasure: l.unitOfMeasure ?? product?.unitOfMeasure ?? 'EA',
      unitPriceMinor: l.unitPriceMinor,
    };
  });

  const totals = calculatePurchaseOrderTotals({
    lines,
    taxRateBps: input.taxRateBps,
    additionalChargesMinor: input.additionalChargesMinor,
  });

  return {
    supplier,
    lines: lines.map((l, i) => ({ ...l, lineTotalMinor: totals.lineTotalsMinor[i]!, receivedQuantity: 0 })),
    totals,
  };
}

export async function listPurchaseOrders(organizationId: Types.ObjectId, q: PoListQuery) {
  const filter: Record<string, unknown> = { organizationId };
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.supplierId) filter.supplierId = q.supplierId;
  if (q.from || q.to) filter.orderDate = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.search) {
    // Matches PO number, line descriptions / SKUs, or the supplier's name.
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const supplierIds = await Supplier.find({ organizationId, name: rx }).distinct('_id');
    filter.$or = [{ poNumber: rx }, { 'lines.description': rx }, { 'lines.sku': rx }, { supplierId: { $in: supplierIds } }];
  }
  const [items, total] = await Promise.all([
    PurchaseOrder.find(filter)
      .select('-lines -receipts')
      .sort({ [q.sortBy]: q.sortDir === 'asc' ? 1 : -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .populate('supplierId', 'name supplierRef country')
      .lean(),
    PurchaseOrder.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

/** Order with its supplier, linked shipments and activity log. */
export async function getPurchaseOrderDetail(organizationId: Types.ObjectId, id: string) {
  const po = await PurchaseOrder.findOne({ _id: id, organizationId }).populate('supplierId').lean();
  if (!po) throw notFound('Purchase order');
  const [shipments, activity] = await Promise.all([
    Shipment.find({ organizationId, purchaseOrderId: po._id })
      .select('reference status carrierName serviceName expectedDeliveryDate deliveredAt freightCostMinor currency createdAt items quoteIsSimulated')
      .sort({ createdAt: -1 })
      .lean(),
    listAudit(organizationId, 'PURCHASE_ORDER', po._id, 100),
  ]);
  return { ...po, shipments, activity };
}

export async function createPurchaseOrder(organizationId: Types.ObjectId, actor: AuditActor, input: PoInput) {
  const { lines, totals } = await buildLines(organizationId, input);
  const poNumber = await nextReference(organizationId, 'PO', 5, input.orderDate);
  const po = await PurchaseOrder.create({
    organizationId,
    poNumber,
    supplierId: input.supplierId,
    orderDate: input.orderDate,
    expectedDeliveryDate: input.expectedDeliveryDate ?? undefined,
    destination: input.destination,
    currency: input.currency,
    lines,
    subtotalMinor: totals.subtotalMinor,
    taxRateBps: input.taxRateBps,
    taxMinor: totals.taxMinor,
    additionalChargesMinor: totals.additionalChargesMinor,
    totalMinor: totals.totalMinor,
    notes: input.notes,
    status: 'DRAFT',
    createdBy: actor.userId,
  });
  await recordAudit({ organizationId, entityType: 'PURCHASE_ORDER', entityId: po._id, action: 'CREATED', summary: `Purchase order ${poNumber} created as draft`, actor });
  return po;
}

export async function getPurchaseOrderDoc(organizationId: Types.ObjectId, id: string): Promise<PurchaseOrderDoc> {
  const po = await PurchaseOrder.findOne({ _id: id, organizationId });
  if (!po) throw notFound('Purchase order');
  return po;
}

export async function updatePurchaseOrder(organizationId: Types.ObjectId, id: string, actor: AuditActor, input: PoInput, expectedVersion?: number) {
  const po = await getPurchaseOrderDoc(organizationId, id);
  if (!PO_EDITABLE_STATUSES.includes(po.status as PoStatus)) {
    throw conflict(`Only draft purchase orders can be edited (current status: ${po.status})`);
  }
  if (expectedVersion !== undefined && po.__v !== expectedVersion) {
    throw conflict('This purchase order was modified by someone else. Reload and try again.');
  }
  const { lines, totals } = await buildLines(organizationId, input);
  po.set({
    supplierId: input.supplierId,
    orderDate: input.orderDate,
    expectedDeliveryDate: input.expectedDeliveryDate ?? undefined,
    destination: input.destination,
    currency: input.currency,
    lines,
    subtotalMinor: totals.subtotalMinor,
    taxRateBps: input.taxRateBps,
    taxMinor: totals.taxMinor,
    additionalChargesMinor: totals.additionalChargesMinor,
    totalMinor: totals.totalMinor,
    notes: input.notes,
  });
  await po.save();
  await recordAudit({ organizationId, entityType: 'PURCHASE_ORDER', entityId: po._id, action: 'UPDATED', summary: 'Draft updated', actor });
  return po;
}

async function transition(po: PurchaseOrderDoc, to: PoStatus, actor: AuditActor, summary: string, details?: unknown) {
  const from = po.status as PoStatus;
  if (!canTransitionPo(from, to)) throw invalidTransition('Purchase order', from, to);
  po.status = to;
  await po.save();
  await recordAudit({
    organizationId: po.organizationId, entityType: 'PURCHASE_ORDER', entityId: po._id,
    action: `STATUS_${to}`, summary, actor, details: { from, to, ...(details as object) },
  });
  return po;
}

export async function approvePurchaseOrder(organizationId: Types.ObjectId, id: string, actor: AuditActor) {
  const po = await getPurchaseOrderDoc(organizationId, id);
  const supplier = await Supplier.findOne({ _id: po.supplierId, organizationId }).select('isActive').lean();
  if (!supplier?.isActive) throw conflict('Cannot approve: the supplier is inactive');
  po.approvedBy = actor.userId;
  po.approvedAt = new Date();
  return transition(po, 'APPROVED', actor, `Approved by ${actor.name ?? 'admin'}`);
}

export async function markReadyToShip(organizationId: Types.ObjectId, id: string, actor: AuditActor) {
  const po = await getPurchaseOrderDoc(organizationId, id);
  po.readyToShipAt = new Date();
  return transition(po, 'READY_TO_SHIP', actor, 'Marked ready to ship');
}

export async function cancelPurchaseOrder(organizationId: Types.ObjectId, id: string, actor: AuditActor, reason?: string) {
  const po = await getPurchaseOrderDoc(organizationId, id);
  if (po.lines.some((l) => (l.receivedQuantity ?? 0) > 0)) {
    throw conflict('Goods have already been received against this order; it cannot be cancelled');
  }
  const activeShipments = await Shipment.countDocuments({
    organizationId, purchaseOrderId: po._id, status: { $in: OPEN_STATUSES },
  });
  if (activeShipments > 0) throw conflict('Cancel or complete the linked shipments before cancelling this purchase order');
  po.cancelledAt = new Date();
  po.cancellationReason = reason;
  return transition(po, 'CANCELLED', actor, reason ? `Cancelled: ${reason}` : 'Cancelled');
}


export async function receiveGoods(organizationId: Types.ObjectId, id: string, actor: AuditActor, input: ReceiptInput) {
  const po = await getPurchaseOrderDoc(organizationId, id);
  if (!PO_RECEIVABLE_STATUSES.includes(po.status as PoStatus)) {
    throw conflict(`Goods can only be received for orders that are ready to ship or partially received (current: ${po.status})`);
  }
  const receiptLines = input.lines.filter((l) => l.quantity !== 0);
  const result = applyReceipt(
    po.lines.map((l) => ({ id: String(l._id), quantity: l.quantity, receivedQuantity: l.receivedQuantity ?? 0 })),
    receiptLines,
  );
  if (!result.ok) {
    throw validationError('Receipt quantities are invalid', result.errors.map((e) => ({ path: `lines.${e.lineId}`, message: e.message })));
  }
  for (const line of po.lines) line.receivedQuantity = result.receivedByLine[String(line._id)]!;
  const receivedAt = input.receivedAt ?? new Date();
  po.receipts.push({
    receivedAt,
    receivedBy: actor.userId,
    receivedByName: actor.name,
    note: input.note,
    lines: receiptLines.map((l) => ({ lineId: new Types.ObjectId(l.lineId), quantity: l.quantity })),
  });
  if (result.nextStatus === 'RECEIVED') po.receivedAt = receivedAt;
  if (po.status !== result.nextStatus) {
    return transition(po, result.nextStatus, actor, `Goods received (${result.nextStatus === 'RECEIVED' ? 'complete' : 'partial'})`, { receipt: receiptLines });
  }
  await po.save();
  await recordAudit({ organizationId, entityType: 'PURCHASE_ORDER', entityId: po._id, action: 'GOODS_RECEIVED', summary: 'Partial goods receipt recorded', actor, details: { receipt: receiptLines } });
  return po;
}
