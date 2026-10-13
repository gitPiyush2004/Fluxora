/** Adds business days (Mon–Fri) to a date, preserving the time of day (UTC). */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / HOUR_MS;
}

/** Deterministic 32-bit FNV-1a hash — used for stable simulated variation, never for security. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** MurmurHash3 32-bit finalizer — spreads small input differences across all bits. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) derived from a seed string. */
export function seededUnit(seed: string): number {
  return fmix32(stableHash(seed)) / 0x1_0000_0000;
}
