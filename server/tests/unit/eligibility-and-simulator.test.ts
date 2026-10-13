import { describe, expect, it } from 'vitest';
import { checkEligibility } from '../../src/modules/carriers/eligibility.js';
import { SIM_PROFILES } from '../../src/integrations/carriers/simulator/profiles.js';
import { SimulatedCarrierAdapter } from '../../src/integrations/carriers/simulator/simulator.adapter.js';
import { buildSimulatedTrackingEvents, planSimulatedJourney } from '../../src/integrations/carriers/simulator/simulated-tracking.js';
import type { ShipmentRequest } from '../../src/integrations/carriers/types.js';

const NOW = new Date('2026-03-02T09:00:00Z'); // a Monday

const req = (over: Partial<ShipmentRequest> = {}): ShipmentRequest => ({
  origin: { city: 'Shenzhen', country: 'CN' },
  destination: { city: 'Newark', country: 'US' },
  shipmentType: 'BOX',
  packageCount: 2,
  actualWeightKg: 30,
  lengthCm: 50,
  widthCm: 40,
  heightCm: 40,
  insuranceRequired: false,
  specialHandling: [],
  currency: 'USD',
  shipDate: NOW,
  ...over,
});

const dhl = new SimulatedCarrierAdapter(SIM_PROFILES.find((p) => p.code === 'DHL')!, () => NOW);
const dsv = new SimulatedCarrierAdapter(SIM_PROFILES.find((p) => p.code === 'DSV')!, () => NOW);

describe('carrier simulator', () => {
  it('labels every quote as simulated demonstration data', async () => {
    const quotes = await dhl.getQuotes(req());
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      expect(q.provenance.sourceType).toBe('SIMULATED');
      expect(q.provenance.isSimulated).toBe(true);
      expect(q.provenance.limitations.join(' ')).toMatch(/not an offer from the carrier/);
      expect(q.serviceName).toMatch(/simulated/);
      expect(Number.isSafeInteger(q.totalMinor)).toBe(true);
      expect(q.totalMinor).toBe(q.breakdown.reduce((a, b) => a + b.amountMinor, 0));
    }
  });

  it('is deterministic for identical inputs', async () => {
    expect(await dhl.getQuotes(req())).toEqual(await dhl.getQuotes(req()));
  });

  it('adds handling surcharges and insurance when requested', async () => {
    const base = (await dsv.getQuotes(req({ shipmentType: 'PALLET' })))[0]!;
    const extra = (await dsv.getQuotes(req({ shipmentType: 'PALLET', specialHandling: ['DANGEROUS_GOODS'], insuranceRequired: true, cargoValueMinor: 5_000_000 })))[0]!;
    expect(extra.totalMinor).toBeGreaterThan(base.totalMinor);
    expect(extra.breakdown.map((b) => b.label)).toEqual(expect.arrayContaining(['Cargo insurance', 'Handling: dangerous goods']));
  });

  it('produces simulated bookings that are explicitly flagged', async () => {
    const b = await dhl.bookShipment({ shipmentReference: 'SHP-1', quote: { serviceCode: 'x', serviceLevel: 'EXPRESS', transitDays: 3, estimatedDeliveryDate: null }, request: req(), idempotencyKey: 'key-12345678' });
    expect(b.isSimulated).toBe(true);
    expect(b.bookingReference).toMatch(/^SIM-BK-DHL-/);
    expect(b.trackingNumber).toMatch(/^SIM\d{10}$/);
  });
});

describe('quote eligibility (hard constraints)', () => {
  it('rejects shipment types, weights and handling the service does not support', async () => {
    const [express] = await dhl.getQuotes(req({ shipmentType: 'PALLET', actualWeightKg: 400, packageCount: 1, specialHandling: ['TEMPERATURE_CONTROLLED'] }));
    const result = checkEligibility(express!, req({ shipmentType: 'PALLET', actualWeightKg: 400, packageCount: 1, specialHandling: ['TEMPERATURE_CONTROLLED'] }), NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join('\n')).toMatch(/pallet/);
    expect(result.reasons.join('\n')).toMatch(/per-package limit/);
    expect(result.reasons.join('\n')).toMatch(/temperature-controlled/);
  });

  it('enforces delivery deadlines, budgets and service preference', async () => {
    const quotes = await dhl.getQuotes(req());
    const economy = quotes.find((q) => q.serviceLevel === 'ECONOMY')!;
    const tooSoon = new Date(NOW.getTime() + 2 * 86_400_000);
    const r = checkEligibility(economy, req({ requiredDeliveryDate: tooSoon, maxBudgetMinor: 100, servicePreference: 'EXPRESS' }), NOW);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join('\n')).toMatch(/misses the required date/);
    expect(r.reasons.join('\n')).toMatch(/maximum budget/);
    expect(r.reasons.join('\n')).toMatch(/does not match the requested express/);
  });

  it('flags currency mismatch against a budget instead of converting', async () => {
    const [quote] = await dhl.getQuotes(req({ currency: 'EUR' }));
    const r = checkEligibility(quote!, req({ currency: 'USD', maxBudgetMinor: 1_000_000 }), NOW);
    expect(r.reasons.join()).toMatch(/no conversion is configured/);
  });

  it('marks expired quotes ineligible', async () => {
    const [quote] = await dhl.getQuotes(req());
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(checkEligibility(quote!, req(), later).reasons).toContain('Quote has expired');
  });
});

describe('simulated tracking', () => {
  const ctx = { trackingNumber: 'SIM0000000001', bookedAt: NOW, expectedDeliveryDate: new Date(NOW.getTime() + 4 * 86_400_000), origin: { city: 'Shenzhen', country: 'CN' }, destination: { city: 'Newark', country: 'US' } };

  it('releases only events whose time has passed, all flagged as simulated', () => {
    const early = buildSimulatedTrackingEvents(ctx, new Date(NOW.getTime() + 60_000));
    expect(early).toHaveLength(0);
    const later = buildSimulatedTrackingEvents(ctx, new Date(NOW.getTime() + 10 * 86_400_000));
    expect(later.length).toBe(planSimulatedJourney(ctx).length);
    expect(later.every((e) => e.provenance.isSimulated)).toBe(true);
    expect(later.at(-1)!.status).toBe('DELIVERED');
  });

  it('force-advanced steps are stamped with the current time and stay ordered', () => {
    const now = new Date(NOW.getTime() + 60_000);
    const events = buildSimulatedTrackingEvents({ ...ctx, simulationStep: 2 }, now);
    expect(events).toHaveLength(2);
    expect(new Date(events[1]!.occurredAt).getTime()).toBeGreaterThan(new Date(events[0]!.occurredAt).getTime());
  });

  it('delayed journeys report a delay and deliver late', () => {
    const steps = planSimulatedJourney({ ...ctx, simulationOutcome: 'DELAYED' });
    expect(steps.some((s) => s.status === 'DELAYED')).toBe(true);
    expect(steps.at(-1)!.at).toBeGreaterThan(ctx.expectedDeliveryDate.getTime());
  });
});
