import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { AppError, unauthenticated } from '../../utils/errors.js';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

const client = new OAuth2Client();
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Verifies a Google Identity Services ID token (JWT) on the server.
 * `verifyIdToken` checks the RS256 signature against Google's published certs,
 * the audience and the expiry; we additionally pin the issuer and require a verified email.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID missing).');
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw unauthenticated('Google sign-in could not be verified. Please try again.');
  }
  if (!payload || !payload.sub || !payload.email) throw unauthenticated('Google token is missing required claims');
  if (!payload.iss || !VALID_ISSUERS.has(payload.iss)) throw unauthenticated('Unexpected token issuer');
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw unauthenticated('Unexpected token audience');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw unauthenticated('Google token has expired');
  if (payload.email_verified !== true) throw unauthenticated('Your Google account email is not verified');

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: payload.name ?? payload.email.split('@')[0]!,
    picture: payload.picture,
  };
}
