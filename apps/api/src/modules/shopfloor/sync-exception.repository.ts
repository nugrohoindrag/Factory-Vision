import { randomUUID } from 'crypto';
import { asDateString, asOptionalIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `sync_exception` — records the shop floor captured and the server refused
 * (MES-082).
 *
 * The point of the table is that a rejection is *reported*, never discarded.
 * Before this, `syncBatch` answered the terminal and forgot; the only copy of
 * the rejection lived in that tablet's IndexedDB, so a supervisor could not see
 * it and a reinstalled tablet lost it. Production that physically happened
 * deserves better than that.
 *
 * Writes are upserts on `client_event_id`: a terminal that retries a
 * permanently-rejected command must update its exception, not file a second
 * one, or one bad shift fills the list with copies of a single problem.
 */

export interface SyncException {
  id: string;
  tenantId: string;
  clientEventId: string;
  commandType: string;
  workOrderId?: string;
  operatorId?: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
  errorCode: string;
  reason: string;
  retryable: boolean;
  lineId?: string;
  shiftDate?: string;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt?: string;
  /** Joined for display, so a supervisor sees a number rather than an id. */
  workOrderNumber?: string;
  lineName?: string;
}

interface Row {
  id: string;
  tenant_id: string;
  client_event_id: string;
  command_type: string;
  work_order_id: string | null;
  operator_id: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: Date | string | null;
  error_code: string;
  reason: string;
  retryable: boolean;
  line_id: string | null;
  shift_date: Date | string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  resolution_note: string | null;
  created_at: Date | string | null;
  work_order_number?: string | null;
  line_name?: string | null;
}

function toDomain(row: Row): SyncException {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientEventId: row.client_event_id,
    commandType: row.command_type,
    workOrderId: orUndefined(row.work_order_id),
    operatorId: orUndefined(row.operator_id),
    payload: row.payload ?? {},
    occurredAt: asOptionalIsoString(row.occurred_at),
    errorCode: row.error_code,
    reason: row.reason,
    retryable: row.retryable,
    lineId: orUndefined(row.line_id),
    shiftDate: row.shift_date ? asDateString(row.shift_date) : undefined,
    status: row.status as SyncException['status'],
    resolvedBy: orUndefined(row.resolved_by),
    resolvedAt: asOptionalIsoString(row.resolved_at),
    resolutionNote: orUndefined(row.resolution_note),
    createdAt: asOptionalIsoString(row.created_at),
    workOrderNumber: orUndefined(row.work_order_number ?? null),
    lineName: orUndefined(row.line_name ?? null),
  };
}

export interface RecordExceptionInput {
  tenantId: string;
  clientEventId: string;
  commandType: string;
  workOrderId?: string;
  operatorId?: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
  errorCode: string;
  reason: string;
  retryable: boolean;
  lineId?: string;
  shiftDate?: string;
}

export interface SyncExceptionFilter {
  lineId?: string;
  shiftDate?: string;
  status?: string;
  workOrderId?: string;
  limit?: number;
}

const COLUMNS = `
  e.id, e.tenant_id, e.client_event_id, e.command_type, e.work_order_id, e.operator_id,
  e.payload, e.occurred_at, e.error_code, e.reason, e.retryable, e.line_id, e.shift_date,
  e.status, e.resolved_by, e.resolved_at, e.resolution_note, e.created_at
`;

