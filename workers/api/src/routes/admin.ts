import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { requireApiKey } from '../middleware/auth.js';
import { AdminService } from '../services/admin.js';
import { success, paginated } from '../utils/response.js';
import {
  createProductSchema,
  adjustInventorySchema,
  reservationFilterSchema,
  orderFilterSchema,
  auditLogFilterSchema,
} from '../validators/schemas.js';

const admin = new Hono<{ Bindings: Env }>();

admin.use('*', requireApiKey('ADMIN_API_KEY'));

/**
 * POST /api/admin/products
 * Create a new product with optional initial stock.
 */
admin.post('/products', async (c) => {
  const body = await c.req.json();
  const validated = createProductSchema.parse(body);

  const service = new AdminService(c.env);
  const product = await service.createProduct(validated);
  return success(c, product, 201);
});

/**
 * POST /api/admin/inventory/adjust
 * Adjust stock level for a product.
 */
admin.post('/inventory/adjust', async (c) => {
  const body = await c.req.json();
  const validated = adjustInventorySchema.parse(body);

  const service = new AdminService(c.env);
  const result = await service.adjustInventory(validated);
  return success(c, result);
});

/**
 * GET /api/admin/reservations
 * List/filter reservations with pagination.
 */
admin.get('/reservations', async (c) => {
  const query = reservationFilterSchema.parse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    status: c.req.query('status') || undefined,
    sku: c.req.query('sku') || undefined,
    user_id: c.req.query('user_id') || undefined,
  });

  const service = new AdminService(c.env);
  const { results, total } = await service.listReservations(
    { status: query.status, sku: query.sku, user_id: query.user_id },
    query.page,
    query.limit,
  );

  return paginated(c, results, total, query.page, query.limit);
});

/**
 * GET /api/admin/orders
 * List/filter orders with pagination.
 */
admin.get('/orders', async (c) => {
  const query = orderFilterSchema.parse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    status: c.req.query('status') || undefined,
  });

  const service = new AdminService(c.env);
  const { results, total } = await service.listOrders(
    { status: query.status },
    query.page,
    query.limit,
  );

  return paginated(c, results, total, query.page, query.limit);
});

/**
 * GET /api/admin/audit-log
 * View audit trail with optional filters and pagination.
 */
admin.get('/audit-log', async (c) => {
  const query = auditLogFilterSchema.parse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    entity_type: c.req.query('entity_type') || undefined,
    entity_id: c.req.query('entity_id') || undefined,
    action: c.req.query('action') || undefined,
  });

  const service = new AdminService(c.env);
  const { results, total } = await service.getAuditLog(
    {
      entity_type: query.entity_type,
      entity_id: query.entity_id,
      action: query.action,
    },
    query.page,
    query.limit,
  );

  return paginated(c, results, total, query.page, query.limit);
});

export { admin };
