import { Router } from 'express';
import { actorOf, orgId } from '../../middleware/auth.js';
import { activeInput, idParams, parse } from '../../utils/validate.js';
import { productInput, productListQuery } from './product.schemas.js';
import { createProduct, getProduct, listProducts, setProductActive, updateProduct } from './product.service.js';

export function productRouter(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const { items, meta } = await listProducts(orgId(req), parse(productListQuery, req.query));
    res.json({ data: items, meta });
  });

  router.post('/', async (req, res) => {
    const product = await createProduct(orgId(req), actorOf(req), parse(productInput, req.body));
    res.status(201).json({ data: product });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await getProduct(orgId(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ data: await updateProduct(orgId(req), id, actorOf(req), parse(productInput.partial(), req.body)) });
  });

  router.patch('/:id/status', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { isActive } = parse(activeInput, req.body);
    res.json({ data: await setProductActive(orgId(req), id, actorOf(req), isActive) });
  });

  return router;
}
