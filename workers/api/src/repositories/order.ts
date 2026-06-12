import type { Order, OrderStatus } from '../types/index.js';

export class OrderRepository {
  constructor(private db: D1Database) {}

  async findById(id: string): Promise<Order | null> {
    const result = await this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .bind(id)
      .first<Order>();
    return result ?? null;
  }

  async findByReservationId(reservationId: string): Promise<Order | null> {
    const result = await this.db
      .prepare('SELECT * FROM orders WHERE reservation_id = ?')
      .bind(reservationId)
      .first<Order>();
    return result ?? null;
  }

  async findByConfirmationIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    const result = await this.db
      .prepare('SELECT * FROM orders WHERE confirmation_idempotency_key = ?')
      .bind(idempotencyKey)
      .first<Order>();
    return result ?? null;
  }

  async create(order: Order): Promise<void> {
    await this.db
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
      )
      .run();
  }

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, id)
      .run();
  }

  async findWithFilters(
    filters: { status?: OrderStatus },
    page: number,
    limit: number,
  ): Promise<{ results: Order[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.status) {
      conditions.push('o.status = ?');
      values.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      this.db
        .prepare(`SELECT COUNT(*) as total FROM orders o ${whereClause}`)
        .bind(...values)
        .first<{ total: number }>(),
      this.db
        .prepare(
          `SELECT o.* FROM orders o ${whereClause}
          ORDER BY o.created_at DESC
          LIMIT ? OFFSET ?`,
        )
        .bind(...values, limit, offset)
        .all<Order>(),
    ]);

    return {
      results: dataResult.results,
      total: countResult?.total ?? 0,
    };
  }
}
