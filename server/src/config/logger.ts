import { pino } from 'pino';
import { env, isProd } from './env.js';

/** pino-pretty is a dev dependency; only use it when installed (never in production images). */
function prettyAvailable(): boolean {
  try {
    import.meta.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}
const usePretty = !isProd && env.NODE_ENV !== 'test' && prettyAvailable();

/**
 * Structured logger. Secrets are redacted by path so they never reach log sinks
 * even if a request/response object is logged wholesale.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.credential',
      '*.idToken',
      '*.password',
      '*.clientSecret',
      '*.apiKey',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
  transport: usePretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
});
