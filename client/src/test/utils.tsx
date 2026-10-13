import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import type { Me } from '@/lib/types';
import { AuthProvider, useAuth } from '@/providers/auth';
import { ThemeProvider } from '@/providers/theme';

export const meFixture = (role: 'ADMIN' | 'MEMBER' = 'ADMIN'): Me => ({
  user: { id: 'u1', email: 'alex@fluxora.test', name: 'Alex Morgan', avatarUrl: null, isDemoUser: true },
  organization: {
    id: 'o1',
    name: 'Test Org',
    slug: 'test-org',
    isDemo: false,
    settings: {
      defaultCurrency: 'USD',
      volumetricDivisor: 5000,
      recommendationWeights: { cost: 50, transit: 30, reliability: 20 },
      reliabilityMinSamples: 5,
      exceptionRules: { stuckThresholdsHours: { BOOKED: 72 }, trackingStaleHours: 36, overdueGraceHours: 0 },
    },
  },
  role,
  organizations: [{ id: 'o1', name: 'Test Org', role }],
  csrfToken: 'csrf',
});

type Handler = (path: string, body?: unknown) => unknown;

/**
 * Wires the mocked `api` object (see vi.mock in each test) to route handlers. A handler
 * returning an Error instance makes the call reject with it.
 */
export function routeApi(api: Record<'get' | 'post' | 'patch' | 'del', ReturnType<typeof vi.fn>>, routes: { get?: Record<string, Handler>; post?: Record<string, Handler>; patch?: Record<string, Handler> }) {
  const dispatch = (table: Record<string, Handler> | undefined) => async (path: string, arg?: unknown) => {
    const key = Object.keys(table ?? {}).find((k) => (k.endsWith('*') ? path.startsWith(k.slice(0, -1)) : k === path));
    if (!key) throw new Error(`Unmocked API call: ${path}`);
    const result = await table![key]!(path, arg);
    if (result instanceof Error) throw result;
    return result as object;
  };
  api.get.mockImplementation(dispatch(routes.get));
  api.post.mockImplementation(dispatch(routes.post));
  api.patch.mockImplementation(dispatch(routes.patch));
}

/** Mirrors RequireAuth: pages only render once the session is known. */
function SessionGate({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return me ? <>{children}</> : <div>Loading session…</div>;
}

export function renderPage(element: ReactElement, { path = '/', route = '*' }: { path?: string; route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={route} element={<SessionGate>{element}</SessionGate>} />
              <Route path="*" element={<div data-testid="navigated" />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
