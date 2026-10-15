import { Link } from 'react-router';

/** The Fluxora "F": two swept strokes in the brand blue (same file as public/favicon.svg). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="#4166F0" aria-hidden>
      <path d="M16 44C19 30 28 13 46 9L94 8.5C96 8.5 96.6 10 95.6 11.6C91 19.5 86 28 74 29L47 29C34 29.5 22 35 16 44Z" />
      <path d="M5 91C6 74 10 56 30 42C35 39.6 40 38 46 38L75 38C77 38 77.8 39.6 76.6 41.4C72 49 66 57.5 56 58L42 58C35 58.5 32 62 30 69C27 79 20 89 5 91Z" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Fluxora home">
      <LogoMark />
      {!compact && <span className="text-[15px] font-semibold tracking-tight text-fg">Fluxora</span>}
    </Link>
  );
}
