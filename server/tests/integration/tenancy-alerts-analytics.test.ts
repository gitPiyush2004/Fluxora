import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { Types } from 'mongoose';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Alert } from '../../src/modules/alerts/alert.model.js';
import { runExceptionScan } from '../../src/modules/alerts/alert.service.js';
import { Shipment } from '../../src/modules/shipments/shipment.model.js';
import { createSocketServer } from '../../src/sockets/index.js';
import { emitToOrg, setRealtimeServer } from '../../src/sockets/realtime.js';
import { clearDb, connectTestDb, createOrgWithUser, disconnectTestDb, login, sampleSpec, type Session } from '../helpers.js';

beforeAll(() => connectTestDb('tenancy'));
afterAll(() => disconnectTestDb());

let a: Session;
let b: Session;
let orgA: Types.ObjectId;
let orgB: Types.ObjectId;

beforeEach(async () => {
  await clearDb();
  const ua = await createOrgWithUser({ orgName: 'Org A' });
  const ub = await createOrgWithUser({ orgName: 'Org B' });
  orgA = ua.org._id;
  orgB = ub.org._id;
  a = await login(ua.user.email);
  b = await login(ub.user.email);
});

describe('multi-tenant isolation', () => {
  it('prevents cross-organisation reads and writes by guessed IDs', async () => {
    const sup = (await a.post('/api/v1/suppliers', { supplierRef: 'S1', name: 'A supplier', email: 'a@a.example', country: 'DE', city: 'Berlin' }).expect(201)).body.data;
    const prod = (await a.post('/api/v1/products', { sku: 'A-1', name: 'A', unitOfMeasure: 'EA', defaultUnitCostMinor: 100, currency: 'USD' }).expect(201)).body.data;
    const sh = (await a.post('/api/v1/shipments', { spec: sampleSpec }).expect(201)).body.data;
    const po = (await a.post('/api/v1/purchase-orders', {
      supplierId: sup._id, orderDate: '2026-03-01', destination: { city: 'Berlin', country: 'DE' }, currency: 'EUR',
      lines: [{ description: 'x', quantity: 1, unitPriceMinor: 100 }],
    }).expect(201)).body.data;

    await b.get(`/api/v1/suppliers/${sup._id}`).expect(404);
    await b.patch(`/api/v1/suppliers/${sup._id}`, { name: 'hijack' }).expect(404);
    await b.patch(`/api/v1/products/${prod._id}/status`, { isActive: false }).expect(404);
    await b.get(`/api/v1/shipments/${sh._id}`).expect(404);
    await b.get(`/api/v1/shipments/${sh._id}/events`).expect(404);
    await b.post(`/api/v1/shipments/${sh._id}/quotes`).expect(404);
    await b.post(`/api/v1/shipments/${sh._id}/cancel`).expect(404);
    await b.get(`/api/v1/purchase-orders/${po._id}`).expect(404);
    await b.post(`/api/v1/purchase-orders/${po._id}/approve`).expect(404);

    // B cannot reference A's supplier in its own PO.
    await b.post('/api/v1/purchase-orders', { supplierId: sup._id, orderDate: '2026-03-01', destination: { city: 'X', country: 'DE' }, currency: 'EUR', lines: [{ description: 'x', quantity: 1, unitPriceMinor: 1 }] }).expect(422);

    expect((await b.get('/api/v1/suppliers').expect(200)).body.meta.total).toBe(0);
    expect((await b.get('/api/v1/shipments').expect(200)).body.meta.total).toBe(0);
    expect((await b.get('/api/v1/analytics/overview').expect(200)).body.data.shipments.total).toBe(0);
  });

  it('cannot select another organisation\'s quote', async () => {
    const shA = (await a.post('/api/v1/shipments', { spec: sampleSpec }).expect(201)).body.data;
    const quotesA = (await a.post(`/api/v1/shipments/${shA._id}/quotes`).expect(201)).body.data;
    const shB = (await b.post('/api/v1/shipments', { spec: sampleSpec }).expect(201)).body.data;
    await b.post(`/api/v1/shipments/${shB._id}/select-quote`, { quoteId: quotesA.quotes[0].id }).expect(404);
    await b.get(`/api/v1/quotes/requests/${quotesA.quoteRequestId}`).expect(404);
  });

  it('scopes Socket.IO events to the authenticated organisation', async () => {
    const { app, sessionMiddleware } = createApp();
    const server = http.createServer(app);
    const io = createSocketServer(server, sessionMiddleware);
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // supertest agents keep cookies in a jar; extract them for the socket client
    const jar = (s: Session) => (s.agent as unknown as { jar: { getCookies: (o: object) => { toValueString: () => string }[] } }).jar
      .getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false })
      .map((c) => c.toValueString())
      .join('; ');

    const connect = (cookie?: string) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = ioClient(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', (err) => reject(err));
      });

    try {
      await expect(connect()).rejects.toThrow(/UNAUTHENTICATED/);
      const sa = await connect(jar(a));
      const sb = await connect(jar(b));
      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];
      sa.on('shipment:updated', (p) => receivedA.push(p));
      sb.on('shipment:updated', (p) => receivedB.push(p));
      // A client cannot ask to join another room — there is no such handler.
      sb.emit('join', `org:${String(orgA)}`);
      await new Promise((r) => setTimeout(r, 100));
      emitToOrg(orgA, 'shipment:updated', { id: 'x' });
      await new Promise((r) => setTimeout(r, 150));
      expect(receivedA).toHaveLength(1);
      expect(receivedB).toHaveLength(0);
      sa.close();
      sb.close();
    } finally {
      setRealtimeServer(null);
      io.close();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('alerts', () => {
  it('detects, de-duplicates, acknowledges, resolves and auto-resolves exceptions', async () => {
    const sh = (await a.post('/api/v1/shipments', { spec: sampleSpec }).expect(201)).body.data;
    const past = new Date(Date.now() - 6 * 86_400_000);
    await Shipment.updateOne(
      { _id: sh._id },
      { $set: { status: 'IN_TRANSIT', statusChangedAt: new Date(), trackingMode: 'MANUAL', expectedDeliveryDate: past, booking: { reference: 'X', bookedAt: past } } },
    );
    const first = await runExceptionScan();
    expect(first.created).toBe(1);
    const again = await runExceptionScan();
    expect(again.created).toBe(0); // no duplicate for the same unresolved condition
    expect(await Alert.countDocuments({ organizationId: orgA })).toBe(1);

    const list = (await a.get('/api/v1/alerts').expect(200)).body.data;
    expect(list[0]).toMatchObject({ type: 'PAST_EXPECTED_DELIVERY', status: 'OPEN', shipmentReference: sh.reference });
    expect(list[0].recommendedAction).toBeTruthy();
    expect((await b.get('/api/v1/alerts').expect(200)).body.data).toHaveLength(0);
    await b.post(`/api/v1/alerts/${list[0]._id}/acknowledge`).expect(404);

    await a.post(`/api/v1/alerts/${list[0]._id}/acknowledge`).expect(200);
    await a.post(`/api/v1/alerts/${list[0]._id}/acknowledge`).expect(409);
    await a.post(`/api/v1/alerts/${list[0]._id}/resolve`, { note: 'Carrier confirmed new ETA' }).expect(200);
    // A manually resolved occurrence is not re-raised.
    expect((await runExceptionScan()).created).toBe(0);

    // A new occurrence (different expected date) opens a new alert, which auto-resolves when cleared.
    await Shipment.updateOne({ _id: sh._id }, { $set: { expectedDeliveryDate: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await runExceptionScan()).created).toBe(1);
    await Shipment.updateOne({ _id: sh._id }, { $set: { status: 'DELIVERED', deliveredAt: new Date() } });
    expect((await runExceptionScan()).autoResolved).toBe(1);
    const summary = (await a.get('/api/v1/alerts/summary').expect(200)).body.data;
    expect(summary.unresolved).toBe(0);
  });
});

describe('analytics', () => {
  async function insertDelivered(org: Types.ObjectId, opts: { currency: string; cost: number; carrier: string; pickedDaysAgo: number; deliveredDaysAgo: number; expectedDaysAgo: number }) {
    const d = (n: number) => new Date(Date.now() - n * 86_400_000);
    await Shipment.collection.insertOne({
      organizationId: org, reference: `SHP-T-${new Types.ObjectId().toHexString().slice(-6)}`, origin: { city: 'A', country: 'CN' }, destination: { city: 'B', country: 'US' },
      shipmentType: 'BOX', packageCount: 1, actualWeightKg: 10, billableWeightKg: 10, currency: opts.currency, status: 'DELIVERED',
      carrierCode: opts.carrier, carrierName: opts.carrier, freightCostMinor: opts.cost, booking: { reference: 'b', bookedAt: d(opts.pickedDaysAgo + 1) },
      pickedUpAt: d(opts.pickedDaysAgo), deliveredAt: d(opts.deliveredDaysAgo), expectedDeliveryDate: d(opts.expectedDaysAgo),
      createdAt: d(opts.pickedDaysAgo + 2), updatedAt: new Date(),
    });
  }

  it('computes metrics with disclosed denominators and separate currencies', async () => {
    await insertDelivered(orgA, { currency: 'USD', cost: 10_000, carrier: 'DHL', pickedDaysAgo: 10, deliveredDaysAgo: 8, expectedDaysAgo: 7 }); // on time, 2 days
    await insertDelivered(orgA, { currency: 'USD', cost: 30_000, carrier: 'DHL', pickedDaysAgo: 10, deliveredDaysAgo: 6, expectedDaysAgo: 8 }); // late, 4 days
    await insertDelivered(orgA, { currency: 'EUR', cost: 5_000, carrier: 'DSV', pickedDaysAgo: 5, deliveredDaysAgo: 2, expectedDaysAgo: 2 }); // on time (same day), 3 days
    await insertDelivered(orgB, { currency: 'USD', cost: 999_999, carrier: 'DHL', pickedDaysAgo: 5, deliveredDaysAgo: 1, expectedDaysAgo: 1 }); // other tenant

    const o = (await a.get('/api/v1/analytics/overview').expect(200)).body.data;
    expect(o.shipments.delivered).toBe(3);
    expect(o.freightSpend).toEqual(expect.arrayContaining([
      { currency: 'USD', totalMinor: 40_000, shipmentCount: 2 },
      { currency: 'EUR', totalMinor: 5_000, shipmentCount: 1 },
    ]));
    expect(o.onTimeDelivery).toMatchObject({ onTimeCount: 2, eligibleCount: 3 });
    expect(o.onTimeDelivery.rate).toBeCloseTo(2 / 3);
    expect(o.averageTransit).toMatchObject({ days: 3, eligibleCount: 3 });

    const carriers = (await a.get('/api/v1/analytics/carriers').expect(200)).body.data;
    const dhl = carriers.find((c: { carrierCode: string }) => c.carrierCode === 'DHL');
    expect(dhl.onTime).toMatchObject({ rate: 0.5, eligibleCount: 2 });
    expect(dhl.averageTransitDays.value).toBe(3);

    const filtered = (await a.get('/api/v1/analytics/overview?carrier=DSV').expect(200)).body.data;
    expect(filtered.freightSpend).toEqual([{ currency: 'EUR', totalMinor: 5_000, shipmentCount: 1 }]);
    // The status filter applies to spend in the overview just like on the freight report.
    const inTransitOnly = (await a.get('/api/v1/analytics/overview?status=IN_TRANSIT').expect(200)).body.data;
    expect(inTransitOnly.freightSpend).toEqual([]);
    const freightInTransit = (await a.get('/api/v1/analytics/freight?status=IN_TRANSIT').expect(200)).body.data;
    expect(freightInTransit.byCarrier).toEqual([]);

    const freight = (await a.get('/api/v1/analytics/freight').expect(200)).body.data;
    expect(new Set(freight.monthly.map((m: { currency: string }) => m.currency))).toEqual(new Set(['USD', 'EUR']));
    await a.get('/api/v1/analytics/overview?from=2026-05-01&to=2026-01-01').expect(422);
  });

  it('reports purchase-order totals per currency and status', async () => {
    const sup = (await a.post('/api/v1/suppliers', { supplierRef: 'S1', name: 'S', email: 's@s.example', country: 'DE', city: 'Berlin' }).expect(201)).body.data;
    const today = new Date().toISOString().slice(0, 10);
    for (const currency of ['USD', 'EUR']) {
      await a.post('/api/v1/purchase-orders', { supplierId: sup._id, orderDate: today, destination: { city: 'B', country: 'DE' }, currency, lines: [{ description: 'x', quantity: 2, unitPriceMinor: 500 }] }).expect(201);
    }
    const r = (await a.get('/api/v1/analytics/purchase-orders').expect(200)).body.data;
    expect(r.byStatus.DRAFT.count).toBe(2);
    expect(r.totals).toEqual(expect.arrayContaining([{ currency: 'USD', totalMinor: 1000, count: 1 }, { currency: 'EUR', totalMinor: 1000, count: 1 }]));
  });
});
