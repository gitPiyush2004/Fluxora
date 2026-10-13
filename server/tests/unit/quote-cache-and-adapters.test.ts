import { afterEach, describe, expect, it, vi } from 'vitest';
import { DhlTrackingClient } from '../../src/integrations/carriers/dhl/dhl-tracking.client.js';
import { DhlExpressRatesClient } from '../../src/integrations/carriers/dhl/dhl-express-rates.client.js';
import { FedexAdapter } from '../../src/integrations/carriers/fedex/fedex.adapter.js';
import { DsvAdapter } from '../../src/integrations/carriers/dsv/dsv.adapter.js';
import { UpsAdapter } from '../../src/integrations/carriers/ups/ups.adapter.js';
import { CarrierError, type NormalizedQuote, type ShipmentRequest } from '../../src/integrations/carriers/types.js';
import { MemoryQuoteCache, quoteCacheKey, readCachedQuotes, writeCachedQuotes } from '../../src/modules/quotes/quote-cache.js';

const req: ShipmentRequest = {
  origin: { city: 'Shenzhen', country: 'CN', postalCode: '518000' },
  destination: { city: 'Newark', country: 'US', postalCode: '07114' },
  shipmentType: 'BOX', packageCount: 1, actualWeightKg: 10, lengthCm: 40, widthCm: 30, heightCm: 30,
  insuranceRequired: false, specialHandling: [], currency: 'USD', shipDate: new Date('2026-03-02T09:00:00Z'),
};

const quote = (validUntil: string): NormalizedQuote => ({
  carrierCode: 'DHL', carrierName: 'DHL', serviceCode: 'X', serviceName: 'X', serviceLevel: 'EXPRESS', currency: 'USD', totalMinor: 1000,
  breakdown: [], transitDays: 2, estimatedDeliveryDate: null,
  provenance: { sourceType: 'SIMULATED', provider: 'p', retrievedAt: '2026-03-02T09:00:00.000Z', isSimulated: true, validUntil, limitations: [] },
});

