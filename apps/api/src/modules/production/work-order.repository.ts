import { WorkOrderStatus } from '@factory-vision/domain-types';
import type { WorkOrder } from '@factory-vision/domain-types';
import { asIsoString, asOptionalIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

const COLUMNS = `
  id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
  line_id, work_center_id, machine_id, target_quantity, planned_quantity, unit,
  planned_start, planned_end, actual_start, actual_end,
  reject_quantity, input_quantity, output_quantity, scrap_quantity, rework_quantity, transferred_quantity,
  status, priority, version, created_at, updated_at,
  production_plan_line_id, parent_work_order_id, predecessor_work_order_id, routing_id,
  is_batch_managed, has_child_work_order, mold_id, shift_id, confirmed_by, confirmed_at,
  status_reason
`;

interface Row {
  id: string;
  tenant_id: string;
  production_order_id: string | null;
  wo_number: string;
  product_id: string;
  process_id: string | null;
  sequence: number | null;
  line_id: string;
  work_center_id: string | null;
  machine_id: string | null;
  target_quantity: number | null;
  planned_quantity: number | null;
  input_quantity: number | null;
  output_quantity: number | null;
  reject_quantity: number;
  scrap_quantity: number | null;
  rework_quantity: number | null;
  transferred_quantity: number | null;
  unit: string | null;
  planned_start: Date | string;
  planned_end: Date | string;
  actual_start: Date | string | null;
  actual_end: Date | string | null;
  status: string;
  priority: number | null;
  version: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  production_plan_line_id: string | null;
  parent_work_order_id: string | null;
  predecessor_work_order_id: string | null;
  routing_id: string | null;
  is_batch_managed: boolean | null;
  has_child_work_order: boolean | null;
  mold_id: string | null;
  shift_id: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  status_reason: string | null;
}

function toDomain(row: Row): WorkOrder {
  const plannedQty = Number(row.planned_quantity ?? row.target_quantity ?? 0);
  const outQty = Number(row.output_quantity ?? 0);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productionPlanLineId: orUndefined(row.production_plan_line_id),
    parentWorkOrderId: orUndefined(row.parent_work_order_id),
    predecessorWorkOrderId: orUndefined(row.predecessor_work_order_id),
    woNumber: row.wo_number,
    productId: row.product_id,
    processId: orUndefined(row.process_id),
    routingId: orUndefined(row.routing_id),
    sequence: row.sequence === null ? undefined : Number(row.sequence),
    isBatchManaged: Boolean(row.is_batch_managed),
    hasChildWorkOrder: Boolean(row.has_child_work_order),
    lineId: row.line_id,
    workCenterId: orUndefined(row.work_center_id),
    machineId: orUndefined(row.machine_id),
    moldId: orUndefined(row.mold_id),
    shiftId: orUndefined(row.shift_id),
    plannedQuantity: plannedQty,
    targetQuantity: plannedQty,
    inputQuantity: Number(row.input_quantity ?? 0),
    outputQuantity: outQty,
    goodQuantity: outQty,
    rejectQuantity: Number(row.reject_quantity ?? 0),
    scrapQuantity: Number(row.scrap_quantity ?? 0),
    reworkQuantity: Number(row.rework_quantity ?? 0),
    transferredQuantity: Number(row.transferred_quantity ?? 0),
    unit: row.unit ?? 'PCS',
    plannedStart: asIsoString(row.planned_start),
    plannedEnd: asIsoString(row.planned_end),
    actualStart: asOptionalIsoString(row.actual_start),
    actualEnd: asOptionalIsoString(row.actual_end),
    status: (row.status as WorkOrderStatus) ?? WorkOrderStatus.DRAFT,
    priority: Number(row.priority ?? 1),
    confirmedBy: orUndefined(row.confirmed_by),
    confirmedAt: asOptionalIsoString(row.confirmed_at),
    statusReason: orUndefined(row.status_reason),
    version: Number(row.version ?? 1),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
    productionOrderId: orUndefined(row.production_order_id),
  };
}

