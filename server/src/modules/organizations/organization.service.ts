import type { Types } from 'mongoose';
import { conflict, notFound } from '../../utils/errors.js';
import { recordAudit, type AuditActor } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import { Invite, Membership, Organization } from './organization.model.js';
import type { InviteInput, UpdateOrganizationInput } from './organization.schemas.js';

type OrgRole = 'ADMIN' | 'MEMBER';

export async function getOrganization(organizationId: Types.ObjectId) {
  const org = await Organization.findById(organizationId).lean();
  if (!org) throw notFound('Organization');
  return org;
}

export async function updateOrganization(organizationId: Types.ObjectId, actor: AuditActor, input: UpdateOrganizationInput) {
  const org = await Organization.findById(organizationId);
  if (!org) throw notFound('Organization');
  if (input.name) org.name = input.name;
  if (input.settings) {
    // Deep-merge so a partial update never wipes nested defaults.
    const current = org.toObject().settings;
    const s = input.settings;
    org.set('settings', {
      ...current,
      ...s,
      exceptionRules: {
        ...current.exceptionRules,
        ...s.exceptionRules,
        stuckThresholdsHours: { ...current.exceptionRules?.stuckThresholdsHours, ...s.exceptionRules?.stuckThresholdsHours },
      },
    });
  }
  await org.save();
  await recordAudit({
    organizationId, entityType: 'ORGANIZATION', entityId: org._id, action: 'SETTINGS_UPDATED',
    summary: 'Organization settings updated', actor, details: input,
  });
  return org;
}

/** Members (with their user profile) and pending invites. */
export async function listMembers(organizationId: Types.ObjectId) {
  const [memberships, invites] = await Promise.all([
    Membership.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    Invite.find({ organizationId, status: 'PENDING' }).sort({ createdAt: -1 }).lean(),
  ]);
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('email name avatarUrl lastLoginAt').lean();
  return {
    members: memberships.map((m) => {
      const u = users.find((x) => x._id.equals(m.userId));
      return { userId: String(m.userId), role: m.role, joinedAt: m.createdAt, email: u?.email, name: u?.name, avatarUrl: u?.avatarUrl, lastLoginAt: u?.lastLoginAt };
    }),
    invites: invites.map((i) => ({ id: String(i._id), email: i.email, role: i.role, createdAt: i.createdAt })),
  };
}

/**
 * Invites someone by email. If they already have a Fluxora account they become a member
 * immediately; otherwise the invite is accepted at their first Google sign-in.
 */
export async function inviteMember(organizationId: Types.ObjectId, actor: AuditActor, input: InviteInput) {
  const existingUser = await User.findOne({ email: input.email }).select('_id').lean();
  if (existingUser && (await Membership.exists({ organizationId, userId: existingUser._id }))) {
    throw conflict('That person is already a member of this organization');
  }
  const invite = await Invite.create({ organizationId, email: input.email, role: input.role, invitedBy: actor.userId });
  if (existingUser) {
    await Membership.create({ organizationId, userId: existingUser._id, role: input.role });
    invite.status = 'ACCEPTED';
    invite.acceptedAt = new Date();
    await invite.save();
  }
  await recordAudit({
    organizationId, entityType: 'MEMBERSHIP', entityId: invite._id, action: 'INVITED',
    summary: `Invited ${input.email} as ${input.role}`, actor,
  });
  return { id: String(invite._id), email: invite.email, role: invite.role, status: invite.status };
}

export async function revokeInvite(organizationId: Types.ObjectId, inviteId: string) {
  const invite = await Invite.findOneAndUpdate(
    { _id: inviteId, organizationId, status: 'PENDING' },
    { $set: { status: 'REVOKED' } },
    { returnDocument: 'after' },
  );
  if (!invite) throw notFound('Invite');
}

/** An organization must always keep at least one admin. */
async function assertNotLastAdmin(organizationId: Types.ObjectId, userId: string) {
  const otherAdmins = await Membership.countDocuments({ organizationId, role: 'ADMIN', userId: { $ne: userId } });
  if (otherAdmins === 0) throw conflict('An organization must keep at least one admin');
}

export async function changeMemberRole(organizationId: Types.ObjectId, actor: AuditActor, userId: string, role: OrgRole) {
  const membership = await Membership.findOne({ organizationId, userId });
  if (!membership) throw notFound('Member');
  if (membership.role === 'ADMIN' && role !== 'ADMIN') await assertNotLastAdmin(organizationId, userId);
  membership.role = role;
  await membership.save();
  await recordAudit({
    organizationId, entityType: 'MEMBERSHIP', entityId: membership._id, action: 'ROLE_CHANGED',
    summary: `Changed role to ${role}`, actor, details: { userId },
  });
  return { userId, role };
}

export async function removeMember(organizationId: Types.ObjectId, actor: AuditActor, userId: string) {
  const membership = await Membership.findOne({ organizationId, userId });
  if (!membership) throw notFound('Member');
  if (membership.role === 'ADMIN') await assertNotLastAdmin(organizationId, userId);
  await membership.deleteOne();
  await recordAudit({
    organizationId, entityType: 'MEMBERSHIP', entityId: membership._id, action: 'REMOVED',
    summary: 'Member removed', actor, details: { userId },
  });
}
