import { Link } from 'react-router';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-[var(--surface-3)]" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      <path d="M7 16h18M16 7c3 3 3 15 0 18M16 7c-3 3-3 15 0 18" fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity=".65" />
      <circle cx="22.2" cy="10.8" r="2.2" fill="var(--arc-b)" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Fluxora home">
      <LogoMark />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight text-fg">Fluxora</span>
          <span className="hud-label mt-0.5 block text-[9px]">Logistics intelligence</span>
        </span>
      )}
    </Link>
  );
}
