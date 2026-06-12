import type { Env } from '../types/env.js';
import type {
  DORequest,
  DOResponse,
  Product,
  ProductWithStock,
  Reservation,
  Order,
  AuditLogEntry,
} from '../types/index.js';
import { ProductRepository } from '../repositories/product.js';
import { InventoryRepository } from '../repositories/inventory.js';
import { ReservationRepository } from '../repositories/reservation.js';
import { OrderRepository } from '../repositories/order.js';
import { AuditRepository } from '../repositories/audit.js';
import { InvalidRequestError, ProductNotFoundError } from '../utils/errors.js';

export class AdminService {
  private productRepo: ProductRepository;
  private inventoryRepo: InventoryRepository;
  private reservationRepo: ReservationRepository;
  private orderRepo: OrderRepository;
  private auditRepo: AuditRepository;

  constructor(private env: Env) {
    this.productRepo = new ProductRepository(env.DB);
    this.inventoryRepo = new InventoryRepository(env.DB);
    this.reservationRepo = new ReservationRepository(env.DB);
    this.orderRepo = new OrderRepository(env.DB);
    this.auditRepo = new AuditRepository(env.DB);
  }

  /**
   * Create a new product with optional initial stock.
   */
  async createProduct(data: {
    sku: string;
    name: string;
    description?: string;
    initial_stock?: number;
  }): Promise<ProductWithStock> {
    // Check if SKU already exists
    const existing = await this.productRepo.findBySku(data.sku);
    if (existing) {
      throw new InvalidRequestError(`Product with SKU ${data.sku} already exists`);
    }

    const now = new Date().toISOString();
    const productId = crypto.randomUUID();

    const product: Product = {
      id: productId,
      sku: data.sku,
      name: data.name,
      description: data.description ?? null,
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    await this.productRepo.create(product);

    // Create inventory record
    const initialStock = data.initial_stock ?? 0;
    await this.inventoryRepo.create({
      sku_id: productId,
      total_stock: initialStock,
      reserved_count: 0,
      confirmed_count: 0,
      version: 0,
      updated_at: now,
    });

    // Audit log
    await this.auditRepo.log('product', productId, 'product.created', 'admin', null, {
      sku: data.sku,
      name: data.name,
      initial_stock: initialStock,
    });

    return {
      ...product,
      total_stock: initialStock,
      reserved_count: 0,
      confirmed_count: 0,
      available_stock: initialStock,
    };
  }

  /**
   * Adjust inventory stock level for a product.
   */
  async adjustInventory(data: {
    sku: string;
    adjustment: number;
    reason: string;
  }): Promise<{ inventory: any; previous_stock: number; new_stock: number }> {
    const product = await this.productRepo.findBySku(data.sku);
    if (!product) {
      throw new ProductNotFoundError(data.sku);
    }

    const currentInventory = await this.inventoryRepo.findBySkuId(product.id);
    if (!currentInventory) {
      throw new InvalidRequestError(`No inventory record for SKU ${data.sku}`);
    }

    const previousStock = currentInventory.total_stock;
    const newStock = previousStock + data.adjustment;

    if (newStock < 0) {
      throw new InvalidRequestError(
        `Adjustment would result in negative stock (current: ${previousStock}, adjustment: ${data.adjustment})`,
      );
    }

    // Check that new total_stock wouldn't be less than reserved + confirmed
    if (newStock < currentInventory.reserved_count + currentInventory.confirmed_count) {
      throw new InvalidRequestError(
        `Cannot reduce stock below reserved + confirmed count (reserved: ${currentInventory.reserved_count}, confirmed: ${currentInventory.confirmed_count})`,
      );
    }

    const doId = this.env.INVENTORY_DO.idFromName(`sku:${product.id}`);
    const stub = this.env.INVENTORY_DO.get(doId);
    const doRequest: DORequest = {
      action: 'adjustStock',
      skuId: product.id,
      adjustment: data.adjustment,
      reason: data.reason,
    };

    const response = await stub.fetch('http://do/adjust-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doRequest),
    });

    const result: DOResponse = await response.json();
    if (!result.success) {
      throw new InvalidRequestError(result.error?.message ?? 'Failed to adjust inventory');
    }

    return result.data as { inventory: any; previous_stock: number; new_stock: number };
  }

  /**
   * List reservations with optional filters and pagination.
   */
  async listReservations(
    filters: { status?: string; sku?: string; user_id?: string },
    page: number,
    limit: number,
  ): Promise<{ results: Reservation[]; total: number }> {
    // If SKU filter is provided, resolve to product ID
    let skuId: string | undefined;
    if (filters.sku) {
      const product = await this.productRepo.findBySku(filters.sku);
      if (product) {
        skuId = product.id;
      } else {
        return { results: [], total: 0 };
      }
    }

    return this.reservationRepo.findWithFilters(
      {
        status: filters.status as any,
        sku_id: skuId,
        user_id: filters.user_id,
      },
      page,
      limit,
    );
  }

  /**
   * List orders with optional filters and pagination.
   */
  async listOrders(
    filters: { status?: string },
    page: number,
    limit: number,
  ): Promise<{ results: Order[]; total: number }> {
    return this.orderRepo.findWithFilters(
      { status: filters.status as any },
      page,
      limit,
    );
  }

  /**
   * Get audit log entries with optional filters and pagination.
   */
  async getAuditLog(
    filters: { entity_type?: string; entity_id?: string; action?: string },
    page: number,
    limit: number,
  ): Promise<{ results: AuditLogEntry[]; total: number }> {
    return this.auditRepo.findWithFilters(
      {
        entity_type: filters.entity_type as any,
        entity_id: filters.entity_id,
        action: filters.action,
      },
      page,
      limit,
    );
  }
}
