import { describe, expect, it } from 'vitest';
import {
  calculatePurchaseOrderTotals,
  divRoundHalfUp,
  lineTotalMinor,
  percentOfMinor,
  sumMinor,
  toMilli,
  toMinor,
} from '../../src/utils/money.js';

describe('money — integer minor-unit arithmetic', () => {
  it('computes line totals without floating point drift', () => {
    // 0.1 + 0.2 style traps: 3 × $19.99 must be exactly $59.97
    expect(lineTotalMinor(1999, 3)).toBe(5997);
    // fractional quantities (kg / m) round half-up to the cent
    expect(lineTotalMinor(1999, 2.5)).toBe(4998); // 49.975 → 49.98
    expect(lineTotalMinor(333, 0.333)).toBe(111); // 110.889 → 111
    expect(lineTotalMinor(1, 0.5)).toBe(1); // half rounds up
  });

  it('rejects quantities with more than 3 decimals', () => {
    expect(() => toMilli(1.2345)).toThrow(/3 decimal places/);
    expect(toMilli(1.234)).toBe(1234);
  });

  it('rounds half away from zero', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
  });

  it('calculates tax in basis points', () => {
    expect(percentOfMinor(10_000, 2100)).toBe(2100); // 21% of 100.00
    expect(percentOfMinor(999, 2100)).toBe(210); // 209.79 → 210
  });

  it('computes purchase-order totals authoritatively', () => {
    const totals = calculatePurchaseOrderTotals({
      lines: [
        { quantity: 3, unitPriceMinor: 1999 },
        { quantity: 1.5, unitPriceMinor: 1000 },
      ],
      taxRateBps: 825,
      additionalChargesMinor: 2500,
    });
    expect(totals.lineTotalsMinor).toEqual([5997, 1500]);
    expect(totals.subtotalMinor).toBe(7497);
    expect(totals.taxMinor).toBe(619); // 618.5025 → 619 (half-up)
    expect(totals.totalMinor).toBe(7497 + 619 + 2500);
  });

  it('guards against unsafe integers', () => {
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => lineTotalMinor(1.5, 1)).toThrow(RangeError);
  });

  it('converts major units respecting currency exponents', () => {
    expect(toMinor(12.34, 'USD')).toBe(1234);
    expect(toMinor(1500, 'JPY')).toBe(1500);
    expect(() => toMinor(1.5, 'JPY')).toThrow();
    expect(() => toMinor(1.234, 'EUR')).toThrow();
  });
});
