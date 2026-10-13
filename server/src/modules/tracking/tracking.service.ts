import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { DHL_TRACKING_PROVIDER } from '../../integrations/carriers/dhl/dhl-tracking.client.js';
import { nextMilestoneIndex } from '../../integrations/carriers/simulator/simulated-tracking.js';
import { CarrierError, type CarrierCode, type NormalizedTrackingEvent, type TrackingContext } from '../../integrations/carriers/types.js';
import { emitToOrg } from '../../sockets/realtime.js';
import { conflict, invalidTransition, notFound, notSupported, providerError } from '../../utils/errors.js';
import { DAY_MS } from '../../utils/dates.js';
import { pageMeta } from '../../utils/pagination.js';
import type { AuditActor } from '../audit/audit.model.js';
import { evaluateShipmentAlerts, rulesForOrg } from '../alerts/alert.service.js';
import { trackingAdapterFor } from '../carriers/carrier.registry.js';
import { Shipment, type ShipmentDoc } from '../shipments/shipment.model.js';
import { canTransitionShipment, PLANNING_STATUSES, TRACKABLE_STATUSES, type ShipmentStatus } from '../shipments/shipment.rules.js';
import type { EventListQuery, ManualUpdateInput } from '../shipments/shipment.schemas.js';
import { EVENT_TYPES, ShipmentEvent } from './shipment-event.model.js';

type EventType = (typeof EVENT_TYPES)[number];

export interface EventInput {
  type: EventType;
  description: string;
  occurredAt?: Date;
  location?: { city?: string; country?: string; description?: string };
  previousStatus?: ShipmentStatus;
  newStatus?: ShipmentStatus;
  source: { type: 'CARRIER_API' | 'SIMULATED' | 'USER' | 'SYSTEM'; provider?: string; isSimulated: boolean; sandbox?: boolean };
  externalEventId?: string;
  rawStatusCode?: string;
  isException?: boolean;
  actor?: AuditActor;
  metadata?: unknown;
}

/** Appends an event. Returns null when the external event was already recorded (dedupe). */
export async function appendShipmentEvent(shipment: Pick<ShipmentDoc, '_id' | 'organizationId'>, input: EventInput) {
  try {
    const event = await ShipmentEvent.create({
      organizationId: shipment.organizationId,
      shipmentId: shipment._id,
      type: input.type,
      occurredAt: input.occurredAt ?? new Date(),
      description: input.description.slice(0, 500),
      location: input.location,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      source: input.source,
      externalEventId: input.externalEventId,
      rawStatusCode: input.rawStatusCode,
      isException: input.isException ?? false,
      actorId: input.actor?.userId,
      actorName: input.actor?.name,
      metadata: input.metadata,
    });
    return event;
  } catch (err) {
    if ((err as { code?: number }).code === 11000 && input.externalEventId) return null;
    throw err;
  }
}

/** Applies a validated status change to the in-memory shipment document (caller saves). */
export function applyStatus(shipment: ShipmentDoc, to: ShipmentStatus, at: Date): ShipmentStatus {
  const from = shipment.status as ShipmentStatus;
  if (!canTransitionShipment(from, to)) throw invalidTransition('Shipment', from, to);
  shipment.status = to;
  shipment.statusChangedAt = at;
  if (to === 'PICKED_UP' && !shipment.pickedUpAt) shipment.pickedUpAt = at;
  // If the first movement scan skips an explicit pickup, use it as the pickup time.
  if ((to === 'IN_TRANSIT' || to === 'OUT_FOR_DELIVERY' || to === 'DELIVERED') && !shipment.pickedUpAt) shipment.pickedUpAt = at;
  if (to === 'DELIVERED') shipment.deliveredAt = at;
  return from;
}

/** Tells every open browser in the organisation that this shipment changed (call after saving). */
export function publishShipment(shipment: ShipmentDoc) {
  emitToOrg(shipment.organizationId, 'shipment:updated', {
    id: String(shipment._id),
    reference: shipment.reference,
    status: shipment.status,
    statusChangedAt: shipment.statusChangedAt,
    lastKnownLocation: shipment.lastKnownLocation,
  });
}

/**
 * Ingests normalized tracking events: de-duplicates, records history, applies valid
 * status transitions, then (after the DB writes succeed) publishes socket updates and
 * re-evaluates exception rules.
 */
