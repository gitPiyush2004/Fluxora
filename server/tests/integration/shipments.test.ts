import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SIM_PROFILES } from '../../src/integrations/carriers/simulator/profiles.js';
import { SimulatedCarrierAdapter } from '../../src/integrations/carriers/simulator/simulator.adapter.js';
import { CarrierError, type CarrierAdapter } from '../../src/integrations/carriers/types.js';
import { resetCarrierAdapters, setCarrierAdaptersForTesting } from '../../src/modules/carriers/carrier.registry.js';
import { Shipment } from '../../src/modules/shipments/shipment.model.js';
import { ShipmentEvent } from '../../src/modules/tracking/shipment-event.model.js';
import { appendShipmentEvent, purgeExpiredCarrierTracking } from '../../src/modules/tracking/tracking.service.js';
import { clearDb, connectTestDb, createOrgWithUser, disconnectTestDb, login, sampleSpec, type Session } from '../helpers.js';

beforeAll(() => connectTestDb('shipments'));
afterAll(() => disconnectTestDb());
afterEach(() => resetCarrierAdapters());

let s: Session;
beforeEach(async () => {
  await clearDb();
  const { user } = await createOrgWithUser();
  s = await login(user.email);
});

async function createDraft() {
  return (await s.post('/api/v1/shipments', { spec: sampleSpec, contentsDescription: 'Electronics' }).expect(201)).body.data;
}

async function quoteAndSelect(id: string) {
  const quotes = (await s.post(`/api/v1/shipments/${id}/quotes`).expect(201)).body.data;
  const best = quotes.recommendation.groups[0].bestBalancedId;
  await s.post(`/api/v1/shipments/${id}/select-quote`, { quoteId: best }).expect(200);
  return { quotes, best };
}

