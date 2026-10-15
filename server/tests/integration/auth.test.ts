import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDb, connectTestDb, createOrgWithUser, disconnectTestDb, lastMagicLinkToken, login, testApp } from '../helpers.js';
import { MagicLinkToken } from '../../src/modules/auth/magic-link.model.js';
import { Invite, Membership, Organization } from '../../src/modules/organizations/organization.model.js';
import { User } from '../../src/modules/users/user.model.js';

// The Google verifier is the trust boundary; we mock it rather than calling Google.
vi.mock('../../src/modules/auth/google.js', () => ({
  verifyGoogleIdToken: vi.fn(async (token: string) => {
    if (token === 'valid-google-id-token-aaaaaaaa') {
      return { sub: 'google-sub-123', email: 'new.person@example.com', emailVerified: true, name: 'New Person', picture: undefined };
    }
    const { unauthenticated } = await import('../../src/utils/errors.js');
    throw unauthenticated('Google sign-in could not be verified. Please try again.');
  }),
}));

beforeAll(() => connectTestDb('auth'));
afterAll(() => disconnectTestDb());
beforeEach(() => clearDb());

async function csrfAgent() {
  const agent = request.agent(testApp());
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  return { agent, csrf: res.body.data.csrfToken as string };
}

describe('authentication', () => {
  it('exposes sign-in configuration without secrets', async () => {
    const res = await request(testApp()).get('/api/v1/auth/config').expect(200);
    expect(res.body.data).toEqual({ googleClientId: 'test-client-id.apps.googleusercontent.com', emailSignInEnabled: true });
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    await request(testApp()).get('/api/v1/shipments').expect(401);
    await request(testApp()).get('/api/v1/auth/me').expect(401);
  });

  it('requires a CSRF token for state-changing requests (including sign-in)', async () => {
    const agent = request.agent(testApp());
    const res = await agent.post('/api/v1/auth/magic-link').send({ email: 'a@example.com' }).expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    await agent.get('/api/v1/auth/csrf');
    await agent.post('/api/v1/auth/magic-link').set('X-CSRF-Token', 'wrong').send({ email: 'a@example.com' }).expect(403);
  });

  it('signs in with a verified Google ID token and creates a personal workspace', async () => {
    const { agent, csrf } = await csrfAgent();
    const res = await agent.post('/api/v1/auth/google').set('X-CSRF-Token', csrf).send({ credential: 'valid-google-id-token-aaaaaaaa' }).expect(200);
    expect(res.body.data.user.email).toBe('new.person@example.com');
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.headers['set-cookie']?.[0]).toMatch(/fluxora\.sid=.*HttpOnly.*SameSite=Lax/i);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.organization.name).toMatch(/Workspace/);
    expect(await User.countDocuments({ googleSub: 'google-sub-123' })).toBe(1);
  });

  it('rejects an invalid Google token without creating a user', async () => {
    const { agent, csrf } = await csrfAgent();
    await agent.post('/api/v1/auth/google').set('X-CSRF-Token', csrf).send({ credential: 'forged-token-xxxxxxxxxxxxxxxx' }).expect(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('never trusts a client-supplied identity', async () => {
    const { user } = await createOrgWithUser();
    const { agent, csrf } = await csrfAgent();
    // Supplying a userId / email to the Google endpoint without a valid token does nothing.
    await agent.post('/api/v1/auth/google').set('X-CSRF-Token', csrf).send({ credential: 'forged-token-xxxxxxxxxxxxxxxx', userId: String(user._id), email: user.email }).expect(401);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('accepts pending invites at first Google sign-in', async () => {
    const { org, user: admin } = await createOrgWithUser({ orgName: 'Inviting Org' });
    await Invite.create({ organizationId: org._id, email: 'new.person@example.com', role: 'MEMBER', invitedBy: admin._id });
    const { agent, csrf } = await csrfAgent();
    const res = await agent.post('/api/v1/auth/google').set('X-CSRF-Token', csrf).send({ credential: 'valid-google-id-token-aaaaaaaa' }).expect(200);
    expect(res.body.data.organization.name).toBe('Inviting Org');
    expect(res.body.data.role).toBe('MEMBER');
  });

  it('signs out and invalidates the session', async () => {
    const { user } = await createOrgWithUser();
    const s = await login(user.email);
    await s.get('/api/v1/auth/me').expect(200);
    const out = await s.post('/api/v1/auth/logout').expect(204);
    expect(out.headers['set-cookie']?.[0]).toMatch(/fluxora\.sid=;/);
    await s.get('/api/v1/auth/me').expect(401);
    await s.get('/api/v1/shipments').expect(401);
  });

  it('rotates the session id at sign-in (prevents fixation)', async () => {
    const { user } = await createOrgWithUser();
    const agent = request.agent(testApp());
    const pre = await agent.get('/api/v1/auth/csrf');
    const preCookie = pre.headers['set-cookie']?.[0]?.split(';')[0];
    await agent.post('/api/v1/auth/magic-link').set('X-CSRF-Token', pre.body.data.csrfToken).send({ email: user.email }).expect(202);
    const res = await agent.post('/api/v1/auth/magic-link/verify').set('X-CSRF-Token', pre.body.data.csrfToken).send({ token: lastMagicLinkToken(user.email) }).expect(200);
    const postCookie = res.headers['set-cookie']?.[0]?.split(';')[0];
    expect(postCookie).toBeDefined();
    expect(postCookie).not.toBe(preCookie);
    expect(res.body.data.csrfToken).not.toBe(pre.body.data.csrfToken);
  });

  it('revokes access immediately when membership is removed', async () => {
    const { org, user } = await createOrgWithUser();
    const s = await login(user.email);
    await s.get('/api/v1/suppliers').expect(200);
    await Membership.deleteOne({ organizationId: org._id, userId: user._id });
    await s.get('/api/v1/suppliers').expect(401);
  });

  it('switches only to organisations the user belongs to', async () => {
    const { user } = await createOrgWithUser({ orgName: 'First' });
    const second = await Organization.create({ name: 'Second', slug: 'second-x' });
    const foreign = await Organization.create({ name: 'Foreign', slug: 'foreign-x' });
    await Membership.create({ organizationId: second._id, userId: user._id, role: 'MEMBER' });
    const s = await login(user.email);
    const res = await s.post('/api/v1/auth/switch-organization', { organizationId: String(second._id) }).expect(200);
    expect(res.body.data.organization.name).toBe('Second');
    expect(res.body.data.role).toBe('MEMBER');
    await s.agent.post('/api/v1/auth/switch-organization').set('X-CSRF-Token', res.body.data.csrfToken).send({ organizationId: String(foreign._id) }).expect(403);
  });

});

describe('email sign-in link', () => {
  it('signs a new person in exactly once and creates their workspace', async () => {
    const { agent, csrf } = await csrfAgent();
    await agent.post('/api/v1/auth/magic-link').set('X-CSRF-Token', csrf).send({ email: 'New.Person@Example.com' }).expect(202);
    const token = lastMagicLinkToken('new.person@example.com');
    const stored = await MagicLinkToken.findOne({ email: 'new.person@example.com' });
    expect(stored!.tokenHash).not.toContain(token); // only a hash is stored
    const res = await agent.post('/api/v1/auth/magic-link/verify').set('X-CSRF-Token', csrf).send({ token }).expect(200);
    expect(res.body.data).toMatchObject({ user: { email: 'new.person@example.com' }, role: 'ADMIN' });
    expect(await User.findOne({ email: 'new.person@example.com' })).toMatchObject({ emailVerified: true });
    const again = await csrfAgent();
    await again.agent.post('/api/v1/auth/magic-link/verify').set('X-CSRF-Token', again.csrf).send({ token }).expect(401);
  });

  it('rejects expired and unknown links', async () => {
    const { agent, csrf } = await csrfAgent();
    await agent.post('/api/v1/auth/magic-link').set('X-CSRF-Token', csrf).send({ email: 'late@example.com' }).expect(202);
    await MagicLinkToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await agent.post('/api/v1/auth/magic-link/verify').set('X-CSRF-Token', csrf).send({ token: lastMagicLinkToken('late@example.com') }).expect(401);
    await agent.post('/api/v1/auth/magic-link/verify').set('X-CSRF-Token', csrf).send({ token: 'x'.repeat(43) }).expect(401);
    expect(await User.countDocuments()).toBe(0);
  });
});

describe('session probe', () => {
  it('returns null when signed out and the profile when signed in', async () => {
    const anon = await request(testApp()).get('/api/v1/auth/session').expect(200);
    expect(anon.body.data).toBeNull();
    const { user } = await createOrgWithUser();
    const s = await login(user.email);
    const res = await s.get('/api/v1/auth/session').expect(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.csrfToken).toBeTruthy();
  });
});

describe('shared demo workspaces (DEMO_ORG_SLUGS)', () => {
  async function createDemos() {
    const demo = await Organization.create({ name: 'Zara (Demo)', slug: 'demo-shared', isDemo: true });
    await Organization.create({ name: 'Shahi Exports (Demo)', slug: 'demo-other', isDemo: true });
    const host = await User.create({ email: 'ananya@demo.test', name: 'Ananya (fictional)', isDemoUser: true });
    const otherVisitor = await User.create({ email: 'someone.else@example.com', name: 'Someone Else' });
    await Membership.create([{ organizationId: demo._id, userId: host._id, role: 'ADMIN' }, { organizationId: demo._id, userId: otherVisitor._id, role: 'MEMBER' }]);
  }

  it('opens the demos for anyone, as a member, without seeing other visitors', async () => {
    await createDemos();
    const { agent, csrf } = await csrfAgent();
    const res = await agent.post('/api/v1/auth/demo').set('X-CSRF-Token', csrf).expect(200);
    expect(res.body.data.organization.name).toBe('Zara (Demo)'); // the first listed demo opens
    expect(res.body.data.role).toBe('MEMBER');
    expect(res.body.data.organizations.map((o: { name: string }) => o.name).sort()).toEqual(['Shahi Exports (Demo)', 'Zara (Demo)']); // no personal workspace

    const members = (await agent.get('/api/v1/organizations/current/members').expect(200)).body.data;
    expect(members.members.map((m: { email: string }) => m.email).sort()).toEqual(['ananya@demo.test', 'visitor@fluxora-demo.test']);
    expect(members.invites).toEqual([]);

    const again = await csrfAgent();
    await again.agent.post('/api/v1/auth/demo').set('X-CSRF-Token', again.csrf).expect(200);
    expect(await User.countDocuments({ email: 'visitor@fluxora-demo.test' })).toBe(1); // one shared visitor account
  });

  it('signs Google users into their own workspace without adding the demos', async () => {
    await createDemos();
    const { agent, csrf } = await csrfAgent();
    const res = await agent.post('/api/v1/auth/google').set('X-CSRF-Token', csrf).send({ credential: 'valid-google-id-token-aaaaaaaa' }).expect(200);
    expect(res.body.data.organization.name).toBe("New's Workspace");
    expect(res.body.data.organizations.map((o: { name: string }) => o.name)).toEqual(["New's Workspace"]);
  });

  it('reports a missing demo instead of signing in', async () => {
    const { agent, csrf } = await csrfAgent();
    await agent.post('/api/v1/auth/demo').set('X-CSRF-Token', csrf).expect(404);
  });
});
