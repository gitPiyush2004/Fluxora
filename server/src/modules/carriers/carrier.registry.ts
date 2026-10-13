import { env } from '../../config/env.js';
import { CEVA_ACCESS } from '../../integrations/carriers/ceva/ceva.info.js';
import { DhlAdapter } from '../../integrations/carriers/dhl/dhl.adapter.js';
import { DhlExpressRatesClient } from '../../integrations/carriers/dhl/dhl-express-rates.client.js';
import { DhlTrackingClient } from '../../integrations/carriers/dhl/dhl-tracking.client.js';
import { DsvAdapter } from '../../integrations/carriers/dsv/dsv.adapter.js';
import { DSV_ACCESS } from '../../integrations/carriers/dsv/dsv.info.js';
import { FedexAdapter } from '../../integrations/carriers/fedex/fedex.adapter.js';
import { KUEHNE_NAGEL_ACCESS } from '../../integrations/carriers/kuehne-nagel/kuehne-nagel.info.js';
import { UpsAdapter } from '../../integrations/carriers/ups/ups.adapter.js';
import type { PartnerAccessInfo } from '../../integrations/carriers/partner-access.js';
import { SIM_PROFILES } from '../../integrations/carriers/simulator/profiles.js';
import { SimulatedCarrierAdapter } from '../../integrations/carriers/simulator/simulator.adapter.js';
import { CARRIER_CODES, type CarrierAdapter, type CarrierCode } from '../../integrations/carriers/types.js';

export const CARRIER_NAMES: Record<CarrierCode, string> = {
  DHL: 'DHL',
  FEDEX: 'FedEx',
  UPS: 'UPS',
  DSV: 'DSV',
  KUEHNE_NAGEL: 'Kuehne+Nagel',
  CEVA: 'CEVA Logistics',
};

interface Registry {
  live: Map<CarrierCode, CarrierAdapter>;
  simulated: Map<CarrierCode, CarrierAdapter>;
}

function buildRegistry(): Registry {
  const live = new Map<CarrierCode, CarrierAdapter>();
  const simulated = new Map<CarrierCode, CarrierAdapter>();

  const dhlRates =
    env.DHL_EXPRESS_USERNAME && env.DHL_EXPRESS_PASSWORD && env.DHL_EXPRESS_ACCOUNT_NUMBER
      ? new DhlExpressRatesClient(env.DHL_EXPRESS_USERNAME, env.DHL_EXPRESS_PASSWORD, env.DHL_EXPRESS_ACCOUNT_NUMBER, env.DHL_EXPRESS_BASE_URL)
      : undefined;
  const dhlTracking = env.DHL_TRACKING_API_KEY ? new DhlTrackingClient(env.DHL_TRACKING_API_KEY, env.DHL_TRACKING_BASE_URL) : undefined;
  if (dhlRates || dhlTracking) live.set('DHL', new DhlAdapter(dhlRates, dhlTracking));

  if (env.FEDEX_CLIENT_ID && env.FEDEX_CLIENT_SECRET) {
    live.set('FEDEX', new FedexAdapter(env.FEDEX_CLIENT_ID, env.FEDEX_CLIENT_SECRET, env.FEDEX_ACCOUNT_NUMBER, env.FEDEX_BASE_URL));
  }
  if (env.UPS_CLIENT_ID && env.UPS_CLIENT_SECRET) {
    live.set('UPS', new UpsAdapter(env.UPS_CLIENT_ID, env.UPS_CLIENT_SECRET, env.UPS_ACCOUNT_NUMBER, env.UPS_BASE_URL));
  }
  if (env.DSV_USERNAME && env.DSV_PASSWORD && env.DSV_TOKEN_SUBSCRIPTION_KEY && env.DSV_TRACKING_SUBSCRIPTION_KEY) {
    live.set('DSV', new DsvAdapter(env.DSV_USERNAME, env.DSV_PASSWORD, env.DSV_TOKEN_SUBSCRIPTION_KEY, env.DSV_TRACKING_SUBSCRIPTION_KEY, env.DSV_BASE_URL));
  }

  if (env.CARRIER_SIMULATION_ENABLED) {
    for (const profile of SIM_PROFILES) simulated.set(profile.code, new SimulatedCarrierAdapter(profile));
  }
  return { live, simulated };
}

let registry: Registry = buildRegistry();

/** Test hook: replace adapters (e.g. with mocks that fail or time out). */
export function setCarrierAdaptersForTesting(live: CarrierAdapter[], simulated: CarrierAdapter[]): void {
  registry = { live: new Map(live.map((a) => [a.code, a])), simulated: new Map(simulated.map((a) => [a.code, a])) };
}

export function resetCarrierAdapters(): void {
  registry = buildRegistry();
}

