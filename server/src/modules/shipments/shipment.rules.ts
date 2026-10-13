export const SHIPMENT_STATUSES = [
  'DRAFT',
  'QUOTED',
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELAYED',
  'EXCEPTION',
  'CANCELLED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_TYPES = ['PARCEL', 'BOX', 'PALLET', 'FREIGHT'] as const;
export type ShipmentType = (typeof SHIPMENT_TYPES)[number];

export const SERVICE_LEVELS = ['ECONOMY', 'STANDARD', 'EXPRESS'] as const;
export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

export const SPECIAL_HANDLING = ['DANGEROUS_GOODS', 'TEMPERATURE_CONTROLLED', 'FRAGILE', 'OVERSIZED', 'LIFTGATE'] as const;
export type SpecialHandling = (typeof SPECIAL_HANDLING)[number];

/**
 * Allowed lifecycle transitions. DRAFT/QUOTED are planning states; BOOKED onwards
 * are operational and normally driven by carrier tracking events. QUOTED → QUOTED
 * lets the user pick a different offer.
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  DRAFT: ['QUOTED', 'CANCELLED'],
  QUOTED: ['DRAFT', 'QUOTED', 'BOOKED', 'CANCELLED'],
  BOOKED: ['PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'EXCEPTION', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', 'EXCEPTION', 'DELIVERED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELAYED', 'EXCEPTION', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELAYED', 'EXCEPTION', 'IN_TRANSIT'],
  DELAYED: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'],
  EXCEPTION: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', 'DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

// ---- Status groups (named once, used everywhere) ----

/** Before booking: details can change and quotes can be requested. */
export const PLANNING_STATUSES: readonly ShipmentStatus[] = ['DRAFT', 'QUOTED'];
/** Booked and not yet finished: tracked, monitored for exceptions. */
export const TRACKABLE_STATUSES: readonly ShipmentStatus[] = ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', 'EXCEPTION'];
/** Not finished yet (planning or trackable). */
export const OPEN_STATUSES: readonly ShipmentStatus[] = [...PLANNING_STATUSES, ...TRACKABLE_STATUSES];
/** Statuses a user may record through a manual tracking update. */
export const MANUAL_UPDATE_STATUSES = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELAYED', 'EXCEPTION'] as const;
/** Booked shipments can be cancelled only before pickup (and only if the provider supports it). */
export const CANCELLABLE_STATUSES: readonly ShipmentStatus[] = ['DRAFT', 'QUOTED', 'BOOKED', 'EXCEPTION'];
