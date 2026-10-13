import { z } from 'zod';
import { COUNTRY_CODES } from '../../utils/geo.js';
import { paginationSchema, sortSchema } from '../../utils/pagination.js';
import { requiredText, text } from '../../utils/validate.js';

export const supplierInput = z.object({
  supplierRef: requiredText(40).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes or underscores'),
  name: requiredText(160),
  contactPerson: text(120).optional(),
  email: z.email('Enter a valid email address').max(254),
  phone: text(40).regex(/^[0-9+()\-.\s]*$/, 'Invalid phone number').optional(),
  country: z.enum(COUNTRY_CODES),
  city: requiredText(120),
  postalCode: text(20).optional(),
  address: text(300).optional(),
});
export type SupplierInput = z.infer<typeof supplierInput>;

export const supplierListQuery = paginationSchema
  .extend(sortSchema(['name', 'supplierRef', 'country', 'createdAt'] as const, 'name').shape)
  .extend({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('all'),
    country: z.enum(COUNTRY_CODES).optional(),
  });
export type SupplierListQuery = z.infer<typeof supplierListQuery>;