export interface QuoteSourcePlan {
  carrierCode: CarrierCode;
  carrierName: string;
  adapter: CarrierAdapter | null;
  reason?: string;
}

/** One quote source per carrier: a configured live/sandbox adapter wins, else the simulator. */
export function planQuoteSources(carriers?: CarrierCode[]): QuoteSourcePlan[] {
  return (carriers ?? [...CARRIER_CODES]).map((code) => {
    const live = registry.live.get(code);
    if (live?.capabilities.quotes) return { carrierCode: code, carrierName: CARRIER_NAMES[code], adapter: live };
    const sim = registry.simulated.get(code);
    if (sim) return { carrierCode: code, carrierName: CARRIER_NAMES[code], adapter: sim };
    return { carrierCode: code, carrierName: CARRIER_NAMES[code], adapter: null, reason: 'No configured integration and simulation is disabled' };
  });
}

export function bookingAdapterFor(code: CarrierCode, quoteIsSimulated: boolean): CarrierAdapter | null {
  const adapter = quoteIsSimulated ? registry.simulated.get(code) : registry.live.get(code);
  return adapter?.capabilities.booking ? adapter : null;
}

export function trackingAdapterFor(code: CarrierCode, mode: 'LIVE' | 'SIMULATED'): CarrierAdapter | null {
  const adapter = mode === 'SIMULATED' ? registry.simulated.get(code) : registry.live.get(code);
  return adapter?.capabilities.tracking && adapter.getTracking ? adapter : null;
}

export function cancellationAdapterFor(code: CarrierCode, isSimulated: boolean): CarrierAdapter | null {
  const adapter = isSimulated ? registry.simulated.get(code) : registry.live.get(code);
  return adapter?.capabilities.cancellation && adapter.cancelBooking ? adapter : null;
}

const PARTNER_INFO: Partial<Record<CarrierCode, PartnerAccessInfo>> = {
  DSV: DSV_ACCESS,
  KUEHNE_NAGEL: KUEHNE_NAGEL_ACCESS,
  CEVA: CEVA_ACCESS,
};

const DEVELOPER_PORTALS: Partial<Record<CarrierCode, string>> = {
  DHL: 'https://developer.dhl.com/',
  FEDEX: 'https://developer.fedex.com/',
  UPS: 'https://developer.ups.com/',
};

/** Human-readable integration status for the Settings page and /health. */
export function listCarrierIntegrations() {
  return CARRIER_CODES.map((code) => {
    const live = registry.live.get(code);
    const sim = registry.simulated.get(code);
    const partner = PARTNER_INFO[code];
    const capability = (key: 'quotes' | 'booking' | 'tracking' | 'cancellation') => {
      if (live?.capabilities[key]) return live.mode;
      if (sim?.capabilities[key]) return 'SIMULATED';
      return 'UNAVAILABLE';
    };
    const notes: string[] = [];
    if (code === 'DHL') {
      notes.push('Tracking: DHL Shipment Tracking – Unified API (set DHL_TRACKING_API_KEY).');
      notes.push('Rates: MyDHL Express API (set DHL_EXPRESS_USERNAME/PASSWORD/ACCOUNT_NUMBER) — implemented, not verified with live credentials.');
      notes.push('Booking via API is not implemented; record DHL bookings manually.');
    }
    if (code === 'FEDEX') {
      notes.push('Rates & tracking: FedEx REST APIs (set FEDEX_CLIENT_ID/SECRET/ACCOUNT_NUMBER) — implemented, not verified with live credentials.');
      notes.push('Booking via API is not implemented; record FedEx bookings manually.');
    }
    if (code === 'UPS') {
      notes.push('Rates & tracking: UPS REST APIs (set UPS_CLIENT_ID/SECRET/ACCOUNT_NUMBER) — implemented, not verified with live credentials.');
      notes.push('Booking via API is not implemented; record UPS bookings manually.');
    }
    if (code === 'DSV') {
      notes.push('Tracking: DSV Generic Tracking API (set DSV_USERNAME/PASSWORD and both subscription keys); the tracking number is the DSV booking ID.');
      notes.push('Quotes stay simulated: the DSV Quote API is asynchronous.');
    } else if (partner) {
      notes.push(`No adapter implemented: API access requires partner onboarding (${partner.portal}).`);
      if (partner.credentialEnv.some((k) => process.env[k])) notes.push('Credentials are set, but no verified adapter exists yet — they are not used.');
    }
    if (sim) notes.push('Simulator active: quotes, bookings and tracking are labelled as simulated demonstration data.');
    return {
      code,
      name: CARRIER_NAMES[code],
      quotes: capability('quotes'),
      booking: capability('booking'),
      tracking: capability('tracking'),
      cancellation: capability('cancellation'),
      requirements: partner?.requirements ?? [],
      portal: partner?.portal ?? DEVELOPER_PORTALS[code],
      notes,
    };
  });
}
