import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { simulatedOutcome } from '../../integrations/carriers/simulator/simulated-tracking.js';
import { CarrierError, type CarrierCode } from '../../integrations/carriers/types.js';
import { nextReference } from '../../utils/counters.js';
import { AppError, conflict, notFound, notSupported, providerError, validationError } from '../../utils/errors.js';
import type { Currency } from '../../utils/money.js';
import { escapeRegex, pageMeta } from '../../utils/pagination.js';
import { parse } from '../../utils/validate.js';
import { Alert } from '../alerts/alert.model.js';
import { recordAudit, type AuditActor } from '../audit/audit.model.js';
import { calculateBillableWeight } from '../carriers/billable-weight.js';
import { bookingAdapterFor, cancellationAdapterFor, trackingAdapterFor } from '../carriers/carrier.registry.js';
import { Organization } from '../organizations/organization.model.js';
import { PurchaseOrder } from '../purchase-orders/purchase-order.model.js';
import { PO_SHIPPABLE_STATUSES, type PoStatus } from '../purchase-orders/purchase-order.rules.js';
import { CarrierQuote, QuoteRequest } from '../quotes/quote.model.js';
import { buildQuoteResponse, getLatestQuotesForShipment, requestQuotes, toShipmentRequest } from '../quotes/quote.service.js';
import type { Weights } from '../quotes/recommendation.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { ShipmentEvent } from '../tracking/shipment-event.model.js';
import { appendShipmentEvent, applyStatus, publishShipment } from '../tracking/tracking.service.js';
import { BookingRecord } from './booking-record.model.js';
import { Shipment, type ShipmentDoc } from './shipment.model.js';
import { CANCELLABLE_STATUSES, PLANNING_STATUSES, TRACKABLE_STATUSES, type ServiceLevel, type ShipmentStatus } from './shipment.rules.js';
import {
  shipmentSpecInput,
  type BookingInput,
  type CreateFromPoInput,
  type CreateShipmentInput,
  type ShipmentListQuery,
  type ShipmentSpecInput as SpecInput,
  type UpdateShipmentInput,
} from './shipment.schemas.js';

async function divisorFor(organizationId: Types.ObjectId): Promise<number> {
  const org = await Organization.findById(organizationId).select('settings.volumetricDivisor').lean();
  return org?.settings?.volumetricDivisor ?? 5000;
}

function specFields(spec: SpecInput, divisor: number) {
  const weight = calculateBillableWeight({
    actualWeightKg: spec.actualWeightKg,
    packageCount: spec.packageCount,
    lengthCm: spec.lengthCm ?? undefined,
    widthCm: spec.widthCm ?? undefined,
    heightCm: spec.heightCm ?? undefined,
    divisor,
  });
  return {
    origin: spec.origin,
    destination: spec.destination,
    shipmentType: spec.shipmentType,
    packageCount: spec.packageCount,
    actualWeightKg: spec.actualWeightKg,
    lengthCm: spec.lengthCm ?? undefined,
    widthCm: spec.widthCm ?? undefined,
    heightCm: spec.heightCm ?? undefined,
    volumetricWeightKg: weight.volumetricWeightKg ?? undefined,
    billableWeightKg: weight.billableWeightKg,
    requiredDeliveryDate: spec.requiredDeliveryDate ?? undefined,
    servicePreference: spec.servicePreference ?? undefined,
    cargoValueMinor: spec.cargoValueMinor ?? undefined,
    cargoCurrency: spec.cargoCurrency ?? undefined,
    insuranceRequired: spec.insuranceRequired,
    specialHandling: spec.specialHandling,
    maxBudgetMinor: spec.maxBudgetMinor ?? undefined,
    currency: spec.currency,
  };
}

