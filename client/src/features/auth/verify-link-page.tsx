import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/providers/auth';
import { InlineNotice, Spinner } from '@/components/ui/feedback';

/** Landing page for emailed sign-in links (/auth/verify?token=…). */
export function VerifyLinkPage() {
  const { signInWithEmailLink } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const token = params.get('token');

  useEffect(() => {
    // A link works only once, and development mode runs effects twice — so only try once.
    if (!token || started.current) return;
    started.current = true;
    signInWithEmailLink(token)
      .then((me) => {
        toast.success(`Welcome, ${me.user.name.split(' ')[0]}`);
        navigate('/', { replace: true });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token, signInWithEmailLink, navigate]);

  const problem = token ? error : 'This sign-in link is incomplete. Copy the whole link from the email.';
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="w-full max-w-[400px] text-center">
        {problem ? (
          <>
            <InlineNotice tone="danger"><span role="alert">{problem}</span></InlineNotice>
            <Link to="/login" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">Back to sign in</Link>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-sm text-muted"><Spinner />Signing you in…</div>
        )}
      </div>
    </div>
  );
}
