import type { PartnerAccessInfo } from '../partner-access.js';

/**
 * DSV — https://developer.dsv.com/
 * Anyone can register and subscribe; once DSV approves a subscription the portal issues
 * keys for the DEMO environment (test shipments). Production needs a DSV customer account.
 *
 * STATUS: tracking implemented (dsv.adapter.ts). Quotes are simulated: the DSV Quote API
 * is asynchronous and does not fit an instant price comparison.
 */
export const DSV_ACCESS: PartnerAccessInfo = {
  code: 'DSV',
  portal: 'https://developer.dsv.com/',
  requirements: [
    'DSV Developer Portal account with approved "DSV Access Token" and "Tracking" subscriptions',
    'myDSV credentials (a shared demo login is published for the demo environment)',
    'DSV customer account to go live with real shipments',
  ],
  credentialEnv: ['DSV_TRACKING_SUBSCRIPTION_KEY'],
};
