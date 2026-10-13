import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addUserToOrg, clearDb, connectTestDb, createOrgWithUser, disconnectTestDb, login, type Session } from '../helpers.js';

beforeAll(() => connectTestDb('erp'));
afterAll(() => disconnectTestDb());

let admin: Session;
let member: Session;

const supplierBody = { supplierRef: 'SUP-001', name: 'Acme Components', email: 'orders@acme.example', country: 'CN', city: 'Shenzhen', postalCode: '518000' };

async function createSupplier(s: Session, over: object = {}) {
  const res = await s.post('/api/v1/suppliers', { ...supplierBody, ...over }).expect(201);
  return res.body.data;
}

async function createProduct(s: Session) {
  const res = await s.post('/api/v1/products', { sku: 'WID-1', name: 'Widget', unitOfMeasure: 'EA', defaultUnitCostMinor: 1999, currency: 'USD' }).expect(201);
  return res.body.data;
}

const poBody = (supplierId: string, productId?: string) => ({
  supplierId,
  orderDate: '2026-03-01',
  expectedDeliveryDate: '2026-04-01',
  destination: { name: 'DC', city: 'Newark', postalCode: '07114', country: 'US' },
  currency: 'USD',
  lines: [
    { productId, description: 'Widget', quantity: 3, unitPriceMinor: 1999 },
    { description: 'Cable, per metre', quantity: 2.5, unitPriceMinor: 120 },
  ],
  taxRateBps: 1000,
  additionalChargesMinor: 500,
  // Client-supplied totals must be ignored.
  subtotalMinor: 1,
  totalMinor: 1,
});

beforeEach(async () => {
  await clearDb();
  const { org, user } = await createOrgWithUser({ role: 'ADMIN' });
  const m = await addUserToOrg(org._id, 'MEMBER');
  admin = await login(user.email);
  member = await login(m.email);
});

describe('suppliers & products', () => {
  it('validates required fields and email format', async () => {
    const res = await admin.post('/api/v1/suppliers', { ...supplierBody, email: 'not-an-email', name: '' }).expect(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'name']));
  });

  it('enforces unique supplier references within an organisation', async () => {
    await createSupplier(admin);
    const res = await admin.post('/api/v1/suppliers', supplierBody).expect(409);
    expect(res.body.error.message).toMatch(/supplierRef/);
  });

  it('creates, updates, deactivates and searches suppliers', async () => {
    const s = await createSupplier(admin);
    await admin.patch(`/api/v1/suppliers/${s._id}`, { contactPerson: 'Mei' }).expect(200);
    await admin.patch(`/api/v1/suppliers/${s._id}/status`, { isActive: false }).expect(200);
    const list = await admin.get('/api/v1/suppliers?status=inactive&search=acme').expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].contactPerson).toBe('Mei');
  });

  it('validates products (integer minor units, unit of measure)', async () => {
    await admin.post('/api/v1/products', { sku: 'X', name: 'X', unitOfMeasure: 'EA', defaultUnitCostMinor: 19.99, currency: 'USD' }).expect(422);
    await admin.post('/api/v1/products', { sku: 'X', name: 'X', unitOfMeasure: 'GALLON', defaultUnitCostMinor: 1999, currency: 'USD' }).expect(422);
    await createProduct(admin);
  });

  it('rejects sort fields outside the allowlist', async () => {
    await admin.get('/api/v1/suppliers?sortBy=password').expect(422);
  });
});

