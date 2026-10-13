import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env, isTest } from '../config/env.js';
import { getRedis } from '../config/redis.js';

function store(prefix: string): Options['store'] | undefined {
  const redis = getRedis();
  if (!redis) return undefined; // in-memory store (single instance)
  return new RedisStore({
    prefix: `fluxora:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
}

const handler: Options['handler'] = (req, res) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', requestId: req.id } });
};

/** General API limiter. Built lazily so the Redis store is chosen after Redis connects. */
export function apiLimiter() {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    store: store('api'),
    handler,
  });
}

/** Stricter limiter for sign-in and quote fan-out endpoints (expensive / abuse-prone). */
export function strictLimiter(name: string, limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    store: store(name),
    handler,
  });
}
