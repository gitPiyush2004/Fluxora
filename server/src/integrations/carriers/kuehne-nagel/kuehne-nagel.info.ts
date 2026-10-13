import type { PartnerAccessInfo } from '../partner-access.js';

/**
 * Kuehne+Nagel — https://portal.api.kuehne-nagel.com/
 * API access is tied to a myKN customer account; OAuth2 consumer key/secret are issued
 * per shipper after onboarding. Product-specific APIs (e.g. LTL+ quoting and tracking)
 * are enabled on request through K+N.
 *
 * STATUS: adapter NOT implemented — requires K+N onboarding to build and verify.
 */
export const KUEHNE_NAGEL_ACCESS: PartnerAccessInfo = {
  code: 'KUEHNE_NAGEL',
  portal: 'https://portal.api.kuehne-nagel.com/',
  requirements: [
    'myKN customer account linked to an API portal account',
    'Production OAuth2 consumer key and secret',
    'Product enablement (quotes / booking / tracking) by Kuehne+Nagel',
  ],
  credentialEnv: ['KN_CLIENT_ID', 'KN_CLIENT_SECRET'],
};
