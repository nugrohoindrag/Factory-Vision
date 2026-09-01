import { randomUUID } from 'crypto';
import type { Executor } from '../../../platform/db/executor.js';
import type { PlanningEvent } from '../domain/planning.events.js';

/**
 * `outbox_event` (MES-020-3).
 *
 * The row is written with the **same `Executor` as the data change**, which is
 * the whole mechanism: an event for a transaction that rolled back cannot
 * exist, and a committed change cannot go unannounced. That is what a direct
 * cross-module call cannot give you — it succeeds or fails independently of the
 * write it is reporting.
 *
 * Publication is a separate concern: a relay marks rows `PUBLISHED` once a
 * consumer has them. Nothing here waits for that, so a slow consumer never
 * slows down planning.
 */

export interface OutboxRow {
  id: string;
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  publishedAt?: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
}

export class OutboxRepository {
  /** Appends one event. Must be called with the transaction's own client. */
  async publish(
    exec: Executor,
    tenantId: string,
    event: PlanningEvent
  ): Promise<string> {
    const id = `evt-${randomUUID()}`;
    await exec.query(
      `INSERT INTO outbox_event (
         id, tenant_id, event_type, aggregate_type, aggregate_id, payload, occurred_at, status
       ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'PENDING')`,
      [
        id,
        tenantId,
        event.type,
        event.aggregateType,
        event.aggregateId,
        JSON.stringify(event.payload ?? {}),
      ]
    );
    return id;
  }

  async publishAll(exec: Executor, tenantId: string, events: PlanningEvent[]): Promise<string[]> {
    const ids: string[] = [];
    for (const event of events) {
      ids.push(await this.publish(exec, tenantId, event));
    }
    return ids;
  }

  /** Events waiting for a consumer, oldest first. */
  async pending(exec: Executor, tenantId: string, limit = 100): Promise<OutboxRow[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      occurred_at: Date | string;
      published_at: Date | string | null;
      status: string;
    }>(
      `SELECT id, tenant_id, event_type, aggregate_type, aggregate_id, payload,
              occurred_at, published_at, status
         FROM outbox_event
        WHERE tenant_id = $1 AND status = 'PENDING'
        ORDER BY occurred_at, id
        LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload ?? {},
      occurredAt: String(row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at),
      publishedAt:
        row.published_at === null
          ? undefined
          : String(row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at),
      status: row.status as OutboxRow['status'],
    }));
  }

  /** Everything ever published about one aggregate, for traceability. */
  async forAggregate(
    exec: Executor,
    tenantId: string,
    aggregateType: string,
    aggregateId: string
  ): Promise<OutboxRow[]> {
    const result = await exec.query<{ id: string }>(
      `SELECT id FROM outbox_event
        WHERE tenant_id = $1 AND aggregate_type = $2 AND aggregate_id = $3
        ORDER BY occurred_at, id`,
      [tenantId, aggregateType, aggregateId]
    );
    if (result.rows.length === 0) return [];
    const ids = result.rows.map((r) => r.id);
    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      occurred_at: Date | string;
      published_at: Date | string | null;
      status: string;
    }>(
      `SELECT id, tenant_id, event_type, aggregate_type, aggregate_id, payload,
              occurred_at, published_at, status
         FROM outbox_event WHERE tenant_id = $1 AND id = ANY($2)
        ORDER BY occurred_at, id`,
      [tenantId, ids]
    );
    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload ?? {},
      occurredAt: String(row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at),
      publishedAt:
        row.published_at === null
          ? undefined
          : String(row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at),
      status: row.status as OutboxRow['status'],
    }));
  }

  async markPublished(exec: Executor, tenantId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await exec.query(
      `UPDATE outbox_event
          SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = ANY($2) AND status = 'PENDING'`,
      [tenantId, ids]
    );
    return result.rowCount ?? 0;
  }

  async markFailed(exec: Executor, tenantId: string, id: string, error: string): Promise<void> {
    await exec.query(
      `UPDATE outbox_event
          SET status = 'FAILED', attempts = attempts + 1, last_error = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, error.slice(0, 2000)]
    );
  }
}
