import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { products } from './routes/products.js';
import { reservations } from './routes/reservations.js';
import { admin } from './routes/admin.js';
import { internal } from './routes/internal.js';
import { ReservationService } from './services/reservation.js';

// Re-export the Durable Object class so wrangler can find it
export { InventoryReservationDO } from './durable-objects/inventory-reservation.js';

// ─── App Setup ────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ─── Global Middleware ────────────────────────────────────────────

// CORS - allow all origins in development
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization', 'X-API-Key'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400,
  }),
);

// Request logging
app.use('*', logger());

// Error handling
app.onError(errorHandler);

// Rate limiting on public endpoints
app.use('/api/reservations/*', rateLimiter(60, 60_000)); // 60 req/min for reservations
app.use('/api/products/*', rateLimiter(120, 60_000)); // 120 req/min for products

// ─── Routes ───────────────────────────────────────────────────────

// Public routes
app.route('/api/products', products);
app.route('/api/reservations', reservations);

// Admin routes
app.route('/api/admin', admin);

// Internal routes
app.route('/api/internal', internal);

// Health check at root level too
app.get('/api/health', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
    return c.json({
      data: {
        status: result?.ok === 1 ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    });
  } catch {
    return c.json(
      {
        data: {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      },
      503,
    );
  }
});

// Root
app.get('/', (c) => {
  return c.json({
    data: {
      name: 'Inventory Reservation API',
      version: '1.0.0',
      docs: '/api/health',
    },
  });
});

// 404 catch-all
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404,
  );
});

// ─── Worker Export ─────────────────────────────────────────────────

export default {
  fetch: app.fetch,

  /**
   * Scheduled handler — triggered by cron.
   * Runs the expiry sweep across all SKUs with pending expired reservations.
   */
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const service = new ReservationService(env);
          const result = await service.triggerExpirySweep();
          console.log(`Scheduled expiry sweep completed: ${result.total_expired} expired`);
        } catch (err) {
          console.error('Scheduled expiry sweep failed:', err);
        }
      })(),
    );
  },
};