describe('purchase orders', () => {
  it('calculates totals on the server and ignores client totals', async () => {
    const sup = await createSupplier(admin);
    const prod = await createProduct(admin);
    const res = await member.post('/api/v1/purchase-orders', poBody(sup._id, prod._id)).expect(201);
    const po = res.body.data;
    expect(po.poNumber).toMatch(/^PO-2026-\d{5}$/);
    expect(po.lines.map((l: { lineTotalMinor: number }) => l.lineTotalMinor)).toEqual([5997, 300]);
    expect(po.subtotalMinor).toBe(6297);
    expect(po.taxMinor).toBe(630); // 629.7 → 630
    expect(po.totalMinor).toBe(6297 + 630 + 500);
    expect(po.lines[0].sku).toBe('WID-1');
    expect(po.status).toBe('DRAFT');
  });

  it('rejects inactive suppliers, empty lines and bad dates', async () => {
    const sup = await createSupplier(admin);
    await admin.patch(`/api/v1/suppliers/${sup._id}/status`, { isActive: false });
    await member.post('/api/v1/purchase-orders', poBody(sup._id)).expect(422);
    const active = await createSupplier(admin, { supplierRef: 'SUP-2' });
    await member.post('/api/v1/purchase-orders', { ...poBody(active._id), lines: [] }).expect(422);
    await member.post('/api/v1/purchase-orders', { ...poBody(active._id), expectedDeliveryDate: '2026-01-01' }).expect(422);
  });

  it('runs the full lifecycle with role checks and receiving', async () => {
    const sup = await createSupplier(admin);
    const po = (await member.post('/api/v1/purchase-orders', poBody(sup._id)).expect(201)).body.data;

    // Members cannot approve; arbitrary jumps are blocked.
    await member.post(`/api/v1/purchase-orders/${po._id}/approve`).expect(403);
    const jump = await member.post(`/api/v1/purchase-orders/${po._id}/ready-to-ship`).expect(409);
    expect(jump.body.error.code).toBe('INVALID_TRANSITION');

    // Drafts are editable; totals are recomputed.
    const edited = await member.patch(`/api/v1/purchase-orders/${po._id}`, { ...poBody(sup._id), lines: [{ description: 'Only line', quantity: 1, unitPriceMinor: 1000 }] }).expect(200);
    expect(edited.body.data.totalMinor).toBe(1000 + 100 + 500);

    await admin.post(`/api/v1/purchase-orders/${po._id}/approve`).expect(200);
    // No longer editable after approval.
    await member.patch(`/api/v1/purchase-orders/${po._id}`, poBody(sup._id)).expect(409);
    // Cannot receive before ready to ship.
    const lineId = edited.body.data.lines[0]._id;
    await member.post(`/api/v1/purchase-orders/${po._id}/receive`, { lines: [{ lineId, quantity: 1 }] }).expect(409);

    await member.post(`/api/v1/purchase-orders/${po._id}/ready-to-ship`).expect(200);
    await member.post(`/api/v1/purchase-orders/${po._id}/receive`, { lines: [{ lineId, quantity: 2 }] }).expect(422); // over-receipt
    await member.post(`/api/v1/purchase-orders/${po._id}/receive`, { lines: [{ lineId, quantity: -1 }] }).expect(422);

    const detail = (await member.get(`/api/v1/purchase-orders/${po._id}`).expect(200)).body.data;
    expect(detail.activity.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['CREATED', 'UPDATED', 'STATUS_APPROVED', 'STATUS_READY_TO_SHIP']));
  });

  it('records partial then full receipts', async () => {
    const sup = await createSupplier(admin);
    const po = (await member.post('/api/v1/purchase-orders', poBody(sup._id)).expect(201)).body.data;
    await admin.post(`/api/v1/purchase-orders/${po._id}/approve`).expect(200);
    await member.post(`/api/v1/purchase-orders/${po._id}/ready-to-ship`).expect(200);
    const [l1, l2] = po.lines;
    const partial = await member.post(`/api/v1/purchase-orders/${po._id}/receive`, { lines: [{ lineId: l1._id, quantity: 1 }] }).expect(200);
    expect(partial.body.data.status).toBe('PARTIALLY_RECEIVED');
    const full = await member.post(`/api/v1/purchase-orders/${po._id}/receive`, { lines: [{ lineId: l1._id, quantity: 2 }, { lineId: l2._id, quantity: 2.5 }] }).expect(200);
    expect(full.body.data.status).toBe('RECEIVED');
    expect(full.body.data.receipts).toHaveLength(2);
    // Once received, it cannot be cancelled.
    await admin.post(`/api/v1/purchase-orders/${po._id}/cancel`).expect(409);
  });

  it('creates a linked shipment pre-filled from the purchase order', async () => {
    const sup = await createSupplier(admin);
    const po = (await member.post('/api/v1/purchase-orders', poBody(sup._id)).expect(201)).body.data;
    const body = { spec: { shipmentType: 'BOX', packageCount: 1, actualWeightKg: 12 }, items: [{ poLineId: po.lines[0]._id, quantity: 3 }] };
    await member.post(`/api/v1/purchase-orders/${po._id}/shipments`, body).expect(409); // not yet ready to ship
    await admin.post(`/api/v1/purchase-orders/${po._id}/approve`).expect(200);
    await member.post(`/api/v1/purchase-orders/${po._id}/ready-to-ship`).expect(200);
    await member.post(`/api/v1/purchase-orders/${po._id}/shipments`, { ...body, items: [{ poLineId: po.lines[0]._id, quantity: 4 }] }).expect(422);
    // The combined spec goes through the normal shipment rules (dimensions all-or-none).
    const partialDims = await member.post(`/api/v1/purchase-orders/${po._id}/shipments`, { ...body, spec: { ...body.spec, lengthCm: 40 } }).expect(422);
    expect(partialDims.body.error.details.map((d: { path: string }) => d.path)).toContain('lengthCm');

    const shipment = (await member.post(`/api/v1/purchase-orders/${po._id}/shipments`, body).expect(201)).body.data;
    expect(shipment.purchaseOrderNumber).toBe(po.poNumber);
    expect(shipment.origin).toMatchObject({ city: 'Shenzhen', country: 'CN', name: 'Acme Components' });
    expect(shipment.destination).toMatchObject({ city: 'Newark', country: 'US' });
    expect(shipment.items[0]).toMatchObject({ description: 'Widget', quantity: 3 });
    expect(shipment.status).toBe('DRAFT');

    const detail = (await member.get(`/api/v1/purchase-orders/${po._id}`).expect(200)).body.data;
    expect(detail.shipments.map((s: { reference: string }) => s.reference)).toEqual([shipment.reference]);
    // A PO with an active shipment cannot be cancelled.
    await admin.post(`/api/v1/purchase-orders/${po._id}/cancel`).expect(409);
  });
});
