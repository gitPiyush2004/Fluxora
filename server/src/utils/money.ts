/**
 * Monetary helpers. All amounts are stored and calculated as integer *minor units*
 * (e.g. cents). Floating-point arithmetic is never used for totals.
 *
 * Quantities may carry up to 3 decimal places (e.g. 2.5 kg, 0.125 m). They are
 * converted to integer thousandths ("milli-units") before multiplication.
 */

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CNY', 'JPY', 'AED', 'SGD', 'AUD', 'CAD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** ISO 4217 minor-unit exponent. JPY has no minor unit. */
export const CURRENCY_EXPONENT: Record<Currency, number> = {
  USD: 2, EUR: 2, GBP: 2, INR: 2, CNY: 2, JPY: 0, AED: 2, SGD: 2, AUD: 2, CAD: 2,
};

export const QUANTITY_SCALE = 1000;

function assertSafeInteger(n: number, label: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer, received ${n}`);
}

/** Round-half-away-from-zero integer division for non-negative or negative numerators. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');
  if (denominator === 0) throw new RangeError('Division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

/** Converts a decimal quantity (max 3 dp) to integer thousandths, rejecting extra precision. */
export function toMilli(quantity: number): number {
  if (!Number.isFinite(quantity)) throw new RangeError('Quantity must be finite');
  const milli = Math.round(quantity * QUANTITY_SCALE);
  if (Math.abs(milli - quantity * QUANTITY_SCALE) > 1e-6) {
    throw new RangeError('Quantity supports at most 3 decimal places');
  }
  return milli;
}

export function fromMilli(milli: number): number {
  return milli / QUANTITY_SCALE;
}

/** Line total in minor units = unitPriceMinor × quantity, rounded half-up to the minor unit. */
export function lineTotalMinor(unitPriceMinor: number, quantity: number): number {
  assertSafeInteger(unitPriceMinor, 'unitPriceMinor');
  const product = unitPriceMinor * toMilli(quantity);
  assertSafeInteger(product, 'line total intermediate');
  return divRoundHalfUp(product, QUANTITY_SCALE);
}

/** Tax on an amount given a rate in basis points (1% = 100 bps), rounded half-up. */
export function percentOfMinor(amountMinor: number, rateBps: number): number {
  assertSafeInteger(amountMinor, 'amountMinor');
  assertSafeInteger(rateBps, 'rateBps');
  return divRoundHalfUp(amountMinor * rateBps, 10_000);
}

export function sumMinor(values: number[]): number {
  return values.reduce((acc, v) => {
    assertSafeInteger(v, 'amount');
    const next = acc + v;
    assertSafeInteger(next, 'sum');
    return next;
  }, 0);
}

/** Converts a decimal major-unit amount (e.g. 12.34) to minor units, validating precision. */
export function toMinor(amount: number, currency: Currency): number {
  const exp = CURRENCY_EXPONENT[currency];
  const scale = 10 ** exp;
  const minor = Math.round(amount * scale);
  if (Math.abs(minor - amount * scale) > 1e-6) {
    throw new RangeError(`${currency} supports at most ${exp} decimal places`);
  }
  return minor;
}

export interface PurchaseOrderTotalsInput {
  lines: { quantity: number; unitPriceMinor: number }[];
  taxRateBps: number;
  additionalChargesMinor: number;
}

export interface PurchaseOrderTotals {
  lineTotalsMinor: number[];
  subtotalMinor: number;
  taxMinor: number;
  additionalChargesMinor: number;
  totalMinor: number;
}

/** Authoritative purchase-order total calculation. Client-provided totals are ignored. */
export function calculatePurchaseOrderTotals(input: PurchaseOrderTotalsInput): PurchaseOrderTotals {
  const lineTotalsMinor = input.lines.map((l) => lineTotalMinor(l.unitPriceMinor, l.quantity));
  const subtotalMinor = sumMinor(lineTotalsMinor);
  const taxMinor = percentOfMinor(subtotalMinor, input.taxRateBps);
  const totalMinor = sumMinor([subtotalMinor, taxMinor, input.additionalChargesMinor]);
  return { lineTotalsMinor, subtotalMinor, taxMinor, additionalChargesMinor: input.additionalChargesMinor, totalMinor };
}
