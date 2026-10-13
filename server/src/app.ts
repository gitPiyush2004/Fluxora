import crypto from 'node:crypto';
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
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
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
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, sessionMiddleware };
}
