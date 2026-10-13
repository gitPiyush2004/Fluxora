import { Router } from 'express';
import { actorOf, orgId, requireRole } from '../../middleware/auth.js';
import { idParams, parse } from '../../utils/validate.js';
import { listRecentEvents } from '../tracking/tracking.service.js';
import { alertListQuery, feedQuery, resolveInput } from './alert.schemas.js';
import { acknowledgeAlert, alertSummary, listAlerts, resolveAlert, runExceptionScan } from './alert.service.js';

export function alertRouter(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const { items, meta } = await listAlerts(orgId(req), parse(alertListQuery, req.query));
    res.json({ data: items, meta });
  });

  router.get('/summary', async (req, res) => {
    res.json({ data: await alertSummary(orgId(req)) });
  });

  /** Organisation-wide recent tracking events (live feed on the Tracking page). */
  router.get('/feed/events', async (req, res) => {
    const { limit } = parse(feedQuery, req.query);
    res.json({ data: await listRecentEvents(orgId(req), limit) });
  });

  /** Runs the exception scan now instead of waiting for the background job. */
  router.post('/scan', requireRole('ADMIN'), async (_req, res) => {
    res.json({ data: await runExceptionScan() });
  });

  router.post('/:id/acknowledge', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await acknowledgeAlert(orgId(req), id, actorOf(req)) });
  });

  router.post('/:id/resolve', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { note } = parse(resolveInput, req.body ?? {});
    res.json({ data: await resolveAlert(orgId(req), id, actorOf(req), note) });
  });

  return router;
}
