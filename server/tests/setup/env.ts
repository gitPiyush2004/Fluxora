import { inject } from 'vitest';

// Must run before any application module reads process.env.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = `${inject('mongoUri').replace(/\/$/, '')}/fluxora-test`;
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-123456';
process.env.CLIENT_URL = 'http://localhost:5180';
process.env.CARRIER_SIMULATION_ENABLED = 'true';
process.env.JOBS_ENABLED = 'false';
process.env.QUOTE_CACHE_TTL_SECONDS = '0';
process.env.CARRIER_TIMEOUT_MS = '500';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.RESEND_API_KEY = 'test-key'; // outgoing mail is captured in tests (see helpers.ts)
for (const k of ['REDIS_URL', 'DHL_TRACKING_API_KEY', 'DHL_EXPRESS_USERNAME', 'FEDEX_CLIENT_ID']) delete process.env[k];
