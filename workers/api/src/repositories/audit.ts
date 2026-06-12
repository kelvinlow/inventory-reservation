import type { AuditLogEntry, EntityType, AuditAction, ActorType } from '../types/index.js';

export class AuditRepository {
  constructor(private db: D1Database) {}

  async create(entry: AuditLogEntry): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_type, actor_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        entry.entity_type,
        entry.entity_id,
        entry.action,
        entry.actor_type,
        entry.actor_id,
        entry.payload_json,
        entry.created_at,
      )
      .run();
  }

  async log(
    entityType: EntityType,
    entityId: string,
    action: AuditAction,
    actorType: ActorType,
    actorId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor_type: actorType,
      actor_id: actorId,
      payload_json: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    };
    await this.create(entry);
  }

  async findWithFilters(
    filters: {
      entity_type?: EntityType;
      entity_id?: string;
      action?: string;
    },
    page: number,
    limit: number,
  ): Promise<{ results: AuditLogEntry[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.entity_type) {
      conditions.push('entity_type = ?');
      values.push(filters.entity_type);
    }
    if (filters.entity_id) {
      conditions.push('entity_id = ?');
      values.push(filters.entity_id);
    }
    if (filters.action) {
      conditions.push('action = ?');
      values.push(filters.action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      this.db
        .prepare(`SELECT COUNT(*) as total FROM audit_log ${whereClause}`)
        .bind(...values)
        .first<{ total: number }>(),
      this.db
        .prepare(
          `SELECT * FROM audit_log ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
        )
        .bind(...values, limit, offset)
        .all<AuditLogEntry>(),
    ]);

    return {
      results: dataResult.results,
      total: countResult?.total ?? 0,
    };
  }
}
