import { describe, expect, it } from 'vitest';
import { formatMoney, fromMinorUnits, toMinorUnits } from './format';
import { previewLineTotal, previewTotals } from './po-math';

describe('money formatting', () => {
  it('converts major units to minor units without float drift', () => {
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(toMinorUnits('0.1', 'USD')).toBe(10);
    expect(toMinorUnits('1500', 'JPY')).toBe(1500);
    expect(toMinorUnits('1.5', 'JPY')).toBeNaN();
    expect(toMinorUnits('1.234', 'EUR')).toBeNaN();
    expect(toMinorUnits('abc', 'USD')).toBeNaN();
  });

  it('round-trips minor units for inputs', () => {
    expect(fromMinorUnits(123456, 'USD')).toBe('1234.56');
    expect(fromMinorUnits(1500, 'JPY')).toBe('1500');
  });

  it('formats per currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
    expect(formatMoney(null, 'USD')).toBe('—');
  });
});

describe('purchase-order total preview', () => {
  it('mirrors server rounding', () => {
    expect(previewLineTotal(1999, 2.5)).toBe(4998);
    const t = previewTotals([{ unitPriceMinor: 1999, quantity: 3 }, { unitPriceMinor: 1000, quantity: 1.5 }], 825, 2500);
    expect(t).toEqual({ subtotal: 7497, tax: 619, charges: 2500, total: 10616 });
  });
});