describe('shipment lifecycle', () => {
  it('creates a draft with computed weights and a CREATED event', async () => {
    const sh = await createDraft();
    expect(sh.reference).toMatch(/^SHP-\d{4}-\d{6}$/);
    expect(sh.status).toBe('DRAFT');
    expect(sh.volumetricWeightKg).toBe(32);
    expect(sh.billableWeightKg).toBe(32);
    const events = (await s.get(`/api/v1/shipments/${sh._id}/events`).expect(200)).body.data;
    expect(events.map((e: { type: string }) => e.type)).toEqual(['CREATED']);
  });

  it('validates the shipment specification', async () => {
    const res = await s.post('/api/v1/shipments', { spec: { ...sampleSpec, lengthCm: 10, widthCm: undefined, actualWeightKg: -1 } }).expect(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['spec.actualWeightKg', 'spec.lengthCm']));
  });

  it('compares carriers with provenance labels and recommendations', async () => {
    const sh = await createDraft();
    const data = (await s.post(`/api/v1/shipments/${sh._id}/quotes`).expect(201)).body.data;
    expect(data.providers).toHaveLength(6);
    expect(data.allSimulated).toBe(true);
    for (const q of data.quotes) {
      expect(q.provenance.sourceType).toBe('SIMULATED');
      expect(q.provenance.isSimulated).toBe(true);
      expect(q.provenance.retrievedAt).toBeTruthy();
    }
    const freightOnly = data.quotes.filter((q: { carrierCode: string; serviceCode: string }) => q.serviceCode.endsWith('SEA'));
    expect(freightOnly.every((q: { eligibility: { eligible: boolean } }) => !q.eligibility.eligible)).toBe(true); // BOX not accepted by sea LCL
    const g = data.recommendation.groups[0];
    expect(g.cheapestId && g.fastestId && g.bestBalancedId).toBeTruthy();
    // No delivery history yet → reliability excluded, never assumed perfect.
    expect(g.excludedMetrics[0].metric).toBe('reliability');
  });

  it('re-ranks immediately with custom weights', async () => {
    const sh = await createDraft();
    const data = (await s.post(`/api/v1/shipments/${sh._id}/quotes`).expect(201)).body.data;
    const ranked = (await s.post(`/api/v1/shipments/${sh._id}/quotes/rank`, { quoteRequestId: data.quoteRequestId, weights: { cost: 0, transit: 100, reliability: 0 } }).expect(200)).body.data;
    expect(ranked.recommendation.groups[0].bestBalancedId).toBe(ranked.recommendation.groups[0].fastestId);
    // All-zero weights are a validation error, not a server error.
    await s.post(`/api/v1/shipments/${sh._id}/quotes/rank`, { quoteRequestId: data.quoteRequestId, weights: { cost: 0, transit: 0, reliability: 0 } }).expect(422);
  });

  it('isolates provider failures: one failing carrier does not block the others', async () => {
    const failing: CarrierAdapter = {
      code: 'FEDEX', name: 'FedEx', providerId: 'broken', mode: 'LIVE',
      capabilities: { quotes: true, booking: false, tracking: false, cancellation: false },
      getQuotes: async () => { throw new CarrierError('FEDEX', 'AUTH', 'Authentication failed: invalid client'); },
    };
    const hanging: CarrierAdapter = {
      code: 'DSV', name: 'DSV', providerId: 'slow', mode: 'LIVE',
      capabilities: { quotes: true, booking: false, tracking: false, cancellation: false },
      getQuotes: (_r, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))),
    };
    setCarrierAdaptersForTesting([failing, hanging], SIM_PROFILES.map((p) => new SimulatedCarrierAdapter(p)));
    const sh = await createDraft();
    const data = (await s.post(`/api/v1/shipments/${sh._id}/quotes`).expect(201)).body.data;
    const status = Object.fromEntries(data.providers.map((p: { carrierCode: string; status: string }) => [p.carrierCode, p.status]));
    expect(status).toMatchObject({ FEDEX: 'AUTH', DSV: 'TIMEOUT', DHL: 'OK', KUEHNE_NAGEL: 'OK', CEVA: 'OK' });
    expect(data.quotes.length).toBeGreaterThan(0);
  });

  it('selects an offer, books it once (idempotent) and records a simulated booking', async () => {
    const sh = await createDraft();
    await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'key-before-select' }).expect(409); // nothing selected
    const { best } = await quoteAndSelect(sh._id);
    const quoted = (await s.get(`/api/v1/shipments/${sh._id}`).expect(200)).body.data;
    expect(quoted.status).toBe('QUOTED');
    expect(String(quoted.selectedQuoteId)).toBe(best);

    await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }).expect(400); // missing key
    const first = await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'booking-key-0001' }).expect(201);
    const replay = await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'booking-key-0001' }).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.booking.reference).toBe(first.body.data.booking.reference);
    await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'booking-key-0002' }).expect(409);

    const booked = first.body.data;
    expect(booked.status).toBe('BOOKED');
    expect(booked.booking.isSimulated).toBe(true);
    expect(booked.trackingMode).toBe('SIMULATED');
    expect(await ShipmentEvent.countDocuments({ shipmentId: sh._id, type: 'BOOKED' })).toBe(1);
  });

  it('handles concurrent duplicate booking requests safely', async () => {
    const sh = await createDraft();
    await quoteAndSelect(sh._id);
    const results = await Promise.all(
      ['k-concurrent-1', 'k-concurrent-2', 'k-concurrent-3'].map((k) => s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': k })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await ShipmentEvent.countDocuments({ shipmentId: sh._id, type: 'BOOKED' })).toBe(1);
  });

  it('does not mark the shipment booked when the provider booking fails', async () => {
    const sims = SIM_PROFILES.map((p) => new SimulatedCarrierAdapter(p));
    for (const a of sims) a.bookShipment = async () => { throw new CarrierError(a.code, 'UNAVAILABLE', 'Carrier booking service unavailable'); };
    setCarrierAdaptersForTesting([], sims);
    const sh = await createDraft();
    await quoteAndSelect(sh._id);
    const res = await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'failing-key-001' }).expect(502);
    expect(res.body.error.message).toMatch(/unavailable/);
    const after = await Shipment.findById(sh._id).lean();
    expect(after!.status).toBe('QUOTED');
    expect(after!.booking?.reference).toBeUndefined();
    expect(after!.bookingLock).toBeUndefined();
    expect(await ShipmentEvent.countDocuments({ shipmentId: sh._id, type: 'BOOKING_FAILED' })).toBe(1);
  });

  it('records a manual booking for carriers without booking APIs', async () => {
    const sh = await createDraft();
    await quoteAndSelect(sh._id);
    const res = await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'MANUAL', bookingReference: 'CARRIER-REF-1', trackingNumber: '1234567890' }, { 'Idempotency-Key': 'manual-key-0001' }).expect(201);
    expect(res.body.data.booking).toMatchObject({ reference: 'CARRIER-REF-1', provider: 'manual', isSimulated: false });
    expect(res.body.data.trackingMode).toBe('MANUAL');
  });

  it('progresses simulated tracking and records manual updates with valid transitions only', async () => {
    const sh = await createDraft();
    await quoteAndSelect(sh._id);
    await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'track-key-0001' }).expect(201);
    const step = (await s.post(`/api/v1/shipments/${sh._id}/simulate-next`).expect(200)).body.data;
    expect(step.status).toBe('PICKED_UP');
    const events = (await s.get(`/api/v1/shipments/${sh._id}/events?order=asc`).expect(200)).body.data;
    const last = events.at(-1);
    expect(last.source).toMatchObject({ type: 'SIMULATED', isSimulated: true });
    expect(last.previousStatus).toBe('BOOKED');

    await s.post(`/api/v1/shipments/${sh._id}/events`, { status: 'IN_TRANSIT', description: 'Departed hub', city: 'Leipzig', country: 'DE' }).expect(201);
    await s.post(`/api/v1/shipments/${sh._id}/events`, { status: 'IN_TRANSIT', description: 'Note only' }).expect(201);
    const after = (await s.get(`/api/v1/shipments/${sh._id}`).expect(200)).body.data;
    expect(after.status).toBe('IN_TRANSIT');
    expect(after.lastKnownLocation).toBe('Leipzig, DE');
    await s.post(`/api/v1/shipments/${sh._id}/cancel`).expect(409); // in transit cannot be cancelled
  });

  it('keeps shipment events append-only', async () => {
    const sh = await createDraft();
    await expect(ShipmentEvent.updateOne({ shipmentId: sh._id }, { $set: { description: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(ShipmentEvent.deleteMany({ shipmentId: sh._id })).rejects.toThrow(/append-only/);
  });

  it('clears the selected offer when specification changes and blocks stale quotes', async () => {
    const sh = await createDraft();
    const { best } = await quoteAndSelect(sh._id);
    const edited = (await s.patch(`/api/v1/shipments/${sh._id}`, { spec: { ...sampleSpec, actualWeightKg: 45 } }).expect(200)).body.data;
    expect(edited.status).toBe('DRAFT');
    expect(edited.selectedQuoteId).toBeUndefined();
    const res = await s.post(`/api/v1/shipments/${sh._id}/select-quote`, { quoteId: best }).expect(409);
    expect(res.body.error.message).toMatch(/changed after this quote/);
  });

  it('cancels a simulated booking through the simulator', async () => {
    const sh = await createDraft();
    const { quotes } = await quoteAndSelect(sh._id);
    expect(quotes).toBeTruthy();
    await s.post(`/api/v1/shipments/${sh._id}/book`, { mode: 'PROVIDER' }, { 'Idempotency-Key': 'cancel-key-0001' }).expect(201);
    const res = (await s.post(`/api/v1/shipments/${sh._id}/cancel`, { reason: 'Customer request' }).expect(200)).body.data;
    expect(res.status).toBe('CANCELLED');
  });

  it('creates a shipment from a stand-alone comparison using the server-side spec', async () => {
    const cmp = (await s.post('/api/v1/quotes/compare', { spec: sampleSpec }).expect(201)).body.data;
    const quoteId = cmp.recommendation.groups[0].cheapestId;
    const sh = (await s.post('/api/v1/shipments', { spec: { ...sampleSpec, actualWeightKg: 1 }, quoteId }).expect(201)).body.data;
    expect(sh.status).toBe('QUOTED');
    expect(sh.actualWeightKg).toBe(30); // spec taken from the priced request, not the client
    await s.post('/api/v1/shipments', { spec: sampleSpec, quoteId }).expect(409); // quote already used
  });

  it('lists with filters, search, sorting and pagination', async () => {
    for (let i = 0; i < 3; i++) await createDraft();
    const page = (await s.get('/api/v1/shipments?pageSize=2&page=2&sortBy=reference&sortDir=asc').expect(200)).body;
    expect(page.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page.data).toHaveLength(1);
    const search = (await s.get('/api/v1/shipments?search=shenzhen&status=DRAFT').expect(200)).body;
    expect(search.meta.total).toBe(3);
    await s.get('/api/v1/shipments?status=NOT_A_STATUS').expect(422);
    // Bracket syntax is not parsed into operator objects (simple query parser) — injection is inert.
    const injected = (await s.get('/api/v1/shipments?search[$ne]=x&status[$in]=DRAFT').expect(200)).body;
    expect(injected.meta.total).toBe(3);
  });

  it('deletes DHL tracking events 30 days after delivery and keeps other events', async () => {
    const sh = await createDraft();
    const doc = (await Shipment.findById(sh._id))!;
    const dhl = { type: 'TRACKING', description: 'Delivered', source: { type: 'CARRIER_API', provider: 'dhl-unified-tracking', isSimulated: false } } as const;
    await appendShipmentEvent(doc, { ...dhl, externalEventId: 'dhl:1' });
    await Shipment.updateOne({ _id: sh._id }, { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 31 * 86_400_000) });
    expect(await purgeExpiredCarrierTracking()).toEqual({ deleted: 1 });
    const left = await ShipmentEvent.find({ shipmentId: sh._id });
    expect(left.map((e) => e.type)).toEqual(['CREATED']);
  });
});
