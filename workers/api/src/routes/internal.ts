import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { requireApiKey } from '../middleware/auth.js';
import { ReservationService } from '../services/reservation.js';
import { success } from '../utils/response.js';

const internal = new Hono<{ Bindings: Env }>();

internal.use('*', requireApiKey('INTERNAL_API_KEY'));

/**
 * POST /api/internal/reservations/expire
 * Trigger manual expiry sweep across all SKUs.
 * Also invoked by the cron trigger.
 */
internal.post('/reservations/expire', async (c) => {
  const service = new ReservationService(c.env);
  const result = await service.triggerExpirySweep();
  return success(c, result);
});

/**
 * GET /api/health
 * Health check endpoint.
 */
internal.get('/health', async (c) => {
  try {
    // Quick D1 connectivity check
    const result = await c.env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
    const dbOk = result?.ok === 1;

    return success(c, {
      status: dbOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        d1: dbOk ? 'ok' : 'error',
      },
    });
  } catch (err) {
    return success(c, {
      status: 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        d1: 'error',
      },
    });
  }
});

export { internal };
