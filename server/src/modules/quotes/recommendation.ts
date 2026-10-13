import { CURRENCY_EXPONENT, type Currency } from '../../utils/money.js';

/**
 * Carrier recommendation engine (pure & deterministic).
 *
 * 1. Hard constraints are applied BEFORE this module (see carriers/eligibility.ts);
 *    only eligible quotes are ranked.
 * 2. Quotes are grouped by currency — prices in different currencies are never compared.
 * 3. Each metric is normalised to [0, 1] where 1 is always better:
 *      cost    = (maxPrice − price) / (maxPrice − minPrice)       (1 if all equal)
 *      transit = (maxDays − days)   / (maxDays − minDays)         (1 if all equal)
 *      reliability = carrier on-time rate from the organisation's own delivered shipments
 * 4. Missing-metric policy: a metric is included only if it is available for EVERY
 *    quote in the group. Otherwise it is excluded for the whole group and the remaining
 *    weights are renormalised — a missing value is never treated as perfect (or as zero).
 * 5. Score = 100 × Σ (weight_i / Σ included weights) × metric_i, rounded to 0.1.
 * 6. Ties are broken by price, then transit days, then carrier code, service name and id.
 */

export interface Weights {
  cost: number;
  transit: number;
  reliability: number;
}

export interface Reliability {
  onTimeRate: number | null;
  sampleSize: number;
  minSamples: number;
}

export interface RankableQuote {
  id: string;
  carrierCode: string;
  carrierName: string;
  serviceName: string;
  currency: Currency;
  totalMinor: number;
  transitDays: number | null;
  reliability: Reliability;
}

export type Metric = 'cost' | 'transit' | 'reliability';
const METRICS: Metric[] = ['cost', 'transit', 'reliability'];
export type Badge = 'CHEAPEST' | 'FASTEST' | 'BEST_BALANCED';
export type RecommendationMode = 'CHEAPEST' | 'FASTEST' | 'BALANCED';

export interface RankedQuote {
  id: string;
  score: number;
  components: Record<Metric, number | null>;
  contributions: Record<Metric, number | null>;
  badges: Badge[];
  explanation: string[];
  tradeoffs: string[];
}

export interface CurrencyGroupResult {
  currency: Currency;
  appliedWeights: Record<Metric, number>;
  excludedMetrics: { metric: Metric; reason: string }[];
  quotes: RankedQuote[];
  order: Record<RecommendationMode, string[]>;
  cheapestId: string | null;
  fastestId: string | null;
  bestBalancedId: string | null;
}

export interface RecommendationResult {
  weights: Weights;
  groups: CurrencyGroupResult[];
  notes: string[];
}

export const DEFAULT_WEIGHTS: Weights = { cost: 50, transit: 30, reliability: 20 };

const round1 = (n: number) => Math.round(n * 10) / 10;

export function formatMinor(amountMinor: number, currency: Currency): string {
  const exp = CURRENCY_EXPONENT[currency];
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(
    amountMinor / 10 ** exp,
  );
}

function minMaxScore(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return (max - value) / (max - min);
}

