import { describe, expect, it } from 'vitest';
import { detectExceptions, type ExceptionRuleConfig } from '../../src/modules/alerts/exception-rules.js';
import { applyReceipt, canTransitionPo, PO_STATUSES, PO_TRANSITIONS } from '../../src/modules/purchase-orders/purchase-order.rules.js';
import { canTransitionShipment, SHIPMENT_STATUSES, SHIPMENT_TRANSITIONS } from '../../src/modules/shipments/shipment.rules.js';

describe('shipment status transitions', () => {
  it('allows the happy path', () => {
    const path = ['DRAFT', 'QUOTED', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransitionShipment(path[i - 1], path[i])).toBe(true);
  });

  it('rejects arbitrary jumps and leaving terminal states', () => {
    expect(canTransitionShipment('DRAFT', 'DELIVERED')).toBe(false);
    expect(canTransitionShipment('DRAFT', 'BOOKED')).toBe(false);
    expect(canTransitionShipment('DELIVERED', 'IN_TRANSIT')).toBe(false);
    expect(canTransitionShipment('CANCELLED', 'DRAFT')).toBe(false);
    expect(canTransitionShipment('IN_TRANSIT', 'CANCELLED')).toBe(false);
  });

  it('defines transitions for every status', () => {
    for (const s of SHIPMENT_STATUSES) expect(SHIPMENT_TRANSITIONS[s]).toBeDefined();
  });
});

