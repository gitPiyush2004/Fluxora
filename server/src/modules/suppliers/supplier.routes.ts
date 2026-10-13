import { Router } from 'express';
import { actorOf, orgId } from '../../middleware/auth.js';
import { activeInput, idParams, parse } from '../../utils/validate.js';
import { supplierInput, supplierListQuery } from './supplier.schemas.js';
import { createSupplier, getSupplierDetail, listSuppliers, setSupplierActive, updateSupplier } from './supplier.service.js';

export function supplierRouter(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const { items, meta } = await listSuppliers(orgId(req), parse(supplierListQuery, req.query));
    res.json({ data: items, meta });
  });

  router.post('/', async (req, res) => {
    const supplier = await createSupplier(orgId(req), actorOf(req), parse(supplierInput, req.body));
    res.status(201).json({ data: supplier });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await getSupplierDetail(orgId(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await updateSupplier(orgId(req), id, actorOf(req), parse(supplierInput.partial(), req.body)) });
  });

  router.patch('/:id/status', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { isActive } = parse(activeInput, req.body);
    res.json({ data: await setSupplierActive(orgId(req), id, actorOf(req), isActive) });
  });

  return router;
}
