import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ctx, requireAuth } from '../../middleware/auth.js';
import { ensureCsrfToken } from '../../middleware/csrf.js';
import { strictLimiter } from '../../middleware/rate-limit.js';
import { AppError, forbidden } from '../../utils/errors.js';
import { emailEnabled } from '../../utils/mailer.js';
import { parse } from '../../utils/validate.js';
import { googleSignInInput, magicLinkInput, magicLinkVerifyInput, switchOrganizationInput } from './auth.schemas.js';
import { verifyGoogleIdToken } from './google.js';
import {
  getSessionProfile,
  resolveAuthContext,
  sendMagicLink,
  signInWithGoogle,
  signInWithMagicLink,
  startDemoSession,
  switchOrganization,
} from './auth.service.js';

export const SESSION_COOKIE = 'fluxora.sid';

/** Regenerates the session id (prevents fixation), binds identity and rotates the CSRF token. */
function establishSession(req: Request, userId: Types.ObjectId, organizationId: Types.ObjectId): Promise<string> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = String(userId);
      req.session.organizationId = String(organizationId);
      const csrfToken = ensureCsrfToken(req);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve(csrfToken)));
    });
  });
}

async function respondWithProfile(req: Request, res: Response, userId: Types.ObjectId, organizationId: Types.ObjectId) {
  const csrfToken = await establishSession(req, userId, organizationId);
  const authCtx = await resolveAuthContext(String(userId), String(organizationId));
  if (!authCtx) throw new AppError(500, 'INTERNAL_ERROR', 'Session could not be established');
  res.json({ data: { ...(await getSessionProfile(authCtx)), csrfToken } });
}

export function authRouter(): Router {
  const router = Router();
  const loginLimiter = strictLimiter('login', 20);

  /** Public: tells the client which sign-in methods are available. */
  router.get('/config', (_req, res) => {
    res.json({ data: { googleClientId: env.GOOGLE_CLIENT_ID ?? null, emailSignInEnabled: emailEnabled() } });
  });

  /** Public: issues (or returns) the CSRF token bound to the current session. */
  router.get('/csrf', (req, res) => {
    res.json({ data: { csrfToken: ensureCsrfToken(req) } });
  });

  router.post('/google', loginLimiter, async (req, res) => {
    const { credential } = parse(googleSignInInput, req.body);
    const identity = await verifyGoogleIdToken(credential);
    const { user, organizationId } = await signInWithGoogle(identity);
    logger.info({ userId: String(user._id) }, 'User signed in with Google');
    await respondWithProfile(req, res, user._id, organizationId);
  });

  /** Emails a one-time sign-in link. Always 202, so the response never reveals whether an account exists. */
  router.post('/magic-link', loginLimiter, async (req, res) => {
    if (!emailEnabled()) throw forbidden('Email sign-in is not configured on this server');
    const { email } = parse(magicLinkInput, req.body);
    await sendMagicLink(email);
    res.status(202).json({ data: { sent: true } });
  });

  router.post('/magic-link/verify', loginLimiter, async (req, res) => {
    const { token } = parse(magicLinkVerifyInput, req.body);
    const { user, organizationId } = await signInWithMagicLink(token);
    logger.info({ userId: String(user._id) }, 'User signed in with an email link');
    await respondWithProfile(req, res, user._id, organizationId);
  });

  /** Public: opens the shared demo workspaces as the "Demo visitor" (no sign-in needed). */
  router.post('/demo', loginLimiter, async (req, res) => {
    const { user, organizationId } = await startDemoSession();
    logger.info('Demo session started');
    await respondWithProfile(req, res, user._id, organizationId);
  });

  /** Like /me but never 401s: returns { data: null } when signed out (used on app start). */
  router.get('/session', async (req, res) => {
    const { userId, organizationId } = req.session ?? {};
    const authCtx = userId && organizationId ? await resolveAuthContext(userId, organizationId) : null;
    if (!authCtx) return void res.json({ data: null });
    res.json({ data: { ...(await getSessionProfile(authCtx)), csrfToken: ensureCsrfToken(req) } });
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ data: { ...(await getSessionProfile(ctx(req))), csrfToken: ensureCsrfToken(req) } });
  });

  router.post('/switch-organization', requireAuth, async (req, res) => {
    const { organizationId } = parse(switchOrganizationInput, req.body);
    const orgId = await switchOrganization(ctx(req).userId, organizationId);
    await respondWithProfile(req, res, ctx(req).userId, orgId);
  });

  router.post('/logout', (req, res, next) => {
    const cookieOpts = { path: '/', httpOnly: true, sameSite: env.COOKIE_SAMESITE, secure: env.COOKIE_SECURE } as const;
    if (!req.session) {
      res.clearCookie(SESSION_COOKIE, cookieOpts);
      return void res.status(204).end();
    }
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie(SESSION_COOKIE, cookieOpts);
      res.status(204).end();
    });
  });

  return router;
}
