import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import type { ShipmentEvent } from '@/lib/types';
import { meFixture, renderPage, routeApi } from '@/test/utils';
import ShipmentsPage from '../shipments/shipments-page';
import { Timeline } from './timeline';

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'del', ReturnType<typeof vi.fn>>;

const ev = (over: Partial<ShipmentEvent>): ShipmentEvent => ({
  _id: Math.random().toString(36),
  shipmentId: 's1',
  type: 'TRACKING',
  occurredAt: '2026-03-03T10:00:00Z',
  recordedAt: '2026-03-03T10:00:00Z',
  description: 'Arrived at sort hub',
  source: { type: 'SIMULATED', provider: 'fluxora-simulator', isSimulated: true },
  ...over,
});

describe('tracking timeline', () => {
  it('shows status changes, locations and the provenance of each event', () => {
    render(
      <MemoryRouter>
        <Timeline
          events={[
            ev({ type: 'STATUS_CHANGE', description: 'Held for customs inspection', newStatus: 'EXCEPTION', isException: true, location: { city: 'Newark', country: 'US' } }),
            ev({ description: 'Departed hub', source: { type: 'CARRIER_API', provider: 'dhl-unified-tracking', isSimulated: false } }),
            ev({ type: 'NOTE', description: 'Called carrier', source: { type: 'USER', isSimulated: false }, actorName: 'Sam' }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Held for customs inspection')).toBeInTheDocument();
    expect(screen.getByText('Exception')).toBeInTheDocument();
    expect(screen.getByText('Newark, US')).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(screen.getByText('Carrier API')).toBeInTheDocument();
    expect(screen.getByText('Entered by user')).toBeInTheDocument();
    expect(screen.getByText('by Sam')).toBeInTheDocument();
  });
});

describe('shipment list states', () => {
  beforeEach(() => {
    mocked.get.mockReset();
  });

  it('renders an empty state', async () => {
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/shipments': () => ({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
      },
    });
    renderPage(<ShipmentsPage />, { path: '/shipments' });
    expect(await screen.findByText('No shipments yet')).toBeInTheDocument();
  });

  it('renders API errors with the server message', async () => {
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/shipments': () => new ApiError(503, 'SERVICE_UNAVAILABLE', 'Fluxora API is temporarily unavailable'),
      },
    });
    renderPage(<ShipmentsPage />, { path: '/shipments' });
    expect(await screen.findByText('Fluxora API is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('lists shipments with status and simulated markers', async () => {
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/shipments': () => ({
          data: [{ _id: 's1', reference: 'SHP-2026-000001', origin: { city: 'Shenzhen', country: 'CN' }, destination: { city: 'Newark', country: 'US' }, status: 'IN_TRANSIT', carrierName: 'DHL', serviceName: 'Express (simulated)', quoteIsSimulated: true, currency: 'USD', freightCostMinor: 15000, createdAt: '2026-03-01T00:00:00Z', trackingMode: 'SIMULATED' }],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      },
    });
    renderPage(<ShipmentsPage />, { path: '/shipments' });
    expect(await screen.findByText('SHP-2026-000001')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('In transit')).toBeInTheDocument();
    expect(within(table).getByLabelText('Simulated offer')).toBeInTheDocument();
    expect(within(table).getByText('$150.00')).toBeInTheDocument();
  });
});
