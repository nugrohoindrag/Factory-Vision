import type { EventHistoryQuery, OperationalEvent } from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { EventRepository } from './event.repository.js';

/** What a caller supplies; the service fills in the id and the timestamp. */
export type EventInput = Omit<OperationalEvent, 'id' | 'occurredAt'> & { occurredAt?: string };

/**
 * Operational Event History (Improvement PRD §10).
 *
 * Every capability the improvement adds writes here, which is what lets one
 * screen answer "apa yang terjadi pada WO ini" without each module inventing
 * its own timeline. The audit trail is deliberately not reused: it records
 * field-level changes as evidence, this records shop-floor happenings as a
 * story, and merging them would make both harder to read.
 *
 * Writes are append-only and never block the operation that caused them —
 * `record` throws, `recordDetached` does not, and callers whose work is
 * already committed use the latter.
 */
export class EventService {
  private readonly repo = new EventRepository();

  async record(input: EventInput): Promise<OperationalEvent> {
    const event: OperationalEvent = {
      ...input,
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };
    return withTenant(event.tenantId, (client) => this.repo.insert(client, event));
  }

  /**
   * Records without making the caller wait.
   *
   * An event history that fails to write is a gap in a timeline, not a
   * corrupted transaction: the production record it describes is already
   * committed, so a database hiccup must not turn a successful output entry
   * into a 500 on the operator's terminal.
   */
  recordDetached(input: EventInput): void {
    this.record(input).catch((error) => {
      // eslint-disable-next-line no-console
      console.error(
        `[event] failed to record ${input.eventType} for ${input.entityType}:${input.entityId}:`,
        error instanceof Error ? error.message : error
      );
    });
  }

  /** Records several events as one transaction, so a lifecycle step is whole. */
  async recordAll(tenantId: string, inputs: EventInput[]): Promise<OperationalEvent[]> {
    if (inputs.length === 0) return [];
    const stamped = inputs.map((input, index) => ({
      ...input,
      id: `evt-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    })) as OperationalEvent[];
    return withTenant(tenantId, async (client) => {
      const written: OperationalEvent[] = [];
      for (const event of stamped) written.push(await this.repo.insert(client, event));
      return written;
    });
  }

  async list(tenantId: string, query: EventHistoryQuery = {}): Promise<OperationalEvent[]> {
    return withTenant(tenantId, (client) => this.repo.list(client, tenantId, query));
  }

  /** The timeline of one entity, oldest first — the order §10.3 shows it in. */
  async timeline(
    tenantId: string,
    entityType: NonNullable<EventHistoryQuery['entityType']>,
    entityId: string,
    limit = 500
  ): Promise<OperationalEvent[]> {
    const events = await this.list(tenantId, { entityType, entityId, limit });
    return events.reverse();
  }

  async summary(tenantId: string, sinceDays = 7): Promise<Array<{ eventType: string; count: number }>> {
    const from = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    return withTenant(tenantId, (client) => this.repo.countByType(client, tenantId, from));
  }
}
