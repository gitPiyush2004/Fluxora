import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { objectId } from '../../utils/validate.js';
import { ORG_ROLES } from './organization.model.js';

const hours = z.number().min(1).max(24 * 60);
const weight = z.number().min(0).max(100);

/** Every settings field is optional: PATCH merges what is sent into the current settings. */
const settingsPatch = z
  .object({
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
    volumetricDivisor: z.number().int().min(1000).max(10000),
    recommendationWeights: z
      .object({ cost: weight, transit: weight, reliability: weight })
      .refine((w) => w.cost + w.transit + w.reliability > 0, 'At least one recommendation weight must be positive'),
    reliabilityMinSamples: z.number().int().min(1).max(1000),
    exceptionRules: z
      .object({
        stuckThresholdsHours: z
          .object({ BOOKED: hours, PICKED_UP: hours, IN_TRANSIT: hours, OUT_FOR_DELIVERY: hours, DELAYED: hours, EXCEPTION: hours })
          .partial(),
        trackingStaleHours: hours,
        overdueGraceHours: z.number().min(0).max(24 * 30),
      })
      .partial(),
  })
  .partial();

export const updateOrganizationInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  settings: settingsPatch.optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInput>;

export const inviteInput = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(ORG_ROLES).default('MEMBER'),
});
export type InviteInput = z.infer<typeof inviteInput>;

export const memberParams = z.object({ userId: objectId });
export const roleInput = z.object({ role: z.enum(ORG_ROLES) });
