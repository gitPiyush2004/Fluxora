import type { PipelineStage, Types } from 'mongoose';
import { Shipment } from '../shipments/shipment.model.js';

/**
 * Carrier "reliability" = the organisation's own observed on-time delivery rate.
 *
 *   on-time rate = delivered shipments with deliveredAt ≤ end of the (UTC) expected
 *                  delivery day  ÷  delivered shipments with both dates recorded
 *
 * Fluxora never invents carrier-wide reliability statistics. Below `minSamples`
 * the rate is reported as unavailable (null) together with the sample size.
 */
export const ON_TIME_EXPR = {
  $lte: ['$deliveredAt', { $add: [{ $dateTrunc: { date: '$expectedDeliveryDate', unit: 'day', timezone: 'UTC' } }, 86_399_999] }],
};

export interface CarrierReliability {
  onTimeRate: number | null;
  sampleSize: number;
  onTimeCount: number;
  minSamples: number;
}

export async function carrierReliability(organizationId: Types.ObjectId, minSamples: number): Promise<Map<string, CarrierReliability>> {
  const pipeline: PipelineStage[] = [
    {
      $match: {
        organizationId,
        status: 'DELIVERED',
        carrierCode: { $type: 'string' },
        deliveredAt: { $type: 'date' },
        expectedDeliveryDate: { $type: 'date' },
      },
    },
    { $group: { _id: '$carrierCode', total: { $sum: 1 }, onTime: { $sum: { $cond: [ON_TIME_EXPR, 1, 0] } } } },
  ];
  const rows = await Shipment.aggregate<{ _id: string; total: number; onTime: number }>(pipeline);
  const map = new Map<string, CarrierReliability>();
  for (const r of rows) {
    map.set(r._id, {
      sampleSize: r.total,
      onTimeCount: r.onTime,
      minSamples,
      onTimeRate: r.total >= minSamples ? r.onTime / r.total : null,
    });
  }
  return map;
}

export function reliabilityFor(map: Map<string, CarrierReliability>, carrierCode: string, minSamples: number): CarrierReliability {
  return map.get(carrierCode) ?? { onTimeRate: null, sampleSize: 0, onTimeCount: 0, minSamples };
}
