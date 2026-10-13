/**
 * Volumetric & billable weight.
 *
 *   volumetric (kg) = L × W × H (cm) ÷ divisor × packageCount
 *   billable   (kg) = max(actual total weight, volumetric), rounded UP to the increment
 *
 * Divisors differ by carrier and mode (5000 is common for express parcels, 6000 for
 * some international services, ~3000 for road groupage). Real adapters use the
 * billable weight the carrier returns; the values here are documented estimates.
 */
export interface BillableWeightInput {
  actualWeightKg: number;
  packageCount: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  divisor: number;
  /** Round the billable weight up to this increment (kg). 0.5 is typical for parcels. */
  roundingIncrementKg?: number;
}

export interface BillableWeightResult {
  actualWeightKg: number;
  volumetricWeightKg: number | null;
  billableWeightKg: number;
  basis: 'ACTUAL' | 'VOLUMETRIC';
  divisor: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function roundUpTo(value: number, increment: number): number {
  if (increment <= 0) return round2(value);
  // Work in hundredths to avoid FP artefacts like 10.000000001 rounding up an extra step.
  const v = Math.round(value * 100);
  const inc = Math.round(increment * 100);
  return Math.ceil(v / inc) * inc / 100;
}

export function calculateBillableWeight(input: BillableWeightInput): BillableWeightResult {
  const { actualWeightKg, packageCount, lengthCm, widthCm, heightCm, divisor } = input;
  if (!(actualWeightKg > 0)) throw new RangeError('Actual weight must be greater than zero');
  if (!Number.isInteger(packageCount) || packageCount < 1) throw new RangeError('Package count must be a positive integer');
  if (!(divisor > 0)) throw new RangeError('Volumetric divisor must be positive');

  const hasDims = [lengthCm, widthCm, heightCm].every((d) => typeof d === 'number' && d > 0);
  const volumetricWeightKg = hasDims ? round2(((lengthCm! * widthCm! * heightCm!) / divisor) * packageCount) : null;

  const raw = volumetricWeightKg !== null && volumetricWeightKg > actualWeightKg ? volumetricWeightKg : actualWeightKg;
  const basis = volumetricWeightKg !== null && volumetricWeightKg > actualWeightKg ? 'VOLUMETRIC' : 'ACTUAL';
  return {
    actualWeightKg: round2(actualWeightKg),
    volumetricWeightKg,
    billableWeightKg: roundUpTo(raw, input.roundingIncrementKg ?? 0.5),
    basis,
    divisor,
  };
}
