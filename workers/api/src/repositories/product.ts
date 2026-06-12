import type { Product, ProductWithStock, ProductStatus } from '../types/index.js';

export class ProductRepository {
  constructor(private db: D1Database) {}

  async findById(id: string): Promise<Product | null> {
    const result = await this.db
      .prepare('SELECT * FROM products WHERE id = ?')
      .bind(id)
      .first<Product>();
    return result ?? null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const result = await this.db
      .prepare('SELECT * FROM products WHERE sku = ?')
      .bind(sku)
      .first<Product>();
    return result ?? null;
  }

  async findAllActive(): Promise<ProductWithStock[]> {
    const result = await this.db
      .prepare(
        `SELECT
          p.*,
          COALESCE(i.total_stock, 0) as total_stock,
          COALESCE(i.reserved_count, 0) as reserved_count,
          COALESCE(i.confirmed_count, 0) as confirmed_count,
          COALESCE(i.total_stock, 0) - COALESCE(i.reserved_count, 0) - COALESCE(i.confirmed_count, 0) as available_stock
        FROM products p
        LEFT JOIN inventory i ON p.id = i.sku_id
        WHERE p.status = 'active'
        ORDER BY p.created_at DESC`,
      )
      .all<ProductWithStock>();
    return result.results;
  }

  async findBySkuWithStock(sku: string): Promise<ProductWithStock | null> {
    const result = await this.db
      .prepare(
        `SELECT
          p.*,
          COALESCE(i.total_stock, 0) as total_stock,
          COALESCE(i.reserved_count, 0) as reserved_count,
          COALESCE(i.confirmed_count, 0) as confirmed_count,
          COALESCE(i.total_stock, 0) - COALESCE(i.reserved_count, 0) - COALESCE(i.confirmed_count, 0) as available_stock
        FROM products p
        LEFT JOIN inventory i ON p.id = i.sku_id
        WHERE p.sku = ?`,
      )
      .bind(sku)
      .first<ProductWithStock>();
    return result ?? null;
  }

  async findByIdWithStock(id: string): Promise<ProductWithStock | null> {
    const result = await this.db
      .prepare(
        `SELECT
          p.*,
          COALESCE(i.total_stock, 0) as total_stock,
          COALESCE(i.reserved_count, 0) as reserved_count,
          COALESCE(i.confirmed_count, 0) as confirmed_count,
          COALESCE(i.total_stock, 0) - COALESCE(i.reserved_count, 0) - COALESCE(i.confirmed_count, 0) as available_stock
        FROM products p
        LEFT JOIN inventory i ON p.id = i.sku_id
        WHERE p.id = ?`,
      )
      .bind(id)
      .first<ProductWithStock>();
    return result ?? null;
  }

  async create(product: Product): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO products (id, sku, name, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        product.id,
        product.sku,
        product.name,
        product.description,
        product.status,
        product.created_at,
        product.updated_at,
      )
      .run();
  }

  async update(
    id: string,
    fields: Partial<Pick<Product, 'name' | 'description' | 'status'>>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.name !== undefined) {
      sets.push('name = ?');
      values.push(fields.name);
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      values.push(fields.description);
    }
    if (fields.status !== undefined) {
      sets.push('status = ?');
      values.push(fields.status);
    }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await this.db
      .prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
}
