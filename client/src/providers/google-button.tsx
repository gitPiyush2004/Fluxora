import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTheme } from './theme';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load Google Identity Services'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Renders the official Google Sign-In button. The resulting ID token (JWT) is sent to the
 * backend, which verifies its signature, issuer, audience and expiry — the browser is
 * never trusted to assert identity on its own.
 */
export function GoogleSignInButton({ clientId, onCredential, onError }: { clientId: string; onCredential: (credential: string) => void; onError: (message: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const [ready, setReady] = useState(false);
  const handleCredential = useEffectEvent((credential: string) => onCredential(credential));
  const handleError = useEffectEvent((message: string) => onError(message));

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (res) => handleCredential(res.credential),
          ux_mode: 'popup',
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        ref.current.innerHTML = '';
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: resolved === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: Math.min(400, ref.current.parentElement?.clientWidth ?? 320),
        });
        setReady(true);
      })
      .catch((e: Error) => handleError(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, resolved]);

  return (
    // Light color-scheme keeps Google's cross-origin iframe transparent on dark pages (no white box).
    <div className="flex min-h-[44px] w-full justify-center [color-scheme:light]">
      <div ref={ref} aria-label="Sign in with Google" />
      {!ready && <div className="skeleton h-11 w-full max-w-[400px]" aria-hidden />}
    </div>
  );
}
