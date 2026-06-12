import { z } from 'zod';

// ─── Reservation Schemas ────────────────────────────────────────────

export const createReservationSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(100),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .positive('Quantity must be positive')
    .max(10, 'Maximum 10 units per reservation'),
  user_id: z.string().max(100).optional(),
});

export const confirmReservationSchema = z.object({
  payment_reference: z
    .string()
    .min(1, 'Payment reference is required')
    .max(200),
});

// ─── Product Schemas ────────────────────────────────────────────────

export const createProductSchema = z.object({
  sku: z
    .string()
    .min(1, 'SKU is required')
    .max(100)
    .regex(/^[A-Za-z0-9\-_]+$/, 'SKU must be alphanumeric with hyphens/underscores'),
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).optional(),
  initial_stock: z.number().int().nonnegative().max(999999).optional().default(0),
});

// ─── Inventory Schemas ──────────────────────────────────────────────

export const adjustInventorySchema = z.object({
  sku: z.string().min(1, 'SKU is required'),
  adjustment: z
    .number()
    .int('Adjustment must be an integer')
    .refine((val) => val !== 0, 'Adjustment cannot be zero'),
  reason: z.string().min(1, 'Reason is required').max(500),
});

// ─── Query Parameter Schemas ────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const reservationFilterSchema = paginationSchema.extend({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'expired']).optional(),
  sku: z.string().optional(),
  user_id: z.string().optional(),
});

export const orderFilterSchema = paginationSchema.extend({
  status: z.enum(['completed', 'refunded']).optional(),
});

export const auditLogFilterSchema = paginationSchema.extend({
  entity_type: z.enum(['product', 'inventory', 'reservation', 'order']).optional(),
  entity_id: z.string().optional(),
  action: z.string().optional(),
});
