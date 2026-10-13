import { describe, expect, it } from 'vitest';
import { recommend, type RankableQuote } from '../../src/modules/quotes/recommendation.js';

const rel = (rate: number | null, n = 10) => ({ onTimeRate: rate, sampleSize: n, minSamples: 5 });

const q = (id: string, totalMinor: number, transitDays: number | null, rate: number | null = 0.9, extra: Partial<RankableQuote> = {}): RankableQuote => ({
  id,
  carrierCode: id.toUpperCase(),
  carrierName: id,
  serviceName: 'Svc',
  currency: 'USD',
  totalMinor,
  transitDays,
  reliability: rel(rate),
  ...extra,
});

describe('recommendation engine', () => {
  const quotes = [q('a', 10_000, 6, 0.8), q('b', 15_000, 2, 0.95), q('c', 12_000, 4, 0.9)];

  it('identifies cheapest and fastest deterministically', () => {
    const g = recommend(quotes).groups[0]!;
    expect(g.cheapestId).toBe('a');
    expect(g.fastestId).toBe('b');
    expect(g.order.CHEAPEST).toEqual(['a', 'c', 'b']);
    expect(g.order.FASTEST).toEqual(['b', 'c', 'a']);
  });

  it('normalizes metrics so higher always means better', () => {
    const g = recommend(quotes).groups[0]!;
    const a = g.quotes.find((x) => x.id === 'a')!;
    const b = g.quotes.find((x) => x.id === 'b')!;
    expect(a.components.cost).toBe(1);
    expect(b.components.cost).toBe(0);
    expect(b.components.transit).toBe(1);
    expect(a.components.transit).toBe(0);
  });

  it('computes the balanced score with the default 50/30/20 weights', () => {
    const g = recommend(quotes).groups[0]!;
    // a: 0.5×1 + 0.3×0 + 0.2×0.8 = 0.66 ; b: 0 + 0.3 + 0.19 = 0.49 ; c: 0.5×0.6 + 0.3×0.5 + 0.18 = 0.63
    expect(g.quotes.find((x) => x.id === 'a')!.score).toBe(66);
    expect(g.quotes.find((x) => x.id === 'b')!.score).toBe(49);
    expect(g.quotes.find((x) => x.id === 'c')!.score).toBe(63);
    expect(g.bestBalancedId).toBe('a');
    expect(g.appliedWeights).toEqual({ cost: 0.5, transit: 0.3, reliability: 0.2 });
  });

  it('reacts to weight changes', () => {
    const g = recommend(quotes, { cost: 0, transit: 100, reliability: 0 }).groups[0]!;
    expect(g.bestBalancedId).toBe('b');
  });

  it('excludes a metric that is missing for any option and renormalizes (never treated as perfect)', () => {
    const withMissing = [q('a', 10_000, 6, 0.8), q('b', 15_000, 2, null), q('c', 12_000, 4, 0.9)];
    const g = recommend(withMissing).groups[0]!;
    expect(g.excludedMetrics.map((e) => e.metric)).toEqual(['reliability']);
    expect(g.appliedWeights.reliability).toBe(0);
    expect(g.appliedWeights.cost).toBeCloseTo(0.625, 3);
    expect(g.appliedWeights.transit).toBeCloseTo(0.375, 3);
    const b = g.quotes.find((x) => x.id === 'b')!;
    expect(b.contributions.reliability).toBeNull();
    expect(b.explanation.some((e) => e.startsWith('Reliability unavailable'))).toBe(true);
  });

  it('excludes transit when an option has no transit time, and FASTEST ignores it', () => {
    const g = recommend([q('a', 10_000, null), q('b', 15_000, 2)]).groups[0]!;
    expect(g.excludedMetrics.map((e) => e.metric)).toContain('transit');
    expect(g.fastestId).toBe('b');
    expect(g.order.FASTEST).toEqual(['b', 'a']);
  });

  it('never compares prices across currencies', () => {
    const r = recommend([q('a', 10_000, 3), q('b', 9_000, 3, 0.9, { currency: 'EUR' }), q('c', 11_000, 2)]);
    expect(r.groups.map((g) => g.currency)).toEqual(['USD', 'EUR']);
    expect(r.notes[0]).toMatch(/more than one currency/);
    expect(r.groups[0]!.quotes.map((x) => x.id).sort()).toEqual(['a', 'c']);
  });

  it('breaks ties deterministically (price, transit, carrier code, service, id)', () => {
    const tied = [q('z', 10_000, 3, 0.9), q('y', 10_000, 3, 0.9)];
    const r1 = recommend(tied).groups[0]!;
    const r2 = recommend([...tied].reverse()).groups[0]!;
    expect(r1.bestBalancedId).toBe('y');
    expect(r2.bestBalancedId).toBe('y');
    expect(r1.order).toEqual(r2.order);
  });

  it('gives every option a score of 100 on each metric when all values are equal', () => {
    const g = recommend([q('a', 10_000, 3, 1), q('b', 10_000, 3, 1)]).groups[0]!;
    expect(g.quotes.every((x) => x.score === 100)).toBe(true);
  });

  it('explains trade-offs against the cheapest and fastest options', () => {
    const g = recommend(quotes).groups[0]!;
    const c = g.quotes.find((x) => x.id === 'c')!;
    expect(c.tradeoffs.join(' ')).toMatch(/more than a Svc but arrives 2 business days sooner/);
    expect(c.tradeoffs.join(' ')).toMatch(/after b Svc but saves \$30\.00/);
  });

  it('validates weights', () => {
    expect(() => recommend(quotes, { cost: 0, transit: 0, reliability: 0 })).toThrow(/greater than zero/);
    expect(() => recommend(quotes, { cost: -1, transit: 50, reliability: 0 })).toThrow();
  });
});
