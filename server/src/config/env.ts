/* eslint-disable no-console -- logger depends on validated env, so startup errors print directly */
import dotenv from 'dotenv';
import { z } from 'zod';

// server/.env takes precedence over a repository-root .env (used by docker compose).
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: ['.env', '../.env'], quiet: true });

/**
 * Environment configuration, validated once at startup.
 *
 * - Required: MONGODB_URI, SESSION_SECRET, CLIENT_URL.
 * - Optional: Google, Redis and carrier credentials. Features that depend on them
 *   degrade gracefully (and say so in /api/v1/health and the Settings page).
 * - Email sign-in: RESEND_API_KEY + EMAIL_FROM. Without a key, only Google sign-in is offered.
 */
const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  CLIENT_URL: z.url().default('http://localhost:5180'),
  SERVER_URL: z.url().default('http://localhost:4100'),
  /** Comma-separated list of allowed browser origins. Defaults to CLIENT_URL. */
  CORS_ORIGIN: optionalString,

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  /** 'lax' for same-site deployments (recommended); 'none' when API and client are on different sites. */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: bool(false),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  GOOGLE_CLIENT_ID: optionalString,

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default('Fluxora <onboarding@resend.dev>'),

  REDIS_URL: optionalString,

  QUOTE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),
  CARRIER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  CARRIER_SIMULATION_ENABLED: bool(true),

  JOBS_ENABLED: bool(true),
  EXCEPTION_SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(300),
  TRACKING_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(120),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // ---- Carrier credentials (all optional) ----
  DHL_TRACKING_API_KEY: optionalString,
  DHL_TRACKING_BASE_URL: z.url().default('https://api-eu.dhl.com'),
  DHL_EXPRESS_USERNAME: optionalString,
  DHL_EXPRESS_PASSWORD: optionalString,
  DHL_EXPRESS_ACCOUNT_NUMBER: optionalString,
  DHL_EXPRESS_BASE_URL: z.url().default('https://express.api.dhl.com/mydhlapi/test'),

  FEDEX_CLIENT_ID: optionalString,
  FEDEX_CLIENT_SECRET: optionalString,
  FEDEX_ACCOUNT_NUMBER: optionalString,
  FEDEX_BASE_URL: z.url().default('https://apis-sandbox.fedex.com'),
  UPS_CLIENT_ID: optionalString,
  UPS_CLIENT_SECRET: optionalString,
  UPS_ACCOUNT_NUMBER: optionalString,
  UPS_BASE_URL: z.url().default('https://wwwcie.ups.com'),

  DSV_USERNAME: optionalString,
  DSV_PASSWORD: optionalString,
  DSV_TOKEN_SUBSCRIPTION_KEY: optionalString,
  DSV_TRACKING_SUBSCRIPTION_KEY: optionalString,
  DSV_BASE_URL: z.url().default('https://api.dsv.com/my-demo'),
  KN_CLIENT_ID: optionalString,
  KN_CLIENT_SECRET: optionalString,
  CEVA_API_KEY: optionalString,
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // Logger depends on env, so print directly.
    console.error(`\n[fluxora] Invalid environment configuration:\n${lines.join('\n')}\n\nSee .env.example for the full list of variables.\n`);
    process.exit(1);
  }
  const env = parsed.data;
  if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
    console.error('[fluxora] COOKIE_SAMESITE=none requires COOKIE_SECURE=true.');
    process.exit(1);
  }
  return env;
}

export const env = loadEnv();

export const corsOrigins = (env.CORS_ORIGIN ?? env.CLIENT_URL)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
