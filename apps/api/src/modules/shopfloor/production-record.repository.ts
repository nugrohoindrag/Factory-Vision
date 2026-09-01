import { RecordSource } from '@factory-vision/domain-types';
import type { ProductionRecord } from '@factory-vision/domain-types';
import { asDateString, asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `production_record`, the MES system of record (persistence fix §8).
 *
 * Every OEE figure the plant reads is derived from these rows: good and reject
 * quantity feed Quality, quantity against cycle time feeds Performance, and
 * the shift context decides which shift each belongs to. While they lived in a
 * JavaScript array, `docker compose restart api` erased the plant's production
 * history and the dashboard quietly showed different numbers afterwards.
 *
 * `shift_date` is selected with `to_char` rather than as a DATE, because
 * node-postgres would otherwise hand back a JS Date at local midnight and a
 * server west of the database would report the previous day's shift.
 */
const COLUMNS = `
  id, tenant_id, work_order_id, process_id, batch_id, machine_id, operator_id,
  shift_id, to_char(shift_date, 'YYYY-MM-DD') AS shift_date,
  good_quantity, reject_quantity, reject_reason_id, recorded_at, source,
  client_event_id, correction_of_id, notes,
  input_quantity, scrap_quantity, rework_quantity, is_batch_managed, has_child_work_order
`;

interface Row {
  id: string;
  tenant_id: string;
  work_order_id: string;
  process_id: string | null;
  batch_id: string | null;
  input_quantity: number | null;
  scrap_quantity: number | null;
  rework_quantity: number | null;
  is_batch_managed: boolean | null;
  has_child_work_order: boolean | null;
  machine_id: string;
  operator_id: string;
  shift_id: string;
  shift_date: string;
  good_quantity: number;
  reject_quantity: number;
  reject_reason_id: string | null;
  recorded_at: Date | string;
  source: string | null;
  client_event_id: string;
  correction_of_id: string | null;
  notes: string | null;
}

function toDomain(row: Row): ProductionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workOrderId: row.work_order_id,
    processId: orUndefined(row.process_id),
    batchId: orUndefined(row.batch_id),
    machineId: row.machine_id,
    operatorId: row.operator_id,
    shiftId: row.shift_id,
    shiftDate: asDateString(row.shift_date),
    goodQuantity: Number(row.good_quantity ?? 0),
    rejectQuantity: Number(row.reject_quantity ?? 0),
    rejectReasonId: orUndefined(row.reject_reason_id),
    recordedAt: asIsoString(row.recorded_at),
    source: (row.source as RecordSource) ?? RecordSource.OPERATOR_MANUAL,
    clientEventId: row.client_event_id,
    correctionOfId: orUndefined(row.correction_of_id),
    notes: orUndefined(row.notes),
    inputQuantity: Number(row.input_quantity ?? 0),
    scrapQuantity: Number(row.scrap_quantity ?? 0),
    reworkQuantity: Number(row.rework_quantity ?? 0),
    isBatchManaged: Boolean(row.is_batch_managed),
    hasChildWorkOrder: Boolean(row.has_child_work_order),
  };
}

export class ProductionRecordRepository {
  /**
   * Inserts a record, or returns the one this client event already produced.
   *
   * Idempotency is the database's `uq_prod_record_client_event` constraint,
   * not an in-process Set: a shop-floor tablet that comes back from an outage
   * replays its queue (US-046), and after a restart the in-memory set was
   * empty, so every replayed event would have been recorded a second time.
   * `ON CONFLICT DO NOTHING` makes the retry a no-op across restarts and
   * across API instances alike.
   *
   * Returns the stored row, so the caller answers with the persisted values
   * and the database-assigned defaults rather than with its own input.
   */
  async create(
    exec: Executor,
    record: ProductionRecord
  ): Promise<{ record: ProductionRecord; created: boolean }> {
    const inserted = await exec.query<Row>(
      `INSERT INTO production_record (
         id, tenant_id, work_order_id, process_id, batch_id, machine_id, operator_id,
         shift_id, shift_date, good_quantity, reject_quantity, reject_reason_id,
         recorded_at, source, client_event_id, correction_of_id, notes,
         input_quantity, scrap_quantity, rework_quantity, is_batch_managed, has_child_work_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (tenant_id, client_event_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        record.id,
        record.tenantId,
        record.workOrderId,
        record.processId ?? null,
        record.batchId ?? null,
        record.machineId,
        record.operatorId,
        record.shiftId,
        record.shiftDate,
        record.goodQuantity,
        record.rejectQuantity,
        record.rejectReasonId ?? null,
        record.recordedAt,
        record.source,
        record.clientEventId,
        record.correctionOfId ?? null,
        record.notes ?? null,
        // Migration 005 added these five and the repository never wrote them,
        // so every record carried input 0 and the per-record quantity flow was
        // unusable. `is_batch_managed` / `has_child_work_order` also feed the
        // composite FK that enforces execution-path exclusivity (§7).
        record.inputQuantity ?? record.goodQuantity + record.rejectQuantity,
        record.scrapQuantity ?? 0,
        record.reworkQuantity ?? 0,
        record.isBatchManaged ?? false,
        record.hasChildWorkOrder ?? false,
      ]
    );

    if (inserted.rows.length > 0) {
      return { record: toDomain(inserted.rows[0]), created: true };
    }

    const existing = await this.findByClientEventId(exec, record.tenantId, record.clientEventId);
    if (!existing) {
      // DO NOTHING fired but the row is not visible: the only way that happens
      // is a conflict on some other constraint, which is a real error rather
      // than a replayed event.
      throw new Error(
        `production_record ${record.clientEventId} conflicted but could not be read back.`
      );
    }
    return { record: existing, created: false };
  }

  async findByClientEventId(
    exec: Executor,
    tenantId: string,
    clientEventId: string
  ): Promise<ProductionRecord | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_record WHERE tenant_id = $1 AND client_event_id = $2`,
      [tenantId, clientEventId]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<ProductionRecord | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_record WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /**
   * Records for a tenant, optionally narrowed to one work order or a date
   * window.
   *
   * `limit` is not optional by accident: §15 forbids pulling an unbounded
   * production history into Node, and this is the method every analytics path
   * ends up calling.
   */
  async list(
    exec: Executor,
    tenantId: string,
    filter: {
      workOrderId?: string;
      fromShiftDate?: string;
      toShiftDate?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ProductionRecord[]> {
    const where: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`work_order_id = $${params.length}`);
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
      `SELECT ${COLUMNS} FROM production_record
       WHERE ${where.join(' AND ')}
       ORDER BY recorded_at ASC, id ASC
       ${limitClause} ${offsetClause}`,
      params
    );
    return result.rows.map(toDomain);
  }

  /** Bulk insert for the demo history generator; skips replayed events. */
  async createMany(exec: Executor, records: ProductionRecord[]): Promise<number> {
    let created = 0;
    for (const record of records) {
      const result = await this.create(exec, record);
      if (result.created) created += 1;
    }
    return created;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM production_record WHERE tenant_id = $1',
      [tenantId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
