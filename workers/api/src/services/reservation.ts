import type { Env } from '../types/env.js';
import type { DORequest, DOResponse, Order, Reservation } from '../types/index.js';
import { ProductRepository } from '../repositories/product.js';
import { OrderRepository } from '../repositories/order.js';
import { ReservationRepository } from '../repositories/reservation.js';
import {
  AppError,
  ProductNotFoundError,
  ReservationNotFoundError,
  InvalidRequestError,
} from '../utils/errors.js';

export class ReservationService {
  private productRepo: ProductRepository;
  private orderRepo: OrderRepository;
  private reservationRepo: ReservationRepository;

  constructor(private env: Env) {
    this.productRepo = new ProductRepository(env.DB);
    this.orderRepo = new OrderRepository(env.DB);
    this.reservationRepo = new ReservationRepository(env.DB);
  }

  /**
   * Create a reservation by routing through the Durable Object for the target SKU.
   */
  async createReservation(
    sku: string,
    quantity: number,
    userId: string | undefined,
    idempotencyKey: string,
  ): Promise<Reservation> {
    // Look up product by SKU to get the product ID
    const product = await this.productRepo.findBySku(sku);
    if (!product) {
      throw new ProductNotFoundError(sku);
    }

    if (product.status !== 'active') {
      throw new InvalidRequestError(`Product ${sku} is not currently available`);
    }

    // Route to the Durable Object for this product
    const doId = this.env.INVENTORY_DO.idFromName(`sku:${product.id}`);
    const stub = this.env.INVENTORY_DO.get(doId);

    const doRequest: DORequest = {
      action: 'reserve',
      skuId: product.id,
      quantity,
      userId: userId ?? undefined,
      idempotencyKey,
    };

    const response = await stub.fetch('http://do/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doRequest),
    });

    const result: DOResponse = await response.json();

    if (!result.success) {
      throw new AppError(
        result.error!.code as any,
        result.error!.message,
        this.getStatusCode(result.error!.code),
        result.error!.details,
      );
    }

    return result.data as Reservation;
  }

  /**
   * Get reservation by ID directly from D1 (read-only, no DO needed).
   */
  async getReservation(id: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findById(id);
    if (!reservation) {
      throw new ReservationNotFoundError(id);
    }

    // Check if it's expired but not yet swept
    if (
      reservation.status === 'pending' &&
      new Date(reservation.expires_at) <= new Date()
    ) {
      // Return with expired status hint, but don't mutate — the DO will handle that
      return { ...reservation, status: 'expired' };
    }

    return reservation;
  }

  /**
   * Confirm a reservation through its SKU's Durable Object.
   */
  async confirmReservation(
    reservationId: string,
    paymentReference: string,
    idempotencyKey: string,
  ): Promise<{ reservation: Reservation; order: Order }> {
    // Look up the reservation to find the SKU
    const reservation = await this.reservationRepo.findById(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }

    const existingOrder = await this.orderRepo.findByConfirmationIdempotencyKey(idempotencyKey);
    if (existingOrder) {
      if (existingOrder.reservation_id !== reservationId) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'A different request was already processed with this idempotency key',
          409,
          { idempotency_key: idempotencyKey },
        );
      }

      return {
        reservation: { ...reservation, status: 'confirmed' },
        order: existingOrder,
      };
    }

    const doId = this.env.INVENTORY_DO.idFromName(`sku:${reservation.sku_id}`);
    const stub = this.env.INVENTORY_DO.get(doId);

    const doRequest: DORequest = {
      action: 'confirm',
      reservationId,
      paymentReference,
      idempotencyKey,
    };

    const response = await stub.fetch('http://do/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doRequest),
    });

    const result: DOResponse = await response.json();

    if (!result.success) {
      throw new AppError(
        result.error!.code as any,
        result.error!.message,
        this.getStatusCode(result.error!.code),
        result.error!.details,
      );
    }

    return result.data as { reservation: Reservation; order: Order };
  }

  /**
   * Cancel a reservation through its SKU's Durable Object.
   */
  async cancelReservation(reservationId: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findById(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }

    const doId = this.env.INVENTORY_DO.idFromName(`sku:${reservation.sku_id}`);
    const stub = this.env.INVENTORY_DO.get(doId);

    const doRequest: DORequest = {
      action: 'cancel',
      reservationId,
    };

    const response = await stub.fetch('http://do/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doRequest),
    });

    const result: DOResponse = await response.json();

    if (!result.success) {
      throw new AppError(
        result.error!.code as any,
        result.error!.message,
        this.getStatusCode(result.error!.code),
        result.error!.details,
      );
    }

    return result.data as Reservation;
  }

  /**
   * Trigger expiry sweep for a specific SKU or all SKUs.
   */
  async triggerExpirySweep(skuId?: string): Promise<{ total_expired: number }> {
    if (skuId) {
      return this.sweepSingleSku(skuId);
    }

    // Find all distinct SKUs with pending reservations that may be expired
    const expired = await this.reservationRepo.findAllExpiredPending(new Date().toISOString());

    // Group by SKU
    const skuIds = [...new Set(expired.map((r) => r.sku_id))];
    let totalExpired = 0;

    for (const sid of skuIds) {
      const result = await this.sweepSingleSku(sid);
      totalExpired += result.total_expired;
    }

    return { total_expired: totalExpired };
  }

  private async sweepSingleSku(skuId: string): Promise<{ total_expired: number }> {
    const doId = this.env.INVENTORY_DO.idFromName(`sku:${skuId}`);
    const stub = this.env.INVENTORY_DO.get(doId);

    const doRequest: DORequest = {
      action: 'releaseExpired',
      skuId,
    };

    const response = await stub.fetch('http://do/release-expired', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doRequest),
    });

    const result: DOResponse = await response.json();
    if (!result.success) {
      return { total_expired: 0 };
    }

    return { total_expired: (result.data as any).expired_count ?? 0 };
  }

  private getStatusCode(code: string): number {
    const map: Record<string, number> = {
      INSUFFICIENT_STOCK: 409,
      RESERVATION_EXPIRED: 410,
      RESERVATION_NOT_FOUND: 404,
      PRODUCT_NOT_FOUND: 404,
      ALREADY_CONFIRMED: 409,
      ALREADY_CANCELLED: 409,
      IDEMPOTENCY_CONFLICT: 409,
      INVALID_REQUEST: 400,
      INTERNAL_ERROR: 500,
    };
    return map[code] ?? 400;
  }
}
