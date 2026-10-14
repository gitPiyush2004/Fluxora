import { fireEvent, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { meFixture, renderPage, routeApi } from '@/test/utils';
import { useAuth } from './auth';

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'del', ReturnType<typeof vi.fn>>;

function ProtectedPage() {
  const { me, signOut } = useAuth();
  const data = useQuery({ queryKey: ['shipments'], queryFn: () => api.get('/shipments') });
  return (
    <div>
      <p>Signed in as {me?.user.name}</p>
      {data.isError && <p>Load failed</p>}
      <button onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

describe('sign-out', () => {
  let signedIn: boolean;
  beforeEach(() => {
    signedIn = true;
    routeApi(mocked, {
      get: {
        '/auth/session': () => ({ data: signedIn ? meFixture() : null }),
        '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }),
        '/shipments': () => (signedIn ? { data: [] } : new ApiError(401, 'UNAUTHENTICATED', 'Authentication required')),
      },
      post: {
        '/auth/logout': () => {
          signedIn = false;
          return {};
        },
      },
    });
  });

  it('leaves protected pages immediately, even while their queries are mounted', async () => {
    renderPage(<ProtectedPage />);
    expect(await screen.findByText('Signed in as Alex Morgan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    // The session gate (mirrors RequireAuth) takes over; the old identity is gone.
    expect(await screen.findByText('Loading session…')).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });
});
