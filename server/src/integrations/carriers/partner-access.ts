import type { CarrierCode } from './types.js';

/**
 * Carriers whose APIs require commercial onboarding before any endpoint can be called.
 * Fluxora does not ship adapters for these that pretend to work: until an adapter is
 * implemented and verified against the provider's documentation and a real account,
 * quotes for these carriers come only from the clearly-labelled simulator.
 */
export interface PartnerAccessInfo {
  code: CarrierCode;
  portal: string;
  requirements: string[];
  credentialEnv: string[];
}
