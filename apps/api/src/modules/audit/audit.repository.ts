import type { AuditLog } from '@factory-vision/domain-types';
import { asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `audit_log`, append-only.
 *
 * An audit trail that a restart can erase is not an audit trail. It is the
 * evidence an ISO or BPOM auditor asks for, and the record of who approved a
 * data correction, so it belongs in the database from the moment it is
 * written rather than in an array the next deployment discards.
 *
 * Nothing here updates or deletes: a correction is a new row, never an edit to
 * an old one.
 */
const COLUMNS = `
  id, tenant_id, actor_type, actor_id, entity_type, entity_id, action,
  previous_value, new_value, ip, user_agent, occurred_at
`;

interface Row {
  id: string;
  tenant_id: string;
  actor_type: string;
  actor_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  previous_value: unknown;
  new_value: unknown;
  ip: string | null;
  user_agent: string | null;
  occurred_at: Date | string;
}

function toDomain(row: Row): AuditLog {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorType: row.actor_type as AuditLog['actorType'],
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    previousValue: row.previous_value ?? undefined,
    newValue: row.new_value ?? undefined,
    ip: orUndefined(row.ip),
    userAgent: orUndefined(row.user_agent),
    occurredAt: asIsoString(row.occurred_at),
  };
}

export class AuditRepository {
  async insert(exec: Executor, entry: AuditLog): Promise<AuditLog> {
    const result = await exec.query<Row>(
      `INSERT INTO audit_log (
         id, tenant_id, actor_type, actor_id, entity_type, entity_id, action,
         previous_value, new_value, ip, user_agent, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${COLUMNS}`,
      [
        entry.id,
        entry.tenantId,
        entry.actorType,
        entry.actorId,
        entry.entityType,
        entry.entityId,
        entry.action,
        // The columns are JSONB, so the value travels as JSON rather than as a
        // string that would come back quoted.
        entry.previousValue === undefined ? null : JSON.stringify(entry.previousValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.occurredAt,
      ]
    );
    return toDomain(result.rows[0]);
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { entityType?: string; action?: string; limit?: number; offset?: number } = {}
  ): Promise<AuditLog[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.entityType) {
      params.push(filter.entityType);
      where.push(`entity_type = $${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      where.push(`action = $${params.length}`);
    }

    params.push(Math.min(filter.limit ?? 500, 5000));
    const limit = `LIMIT $${params.length}`;
    params.push(filter.offset ?? 0);
    const offset = `OFFSET $${params.length}`;

    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM audit_log
        WHERE ${where.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
        ${limit} ${offset}`,
      params
    );
    return result.rows.map(toDomain);
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM audit_log WHERE tenant_id = $1',
      [tenantId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
