import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { meFixture, renderPage, routeApi } from '@/test/utils';
import { TrackShipmentDialog } from './track-shipment-dialog';

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'del', ReturnType<typeof vi.fn>>;

describe('track a shipment', () => {
  beforeEach(() => {
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: meFixture() }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: false } }),
        '/quotes/carriers': () => ({ data: [{ code: 'DSV', name: 'DSV', tracking: 'SANDBOX' }] }),
      },
      post: { '/shipments/track': () => ({ data: { _id: 's1', reference: 'SHP-2026-000001' } }) },
    });
  });

  it('says what tracking the carrier gets, validates, and opens the new shipment', async () => {
    renderPage(<TrackShipmentDialog open onClose={() => undefined} />, { path: '/shipments', route: '/shipments' });
    expect(await screen.findByText('This carrier gets test-environment tracking.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(await screen.findByText('Enter the tracking number from the carrier')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Tracking number/), { target: { value: '40257145990010760574' } });
    fireEvent.change(screen.getByLabelText(/From city/), { target: { value: 'New York' } });
    fireEvent.change(screen.getByLabelText(/From country/), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText(/To city/), { target: { value: 'Copenhagen' } });
    fireEvent.change(screen.getByLabelText(/To country/), { target: { value: 'DK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start tracking' }));

    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledWith('/shipments/track', expect.objectContaining({
      carrierCode: 'DSV', trackingNumber: '40257145990010760574', origin: { city: 'New York', country: 'US' }, destination: { city: 'Copenhagen', country: 'DK' },
    }));
  });
});