export async function ingestTrackingEvents(shipment: ShipmentDoc, events: NormalizedTrackingEvent[]) {
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const inserted = [];
  let statusChanged = false;
  for (const e of sorted) {
    const occurredAt = new Date(e.occurredAt);
    const current = shipment.status as ShipmentStatus;
    const target = e.status && e.status !== current && canTransitionShipment(current, e.status) ? e.status : undefined;
    const locationLabel = [e.location?.city, e.location?.country].filter(Boolean).join(', ');
    const event = await appendShipmentEvent(shipment, {
      type: target ? 'STATUS_CHANGE' : 'TRACKING',
      description: e.description,
      occurredAt,
      location: e.location,
      previousStatus: target ? current : undefined,
      newStatus: target,
      source: {
        type: e.provenance.isSimulated ? 'SIMULATED' : 'CARRIER_API',
        provider: e.provenance.provider,
        isSimulated: e.provenance.isSimulated,
        sandbox: e.provenance.sourceType === 'SANDBOX_QUOTE',
      },
      externalEventId: e.externalEventId,
      rawStatusCode: e.rawStatusCode,
      isException: e.isException,
      metadata: e.status && !target && e.status !== current ? { ignoredStatus: e.status, reason: `Transition ${current} → ${e.status} not allowed` } : undefined,
    });
    if (!event) continue;
    inserted.push(event);
    if (target) {
      applyStatus(shipment, target, occurredAt);
      statusChanged = true;
    }
    if (!shipment.lastTrackingUpdateAt || occurredAt > shipment.lastTrackingUpdateAt) {
      shipment.lastTrackingUpdateAt = occurredAt;
      if (locationLabel) shipment.lastKnownLocation = locationLabel;
    }
  }
  shipment.lastTrackingPollAt = new Date();
  shipment.lastTrackingError = undefined;
  await shipment.save();

  for (const ev of inserted) emitToOrg(shipment.organizationId, 'shipment:event', { shipmentId: String(shipment._id), reference: shipment.reference, event: ev.toJSON() });
  if (inserted.length || statusChanged) publishShipment(shipment);
  if (inserted.length) await evaluateShipmentAlerts(shipment, await rulesForOrg(shipment.organizationId));
  return { newEvents: inserted.length, status: shipment.status };
}

function trackingContext(s: ShipmentDoc): TrackingContext {
  return {
    trackingNumber: s.trackingNumber!,
    bookedAt: s.booking?.bookedAt ?? undefined,
    expectedDeliveryDate: s.expectedDeliveryDate ?? undefined,
    origin: { city: s.origin.city, country: s.origin.country, postalCode: s.origin.postalCode ?? undefined },
    destination: { city: s.destination.city, country: s.destination.country, postalCode: s.destination.postalCode ?? undefined },
    serviceLevel: (s.serviceLevel ?? undefined) as TrackingContext['serviceLevel'],
    simulationStep: s.simulation?.nextStep ?? 0,
    simulationOutcome: s.simulation?.outcome ?? undefined,
  };
}

export async function refreshShipmentTracking(shipment: ShipmentDoc) {
  if (!shipment.trackingNumber) throw conflict('This shipment has no tracking number yet');
  if (shipment.trackingMode !== 'LIVE' && shipment.trackingMode !== 'SIMULATED') {
    throw notSupported('Automatic tracking is not available for this shipment. Record updates manually.');
  }
  const adapter = trackingAdapterFor(shipment.carrierCode as CarrierCode, shipment.trackingMode);
  if (!adapter?.getTracking) throw notSupported(`No ${shipment.trackingMode.toLowerCase()} tracking integration is configured for ${shipment.carrierName}`);
  let events: NormalizedTrackingEvent[];
  try {
    events = await adapter.getTracking(trackingContext(shipment), AbortSignal.timeout(env.CARRIER_TIMEOUT_MS));
  } catch (err) {
    const message = err instanceof CarrierError ? err.message : 'Tracking provider request failed';
    shipment.lastTrackingPollAt = new Date();
    shipment.lastTrackingError = message.slice(0, 300);
    await shipment.save();
    throw providerError(message, { carrier: shipment.carrierCode, kind: err instanceof CarrierError ? err.kind : 'UNKNOWN' });
  }
  return ingestTrackingEvents(shipment, events);
}

export async function refreshTrackingById(organizationId: Types.ObjectId, id: string) {
  const shipment = await Shipment.findOne({ _id: id, organizationId });
  if (!shipment) throw notFound('Shipment');
  return refreshShipmentTracking(shipment);
}

/** Demo helper: releases scripted simulated events up to the next status milestone immediately. */
export async function advanceSimulation(organizationId: Types.ObjectId, id: string) {
  const shipment = await Shipment.findOne({ _id: id, organizationId });
  if (!shipment) throw notFound('Shipment');
  if (shipment.trackingMode !== 'SIMULATED') throw conflict('Only shipments with simulated tracking can be advanced');
  if (!TRACKABLE_STATUSES.includes(shipment.status as ShipmentStatus)) throw conflict('Only booked, unfinished shipments can be advanced');
  const recorded = await ShipmentEvent.countDocuments({ shipmentId: shipment._id, 'source.type': 'SIMULATED', externalEventId: { $type: 'string' } });
  shipment.set('simulation.nextStep', nextMilestoneIndex(trackingContext(shipment), recorded));
  return refreshShipmentTracking(shipment);
}

