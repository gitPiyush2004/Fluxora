import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Redis is optional. When REDIS_URL is not configured the application uses
 * in-process fallbacks (memory cache, in-memory rate limiting, interval jobs),
 * which are fine for single-instance local development but not for horizontal scaling.
 */
let client: Redis | null = null;

export function getRedis(): Redis | null {
  return client;
}

export async function connectRedis(): Promise<Redis | null> {
  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL not set — using in-memory cache, rate limiting and job scheduling (single instance only)');
    return null;
  }
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  try {
    await redis.connect();
    logger.info('Redis connected');
    client = redis;
    return redis;
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Redis connection failed — continuing with in-memory fallbacks');
    redis.disconnect();
    return null;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = null;
  }
}