describe('purchase order transitions', () => {
  it('follows the documented lifecycle', () => {
    expect(canTransitionPo('DRAFT', 'APPROVED')).toBe(true);
    expect(canTransitionPo('APPROVED', 'READY_TO_SHIP')).toBe(true);
    expect(canTransitionPo('READY_TO_SHIP', 'PARTIALLY_RECEIVED')).toBe(true);
    expect(canTransitionPo('PARTIALLY_RECEIVED', 'RECEIVED')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(canTransitionPo('DRAFT', 'READY_TO_SHIP')).toBe(false);
    expect(canTransitionPo('RECEIVED', 'CANCELLED')).toBe(false);
    expect(canTransitionPo('PARTIALLY_RECEIVED', 'CANCELLED')).toBe(false);
    for (const s of PO_STATUSES) expect(PO_TRANSITIONS[s]).toBeDefined();
  });
});

describe('goods receipt validation', () => {
  const lines = [
    { id: 'l1', quantity: 10, receivedQuantity: 0 },
    { id: 'l2', quantity: 2.5, receivedQuantity: 1 },
  ];

  it('accepts partial and then full receipts', () => {
    const partial = applyReceipt(lines, [{ lineId: 'l1', quantity: 4 }]);
    expect(partial).toEqual({ ok: true, receivedByLine: { l1: 4, l2: 1 }, nextStatus: 'PARTIALLY_RECEIVED' });
    const full = applyReceipt(lines, [{ lineId: 'l1', quantity: 10 }, { lineId: 'l2', quantity: 1.5 }]);
    expect(full.ok && full.nextStatus).toBe('RECEIVED');
  });

  it('rejects negative, zero, excessive, duplicate and unknown lines', () => {
    const r = applyReceipt(lines, [
      { lineId: 'l1', quantity: -1 },
      { lineId: 'l2', quantity: 2 },
      { lineId: 'nope', quantity: 1 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.lineId)).toEqual(['l1', 'l2', 'nope']);
      expect(r.errors[1]!.message).toMatch(/exceeds outstanding quantity \(1\.5\)/);
    }
    const dup = applyReceipt(lines, [{ lineId: 'l1', quantity: 1 }, { lineId: 'l1', quantity: 1 }]);
    expect(dup.ok).toBe(false);
    expect(applyReceipt(lines, []).ok).toBe(false);
    expect(applyReceipt(lines, [{ lineId: 'l1', quantity: 0 }]).ok).toBe(false);
  });

  it('handles decimal quantities exactly', () => {
    const r = applyReceipt([{ id: 'a', quantity: 0.3, receivedQuantity: 0.1 }], [{ lineId: 'a', quantity: 0.2 }]);
    expect(r.ok && r.nextStatus).toBe('RECEIVED');
  });
});

describe('exception detection rules', () => {
  const rules: ExceptionRuleConfig = { stuckThresholdsHours: { BOOKED: 72, IN_TRANSIT: 120 }, trackingStaleHours: 36, overdueGraceHours: 0 };
  const now = new Date('2026-05-10T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('detects shipments stuck in a status', () => {
    const r = detectExceptions({ status: 'BOOKED', statusChangedAt: hoursAgo(80) }, rules, now);
    expect(r.map((e) => e.type)).toEqual(['STUCK_IN_STATUS']);
    expect(r[0]!.severity).toBe('MEDIUM');
    expect(detectExceptions({ status: 'BOOKED', statusChangedAt: hoursAgo(200) }, rules, now)[0]!.severity).toBe('HIGH');
    expect(detectExceptions({ status: 'BOOKED', statusChangedAt: hoursAgo(10) }, rules, now)).toEqual([]);
  });

  it('detects overdue deliveries after the end of the expected day', () => {
    const today = detectExceptions({ status: 'IN_TRANSIT', statusChangedAt: hoursAgo(1), lastTrackingUpdateAt: hoursAgo(1), expectedDeliveryDate: new Date('2026-05-10T09:00:00Z') }, rules, now);
    expect(today.find((e) => e.type === 'PAST_EXPECTED_DELIVERY')).toBeUndefined();
    const overdue = detectExceptions({ status: 'IN_TRANSIT', statusChangedAt: hoursAgo(1), lastTrackingUpdateAt: hoursAgo(1), expectedDeliveryDate: new Date('2026-05-06T09:00:00Z') }, rules, now);
    const alert = overdue.find((e) => e.type === 'PAST_EXPECTED_DELIVERY')!;
    expect(alert.severity).toBe('CRITICAL');
    expect(alert.recommendedAction).toBeTruthy();
  });

  it('flags provider-reported exceptions and delays', () => {
    expect(detectExceptions({ status: 'EXCEPTION', statusChangedAt: hoursAgo(1) }, rules, now)[0]).toMatchObject({ type: 'CARRIER_EXCEPTION', severity: 'HIGH' });
    expect(detectExceptions({ status: 'DELAYED', statusChangedAt: hoursAgo(1), lastTrackingUpdateAt: hoursAgo(1) }, rules, now)[0]).toMatchObject({ type: 'CARRIER_EXCEPTION', severity: 'MEDIUM' });
  });

  it('flags missing tracking updates only for automated tracking', () => {
    const stale = { status: 'IN_TRANSIT' as const, statusChangedAt: hoursAgo(50), lastTrackingUpdateAt: hoursAgo(50) };
    expect(detectExceptions({ ...stale, trackingMode: 'SIMULATED' }, rules, now).map((e) => e.type)).toEqual(['TRACKING_STALE']);
    expect(detectExceptions({ ...stale, trackingMode: 'MANUAL' }, rules, now)).toEqual([]);
  });

  it('ignores terminal and planning statuses', () => {
    expect(detectExceptions({ status: 'DELIVERED', statusChangedAt: hoursAgo(1000), expectedDeliveryDate: hoursAgo(900) }, rules, now)).toEqual([]);
  });

  it('produces occurrence-specific dedupe keys', () => {
    const a = detectExceptions({ status: 'BOOKED', statusChangedAt: hoursAgo(80) }, rules, now)[0]!;
    const b = detectExceptions({ status: 'BOOKED', statusChangedAt: hoursAgo(81) }, rules, now)[0]!;
    expect(a.dedupeSuffix).not.toBe(b.dedupeSuffix);
  });
});
