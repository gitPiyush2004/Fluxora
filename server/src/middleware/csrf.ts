import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Returns the session's CSRF token, creating one if needed (synchronizer-token pattern). */
export function ensureCsrfToken(req: Request): string {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Every state-changing request must echo the session's CSRF token in the
 * `X-CSRF-Token` header. Combined with SameSite cookies and a strict CORS
 * allowlist this blocks cross-site request forgery.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || !provided || !safeEqual(expected, provided)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token. Refresh the page and try again.'));
  }
  next();
}
