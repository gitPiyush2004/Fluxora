import type { PipelineStage, Types } from 'mongoose';
import { DAY_MS, HOUR_MS } from '../../utils/dates.js';
import { Alert } from '../alerts/alert.model.js';
import { PurchaseOrder } from '../purchase-orders/purchase-order.model.js';
import { CarrierQuote } from '../quotes/quote.model.js';
import { Shipment } from '../shipments/shipment.model.js';
import { TRACKABLE_STATUSES } from '../shipments/shipment.rules.js';
import { ShipmentEvent } from '../tracking/shipment-event.model.js';
import { ON_TIME_EXPR } from './reliability.js';

/**
 * METRIC DEFINITIONS (also surfaced in the UI and README)
 *
 * - Shipments in period: shipments CREATED within [from, to].
 * - In transit: PICKED_UP, IN_TRANSIT or OUT_FOR_DELIVERY (current status).
 * - Delayed / exception: current status DELAYED or EXCEPTION.
 * - Freight expenditure: Σ freightCostMinor of shipments BOOKED within the period that are not
 *   cancelled, reported per currency (never summed across currencies).
 * - Average transit time: mean(deliveredAt − pickedUpAt) for shipments DELIVERED within the
 *   period with both timestamps recorded. Denominator disclosed as eligibleCount.
 * - On-time delivery rate: delivered on or before the (UTC) expected delivery date ÷ delivered
 *   shipments with both dates recorded, for deliveries within the period.
 * - Potential savings (hypothetical): for booked shipments whose offer was selected from a
 *   comparison, selected price − cheapest eligible alternative in the same currency (if > 0).
 *   This is NOT realised savings.
 */
export interface AnalyticsFilters {
  from: Date;
  to: Date;
  carrier?: string;
  status?: string[];
  poStatus?: string[];
}

function shipmentMatch(organizationId: Types.ObjectId, f: AnalyticsFilters, dateField: string) {
  const m: Record<string, unknown> = { organizationId, [dateField]: { $gte: f.from, $lte: f.to } };
  if (f.carrier) m.carrierCode = f.carrier;
  if (f.status?.length) m.status = { $in: f.status };
  return m;
}

/** Shipments that count towards freight spend: booked in the period, not cancelled, with a cost. */
function spendMatch(organizationId: Types.ObjectId, f: AnalyticsFilters) {
  const m = shipmentMatch(organizationId, f, 'booking.bookedAt');
  m.status = f.status?.length ? { $in: f.status.filter((s) => s !== 'CANCELLED') } : { $ne: 'CANCELLED' };
  m.freightCostMinor = { $type: 'number' };
  return m;
}

