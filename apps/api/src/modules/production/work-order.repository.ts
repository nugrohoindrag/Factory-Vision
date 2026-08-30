import { WorkOrderStatus } from '@factory-vision/domain-types';
import type { WorkOrder } from '@factory-vision/domain-types';
import { asIsoString, asOptionalIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `work_order` (persistence fix §10).
 *
 * A work order carries running good/reject totals and a status that the shop
 * floor advances through the shift. Both have to survive a restart: an
 * in-memory work order that comes back as RELEASED after being IN_PROGRESS
 * tells the operator to start work that is already half done, and the totals
 * it lost are the ones the supervisor is measured on.
 */
const COLUMNS = `
  id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
  batch_id, line_id, work_center_id, machine_id, target_quantity, unit,
  planned_start, planned_end, actual_start, actual_end, good_quantity,
  reject_quantity, status, priority, version, created_at, updated_at
`;

interface Row {
  id: string;
  tenant_id: string;
  production_order_id: string;
  wo_number: string;
  product_id: string;
  process_id: string | null;
  sequence: number | null;
  batch_id: string | null;
  line_id: string;
  work_center_id: string | null;
  machine_id: string | null;
  target_quantity: number;
  unit: string | null;
  planned_start: Date | string;
  planned_end: Date | string;
  actual_start: Date | string | null;
  actual_end: Date | string | null;
  good_quantity: number;
  reject_quantity: number;
  status: string;
  priority: number | null;
  version: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDomain(row: Row): WorkOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productionOrderId: row.production_order_id,
    woNumber: row.wo_number,
    productId: row.product_id,
    processId: orUndefined(row.process_id),
    sequence: row.sequence === null ? undefined : Number(row.sequence),
    batchId: orUndefined(row.batch_id),
    lineId: row.line_id,
    workCenterId: orUndefined(row.work_center_id),
    machineId: orUndefined(row.machine_id),
    targetQuantity: Number(row.target_quantity ?? 0),
    unit: row.unit ?? 'PCS',
    plannedStart: asIsoString(row.planned_start),
    plannedEnd: asIsoString(row.planned_end),
    actualStart: asOptionalIsoString(row.actual_start),
    actualEnd: asOptionalIsoString(row.actual_end),
    goodQuantity: Number(row.good_quantity ?? 0),
    rejectQuantity: Number(row.reject_quantity ?? 0),
    status: (row.status as WorkOrderStatus) ?? WorkOrderStatus.DRAFT,
    priority: Number(row.priority ?? 1),
    version: Number(row.version ?? 1),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

export class WorkOrderRepository {
  async create(exec: Executor, workOrder: WorkOrder): Promise<WorkOrder> {
    const result = await exec.query<Row>(
      `INSERT INTO work_order (
         id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
         batch_id, line_id, work_center_id, machine_id, target_quantity, unit,
         planned_start, planned_end, actual_start, actual_end, good_quantity,
         reject_quantity, status, priority, version, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        workOrder.id,
        workOrder.tenantId,
        workOrder.productionOrderId,
        workOrder.woNumber,
        workOrder.productId,
        workOrder.processId ?? null,
        workOrder.sequence ?? 1,
        workOrder.batchId ?? null,
        workOrder.lineId,
        workOrder.workCenterId ?? null,
        workOrder.machineId ?? null,
        workOrder.targetQuantity,
        workOrder.unit,
        workOrder.plannedStart,
        workOrder.plannedEnd,
        workOrder.actualStart ?? null,
        workOrder.actualEnd ?? null,
        workOrder.goodQuantity,
        workOrder.rejectQuantity,
        workOrder.status,
        workOrder.priority,
        workOrder.version,
        workOrder.createdAt,
        workOrder.updatedAt,
      ]
    );
    if (result.rows[0]) return toDomain(result.rows[0]);
    const existing = await this.findById(exec, workOrder.tenantId, workOrder.id);
    if (!existing) throw new Error(`work_order ${workOrder.id} could not be created or read back.`);
    return existing;
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<WorkOrder | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM work_order WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { lineId?: string; status?: string; processId?: string; limit?: number; offset?: number } = {}
  ): Promise<WorkOrder[]> {
    const where: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.lineId) {
      params.push(filter.lineId);
      where.push(`line_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.processId) {
      params.push(filter.processId);
      where.push(`process_id = $${params.length}`);
    }

    params.push(Math.min(filter.limit ?? 2000, 20000));
    const limitClause = `LIMIT $${params.length}`;
    params.push(filter.offset ?? 0);
    const offsetClause = `OFFSET $${params.length}`;

    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM work_order
        WHERE ${where.join(' AND ')}
        ORDER BY priority ASC, planned_start ASC, id ASC
        ${limitClause} ${offsetClause}`,
      params
    );
    return result.rows.map(toDomain);
  }

  /**
   * Adds to the running totals in the database rather than reading, adding and
   * writing back in Node.
   *
   * `good_quantity = good_quantity + $3` is what makes two operators recording
   * output at the same moment, or two API instances doing so, both count. A
   * read-modify-write would silently drop one of them.
   */
  async incrementQuantities(
    exec: Executor,
    tenantId: string,
    id: string,
    good: number,
    reject: number
  ): Promise<WorkOrder | undefined> {
    const result = await exec.query<Row>(
      `UPDATE work_order
          SET good_quantity = good_quantity + $3,
              reject_quantity = reject_quantity + $4,
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [tenantId, id, good, reject]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /** Applies a validated state transition and any timestamps that go with it. */
  async updateStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: WorkOrderStatus,
    stamps: { actualStart?: string; actualEnd?: string } = {}
  ): Promise<WorkOrder | undefined> {
    const result = await exec.query<Row>(
      `UPDATE work_order
          SET status = $3,
              actual_start = COALESCE($4, actual_start),
              actual_end = COALESCE($5, actual_end),
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [tenantId, id, status, stamps.actualStart ?? null, stamps.actualEnd ?? null]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /**
   * Patches the planner-editable fields.
   *
   * Every column is COALESCEd against its current value, so an absent property
   * leaves the column alone rather than nulling it. The list mirrors what the
   * planner's edit form can change; `batchId` in particular is here because
   * US-013 attaches a batch to an existing work order through this path.
   */
  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        WorkOrder,
        | 'targetQuantity'
        | 'plannedStart'
        | 'plannedEnd'
        | 'priority'
        | 'machineId'
        | 'batchId'
        | 'processId'
        | 'lineId'
        | 'workCenterId'
        | 'productId'
        | 'sequence'
        | 'unit'
      >
    >
  ): Promise<WorkOrder | undefined> {
    const result = await exec.query<Row>(
      `UPDATE work_order
          SET target_quantity = COALESCE($3, target_quantity),
              planned_start   = COALESCE($4, planned_start),
              planned_end     = COALESCE($5, planned_end),
              priority        = COALESCE($6, priority),
              machine_id      = COALESCE($7, machine_id),
              batch_id        = COALESCE($8, batch_id),
              process_id      = COALESCE($9, process_id),
              line_id         = COALESCE($10, line_id),
              work_center_id  = COALESCE($11, work_center_id),
              product_id      = COALESCE($12, product_id),
              sequence        = COALESCE($13, sequence),
              unit            = COALESCE($14, unit),
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [
        tenantId,
        id,
        patch.targetQuantity ?? null,
        patch.plannedStart ?? null,
        patch.plannedEnd ?? null,
        patch.priority ?? null,
        patch.machineId ?? null,
        patch.batchId ?? null,
        patch.processId ?? null,
        patch.lineId ?? null,
        patch.workCenterId ?? null,
        patch.productId ?? null,
        patch.sequence ?? null,
        patch.unit ?? null,
      ]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const result = await exec.query('DELETE FROM work_order WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM work_order WHERE tenant_id = $1',
      [tenantId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
