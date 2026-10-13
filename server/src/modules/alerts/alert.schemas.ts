import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination.js';
import { objectId, text } from '../../utils/validate.js';
import { ALERT_STATUSES } from './alert.model.js';
import { ALERT_SEVERITIES, ALERT_TYPES } from './exception-rules.js';

export const alertListQuery = paginationSchema.extend({
  /** UNRESOLVED = OPEN + ACKNOWLEDGED. */
  status: z.enum([...ALERT_STATUSES, 'UNRESOLVED', 'ALL']).default('UNRESOLVED'),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  type: z.enum(ALERT_TYPES).optional(),
  shipmentId: objectId.optional(),
});
export type AlertListQuery = z.infer<typeof alertListQuery>;

export const resolveInput = z.object({ note: text(1000).optional() });
export const feedQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