export class SyncExceptionRepository {
  async record(exec: Executor, input: RecordExceptionInput): Promise<SyncException> {
    const result = await exec.query<Row>(
      `INSERT INTO sync_exception (
         id, tenant_id, client_event_id, command_type, work_order_id, operator_id,
         payload, occurred_at, error_code, reason, retryable, line_id, shift_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (tenant_id, client_event_id) DO UPDATE SET
         error_code = EXCLUDED.error_code,
         reason = EXCLUDED.reason,
         retryable = EXCLUDED.retryable,
         payload = EXCLUDED.payload,
         -- A retry of something already resolved reopens it: the problem is
         -- evidently still happening, and a supervisor should see it again.
         status = CASE WHEN sync_exception.status = 'OPEN' THEN 'OPEN' ELSE 'OPEN' END,
         resolved_by = NULL,
         resolved_at = NULL
       RETURNING ${COLUMNS.replace(/e\./g, '')}`,
      [
        `syncex-${randomUUID()}`,
        input.tenantId,
        input.clientEventId,
        input.commandType,
        input.workOrderId ?? null,
        input.operatorId ?? null,
        JSON.stringify(input.payload ?? {}),
        input.occurredAt ?? null,
        input.errorCode,
        input.reason,
        input.retryable,
        input.lineId ?? null,
        input.shiftDate ?? null,
      ]
    );
    return toDomain(result.rows[0]);
  }

  /**
   * Clears an exception once the same command finally succeeds.
   *
   * A retryable rejection that later applies is not a problem any more, and
   * leaving it OPEN would train supervisors to ignore the list.
   */
  async resolveByEvent(
    exec: Executor,
    tenantId: string,
    clientEventId: string,
    note: string
  ): Promise<void> {
    await exec.query(
      `UPDATE sync_exception
          SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP,
              resolved_by = 'system', resolution_note = $3
        WHERE tenant_id = $1 AND client_event_id = $2 AND status = 'OPEN'`,
      [tenantId, clientEventId, note]
    );
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: SyncExceptionFilter = {}
  ): Promise<SyncException[]> {
    const where = ['e.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.lineId) {
      params.push(filter.lineId);
      where.push(`e.line_id = $${params.length}`);
    }
    if (filter.shiftDate) {
      params.push(filter.shiftDate);
      where.push(`e.shift_date = $${params.length}::date`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`e.status = $${params.length}`);
    }
    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`e.work_order_id = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 200, 500));

    const result = await exec.query<Row>(
      `SELECT ${COLUMNS},
              wo.wo_number AS work_order_number,
              pl.name AS line_name
         FROM sync_exception e
         LEFT JOIN work_order wo ON wo.id = e.work_order_id AND wo.tenant_id = e.tenant_id
         LEFT JOIN production_line pl ON pl.id = e.line_id AND pl.tenant_id = e.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return result.rows.map(toDomain);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<SyncException | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS}, NULL AS work_order_number, NULL AS line_name
         FROM sync_exception e WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async setStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: 'RESOLVED' | 'IGNORED' | 'OPEN',
    actorId: string,
    note?: string
  ): Promise<SyncException | undefined> {
    const result = await exec.query<Row>(
      `UPDATE sync_exception
          SET status = $3::varchar,
              -- Cast explicitly: without it PostgreSQL has to deduce one type
              -- for $3 from a varchar column and a text comparison at once, and
              -- refuses rather than guessing.
              resolved_by = CASE WHEN $3::varchar = 'OPEN' THEN NULL ELSE $4::varchar END,
              resolved_at = CASE WHEN $3::varchar = 'OPEN' THEN NULL ELSE CURRENT_TIMESTAMP END,
              resolution_note = $5::text
        WHERE tenant_id = $1 AND id = $2
       RETURNING ${COLUMNS.replace(/e\./g, '')}, NULL AS work_order_number, NULL AS line_name`,
      [tenantId, id, status, actorId, note ?? null]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /** Open counts per line, for the badge a supervisor sees before drilling in. */
  async openSummary(
    exec: Executor,
    tenantId: string
  ): Promise<Array<{ lineId?: string; lineName?: string; count: number }>> {
    const result = await exec.query<{ line_id: string | null; line_name: string | null; n: string }>(
      `SELECT e.line_id, pl.name AS line_name, count(*)::text AS n
         FROM sync_exception e
         LEFT JOIN production_line pl ON pl.id = e.line_id AND pl.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1 AND e.status = 'OPEN'
        GROUP BY e.line_id, pl.name
        ORDER BY count(*) DESC`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      lineId: orUndefined(row.line_id),
      lineName: orUndefined(row.line_name),
      count: Number(row.n),
    }));
  }
}
