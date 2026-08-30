import { DowntimeStatus } from '@factory-vision/domain-types';
import type { DowntimeRecord } from '@factory-vision/domain-types';
import {
  asDateString,
  asIsoString,
  asOptionalIsoString,
  orUndefined,
  type Executor,
} from '../../platform/db/executor.js';

/**
 * `downtime_record` (persistence fix §9).
 *
 * Downtime is one half of Availability, so losing it does not just lose a
 * Pareto chart: it silently inflates every OEE figure that follows, because
 * unrecorded stops look like running time. An ACTIVE downtime is also live
 * operational state, a machine that is down right now, which must survive an
 * API restart or the board comes back showing the line as running.
 */
const COLUMNS = `
  id, tenant_id, work_order_id, process_id, machine_id, line_id, operator_id,
  shift_id, to_char(shift_date, 'YYYY-MM-DD') AS shift_date, reason_id,
  start_time, end_time, duration_seconds, is_planned, notes, client_event_id, status
`;

interface Row {
  id: string;
  tenant_id: string;
  work_order_id: string | null;
  process_id: string | null;
  machine_id: string;
  line_id: string;
  operator_id: string | null;
  shift_id: string;
  shift_date: string;
  reason_id: string;
  start_time: Date | string;
  end_time: Date | string | null;
  duration_seconds: number | null;
  is_planned: boolean | null;
  notes: string | null;
  client_event_id: string;
  status: string | null;
}

function toDomain(row: Row): DowntimeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workOrderId: orUndefined(row.work_order_id),
    processId: orUndefined(row.process_id),
    machineId: row.machine_id,
    lineId: row.line_id,
    operatorId: orUndefined(row.operator_id),
    shiftId: row.shift_id,
    shiftDate: asDateString(row.shift_date),
    reasonId: row.reason_id,
    startTime: asIsoString(row.start_time),
    endTime: asOptionalIsoString(row.end_time),
    durationSeconds: row.duration_seconds === null ? undefined : Number(row.duration_seconds),
    isPlanned: Boolean(row.is_planned),
    notes: orUndefined(row.notes),
    clientEventId: row.client_event_id,
    status: (row.status as DowntimeStatus) ?? DowntimeStatus.ACTIVE,
  };
}

export class DowntimeRepository {
  /** Inserts, or returns the record this client event already produced. */
  async create(
    exec: Executor,
    record: DowntimeRecord
  ): Promise<{ record: DowntimeRecord; created: boolean }> {
    const inserted = await exec.query<Row>(
      `INSERT INTO downtime_record (
         id, tenant_id, work_order_id, process_id, machine_id, line_id, operator_id,
         shift_id, shift_date, reason_id, start_time, end_time, duration_seconds,
         is_planned, notes, client_event_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (tenant_id, client_event_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        record.id,
        record.tenantId,
        record.workOrderId ?? null,
        record.processId ?? null,
        record.machineId,
        record.lineId,
        record.operatorId ?? null,
        record.shiftId,
        record.shiftDate,
        record.reasonId,
        record.startTime,
        record.endTime ?? null,
        record.durationSeconds ?? null,
        record.isPlanned,
        record.notes ?? null,
        record.clientEventId,
        record.status,
      ]
    );

    if (inserted.rows.length > 0) {
      return { record: toDomain(inserted.rows[0]), created: true };
    }

    const existing = await this.findByClientEventId(exec, record.tenantId, record.clientEventId);
    if (!existing) {
      throw new Error(`downtime_record ${record.clientEventId} conflicted but could not be read back.`);
    }
    return { record: existing, created: false };
  }

  /**
   * Closes an open downtime.
   *
   * The `status = 'ACTIVE'` guard makes the update idempotent: a duplicate
   * resolve from a terminal that retried its queue changes no row, so the
   * original duration stands rather than being stretched to the retry's clock.
   */
  async resolve(
    exec: Executor,
    tenantId: string,
    id: string,
    endTime: string,
    durationSeconds: number
  ): Promise<DowntimeRecord | undefined> {
    const result = await exec.query<Row>(
      `UPDATE downtime_record
          SET end_time = $3, duration_seconds = $4, status = $5
        WHERE tenant_id = $1 AND id = $2 AND status = $6
        RETURNING ${COLUMNS}`,
      [tenantId, id, endTime, durationSeconds, DowntimeStatus.RESOLVED, DowntimeStatus.ACTIVE]
    );
    if (result.rows[0]) return toDomain(result.rows[0]);
    return this.findById(exec, tenantId, id);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<DowntimeRecord | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM downtime_record WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async findByClientEventId(
    exec: Executor,
    tenantId: string,
    clientEventId: string
  ): Promise<DowntimeRecord | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM downtime_record WHERE tenant_id = $1 AND client_event_id = $2`,
      [tenantId, clientEventId]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /** The open downtime on a machine, if it is down right now. */
  async findActiveForMachine(
    exec: Executor,
    tenantId: string,
    machineId: string
  ): Promise<DowntimeRecord | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM downtime_record
        WHERE tenant_id = $1 AND machine_id = $2 AND status = $3
        ORDER BY start_time DESC LIMIT 1`,
      [tenantId, machineId, DowntimeStatus.ACTIVE]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async findActiveForWorkOrder(
    exec: Executor,
    tenantId: string,
    workOrderId: string
  ): Promise<DowntimeRecord | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM downtime_record
        WHERE tenant_id = $1 AND work_order_id = $2 AND status = $3
        ORDER BY start_time DESC LIMIT 1`,
      [tenantId, workOrderId, DowntimeStatus.ACTIVE]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listActive(exec: Executor, tenantId: string): Promise<DowntimeRecord[]> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM downtime_record
        WHERE tenant_id = $1 AND status = $2
        ORDER BY start_time DESC`,
      [tenantId, DowntimeStatus.ACTIVE]
    );
    return result.rows.map(toDomain);
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: {
      lineId?: string;
      fromShiftDate?: string;
      toShiftDate?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<DowntimeRecord[]> {
    const where: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.lineId) {
      params.push(filter.lineId);
      where.push(`line_id = $${params.length}`);
    }
    if (filter.fromShiftDate) {
      params.push(filter.fromShiftDate);
      where.push(`shift_date >= $${params.length}::date`);
    }
    if (filter.toShiftDate) {
      params.push(filter.toShiftDate);
      where.push(`shift_date <= $${params.length}::date`);
    }

    params.push(Math.min(filter.limit ?? 5000, 20000));
    const limitClause = `LIMIT $${params.length}`;
    params.push(filter.offset ?? 0);
    const offsetClause = `OFFSET $${params.length}`;

    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM downtime_record
        WHERE ${where.join(' AND ')}
        ORDER BY start_time ASC, id ASC
        ${limitClause} ${offsetClause}`,
      params
    );
    return result.rows.map(toDomain);
  }

  async createMany(exec: Executor, records: DowntimeRecord[]): Promise<number> {
    let created = 0;
    for (const record of records) {
      const result = await this.create(exec, record);
      if (result.created) created += 1;
    }
    return created;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM downtime_record WHERE tenant_id = $1',
      [tenantId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
