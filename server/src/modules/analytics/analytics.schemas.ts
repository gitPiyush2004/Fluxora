import { z } from 'zod';
import { CARRIER_CODES } from '../../integrations/carriers/types.js';
import { csvList } from '../../utils/validate.js';
import { PO_STATUSES } from '../purchase-orders/purchase-order.rules.js';
import { SHIPMENT_STATUSES } from '../shipments/shipment.rules.js';

export const analyticsQuery = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    carrier: z.enum(CARRIER_CODES).optional(),
    status: csvList(SHIPMENT_STATUSES).optional(),
    poStatus: csvList(PO_STATUSES).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be before "to"', path: ['from'] });
