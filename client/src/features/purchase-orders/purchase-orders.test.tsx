import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import type { PurchaseOrder } from '@/lib/types';
import { meFixture, renderPage, routeApi } from '@/test/utils';
import PurchaseOrderFormPage from './purchase-order-form-page';
import PurchaseOrderDetailPage from './purchase-order-detail-page';

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'del', ReturnType<typeof vi.fn>>;

const supplier = { _id: 's1', supplierRef: 'SUP-1', name: 'Acme Components', email: 'a@acme.example', country: 'CN', city: 'Shenzhen', isActive: true, createdAt: '' };

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  _id: 'p1',
  poNumber: 'PO-2026-00001',
  supplierId: supplier,
  orderDate: '2026-03-01T00:00:00.000Z',
  destination: { city: 'Newark', country: 'US' },
  currency: 'USD',
  lines: [{ _id: 'l1', description: 'Widget', quantity: 10, unitOfMeasure: 'EA', unitPriceMinor: 1250, lineTotalMinor: 12500, receivedQuantity: 0 }],
  subtotalMinor: 12500,
  taxRateBps: 0,
  taxMinor: 0,
  additionalChargesMinor: 0,
  totalMinor: 12500,
  status: 'DRAFT',
  receipts: [],
  createdAt: '',
  __v: 0,
  shipments: [],
  activity: [],
  ...over,
});

describe('purchase order form', () => {
  beforeEach(() => {
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/suppliers': () => ({ data: [supplier] }),
        '/products': () => ({ data: [] }),
      },
      post: { '/purchase-orders': (_p, body) => ({ data: { ...po(), ...(body as object), _id: 'p1' } }) },
    });
  });

  it('validates required fields before submitting', async () => {
    const user = userEvent.setup();
    renderPage(<PurchaseOrderFormPage />, { path: '/purchase-orders/new' });
    await screen.findByRole('option', { name: /Acme Components/ });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText('Select a supplier')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('submits integer minor units and shows a live total preview', async () => {
    const user = userEvent.setup();
    renderPage(<PurchaseOrderFormPage />, { path: '/purchase-orders/new' });
    await screen.findByRole('option', { name: /Acme Components/ });
    await user.selectOptions(screen.getByLabelText(/^Supplier/), 's1');
    await user.type(screen.getByLabelText(/^City/), 'Newark');
    await user.selectOptions(screen.getByLabelText(/^Country/), 'US');
    await user.type(screen.getByLabelText(/^Description/), 'Widget');
    await user.clear(screen.getByLabelText(/^Qty/));
    await user.type(screen.getByLabelText(/^Qty/), '2.5');
    await user.type(screen.getByLabelText(/^Unit price/), '19.99');
    await user.type(screen.getByLabelText(/^Tax rate/), '8.25');
    // 2.5 × 19.99 = 49.975 → 49.98 ; tax 8.25% = 4.12335 → 4.12
    expect(screen.getAllByText('$49.98').length).toBeGreaterThan(0);
    expect(screen.getByText('$54.10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    const [path, body] = mocked.post.mock.calls[0]!;
    expect(path).toBe('/purchase-orders');
    expect(body).toMatchObject({ supplierId: 's1', currency: 'USD', taxRateBps: 825, lines: [{ description: 'Widget', quantity: 2.5, unitPriceMinor: 1999 }] });
    expect(body).not.toHaveProperty('totalMinor');
  });
});

describe('purchase order approval & shipment creation', () => {
  it('lets an admin approve a draft after confirming', async () => {
    const user = userEvent.setup();
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture('ADMIN') }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/purchase-orders/p1': () => ({ data: po() }),
      },
      post: { '/purchase-orders/p1/approve': () => ({ data: po({ status: 'APPROVED' }) }) },
    });
    renderPage(<PurchaseOrderDetailPage />, { path: '/purchase-orders/p1', route: '/purchase-orders/:id' });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/commits \$125\.00 with Acme Components/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve order' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/purchase-orders/p1/approve', {}));
  });

  it('disables approval for members', async () => {
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture('MEMBER') }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/purchase-orders/p1': () => ({ data: po() }),
      },
    });
    renderPage(<PurchaseOrderDetailPage />, { path: '/purchase-orders/p1', route: '/purchase-orders/:id' });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText('Waiting for approval by an organization admin.')).toBeInTheDocument();
  });

  it('creates a shipment from a ready-to-ship order with validated quantities', async () => {
    const user = userEvent.setup();
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/purchase-orders/p1': () => ({ data: po({ status: 'READY_TO_SHIP' }) }),
      },
      post: { '/purchase-orders/p1/shipments': () => ({ data: { _id: 'sh1', reference: 'SHP-2026-000001' } }) },
    });
    renderPage(<PurchaseOrderDetailPage />, { path: '/purchase-orders/p1', route: '/purchase-orders/:id' });
    await user.click((await screen.findAllByRole('button', { name: 'Create shipment' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    const qty = within(dialog).getByLabelText('Ship quantity for Widget');
    expect(qty).toHaveValue('10'); // defaults to outstanding
    await user.clear(qty);
    await user.type(qty, '11');
    await user.click(within(dialog).getByRole('button', { name: 'Create shipment' }));
    expect(await within(dialog).findByText('Max 10')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the actual shipment weight')).toBeInTheDocument();

    await user.clear(qty);
    await user.type(qty, '4');
    await user.type(within(dialog).getByLabelText(/Actual total weight/), '25');
    await user.click(within(dialog).getByRole('button', { name: 'Create shipment' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0]![1]).toMatchObject({ items: [{ poLineId: 'l1', quantity: 4 }], spec: { actualWeightKg: 25, packageCount: 1 } });
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
  });

  it('shows an error state with retry when the order cannot be loaded', async () => {
    const user = userEvent.setup();
    let calls = 0;
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/purchase-orders/p1': () => (++calls === 1 ? new ApiError(500, 'INTERNAL_ERROR', 'Database unavailable', undefined, 'req-123') : { data: po() }),
      },
    });
    renderPage(<PurchaseOrderDetailPage />, { path: '/purchase-orders/p1', route: '/purchase-orders/:id' });
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByText('Request ID req-123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('PO-2026-00001')).length).toBeGreaterThan(0);
  });
});
