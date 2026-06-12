import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import type {
  DORequest,
  DOResponse,
  Reservation,
  Inventory,
  InventorySnapshot,
} from '../types/index.js';
import { InventoryRepository } from '../repositories/inventory.js';
import { ReservationRepository } from '../repositories/reservation.js';
import { OrderRepository } from '../repositories/order.js';

const RESERVATION_EXPIRY_MINUTES = 15;
const ALARM_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * InventoryReservationDO — Durable Object that serializes all inventory
 * mutations for a single SKU to prevent overselling.
 *
 * Named by SKU product ID: `sku:<product_id>`
 *
 * On first request it hydrates from D1. Before each mutation it sweeps
 * expired reservations. The DO runtime guarantees single-threaded execution,
 * so no two mutations can interleave.
 */
export class InventoryReservationDO extends DurableObject<Env> {
  // In-memory inventory state — hydrated once from D1
  private inventory: Inventory | null = null;
  private initialized = false;

  // Repositories backed by D1
  private inventoryRepo!: InventoryRepository;
  private reservationRepo!: ReservationRepository;
  private orderRepo!: OrderRepository;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.inventoryRepo = new InventoryRepository(env.DB);
    this.reservationRepo = new ReservationRepository(env.DB);
    this.orderRepo = new OrderRepository(env.DB);
  }

  // ─── Initialization ─────────────────────────────────────────────

  private async ensureInitialized(skuId: string): Promise<void> {
    if (this.initialized && this.inventory) return;

    this.inventory = await this.inventoryRepo.findBySkuId(skuId);
    this.initialized = true;

    // Set up alarm for periodic expiry sweeps
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  private reloadInventory(skuId: string): Promise<void> {
    this.initialized = false;
    return this.ensureInitialized(skuId);
  }

  private buildAuditStatement(
    entityType: string,
    entityId: string,
    action: string,
    actorType: string,
    actorId: string | null,
    payload: Record<string, unknown>,
    createdAt: string,
  ): D1PreparedStatement {
    return this.env.DB
      .prepare(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_type, actor_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entityType,
        entityId,
        action,
        actorType,
        actorId,
        JSON.stringify(payload),
        createdAt,
      );
  }

  // ─── HTTP Fetch Handler ──────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    try {
      const body: DORequest = await request.json();
      let result: DOResponse;

      switch (body.action) {
        case 'reserve':
          result = await this.reserve(
            body.skuId!,
            body.quantity!,
            body.userId ?? null,
            body.idempotencyKey!,
          );
          break;
        case 'confirm':
          result = await this.confirm(
            body.reservationId!,
            body.paymentReference!,
            body.idempotencyKey!,
          );
          break;
        case 'cancel':
          result = await this.cancel(body.reservationId!);
          break;
        case 'releaseExpired':
          result = await this.releaseExpired(body.skuId!);
          break;
        case 'getSnapshot':
          result = await this.getSnapshot(body.skuId!);
          break;
        case 'adjustStock':
          result = await this.adjustStock(body.skuId!, body.adjustment!, body.reason!);
          break;
        default:
          result = {
            success: false,
            error: { code: 'INVALID_REQUEST', message: `Unknown action: ${body.action}` },
          };
      }

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal DO error';
      console.error('DO error:', message, err);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message },
        } satisfies DOResponse),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // ─── Alarm Handler (periodic expiry sweep) ──────────────────────

  async alarm(): Promise<void> {
    try {
      // Extract SKU ID from the DO name stored in metadata or use a stored key
      const skuId = await this.ctx.storage.get<string>('skuId');
      if (skuId) {
        await this.releaseExpired(skuId);
      }
    } catch (err) {
      console.error('Alarm error:', err);
    }

    // Re-schedule alarm
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  // ─── Reserve ────────────────────────────────────────────────────

  private async reserve(
    skuId: string,
    quantity: number,
    userId: string | null,
    idempotencyKey: string,
  ): Promise<DOResponse> {
    await this.ensureInitialized(skuId);

    // Store SKU ID for alarm handler
    await this.ctx.storage.put('skuId', skuId);

    // Sweep expired reservations first
    await this.sweepExpired(skuId);

    // Check idempotency — return existing reservation if same key
    const existing = await this.reservationRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      // If the existing reservation was for the same SKU, return it (idempotent replay)
      if (existing.sku_id === skuId) {
        return { success: true, data: existing };
      }
      // Different SKU with same idempotency key = conflict
      return {
        success: false,
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'A different request was already processed with this idempotency key',
          details: { idempotency_key: idempotencyKey },
        },
      };
    }

    if (!this.inventory) {
      return {
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: `No inventory found for SKU ${skuId}` },
      };
    }

    // Calculate available stock
    const available =
      this.inventory.total_stock -
      this.inventory.reserved_count -
      this.inventory.confirmed_count;

    if (available < quantity) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: 'Not enough stock available',
          details: { available, requested: quantity },
        },
      };
    }

    // Create reservation
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESERVATION_EXPIRY_MINUTES * 60 * 1000);
    const reservation: Reservation = {
      id: crypto.randomUUID(),
      sku_id: skuId,
      user_id: userId,
      quantity,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      idempotency_key: idempotencyKey,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const createdAt = now.toISOString();
    const batchResult = await this.env.DB.batch([
      this.env.DB
        .prepare(
          `UPDATE inventory
          SET reserved_count = reserved_count + ?, version = version + 1, updated_at = ?
          WHERE sku_id = ? AND (total_stock - reserved_count - confirmed_count) >= ?`,
        )
        .bind(quantity, createdAt, skuId, quantity),
      this.env.DB
        .prepare(
          `INSERT INTO reservations (id, sku_id, user_id, quantity, status, expires_at, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          reservation.id,
          reservation.sku_id,
          reservation.user_id,
          reservation.quantity,
          reservation.status,
          reservation.expires_at,
          reservation.idempotency_key,
          reservation.created_at,
          reservation.updated_at,
        ),
      this.buildAuditStatement(
        'reservation',
        reservation.id,
        'reservation.created',
        'user',
        userId,
        {
          sku_id: skuId,
          quantity,
          expires_at: reservation.expires_at,
        },
        createdAt,
      ),
    ]);

    if ((batchResult[0].meta?.changes ?? 0) === 0) {
      await this.env.DB.batch([
        this.env.DB
          .prepare('DELETE FROM reservations WHERE id = ?')
          .bind(reservation.id),
        this.env.DB
          .prepare(
            'DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ?',
          )
          .bind('reservation', reservation.id, 'reservation.created'),
      ]);
      await this.reloadInventory(skuId);
      const latest = this.inventory;
      const latestAvailable = latest
        ? latest.total_stock - latest.reserved_count - latest.confirmed_count
        : 0;
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: 'Not enough stock available',
          details: { available: latestAvailable, requested: quantity },
        },
      };
    }

    // Update in-memory state
    this.inventory.reserved_count += quantity;
    this.inventory.version += 1;

    return { success: true, data: reservation };
  }

  // ─── Confirm ────────────────────────────────────────────────────

  private async confirm(
    reservationId: string,
    paymentReference: string,
    idempotencyKey: string,
  ): Promise<DOResponse> {
    const reservation = await this.reservationRepo.findById(reservationId);
    if (!reservation) {
      return {
        success: false,
        error: {
          code: 'RESERVATION_NOT_FOUND',
          message: `Reservation ${reservationId} not found`,
        },
      };
    }

    await this.ensureInitialized(reservation.sku_id);

    const existingOrder = await this.orderRepo.findByConfirmationIdempotencyKey(idempotencyKey);
    if (existingOrder) {
      if (existingOrder.reservation_id === reservationId) {
        return {
          success: true,
          data: { reservation: { ...reservation, status: 'confirmed' }, order: existingOrder },
        };
      }

      return {
        success: false,
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'A different request was already processed with this idempotency key',
          details: { idempotency_key: idempotencyKey },
        },
      };
    }

    // Check if already confirmed
    if (reservation.status === 'confirmed') {
      const confirmedOrder = await this.orderRepo.findByReservationId(reservationId);
      return {
        success: false,
        error: {
          code: 'ALREADY_CONFIRMED',
          message: `Reservation ${reservationId} is already confirmed`,
          details: { order_id: confirmedOrder?.id },
        },
      };
    }

    if (reservation.status === 'cancelled') {
      return {
        success: false,
        error: {
          code: 'ALREADY_CANCELLED',
          message: `Reservation ${reservationId} is already cancelled`,
        },
      };
    }

    if (reservation.status === 'expired') {
      return {
        success: false,
        error: {
          code: 'RESERVATION_EXPIRED',
          message: `Reservation ${reservationId} has expired`,
        },
      };
    }

    // Check if reservation has expired (but status not yet updated)
    const now = new Date();
    if (new Date(reservation.expires_at) <= now) {
      const timestamp = now.toISOString();
      await this.env.DB.batch([
        this.env.DB
          .prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
          .bind('expired', timestamp, reservationId),
        this.env.DB
          .prepare(
            `UPDATE inventory
            SET reserved_count = MAX(0, reserved_count - ?), version = version + 1, updated_at = ?
            WHERE sku_id = ?`,
          )
          .bind(reservation.quantity, timestamp, reservation.sku_id),
        this.buildAuditStatement(
          'reservation',
          reservationId,
          'reservation.expired',
          'system',
          null,
          { sku_id: reservation.sku_id, quantity: reservation.quantity },
          timestamp,
        ),
      ]);

      if (this.inventory) {
        this.inventory.reserved_count = Math.max(
          0,
          this.inventory.reserved_count - reservation.quantity,
        );
      }

      return {
        success: false,
        error: {
          code: 'RESERVATION_EXPIRED',
          message: `Reservation ${reservationId} has expired`,
        },
      };
    }

    // Create order
    const order = {
      id: crypto.randomUUID(),
      reservation_id: reservationId,
      status: 'completed' as const,
      payment_reference: paymentReference,
      confirmation_idempotency_key: idempotencyKey,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    const batchTimestamp = now.toISOString();
    await this.env.DB.batch([
      this.env.DB
        .prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
        .bind('confirmed', batchTimestamp, reservationId),
      this.env.DB
        .prepare(
          `UPDATE inventory
          SET reserved_count = MAX(0, reserved_count - ?),
              confirmed_count = confirmed_count + ?,
              version = version + 1,
              updated_at = ?
          WHERE sku_id = ? AND reserved_count >= ?`,
        )
        .bind(reservation.quantity, reservation.quantity, batchTimestamp, reservation.sku_id, reservation.quantity),
      this.env.DB
        .prepare(
          `INSERT INTO orders (
            id,
            reservation_id,
            status,
            payment_reference,
            confirmation_idempotency_key,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          order.id,
          order.reservation_id,
          order.status,
          order.payment_reference,
          order.confirmation_idempotency_key,
          order.created_at,
          order.updated_at,
        ),
      this.buildAuditStatement(
        'reservation',
        reservationId,
        'reservation.confirmed',
        'user',
        reservation.user_id,
        { payment_reference: paymentReference },
        batchTimestamp,
      ),
      this.buildAuditStatement(
        'order',
        order.id,
        'order.created',
        'system',
        null,
        {
          reservation_id: reservationId,
          payment_reference: paymentReference,
        },
        batchTimestamp,
      ),
    ]);

    // Update in-memory state
    if (this.inventory) {
      this.inventory.reserved_count = Math.max(
        0,
        this.inventory.reserved_count - reservation.quantity,
      );
      this.inventory.confirmed_count += reservation.quantity;
      this.inventory.version += 1;
    }

    return { success: true, data: { reservation: { ...reservation, status: 'confirmed' }, order } };
  }

  // ─── Cancel ─────────────────────────────────────────────────────

  private async cancel(reservationId: string): Promise<DOResponse> {
    const reservation = await this.reservationRepo.findById(reservationId);
    if (!reservation) {
      return {
        success: false,
        error: {
          code: 'RESERVATION_NOT_FOUND',
          message: `Reservation ${reservationId} not found`,
        },
      };
    }

    await this.ensureInitialized(reservation.sku_id);

    if (reservation.status === 'confirmed') {
      return {
        success: false,
        error: {
          code: 'ALREADY_CONFIRMED',
          message: `Reservation ${reservationId} is already confirmed and cannot be cancelled`,
        },
      };
    }

    if (reservation.status === 'cancelled') {
      return {
        success: false,
        error: {
          code: 'ALREADY_CANCELLED',
          message: `Reservation ${reservationId} is already cancelled`,
        },
      };
    }

    if (reservation.status === 'expired') {
      return {
        success: false,
        error: {
          code: 'RESERVATION_EXPIRED',
          message: `Reservation ${reservationId} has already expired`,
        },
      };
    }

    const timestamp = new Date().toISOString();
    await this.env.DB.batch([
      this.env.DB
        .prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
        .bind('cancelled', timestamp, reservationId),
      this.env.DB
        .prepare(
          `UPDATE inventory
          SET reserved_count = MAX(0, reserved_count - ?), version = version + 1, updated_at = ?
          WHERE sku_id = ? AND reserved_count >= ?`,
        )
        .bind(reservation.quantity, timestamp, reservation.sku_id, reservation.quantity),
      this.buildAuditStatement(
        'reservation',
        reservationId,
        'reservation.cancelled',
        'user',
        reservation.user_id,
        { sku_id: reservation.sku_id, quantity: reservation.quantity },
        timestamp,
      ),
    ]);

    if (this.inventory) {
      this.inventory.reserved_count = Math.max(
        0,
        this.inventory.reserved_count - reservation.quantity,
      );
      this.inventory.version += 1;
    }

    return { success: true, data: { ...reservation, status: 'cancelled' } };
  }

  // ─── Release Expired ────────────────────────────────────────────

  private async releaseExpired(skuId: string): Promise<DOResponse> {
    await this.ensureInitialized(skuId);
    const count = await this.sweepExpired(skuId);
    return { success: true, data: { expired_count: count } };
  }

  // ─── Get Snapshot ───────────────────────────────────────────────

  private async getSnapshot(skuId: string): Promise<DOResponse> {
    await this.ensureInitialized(skuId);

    // Always re-read from D1 for the freshest data
    await this.reloadInventory(skuId);

    if (!this.inventory) {
      return {
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: `No inventory found for SKU ${skuId}` },
      };
    }

    const snapshot: InventorySnapshot = {
      sku_id: this.inventory.sku_id,
      total_stock: this.inventory.total_stock,
      reserved_count: this.inventory.reserved_count,
      confirmed_count: this.inventory.confirmed_count,
      available_stock:
        this.inventory.total_stock -
        this.inventory.reserved_count -
        this.inventory.confirmed_count,
      version: this.inventory.version,
    };

    return { success: true, data: snapshot };
  }

  // ─── Adjust Stock ───────────────────────────────────────────────

  private async adjustStock(
    skuId: string,
    adjustment: number,
    reason: string,
  ): Promise<DOResponse> {
    await this.ensureInitialized(skuId);

    if (!this.inventory) {
      return {
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: `No inventory found for SKU ${skuId}` },
      };
    }

    const previousStock = this.inventory.total_stock;
    const newStock = previousStock + adjustment;
    const committedUnits = this.inventory.reserved_count + this.inventory.confirmed_count;

    if (newStock < 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Adjustment would result in negative stock',
        },
      };
    }

    if (newStock < committedUnits) {
      return {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: `Cannot reduce stock below reserved + confirmed count (${committedUnits})`,
        },
      };
    }

    const timestamp = new Date().toISOString();
    const batchResult = await this.env.DB.batch([
      this.env.DB
        .prepare(
          `UPDATE inventory
          SET total_stock = total_stock + ?, version = version + 1, updated_at = ?
          WHERE sku_id = ? AND (total_stock + ?) >= 0 AND (total_stock + ?) >= (reserved_count + confirmed_count)`,
        )
        .bind(adjustment, timestamp, skuId, adjustment, adjustment),
      this.buildAuditStatement(
        'inventory',
        skuId,
        'inventory.adjusted',
        'admin',
        null,
        {
          previous_stock: previousStock,
          adjustment,
          new_stock: newStock,
          reason,
        },
        timestamp,
      ),
    ]);

    if ((batchResult[0].meta?.changes ?? 0) === 0) {
      await this.reloadInventory(skuId);
      return {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Failed to adjust inventory',
        },
      };
    }

    this.inventory.total_stock = newStock;
    this.inventory.version += 1;

    return {
      success: true,
      data: {
        inventory: this.inventory,
        previous_stock: previousStock,
        new_stock: newStock,
      },
    };
  }

  // ─── Sweep Expired (internal) ───────────────────────────────────

  private async sweepExpired(skuId: string): Promise<number> {
    const now = new Date().toISOString();
    const expired = await this.reservationRepo.findExpiredPending(skuId, now);

    if (expired.length === 0) return 0;

    // Calculate total quantity to release
    const totalQuantity = expired.reduce((sum, r) => sum + r.quantity, 0);

    const timestamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      ...expired.map((reservation) =>
        this.env.DB
          .prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
          .bind('expired', timestamp, reservation.id),
      ),
      this.env.DB
        .prepare(
          `UPDATE inventory
          SET reserved_count = MAX(0, reserved_count - ?), version = version + 1, updated_at = ?
          WHERE sku_id = ?`,
        )
        .bind(totalQuantity, timestamp, skuId),
      ...expired.map((reservation) =>
        this.buildAuditStatement(
          'reservation',
          reservation.id,
          'reservation.expired',
          'system',
          null,
          { sku_id: skuId, quantity: reservation.quantity },
          timestamp,
        ),
      ),
    ];

    await this.env.DB.batch(statements);

    // Update in-memory state
    if (this.inventory) {
      this.inventory.reserved_count = Math.max(
        0,
        this.inventory.reserved_count - totalQuantity,
      );
      this.inventory.version += 1;
    }

    return expired.length;
  }
}
