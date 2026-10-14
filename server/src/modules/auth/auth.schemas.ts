import { z } from 'zod';
import { objectId } from '../../utils/validate.js';

/** The ID token (JWT) the Google sign-in button gives the browser. */
export const googleSignInInput = z.object({ credential: z.string().min(20).max(8192) });
export const magicLinkInput = z.object({ email: z.email().max(254).transform((e) => e.toLowerCase()) });
export const magicLinkVerifyInput = z.object({ token: z.string().min(20).max(200) });
export const switchOrganizationInput = z.object({ organizationId: objectId });
