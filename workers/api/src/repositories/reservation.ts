import type { Reservation, ReservationStatus } from '../types/index.js';

export class ReservationRepository {
  constructor(private db: D1Database) {}

  async findById(id: string): Promise<Reservation | null> {
    const result = await this.db
      .prepare('SELECT * FROM reservations WHERE id = ?')
      .bind(id)
      .first<Reservation>();
    return result ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<Reservation | null> {
    const result = await this.db
      .prepare('SELECT * FROM reservations WHERE idempotency_key = ?')
      .bind(key)
      .first<Reservation>();
    return result ?? null;
  }

  async create(reservation: Reservation): Promise<void> {
    await this.db
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
      )
      .run();
  }

  async updateStatus(id: string, status: ReservationStatus): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, id)
      .run();
  }

  async findExpiredPending(skuId: string, now: string): Promise<Reservation[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM reservations
        WHERE sku_id = ? AND status = 'pending' AND expires_at <= ?`,
      )
      .bind(skuId, now)
      .all<Reservation>();
    return result.results;
  }

  async findAllExpiredPending(now: string): Promise<Reservation[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM reservations
        WHERE status = 'pending' AND expires_at <= ?
        ORDER BY expires_at ASC`,
      )
      .bind(now)
      .all<Reservation>();
    return result.results;
  }

  async bulkExpire(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    // D1 doesn't support array binds, so batch individual updates
    const batch = ids.map((id) =>
      this.db
        .prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
        .bind('expired', now, id),
    );
    await this.db.batch(batch);
  }

  async findPendingBySkuId(skuId: string): Promise<Reservation[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM reservations
        WHERE sku_id = ? AND status = 'pending' AND expires_at > ?
        ORDER BY created_at ASC`,
      )
      .bind(skuId, new Date().toISOString())
      .all<Reservation>();
    return result.results;
  }

  async findWithFilters(
    filters: {
      status?: ReservationStatus;
      sku_id?: string;
      user_id?: string;
    },
    page: number,
    limit: number,
  ): Promise<{ results: Reservation[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.status) {
      conditions.push('r.status = ?');
      values.push(filters.status);
    }
    if (filters.sku_id) {
      conditions.push('r.sku_id = ?');
      values.push(filters.sku_id);
    }
    if (filters.user_id) {
      conditions.push('r.user_id = ?');
      values.push(filters.user_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      this.db
        .prepare(`SELECT COUNT(*) as total FROM reservations r ${whereClause}`)
        .bind(...values)
        .first<{ total: number }>(),
      this.db
        .prepare(
          `SELECT r.* FROM reservations r ${whereClause}
          ORDER BY r.created_at DESC
          LIMIT ? OFFSET ?`,
        )
        .bind(...values, limit, offset)
        .all<Reservation>(),
    ]);

    return {
      results: dataResult.results,
      total: countResult?.total ?? 0,
    };
  }
}
