import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { CarrierError, type CarrierCode, type NormalizedQuote, type ShipmentRequest } from '../../integrations/carriers/types.js';
import { notFound } from '../../utils/errors.js';
import type { Currency } from '../../utils/money.js';
import { carrierReliability, reliabilityFor, type CarrierReliability } from '../analytics/reliability.js';
import { calculateBillableWeight } from '../carriers/billable-weight.js';
import { planQuoteSources, type QuoteSourcePlan } from '../carriers/carrier.registry.js';
import { checkEligibility } from '../carriers/eligibility.js';
import { Organization } from '../organizations/organization.model.js';
import type { ShipmentSpecInput } from '../shipments/shipment.schemas.js';
import { CarrierQuote, QuoteRequest } from './quote.model.js';
import { quoteCacheKey, readCachedQuotes, writeCachedQuotes } from './quote-cache.js';
import { DEFAULT_WEIGHTS, recommend, validateWeights, type RankableQuote, type Weights } from './recommendation.js';

export type ProviderStatus = 'OK' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH' | 'NOT_CONFIGURED' | 'UNSUPPORTED';

interface ProviderOutcome {
  carrierCode: CarrierCode;
  carrierName: string;
  provider: string | null;
  mode: string;
  status: ProviderStatus;
  message?: string;
  quoteCount: number;
  durationMs: number;
  fromCache: boolean;
}

/** Converts validated user input into the normalized adapter request. */
export function toShipmentRequest(spec: ShipmentSpecInput, now = new Date()): ShipmentRequest {
  return {
    origin: { city: spec.origin.city, postalCode: spec.origin.postalCode || undefined, country: spec.origin.country },
    destination: { city: spec.destination.city, postalCode: spec.destination.postalCode || undefined, country: spec.destination.country },
    shipmentType: spec.shipmentType,
    packageCount: spec.packageCount,
    actualWeightKg: spec.actualWeightKg,
    lengthCm: spec.lengthCm ?? undefined,
    widthCm: spec.widthCm ?? undefined,
    heightCm: spec.heightCm ?? undefined,
    requiredDeliveryDate: spec.requiredDeliveryDate ?? undefined,
    servicePreference: spec.servicePreference ?? undefined,
    cargoValueMinor: spec.cargoValueMinor ?? undefined,
    cargoCurrency: (spec.cargoCurrency ?? undefined) as Currency | undefined,
    insuranceRequired: spec.insuranceRequired,
    specialHandling: spec.specialHandling,
    maxBudgetMinor: spec.maxBudgetMinor ?? undefined,
    currency: spec.currency,
    shipDate: spec.shipDate && spec.shipDate > now ? spec.shipDate : now,
  };
}

function statusFromError(err: unknown): { status: ProviderStatus; message: string } {
  if (err instanceof CarrierError) {
    const map: Record<string, ProviderStatus> = {
      TIMEOUT: 'TIMEOUT', RATE_LIMITED: 'RATE_LIMITED', AUTH: 'AUTH', NOT_CONFIGURED: 'NOT_CONFIGURED', UNSUPPORTED: 'UNSUPPORTED',
    };
    return { status: map[err.kind] ?? 'ERROR', message: err.message };
  }
  return { status: 'ERROR', message: 'Unexpected error while contacting the provider' };
}

/**
 * Gets quotes from one provider (cache first). Never throws: failures become an outcome
 * like TIMEOUT or AUTH so one slow or broken carrier never blocks the others.
 */