function tieBreak(a: RankableQuote, b: RankableQuote): number {
  return (
    a.totalMinor - b.totalMinor ||
    (a.transitDays ?? Number.POSITIVE_INFINITY) - (b.transitDays ?? Number.POSITIVE_INFINITY) ||
    a.carrierCode.localeCompare(b.carrierCode) ||
    a.serviceName.localeCompare(b.serviceName) ||
    a.id.localeCompare(b.id)
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

type Ranges = { minPrice: number; maxPrice: number; minDays: number; maxDays: number };

/**
 * Step 1 — decide which metrics can be used. A metric is used only if its weight is above
 * zero AND every quote in the group has a value for it (missing ≠ perfect, missing ≠ zero).
 */
function chooseMetrics(quotes: RankableQuote[], weights: Weights) {
  const included: Record<Metric, boolean> = { cost: weights.cost > 0, transit: weights.transit > 0, reliability: weights.reliability > 0 };
  const excludedMetrics: { metric: Metric; reason: string }[] = [];

  if (included.transit && quotes.some((q) => q.transitDays == null)) {
    included.transit = false;
    excludedMetrics.push({ metric: 'transit', reason: 'Transit time is unavailable for at least one option' });
  }
  const missingReliability = quotes.filter((q) => q.reliability.onTimeRate == null);
  if (included.reliability && missingReliability.length > 0) {
    included.reliability = false;
    const carriers = [...new Set(missingReliability.map((q) => q.carrierName))].join(', ');
    excludedMetrics.push({
      metric: 'reliability',
      reason: `Insufficient delivery history for ${carriers} (minimum ${missingReliability[0]!.reliability.minSamples} delivered shipments per carrier)`,
    });
  }
  return { included, excludedMetrics };
}

/** Step 2 — rescale the weights of the included metrics so they add up to 1. */
function normaliseWeights(weights: Weights, included: Record<Metric, boolean>): Record<Metric, number> {
  const sum = METRICS.reduce((total, m) => total + (included[m] ? weights[m] : 0), 0);
  return {
    cost: sum > 0 && included.cost ? weights.cost / sum : 0,
    transit: sum > 0 && included.transit ? weights.transit / sum : 0,
    reliability: sum > 0 && included.reliability ? weights.reliability / sum : 0,
  };
}

/** Step 3 — score one quote: each metric on a 0–1 scale (1 = best), weighted, out of 100. */
function scoreQuote(q: RankableQuote, r: Ranges, applied: Record<Metric, number>, included: Record<Metric, boolean>) {
  const components: Record<Metric, number | null> = {
    cost: minMaxScore(q.totalMinor, r.minPrice, r.maxPrice),
    transit: q.transitDays != null ? minMaxScore(q.transitDays, r.minDays, r.maxDays) : null,
    reliability: q.reliability.onTimeRate,
  };
  const contributions: Record<Metric, number | null> = { cost: null, transit: null, reliability: null };
  let raw = 0;
  for (const m of METRICS) {
    if (!included[m]) continue;
    raw += applied[m] * components[m]!;
    contributions[m] = round1(applied[m] * components[m]! * 100);
  }
  return { score: round1(raw * 100), components, contributions };
}

/** Step 4 — plain-language reasons shown under each offer. */
function explainQuote(q: RankableQuote, count: number, currency: Currency, cheapest: RankableQuote | null, fastest: RankableQuote | null): string[] {
  const lines: string[] = [];
  if (cheapest && q.id === cheapest.id) {
    lines.push(`Lowest price of ${plural(count, 'eligible option')}`);
  } else if (cheapest) {
    const diff = q.totalMinor - cheapest.totalMinor;
    const pct = cheapest.totalMinor > 0 ? Math.round((diff / cheapest.totalMinor) * 100) : 0;
    lines.push(`${formatMinor(diff, currency)} (${pct}%) more than the cheapest option`);
  }
  if (q.transitDays == null) {
    lines.push('Transit time not provided by the source');
  } else if (fastest && q.id === fastest.id) {
    lines.push(`Fastest estimate: ${plural(q.transitDays, 'business day')}`);
  } else if (fastest) {
    lines.push(`${plural(q.transitDays - fastest.transitDays!, 'business day')} slower than the fastest option`);
  }
  if (q.reliability.onTimeRate != null) {
    lines.push(`On-time rate ${Math.round(q.reliability.onTimeRate * 100)}% across ${plural(q.reliability.sampleSize, 'delivered shipment')} in your history`);
  } else {
    lines.push(`Reliability unavailable: ${plural(q.reliability.sampleSize, 'delivered shipment')} recorded with ${q.carrierName} (minimum ${q.reliability.minSamples})`);
  }
  return lines;
}

/** Step 5 — trade-offs against the cheapest and the fastest offer. */
function describeTradeoffs(q: RankableQuote, currency: Currency, cheapest: RankableQuote | null, fastest: RankableQuote | null): string[] {
  const tradeoffs: string[] = [];
  if (cheapest && q.id !== cheapest.id && q.transitDays != null && cheapest.transitDays != null) {
    const extra = formatMinor(q.totalMinor - cheapest.totalMinor, currency);
    const sooner = cheapest.transitDays - q.transitDays;
    tradeoffs.push(
      sooner > 0
        ? `Costs ${extra} more than ${cheapest.carrierName} ${cheapest.serviceName} but arrives ${plural(sooner, 'business day')} sooner`
        : `Costs ${extra} more than ${cheapest.carrierName} ${cheapest.serviceName} with no speed advantage`,
    );
  }
  if (fastest && q.id !== fastest.id && q.transitDays != null) {
    const slower = q.transitDays - fastest.transitDays!;
    const saves = fastest.totalMinor - q.totalMinor;
    if (slower > 0 && saves > 0) {
      tradeoffs.push(`Arrives ${plural(slower, 'business day')} after ${fastest.carrierName} ${fastest.serviceName} but saves ${formatMinor(saves, currency)}`);
    }
  }
  return tradeoffs;
}

/** Ranks the eligible quotes of one currency. */
function rankGroup(currency: Currency, quotes: RankableQuote[], weights: Weights): CurrencyGroupResult {
  const { included, excludedMetrics } = chooseMetrics(quotes, weights);
  const applied = normaliseWeights(weights, included);

  const prices = quotes.map((q) => q.totalMinor);
  const days = quotes.map((q) => q.transitDays).filter((d): d is number => d != null);
  const ranges: Ranges = {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    minDays: days.length ? Math.min(...days) : 0,
    maxDays: days.length ? Math.max(...days) : 0,
  };
  const scored = quotes.map((q) => ({ quote: q, ...scoreQuote(q, ranges, applied, included) }));

  const byPrice = [...quotes].sort(tieBreak);
  const bySpeed = quotes.filter((q) => q.transitDays != null).sort((a, b) => a.transitDays! - b.transitDays! || tieBreak(a, b));
  const byScore = [...scored].sort((a, b) => b.score - a.score || tieBreak(a.quote, b.quote)).map((s) => s.quote);
  const cheapest = byPrice[0] ?? null;
  const fastest = bySpeed[0] ?? null;
  const best = byScore[0] ?? null;

  const ranked: RankedQuote[] = scored.map(({ quote: q, score, components, contributions }) => {
    const badges: Badge[] = [];
    if (q.id === cheapest?.id) badges.push('CHEAPEST');
    if (q.id === fastest?.id) badges.push('FASTEST');
    if (q.id === best?.id) badges.push('BEST_BALANCED');

    const explanation = explainQuote(q, quotes.length, currency, cheapest, fastest);
    if (q.id === best?.id) {
      const parts = METRICS.filter((m) => contributions[m] != null).map((m) => `${m === 'transit' ? 'speed' : m} ${contributions[m]} pts`);
      explanation.unshift(`Highest balanced score (${score}/100: ${parts.join(', ')})`);
    }
    return { id: q.id, score, components, contributions, badges, explanation, tradeoffs: describeTradeoffs(q, currency, cheapest, fastest) };
  });

  return {
    currency,
    appliedWeights: {
      cost: round1(applied.cost * 100) / 100,
      transit: round1(applied.transit * 100) / 100,
      reliability: round1(applied.reliability * 100) / 100,
    },
    excludedMetrics,
    quotes: ranked,
    order: {
      CHEAPEST: byPrice.map((q) => q.id),
      FASTEST: [...bySpeed.map((q) => q.id), ...byPrice.filter((q) => q.transitDays == null).map((q) => q.id)],
      BALANCED: byScore.map((q) => q.id),
    },
    cheapestId: cheapest?.id ?? null,
    fastestId: fastest?.id ?? null,
    bestBalancedId: best?.id ?? null,
  };
}

/** Guard for direct callers; API input is already validated by `weightsInput`. */
export function validateWeights(w: Weights): Weights {
  for (const k of METRICS) {
    if (!Number.isFinite(w[k]) || w[k] < 0 || w[k] > 100) throw new RangeError(`Weight "${k}" must be between 0 and 100`);
  }
  if (w.cost + w.transit + w.reliability <= 0) throw new RangeError('At least one weight must be greater than zero');
  return w;
}

export function recommend(quotes: RankableQuote[], weights: Weights = DEFAULT_WEIGHTS): RecommendationResult {
  validateWeights(weights);
  const notes: string[] = [];
  const byCurrency = new Map<Currency, RankableQuote[]>();
  for (const q of quotes) {
    const list = byCurrency.get(q.currency) ?? [];
    list.push(q);
    byCurrency.set(q.currency, list);
  }
  if (byCurrency.size > 1) {
    notes.push('Options are quoted in more than one currency. They are ranked separately because no exchange-rate source is configured.');
  }
  const groups = [...byCurrency.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([currency, list]) => rankGroup(currency, list, weights));
  return { weights, groups, notes };
}
