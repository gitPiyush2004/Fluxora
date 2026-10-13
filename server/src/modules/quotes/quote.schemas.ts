import { z } from 'zod';
import { CARRIER_CODES } from '../../integrations/carriers/types.js';
import { objectId } from '../../utils/validate.js';
import { shipmentSpecInput } from '../shipments/shipment.schemas.js';

const weight = z.number().min(0).max(100);

/** Recommendation weights (relative importance, 0–100 each, at least one above zero). */
export const weightsInput = z
  .object({ cost: weight, transit: weight, reliability: weight })
  .refine((w) => w.cost + w.transit + w.reliability > 0, 'At least one weight must be greater than zero');

const carriersInput = z.array(z.enum(CARRIER_CODES)).optional();

/** Stand-alone comparison from the Compare page. */
export const compareInput = z.object({ spec: shipmentSpecInput, weights: weightsInput.optional(), carriers: carriersInput });

/** Comparison for an existing shipment (the spec comes from the shipment). */
export const shipmentQuotesInput = z.object({ weights: weightsInput.optional(), carriers: carriersInput });

export const rankInput = z.object({ weights: weightsInput });
export const shipmentRankInput = z.object({ quoteRequestId: objectId, weights: weightsInput });

export const billableWeightInput = z.object({
  actualWeightKg: z.number().positive().max(1_000_000),
  packageCount: z.number().int().min(1).max(10_000),
  lengthCm: z.number().positive().max(2000).optional(),
  widthCm: z.number().positive().max(2000).optional(),
  heightCm: z.number().positive().max(2000).optional(),
  divisor: z.number().int().min(1000).max(10000).default(5000),
});
