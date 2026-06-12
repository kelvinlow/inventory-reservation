import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { ReservationService } from '../services/reservation.js';
import { createReservationSchema, confirmReservationSchema } from '../validators/schemas.js';
import { success } from '../utils/response.js';
import { InvalidRequestError } from '../utils/errors.js';

const reservations = new Hono<{ Bindings: Env }>();

/**
 * POST /api/reservations
 * Create a new inventory reservation.
 * Requires Idempotency-Key header.
 */
reservations.post('/', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key') ?? c.req.header('idempotency-key');
  if (!idempotencyKey) {
    throw new InvalidRequestError('Idempotency-Key header is required');
  }

  const body = await c.req.json();
  const validated = createReservationSchema.parse(body);

  const service = new ReservationService(c.env);
  const reservation = await service.createReservation(
    validated.sku,
    validated.quantity,
    validated.user_id,
    idempotencyKey,
  );

  return success(c, reservation, 201);
});

/**
 * GET /api/reservations/:id
 * Get reservation status by ID.
 */
reservations.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = new ReservationService(c.env);
  const reservation = await service.getReservation(id);
  return success(c, reservation);
});

/**
 * POST /api/reservations/:id/confirm
 * Confirm a pending reservation with payment reference.
 */
reservations.post('/:id/confirm', async (c) => {
  const id = c.req.param('id');
  const idempotencyKey = c.req.header('Idempotency-Key') ?? c.req.header('idempotency-key');
  if (!idempotencyKey) {
    throw new InvalidRequestError('Idempotency-Key header is required');
  }

  const body = await c.req.json();
  const validated = confirmReservationSchema.parse(body);

  const service = new ReservationService(c.env);
  const result = await service.confirmReservation(
    id,
    validated.payment_reference,
    idempotencyKey,
  );
  return success(c, result);
});

/**
 * POST /api/reservations/:id/cancel
 * Cancel a pending reservation.
 */
reservations.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const service = new ReservationService(c.env);
  const reservation = await service.cancelReservation(id);
  return success(c, reservation);
});

export { reservations };