/** Rebuilds the quoting spec from a stored shipment. */
export function shipmentSpec(s: ShipmentDoc): SpecInput {
  return {
    origin: { name: s.origin.name ?? undefined, address: s.origin.address ?? undefined, city: s.origin.city, postalCode: s.origin.postalCode ?? undefined, country: s.origin.country },
    destination: { name: s.destination.name ?? undefined, address: s.destination.address ?? undefined, city: s.destination.city, postalCode: s.destination.postalCode ?? undefined, country: s.destination.country },
    shipmentType: s.shipmentType as SpecInput['shipmentType'],
    packageCount: s.packageCount,
    actualWeightKg: s.actualWeightKg,
    lengthCm: s.lengthCm ?? undefined,
    widthCm: s.widthCm ?? undefined,
    heightCm: s.heightCm ?? undefined,
    requiredDeliveryDate: s.requiredDeliveryDate ?? undefined,
    servicePreference: (s.servicePreference ?? undefined) as SpecInput['servicePreference'],
    cargoValueMinor: s.cargoValueMinor ?? undefined,
    cargoCurrency: (s.cargoCurrency ?? undefined) as SpecInput['cargoCurrency'],
    insuranceRequired: s.insuranceRequired ?? false,
    specialHandling: (s.specialHandling ?? []) as SpecInput['specialHandling'],
    maxBudgetMinor: s.maxBudgetMinor ?? undefined,
    currency: s.currency as Currency,
  };
}

export async function getShipmentDoc(organizationId: Types.ObjectId, id: string): Promise<ShipmentDoc> {
  const shipment = await Shipment.findOne({ _id: id, organizationId });
  if (!shipment) throw notFound('Shipment');
  return shipment;
}

