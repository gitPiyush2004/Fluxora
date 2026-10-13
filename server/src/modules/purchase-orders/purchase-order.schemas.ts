import { z } from 'zod';
import { COUNTRY_CODES } from '../../utils/geo.js';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { paginationSchema, sortSchema } from '../../utils/pagination.js';
import { csvList, objectId, requiredText, text } from '../../utils/validate.js';
import { UNITS_OF_MEASURE } from '../products/product.model.js';
import { PO_STATUSES } from './purchase-order.rules.js';

const quantity = z
  .number()
  .positive('Quantity must be greater than zero')
  .max(1_000_000)
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'At most 3 decimal places');

export const poLineInput = z.object({
  productId: objectId.optional(),
  description: requiredText(300),
  quantity,
  unitOfMeasure: z.enum(UNITS_OF_MEASURE).optional(),
  unitPriceMinor: z.number().int('Unit price must be integer minor units').min(0).max(1e12),
});

/** Totals are not accepted from the client: the server always calculates them. */
export const poInput = z.object({
  supplierId: objectId,
  orderDate: z.coerce.date(),
  expectedDeliveryDate: z.coerce.date().optional().nullable(),
  destination: z.object({
    name: text(160).optional(),
    address: text(300).optional(),
    city: requiredText(120),
    postalCode: text(20).optional(),
    country: z.enum(COUNTRY_CODES),
  }),
  currency: z.enum(SUPPORTED_CURRENCIES),
  lines: z.array(poLineInput).min(1, 'Add at least one line item').max(200),
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  additionalChargesMinor: z.number().int().min(0).max(1e12).default(0),
  notes: text(2000).optional(),
});
export type PoInput = z.infer<typeof poInput>;

/** Update = same body as create, plus the version the user edited (optimistic concurrency). */
export const updatePoInput = poInput.extend({ version: z.number().int().min(0).optional() });

export const receiptInput = z.object({
  lines: z.array(z.object({ lineId: objectId, quantity: z.number() })).min(1).max(200),
  note: text(500).optional(),
  receivedAt: z.coerce.date().optional(),
});
export type ReceiptInput = z.infer<typeof receiptInput>;

export const cancelInput = z.object({ reason: text(500).optional() });

export const poListQuery = paginationSchema
  .extend(sortSchema(['orderDate', 'poNumber', 'totalMinor', 'expectedDeliveryDate', 'status', 'createdAt'] as const, 'orderDate').shape)
  .extend({
    search: z.string().trim().max(100).optional(),
    status: csvList(PO_STATUSES).optional(),
    supplierId: objectId.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  });
export type PoListQuery = z.infer<typeof poListQuery>;
