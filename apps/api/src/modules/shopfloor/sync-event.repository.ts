import type { Executor } from '../../platform/db/executor.js';

/**
 * `sync_event`, the durable idempotency ledger for offline replay (US-046).
 *
 * A tablet that loses Wi-Fi keeps capturing and replays its queue on
 * reconnect, so the server sees the same `client_event_id` more than once and
 * must apply it exactly once. That guarantee used to live in a
 * `Set<string>` on the API process, which meant it evaporated on restart: a
 * terminal replaying after a deployment would have had every queued event
 * recorded a second time, silently doubling the shift's output.
 *
 * Production and downtime records carry their own unique constraint on
 * `(tenant_id, client_event_id)`, so for those this table is a second record
 * of the same fact. It is the only protection for the commands that write no
 * record of their own, the work-order state transitions, which is why it is
 * written for every command type rather than only the ones that need it.
 */
export class SyncEventRepository {
  /**
   * Claims a client event.
   *
   * Returns false when the event was already applied. The insert itself is the
   * check: doing it as `SELECT` then `INSERT` would let two concurrent
   * replays of the same event both see nothing and both proceed.
   */
  async claim(
    exec: Executor,
    tenantId: string,
    clientEventId: string,
    commandType: string,
    workOrderId?: string,
    entityId?: string
  ): Promise<boolean> {
    const result = await exec.query(
      `INSERT INTO sync_event (tenant_id, client_event_id, command_type, work_order_id, entity_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, client_event_id) DO NOTHING`,
      [tenantId, clientEventId, commandType, workOrderId ?? null, entityId ?? null]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Fills in the entity a claimed event produced, once it is known. */
  async attachEntity(
    exec: Executor,
    tenantId: string,
    clientEventId: string,
    entityId: string
  ): Promise<void> {
    await exec.query(
      `UPDATE sync_event SET entity_id = $3
        WHERE tenant_id = $1 AND client_event_id = $2 AND entity_id IS NULL`,
      [tenantId, clientEventId, entityId]
    );
  }

  async has(exec: Executor, tenantId: string, clientEventId: string): Promise<boolean> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM sync_event WHERE tenant_id = $1 AND client_event_id = $2',
      [tenantId, clientEventId]
    );
    return Number(result.rows[0]?.n ?? 0) > 0;
  }

  async findEntityId(
    exec: Executor,
    tenantId: string,
    clientEventId: string
  ): Promise<string | undefined> {
    const result = await exec.query<{ entity_id: string | null }>(
      'SELECT entity_id FROM sync_event WHERE tenant_id = $1 AND client_event_id = $2',
      [tenantId, clientEventId]
    );
    return result.rows[0]?.entity_id ?? undefined;
  }
}
