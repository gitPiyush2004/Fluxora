import { hoursBetween } from '../../utils/dates.js';
import { TRACKABLE_STATUSES, type ShipmentStatus } from '../shipments/shipment.rules.js';

export const ALERT_TYPES = ['STUCK_IN_STATUS', 'PAST_EXPECTED_DELIVERY', 'CARRIER_EXCEPTION', 'TRACKING_STALE'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface ExceptionRuleConfig {
  stuckThresholdsHours: Partial<Record<ShipmentStatus, number>>;
  trackingStaleHours: number;
  overdueGraceHours: number;
}

export interface ShipmentSnapshot {
  status: ShipmentStatus;
  statusChangedAt?: Date | null;
  expectedDeliveryDate?: Date | null;
  lastTrackingUpdateAt?: Date | null;
  trackingMode?: string | null;
}

export interface DetectedException {
  type: AlertType;
  /** Identifies the specific occurrence (status + since when), so a manually resolved
   *  alert is not re-raised for the same occurrence, while a new occurrence is. */
  dedupeSuffix: string;
  severity: AlertSeverity;
  message: string;
  recommendedAction: string;
}

/** Statuses where tracking updates are expected regularly (BOOKED may legitimately be quiet). */
const MONITORED_FOR_STALE: ShipmentStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED'];

const fmtHours = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} days` : `${Math.floor(h)} hours`);

/**
 * Transparent, rule-based exception detection (pure function, unit tested).
 * Returns every condition that currently holds; the alert service de-duplicates
 * against unresolved alerts and auto-resolves alerts whose condition has cleared.
 */
export function detectExceptions(s: ShipmentSnapshot, rules: ExceptionRuleConfig, now: Date): DetectedException[] {
  const found: DetectedException[] = [];

  // 1. Provider-reported delay / exception.
  if (s.status === 'EXCEPTION' || s.status === 'DELAYED') {
    found.push({
      type: 'CARRIER_EXCEPTION',
      dedupeSuffix: `${s.status}@${s.statusChangedAt?.getTime() ?? 0}`,
      severity: s.status === 'EXCEPTION' ? 'HIGH' : 'MEDIUM',
      message: s.status === 'EXCEPTION' ? 'Carrier reported a shipment exception' : 'Carrier reported a delay',
      recommendedAction:
        s.status === 'EXCEPTION'
          ? 'Review the latest tracking event, contact the carrier and provide any requested documentation.'
          : 'Confirm the revised delivery estimate with the carrier and notify the consignee.',
    });
  }

  // 2. Remaining in one status too long.
  const threshold = rules.stuckThresholdsHours[s.status];
  if (threshold && s.statusChangedAt) {
    const hours = hoursBetween(s.statusChangedAt, now);
    if (hours > threshold) {
      found.push({
        type: 'STUCK_IN_STATUS',
        dedupeSuffix: `${s.status}@${s.statusChangedAt.getTime()}`,
        severity: hours > threshold * 2 ? 'HIGH' : 'MEDIUM',
        message: `Shipment has been ${s.status.replace(/_/g, ' ').toLowerCase()} for ${fmtHours(hours)} (threshold ${fmtHours(threshold)})`,
        recommendedAction:
          s.status === 'BOOKED'
            ? 'Confirm the pickup appointment with the carrier or shipper.'
            : 'Request a status update from the carrier and check for missed scans.',
      });
    }
  }

  // 3. Expected delivery date exceeded.
  if (s.expectedDeliveryDate && TRACKABLE_STATUSES.includes(s.status)) {
    const endOfDay = new Date(s.expectedDeliveryDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const overdueHours = hoursBetween(endOfDay, now) - rules.overdueGraceHours;
    if (overdueHours > 0) {
      found.push({
        type: 'PAST_EXPECTED_DELIVERY',
        dedupeSuffix: `overdue@${s.expectedDeliveryDate.getTime()}`,
        severity: overdueHours > 72 ? 'CRITICAL' : overdueHours > 24 ? 'HIGH' : 'MEDIUM',
        message: `Expected delivery ${s.expectedDeliveryDate.toISOString().slice(0, 10)} has passed (${fmtHours(overdueHours)} overdue)`,
        recommendedAction: 'Contact the carrier for a revised ETA, update the consignee and consider marking the shipment as delayed.',
      });
    }
  }

  // 4. Missing tracking updates for an in-flight shipment (only when tracking is automated).
  if (MONITORED_FOR_STALE.includes(s.status) && s.trackingMode !== 'MANUAL' && s.trackingMode !== 'NONE') {
    const last = s.lastTrackingUpdateAt ?? s.statusChangedAt;
    if (last) {
      const hours = hoursBetween(last, now);
      if (hours > rules.trackingStaleHours) {
        found.push({
          type: 'TRACKING_STALE',
          dedupeSuffix: `stale@${last.getTime()}`,
          severity: hours > rules.trackingStaleHours * 2 ? 'HIGH' : 'LOW',
          message: `No tracking update received for ${fmtHours(hours)}`,
          recommendedAction: 'Refresh tracking; if still silent, ask the carrier to confirm the shipment location.',
        });
      }
    }
  }

  return found;
}
