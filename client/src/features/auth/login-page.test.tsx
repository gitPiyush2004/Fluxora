import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { routeApi } from '@/test/utils';
import { AuthProvider } from '@/providers/auth';
import { ThemeProvider } from '@/providers/theme';
import { LoginPage } from './login-page';

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'del', ReturnType<typeof vi.fn>>;

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('sign-in page', () => {
  beforeEach(() => {
    routeApi(mocked, {
      get: { '/auth/session': () => ({ data: null }), '/auth/config': () => ({ data: { googleClientId: null, emailSignInEnabled: true } }) },
      post: { '/auth/magic-link': () => ({ data: { sent: true } }) },
    });
  });

  it('switches between signing in and signing up', async () => {
    renderLogin();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('link', { name: 'Sign up' }));
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('confirms when a sign-in link was sent', async () => {
    renderLogin();
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledWith('/auth/magic-link', { email: 'me@example.com' });
  });
});
