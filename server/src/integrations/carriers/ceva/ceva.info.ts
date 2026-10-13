import type { PartnerAccessInfo } from '../partner-access.js';

/**
 * CEVA Logistics — no public self-service developer portal was found when this
 * integration was designed. API access appears to be arranged directly with CEVA
 * (or through third-party visibility platforms).
 *
 * STATUS: adapter NOT implemented — contact CEVA for API documentation and credentials.
 */
export const CEVA_ACCESS: PartnerAccessInfo = {
  code: 'CEVA',
  portal: 'https://www.cevalogistics.com/',
  requirements: ['Direct commercial agreement with CEVA Logistics', 'API documentation and credentials supplied by CEVA'],
  credentialEnv: ['CEVA_API_KEY'],
};
