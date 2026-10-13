import { DAY_MS, HOUR_MS, seededUnit } from '../../../utils/dates.js';
import { COUNTRIES, type Region } from '../../../utils/geo.js';
import type { ShipmentStatus } from '../../../modules/shipments/shipment.rules.js';
import type { NormalizedTrackingEvent, TrackingContext } from '../types.js';

/** Provider id stamped on every simulated quote, booking and tracking event. */
export const SIMULATOR_PROVIDER_ID = 'fluxora-simulator';

const HUBS: Record<Region, { city: string; country: string }> = {
  EUROPE: { city: 'Leipzig', country: 'DE' },
  NORTH_AMERICA: { city: 'Memphis', country: 'US' },
  SOUTH_AMERICA: { city: 'São Paulo', country: 'BR' },
  ASIA: { city: 'Hong Kong', country: 'HK' },
  MIDDLE_EAST: { city: 'Dubai', country: 'AE' },
  OCEANIA: { city: 'Sydney', country: 'AU' },
  AFRICA: { city: 'Johannesburg', country: 'ZA' },
};

export type SimOutcome = 'ON_TIME' | 'DELAYED' | 'EXCEPTION';

/** Deterministic outcome per tracking number: ~70% on time, ~20% delayed, ~10% exception. */
export function simulatedOutcome(trackingNumber: string): SimOutcome {
  const u = seededUnit(`outcome|${trackingNumber}`);
  if (u < 0.7) return 'ON_TIME';
  if (u < 0.9) return 'DELAYED';
  return 'EXCEPTION';
}

export interface PlannedStep {
  at: number;
  /** Undefined for position pings that do not change the shipment status. */
  status?: ShipmentStatus;
  description: string;
  city?: string;
  country?: string;
  isException?: boolean;
}

/** Builds the full planned event script for a simulated shipment. */
export function planSimulatedJourney(ctx: TrackingContext): PlannedStep[] {
  const booked = (ctx.bookedAt ?? new Date()).getTime();
  const expected = ctx.expectedDeliveryDate ? ctx.expectedDeliveryDate.getTime() : booked + 4 * DAY_MS;
  const span = Math.max(expected - booked, 12 * HOUR_MS);
  const outcome = (ctx.simulationOutcome as SimOutcome | undefined) ?? simulatedOutcome(ctx.trackingNumber);
  const originRegion = COUNTRIES[ctx.origin.country]?.region ?? 'EUROPE';
  const hub = HUBS[originRegion];
  const delay = outcome === 'ON_TIME' ? 0 : outcome === 'DELAYED' ? 1.5 * DAY_MS : 2 * DAY_MS;

  const steps: PlannedStep[] = [
    { at: booked + Math.min(4 * HOUR_MS, span * 0.05), status: 'PICKED_UP', description: 'Shipment picked up from shipper', city: ctx.origin.city, country: ctx.origin.country },
    { at: booked + span * 0.15, status: 'IN_TRANSIT', description: 'Departed origin facility', city: ctx.origin.city, country: ctx.origin.country },
    { at: booked + span * 0.4, status: 'IN_TRANSIT', description: 'Arrived at sort hub', city: hub.city, country: hub.country },
  ];
  if (outcome === 'DELAYED') {
    steps.push({ at: booked + span * 0.55, status: 'DELAYED', description: 'Delay reported: missed onward connection at hub', city: hub.city, country: hub.country, isException: true });
    steps.push({ at: booked + span * 0.55 + delay * 0.6, status: 'IN_TRANSIT', description: 'Departed hub on rebooked connection', city: hub.city, country: hub.country });
  } else if (outcome === 'EXCEPTION') {
    steps.push({ at: booked + span * 0.6, status: 'EXCEPTION', description: 'Held for customs inspection — documentation requested', city: ctx.destination.city, country: ctx.destination.country, isException: true });
    steps.push({ at: booked + span * 0.6 + delay * 0.7, status: 'IN_TRANSIT', description: 'Released by customs', city: ctx.destination.city, country: ctx.destination.country });
  } else {
    steps.push({ at: booked + span * 0.6, status: 'IN_TRANSIT', description: 'Departed sort hub', city: hub.city, country: hub.country });
  }
  steps.push({ at: booked + span * 0.82 + delay, status: 'IN_TRANSIT', description: 'Arrived at destination facility', city: ctx.destination.city, country: ctx.destination.country });
  steps.push({ at: expected - 6 * HOUR_MS + delay, status: 'OUT_FOR_DELIVERY', description: 'Out for delivery', city: ctx.destination.city, country: ctx.destination.country });
  steps.push({ at: expected - 2 * HOUR_MS + delay, status: 'DELIVERED', description: 'Delivered — signed for at receiving dock', city: ctx.destination.city, country: ctx.destination.country });

  // Keep the script monotonic.
  for (let i = 1; i < steps.length; i++) {
    if (steps[i]!.at <= steps[i - 1]!.at) steps[i]!.at = steps[i - 1]!.at + 30 * 60_000;
  }

  // Long journeys (sea / road) get a daily position ping so tracking never goes silent for days.
  const withPings: PlannedStep[] = [];
  steps.forEach((step, i) => {
    withPings.push(step);
    const next = steps[i + 1];
    if (!next || step.status === 'DELIVERED') return;
    for (let t = step.at + DAY_MS; t < next.at - 6 * HOUR_MS; t += DAY_MS) {
      withPings.push({ at: t, description: 'In transit — position update received', city: step.city, country: step.country });
    }
  });
  return withPings;
}

/** Index (exclusive) up to which events must be released to reach the next status milestone. */
export function nextMilestoneIndex(ctx: TrackingContext, recorded: number): number {
  const steps = planSimulatedJourney(ctx);
  for (let i = recorded; i < steps.length; i++) if (steps[i]!.status) return i + 1;
  return steps.length;
}

/**
 * Returns simulated events that have "happened": every step whose planned time has
 * passed, plus any steps force-advanced by the user (index < simulationStep), which
 * are stamped with the current time. All events are flagged isSimulated=true.
 */
export function buildSimulatedTrackingEvents(ctx: TrackingContext, now: Date): NormalizedTrackingEvent[] {
  const steps = planSimulatedJourney(ctx);
  const forced = ctx.simulationStep ?? 0;
  const out: NormalizedTrackingEvent[] = [];
  let lastAt = 0;
  steps.forEach((s, i) => {
    const due = s.at <= now.getTime();
    if (!due && i >= forced) return;
    if (out.length !== i) return; // events are strictly sequential
    const at = Math.max(Math.min(s.at, now.getTime()), lastAt + 1000);
    lastAt = at;
    out.push({
      externalEventId: `${ctx.trackingNumber}:${i}`,
      occurredAt: new Date(at).toISOString(),
      location: { city: s.city, country: s.country },
      description: s.description,
      status: s.status,
      isException: s.isException,
      provenance: {
        sourceType: 'SIMULATED',
        provider: SIMULATOR_PROVIDER_ID,
        retrievedAt: now.toISOString(),
        isSimulated: true,
        limitations: ['Simulated tracking event — not reported by the carrier.'],
      },
    });
  });
  return out;
}
