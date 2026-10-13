import type { NormalizedQuote, ShipmentRequest } from '../../integrations/carriers/types.js';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

const SPECIAL_LABEL: Record<string, string> = {
  DANGEROUS_GOODS: 'dangerous goods',
  TEMPERATURE_CONTROLLED: 'temperature-controlled cargo',
  FRAGILE: 'fragile handling',
  OVERSIZED: 'oversized cargo',
  LIFTGATE: 'liftgate delivery',
};

function endOfUtcDay(d: Date): number {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x.getTime();
}

/**
 * Hard-constraint filter applied before any scoring. A quote that fails any check is
 * excluded from recommendations (but still shown, with reasons, for transparency).
 */
export function checkEligibility(quote: NormalizedQuote, request: ShipmentRequest, now: Date = new Date()): EligibilityResult {
  const reasons: string[] = [];
  const c = quote.constraints ?? {};

  if (request.servicePreference && quote.serviceLevel !== request.servicePreference) {
    reasons.push(`${quote.serviceLevel.toLowerCase()} service does not match the requested ${request.servicePreference.toLowerCase()} level`);
  }
  if (c.shipmentTypes && !c.shipmentTypes.includes(request.shipmentType)) {
    reasons.push(`Service does not accept ${request.shipmentType.toLowerCase()} shipments`);
  }
  const perPackageKg = request.actualWeightKg / request.packageCount;
  if (c.maxWeightPerPackageKg !== undefined && perPackageKg > c.maxWeightPerPackageKg) {
    reasons.push(`Package weight ${perPackageKg.toFixed(1)} kg exceeds the ${c.maxWeightPerPackageKg} kg per-package limit`);
  }
  if (c.maxTotalWeightKg !== undefined && request.actualWeightKg > c.maxTotalWeightKg) {
    reasons.push(`Total weight exceeds the ${c.maxTotalWeightKg} kg service limit`);
  }
  const longest = Math.max(request.lengthCm ?? 0, request.widthCm ?? 0, request.heightCm ?? 0);
  if (c.maxLengthCm !== undefined && longest > c.maxLengthCm) {
    reasons.push(`Longest side ${longest} cm exceeds the ${c.maxLengthCm} cm limit`);
  }
  if (c.specialHandling) {
    for (const s of request.specialHandling) {
      if (!c.specialHandling.includes(s)) reasons.push(`Service does not support ${SPECIAL_LABEL[s] ?? s}`);
    }
  }
  if (request.requiredDeliveryDate) {
    if (!quote.estimatedDeliveryDate) {
      reasons.push('No delivery estimate available to verify the required delivery date');
    } else if (new Date(quote.estimatedDeliveryDate).getTime() > endOfUtcDay(request.requiredDeliveryDate)) {
      reasons.push(`Estimated delivery ${quote.estimatedDeliveryDate.slice(0, 10)} misses the required date ${request.requiredDeliveryDate.toISOString().slice(0, 10)}`);
    }
  }
  if (request.maxBudgetMinor !== undefined) {
    if (quote.currency !== request.currency) {
      reasons.push(`Quoted in ${quote.currency}; budget is in ${request.currency} and no conversion is configured`);
    } else if (quote.totalMinor > request.maxBudgetMinor) {
      reasons.push('Price exceeds the maximum budget');
    }
  }
  if (quote.provenance.validUntil && new Date(quote.provenance.validUntil).getTime() < now.getTime()) {
    reasons.push('Quote has expired');
  }
  return { eligible: reasons.length === 0, reasons };
}
