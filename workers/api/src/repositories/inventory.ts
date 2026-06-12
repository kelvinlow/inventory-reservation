import type { Inventory } from '../types/index.js';

export class InventoryRepository {
  constructor(private db: D1Database) {}

  async findBySkuId(skuId: string): Promise<Inventory | null> {
    const result = await this.db
      .prepare('SELECT * FROM inventory WHERE sku_id = ?')
      .bind(skuId)
      .first<Inventory>();
    return result ?? null;
  }

  async create(inventory: Inventory): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        inventory.sku_id,
        inventory.total_stock,
        inventory.reserved_count,
        inventory.confirmed_count,
        inventory.version,
        inventory.updated_at,
      )
      .run();
  }

  async updateStockCounts(
    skuId: string,
    reservedCount: number,
    confirmedCount: number,
    expectedVersion: number,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        `UPDATE inventory
        SET reserved_count = ?, confirmed_count = ?, version = version + 1, updated_at = ?
        WHERE sku_id = ? AND version = ?`,
      )
      .bind(reservedCount, confirmedCount, now, skuId, expectedVersion)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async adjustTotalStock(
    skuId: string,
    adjustment: number,
  ): Promise<Inventory | null> {
    const now = new Date().toISOString();
    // Use a CTE to do a conditional update
    const result = await this.db
      .prepare(
        `UPDATE inventory
        SET total_stock = total_stock + ?, version = version + 1, updated_at = ?
        WHERE sku_id = ? AND (total_stock + ?) >= 0`,
      )
      .bind(adjustment, now, skuId, adjustment)
      .run();

    if ((result.meta?.changes ?? 0) === 0) {
      return null;
    }

    return this.findBySkuId(skuId);
  }

  async incrementReservedCount(skuId: string, quantity: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE inventory
        SET reserved_count = reserved_count + ?, version = version + 1, updated_at = ?
        WHERE sku_id = ?`,
      )
      .bind(quantity, now, skuId)
      .run();
  }

  async decrementReservedCount(skuId: string, quantity: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE inventory
        SET reserved_count = MAX(0, reserved_count - ?), version = version + 1, updated_at = ?
        WHERE sku_id = ?`,
      )
      .bind(quantity, now, skuId)
      .run();
  }

  async moveReservedToConfirmed(skuId: string, quantity: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE inventory
        SET reserved_count = MAX(0, reserved_count - ?),
            confirmed_count = confirmed_count + ?,
            version = version + 1,
            updated_at = ?
        WHERE sku_id = ?`,
      )
      .bind(quantity, quantity, now, skuId)
      .run();
  }
}
