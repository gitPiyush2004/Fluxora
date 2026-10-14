import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, setCsrfToken } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { AuthConfig, Me } from '@/lib/types';

interface AuthCtx {
  me: Me | null;
  isLoading: boolean;
  /** True after the user deliberately signed out (vs. a session that expired). */
  signedOut: boolean;
  config: AuthConfig | undefined;
  isAdmin: boolean;
  signInWithGoogle: (credential: string) => Promise<Me>;
  /** Signs in with the one-time token from an emailed sign-in link. */
  signInWithEmailLink: (token: string) => Promise<Me>;
  signOut: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

async function fetchMe(): Promise<Me | null> {
  try {
    const res = await api.get<Me | null>('/auth/session');
    if (res.data) setCsrfToken(res.data.csrfToken);
    return res.data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({ queryKey: keys.auth.session, queryFn: fetchMe, staleTime: 5 * 60_000, retry: 1 });
  const [signedOut, setSignedOut] = useState(false);
  const configQuery = useQuery({ queryKey: keys.auth.config, queryFn: async () => (await api.get<AuthConfig>('/auth/config')).data, staleTime: 10 * 60_000 });

  const establish = useCallback(
    (me: Me) => {
      setCsrfToken(me.csrfToken);
      setSignedOut(false);
      // Drop every cached query from a previous identity / organisation.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      qc.setQueryData(keys.auth.session, me);
      return me;
    },
    [qc],
  );

  // Set the session to null in place (never remove it: the mounted session observer would keep
  // showing the old identity), so RequireAuth redirects; then drop the previous user's data.
  const endSession = useCallback(() => {
    setCsrfToken(null);
    qc.setQueryData(keys.auth.session, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  }, [qc]);

  const signInWithGoogle = useCallback(async (credential: string) => establish((await api.post<Me>('/auth/google', { credential })).data), [establish]);
  const signInWithEmailLink = useCallback(async (token: string) => establish((await api.post<Me>('/auth/magic-link/verify', { token })).data), [establish]);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      window.google?.accounts?.id?.disableAutoSelect();
      setSignedOut(true);
      endSession();
    }
  }, [endSession]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      establish((await api.post<Me>('/auth/switch-organization', { organizationId })).data);
    },
    [establish],
  );

  // Session expired / revoked elsewhere → treat as signed out.
  useEffect(() => {
    const onUnauth = () => {
      if (qc.getQueryData(keys.auth.session)) endSession();
    };
    window.addEventListener('fluxora:unauthenticated', onUnauth);
    return () => window.removeEventListener('fluxora:unauthenticated', onUnauth);
  }, [qc, endSession]);

  const me = meQuery.data ?? null;
  const value = useMemo<AuthCtx>(
    () => ({
      me,
      isLoading: meQuery.isLoading,
      signedOut,
      config: configQuery.data,
      isAdmin: me?.role === 'ADMIN',
      signInWithGoogle,
      signInWithEmailLink,
      signOut,
      switchOrganization,
    }),
    [me, meQuery.isLoading, signedOut, configQuery.data, signInWithGoogle, signInWithEmailLink, signOut, switchOrganization],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Non-null session accessor for pages rendered behind RequireAuth. */
export function useSession(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('useSession used outside an authenticated route');
  return me;
}
