import crypto from 'node:crypto';
import { Types } from 'mongoose';
import type { AuthContext, OrgRole } from '../../types/express.js';
import { forbidden, unauthenticated } from '../../utils/errors.js';
import { User, type UserDoc } from '../users/user.model.js';
import { Invite, Membership, Organization } from '../organizations/organization.model.js';
import type { VerifiedGoogleIdentity } from './google.js';

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

export async function signInWithGoogle(identity: VerifiedGoogleIdentity) {
  let user = await User.findOne({ googleSub: identity.sub });
  if (!user) {
    // An account with this email but no Google id yet: link it (Google has verified the email).
    user = await User.findOne({ email: identity.email, googleSub: { $exists: false } });
    if (user?.isDemoUser) user = null; // never let a real Google account take over a demo identity
  }
  if (!user) {
    user = new User({ email: identity.email, name: identity.name });
  }
  user.googleSub = identity.sub;
  user.email = identity.email;
  user.emailVerified = identity.emailVerified;
  user.name = identity.name;
  user.avatarUrl = identity.picture;
  user.lastLoginAt = new Date();
  await user.save();

  await acceptPendingInvites(user);
  const organizationId = await chooseOrganization(user);
  user.lastOrganizationId = organizationId;
  await user.save();
  return { user, organizationId };
}

/** Development-only sign-in for seeded demo users. Guarded by AUTH_DEV_LOGIN_ENABLED. */
export async function signInDemoUser(email: string) {
  const user = await User.findOne({ email: email.toLowerCase(), isDemoUser: true });
  if (!user) throw unauthenticated('Unknown demo user. Run `npm run seed` to create demo accounts.');
  user.lastLoginAt = new Date();
  const organizationId = await chooseOrganization(user);
  user.lastOrganizationId = organizationId;
  await user.save();
  return { user, organizationId };
}

export async function listDemoUsers() {
  const users = await User.find({ isDemoUser: true }).select('email name').sort({ email: 1 }).lean();
  const memberships = await Membership.find({ userId: { $in: users.map((u) => u._id) } }).lean();
  return users.map((u) => ({
    email: u.email,
    name: u.name,
    role: memberships.find((m) => m.userId.equals(u._id))?.role ?? 'MEMBER',
  }));
}

export async function switchOrganization(userId: Types.ObjectId, organizationId: string) {
  const membership = await Membership.findOne({ userId, organizationId }).lean();
  if (!membership) throw forbidden('You are not a member of that organization');
  await User.updateOne({ _id: userId }, { $set: { lastOrganizationId: membership.organizationId } });
  return membership.organizationId;
}

export async function getSessionProfile(ctx: AuthContext) {
  const [user, org, memberships] = await Promise.all([
    User.findById(ctx.userId).select('email name avatarUrl isDemoUser').lean(),
    Organization.findById(ctx.organizationId).select('name slug isDemo settings').lean(),
    Membership.find({ userId: ctx.userId }).lean(),
  ]);
  if (!user || !org) throw unauthenticated();
  const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organizationId) } })
    .select('name')
    .lean();
  return {
    user: { id: String(user._id), email: user.email, name: user.name, avatarUrl: user.avatarUrl ?? null, isDemoUser: user.isDemoUser },
    organization: { id: String(org._id), name: org.name, slug: org.slug, isDemo: org.isDemo, settings: org.settings },
    role: ctx.role,
    organizations: memberships.map((m) => ({
      id: String(m.organizationId),
      name: orgs.find((o) => o._id.equals(m.organizationId))?.name ?? 'Unknown',
      role: m.role,
    })),
  };
}
