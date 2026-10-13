import { Router, type Request } from 'express';
import { orgId } from '../../middleware/auth.js';
import { DAY_MS } from '../../utils/dates.js';
import { parse } from '../../utils/validate.js';
import { analyticsQuery } from './analytics.schemas.js';
import { carriers, dashboard, freight, overview, purchaseOrders, savings, type AnalyticsFilters } from './analytics.service.js';

/** Reads the filters; the period defaults to the last 365 days and "to" includes that whole day. */
function filters(req: Request): AnalyticsFilters {
  const q = parse(analyticsQuery, req.query);
  const to = q.to ? new Date(q.to) : new Date();
  to.setUTCHours(23, 59, 59, 999);
  const from = q.from ?? new Date(to.getTime() - 365 * DAY_MS);
  return { from, to, carrier: q.carrier, status: q.status, poStatus: q.poStatus };
}

export function analyticsRouter(): Router {
  const router = Router();
  router.get('/overview', async (req, res) => res.json({ data: await overview(orgId(req), filters(req)) }));
  router.get('/freight', async (req, res) => res.json({ data: await freight(orgId(req), filters(req)) }));
  router.get('/carriers', async (req, res) => res.json({ data: await carriers(orgId(req), filters(req)) }));
  router.get('/purchase-orders', async (req, res) => res.json({ data: await purchaseOrders(orgId(req), filters(req)) }));
  router.get('/savings', async (req, res) => res.json({ data: await savings(orgId(req), filters(req)) }));
  router.get('/dashboard', async (req, res) => res.json({ data: await dashboard(orgId(req)) }));
  return router;
}
