import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import type { AuthContext, OrgRole } from '../types/express.js';
import type { AuditActor } from '../modules/audit/audit.model.js';
import { forbidden, unauthenticated } from '../utils/errors.js';
import { resolveAuthContext } from '../modules/auth/auth.service.js';

/**
 * Loads the authenticated user + active organization membership from the server-side
 * session. Membership is re-checked on every request so that removing a member or
 * changing their role takes effect immediately.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const { userId, organizationId } = req.session ?? {};
  if (!userId || !organizationId) return next(unauthenticated());
  const ctx = await resolveAuthContext(userId, organizationId);
  if (!ctx) {
    req.session.destroy(() => undefined);
    return next(unauthenticated('Your session is no longer valid. Please sign in again.'));
  }
  req.auth = ctx;
  next();
}

export function requireRole(...roles: OrgRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthenticated());
    if (!roles.includes(req.auth.role)) return next(forbidden(`This action requires the ${roles.join(' or ')} role`));
    next();
  };
}

/** Typed accessor for controllers mounted behind requireAuth. */
export function ctx(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

export function orgId(req: Request): Types.ObjectId {
  return ctx(req).organizationId;
}

/** The signed-in user, as recorded in audit logs and event history. */
export function actorOf(req: Request): AuditActor {
  const { userId, name } = ctx(req);
  return { userId, name };
}
