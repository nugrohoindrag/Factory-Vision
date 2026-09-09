import type { EventHistoryQuery, OperationalEvent } from '@factory-vision/domain-types';
import { asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `operational_event`, append-only (BR-E01, BR-E02).
 *
 * There is no update and no delete here, and the application role does not
 * hold either privilege on the table, so the two agree. Migration 026 carries
 * the grant.
 */
const COLUMNS = `
  id, tenant_id, event_type, entity_type, entity_id,
  actor_type, actor_id, actor_name, occurred_at,
  plant_id, line_id, machine_id, process_id, work_order_id, batch_id,
  summary, before_value, after_value, metadata
`;

interface Row {
  id: string;
  tenant_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: Date | string;
  plant_id: string | null;
  line_id: string | null;
  machine_id: string | null;
  process_id: string | null;
  work_order_id: string | null;
  batch_id: string | null;
  summary: string;
  before_value: unknown;
  after_value: unknown;
  metadata: Record<string, unknown> | null;
}

function toDomain(row: Row): OperationalEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type as OperationalEvent['eventType'],
    entityType: row.entity_type as OperationalEvent['entityType'],
    entityId: row.entity_id,
    actorType: row.actor_type as OperationalEvent['actorType'],
    actorId: orUndefined(row.actor_id),
    actorName: orUndefined(row.actor_name),
    occurredAt: asIsoString(row.occurred_at),
    plantId: orUndefined(row.plant_id),
    lineId: orUndefined(row.line_id),
    machineId: orUndefined(row.machine_id),
    processId: orUndefined(row.process_id),
    workOrderId: orUndefined(row.work_order_id),
    batchId: orUndefined(row.batch_id),
    summary: row.summary,
    beforeValue: row.before_value ?? undefined,
    afterValue: row.after_value ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

export class EventRepository {
  async insert(exec: Executor, event: OperationalEvent): Promise<OperationalEvent> {
    const result = await exec.query<Row>(
      `INSERT INTO operational_event (
         id, tenant_id, event_type, entity_type, entity_id,
         actor_type, actor_id, actor_name, occurred_at,
         plant_id, line_id, machine_id, process_id, work_order_id, batch_id,
         summary, before_value, after_value, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING ${COLUMNS}`,
      [
        event.id,
        event.tenantId,
        event.eventType,
        event.entityType,
        event.entityId,
        event.actorType,
        event.actorId ?? null,
        event.actorName ?? null,
        event.occurredAt,
        event.plantId ?? null,
        event.lineId ?? null,
        event.machineId ?? null,
        event.processId ?? null,
        event.workOrderId ?? null,
        event.batchId ?? null,
        event.summary,
        event.beforeValue === undefined ? null : JSON.stringify(event.beforeValue),
        event.afterValue === undefined ? null : JSON.stringify(event.afterValue),
        event.metadata === undefined ? null : JSON.stringify(event.metadata),
      ]
    );
    return toDomain(result.rows[0]);
  }

  /**
   * The timeline.
   *
   * An entity's history is not only the events whose subject it is: a downtime
   * on a machine belongs in that machine's timeline, and so does the
   * maintenance that followed, even though the maintenance record is its own
   * subject. So a lookup by `entityType`/`entityId` also matches the
   * denormalised context columns (BR-E04).
   */
  async list(exec: Executor, tenantId: string, query: EventHistoryQuery = {}): Promise<OperationalEvent[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (query.entityType && query.entityId) {
      params.push(query.entityType, query.entityId);
      const typeParam = `$${params.length - 1}`;
      const idParam = `$${params.length}`;
      const contextColumn = CONTEXT_COLUMN[query.entityType];
      const clauses = [`(entity_type = ${typeParam} AND entity_id = ${idParam})`];
      if (contextColumn) clauses.push(`${contextColumn} = ${idParam}`);
      where.push(`(${clauses.join(' OR ')})`);
    } else if (query.entityType) {
      params.push(query.entityType);
      where.push(`entity_type = $${params.length}`);
    }

    if (query.eventType) {
      params.push(query.eventType);
      where.push(`event_type = $${params.length}`);
    }
    if (query.workOrderId) {
      params.push(query.workOrderId);
      where.push(`work_order_id = $${params.length}`);
    }
    if (query.machineId) {
      params.push(query.machineId);
      where.push(`machine_id = $${params.length}`);
    }
    if (query.batchId) {
      params.push(query.batchId);
      where.push(`batch_id = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      where.push(`occurred_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`occurred_at <= $${params.length}`);
    }

    params.push(Math.min(query.limit ?? 200, 2000));
    const limit = `LIMIT $${params.length}`;
    params.push(query.offset ?? 0);
    const offset = `OFFSET $${params.length}`;

    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM operational_event
        WHERE ${where.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
        ${limit} ${offset}`,
      params
    );
    return result.rows.map(toDomain);
  }

  async countByType(
    exec: Executor,
    tenantId: string,
    from: string
  ): Promise<Array<{ eventType: string; count: number }>> {
    const result = await exec.query<{ event_type: string; n: string }>(
      `SELECT event_type, count(*)::text AS n
         FROM operational_event
        WHERE tenant_id = $1 AND occurred_at >= $2
        GROUP BY event_type
        ORDER BY count(*) DESC`,
      [tenantId, from]
    );
    return result.rows.map((row) => ({ eventType: row.event_type, count: Number(row.n) }));
  }
}

/**
 * Which denormalised column also carries an entity of this type.
 *
 * Only the ones a timeline is actually asked for; a material or an NCR has no
 * context column, so it matches on subject alone.
 */
const CONTEXT_COLUMN: Partial<Record<string, string>> = {
  WORK_ORDER: 'work_order_id',
  MACHINE: 'machine_id',
  BATCH: 'batch_id',
};
