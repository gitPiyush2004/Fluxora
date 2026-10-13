import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { paginationSchema, sortSchema } from '../../utils/pagination.js';
import { requiredText, text } from '../../utils/validate.js';
import { UNITS_OF_MEASURE } from './product.model.js';

export const productInput = z.object({
  sku: requiredText(64).regex(/^[A-Za-z0-9._/-]+$/, 'SKU may contain letters, numbers, . _ / -'),
  name: requiredText(160),
  description: text(1000).optional(),
  category: text(80).optional(),
  unitOfMeasure: z.enum(UNITS_OF_MEASURE),
  defaultUnitCostMinor: z.number().int('Amount must be in minor units').min(0).max(1e12),
  currency: z.enum(SUPPORTED_CURRENCIES),
});
export type ProductInput = z.infer<typeof productInput>;

export const productListQuery = paginationSchema
  .extend(sortSchema(['name', 'sku', 'category', 'defaultUnitCostMinor', 'createdAt'] as const, 'name').shape)
  .extend({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('all'),
    category: z.string().trim().max(80).optional(),
  });
export type ProductListQuery = z.infer<typeof productListQuery>;
