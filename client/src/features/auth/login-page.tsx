import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { FlaskConical, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { coordsFor } from '@/lib/geo';
import { useAuth } from '@/providers/auth';
import { GoogleSignInButton } from '@/providers/google-button';
import { useTheme } from '@/providers/theme';
import { Button } from '@/components/ui/button';
import { InlineNotice, Spinner } from '@/components/ui/feedback';
import { LogoMark } from '@/components/layout/logo';
import { webglAvailable, type GlobeRoute } from '@/components/globe/globe-utils';

const OpsGlobe = lazy(() => import('@/components/globe/ops-globe'));

// Purely decorative lanes for the sign-in backdrop (no customer data before sign-in).
const ILLUSTRATIVE: [string, string, string, string][] = [
  ['Shenzhen', 'CN', 'Los Angeles', 'US'], ['Shanghai', 'CN', 'Rotterdam', 'NL'], ['Singapore', 'SG', 'Hamburg', 'DE'],
  ['Mumbai', 'IN', 'London', 'GB'], ['Ho Chi Minh City', 'VN', 'New York', 'US'], ['Dubai', 'AE', 'Lagos', 'NG'],
  ['São Paulo', 'BR', 'Madrid', 'ES'], ['Tokyo', 'JP', 'Seattle', 'US'], ['Sydney', 'AU', 'Singapore', 'SG'],
  ['Monterrey', 'MX', 'Chicago', 'US'], ['Porto', 'PT', 'Venlo', 'NL'], ['Busan', 'KR', 'Vancouver', 'CA'],
];

const BACKDROP_ROUTES: GlobeRoute[] = backdropRoutes();

function backdropRoutes(): GlobeRoute[] {
  return ILLUSTRATIVE.map(([a, ac, b, bc], i) => ({
    id: `demo-${i}`,
    label: `${a} → ${b}`,
    status: i === 4 ? 'DELAYED' : 'IN_TRANSIT',
    from: { ...coordsFor(a, ac), name: a },
    to: { ...coordsFor(b, bc), name: b },
  }));
}

export function LoginPage() {
  const { me, isLoading, config, signInWithGoogle, signInDemo } = useAuth();
  const { resolved } = useTheme();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRender = useMemo(() => webglAvailable(), []);
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const onGoogle = useCallback(
    async (credential: string) => {
      setBusy('google');
      setError(null);
      try {
        const session = await signInWithGoogle(credential);
        toast.success(`Welcome, ${session.user.name.split(' ')[0]}`);
        navigate(target, { replace: true });
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [signInWithGoogle, navigate, target],
  );
  const onGoogleError = useCallback((m: string) => setError(m), []);

  if (!isLoading && me) return <Navigate to={target} replace />;

  return (
    <div className="relative min-h-full overflow-hidden bg-bg">
      <div className="bg-grid absolute inset-0" aria-hidden />
      {canRender && (
        <div className="absolute inset-0 flex items-center justify-center lg:justify-end" aria-hidden>
          <div className="w-full max-w-[1100px] opacity-90 lg:mr-[-8%]">
            <Suspense fallback={null}>
              <OpsGlobe routes={BACKDROP_ROUTES} height={Math.min(window.innerHeight, 980)} interactive={false} initialView={{ lat: 22, lng: 40, altitude: 2.05 }} />
            </Suspense>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-transparent" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col justify-between px-6 py-8 sm:px-12">
        <header className="flex items-center gap-3">
          <LogoMark size={32} />
          <div>
            <div className="text-lg font-semibold tracking-tight">Fluxora</div>
            <div className="hud-label">Smart logistics & shipment intelligence</div>
          </div>
        </header>

        <main className="my-10 w-full max-w-[420px]">
          <div className="hud-label mb-3 text-accent">// Secure access</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Every lane, carrier and order — <span className="text-accent">in one ops view.</span>
          </h1>
          <p className="mt-3 text-sm text-muted">
            Compare carrier offers with explainable scoring, book and track shipments, catch exceptions early and connect purchase orders to freight spend.
          </p>

          <div className="hud-frame mt-8 rounded-xl border border-line bg-surface/90 p-5 shadow-float backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <span className="hud-label">Sign in</span>
              <span className="flex items-center gap-1 font-mono text-[10.5px] text-subtle">
                <ShieldCheck className="h-3.5 w-3.5 text-success" /> Verified server-side
              </span>
            </div>

            {isLoading || !config ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : (
              <div className="space-y-4">
                {config.googleClientId ? (
                  <div className={busy === 'google' ? 'pointer-events-none opacity-60' : undefined}>
                    <GoogleSignInButton key={resolved} clientId={config.googleClientId} onCredential={onGoogle} onError={onGoogleError} />
                  </div>
                ) : (
                  <InlineNotice tone="warning" icon={<KeyRound className="h-4 w-4 text-warning" />}>
                    Google sign-in is not configured on this server. Set <code className="font-mono">GOOGLE_CLIENT_ID</code> (see README → Google authentication).
                  </InlineNotice>
                )}

                {error && (
                  <InlineNotice tone="danger">
                    <span role="alert">{error}</span>
                  </InlineNotice>
                )}

                {config.devLoginEnabled && config.demoUsers.length > 0 && (
                  <div className="border-t border-line pt-4">
                    <div className="mb-2 flex items-center gap-2">
                      <FlaskConical className="h-3.5 w-3.5 text-sim" />
                      <span className="hud-label text-sim">Development only · demo accounts</span>
                    </div>
                    <div className="grid gap-2">
                      {config.demoUsers.map((u) => (
                        <Button
                          key={u.email}
                          variant="outline"
                          className="h-auto w-full py-2"
                          loading={busy === u.email}
                          disabled={!!busy}
                          onClick={async () => {
                            setBusy(u.email);
                            setError(null);
                            try {
                              await signInDemo(u.email);
                              navigate(target, { replace: true });
                            } catch (e) {
                              setError(errorMessage(e));
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-[13px] font-medium">{u.name}</span>
                            <span className="block truncate font-mono text-[11px] text-subtle">{u.email}</span>
                          </span>
                          <span className="hud-label">{u.role}</span>
                        </Button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11.5px] text-subtle">Seeded demo users with fictional data. Disabled automatically in production.</p>
                  </div>
                )}

                {!config.googleClientId && !config.devLoginEnabled && (
                  <p className="text-sm text-muted">No sign-in method is enabled. Contact your administrator.</p>
                )}
              </div>
            )}
          </div>
        </main>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-subtle">
          <span>HTTPONLY SESSION · CSRF PROTECTED · TENANT ISOLATED</span>
          <span>BACKDROP LANES ARE ILLUSTRATIVE</span>
        </footer>
      </div>
    </div>
  );
}