export async function overview(organizationId: Types.ObjectId, f: AnalyticsFilters) {
  const createdMatch = shipmentMatch(organizationId, f, 'createdAt');
  const [statusRows, spendRows, transitRows, onTimeRows, unresolvedAlerts, provenanceRows] = await Promise.all([
    Shipment.aggregate<{ _id: string; count: number }>([{ $match: createdMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Shipment.aggregate<{ _id: string; totalMinor: number; count: number }>([
      { $match: spendMatch(organizationId, f) },
      { $group: { _id: '$currency', totalMinor: { $sum: '$freightCostMinor' }, count: { $sum: 1 } } },
      { $sort: { totalMinor: -1 } },
    ]),
    Shipment.aggregate<{ avgMs: number; count: number }>([
      { $match: { ...shipmentMatch(organizationId, f, 'deliveredAt'), status: 'DELIVERED', pickedUpAt: { $type: 'date' } } },
      { $project: { ms: { $subtract: ['$deliveredAt', '$pickedUpAt'] } } },
      { $match: { ms: { $gte: 0 } } },
      { $group: { _id: null, avgMs: { $avg: '$ms' }, count: { $sum: 1 } } },
    ]),
    Shipment.aggregate<{ onTime: number; count: number }>([
      { $match: { ...shipmentMatch(organizationId, f, 'deliveredAt'), status: 'DELIVERED', expectedDeliveryDate: { $type: 'date' } } },
      { $group: { _id: null, onTime: { $sum: { $cond: [ON_TIME_EXPR, 1, 0] } }, count: { $sum: 1 } } },
    ]),
    Alert.countDocuments({ organizationId, status: { $in: ['OPEN', 'ACKNOWLEDGED'] } }),
    Shipment.aggregate<{ _id: boolean | null; count: number }>([{ $match: createdMatch }, { $group: { _id: '$quoteIsSimulated', count: { $sum: 1 } } }]),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r._id] = r.count;
  const sum = (keys: string[]) => keys.reduce((a, k) => a + (byStatus[k] ?? 0), 0);
  const transit = transitRows[0];
  const onTime = onTimeRows[0];

  return {
    period: { from: f.from, to: f.to },
    shipments: {
      total: statusRows.reduce((a, r) => a + r.count, 0),
      byStatus,
      inTransit: sum(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']),
      delivered: sum(['DELIVERED']),
      delayedOrException: sum(['DELAYED', 'EXCEPTION']),
      planning: sum(['DRAFT', 'QUOTED']),
    },
    freightSpend: spendRows.map((r) => ({ currency: r._id, totalMinor: r.totalMinor, shipmentCount: r.count })),
    averageTransit: {
      hours: transit ? Math.round((transit.avgMs / HOUR_MS) * 10) / 10 : null,
      days: transit ? Math.round((transit.avgMs / DAY_MS) * 10) / 10 : null,
      eligibleCount: transit?.count ?? 0,
    },
    onTimeDelivery: {
      rate: onTime && onTime.count > 0 ? onTime.onTime / onTime.count : null,
      onTimeCount: onTime?.onTime ?? 0,
      eligibleCount: onTime?.count ?? 0,
    },
    unresolvedAlerts,
    dataProvenance: {
      simulatedOfferShipments: provenanceRows.find((r) => r._id === true)?.count ?? 0,
      realOfferShipments: provenanceRows.find((r) => r._id === false)?.count ?? 0,
      noOfferShipments: provenanceRows.find((r) => r._id == null)?.count ?? 0,
    },
  };
}

export async function freight(organizationId: Types.ObjectId, f: AnalyticsFilters) {
  const match = spendMatch(organizationId, f);
  const [monthly, byCarrier] = await Promise.all([
    Shipment.aggregate<{ _id: { month: string; currency: string }; totalMinor: number; count: number }>([
      { $match: match },
      { $group: { _id: { month: { $dateToString: { date: '$booking.bookedAt', format: '%Y-%m', timezone: 'UTC' } }, currency: '$currency' }, totalMinor: { $sum: '$freightCostMinor' }, count: { $sum: 1 } } },
      { $sort: { '_id.month': 1, '_id.currency': 1 } },
    ]),
    Shipment.aggregate<{ _id: { carrier: string; name: string; currency: string }; totalMinor: number; count: number; kg: number }>([
      { $match: match },
      {
        $group: {
          _id: { carrier: '$carrierCode', name: '$carrierName', currency: '$currency' },
          totalMinor: { $sum: '$freightCostMinor' },
          count: { $sum: 1 },
          kg: { $sum: { $ifNull: ['$billableWeightKg', '$actualWeightKg'] } },
        },
      },
      { $sort: { totalMinor: -1 } },
    ]),
  ]);
  return {
    monthly: monthly.map((r) => ({ month: r._id.month, currency: r._id.currency, totalMinor: r.totalMinor, shipmentCount: r.count })),
    byCarrier: byCarrier.map((r) => ({
      carrierCode: r._id.carrier,
      carrierName: r._id.name,
      currency: r._id.currency,
      totalMinor: r.totalMinor,
      shipmentCount: r.count,
      billableKg: Math.round(r.kg * 10) / 10,
      avgCostPerKgMinor: r.kg > 0 ? Math.round(r.totalMinor / r.kg) : null,
    })),
  };
}

export async function carriers(organizationId: Types.ObjectId, f: AnalyticsFilters) {
  const base = { organizationId, carrierCode: { $type: 'string' }, ...(f.carrier ? { carrierCode: f.carrier } : {}) };
  const [volume, delivery, exceptionShipments] = await Promise.all([
    Shipment.aggregate<{ _id: { code: string; name: string }; shipments: number; cancelled: number }>([
      { $match: { ...base, 'booking.bookedAt': { $gte: f.from, $lte: f.to } } },
      { $group: { _id: { code: '$carrierCode', name: '$carrierName' }, shipments: { $sum: 1 }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } } } },
    ]),
    Shipment.aggregate<{ _id: string; delivered: number; onTimeEligible: number; onTime: number; transitEligible: number; transitMs: number }>([
      { $match: { ...base, status: 'DELIVERED', deliveredAt: { $gte: f.from, $lte: f.to } } },
      {
        $group: {
          _id: '$carrierCode',
          delivered: { $sum: 1 },
          onTimeEligible: { $sum: { $cond: [{ $eq: [{ $type: '$expectedDeliveryDate' }, 'date'] }, 1, 0] } },
          onTime: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: '$expectedDeliveryDate' }, 'date'] }, ON_TIME_EXPR] }, 1, 0] } },
          transitEligible: { $sum: { $cond: [{ $eq: [{ $type: '$pickedUpAt' }, 'date'] }, 1, 0] } },
          transitMs: { $sum: { $cond: [{ $eq: [{ $type: '$pickedUpAt' }, 'date'] }, { $subtract: ['$deliveredAt', '$pickedUpAt'] }, 0] } },
        },
      },
    ]),
    ShipmentEvent.aggregate<{ _id: string; shipments: number }>([
      { $match: { organizationId, newStatus: { $in: ['DELAYED', 'EXCEPTION'] }, occurredAt: { $gte: f.from, $lte: f.to } } },
      { $group: { _id: '$shipmentId' } },
      { $lookup: { from: 'shipments', localField: '_id', foreignField: '_id', as: 's', pipeline: [{ $project: { carrierCode: 1 } }] } },
      { $unwind: '$s' },
      ...(f.carrier ? [{ $match: { 's.carrierCode': f.carrier } } as PipelineStage] : []),
      { $group: { _id: '$s.carrierCode', shipments: { $sum: 1 } } },
    ] as PipelineStage[]),
  ]);

  return volume
    .map((v) => {
      const d = delivery.find((x) => x._id === v._id.code);
      const ex = exceptionShipments.find((x) => x._id === v._id.code);
      return {
        carrierCode: v._id.code,
        carrierName: v._id.name,
        bookedShipments: v.shipments,
        cancelled: v.cancelled,
        delivered: d?.delivered ?? 0,
        onTime: { rate: d && d.onTimeEligible > 0 ? d.onTime / d.onTimeEligible : null, onTimeCount: d?.onTime ?? 0, eligibleCount: d?.onTimeEligible ?? 0 },
        averageTransitDays: {
          value: d && d.transitEligible > 0 ? Math.round((d.transitMs / d.transitEligible / DAY_MS) * 10) / 10 : null,
          eligibleCount: d?.transitEligible ?? 0,
        },
        shipmentsWithExceptions: ex?.shipments ?? 0,
      };
    })
    .sort((a, b) => b.bookedShipments - a.bookedShipments);
}

