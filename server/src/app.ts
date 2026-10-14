import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import express, { Router, type RequestHandler } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { isDatabaseReady } from './config/db.js';
import { getRedis } from './config/redis.js';
import { requireAuth } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { alertRouter } from './modules/alerts/alert.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { authRouter, SESSION_COOKIE } from './modules/auth/auth.routes.js';
import { listCarrierIntegrations } from './modules/carriers/carrier.registry.js';
import { organizationRouter } from './modules/organizations/organization.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { purchaseOrderRouter } from './modules/purchase-orders/purchase-order.routes.js';
import { quoteRouter } from './modules/quotes/quote.routes.js';
import { shipmentRouter } from './modules/shipments/shipment.routes.js';
import { supplierRouter } from './modules/suppliers/supplier.routes.js';

export interface AppBundle {
  app: express.Express;
  sessionMiddleware: RequestHandler;
}

export function createApp(): AppBundle {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple'); // flat query strings only — no nested objects / operator injection

  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as express.Request).id ?? crypto.randomUUID(),
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
        serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
      }),
    );
  }
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Google's sign-in popup must be able to report back to this window.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
          frameSrc: ['https://accounts.google.com/gsi/'],
          connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
          imgSrc: ["'self'", 'data:', 'https:'], // Google profile pictures
          workerSrc: ["'self'", 'blob:'], // the 3D globe builds a worker from a blob
        },
      },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '200kb' }));

  const sessionMiddleware = session({
    name: SESSION_COOKIE,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      // Reuse Mongoose's connection (cast: connect-mongo types a slightly different mongodb driver version).
      clientPromise: mongoose.connection.asPromise().then((c) => c.getClient()) as never,
      collectionName: 'sessions',
      ttl: env.SESSION_TTL_HOURS * 3600,
      autoRemove: 'native',
      stringify: false,
    }),
    cookie: {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAMESITE,
      maxAge: env.SESSION_TTL_HOURS * 3600 * 1000,
      path: '/',
    },
  });

  // Health endpoints are unauthenticated, cheap, and don't create sessions.
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() });
  });
  app.get('/api/v1/health/ready', async (_req, res) => {
    const redis = getRedis();
    let redisStatus: 'disabled' | 'ok' | 'error' = 'disabled';
    if (redis) redisStatus = await redis.ping().then(() => 'ok' as const, () => 'error' as const);
    const db = isDatabaseReady();
    const ready = db && redisStatus !== 'error';
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      checks: { mongodb: db ? 'ok' : 'error', redis: redisStatus },
      carriers: listCarrierIntegrations().map((c) => ({ code: c.code, quotes: c.quotes, tracking: c.tracking, booking: c.booking })),
    });
  });

  const api = Router();
  api.use(apiLimiter());
  api.use(sessionMiddleware);
  api.use(sanitizeInput);
  api.use(csrfProtection);
  api.use('/auth', authRouter());

  const secured = Router();
  secured.use(requireAuth);
  secured.use('/organizations', organizationRouter());
  secured.use('/suppliers', supplierRouter());
  secured.use('/products', productRouter());
  secured.use('/purchase-orders', purchaseOrderRouter());
  secured.use('/shipments', shipmentRouter());
  secured.use('/quotes', quoteRouter());
  secured.use('/alerts', alertRouter());
  secured.use('/analytics', analyticsRouter());
  api.use(secured);

  app.use('/api/v1', api);
  serveClient(app);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, sessionMiddleware };
}

/**
 * In production one server serves both the API and the built web app, so they share an
 * origin (session cookie stays SameSite=Lax, no CORS). In development Vite serves the app.
 */
function serveClient(app: express.Express) {
  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (env.NODE_ENV !== 'production' || !existsSync(clientDist)) return;
  app.use('/assets', express.static(`${clientDist}/assets`, { maxAge: '1y', immutable: true }));
  app.use(express.static(clientDist, { index: false }));
  // Any other page URL (e.g. /shipments/123) loads the app, which then routes in the browser.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(`${clientDist}/index.html`);
  });
}
