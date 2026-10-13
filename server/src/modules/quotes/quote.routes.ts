import { Router } from 'express';
import { ctx, orgId } from '../../middleware/auth.js';
import { strictLimiter } from '../../middleware/rate-limit.js';
import { idParams, parse } from '../../utils/validate.js';
import { calculateBillableWeight } from '../carriers/billable-weight.js';
import { listCarrierIntegrations } from '../carriers/carrier.registry.js';
import { billableWeightInput, compareInput, rankInput } from './quote.schemas.js';
import { buildQuoteResponse, requestQuotes } from './quote.service.js';

export function quoteRouter(): Router {
  const router = Router();

  router.get('/carriers', (_req, res) => {
    res.json({ data: listCarrierIntegrations() });
  });

  /** Stand-alone comparison (Compare Carriers page) — not yet attached to a shipment. */
  router.post('/compare', strictLimiter('quotes', 30), async (req, res) => {
    const { spec, weights, carriers } = parse(compareInput, req.body);
    const result = await requestQuotes({ organizationId: orgId(req), userId: ctx(req).userId, spec, weights, carriers });
    res.status(201).json({ data: result });
  });

  /** Live billable-weight preview for the comparison form. */
  router.post('/billable-weight', (req, res) => {
    res.json({ data: calculateBillableWeight(parse(billableWeightInput, req.body)) });
  });

  router.get('/requests/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await buildQuoteResponse(orgId(req), id) });
  });

  router.post('/requests/:id/rank', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { weights } = parse(rankInput, req.body);
    res.json({ data: await buildQuoteResponse(orgId(req), id, weights) });
  });

  return router;
}
