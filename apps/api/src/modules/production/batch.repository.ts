import { ProductionBatchStatus } from '@factory-vision/domain-types';
import type { ProductionBatch } from '@factory-vision/domain-types';
import { asIsoString, asOptionalIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

const COLUMNS = `
  id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
  planned_quantity, input_quantity, output_quantity, reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
  status, status_reason, material_lot_reference, machine_id, mold_id, operator_id, shift_id,
  production_date, expiry_date, actual_start, actual_end, version, created_at, updated_at
`;

interface Row {
  id: string;
  tenant_id: string;
  batch_number: string;
  work_order_id: string;
  product_id: string;
  process_id: string | null;
  sequence: number;
  planned_quantity: number;
  input_quantity: number;
  output_quantity: number;
  reject_quantity: number;
  scrap_quantity: number;
  rework_quantity: number;
  transferred_quantity: number;
  status: string;
  status_reason: string | null;
  material_lot_reference: string | null;
  machine_id: string | null;
  mold_id: string | null;
  operator_id: string | null;
  shift_id: string | null;
  production_date: Date | string;
  expiry_date: Date | string | null;
  actual_start: Date | string | null;
  actual_end: Date | string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDomain(row: Row): ProductionBatch {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    batchNumber: row.batch_number,
    workOrderId: row.work_order_id,
    productId: row.product_id,
    processId: orUndefined(row.process_id),
    sequence: Number(row.sequence ?? 1),
    plannedQuantity: Number(row.planned_quantity ?? 0),
    inputQuantity: Number(row.input_quantity ?? 0),
    outputQuantity: Number(row.output_quantity ?? (row.reject_quantity ? 0 : row.output_quantity)),
    rejectQuantity: Number(row.reject_quantity ?? 0),
    scrapQuantity: Number(row.scrap_quantity ?? 0),
    reworkQuantity: Number(row.rework_quantity ?? 0),
    transferredQuantity: Number(row.transferred_quantity ?? 0),
    status: (row.status as ProductionBatchStatus) ?? ProductionBatchStatus.PLANNED,
    statusReason: orUndefined(row.status_reason),
    materialLotReference: orUndefined(row.material_lot_reference),
    machineId: orUndefined(row.machine_id),
    moldId: orUndefined(row.mold_id),
    operatorId: orUndefined(row.operator_id),
    shiftId: orUndefined(row.shift_id),
    productionDate: typeof row.production_date === 'string' ? row.production_date.slice(0, 10) : new Date(row.production_date).toISOString().slice(0, 10),
    expiryDate: row.expiry_date ? (typeof row.expiry_date === 'string' ? row.expiry_date.slice(0, 10) : new Date(row.expiry_date).toISOString().slice(0, 10)) : undefined,
    actualStart: asOptionalIsoString(row.actual_start),
    actualEnd: asOptionalIsoString(row.actual_end),
    version: Number(row.version ?? 1),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

export class BatchRepository {
  async create(exec: Executor, batch: ProductionBatch): Promise<ProductionBatch> {
    const result = await exec.query<Row>(
      `INSERT INTO production_batch (
         id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
         planned_quantity, input_quantity, output_quantity, reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
         status, status_reason, material_lot_reference, machine_id, mold_id, operator_id, shift_id,
         production_date, expiry_date, actual_start, actual_end, version, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        batch.id,
        batch.tenantId,
        batch.batchNumber,
        batch.workOrderId,
        batch.productId,
        batch.processId ?? null,
        batch.sequence ?? 1,
        batch.plannedQuantity,
        batch.inputQuantity ?? 0,
        batch.outputQuantity ?? 0,
        batch.rejectQuantity ?? 0,
        batch.scrapQuantity ?? 0,
        batch.reworkQuantity ?? 0,
        batch.transferredQuantity ?? 0,
        batch.status ?? ProductionBatchStatus.PLANNED,
        batch.statusReason ?? null,
        batch.materialLotReference ?? null,
        batch.machineId ?? null,
        batch.moldId ?? null,
        batch.operatorId ?? null,
        batch.shiftId ?? null,
        batch.productionDate,
        batch.expiryDate ?? null,
        batch.actualStart ?? null,
        batch.actualEnd ?? null,
        batch.version ?? 1,
        batch.createdAt ?? new Date().toISOString(),
        batch.updatedAt ?? new Date().toISOString(),
      ]
    );
    if (result.rows[0]) return toDomain(result.rows[0]);
    const existing = await this.findById(exec, batch.tenantId, batch.id);
    if (!existing) throw new Error(`production_batch ${batch.id} could not be created or read back.`);
    return existing;
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<ProductionBatch | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_batch WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async findByNumber(exec: Executor, tenantId: string, batchNumber: string): Promise<ProductionBatch | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_batch WHERE tenant_id = $1 AND batch_number = $2`,
      [tenantId, batchNumber]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkOrder(exec: Executor, tenantId: string, workOrderId: string): Promise<ProductionBatch[]> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_batch
        WHERE tenant_id = $1 AND work_order_id = $2
        ORDER BY sequence ASC, id ASC`,
      [tenantId, workOrderId]
    );
    return result.rows.map(toDomain);
  }

  async incrementQuantities(
    exec: Executor,
    tenantId: string,
    id: string,
    output: number,
    reject: number,
    extra: { scrap?: number; rework?: number; input?: number; transferred?: number } = {}
  ): Promise<ProductionBatch | undefined> {
    const scrap = extra.scrap ?? 0;
    const rework = extra.rework ?? 0;
    const input = extra.input ?? 0;
    const transferred = extra.transferred ?? 0;

    const result = await exec.query<Row>(
      `UPDATE production_batch
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

  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ProductionBatch,
        | 'workOrderId'
        | 'plannedQuantity'
        | 'status'
        | 'statusReason'
        | 'materialLotReference'
        | 'machineId'
        | 'moldId'
        | 'operatorId'
        | 'shiftId'
        | 'expiryDate'
        | 'actualStart'
        | 'actualEnd'
      >
    >
  ): Promise<ProductionBatch | undefined> {
    const result = await exec.query<Row>(
      `UPDATE production_batch
          SET work_order_id           = COALESCE($14, work_order_id),
              planned_quantity        = COALESCE($3, planned_quantity),
              status                  = COALESCE($4, status),
              status_reason           = COALESCE($5, status_reason),
              material_lot_reference  = COALESCE($6, material_lot_reference),
              machine_id              = COALESCE($7, machine_id),
              mold_id                 = COALESCE($8, mold_id),
              operator_id             = COALESCE($9, operator_id),
              shift_id                = COALESCE($10, shift_id),
              expiry_date             = COALESCE($11, expiry_date),
              actual_start            = COALESCE($12, actual_start),
              actual_end              = COALESCE($13, actual_end),
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [
        tenantId,
        id,
        patch.plannedQuantity ?? null,
        patch.status ?? null,
        patch.statusReason ?? null,
        patch.materialLotReference ?? null,
        patch.machineId ?? null,
        patch.moldId ?? null,
        patch.operatorId ?? null,
        patch.shiftId ?? null,
        patch.expiryDate ?? null,
        patch.actualStart ?? null,
        patch.actualEnd ?? null,
        patch.workOrderId ?? null,
      ]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const result = await exec.query(
      'DELETE FROM production_batch WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
