import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { coordsFor } from '@/lib/geo';
import { useMutation } from '@/lib/mutation';
import { useAuth } from '@/providers/auth';
import { GoogleSignInButton } from '@/providers/google-button';
import { useTheme } from '@/providers/theme';
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

const BACKDROP_ROUTES: GlobeRoute[] = ILLUSTRATIVE.map(([a, ac, b, bc], i) => ({
  id: `lane-${i}`,
  label: `${a} → ${b}`,
  status: i === 4 ? 'DELAYED' : 'IN_TRANSIT',
  from: { ...coordsFor(a, ac), name: a },
  to: { ...coordsFor(b, bc), name: b },
}));

const LABEL = 'text-xs font-semibold uppercase tracking-[0.16em] text-subtle';

export function LoginPage() {
  const { me, isLoading, config, signInWithGoogle } = useAuth();
  const { resolved } = useTheme();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canRender = useMemo(() => webglAvailable(), []);
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const sendLink = useMutation({
    mutationFn: async (address: string) => (await api.post<{ sent: boolean }>('/auth/magic-link', { email: address })).data,
    onMutate: () => setError(null),
    onError: (e) => setError(errorMessage(e)),
  });

  const onGoogle = useCallback(
    async (credential: string) => {
      setError(null);
      try {
        const session = await signInWithGoogle(credential);
        toast.success(`Welcome, ${session.user.name.split(' ')[0]}`);
        navigate(target, { replace: true });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [signInWithGoogle, navigate, target],
  );
  const onGoogleError = useCallback((m: string) => setError(m), []);

  if (!isLoading && me) return <Navigate to={target} replace />;

  const google = !!config?.googleClientId;
  const byEmail = !!config?.emailSignInEnabled;
  const sentTo = sendLink.isSuccess ? sendLink.variables : null;

  return (
    <div className="relative min-h-full overflow-hidden bg-bg">
      {canRender && (
        <div className="absolute inset-0 hidden items-center justify-end lg:flex" aria-hidden>
          <div className="w-full max-w-[1000px] opacity-80 lg:mr-[-10%]">
            <Suspense fallback={null}>
              <OpsGlobe routes={BACKDROP_ROUTES} height={Math.min(window.innerHeight, 940)} interactive={false} initialView={{ lat: 22, lng: 40, altitude: 2.05 }} />
            </Suspense>
          </div>
        </div>
      )}
      {/* Fades the globe panel's left edge into the page background. */}
      <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-bg from-35% to-transparent to-55% lg:block" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col px-6 py-8 sm:px-12">
        <header className="flex items-center gap-3">
          <LogoMark size={30} />
          <span className="text-lg font-semibold tracking-tight">Fluxora</span>
        </header>

        <main className="my-auto w-full max-w-[400px] py-10">
          <div className={LABEL}>Welcome back</div>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-3 text-[15px] text-muted">
            {google && byEmail ? 'Continue with Google or get a magic link by email.' : google ? 'Continue with your Google account.' : 'Get a magic link by email.'}
          </p>
          <hr className="my-8 border-line" />

          {isLoading || !config ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : (
            <div className="space-y-6">
              {google && <GoogleSignInButton key={resolved} clientId={config.googleClientId!} onCredential={onGoogle} onError={onGoogleError} />}

              {google && byEmail && (
                <div className="flex items-center gap-4" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  <span className={LABEL}>or</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}

              {byEmail && sentTo && (
                <div className="border border-line p-5 text-sm">
                  <div className="flex items-center gap-2 font-semibold"><MailCheck className="h-4 w-4 text-success" />Check your inbox</div>
                  <p className="mt-2 text-muted">
                    We sent a sign-in link to <span className="font-medium text-fg">{sentTo}</span>. It works once and expires in 15 minutes.
                  </p>
                  {import.meta.env.DEV && <p className="mt-2 text-xs text-subtle">Running locally without an email provider? The link is printed in the API server log.</p>}
                  <button type="button" className="mt-3 text-xs font-semibold text-accent hover:underline" onClick={() => sendLink.reset()}>Use a different email</button>
                </div>
              )}

              {byEmail && !sentTo && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendLink.mutate(email.trim());
                  }}
                >
                  <label htmlFor="login-email" className={`${LABEL} block`}>Email address</label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 w-full border border-line bg-surface px-4 text-[15px] text-fg outline-none placeholder:text-subtle focus:border-accent"
                  />
                  <button
                    type="submit"
                    disabled={!email.trim() || sendLink.isPending}
                    className="h-12 w-full bg-[#f3fbb0] text-sm font-semibold uppercase tracking-[0.16em] text-neutral-800 transition-colors hover:bg-[#e9f78f] disabled:text-neutral-500 disabled:hover:bg-[#f3fbb0]"
                  >
                    {sendLink.isPending ? 'Sending…' : 'Send sign-in link'}
                  </button>
                </form>
              )}

              {!google && !byEmail && <p className="text-sm text-muted">No sign-in method is configured on this server.</p>}

              {error && <InlineNotice tone="danger"><span role="alert">{error}</span></InlineNotice>}

              <p className="text-center text-sm leading-relaxed text-subtle">
                By signing in you agree to our <Link to="/terms" className="font-semibold text-fg underline decoration-line underline-offset-4">Terms</Link> and{' '}
                <Link to="/privacy" className="font-semibold text-fg underline decoration-line underline-offset-4">Privacy Policy</Link>.
                <br />
                New here? Creating an account is automatic.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