/** Records a user-entered status update (manual tracking, e.g. for carriers without an API). */
export async function recordManualUpdate(
  organizationId: Types.ObjectId,
  id: string,
  actor: AuditActor,
  input: ManualUpdateInput,
) {
  const shipment = await Shipment.findOne({ _id: id, organizationId });
  if (!shipment) throw notFound('Shipment');
  if (input.status && PLANNING_STATUSES.includes(shipment.status as ShipmentStatus)) throw conflict('Book the shipment before recording movement updates');
  const occurredAt = input.occurredAt ?? new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw conflict('Event time cannot be in the future');

  let previous: ShipmentStatus | undefined;
  if (input.status && input.status !== shipment.status) previous = applyStatus(shipment, input.status, occurredAt);
  const event = await appendShipmentEvent(shipment, {
    type: previous ? 'STATUS_CHANGE' : 'NOTE',
    description: input.description,
    occurredAt,
    location: input.city || input.country ? { city: input.city, country: input.country } : undefined,
    previousStatus: previous,
    newStatus: previous ? input.status : undefined,
    source: { type: 'USER', isSimulated: false },
    actor,
  });
  if (!shipment.lastTrackingUpdateAt || occurredAt > shipment.lastTrackingUpdateAt) {
    shipment.lastTrackingUpdateAt = occurredAt;
    if (input.city) shipment.lastKnownLocation = [input.city, input.country].filter(Boolean).join(', ');
  }
  await shipment.save();
  emitToOrg(organizationId, 'shipment:event', { shipmentId: String(shipment._id), reference: shipment.reference, event: event?.toJSON() });
  publishShipment(shipment);
  await evaluateShipmentAlerts(shipment, await rulesForOrg(organizationId));
  return { shipment, event };
}

const LIVE_MIN_POLL_MS = 30 * 60_000;
const LIVE_CALL_GAP_MS = 5_000;

/** Background job body: refreshes automated tracking for in-flight shipments. */
export async function pollActiveTracking(now = new Date()) {
  const cursor = Shipment.find({
    trackingMode: { $in: ['SIMULATED', 'LIVE'] },
    trackingNumber: { $type: 'string' },
    status: { $in: TRACKABLE_STATUSES },
  }).cursor();
  let refreshed = 0;
  let failed = 0;
  for await (const s of cursor) {
    // Respect provider rate limits: live APIs are polled at most every 30 minutes per shipment.
    if (s.trackingMode === 'LIVE' && s.lastTrackingPollAt && now.getTime() - s.lastTrackingPollAt.getTime() < LIVE_MIN_POLL_MS) continue;
    try {
      await refreshShipmentTracking(s);
      refreshed += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ shipment: s.reference, err: (err as Error).message }, 'Tracking refresh failed');
    }
    // DHL allows at most one call every 5 seconds per API key, so space out live calls.
    if (s.trackingMode === 'LIVE') await new Promise((resolve) => setTimeout(resolve, LIVE_CALL_GAP_MS));
  }
  return { refreshed, failed };
}

/**
 * DHL's terms of use: delete DHL tracking data 30 days after the shipment is delivered.
 * Events are append-only (the model blocks deletes), so this one sanctioned purge goes
 * through the raw collection on purpose.
 */
export async function purgeExpiredCarrierTracking(now = new Date()) {
  const expired = await Shipment.find({ status: 'DELIVERED', deliveredAt: { $lt: new Date(now.getTime() - 30 * DAY_MS) } }).distinct('_id');
  const { deletedCount } = await ShipmentEvent.collection.deleteMany({ shipmentId: { $in: expired }, 'source.provider': DHL_TRACKING_PROVIDER });
  return { deleted: deletedCount };
}

/** One page of a shipment's event history. */
export async function listShipmentEvents(organizationId: Types.ObjectId, shipmentId: Types.ObjectId, q: EventListQuery) {
  const filter = { organizationId, shipmentId };
  const direction = q.order === 'asc' ? 1 : -1;
  const [items, total] = await Promise.all([
    ShipmentEvent.find(filter)
      .sort({ occurredAt: direction, recordedAt: direction })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    ShipmentEvent.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

/** Latest movement events across the organisation (live feed on the Tracking page). */
export async function listRecentEvents(organizationId: Types.ObjectId, limit: number) {
  return ShipmentEvent.find({ organizationId, type: { $in: ['TRACKING', 'STATUS_CHANGE', 'BOOKED', 'CANCELLED'] } })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .populate('shipmentId', 'reference')
    .lean();
}
