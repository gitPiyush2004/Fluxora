import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { AuthContext, OrgRole } from '../../types/express.js';
import { forbidden, notFound, unauthenticated } from '../../utils/errors.js';
import { sendMail } from '../../utils/mailer.js';
import { User, type UserDoc } from '../users/user.model.js';
import { Invite, Membership, Organization } from '../organizations/organization.model.js';
import type { VerifiedGoogleIdentity } from './google.js';
import { MagicLinkToken } from './magic-link.model.js';

export async function resolveAuthContext(userId: string, organizationId: string): Promise<AuthContext | null> {
  if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(organizationId)) return null;
  const [user, membership] = await Promise.all([
    User.findById(userId).select('email name').lean(),
    Membership.findOne({ userId, organizationId }).select('role').lean(),
  ]);
  if (!user || !membership) return null;
  return {
    userId: new Types.ObjectId(userId),
    organizationId: new Types.ObjectId(organizationId),
    role: membership.role as OrgRole,
    email: user.email,
    name: user.name,
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'org';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function createOrganizationFor(user: UserDoc, name: string) {
  const org = await Organization.create({ name, slug: slugify(name), createdBy: user._id });
  await Membership.create({ organizationId: org._id, userId: user._id, role: 'ADMIN' });
  return org;
}

/** Converts pending invites for this email into memberships. */
async function acceptPendingInvites(user: UserDoc): Promise<void> {
  const invites = await Invite.find({ email: user.email, status: 'PENDING' });
  for (const invite of invites) {
    await Membership.updateOne(
      { organizationId: invite.organizationId, userId: user._id },
      { $setOnInsert: { role: invite.role } },
      { upsert: true },
    );
    invite.status = 'ACCEPTED';
    invite.acceptedAt = new Date();
    await invite.save();
  }
}

/** Picks the organization to activate after sign-in, creating a personal workspace if needed. */
async function chooseOrganization(user: UserDoc): Promise<Types.ObjectId> {
  const memberships = await Membership.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
  if (memberships.length === 0) {
    const org = await createOrganizationFor(user, `${user.name.split(' ')[0]}'s Workspace`);
    return org._id;
  }
  const preferred = memberships.find((m) => user.lastOrganizationId && m.organizationId.equals(user.lastOrganizationId));
  return (preferred ?? memberships[0]!).organizationId;
}

/** Shared last step of every sign-in method: accept invites and pick the active organization. */
async function finishSignIn(user: UserDoc) {
  user.lastLoginAt = new Date();
  await user.save();
  await acceptPendingInvites(user);
  const organizationId = await chooseOrganization(user); // creates a personal workspace for new users
  user.lastOrganizationId = organizationId;
  await user.save();
  return { user, organizationId };
}

const DEMO_VISITOR_EMAIL = 'visitor@fluxora-demo.test';

/**
 * Public "Demo" button: signs in as one shared "Demo visitor" account that is a member of every
 * shared demo workspace (DEMO_ORG_SLUGS) and opens the first one. It has no personal workspace,
 * and as a member it cannot approve purchase orders or change settings.
 */
export async function startDemoSession() {
  const demos = await Organization.find({ slug: { $in: env.DEMO_ORG_SLUGS } }).select('_id slug').lean();
  const first = env.DEMO_ORG_SLUGS.map((slug) => demos.find((d) => d.slug === slug)).find(Boolean);
  if (!first) throw notFound('Demo workspace');
  const user = (await User.findOne({ email: DEMO_VISITOR_EMAIL })) ?? new User({ email: DEMO_VISITOR_EMAIL, name: 'Demo visitor' });
  user.lastLoginAt = new Date();
  user.lastOrganizationId = first._id;
  await user.save();
  for (const demo of demos) {
    await Membership.updateOne({ organizationId: demo._id, userId: user._id }, { $setOnInsert: { role: 'MEMBER' } }, { upsert: true });
  }
  return { user, organizationId: first._id };
}

export async function signInWithGoogle(identity: VerifiedGoogleIdentity) {
  // Match by Google id first; otherwise link an existing account with the same (Google-verified) email.
  const user =
    (await User.findOne({ googleSub: identity.sub })) ??
    (await User.findOne({ email: identity.email, googleSub: { $exists: false } })) ??
    new User({ email: identity.email, name: identity.name });
  user.googleSub = identity.sub;
  user.email = identity.email;
  user.emailVerified = identity.emailVerified;
  user.name = identity.name;
  user.avatarUrl = identity.picture;
  return finishSignIn(user);
}

const MAGIC_LINK_TTL_MS = 15 * 60_000;
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Emails a one-time sign-in link. The response is the same whether or not the address has an account. */
export async function sendMagicLink(email: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  await MagicLinkToken.create({ email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) });
  const link = `${env.CLIENT_URL.replace(/\/$/, '')}/auth/verify?token=${token}`;
  await sendMail({
    to: email,
    subject: 'Your Fluxora sign-in link',
    text: `Sign in to Fluxora:\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't request it, ignore this email.`,
    html: `<p>Click to sign in to Fluxora:</p><p><a href="${link}">Sign in to Fluxora</a></p><p>The link works once and expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
  });
}

/** Consumes a sign-in link (atomically, so it works only once) and signs the user in, creating the account if new. */
export async function signInWithMagicLink(token: string) {
  const record = await MagicLinkToken.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!record) throw unauthenticated('This sign-in link is invalid, expired or already used. Request a new one.');
  const user = (await User.findOne({ email: record.email })) ?? new User({ email: record.email, name: record.email.split('@')[0] });
  user.emailVerified = true;
  return finishSignIn(user);
}

export async function switchOrganization(userId: Types.ObjectId, organizationId: string) {
  const membership = await Membership.findOne({ userId, organizationId }).lean();
  if (!membership) throw forbidden('You are not a member of that organization');
  await User.updateOne({ _id: userId }, { $set: { lastOrganizationId: membership.organizationId } });
  return membership.organizationId;
}

export async function getSessionProfile(ctx: AuthContext) {
  const [user, org, memberships] = await Promise.all([
    User.findById(ctx.userId).select('email name avatarUrl').lean(),
    Organization.findById(ctx.organizationId).select('name slug isDemo settings').lean(),
    Membership.find({ userId: ctx.userId }).lean(),
  ]);
  if (!user || !org) throw unauthenticated();
  const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organizationId) } })
    .select('name')
    .lean();
  return {
    user: { id: String(user._id), email: user.email, name: user.name, avatarUrl: user.avatarUrl ?? null },
    organization: { id: String(org._id), name: org.name, slug: org.slug, isDemo: org.isDemo, settings: org.settings },
    role: ctx.role,
    organizations: memberships.map((m) => ({
      id: String(m.organizationId),
      name: orgs.find((o) => o._id.equals(m.organizationId))?.name ?? 'Unknown',
      role: m.role,
    })),
  };
}