export async function purchaseOrders(organizationId: Types.ObjectId, f: AnalyticsFilters) {
  const match: Record<string, unknown> = { organizationId, orderDate: { $gte: f.from, $lte: f.to } };
  if (f.poStatus?.length) match.status = { $in: f.poStatus };
  const rows = await PurchaseOrder.aggregate<{ _id: { status: string; currency: string }; count: number; totalMinor: number }>([
    { $match: match },
    { $group: { _id: { status: '$status', currency: '$currency' }, count: { $sum: 1 }, totalMinor: { $sum: '$totalMinor' } } },
    { $sort: { '_id.status': 1 } },
  ]);
  const byStatus: Record<string, { count: number; totals: { currency: string; totalMinor: number }[] }> = {};
  const totals: Record<string, { currency: string; totalMinor: number; count: number }> = {};
  const openCommitments: Record<string, number> = {};
  for (const r of rows) {
    const s = (byStatus[r._id.status] ??= { count: 0, totals: [] });
    s.count += r.count;
    s.totals.push({ currency: r._id.currency, totalMinor: r.totalMinor });
    if (r._id.status !== 'CANCELLED') {
      const t = (totals[r._id.currency] ??= { currency: r._id.currency, totalMinor: 0, count: 0 });
      t.totalMinor += r.totalMinor;
      t.count += r.count;
    }
    if (['APPROVED', 'READY_TO_SHIP', 'PARTIALLY_RECEIVED'].includes(r._id.status)) {
      openCommitments[r._id.currency] = (openCommitments[r._id.currency] ?? 0) + r.totalMinor;
    }
  }
  return {
    byStatus,
    totals: Object.values(totals),
    openCommitments: Object.entries(openCommitments).map(([currency, totalMinor]) => ({ currency, totalMinor })),
  };
}

