import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { emitToOrg } from '../../sockets/realtime.js';
import { conflict, notFound } from '../../utils/errors.js';
import { pageMeta } from '../../utils/pagination.js';
import { recordAudit, type AuditActor } from '../audit/audit.model.js';
import { DEFAULT_STUCK_THRESHOLDS_HOURS, Organization } from '../organizations/organization.model.js';
import { Shipment, type ShipmentDoc } from '../shipments/shipment.model.js';
import { TRACKABLE_STATUSES, type ShipmentStatus } from '../shipments/shipment.rules.js';
import { Alert } from './alert.model.js';
import type { AlertListQuery } from './alert.schemas.js';
import { detectExceptions, type AlertSeverity, type ExceptionRuleConfig } from './exception-rules.js';

const UNRESOLVED = ['OPEN', 'ACKNOWLEDGED'];
const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export async function listAlerts(organizationId: Types.ObjectId, q: AlertListQuery) {
  const filter: Record<string, unknown> = { organizationId };
  if (q.status === 'UNRESOLVED') filter.status = { $in: UNRESOLVED };
  else if (q.status !== 'ALL') filter.status = q.status;
  if (q.severity) filter.severity = q.severity;
  if (q.type) filter.type = q.type;
  if (q.shipmentId) filter.shipmentId = q.shipmentId;
  const [items, total] = await Promise.all([
    Alert.find(filter).sort({ detectedAt: -1, _id: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Alert.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

/** Counts of unresolved alerts by status and severity (sidebar badge and Tracking page). */
export async function alertSummary(organizationId: Types.ObjectId) {
  const rows = await Alert.aggregate<{ _id: { status: string; severity: AlertSeverity }; count: number }>([
    { $match: { organizationId, status: { $in: UNRESOLVED } } },
    { $group: { _id: { status: '$status', severity: '$severity' }, count: { $sum: 1 } } },
  ]);
  const bySeverity: Record<AlertSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let open = 0;
  let acknowledged = 0;
  for (const r of rows) {
    bySeverity[r._id.severity] += r.count;
    if (r._id.status === 'OPEN') open += r.count;
    else acknowledged += r.count;
  }
  const present = (Object.keys(bySeverity) as AlertSeverity[]).filter((sev) => bySeverity[sev] > 0);
  const highestSeverity = present.sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0] ?? null;
  return { open, acknowledged, unresolved: open + acknowledged, bySeverity, highestSeverity };
}

export async function rulesForOrg(organizationId: Types.ObjectId): Promise<ExceptionRuleConfig> {
  const org = await Organization.findById(organizationId).select('settings.exceptionRules').lean();
  const r = org?.settings?.exceptionRules;
  return {
    stuckThresholdsHours: { ...DEFAULT_STUCK_THRESHOLDS_HOURS, ...(r?.stuckThresholdsHours ?? {}) } as ExceptionRuleConfig['stuckThresholdsHours'],
    trackingStaleHours: r?.trackingStaleHours ?? 36,
    overdueGraceHours: r?.overdueGraceHours ?? 0,
  };
}

type ShipmentLike = Pick<ShipmentDoc, '_id' | 'organizationId' | 'reference' | 'status' | 'statusChangedAt' | 'expectedDeliveryDate' | 'lastTrackingUpdateAt' | 'trackingMode' | 'quoteIsSimulated' | 'isDemo'>;

/**
 * Evaluates one shipment: opens alerts for new conditions (de-duplicated by a partial
 * unique index on unresolved alerts) and auto-resolves alerts whose condition cleared.
 */
export async function evaluateShipmentAlerts(shipment: ShipmentLike, rules: ExceptionRuleConfig, now = new Date()) {
  const detected = TRACKABLE_STATUSES.includes(shipment.status as ShipmentStatus)
    ? detectExceptions(
        {
          status: shipment.status as ShipmentStatus,
          statusChangedAt: shipment.statusChangedAt,
          expectedDeliveryDate: shipment.expectedDeliveryDate,
          lastTrackingUpdateAt: shipment.lastTrackingUpdateAt,
          trackingMode: shipment.trackingMode,
        },
        rules,
        now,
      )
    : [];

  const keys = new Set<string>();
  const created = [];
  for (const d of detected) {
    const dedupeKey = `${String(shipment._id)}:${d.type}:${d.dedupeSuffix}`;
    keys.add(dedupeKey);
    // A person already resolved this exact occurrence — respect that decision.
    if (await Alert.exists({ organizationId: shipment.organizationId, dedupeKey, status: 'RESOLVED', autoResolved: false })) continue;
    try {
      const alert = await Alert.create({
        organizationId: shipment.organizationId,
        shipmentId: shipment._id,
        shipmentReference: shipment.reference,
        type: d.type,
        severity: d.severity,
        message: d.message,
        recommendedAction: d.recommendedAction,
        status: 'OPEN',
        detectedAt: now,
        dedupeKey,
        openKey: dedupeKey,
        isSimulatedSource: shipment.trackingMode === 'SIMULATED',
        isDemo: shipment.isDemo ?? false,
      });
      created.push(alert);
      emitToOrg(shipment.organizationId, 'alert:created', alert.toJSON());
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      // Already open: refresh the message/severity (e.g. "overdue by 2 days" → "3 days").
      await Alert.updateOne(
        { organizationId: shipment.organizationId, openKey: dedupeKey },
        { $set: { message: d.message, severity: d.severity } },
      );
    }
  }

  const stale = await Alert.find({
    organizationId: shipment.organizationId,
    shipmentId: shipment._id,
    openKey: { $type: 'string' },
    dedupeKey: { $nin: [...keys] },
  });
  for (const alert of stale) {
    alert.status = 'RESOLVED';
    alert.resolvedAt = now;
    alert.autoResolved = true;
    alert.resolutionNote = 'Condition no longer detected (auto-resolved)';
    alert.openKey = undefined;
    await alert.save();
    emitToOrg(shipment.organizationId, 'alert:updated', alert.toJSON());
  }
  return { created: created.length, autoResolved: stale.length };
}

/** Scans all monitored shipments across organisations. Idempotent; safe to run concurrently. */
export async function runExceptionScan(now = new Date()) {
  let scanned = 0;
  let created = 0;
  let autoResolved = 0;
  const rulesCache = new Map<string, ExceptionRuleConfig>();
  const cursor = Shipment.find({ $or: [{ status: { $in: TRACKABLE_STATUSES } }, { status: { $in: ['DELIVERED', 'CANCELLED'] }, updatedAt: { $gte: new Date(now.getTime() - 7 * 86_400_000) } }] })
    .select('organizationId reference status statusChangedAt expectedDeliveryDate lastTrackingUpdateAt trackingMode quoteIsSimulated isDemo')
    .cursor();
  for await (const s of cursor) {
    const key = String(s.organizationId);
    let rules = rulesCache.get(key);
    if (!rules) {
      rules = await rulesForOrg(s.organizationId);
      rulesCache.set(key, rules);
    }
    try {
      const r = await evaluateShipmentAlerts(s, rules, now);
      created += r.created;
      autoResolved += r.autoResolved;
    } catch (err) {
      logger.error({ err: (err as Error).message, shipmentId: String(s._id) }, 'Exception evaluation failed');
    }
    scanned += 1;
  }
  return { scanned, created, autoResolved };
}

export async function acknowledgeAlert(organizationId: Types.ObjectId, id: string, actor: AuditActor) {
  const alert = await Alert.findOne({ _id: id, organizationId });
  if (!alert) throw notFound('Alert');
  if (alert.status !== 'OPEN') throw conflict(`Only open alerts can be acknowledged (current: ${alert.status})`);
  alert.status = 'ACKNOWLEDGED';
  alert.acknowledgedAt = new Date();
  alert.acknowledgedBy = actor.userId;
  alert.acknowledgedByName = actor.name;
  await alert.save();
  await recordAudit({ organizationId, entityType: 'ALERT', entityId: alert._id, action: 'ACKNOWLEDGED', summary: `Alert acknowledged`, actor });
  emitToOrg(organizationId, 'alert:updated', alert.toJSON());
  return alert;
}

export async function resolveAlert(organizationId: Types.ObjectId, id: string, actor: AuditActor, note?: string) {
  const alert = await Alert.findOne({ _id: id, organizationId });
  if (!alert) throw notFound('Alert');
  if (alert.status === 'RESOLVED') throw conflict('Alert is already resolved');
  alert.status = 'RESOLVED';
  alert.resolvedAt = new Date();
  alert.resolvedBy = actor.userId;
  alert.resolvedByName = actor.name;
  alert.resolutionNote = note;
  alert.openKey = undefined;
  await alert.save();
  await recordAudit({ organizationId, entityType: 'ALERT', entityId: alert._id, action: 'RESOLVED', summary: note ? `Resolved: ${note}` : 'Resolved', actor });
  emitToOrg(organizationId, 'alert:updated', alert.toJSON());
  return alert;
}
