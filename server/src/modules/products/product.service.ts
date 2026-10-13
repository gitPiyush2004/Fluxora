import type { Types } from 'mongoose';
import { notFound } from '../../utils/errors.js';
import { escapeRegex, pageMeta } from '../../utils/pagination.js';
import { recordAudit, type AuditActor } from '../audit/audit.model.js';
import { Product } from './product.model.js';
import type { ProductInput, ProductListQuery } from './product.schemas.js';

/** Lists products; `categories` (for the filter dropdown) is returned alongside the page. */
export async function listProducts(organizationId: Types.ObjectId, q: ProductListQuery) {
  const filter: Record<string, unknown> = { organizationId };
  if (q.status !== 'all') filter.isActive = q.status === 'active';
  if (q.category) filter.category = q.category;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { category: rx }];
  }
  const [items, total, categories] = await Promise.all([
    Product.find(filter)
      .sort({ [q.sortBy]: q.sortDir === 'asc' ? 1 : -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Product.countDocuments(filter),
    Product.distinct('category', { organizationId, category: { $nin: [null, ''] } }),
  ]);
  return { items, meta: { ...pageMeta(q.page, q.pageSize, total), categories: categories.sort() } };
}

export async function getProduct(organizationId: Types.ObjectId, id: string) {
  const product = await Product.findOne({ _id: id, organizationId }).lean();
  if (!product) throw notFound('Product');
  return product;
}

export async function createProduct(organizationId: Types.ObjectId, actor: AuditActor, input: ProductInput) {
  const product = await Product.create({ ...input, organizationId });
  await recordAudit({ organizationId, entityType: 'PRODUCT', entityId: product._id, action: 'CREATED', summary: `Product ${product.sku} created`, actor });
  return product;
}

export async function updateProduct(organizationId: Types.ObjectId, id: string, actor: AuditActor, input: Partial<ProductInput>) {
  const product = await Product.findOneAndUpdate({ _id: id, organizationId }, { $set: input }, { returnDocument: 'after', runValidators: true });
  if (!product) throw notFound('Product');
  await recordAudit({
    organizationId, entityType: 'PRODUCT', entityId: product._id, action: 'UPDATED',
    summary: 'Product updated', actor, details: { fields: Object.keys(input) },
  });
  return product;
}

export async function setProductActive(organizationId: Types.ObjectId, id: string, actor: AuditActor, isActive: boolean) {
  const product = await Product.findOneAndUpdate({ _id: id, organizationId }, { $set: { isActive } }, { returnDocument: 'after' });
  if (!product) throw notFound('Product');
  await recordAudit({
    organizationId, entityType: 'PRODUCT', entityId: product._id, action: isActive ? 'ACTIVATED' : 'DEACTIVATED',
    summary: `Product ${isActive ? 'activated' : 'deactivated'}`, actor,
  });
  return product;
}