export async function savings(organizationId: Types.ObjectId, f: AnalyticsFilters) {
  const rows = await Shipment.aggregate<{
    _id: string;
    shipments: number;
    withSavings: number;
    potentialSavingsMinor: number;
    selectedTotalMinor: number;
  }>([
    {
      $match: { ...spendMatch(organizationId, f), selectedQuoteId: { $type: 'objectId' } },
    },
    { $lookup: { from: CarrierQuote.collection.name, localField: 'selectedQuoteId', foreignField: '_id', as: 'sel', pipeline: [{ $project: { quoteRequestId: 1, currency: 1, totalMinor: 1 } }] } },
    { $unwind: '$sel' },
    {
      $lookup: {
        from: CarrierQuote.collection.name,
        let: { qr: '$sel.quoteRequestId', cur: '$sel.currency' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$quoteRequestId', '$$qr'] }, { $eq: ['$currency', '$$cur'] }, { $eq: ['$eligibility.eligible', true] }] } } },
          { $group: { _id: null, minTotal: { $min: '$totalMinor' } } },
        ],
        as: 'alt',
      },
    },
    { $unwind: '$alt' },
    { $project: { currency: '$sel.currency', selected: '$sel.totalMinor', diff: { $max: [0, { $subtract: ['$sel.totalMinor', '$alt.minTotal'] }] } } },
    {
      $group: {
        _id: '$currency',
        shipments: { $sum: 1 },
        withSavings: { $sum: { $cond: [{ $gt: ['$diff', 0] }, 1, 0] } },
        potentialSavingsMinor: { $sum: '$diff' },
        selectedTotalMinor: { $sum: '$selected' },
      },
    },
  ]);
  return {
    definition:
      'Hypothetical: the difference between the selected offer and the cheapest eligible offer in the same comparison and currency. It reflects a choice (often for speed or reliability), not money lost or saved.',
    byCurrency: rows.map((r) => ({
      currency: r._id,
      comparedShipments: r.shipments,
      shipmentsWithCheaperAlternative: r.withSavings,
      potentialSavingsMinor: r.potentialSavingsMinor,
      selectedTotalMinor: r.selectedTotalMinor,
    })),
  };
}

export async function dashboard(organizationId: Types.ObjectId) {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * DAY_MS);
  const [recentShipments, upcoming, activeAlerts, recentPos] = await Promise.all([
    Shipment.find({ organizationId }).select('reference status origin destination carrierName expectedDeliveryDate freightCostMinor currency quoteIsSimulated createdAt').sort({ createdAt: -1 }).limit(6).lean(),
    Shipment.find({ organizationId, status: { $in: TRACKABLE_STATUSES }, expectedDeliveryDate: { $lte: in7 } })
      .select('reference status destination carrierName expectedDeliveryDate')
      .sort({ expectedDeliveryDate: 1 })
      .limit(6)
      .lean(),
    Alert.find({ organizationId, status: { $in: ['OPEN', 'ACKNOWLEDGED'] } }).sort({ detectedAt: -1 }).limit(6).lean(),
    PurchaseOrder.find({ organizationId }).select('poNumber status totalMinor currency orderDate supplierId').populate('supplierId', 'name').sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  return { recentShipments, upcomingDeliveries: upcoming, activeAlerts, recentPurchaseOrders: recentPos };
}
