import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Membership, Organization } from '../src/modules/organizations/organization.model.js';
import { User } from '../src/modules/users/user.model.js';

let dbIndex = 0;

/** Each test file gets its own database on the shared in-memory server. */
export async function connectTestDb(name: string) {
  const base = process.env.MONGODB_URI!.replace(/\/[^/]*$/, '');
  await mongoose.connect(`${base}/fluxora-test-${name}-${process.pid}-${dbIndex++}`);
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).createIndexes()));
}

export async function clearDb() {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
}

let appBundle: ReturnType<typeof createApp> | null = null;
export function testApp() {
  appBundle ??= createApp();
  return appBundle.app;
}

export async function createOrgWithUser(opts: { orgName?: string; email?: string; role?: 'ADMIN' | 'MEMBER' } = {}) {
  const org = await Organization.create({ name: opts.orgName ?? 'Test Org', slug: `test-${new Types.ObjectId().toHexString()}` });
  const user = await User.create({ email: opts.email ?? `user-${new Types.ObjectId().toHexString()}@fluxora.test`, name: 'Test User', isDemoUser: true });
  await Membership.create({ organizationId: org._id, userId: user._id, role: opts.role ?? 'ADMIN' });
  return { org, user };
}

export async function addUserToOrg(organizationId: Types.ObjectId, role: 'ADMIN' | 'MEMBER') {
  const user = await User.create({ email: `user-${new Types.ObjectId().toHexString()}@fluxora.test`, name: `${role} User`, isDemoUser: true });
  await Membership.create({ organizationId, userId: user._id, role });
  return user;
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object, headers?: Record<string, string>) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
}

/** Signs in through the real auth endpoints (CSRF + dev login) and returns a cookie-holding agent. */
export async function login(email: string): Promise<Session> {
  const agent = request.agent(testApp());
  const csrfRes = await agent.get('/api/v1/auth/csrf').expect(200);
  const res = await agent.post('/api/v1/auth/dev-login').set('X-CSRF-Token', csrfRes.body.data.csrfToken).send({ email }).expect(200);
  const csrf: string = res.body.data.csrfToken;
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: (url, body = {}, headers = {}) => {
      let r = agent.post(url).set('X-CSRF-Token', csrf);
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      return r.send(body);
    },
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrf),
  };
}

export const sampleSpec = {
  origin: { city: 'Shenzhen', country: 'CN', postalCode: '518000' },
  destination: { city: 'Newark', country: 'US', postalCode: '07114' },
  shipmentType: 'BOX',
  packageCount: 2,
  actualWeightKg: 30,
  lengthCm: 50,
  widthCm: 40,
  heightCm: 40,
  insuranceRequired: false,
  specialHandling: [],
  currency: 'USD',
};
