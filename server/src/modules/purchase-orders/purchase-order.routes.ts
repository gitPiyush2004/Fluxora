import { Router, type Request } from 'express';
import { actorOf, orgId, requireRole } from '../../middleware/auth.js';
import { emitToOrg } from '../../sockets/realtime.js';
import { idParams, parse } from '../../utils/validate.js';
import { createFromPoInput } from '../shipments/shipment.schemas.js';
import { createShipmentFromPurchaseOrder } from '../shipments/shipment.service.js';
import type { PurchaseOrderDoc } from './purchase-order.model.js';
import { cancelInput, poInput, poListQuery, receiptInput, updatePoInput } from './purchase-order.schemas.js';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrderDetail,
  listPurchaseOrders,
  markReadyToShip,
  receiveGoods,
  updatePurchaseOrder,
} from './purchase-order.service.js';

/** Tells every open browser in the organisation that this order changed. */
function notifyChanged(req: Request, po: PurchaseOrderDoc) {
  emitToOrg(orgId(req), 'purchase-order:updated', { id: String(po._id), status: po.status });
}

export function purchaseOrderRouter(): Router {
  const router = Router();
  const adminOnly = requireRole('ADMIN');

  router.get('/', async (req, res) => {
    const { items, meta } = await listPurchaseOrders(orgId(req), parse(poListQuery, req.query));
    res.json({ data: items, meta });
  });

  router.post('/', async (req, res) => {
    const po = await createPurchaseOrder(orgId(req), actorOf(req), parse(poInput, req.body));
    notifyChanged(req, po);
    res.status(201).json({ data: po });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await getPurchaseOrderDetail(orgId(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updatePoInput, req.body);
    const po = await updatePurchaseOrder(orgId(req), id, actorOf(req), body, body.version);
    notifyChanged(req, po);
    res.json({ data: po });
  });

  router.post('/:id/approve', adminOnly, async (req, res) => {
    const { id } = parse(idParams, req.params);
    const po = await approvePurchaseOrder(orgId(req), id, actorOf(req));
    notifyChanged(req, po);
    res.json({ data: po });
  });

  router.post('/:id/ready-to-ship', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const po = await markReadyToShip(orgId(req), id, actorOf(req));
    notifyChanged(req, po);
    res.json({ data: po });
  });

  router.post('/:id/cancel', adminOnly, async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(cancelInput, req.body ?? {});
    const po = await cancelPurchaseOrder(orgId(req), id, actorOf(req), reason);
    notifyChanged(req, po);
    res.json({ data: po });
  });

  router.post('/:id/receive', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const po = await receiveGoods(orgId(req), id, actorOf(req), parse(receiptInput, req.body));
    notifyChanged(req, po);
    res.json({ data: po });
  });

  router.post('/:id/shipments', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const shipment = await createShipmentFromPurchaseOrder(orgId(req), actorOf(req), id, parse(createFromPoInput, req.body));
    res.status(201).json({ data: shipment });
  });

  return router;
}
