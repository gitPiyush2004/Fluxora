import type { ShipmentStatus } from '../../modules/shipments/shipment.rules.js';

/** Maps free-text carrier event descriptions to internal statuses when codes are ambiguous. */
export function statusFromDescription(description: string): ShipmentStatus | undefined {
  const d = description.toLowerCase();
  if (/out for delivery|with delivery courier|on vehicle for delivery/.test(d)) return 'OUT_FOR_DELIVERY';
  if (/\bdelivered\b/.test(d) && !/not delivered|undeliverable|attempt/.test(d)) return 'DELIVERED';
  if (/picked up|pickup completed|shipment picked/.test(d)) return 'PICKED_UP';
  if (/delay|missed connection|rescheduled/.test(d)) return 'DELAYED';
  if (/exception|customs hold|held|damaged|returned to sender|address issue/.test(d)) return 'EXCEPTION';
  return undefined;
}