async function fetchFromProvider(
  organizationId: string,
  plan: QuoteSourcePlan,
  req: ShipmentRequest,
): Promise<{ outcome: ProviderOutcome; quotes: NormalizedQuote[] }> {
  const started = Date.now();
  const base = { carrierCode: plan.carrierCode, carrierName: plan.carrierName, provider: plan.adapter?.providerId ?? null, mode: plan.adapter?.mode ?? 'UNAVAILABLE' };
  if (!plan.adapter) {
    return { outcome: { ...base, status: 'NOT_CONFIGURED', message: plan.reason, quoteCount: 0, durationMs: 0, fromCache: false }, quotes: [] };
  }
  const key = quoteCacheKey(organizationId, plan.adapter.providerId, plan.carrierCode, req);
  try {
    const cached = await readCachedQuotes(key).catch(() => null);
    if (cached) {
      return { outcome: { ...base, status: 'OK', quoteCount: cached.length, durationMs: Date.now() - started, fromCache: true }, quotes: cached };
    }
    const quotes = await plan.adapter.getQuotes(req, AbortSignal.timeout(env.CARRIER_TIMEOUT_MS));
    await writeCachedQuotes(key, quotes, env.QUOTE_CACHE_TTL_SECONDS).catch((e) => logger.warn({ err: (e as Error).message }, 'Quote cache write failed'));
    return {
      outcome: { ...base, status: quotes.length ? 'OK' : 'EMPTY', quoteCount: quotes.length, durationMs: Date.now() - started, fromCache: false },
      quotes,
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const { status, message } = timedOut ? { status: 'TIMEOUT' as ProviderStatus, message: 'Carrier API did not respond in time' } : statusFromError(err);
    logger.warn({ carrier: plan.carrierCode, status, message }, 'Carrier quote request failed');
    return { outcome: { ...base, status, message, quoteCount: 0, durationMs: Date.now() - started, fromCache: false }, quotes: [] };
  }
}

async function orgQuoteSettings(organizationId: Types.ObjectId) {
  const org = await Organization.findById(organizationId).select('settings').lean();
  return {
    weights: (org?.settings?.recommendationWeights as Weights | undefined) ?? DEFAULT_WEIGHTS,
    minSamples: org?.settings?.reliabilityMinSamples ?? 5,
    divisor: org?.settings?.volumetricDivisor ?? 5000,
  };
}

type StoredQuote = Awaited<ReturnType<typeof loadQuotes>>[number];

async function loadQuotes(organizationId: Types.ObjectId, quoteRequestId: Types.ObjectId | string) {
  return CarrierQuote.find({ organizationId, quoteRequestId }).sort({ totalMinor: 1, _id: 1 }).lean();
}

function rankable(quotes: StoredQuote[]): RankableQuote[] {
  return quotes
    .filter((q) => q.eligibility?.eligible)
    .map((q) => ({
      id: String(q._id),
      carrierCode: q.carrierCode,
      carrierName: q.carrierName,
      serviceName: q.serviceName,
      currency: q.currency as Currency,
      totalMinor: q.totalMinor,
      transitDays: q.transitDays ?? null,
      reliability: {
        onTimeRate: q.reliability?.onTimeRate ?? null,
        sampleSize: q.reliability?.sampleSize ?? 0,
        minSamples: q.reliability?.minSamples ?? 5,
      },
    }));
}

/**
 * Runs a carrier comparison: fans out to every quote source in parallel with a timeout,
 * isolates failures per provider, applies hard constraints, persists the snapshot and
 * ranks eligible offers.
 */
export async function requestQuotes(params: {
  organizationId: Types.ObjectId;
  userId?: Types.ObjectId;
  spec: ShipmentSpecInput;
  shipmentId?: Types.ObjectId;
  weights?: Weights;
  carriers?: CarrierCode[];
}) {
  const { organizationId } = params;
  const now = new Date();
  const req = toShipmentRequest(params.spec, now);
  const settings = await orgQuoteSettings(organizationId);
  const weights = validateWeights(params.weights ?? settings.weights);

  const plans = planQuoteSources(params.carriers);
  const results = await Promise.all(plans.map((p) => fetchFromProvider(String(organizationId), p, req)));
  const reliability = await carrierReliability(organizationId, settings.minSamples);

  const quoteRequest = await QuoteRequest.create({
    organizationId,
    shipmentId: params.shipmentId,
    request: { ...params.spec, shipDate: req.shipDate },
    providers: results.map((r) => r.outcome),
    createdBy: params.userId,
  });

  const docs = results.flatMap((r) =>
    r.quotes.map((q: NormalizedQuote) => {
      const eligibility = checkEligibility(q, req, now);
      const rel: CarrierReliability = reliabilityFor(reliability, q.carrierCode, settings.minSamples);
      return {
        organizationId,
        quoteRequestId: quoteRequest._id,
        shipmentId: params.shipmentId,
        carrierCode: q.carrierCode,
        carrierName: q.carrierName,
        serviceCode: q.serviceCode,
        serviceName: q.serviceName,
        serviceLevel: q.serviceLevel,
        currency: q.currency,
        totalMinor: q.totalMinor,
        breakdown: q.breakdown,
        transitDays: q.transitDays ?? undefined,
        estimatedDeliveryDate: q.estimatedDeliveryDate ? new Date(q.estimatedDeliveryDate) : undefined,
        billableWeightKg: q.billableWeightKg,
        volumetricWeightKg: q.volumetricWeightKg ?? undefined,
        constraints: q.constraints,
        provenance: { ...q.provenance, retrievedAt: new Date(q.provenance.retrievedAt), validUntil: q.provenance.validUntil ? new Date(q.provenance.validUntil) : undefined },
        eligibility,
        reliability: { onTimeRate: rel.onTimeRate ?? undefined, sampleSize: rel.sampleSize, minSamples: rel.minSamples },
      };
    }),
  );
  if (docs.length) await CarrierQuote.insertMany(docs);

  return buildQuoteResponse(organizationId, quoteRequest._id, weights);
}

/** Loads a stored comparison and ranks its offers (re-ranking with new weights never re-queries carriers). */
export async function buildQuoteResponse(organizationId: Types.ObjectId, quoteRequestId: Types.ObjectId | string, weights?: Weights) {
  const qr = await QuoteRequest.findOne({ _id: quoteRequestId, organizationId }).lean();
  if (!qr) throw notFound('Quote request');
  const settings = await orgQuoteSettings(organizationId);
  const w = validateWeights(weights ?? settings.weights);
  const quotes = await loadQuotes(organizationId, qr._id);
  const recommendation = recommend(rankable(quotes), w);
  const spec = qr.request as ShipmentSpecInput & { shipDate: Date };
  const estimate = calculateBillableWeight({
    actualWeightKg: spec.actualWeightKg,
    packageCount: spec.packageCount,
    lengthCm: spec.lengthCm ?? undefined,
    widthCm: spec.widthCm ?? undefined,
    heightCm: spec.heightCm ?? undefined,
    divisor: settings.divisor,
  });
  const now = Date.now();
  return {
    quoteRequestId: String(qr._id),
    shipmentId: qr.shipmentId ? String(qr.shipmentId) : null,
    createdAt: qr.createdAt,
    request: spec,
    weightEstimate: { ...estimate, note: 'Estimate using your organisation divisor. Each carrier applies its own volumetric rules; see each offer.' },
    providers: qr.providers,
    quotes: quotes.map((q) => ({
      ...q,
      id: String(q._id),
      isExpired: !!q.provenance.validUntil && new Date(q.provenance.validUntil).getTime() < now,
    })),
    recommendation,
    allSimulated: quotes.length > 0 && quotes.every((q) => q.provenance.isSimulated),
  };
}

export async function getLatestQuotesForShipment(organizationId: Types.ObjectId, shipmentId: Types.ObjectId) {
  const qr = await QuoteRequest.findOne({ organizationId, shipmentId }).sort({ createdAt: -1 }).select('_id').lean();
  if (!qr) return null;
  return buildQuoteResponse(organizationId, qr._id);
}
