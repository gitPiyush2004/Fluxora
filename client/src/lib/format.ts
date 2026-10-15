/** Consistent formatting for money, dates, weights and numbers (en-US locale, UTC dates). */

const EXPONENT: Record<string, number> = { JPY: 0 };
export const exponentOf = (currency: string) => EXPONENT[currency] ?? 2;

export function formatMoney(minor: number | null | undefined, currency: string | null | undefined, opts: { compact?: boolean } = {}): string {
  if (minor == null || !currency) return '—';
  const exp = exponentOf(currency);
  const value = minor / 10 ** exp;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: opts.compact ? 0 : exp,
    maximumFractionDigits: opts.compact ? 1 : exp,
  }).format(value);
}

/** Converts a major-unit input (e.g. "12.34") to integer minor units without float drift. */
export function toMinorUnits(value: string | number, currency: string): number {
  const exp = exponentOf(currency);
  const str = typeof value === 'number' ? value.toFixed(exp) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) return NaN;
  const [whole, frac = ''] = str.split('.');
  if (frac.length > exp) return NaN;
  const sign = whole!.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(parseInt(whole!, 10)) * 10 ** exp + parseInt((frac + '000').slice(0, exp) || '0', 10));
}

export function fromMinorUnits(minor: number | null | undefined, currency: string): string {
  if (minor == null) return '';
  const exp = exponentOf(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const fullDateTimeFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(value: string | Date | null | undefined, withYear = false): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : (withYear ? fullDateTimeFmt : dateTimeFmt).format(d);
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: kg < 10 ? 2 : 1 }).format(kg)} kg`;
}


/** Order quantities: thousands separators, up to 3 decimals (e.g. 6,000 or 12.5). */
export function formatQuantity(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);
}

export function formatPercent(rate: number | null | undefined, digits = 0): string {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}


/** True when the date lies more than `graceDays` in the past. */
export function isPastBy(value: string | Date | null | undefined, graceDays = 0): boolean {
  if (!value) return false;
  return new Date(value).getTime() < Date.now() - graceDays * 86_400_000;
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}