export class WorkOrderRepository {
  async create(exec: Executor, workOrder: WorkOrder): Promise<WorkOrder> {
    const plannedQty = workOrder.plannedQuantity ?? workOrder.targetQuantity ?? 0;
    const outputQty = workOrder.outputQuantity ?? workOrder.goodQuantity ?? 0;

    const result = await exec.query<Row>(
      `INSERT INTO work_order (
         id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
         line_id, work_center_id, machine_id, target_quantity, planned_quantity, unit,
         planned_start, planned_end, actual_start, actual_end,
         reject_quantity, input_quantity, output_quantity, scrap_quantity, rework_quantity, transferred_quantity,
         status, priority, version, created_at, updated_at,
         production_plan_line_id, parent_work_order_id, predecessor_work_order_id, routing_id,
         is_batch_managed, has_child_work_order, mold_id, shift_id, confirmed_by, confirmed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        workOrder.id,
        workOrder.tenantId,
        workOrder.productionOrderId ?? null,
        workOrder.woNumber,
        workOrder.productId,
        workOrder.processId ?? null,
        workOrder.sequence ?? 1,
        workOrder.lineId,
        workOrder.workCenterId ?? null,
        workOrder.machineId ?? null,
        plannedQty,
        plannedQty,
        workOrder.unit ?? 'PCS',
        workOrder.plannedStart,
        workOrder.plannedEnd,
        workOrder.actualStart ?? null,
        workOrder.actualEnd ?? null,
        workOrder.rejectQuantity ?? 0,
        workOrder.inputQuantity ?? 0,
        outputQty,
        workOrder.scrapQuantity ?? 0,
        workOrder.reworkQuantity ?? 0,
        workOrder.transferredQuantity ?? 0,
        workOrder.status,
        workOrder.priority ?? 1,
        workOrder.version ?? 1,
        workOrder.createdAt ?? new Date().toISOString(),
        workOrder.updatedAt ?? new Date().toISOString(),
        // No fabricated fallback. `production_plan_line_id` carries a foreign
        // key (migration 011), and the old `'ppl-' + id` default pointed at a
        // row that has never existed — migration 010 names legacy plan lines
        // `planline-mig-<production order>`. Every insert without an explicit
        // plan line therefore died on the constraint. The caller resolves it
        // now, and a missing one is refused with a message rather than a
        // constraint name.
        workOrder.productionPlanLineId ?? null,
        workOrder.parentWorkOrderId ?? null,
        workOrder.predecessorWorkOrderId ?? null,
        workOrder.routingId ?? null,
        Boolean(workOrder.isBatchManaged),
        Boolean(workOrder.hasChildWorkOrder),
        workOrder.moldId ?? null,
        workOrder.shiftId ?? null,
        workOrder.confirmedBy ?? null,
        workOrder.confirmedAt ?? null,
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
   * Increments running quantities in the database.
   * Note: output_quantity in work_order is incremented by good/output quantity passed.
   */
  async incrementQuantities(
    exec: Executor,
    tenantId: string,
    id: string,
    good: number,
    reject: number,
    extra: { scrap?: number; rework?: number; input?: number; output?: number; transferred?: number } = {}
  ): Promise<WorkOrder | undefined> {
    const scrap = extra.scrap ?? 0;
    const rework = extra.rework ?? 0;
    const input = extra.input ?? 0;
    const output = extra.output !== undefined ? extra.output : good;
    const transferred = extra.transferred ?? 0;

    const result = await exec.query<Row>(
      `UPDATE work_order
          SET output_quantity = output_quantity + $3,
              reject_quantity = reject_quantity + $4,
              scrap_quantity = scrap_quantity + $5,
              rework_quantity = rework_quantity + $6,
              input_quantity = input_quantity + $7,
              transferred_quantity = transferred_quantity + $8,
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [tenantId, id, output, reject, scrap, rework, input, transferred]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /** Applies a validated state transition and any timestamps that go with it. */
  async updateStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: WorkOrderStatus,
    stamps: {
      actualStart?: string;
      actualEnd?: string;
      confirmedBy?: string;
      confirmedAt?: string;
      /** The cancellation reason §11 makes mandatory. */
      statusReason?: string;
    } = {}
  ): Promise<WorkOrder | undefined> {
    const result = await exec.query<Row>(
      `UPDATE work_order
          SET status = $3,
              actual_start = COALESCE($4, actual_start),
              actual_end = COALESCE($5, actual_end),
              confirmed_by = COALESCE($6, confirmed_by),
              confirmed_at = COALESCE($7, confirmed_at),
              status_reason = COALESCE($8, status_reason),
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [
        tenantId,
        id,
        status,
        stamps.actualStart ?? null,
        stamps.actualEnd ?? null,
        stamps.confirmedBy ?? null,
        stamps.confirmedAt ?? null,
        stamps.statusReason ?? null,
      ]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /**
   * Patches the planner-editable fields.
   */
  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        WorkOrder,
        | 'targetQuantity'
        | 'plannedQuantity'
        | 'plannedStart'
        | 'plannedEnd'
        | 'priority'
        | 'machineId'
        | 'moldId'
        | 'shiftId'
        | 'processId'
        | 'routingId'
        | 'lineId'
        | 'workCenterId'
        | 'productId'
        | 'sequence'
        | 'unit'
        | 'isBatchManaged'
        | 'hasChildWorkOrder'
        | 'productionPlanLineId'
        | 'parentWorkOrderId'
        | 'predecessorWorkOrderId'
      >
    >
  ): Promise<WorkOrder | undefined> {
    const plannedQty = patch.plannedQuantity ?? patch.targetQuantity ?? null;
    const result = await exec.query<Row>(
      `UPDATE work_order
          SET target_quantity           = COALESCE($3, target_quantity),
              planned_quantity          = COALESCE($3, planned_quantity),
              planned_start             = COALESCE($4, planned_start),
              planned_end               = COALESCE($5, planned_end),
              priority                  = COALESCE($6, priority),
              machine_id                = COALESCE($7, machine_id),
              process_id                = COALESCE($8, process_id),
              line_id                   = COALESCE($9, line_id),
              work_center_id            = COALESCE($10, work_center_id),
              product_id                = COALESCE($11, product_id),
              sequence                  = COALESCE($12, sequence),
              unit                      = COALESCE($13, unit),
              mold_id                   = COALESCE($14, mold_id),
              shift_id                  = COALESCE($15, shift_id),
              routing_id                = COALESCE($16, routing_id),
              is_batch_managed          = COALESCE($17, is_batch_managed),
              has_child_work_order      = COALESCE($18, has_child_work_order),
              production_plan_line_id   = COALESCE($19, production_plan_line_id),
              parent_work_order_id      = COALESCE($20, parent_work_order_id),
              predecessor_work_order_id = COALESCE($21, predecessor_work_order_id),
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [
        tenantId,
        id,
        plannedQty,
        patch.plannedStart ?? null,
        patch.plannedEnd ?? null,
        patch.priority ?? null,
        patch.machineId ?? null,
        patch.processId ?? null,
        patch.lineId ?? null,
        patch.workCenterId ?? null,
        patch.productId ?? null,
        patch.sequence ?? null,
        patch.unit ?? null,
        patch.moldId ?? null,
        patch.shiftId ?? null,
        patch.routingId ?? null,
        patch.isBatchManaged !== undefined ? patch.isBatchManaged : null,
        patch.hasChildWorkOrder !== undefined ? patch.hasChildWorkOrder : null,
        patch.productionPlanLineId ?? null,
        patch.parentWorkOrderId ?? null,
        patch.predecessorWorkOrderId ?? null,
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