export async function listShipments(organizationId: Types.ObjectId, q: ShipmentListQuery) {
  const filter: Record<string, unknown> = { organizationId };
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.carrier) filter.carrierCode = q.carrier;
  if (q.purchaseOrderId) filter.purchaseOrderId = q.purchaseOrderId;
  if (q.from || q.to) {
    // "to" is inclusive: include the whole of that day.
    const end = q.to ? new Date(q.to) : undefined;
    end?.setUTCHours(23, 59, 59, 999);
    filter.createdAt = { ...(q.from && { $gte: q.from }), ...(end && { $lte: end }) };
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [
      { reference: rx }, { trackingNumber: rx }, { purchaseOrderNumber: rx }, { 'origin.city': rx },
      { 'destination.city': rx }, { carrierName: rx }, { 'booking.reference': rx },
    ];
  }
  const [items, total] = await Promise.all([
    Shipment.find(filter)
      .select('-items -simulation -bookingLock')
      .sort({ [q.sortBy]: q.sortDir === 'asc' ? 1 : -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Shipment.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

/** Compact route list for the globe: booked, moving and recently delivered shipments. */
export async function listShipmentsForMap(organizationId: Types.ObjectId) {
  return Shipment.find({ organizationId, status: { $in: [...TRACKABLE_STATUSES, 'DELIVERED'] } })
    .select('reference status origin.city origin.country destination.city destination.country carrierName lastKnownLocation updatedAt')
    .sort({ updatedAt: -1 })
    .limit(150)
    .lean();
}

/** Shipment with its linked purchase order, open alerts and event count. */
export async function getShipmentDetail(organizationId: Types.ObjectId, id: string) {
  const shipment = await Shipment.findOne({ _id: id, organizationId }).select('-bookingLock').lean();
  if (!shipment) throw notFound('Shipment');
  const [purchaseOrder, openAlerts, eventCount] = await Promise.all([
    shipment.purchaseOrderId
      ? PurchaseOrder.findOne({ _id: shipment.purchaseOrderId, organizationId }).select('poNumber status supplierId totalMinor currency orderDate').lean()
      : null,
    Alert.find({ organizationId, shipmentId: shipment._id, status: { $ne: 'RESOLVED' } }).sort({ detectedAt: -1 }).lean(),
    ShipmentEvent.countDocuments({ organizationId, shipmentId: shipment._id }),
  ]);
  return { ...shipment, purchaseOrder, openAlerts, eventCount };
}

export async function createShipment(
  organizationId: Types.ObjectId,
  actor: AuditActor,
  input: CreateShipmentInput,
  link?: { purchaseOrderId: Types.ObjectId; purchaseOrderNumber: string },
) {
  // Created from the Compare page: the authoritative spec is the one the offer was priced for.
  const quote = input.quoteId ? await CarrierQuote.findOne({ _id: input.quoteId, organizationId }).lean() : null;
  if (input.quoteId) {
    if (!quote) throw notFound('Quote');
    if (quote.shipmentId) throw conflict('That quote already belongs to another shipment');
    const qr = await QuoteRequest.findOne({ _id: quote.quoteRequestId, organizationId }).lean();
    if (!qr) throw notFound('Quote request');
    input = { ...input, spec: { ...(qr.request as SpecInput), shipDate: undefined } };
  }
  const divisor = await divisorFor(organizationId);
  const reference = await nextReference(organizationId, 'SHP', 6);
  const shipment = await Shipment.create({
    organizationId,
    reference,
    ...specFields(input.spec, divisor),
    contentsDescription: input.contentsDescription,
    notes: input.notes,
    items: input.items,
    purchaseOrderId: link?.purchaseOrderId,
    purchaseOrderNumber: link?.purchaseOrderNumber,
    status: 'DRAFT',
    statusChangedAt: new Date(),
    specUpdatedAt: new Date(0),
    createdBy: actor.userId,
  });
  await appendShipmentEvent(shipment, {
    type: 'CREATED',
    description: link ? `Shipment created from purchase order ${link.purchaseOrderNumber}` : 'Shipment created',
    newStatus: 'DRAFT',
    source: { type: 'USER', isSimulated: false },
    actor,
  });
  await recordAudit({ organizationId, entityType: 'SHIPMENT', entityId: shipment._id, action: 'CREATED', summary: `Shipment ${reference} created`, actor });

  if (quote) {
    // Attach that comparison to the new shipment and select the offer.
    await QuoteRequest.updateOne({ _id: quote.quoteRequestId, organizationId, shipmentId: { $exists: false } }, { $set: { shipmentId: shipment._id } });
    await CarrierQuote.updateMany({ quoteRequestId: quote.quoteRequestId, organizationId }, { $set: { shipmentId: shipment._id } });
    return selectQuote(organizationId, actor, String(shipment._id), String(quote._id));
  }
  publishShipment(shipment);
  return shipment;
}

export async function updateShipment(organizationId: Types.ObjectId, id: string, actor: AuditActor, input: UpdateShipmentInput) {
  const shipment = await getShipmentDoc(organizationId, id);
  if (shipment.status === 'CANCELLED' || shipment.status === 'DELIVERED') throw conflict(`A ${shipment.status.toLowerCase()} shipment cannot be edited`);
  const changed: string[] = [];
  if (input.spec) {
    if (!PLANNING_STATUSES.includes(shipment.status as ShipmentStatus)) {
      throw conflict('Route, package and service details can only be changed before booking');
    }
    shipment.set(specFields(input.spec, await divisorFor(organizationId)));
    shipment.specUpdatedAt = new Date();
    changed.push('specification');
    if (shipment.status === 'QUOTED') {
      // Previously selected offer no longer matches the shipment — require a new comparison.
      const from = applyStatus(shipment, 'DRAFT', new Date());
      shipment.set({ selectedQuoteId: undefined, carrierCode: undefined, carrierName: undefined, serviceName: undefined, serviceLevel: undefined, freightCostMinor: undefined, quoteSourceType: undefined, quoteIsSimulated: undefined, expectedDeliveryDate: undefined });
      await appendShipmentEvent(shipment, { type: 'STATUS_CHANGE', description: 'Shipment details changed — selected offer cleared, new quotes required', previousStatus: from, newStatus: 'DRAFT', source: { type: 'SYSTEM', isSimulated: false }, actor });
    }
  }
  if (input.items && PLANNING_STATUSES.includes(shipment.status as ShipmentStatus)) {
    shipment.set('items', input.items);
    changed.push('items');
  }
  if (input.contentsDescription !== undefined) { shipment.contentsDescription = input.contentsDescription; changed.push('contents'); }
  if (input.notes !== undefined) { shipment.notes = input.notes; changed.push('notes'); }
  await shipment.save();
  if (changed.length) {
    await appendShipmentEvent(shipment, { type: 'UPDATED', description: `Updated ${changed.join(', ')}`, source: { type: 'USER', isSimulated: false }, actor });
    await recordAudit({ organizationId, entityType: 'SHIPMENT', entityId: shipment._id, action: 'UPDATED', summary: `Updated ${changed.join(', ')}`, actor });
  }
  publishShipment(shipment);
  return shipment;
}

function assertQuotable(shipment: ShipmentDoc) {
  if (!PLANNING_STATUSES.includes(shipment.status as ShipmentStatus)) {
    throw conflict(`Quotes can only be requested before booking (current status: ${shipment.status})`);
  }
}

/** Runs a carrier comparison for an existing shipment (planning statuses only). */
export async function requestShipmentQuotes(
  organizationId: Types.ObjectId,
  userId: Types.ObjectId,
  id: string,
  options: { weights?: Weights; carriers?: CarrierCode[] },
) {
  const shipment = await getShipmentDoc(organizationId, id);
  assertQuotable(shipment);
  return requestQuotes({ organizationId, userId, spec: shipmentSpec(shipment), shipmentId: shipment._id, ...options });
}

export async function getShipmentQuotes(organizationId: Types.ObjectId, id: string) {
  const shipment = await getShipmentDoc(organizationId, id);
  return getLatestQuotesForShipment(organizationId, shipment._id);
}

/** Re-ranks one of this shipment's comparisons with different weights. */
export async function rankShipmentQuotes(organizationId: Types.ObjectId, id: string, quoteRequestId: string, weights: Weights) {
  const shipment = await getShipmentDoc(organizationId, id);
  const result = await buildQuoteResponse(organizationId, quoteRequestId, weights);
  if (result.shipmentId !== String(shipment._id)) throw notFound('Quote request');
  return result;
}

export async function selectQuote(organizationId: Types.ObjectId, actor: AuditActor, id: string, quoteId: string) {
  const shipment = await getShipmentDoc(organizationId, id);
  assertQuotable(shipment);
  const quote = await CarrierQuote.findOne({ _id: quoteId, organizationId });
  if (!quote) throw notFound('Quote');
  if (!quote.shipmentId || !quote.shipmentId.equals(shipment._id)) throw conflict('That quote was not requested for this shipment');
  const qr = await QuoteRequest.findOne({ _id: quote.quoteRequestId, organizationId }).select('createdAt').lean();
  if (qr && shipment.specUpdatedAt && qr.createdAt < shipment.specUpdatedAt) {
    throw conflict('Shipment details changed after this quote was requested. Request new quotes.');
  }
  if (!quote.eligibility?.eligible) {
    throw validationError('This offer does not meet the shipment requirements', quote.eligibility?.reasons?.map((r) => ({ path: 'quoteId', message: r })));
  }
  if (quote.provenance.validUntil && quote.provenance.validUntil.getTime() < Date.now()) {
    throw conflict('This quote has expired. Request new quotes.');
  }
  const previous = shipment.status as ShipmentStatus;
  if (previous !== 'QUOTED') applyStatus(shipment, 'QUOTED', new Date());
  shipment.set({
    selectedQuoteId: quote._id,
    carrierCode: quote.carrierCode,
    carrierName: quote.carrierName,
    serviceName: quote.serviceName,
    serviceLevel: quote.serviceLevel,
    quoteSourceType: quote.provenance.sourceType,
    quoteIsSimulated: quote.provenance.isSimulated,
    freightCostMinor: quote.totalMinor,
    currency: quote.currency,
    expectedDeliveryDate: quote.estimatedDeliveryDate ?? undefined,
  });
  await shipment.save();
  await appendShipmentEvent(shipment, {
    type: 'QUOTE_SELECTED',
    description: `Selected ${quote.carrierName} ${quote.serviceName}${quote.provenance.isSimulated ? ' (simulated offer)' : ''}`,
    previousStatus: previous !== 'QUOTED' ? previous : undefined,
    newStatus: previous !== 'QUOTED' ? 'QUOTED' : undefined,
    source: { type: 'USER', isSimulated: quote.provenance.isSimulated },
    actor,
    metadata: { quoteId: String(quote._id), totalMinor: quote.totalMinor, currency: quote.currency, sourceType: quote.provenance.sourceType },
  });
  publishShipment(shipment);
  return shipment;
}

/**
 * Books the selected offer exactly once per idempotency key.
 *  - PROVIDER mode calls the carrier adapter (the simulator for simulated offers).
 *  - MANUAL mode records a booking the user made directly with the carrier.
 * A failed provider booking never marks the shipment as booked.
 */
export async function bookShipment(
  organizationId: Types.ObjectId,
  actor: AuditActor,
  id: string,
  idempotencyKey: string,
  input: BookingInput,
) {
  const existing = await BookingRecord.findOne({ organizationId, idempotencyKey }).lean();
  if (existing) {
    if (String(existing.shipmentId) !== id) throw new AppError(422, 'BAD_REQUEST', 'Idempotency key was already used for a different shipment');
    if (existing.status === 'SUCCEEDED') return { shipment: await getShipmentDoc(organizationId, id), replayed: true };
    if (existing.status === 'PENDING') throw conflict('This booking request is already being processed');
    throw providerError(existing.error?.message ?? 'Booking failed', { replayed: true });
  }

  const shipment = await getShipmentDoc(organizationId, id);
  if (shipment.status === 'BOOKED' || shipment.booking?.reference) throw conflict('This shipment is already booked');
  if (shipment.status !== 'QUOTED' || !shipment.selectedQuoteId) throw conflict('Select a carrier offer before booking');

  const quote = await CarrierQuote.findOne({ _id: shipment.selectedQuoteId, organizationId }).lean();
  if (!quote) throw conflict('The selected quote no longer exists. Request new quotes.');
  const carrierCode = quote.carrierCode as CarrierCode;
  const adapter = input.mode === 'PROVIDER' ? bookingAdapterFor(carrierCode, quote.provenance.isSimulated) : null;
  if (input.mode === 'PROVIDER') {
    if (!adapter?.bookShipment) {
      throw notSupported(`${quote.carrierName} booking via API is not available. Book directly with the carrier and record the booking reference manually.`);
    }
    if (quote.provenance.validUntil && quote.provenance.validUntil.getTime() < Date.now()) {
      throw conflict('The selected quote has expired. Request new quotes before booking.');
    }
  }

  try {
    await BookingRecord.create({
      organizationId, shipmentId: shipment._id, idempotencyKey, mode: input.mode, status: 'PENDING',
      carrierCode, provider: adapter?.providerId, isSimulated: input.mode === 'PROVIDER' ? quote.provenance.isSimulated : false, requestedBy: actor.userId,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('This booking request is already being processed');
    throw err;
  }

  // Atomic lock: only one booking attempt per shipment may proceed at a time.
  const locked = await Shipment.findOneAndUpdate(
    { _id: shipment._id, organizationId, status: 'QUOTED', bookingLock: { $exists: false }, 'booking.reference': { $exists: false } },
    { $set: { bookingLock: idempotencyKey } },
    { returnDocument: 'after' },
  );
  if (!locked) {
    await BookingRecord.updateOne({ organizationId, idempotencyKey }, { $set: { status: 'FAILED', error: { code: 'CONFLICT', message: 'Another booking is in progress' }, completedAt: new Date() } });
    throw conflict('Another booking for this shipment is already in progress');
  }

  try {
    let bookingReference: string;
    let trackingNumber: string | undefined;
    let expected: Date | undefined;
    let isSimulated = false;
    let cancellable = false;
    let provider: string;

    if (input.mode === 'PROVIDER') {
      const result = await adapter!.bookShipment!(
        {
          shipmentReference: locked.reference,
          quote: {
            serviceCode: quote.serviceCode,
            serviceLevel: quote.serviceLevel as ServiceLevel,
            transitDays: quote.transitDays ?? null,
            estimatedDeliveryDate: quote.estimatedDeliveryDate?.toISOString() ?? null,
            externalReference: quote.provenance.externalReference ?? undefined,
          },
          request: toShipmentRequest(shipmentSpec(locked)),
          idempotencyKey,
        },
        AbortSignal.timeout(env.CARRIER_TIMEOUT_MS * 2),
      );
      bookingReference = result.bookingReference;
      trackingNumber = result.trackingNumber;
      expected = result.expectedDeliveryDate ? new Date(result.expectedDeliveryDate) : undefined;
      isSimulated = result.isSimulated;
      cancellable = result.cancellable;
      provider = result.provenance.provider;
    } else {
      bookingReference = input.bookingReference;
      trackingNumber = input.trackingNumber;
      expected = input.expectedDeliveryDate;
      provider = 'manual';
    }

    const now = new Date();
    applyStatus(locked, 'BOOKED', now);
    locked.set({
      booking: { reference: bookingReference, bookedAt: now, provider, isSimulated, cancellable: input.mode === 'MANUAL' ? true : cancellable },
      trackingNumber,
      bookingLock: undefined,
      expectedDeliveryDate: expected ?? locked.expectedDeliveryDate,
      trackingMode: isSimulated
        ? 'SIMULATED'
        : trackingNumber && trackingAdapterFor(carrierCode, 'LIVE')
          ? 'LIVE'
          : 'MANUAL',
      simulation: isSimulated && trackingNumber ? { nextStep: 0, outcome: simulatedOutcome(trackingNumber) } : undefined,
    });
    await locked.save();
    await BookingRecord.updateOne({ organizationId, idempotencyKey }, { $set: { status: 'SUCCEEDED', bookingReference, trackingNumber, completedAt: now } });
    await appendShipmentEvent(locked, {
      type: 'BOOKED',
      description: isSimulated
        ? `Simulated booking ${bookingReference} created (no real carrier booking)`
        : input.mode === 'MANUAL'
          ? `Booking ${bookingReference} recorded manually`
          : `Booked with ${quote.carrierName}: ${bookingReference}`,
      previousStatus: 'QUOTED',
      newStatus: 'BOOKED',
      source: { type: input.mode === 'MANUAL' ? 'USER' : isSimulated ? 'SIMULATED' : 'CARRIER_API', provider, isSimulated },
      actor,
      metadata: { bookingReference, trackingNumber },
    });
    await recordAudit({ organizationId, entityType: 'SHIPMENT', entityId: locked._id, action: 'BOOKED', summary: `Booked (${isSimulated ? 'simulated' : input.mode.toLowerCase()}): ${bookingReference}`, actor });
    publishShipment(locked);
    return { shipment: locked, replayed: false };
  } catch (err) {
    await Shipment.updateOne({ _id: shipment._id, bookingLock: idempotencyKey }, { $unset: { bookingLock: 1 } });
    const message = err instanceof CarrierError ? err.message : err instanceof AppError ? err.message : 'Carrier booking failed';
    await BookingRecord.updateOne({ organizationId, idempotencyKey }, { $set: { status: 'FAILED', error: { code: err instanceof CarrierError ? err.kind : 'ERROR', message }, completedAt: new Date() } });
    await appendShipmentEvent(shipment, {
      type: 'BOOKING_FAILED',
      description: `Booking failed: ${message}`,
      source: { type: input.mode === 'MANUAL' ? 'USER' : 'CARRIER_API', provider: adapter?.providerId, isSimulated: quote.provenance.isSimulated },
      actor,
    });
    if (err instanceof AppError) throw err;
    throw providerError(`Booking failed: ${message}`, { carrier: carrierCode });
  }
}

export async function cancelShipment(organizationId: Types.ObjectId, actor: AuditActor, id: string, reason?: string) {
  const shipment = await getShipmentDoc(organizationId, id);
  const from = shipment.status as ShipmentStatus;
  if (!CANCELLABLE_STATUSES.includes(from)) throw conflict(`A shipment that is ${from.replace(/_/g, ' ').toLowerCase()} cannot be cancelled`);
  let note = 'Shipment cancelled';
  if (shipment.booking?.reference && from !== 'DRAFT' && from !== 'QUOTED') {
    if (shipment.booking.provider === 'manual') {
      note = `Cancelled in Fluxora. Make sure booking ${shipment.booking.reference} is also cancelled directly with ${shipment.carrierName}.`;
    } else {
      const adapter = cancellationAdapterFor(shipment.carrierCode as CarrierCode, !!shipment.booking.isSimulated);
      if (!adapter?.cancelBooking || shipment.booking.cancellable === false) {
        throw notSupported(`${shipment.carrierName} does not support cancelling this booking through Fluxora. Contact the carrier directly.`);
      }
      let result;
      try {
        result = await adapter.cancelBooking(shipment.booking.reference, AbortSignal.timeout(env.CARRIER_TIMEOUT_MS));
      } catch (err) {
        throw providerError(`Cancellation failed: ${(err as Error).message}`);
      }
      if (!result.cancelled) throw providerError(result.message ?? 'The carrier refused the cancellation');
      note = shipment.booking.isSimulated ? `Simulated booking ${shipment.booking.reference} cancelled` : `Booking ${shipment.booking.reference} cancelled with ${shipment.carrierName}`;
    }
  }
  applyStatus(shipment, 'CANCELLED', new Date());
  shipment.cancelledAt = new Date();
  shipment.cancellationReason = reason;
  await shipment.save();
  await appendShipmentEvent(shipment, {
    type: 'CANCELLED',
    description: reason ? `${note}. Reason: ${reason}` : note,
    previousStatus: from,
    newStatus: 'CANCELLED',
    source: { type: 'USER', isSimulated: !!shipment.booking?.isSimulated },
    actor,
  });
  await recordAudit({ organizationId, entityType: 'SHIPMENT', entityId: shipment._id, action: 'CANCELLED', summary: note, actor, details: { reason } });
  publishShipment(shipment);
  return shipment;
}

/** Creates a shipment pre-filled from a purchase order (supplier → PO destination). */
export async function createShipmentFromPurchaseOrder(organizationId: Types.ObjectId, actor: AuditActor, poId: string, input: CreateFromPoInput) {
  const po = await PurchaseOrder.findOne({ _id: poId, organizationId });
  if (!po) throw notFound('Purchase order');
  if (!PO_SHIPPABLE_STATUSES.includes(po.status as PoStatus)) {
    throw conflict(`Shipments can be created for orders that are ready to ship or partially received (current: ${po.status})`);
  }
  const supplier = await Supplier.findOne({ _id: po.supplierId, organizationId }).lean();
  if (!supplier) throw conflict('The supplier for this order no longer exists');

  const items = input.items.map((i, idx) => {
    const line = po.lines.find((l) => String(l._id) === i.poLineId);
    if (!line) throw validationError('Unknown purchase order line', [{ path: `items.${idx}.poLineId`, message: 'Line not found on this order' }]);
    const outstanding = line.quantity - (line.receivedQuantity ?? 0);
    if (i.quantity > outstanding + 1e-9) throw validationError('Quantity exceeds outstanding quantity', [{ path: `items.${idx}.quantity`, message: `Max ${outstanding}` }]);
    return { poLineId: line._id, sku: line.sku ?? undefined, description: line.description, quantity: i.quantity, unitOfMeasure: line.unitOfMeasure ?? undefined };
  });

  const origin = input.spec.origin ?? { name: supplier.name, address: supplier.address ?? undefined, city: supplier.city, postalCode: supplier.postalCode ?? undefined, country: supplier.country };
  // Validate the combined spec with the same rules as any other shipment.
  const spec = parse(shipmentSpecInput, {
    ...input.spec,
    origin,
    destination: {
      name: po.destination.name ?? undefined,
      address: po.destination.address ?? undefined,
      city: po.destination.city,
      postalCode: po.destination.postalCode ?? undefined,
      country: po.destination.country,
    },
    requiredDeliveryDate: input.spec.requiredDeliveryDate ?? (po.expectedDeliveryDate && po.expectedDeliveryDate > new Date() ? po.expectedDeliveryDate : undefined),
    cargoValueMinor: po.subtotalMinor,
    cargoCurrency: po.currency,
    currency: po.currency,
  });

  const shipment = await createShipment(
    organizationId,
    actor,
    {
      spec,
      items: items.map((i) => ({ ...i, poLineId: String(i.poLineId) })),
      contentsDescription: items.map((i) => `${i.quantity} × ${i.description}`).join('; ').slice(0, 500),
      notes: input.notes,
    },
    { purchaseOrderId: po._id, purchaseOrderNumber: po.poNumber },
  );
  await recordAudit({
    organizationId, entityType: 'PURCHASE_ORDER', entityId: po._id, action: 'SHIPMENT_CREATED',
    summary: `Shipment ${shipment.reference} created`, actor, details: { shipmentId: String(shipment._id) },
  });
  return shipment;
}
