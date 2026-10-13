import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDb, connectTestDb, createOrgWithUser, disconnectTestDb, login, testApp } from '../helpers.js';
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
    expect(res.body.data).toMatchObject({ googleClientId: 'test-client-id.apps.googleusercontent.com', devLoginEnabled: true });
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    await request(testApp()).get('/api/v1/shipments').expect(401);
    await request(testApp()).get('/api/v1/auth/me').expect(401);
  });

  it('requires a CSRF token for state-changing requests (including sign-in)', async () => {
    const { user } = await createOrgWithUser();
    const agent = request.agent(testApp());
    const res = await agent.post('/api/v1/auth/dev-login').send({ email: user.email }).expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    await agent.get('/api/v1/auth/csrf');
    await agent.post('/api/v1/auth/dev-login').set('X-CSRF-Token', 'wrong').send({ email: user.email }).expect(403);
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
    const res = await agent.post('/api/v1/auth/dev-login').set('X-CSRF-Token', pre.body.data.csrfToken).send({ email: user.email }).expect(200);
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

  it('rejects dev login for non-demo users', async () => {
    await User.create({ email: 'real@example.com', name: 'Real' });
    const { agent, csrf } = await csrfAgent();
    await agent.post('/api/v1/auth/dev-login').set('X-CSRF-Token', csrf).send({ email: 'real@example.com' }).expect(401);
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
