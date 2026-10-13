/**
 * Display-only preview of purchase-order totals while editing. Mirrors the server's
 * integer minor-unit rounding (half-up), but the server always recalculates and its
 * numbers are the ones stored.
 */
function roundHalfUp(n: number, d: number) {
  const q = Math.floor(n / d);
  return n - q * d >= d / 2 ? q + 1 : q;
}

export function previewLineTotal(unitPriceMinor: number, quantity: number): number {
  if (!Number.isFinite(unitPriceMinor) || !Number.isFinite(quantity) || quantity <= 0 || unitPriceMinor < 0) return 0;
  return roundHalfUp(unitPriceMinor * Math.round(quantity * 1000), 1000);
}

export function previewTotals(lines: { unitPriceMinor: number; quantity: number }[], taxRateBps: number, chargesMinor: number) {
  const subtotal = lines.reduce((a, l) => a + previewLineTotal(l.unitPriceMinor, l.quantity), 0);
  const tax = roundHalfUp(subtotal * (Number.isFinite(taxRateBps) ? taxRateBps : 0), 10_000);
  const charges = Number.isFinite(chargesMinor) ? chargesMinor : 0;
  return { subtotal, tax, charges, total: subtotal + tax + charges };
}
