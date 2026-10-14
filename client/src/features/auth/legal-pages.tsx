import type { ReactNode } from 'react';
import { Link } from 'react-router';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-6 py-12">
      <article className="mx-auto max-w-[680px] space-y-4 text-[15px] leading-relaxed text-muted [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg">
        <Link to="/login" className="text-sm font-semibold text-accent hover:underline">← Back to sign in</Link>
        <h1 className="text-3xl font-bold tracking-tight text-fg">{title}</h1>
        <p className="text-sm text-subtle">Last updated 14 October 2026</p>
        {children}
      </article>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>Fluxora helps teams compare carriers, manage purchase orders and track shipments. By signing in you agree to these terms.</p>
      <h2>Your account</h2>
      <p>You sign in with Google or a one-time email link. Keep access to your email account secure: anyone who can read your email can sign in as you.</p>
      <h2>Carrier data</h2>
      <p>Prices and tracking marked <strong>Simulated</strong> are demonstration data, not carrier offers. Data marked <strong>Sandbox</strong> comes from a carrier's test environment. Always confirm prices and delivery dates with the carrier before relying on them.</p>
      <h2>Your data</h2>
      <p>You are responsible for the information you enter and for having the right to share it with Fluxora. Workspace admins can invite and remove members.</p>
      <h2>Availability</h2>
      <p>Fluxora is provided as is, without guarantees of availability or fitness for a particular purpose.</p>
    </LegalPage>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <h2>What we store</h2>
      <p>Your name, email address and (for Google sign-in) profile picture; the workspace data you enter — suppliers, products, purchase orders and shipments; and a history of changes for auditing.</p>
      <h2>Cookies</h2>
      <p>One session cookie that keeps you signed in. Your theme choice is saved in your browser. There are no advertising or analytics trackers.</p>
      <h2>Who receives data</h2>
      <p>Google, to verify Google sign-in. Our email provider, to deliver sign-in links. Carriers whose tracking is connected (DHL, DSV) receive the tracking numbers we look up for you. We do not sell personal data.</p>
      <h2>The shared demo workspace</h2>
      <p>Everyone who signs in can explore Shahi Exports (Demo), a workspace of fictional data. Other visitors there see your name on changes you make, but never your email. The demo is reset regularly.</p>
      <h2>How long we keep it</h2>
      <p>Account and workspace data are kept while your account exists. DHL tracking events are deleted 30 days after delivery, as DHL's terms require. Unused sign-in links expire after 15 minutes.</p>
      <h2>Your choices</h2>
      <p>Ask your workspace admin or the operator of this Fluxora deployment to export or delete your data.</p>
    </LegalPage>
  );
}
