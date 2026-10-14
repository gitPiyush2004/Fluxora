import { Router } from 'express';
import { actorOf, ctx, orgId } from '../../middleware/auth.js';
import { strictLimiter } from '../../middleware/rate-limit.js';
import { badRequest } from '../../utils/errors.js';
import { idParams, parse } from '../../utils/validate.js';
import { shipmentQuotesInput, shipmentRankInput } from '../quotes/quote.schemas.js';
import { advanceSimulation, listShipmentEvents, recordManualUpdate, refreshTrackingById } from '../tracking/tracking.service.js';
import {
  bookingInput,
  cancelInput,
  createShipmentInput,
  trackShipmentInput,
  eventListQuery,
  IDEMPOTENCY_KEY_PATTERN,
  manualUpdateInput,
  selectQuoteInput,
  shipmentListQuery,
  updateShipmentInput,
} from './shipment.schemas.js';
import {
  bookShipment,
  cancelShipment,
  createShipment,
  getShipmentDetail,
  getShipmentDoc,
  getShipmentQuotes,
  listShipments,
  listShipmentsForMap,
  rankShipmentQuotes,
  requestShipmentQuotes,
  selectQuote,
  trackExistingShipment,
  updateShipment,
} from './shipment.service.js';

export function shipmentRouter(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const { items, meta } = await listShipments(orgId(req), parse(shipmentListQuery, req.query));
    res.json({ data: items, meta });
  });

  router.get('/map', async (req, res) => {
    res.json({ data: await listShipmentsForMap(orgId(req)) });
  });

  router.post('/', async (req, res) => {
    const shipment = await createShipment(orgId(req), actorOf(req), parse(createShipmentInput, req.body));
    res.status(201).json({ data: shipment });
  });

  router.post('/track', strictLimiter('tracking', 30), async (req, res) => {
    const { shipment, trackingError } = await trackExistingShipment(orgId(req), actorOf(req), parse(trackShipmentInput, req.body));
    res.status(201).json({ data: shipment, meta: { trackingError } });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await getShipmentDetail(orgId(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await updateShipment(orgId(req), id, actorOf(req), parse(updateShipmentInput, req.body)) });
  });

  // ---- Quotes & booking ----

  router.post('/:id/quotes', strictLimiter('quotes', 30), async (req, res) => {
    const { id } = parse(idParams, req.params);
    const options = parse(shipmentQuotesInput, req.body ?? {});
    res.status(201).json({ data: await requestShipmentQuotes(orgId(req), ctx(req).userId, id, options) });
  });

  router.get('/:id/quotes', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await getShipmentQuotes(orgId(req), id) });
  });

  router.post('/:id/quotes/rank', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { quoteRequestId, weights } = parse(shipmentRankInput, req.body);
    res.json({ data: await rankShipmentQuotes(orgId(req), id, quoteRequestId, weights) });
  });

  router.post('/:id/select-quote', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { quoteId } = parse(selectQuoteInput, req.body);
    res.json({ data: await selectQuote(orgId(req), actorOf(req), id, quoteId) });
  });

  /** Idempotent: repeating a request with the same Idempotency-Key never books twice. */
  router.post('/:id/book', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const key = req.get('idempotency-key') ?? '';
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw badRequest('An Idempotency-Key header (8–200 URL-safe characters) is required');
    const { shipment, replayed } = await bookShipment(orgId(req), actorOf(req), id, key, parse(bookingInput, req.body));
    res.status(replayed ? 200 : 201).set('Idempotent-Replayed', String(replayed)).json({ data: shipment });
  });

  router.post('/:id/cancel', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(cancelInput, req.body ?? {});
    res.json({ data: await cancelShipment(orgId(req), actorOf(req), id, reason) });
  });

  // ---- Tracking ----

  router.get('/:id/events', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const shipment = await getShipmentDoc(orgId(req), id);
    const { items, meta } = await listShipmentEvents(orgId(req), shipment._id, parse(eventListQuery, req.query));
    res.json({ data: items, meta });
  });

  router.post('/:id/events', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { event } = await recordManualUpdate(orgId(req), id, actorOf(req), parse(manualUpdateInput, req.body));
    res.status(201).json({ data: event });
  });

  router.post('/:id/refresh-tracking', strictLimiter('tracking', 30), async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await refreshTrackingById(orgId(req), id) });
  });

  /** Demo helper: releases the next scripted simulated tracking milestone now. */
  router.post('/:id/simulate-next', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await advanceSimulation(orgId(req), id) });
  });

  return router;
}
