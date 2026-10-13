import crypto from 'node:crypto';
import { getRedis } from '../../config/redis.js';
import type { NormalizedQuote, ShipmentRequest } from '../../integrations/carriers/types.js';

/**
 * Short-lived cache of provider responses.
 *
 * - Keys include the organisation (contract rates are account-specific), the provider,
 *   the carrier, and a hash of EVERY request field that can affect the price.
 * - Cached quotes keep their original `retrievedAt`; they are flagged `fromCache` and are
 *   discarded once any quote's `validUntil` has passed.
 */
export interface QuoteCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export class MemoryQuoteCache implements QuoteCacheStore {
  private readonly map = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    if (this.map.size > 5000) this.map.clear(); // crude bound for a dev fallback
    this.map.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }
}

const memory = new MemoryQuoteCache();

function store(): QuoteCacheStore {
  const redis = getRedis();
  if (!redis) return memory;
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttl) => {
      await redis.set(key, value, 'EX', ttl);
    },
  };
}

export function quoteCacheKey(organizationId: string, provider: string, carrierCode: string, req: ShipmentRequest): string {
  const material = JSON.stringify({
    o: [req.origin.country, req.origin.city.trim().toLowerCase(), req.origin.postalCode?.trim().toUpperCase() ?? ''],
    d: [req.destination.country, req.destination.city.trim().toLowerCase(), req.destination.postalCode?.trim().toUpperCase() ?? ''],
    t: req.shipmentType,
    n: req.packageCount,
    w: req.actualWeightKg,
    dims: [req.lengthCm ?? null, req.widthCm ?? null, req.heightCm ?? null],
    s: req.servicePreference ?? null,
    c: req.currency,
    ins: req.insuranceRequired ? [req.cargoValueMinor ?? 0, req.cargoCurrency ?? req.currency] : null,
    sh: [...req.specialHandling].sort(),
    date: req.shipDate.toISOString().slice(0, 10),
  });
  const hash = crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
  return `fluxora:quotes:${organizationId}:${provider}:${carrierCode}:${hash}`;
}

export async function readCachedQuotes(key: string, now = new Date(), cache: QuoteCacheStore = store()): Promise<NormalizedQuote[] | null> {
  const raw = await cache.get(key);
  if (!raw) return null;
  let quotes: NormalizedQuote[];
  try {
    quotes = JSON.parse(raw) as NormalizedQuote[];
  } catch {
    return null;
  }
  const expired = quotes.some((q) => q.provenance.validUntil && new Date(q.provenance.validUntil).getTime() <= now.getTime());
  if (expired) return null;
  return quotes.map((q) => ({ ...q, provenance: { ...q.provenance, fromCache: true } }));
}

export async function writeCachedQuotes(key: string, quotes: NormalizedQuote[], ttlSeconds: number, now = new Date(), cache: QuoteCacheStore = store()): Promise<void> {
  if (ttlSeconds <= 0 || quotes.length === 0) return;
  // Never cache beyond the earliest quote validity.
  const validUntil = quotes
    .map((q) => (q.provenance.validUntil ? new Date(q.provenance.validUntil).getTime() : Number.POSITIVE_INFINITY))
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
  const ttl = Math.min(ttlSeconds, Number.isFinite(validUntil) ? Math.floor((validUntil - now.getTime()) / 1000) : ttlSeconds);
  if (ttl <= 0) return;
  await cache.set(key, JSON.stringify(quotes), ttl);
}
