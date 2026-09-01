import { query, withTenant } from '../db/pool.js';

/**
 * The outbox publisher (Architecture §176, `platform/outbox/`).
 *
 * Planning writes an `outbox_event` row in the same transaction as the change
 * that caused it, which is what makes the event trustworthy: it cannot exist
 * for a rolled-back change, nor a committed change go unannounced. Until now
 * nothing ever read those rows — every event written since Sprint 3 sat
 * `PENDING` for ever, so "diterbitkan lewat outbox" was only half true.
 *
 * This is the other half. One transaction per batch: rows are locked with
 * `FOR UPDATE SKIP LOCKED`, delivered to the subscribers, and marked
 * `PUBLISHED` before the lock is released. Holding the lock across delivery is
 * what removes the need for an in-flight status and a stale-claim sweeper — a
 * relay that dies mid-batch simply rolls back, and the rows are still `PENDING`
 * for whoever polls next. It costs an open transaction for as long as delivery
 * takes, which is why `batchSize` is small and why a subscriber is expected to
 * hand off rather than block (the realtime gateway emits and returns).
 *
 * Delivery is **at-least-once**: a crash between a subscriber running and the
 * commit replays the event. A subscriber must therefore tolerate seeing one
 * twice. Marking first would lose events instead, and a lost
 * `ProductionPlanConfirmed` is worse than a repeated one.
 */

export interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type OutboxSubscriber = (event: OutboxEvent) => void | Promise<void>;

export interface RelayResult {
  delivered: number;
  failed: number;
}

interface Row {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown> | null;
  occurred_at: Date | string;
}

/** Attempts after which an event stops being retried and stays FAILED. */
const MAX_ATTEMPTS = 5;

function toEvent(row: Row): OutboxEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload ?? {},
    occurredAt:
      row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
  };
}

export class OutboxRelay {
  private readonly subscribers: OutboxSubscriber[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;

  /** Registers a consumer. Every subscriber sees every event. */
  subscribe(subscriber: OutboxSubscriber): void {
    this.subscribers.push(subscriber);
  }

  get subscriberCount(): number {
    return this.subscribers.length;
  }

  /**
   * Delivers up to `batchSize` pending events for one tenant.
   *
   * Scoped to a tenant because §22.4 forbids a job running without one, and
   * because a subscriber that fans out over WebSocket needs the tenant room to
   * emit into.
   */
  async relayTenant(tenantId: string, batchSize = 50): Promise<RelayResult> {
    const failures: Array<{ id: string; error: string }> = [];

    const delivered = await withTenant(tenantId, async (client) => {
      const claimed = await client.query<Row>(
        `SELECT id, tenant_id, event_type, aggregate_type, aggregate_id, payload, occurred_at
           FROM outbox_event
          WHERE tenant_id = $1 AND status = 'PENDING' AND attempts < $3
          ORDER BY occurred_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [tenantId, batchSize, MAX_ATTEMPTS]
      );

      let count = 0;
      for (const row of claimed.rows) {
        const event = toEvent(row);
        try {
          for (const subscriber of this.subscribers) {
            await subscriber(event);
          }
        } catch (error) {
          // One bad event must not cost the rest of the batch its delivery, and
          // its failure must be recorded outside this transaction — recording it
          // here would be rolled back along with nothing, but attempts has to
          // survive even if the batch later fails.
          failures.push({
            id: event.id,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        await client.query(
          `UPDATE outbox_event
              SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP,
                  attempts = attempts + 1, last_error = NULL
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, event.id]
        );
        count += 1;
      }
      return count;
    });

    for (const failure of failures) {
      await withTenant(tenantId, (client) =>
        client.query(
          `UPDATE outbox_event
              SET attempts = attempts + 1,
                  last_error = $3,
                  status = CASE WHEN attempts + 1 >= $4 THEN 'FAILED' ELSE 'PENDING' END
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, failure.id, failure.error.slice(0, 2000), MAX_ATTEMPTS]
        )
      );
    }

    return { delivered, failed: failures.length };
  }

  /** Tenants with something waiting, so a relay loop knows where to look. */
  async tenantsWithPending(): Promise<string[]> {
    const rows = await query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id
         FROM outbox_event
        WHERE status = 'PENDING' AND attempts < $1`,
      [MAX_ATTEMPTS]
    );
    return rows.map((row) => row.tenant_id);
  }

  /**
   * Polls for pending events until stopped.
   *
   * A poll loop rather than `LISTEN/NOTIFY`, for the same reason the job queue
   * polls: the event is already durable in a table, and a notification that can
   * be missed would only be an optimisation on top of the poll that has to
   * exist anyway.
   */
  start(intervalMs = Number(process.env.OUTBOX_RELAY_INTERVAL_MS ?? 5000)): void {
    if (this.timer) return;
    const tick = async (): Promise<void> => {
      if (this.polling) return;
      this.polling = true;
      try {
        await this.relayAll();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          '[outbox] relay error:',
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        this.polling = false;
      }
    };
    this.timer = setInterval(() => void tick(), intervalMs);
    // `unref` so the relay never holds the process open on its own.
    this.timer.unref?.();
    void tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** Delivers for every tenant that has pending events. */
  async relayAll(batchSize = 50): Promise<RelayResult & { tenants: number }> {
    const tenants = await this.tenantsWithPending();
    let delivered = 0;
    let failed = 0;
    for (const tenantId of tenants) {
      const result = await this.relayTenant(tenantId, batchSize);
      delivered += result.delivered;
      failed += result.failed;
    }
    return { delivered, failed, tenants: tenants.length };
  }
}
