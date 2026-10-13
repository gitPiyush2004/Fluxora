import { z } from 'zod';
import { objectId } from '../../utils/validate.js';

/** The ID token (JWT) the Google sign-in button gives the browser. */
export const googleSignInInput = z.object({ credential: z.string().min(20).max(8192) });
export const demoSignInInput = z.object({ email: z.email() });
export const switchOrganizationInput = z.object({ organizationId: objectId });
