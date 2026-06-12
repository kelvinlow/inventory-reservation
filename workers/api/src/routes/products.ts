import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { ProductService } from '../services/product.js';
import { success } from '../utils/response.js';

const products = new Hono<{ Bindings: Env }>();

/**
 * GET /api/products
 * List all active products with stock information.
 */
products.get('/', async (c) => {
  const service = new ProductService(c.env);
  const productList = await service.listActiveProducts();
  return success(c, productList);
});

/**
 * GET /api/products/:sku
 * Get product detail with stock information by SKU.
 */
products.get('/:sku', async (c) => {
  const sku = c.req.param('sku');
  const service = new ProductService(c.env);
  const product = await service.getProductBySku(sku);
  return success(c, product);
});

export { products };
