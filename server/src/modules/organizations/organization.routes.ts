import { Router } from 'express';
import { actorOf, ctx, orgId, requireRole } from '../../middleware/auth.js';
import { idParams, parse } from '../../utils/validate.js';
import { listCarrierIntegrations } from '../carriers/carrier.registry.js';
import { inviteInput, memberParams, roleInput, updateOrganizationInput } from './organization.schemas.js';
import {
  changeMemberRole,
  getOrganization,
  inviteMember,
  listMembers,
  removeMember,
  revokeInvite,
  updateOrganization,
} from './organization.service.js';

export function organizationRouter(): Router {
  const router = Router();
  const adminOnly = requireRole('ADMIN');

  router.get('/current', async (req, res) => {
    res.json({ data: await getOrganization(orgId(req)) });
  });

  router.patch('/current', adminOnly, async (req, res) => {
    res.json({ data: await updateOrganization(orgId(req), actorOf(req), parse(updateOrganizationInput, req.body)) });
  });

  router.get('/current/carriers', (_req, res) => {
    res.json({ data: listCarrierIntegrations() });
  });

  router.get('/current/members', async (req, res) => {
    const { userId, role } = ctx(req);
    res.json({ data: await listMembers(orgId(req), { userId, role }) });
  });

  router.post('/current/invites', adminOnly, async (req, res) => {
    res.status(201).json({ data: await inviteMember(orgId(req), actorOf(req), parse(inviteInput, req.body)) });
  });

  router.delete('/current/invites/:id', adminOnly, async (req, res) => {
    const { id } = parse(idParams, req.params);
    await revokeInvite(orgId(req), id);
    res.status(204).end();
  });

  router.patch('/current/members/:userId', adminOnly, async (req, res) => {
    const { userId } = parse(memberParams, req.params);
    const { role } = parse(roleInput, req.body);
    res.json({ data: await changeMemberRole(orgId(req), actorOf(req), userId, role) });
  });

  router.delete('/current/members/:userId', adminOnly, async (req, res) => {
    const { userId } = parse(memberParams, req.params);
    await removeMember(orgId(req), actorOf(req), userId);
    res.status(204).end();
  });

  return router;
}
