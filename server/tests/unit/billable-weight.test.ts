import { describe, expect, it } from 'vitest';
import { calculateBillableWeight, roundUpTo } from '../../src/modules/carriers/billable-weight.js';

describe('billable weight', () => {
  it('uses volumetric weight when it exceeds actual weight', () => {
    // 50×40×40 / 5000 = 16 kg per package × 2 = 32 kg > 30 kg actual
    const r = calculateBillableWeight({ actualWeightKg: 30, packageCount: 2, lengthCm: 50, widthCm: 40, heightCm: 40, divisor: 5000 });
    expect(r.volumetricWeightKg).toBe(32);
    expect(r.billableWeightKg).toBe(32);
    expect(r.basis).toBe('VOLUMETRIC');
  });

  it('uses actual weight for dense cargo', () => {
    const r = calculateBillableWeight({ actualWeightKg: 50, packageCount: 1, lengthCm: 30, widthCm: 30, heightCm: 30, divisor: 5000 });
    expect(r.volumetricWeightKg).toBe(5.4);
    expect(r.billableWeightKg).toBe(50);
    expect(r.basis).toBe('ACTUAL');
  });

  it('respects the configured divisor', () => {
    const a = calculateBillableWeight({ actualWeightKg: 1, packageCount: 1, lengthCm: 60, widthCm: 50, heightCm: 40, divisor: 5000 });
    const b = calculateBillableWeight({ actualWeightKg: 1, packageCount: 1, lengthCm: 60, widthCm: 50, heightCm: 40, divisor: 6000 });
    expect(a.volumetricWeightKg).toBe(24);
    expect(b.volumetricWeightKg).toBe(20);
  });

  it('rounds up to the increment', () => {
    expect(calculateBillableWeight({ actualWeightKg: 10.1, packageCount: 1, divisor: 5000 }).billableWeightKg).toBe(10.5);
    expect(calculateBillableWeight({ actualWeightKg: 10.1, packageCount: 1, divisor: 5000, roundingIncrementKg: 1 }).billableWeightKg).toBe(11);
    expect(roundUpTo(10, 0.5)).toBe(10); // no spurious extra step for exact values
  });

  it('ignores partial dimensions and validates input', () => {
    expect(calculateBillableWeight({ actualWeightKg: 5, packageCount: 1, lengthCm: 50, divisor: 5000 }).volumetricWeightKg).toBeNull();
    expect(() => calculateBillableWeight({ actualWeightKg: 0, packageCount: 1, divisor: 5000 })).toThrow();
    expect(() => calculateBillableWeight({ actualWeightKg: 1, packageCount: 0, divisor: 5000 })).toThrow();
  });
});
