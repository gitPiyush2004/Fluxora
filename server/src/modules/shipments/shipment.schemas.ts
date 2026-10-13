import { z } from 'zod';
import { CARRIER_CODES } from '../../integrations/carriers/types.js';
import { COUNTRY_CODES } from '../../utils/geo.js';
import { SUPPORTED_CURRENCIES } from '../../utils/money.js';
import { paginationSchema, sortSchema } from '../../utils/pagination.js';
import { csvList, objectId, requiredText, text } from '../../utils/validate.js';
import { MANUAL_UPDATE_STATUSES, SERVICE_LEVELS, SHIPMENT_STATUSES, SHIPMENT_TYPES, SPECIAL_HANDLING } from './shipment.rules.js';

export const placeInput = z.object({
  name: text(160).optional(),
  address: text(300).optional(),
  city: requiredText(120),
  postalCode: text(20).regex(/^[A-Za-z0-9 -]*$/, 'Invalid postal code').optional(),
  country: z.enum(COUNTRY_CODES, 'Select a supported country'),
});

const dimension = z.number().positive().max(2000);

/** Fields of a shipment specification (route, packages, requirements). */
const specFields = z.object({
  origin: placeInput,
  destination: placeInput,
  shipmentType: z.enum(SHIPMENT_TYPES),
  packageCount: z.number().int().min(1).max(10_000),
  actualWeightKg: z.number().positive('Weight must be greater than zero').max(1_000_000),
  lengthCm: dimension.optional(),
  widthCm: dimension.optional(),
  heightCm: dimension.optional(),
  requiredDeliveryDate: z.coerce.date().optional().nullable(),
  /** Omit (or null) to compare all service levels. */
  servicePreference: z.enum(SERVICE_LEVELS).optional().nullable(),
  cargoValueMinor: z.number().int().min(0).max(1e13).optional().nullable(),
  cargoCurrency: z.enum(SUPPORTED_CURRENCIES).optional().nullable(),
  insuranceRequired: z.boolean().default(false),
  specialHandling: z.array(z.enum(SPECIAL_HANDLING)).max(SPECIAL_HANDLING.length).default([]),
  maxBudgetMinor: z.number().int().min(0).max(1e13).optional().nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  shipDate: z.coerce.date().optional(),
});

/** Shipment specification used for both quoting and shipment records, with cross-field rules. */
export const shipmentSpecInput = specFields.superRefine((v, ctx) => {
  const dimsProvided = [v.lengthCm, v.widthCm, v.heightCm].filter((d) => d != null).length;
  if (dimsProvided !== 0 && dimsProvided !== 3) {
    ctx.addIssue({ code: 'custom', path: ['lengthCm'], message: 'Provide length, width and height together (or none)' });
  }
  if (v.insuranceRequired && !v.cargoValueMinor) {
    ctx.addIssue({ code: 'custom', path: ['cargoValueMinor'], message: 'Cargo value is required when insurance is requested' });
  }
  const samePlace =
    v.origin.country === v.destination.country &&
    v.origin.city.trim().toLowerCase() === v.destination.city.trim().toLowerCase() &&
    (v.origin.postalCode ?? '') === (v.destination.postalCode ?? '');
  if (samePlace) {
    ctx.addIssue({ code: 'custom', path: ['destination', 'city'], message: 'Origin and destination must differ' });
  }
  if (v.requiredDeliveryDate) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (v.requiredDeliveryDate < today) {
      ctx.addIssue({ code: 'custom', path: ['requiredDeliveryDate'], message: 'Required delivery date is in the past' });
    }
  }
});
export type ShipmentSpecInput = z.infer<typeof shipmentSpecInput>;

export const shipmentItemInput = z.object({
  poLineId: objectId.optional(),
  sku: text(64).optional(),
  description: requiredText(300),
  quantity: z.number().min(0).max(1_000_000),
  unitOfMeasure: text(16).optional(),
});

export const createShipmentInput = z.object({
  spec: shipmentSpecInput,
  contentsDescription: text(500).optional(),
  notes: text(2000).optional(),
  items: z.array(shipmentItemInput).max(200).default([]),
  /** Optionally create the shipment directly from a quote obtained on the Compare page. */
  quoteId: objectId.optional(),
});
export type CreateShipmentInput = z.infer<typeof createShipmentInput>;

export const updateShipmentInput = z.object({
  spec: shipmentSpecInput.optional(),
  contentsDescription: text(500).optional(),
  notes: text(2000).optional(),
  items: z.array(shipmentItemInput).max(200).optional(),
});
export type UpdateShipmentInput = z.infer<typeof updateShipmentInput>;

/**
 * Shipment from a purchase order. Destination, currency and cargo value come from the PO
 * and the origin defaults to the supplier, so the client only sends the package details.
 * The combined spec is then validated with `shipmentSpecInput` like any other shipment.
 */
export const createFromPoInput = z.object({
  spec: specFields
    .pick({
      shipmentType: true, packageCount: true, actualWeightKg: true, lengthCm: true, widthCm: true, heightCm: true,
      requiredDeliveryDate: true, servicePreference: true, insuranceRequired: true, specialHandling: true, maxBudgetMinor: true,
    })
    .extend({ origin: placeInput.optional() }),
  items: z.array(z.object({ poLineId: objectId, quantity: z.number().positive() })).min(1, 'Select at least one line to ship'),
  notes: text(2000).optional(),
});
export type CreateFromPoInput = z.infer<typeof createFromPoInput>;

export const bookingInput = z.discriminatedUnion('mode', [
  /** Book through the carrier adapter (the simulator for simulated offers). */
  z.object({ mode: z.literal('PROVIDER') }),
  /** Record a booking the user made directly with the carrier. */
  z.object({
    mode: z.literal('MANUAL'),
    bookingReference: z.string().trim().min(2).max(120),
    trackingNumber: z.string().trim().min(4).max(120).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only').optional(),
    expectedDeliveryDate: z.coerce.date().optional(),
  }),
]);
export type BookingInput = z.infer<typeof bookingInput>;

/** Format of the `Idempotency-Key` request header required for bookings. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

export const selectQuoteInput = z.object({ quoteId: objectId });
export const cancelInput = z.object({ reason: text(500).optional() });

export const manualUpdateInput = z.object({
  status: z.enum(MANUAL_UPDATE_STATUSES).optional(),
  description: requiredText(500),
  occurredAt: z.coerce.date().optional(),
  city: text(120).optional(),
  country: z.enum(COUNTRY_CODES).optional(),
});
export type ManualUpdateInput = z.infer<typeof manualUpdateInput>;

export const shipmentListQuery = paginationSchema
  .extend(sortSchema(['createdAt', 'reference', 'expectedDeliveryDate', 'freightCostMinor', 'status', 'updatedAt'] as const, 'createdAt').shape)
  .extend({
    search: z.string().trim().max(100).optional(),
    status: csvList(SHIPMENT_STATUSES).optional(),
    carrier: z.enum(CARRIER_CODES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    purchaseOrderId: objectId.optional(),
  });
export type ShipmentListQuery = z.infer<typeof shipmentListQuery>;

export const eventListQuery = paginationSchema.extend({ order: z.enum(['asc', 'desc']).default('desc') });
export type EventListQuery = z.infer<typeof eventListQuery>;