describe('quote cache', () => {
  it('keys include organisation, provider and every price-affecting field', () => {
    const base = quoteCacheKey('org1', 'p', 'DHL', req);
    expect(quoteCacheKey('org2', 'p', 'DHL', req)).not.toBe(base);
    expect(quoteCacheKey('org1', 'p', 'FEDEX', req)).not.toBe(base);
    expect(quoteCacheKey('org1', 'p', 'DHL', { ...req, actualWeightKg: 11 })).not.toBe(base);
    expect(quoteCacheKey('org1', 'p', 'DHL', { ...req, heightCm: 31 })).not.toBe(base);
    expect(quoteCacheKey('org1', 'p', 'DHL', { ...req, currency: 'EUR' })).not.toBe(base);
    expect(quoteCacheKey('org1', 'p', 'DHL', { ...req, specialHandling: ['FRAGILE'] })).not.toBe(base);
    // normalisation: case / whitespace in city names doesn't create a new key
    expect(quoteCacheKey('org1', 'p', 'DHL', { ...req, origin: { ...req.origin, city: ' shenzhen ' } })).toBe(base);
  });

  it('preserves the original retrieval time and flags cached results', async () => {
    const cache = new MemoryQuoteCache(() => Date.parse('2026-03-02T09:00:00Z'));
    const now = new Date('2026-03-02T09:00:00Z');
    await writeCachedQuotes('k', [quote('2026-03-02T09:30:00.000Z')], 300, now, cache);
    const hit = await readCachedQuotes('k', new Date('2026-03-02T09:01:00Z'), cache);
    expect(hit![0]!.provenance.retrievedAt).toBe('2026-03-02T09:00:00.000Z');
    expect(hit![0]!.provenance.fromCache).toBe(true);
  });

  it('never serves an expired quote', async () => {
    let t = Date.parse('2026-03-02T09:00:00Z');
    const cache = new MemoryQuoteCache(() => t);
    await writeCachedQuotes('k', [quote('2026-03-02T09:02:00.000Z')], 3600, new Date(t), cache);
    expect(await readCachedQuotes('k', new Date('2026-03-02T09:03:00Z'), cache)).toBeNull();
    t += 10 * 60_000; // TTL is capped at quote validity (2 min) — entry is gone
    expect(await cache.get('k')).toBeNull();
  });

  it('does not cache when TTL is zero', async () => {
    const cache = new MemoryQuoteCache();
    await writeCachedQuotes('k', [quote('2099-01-01T00:00:00.000Z')], 0, new Date(), cache);
    expect(await cache.get('k')).toBeNull();
  });
});

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const { status, body } = handler(String(input), init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('real carrier adapters (mocked HTTP — never call live APIs in tests)', () => {
  afterEach(() => vi.restoreAllMocks());
  const signal = () => AbortSignal.timeout(1000);

  it('DHL tracking normalises events and statuses', async () => {
    const spy = mockFetch(() => ({
      status: 200,
      body: {
        shipments: [{ id: '00340434292135100186', events: [
          { timestamp: '2026-03-03T10:00:00Z', statusCode: 'transit', description: 'Shipment picked up', location: { address: { addressLocality: 'Leipzig', countryCode: 'DE' } } },
          { timestamp: '2026-03-04T08:00:00Z', statusCode: 'transit', description: 'Out for delivery' },
          { timestamp: '2026-03-04T15:00:00Z', statusCode: 'delivered', description: 'Delivered' },
        ] }],
      },
    }));
    const events = await new DhlTrackingClient('key', 'https://api-eu.dhl.com').getTracking({ trackingNumber: '00340434292135100186', origin: req.origin, destination: req.destination }, signal());
    expect(spy.mock.calls[0]![0]).toBe('https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186');
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>)['DHL-API-Key']).toBe('key');
    expect(events.map((e) => e.status)).toEqual(['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(events.every((e) => !e.provenance.isSimulated)).toBe(true);
    expect(events[0]!.location?.city).toBe('Leipzig');
  });

  it('maps HTTP failures to carrier error kinds', async () => {
    mockFetch(() => ({ status: 429, body: { title: 'Too many requests' } }));
    await expect(new DhlTrackingClient('key', 'https://x').getTracking({ trackingNumber: '1', origin: req.origin, destination: req.destination }, signal()))
      .rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    vi.restoreAllMocks();
    mockFetch(() => ({ status: 401, body: { detail: 'Invalid key' } }));
    await expect(new DhlTrackingClient('bad', 'https://x').getTracking({ trackingNumber: '1', origin: req.origin, destination: req.destination }, signal()))
      .rejects.toBeInstanceOf(CarrierError);
  });

  it('DHL Express rates are labelled sandbox when using the test environment', async () => {
    mockFetch(() => ({
      status: 200,
      body: { products: [{ productName: 'EXPRESS WORLDWIDE', productCode: 'P', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'USD', price: 123.45 }], deliveryCapabilities: { estimatedDeliveryDateAndTime: '2026-03-05T23:59:00', totalTransitDays: '3' } }] },
    }));
    const quotes = await new DhlExpressRatesClient('u', 'p', 'acct', 'https://express.api.dhl.com/mydhlapi/test').getQuotes(req, signal());
    expect(quotes[0]).toMatchObject({ totalMinor: 12345, currency: 'USD', transitDays: 3, serviceLevel: 'EXPRESS' });
    expect(quotes[0]!.provenance).toMatchObject({ sourceType: 'SANDBOX_QUOTE', isSimulated: false });
  });

  it('FedEx obtains an OAuth token, then rates, and caches the token', async () => {
    const spy = mockFetch((url) => {
      if (url.endsWith('/oauth/token')) return { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
      return {
        status: 200,
        body: { output: { rateReplyDetails: [{ serviceType: 'INTERNATIONAL_PRIORITY', serviceName: 'FedEx International Priority', ratedShipmentDetails: [{ rateType: 'ACCOUNT', totalNetCharge: 88.1, currency: 'USD' }], operationalDetail: { transitTime: 'TWO_DAYS' } }] } },
      };
    });
    const fedex = new FedexAdapter('id', 'secret', '123', 'https://apis-sandbox.fedex.com');
    const quotes = await fedex.getQuotes(req, signal());
    await fedex.getQuotes(req, signal());
    expect(quotes[0]).toMatchObject({ totalMinor: 8810, transitDays: 2, serviceLevel: 'EXPRESS' });
    expect(quotes[0]!.provenance.sourceType).toBe('SANDBOX_QUOTE');
    expect(spy.mock.calls.filter((c) => String(c[0]).endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('UPS uses Basic auth for the token, rates with negotiated prices, and tracks', async () => {
    const spy = mockFetch((url) => {
      if (url.endsWith('/security/v1/oauth/token')) return { status: 200, body: { access_token: 'tok', expires_in: '14399' } };
      if (url.includes('/api/rating/')) {
        return {
          status: 200,
          body: { RateResponse: { RatedShipment: [{ Service: { Code: '65' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '120.00' }, NegotiatedRateCharges: { TotalCharge: { CurrencyCode: 'USD', MonetaryValue: '97.50' } }, TimeInTransit: { ServiceSummary: { EstimatedArrival: { BusinessDaysInTransit: '3', Arrival: { Date: '20260305' } } } } }] } },
        };
      }
      return { status: 200, body: { trackResponse: { shipment: [{ package: [{ activity: [
        { date: '20260304', time: '143000', gmtOffset: '-05:00', status: { type: 'D', code: 'KB', description: 'DELIVERED' } },
        { date: '20260304', time: '081500', gmtOffset: '-05:00', status: { type: 'I', code: 'OT', description: 'Out For Delivery Today' }, location: { address: { city: 'Newark', countryCode: 'US' } } },
      ] }] }] } } };
    });
    const ups = new UpsAdapter('id', 'secret', 'A1B2C3', 'https://wwwcie.ups.com');
    const quotes = await ups.getQuotes(req, signal());
    expect(spy.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('id:secret').toString('base64')}` });
    expect(quotes[0]).toMatchObject({ serviceName: 'UPS Worldwide Saver', totalMinor: 9750, transitDays: 3, serviceLevel: 'EXPRESS' });
    expect(quotes[0]!.provenance.sourceType).toBe('SANDBOX_QUOTE');

    const events = await ups.getTracking({ trackingNumber: '1Z999AA10123456784', origin: req.origin, destination: req.destination }, signal());
    expect(spy.mock.calls[2]![0]).toBe('https://wwwcie.ups.com/api/track/v1/details/1Z999AA10123456784?locale=en_US');
    expect(events.map((e) => [e.status, e.occurredAt])).toEqual([
      ['OUT_FOR_DELIVERY', '2026-03-04T13:15:00.000Z'],
      ['DELIVERED', '2026-03-04T19:30:00.000Z'],
    ]);
    expect(spy.mock.calls.filter((c) => String(c[0]).endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('DSV logs in with the token key, tracks with the tracking key, and skips planned or cancelled events', async () => {
    const spy = mockFetch((url) => {
      if (url.endsWith('/oauth/v1/token')) return { status: 200, body: { access_token: 'tok', expires_in: 600 } };
      return { status: 200, body: { bookingId: '40257145990010760574', events: [
        { eventDate: '2026-03-04T09:00:00.000+0000', eventCode: 'DCF', eventDescription: 'Actual delivery', location: { place: 'Hamburg', countryCode: 'DE' } },
        { eventDate: '2026-03-02T08:00:00.000+0100', eventCode: 'PCF', eventDescription: 'Actual pickup', cancelled: false },
        { eventDate: '2026-03-05T00:00:00.000+0000', eventCode: 'ETA', eventDescription: 'Estimated arrival' },
        { eventDate: '2026-03-03T00:00:00.000+0000', eventCode: 'DEP', eventDescription: 'Departed', cancelled: true },
      ] } };
    });
    const dsv = new DsvAdapter('user', 'pass', 'token-key', 'tracking-key', 'https://api.dsv.com/my-demo');
    const events = await dsv.getTracking({ trackingNumber: '40257145990010760574', origin: req.origin, destination: req.destination }, signal());
    expect(spy.mock.calls[0]![1]!.headers).toMatchObject({ 'DSV-Subscription-Key': 'token-key' });
    expect(spy.mock.calls[1]![0]).toBe('https://api.dsv.com/my-demo/tracking/v2/shipments/bookingId/40257145990010760574');
    expect(spy.mock.calls[1]![1]!.headers).toMatchObject({ Authorization: 'Bearer tok', 'DSV-Subscription-Key': 'tracking-key' });
    expect(events.map((e) => [e.status, e.occurredAt])).toEqual([
      ['PICKED_UP', '2026-03-02T07:00:00.000Z'],
      ['DELIVERED', '2026-03-04T09:00:00.000Z'],
    ]);
    expect(events[0]!.provenance).toMatchObject({ sourceType: 'SANDBOX_QUOTE', isSimulated: false });
    expect(dsv.capabilities.quotes).toBe(false); // DSV prices keep coming from the simulator
  });
});
