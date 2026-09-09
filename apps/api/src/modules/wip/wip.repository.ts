import type {
  QualityState,
  WipReceipt,
  WipRecord,
  WipState,
  WipStatusHistory,
  WipTransfer,
} from '@factory-vision/domain-types';
import { asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/** WIP records, transfers and receipts (migration 031). */

interface WipRow {
  id: string;
  tenant_id: string;
  wip_number: string;
  product_id: string;
  product_sku: string | null;
  product_name: string;
  work_order_id: string;
  wo_number: string;
  batch_id: string | null;
  batch_number: string | null;
  source_process_id: string | null;
  source_process_name: string | null;
  destination_process_id: string | null;
  destination_process_name: string | null;
  line_id: string | null;
  quantity: string;
  uom: string;
  status: string;
  location_id: string | null;
  location_name: string | null;
  quality_status: string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  notes: string | null;
}

const WIP_SELECT = `
  SELECT w.id, w.tenant_id, w.wip_number, w.product_id, p.sku AS product_sku, p.name AS product_name,
         w.work_order_id, o.wo_number, o.line_id, w.batch_id, b.batch_number,
         w.source_process_id, sp.name AS source_process_name,
         w.destination_process_id, dp.name AS destination_process_name,
         w.quantity, w.uom, w.status, w.location_id, w.location_name, w.quality_status,
         w.created_by, w.created_at, w.updated_at, w.notes
    FROM wip_record w
    JOIN product p ON p.id = w.product_id
    JOIN work_order o ON o.id = w.work_order_id
    LEFT JOIN production_batch b ON b.id = w.batch_id
    LEFT JOIN production_process sp ON sp.id = w.source_process_id
    LEFT JOIN production_process dp ON dp.id = w.destination_process_id
`;

/** The line the WIP sits on, carried for the dashboard's "WIP by line". */
export interface WipRecordWithLine extends WipRecord {
  lineId?: string;
}

function toWip(row: WipRow): WipRecordWithLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    wipNumber: row.wip_number,
    productId: row.product_id,
    productSku: orUndefined(row.product_sku),
    productName: row.product_name,
    workOrderId: row.work_order_id,
    workOrderNumber: row.wo_number,
    batchId: orUndefined(row.batch_id),
    batchNumber: orUndefined(row.batch_number),
    sourceProcessId: orUndefined(row.source_process_id),
    sourceProcessName: orUndefined(row.source_process_name),
    destinationProcessId: orUndefined(row.destination_process_id),
    destinationProcessName: orUndefined(row.destination_process_name),
    quantity: Number(row.quantity),
    uom: row.uom,
    status: row.status as WipState,
    locationId: orUndefined(row.location_id),
    locationName: orUndefined(row.location_name),
    qualityStatus: row.quality_status as QualityState,
    createdBy: row.created_by,
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
    notes: orUndefined(row.notes),
    lineId: orUndefined(row.line_id),
  };
}

export class WipRepository {
  async insertWip(exec: Executor, wip: WipRecord): Promise<void> {
    await exec.query(
      `INSERT INTO wip_record (
         id, tenant_id, wip_number, product_id, work_order_id, batch_id, source_process_id,
         destination_process_id, quantity, uom, status, location_id, location_name,
         quality_status, created_by, created_at, updated_at, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        wip.id,
        wip.tenantId,
        wip.wipNumber,
        wip.productId,
        wip.workOrderId,
        wip.batchId ?? null,
        wip.sourceProcessId ?? null,
        wip.destinationProcessId ?? null,
        wip.quantity,
        wip.uom,
        wip.status,
        wip.locationId ?? null,
        wip.locationName ?? null,
        wip.qualityStatus,
        wip.createdBy,
        wip.createdAt,
        wip.updatedAt,
        wip.notes ?? null,
      ]
    );
  }

  async listWip(
    exec: Executor,
    tenantId: string,
    filter: {
      id?: string;
      workOrderId?: string;
      status?: string;
      openOnly?: boolean;
      destinationProcessId?: string;
      productId?: string;
      limit?: number;
    } = {}
  ): Promise<WipRecordWithLine[]> {
    const where = ['w.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`w.id = $${params.length}`);
    }
    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`w.work_order_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`w.status = $${params.length}`);
    }
    if (filter.openOnly) {
      // Everything that is still WIP: finished and scrapped quantity has left.
      where.push("w.status NOT IN ('COMPLETED', 'SCRAPPED', 'RECEIVED')");
    }
    if (filter.destinationProcessId) {
      params.push(filter.destinationProcessId);
      where.push(`w.destination_process_id = $${params.length}`);
    }
    if (filter.productId) {
      params.push(filter.productId);
      where.push(`w.product_id = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 500, 5000));

    const rows = await exec.query<WipRow>(
      `${WIP_SELECT} WHERE ${where.join(' AND ')} ORDER BY w.created_at DESC LIMIT $${params.length}`,
      params
    );
    return rows.rows.map(toWip);
  }

  async setWipStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    input: {
      status: WipState;
      qualityStatus?: QualityState;
      quantity?: number;
      changedBy: string;
      reason?: string;
      fromStatus?: WipState;
    }
  ): Promise<void> {
    await exec.query(
      `UPDATE wip_record
          SET status = $3,
              quality_status = COALESCE($4, quality_status),
              quantity = COALESCE($5, quantity),
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, input.status, input.qualityStatus ?? null, input.quantity ?? null]
    );

    await exec.query(
      `INSERT INTO wip_status_history (id, tenant_id, wip_id, from_status, to_status, changed_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        `wsh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        id,
        input.fromStatus ?? null,
        input.status,
        input.changedBy,
        input.reason ?? null,
      ]
    );
  }

  async statusHistory(exec: Executor, tenantId: string, wipId: string): Promise<WipStatusHistory[]> {
    const rows = await exec.query<{
      id: string;
      wip_id: string;
      from_status: string | null;
      to_status: string;
      changed_by: string;
      changed_at: Date | string;
      reason: string | null;
    }>(
      `SELECT id, wip_id, from_status, to_status, changed_by, changed_at, reason
         FROM wip_status_history WHERE tenant_id = $1 AND wip_id = $2 ORDER BY changed_at`,
      [tenantId, wipId]
    );
    return rows.rows.map((row) => ({
      id: row.id,
      wipId: row.wip_id,
      fromStatus: (row.from_status ?? undefined) as WipState | undefined,
      toStatus: row.to_status as WipState,
      changedBy: row.changed_by,
      changedAt: asIsoString(row.changed_at),
      reason: orUndefined(row.reason),
    }));
  }

  // ================= Transfers =================

  async insertTransfer(exec: Executor, transfer: WipTransfer): Promise<void> {
    await exec.query(
      `INSERT INTO wip_transfer (
         id, tenant_id, transfer_number, wip_id, product_id, batch_id, source_work_order_id,
         source_process_id, destination_work_order_id, destination_process_id, quantity, uom,
         status, created_by, created_by_name, transferred_at, idempotency_key, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        transfer.id,
        transfer.tenantId,
        transfer.transferNumber,
        transfer.wipId,
        transfer.productId,
        transfer.batchId ?? null,
        transfer.sourceWorkOrderId,
        transfer.sourceProcessId ?? null,
        transfer.destinationWorkOrderId ?? null,
        transfer.destinationProcessId ?? null,
        transfer.quantity,
        transfer.uom,
        transfer.status,
        transfer.createdBy,
        transfer.createdByName ?? null,
        transfer.transferredAt,
        transfer.idempotencyKey ?? null,
        transfer.notes ?? null,
      ]
    );
  }

  async listTransfers(
    exec: Executor,
    tenantId: string,
    filter: {
      id?: string;
      wipId?: string;
      sourceWorkOrderId?: string;
      destinationWorkOrderId?: string;
      status?: string;
      idempotencyKey?: string;
      limit?: number;
    } = {}
  ): Promise<WipTransfer[]> {
    const where = ['t.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    const add = (column: string, value?: string) => {
      if (!value) return;
      params.push(value);
      where.push(`${column} = $${params.length}`);
    };
    add('t.id', filter.id);
    add('t.wip_id', filter.wipId);
    add('t.source_work_order_id', filter.sourceWorkOrderId);
    add('t.destination_work_order_id', filter.destinationWorkOrderId);
    add('t.status', filter.status);
    add('t.idempotency_key', filter.idempotencyKey);
    params.push(Math.min(filter.limit ?? 300, 2000));

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      transfer_number: string;
      wip_id: string;
      product_id: string;
      product_name: string;
      batch_id: string | null;
      source_work_order_id: string;
      source_wo_number: string;
      source_process_id: string | null;
      source_process_name: string | null;
      destination_work_order_id: string | null;
      destination_wo_number: string | null;
      destination_process_id: string | null;
      destination_process_name: string | null;
      quantity: string;
      uom: string;
      status: string;
      created_by: string;
      created_by_name: string | null;
      transferred_at: Date | string;
      receipt_id: string | null;
      idempotency_key: string | null;
      notes: string | null;
    }>(
      `SELECT t.id, t.tenant_id, t.transfer_number, t.wip_id, t.product_id, p.name AS product_name,
              t.batch_id, t.source_work_order_id, sw.wo_number AS source_wo_number,
              t.source_process_id, sp.name AS source_process_name,
              t.destination_work_order_id, dw.wo_number AS destination_wo_number,
              t.destination_process_id, dp.name AS destination_process_name,
              t.quantity, t.uom, t.status, t.created_by, t.created_by_name, t.transferred_at,
              t.receipt_id, t.idempotency_key, t.notes
         FROM wip_transfer t
         JOIN product p ON p.id = t.product_id
         JOIN work_order sw ON sw.id = t.source_work_order_id
         LEFT JOIN work_order dw ON dw.id = t.destination_work_order_id
         LEFT JOIN production_process sp ON sp.id = t.source_process_id
         LEFT JOIN production_process dp ON dp.id = t.destination_process_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.transferred_at DESC LIMIT $${params.length}`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      transferNumber: row.transfer_number,
      wipId: row.wip_id,
      productId: row.product_id,
      productName: row.product_name,
      batchId: orUndefined(row.batch_id),
      sourceWorkOrderId: row.source_work_order_id,
      sourceWorkOrderNumber: row.source_wo_number,
      sourceProcessId: orUndefined(row.source_process_id),
      sourceProcessName: orUndefined(row.source_process_name),
      destinationWorkOrderId: orUndefined(row.destination_work_order_id),
      destinationWorkOrderNumber: orUndefined(row.destination_wo_number),
      destinationProcessId: orUndefined(row.destination_process_id),
      destinationProcessName: orUndefined(row.destination_process_name),
      quantity: Number(row.quantity),
      uom: row.uom,
      status: row.status as WipTransfer['status'],
      createdBy: row.created_by,
      createdByName: orUndefined(row.created_by_name),
      transferredAt: asIsoString(row.transferred_at),
      receiptId: orUndefined(row.receipt_id),
      idempotencyKey: orUndefined(row.idempotency_key),
      notes: orUndefined(row.notes),
    }));
  }

  async setTransferStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: WipTransfer['status'],
    receiptId?: string
  ): Promise<void> {
    await exec.query(
      `UPDATE wip_transfer SET status = $3, receipt_id = COALESCE($4, receipt_id)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, status, receiptId ?? null]
    );
  }

  // ================= Receipts =================

  async insertReceipt(exec: Executor, receipt: WipReceipt): Promise<void> {
    await exec.query(
      `INSERT INTO wip_receipt (
         id, tenant_id, wip_transfer_id, received_quantity, transferred_quantity, variance_quantity,
         variance_reason, result, uom, received_by, received_by_name, received_at, idempotency_key, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        receipt.id,
        receipt.tenantId,
        receipt.wipTransferId,
        receipt.receivedQuantity,
        receipt.transferredQuantity,
        receipt.varianceQuantity,
        receipt.varianceReason ?? null,
        receipt.result,
        receipt.uom,
        receipt.receivedBy,
        receipt.receivedByName ?? null,
        receipt.receivedAt,
        receipt.idempotencyKey ?? null,
        receipt.notes ?? null,
      ]
    );
  }

  async listReceipts(
    exec: Executor,
    tenantId: string,
    filter: { wipTransferId?: string; idempotencyKey?: string; limit?: number } = {}
  ): Promise<WipReceipt[]> {
    const where = ['r.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.wipTransferId) {
      params.push(filter.wipTransferId);
      where.push(`r.wip_transfer_id = $${params.length}`);
    }
    if (filter.idempotencyKey) {
      params.push(filter.idempotencyKey);
      where.push(`r.idempotency_key = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 300, 2000));

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      wip_transfer_id: string;
      transfer_number: string;
      received_quantity: string;
      transferred_quantity: string;
      variance_quantity: string;
      variance_reason: string | null;
      result: string;
      uom: string;
      received_by: string;
      received_by_name: string | null;
      received_at: Date | string;
      idempotency_key: string | null;
      notes: string | null;
    }>(
      `SELECT r.id, r.tenant_id, r.wip_transfer_id, t.transfer_number, r.received_quantity,
              r.transferred_quantity, r.variance_quantity, r.variance_reason, r.result, r.uom,
              r.received_by, r.received_by_name, r.received_at, r.idempotency_key, r.notes
         FROM wip_receipt r
         JOIN wip_transfer t ON t.id = r.wip_transfer_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.received_at DESC LIMIT $${params.length}`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      wipTransferId: row.wip_transfer_id,
      transferNumber: row.transfer_number,
      receivedQuantity: Number(row.received_quantity),
      transferredQuantity: Number(row.transferred_quantity),
      varianceQuantity: Number(row.variance_quantity),
      varianceReason: orUndefined(row.variance_reason),
      result: row.result as WipReceipt['result'],
      uom: row.uom,
      receivedBy: row.received_by,
      receivedByName: orUndefined(row.received_by_name),
      receivedAt: asIsoString(row.received_at),
      idempotencyKey: orUndefined(row.idempotency_key),
      notes: orUndefined(row.notes),
    }));
  }

  async nextNumber(exec: Executor, tenantId: string, table: string, prefix: string): Promise<string> {
    const result = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId]
    );
    const next = Number(result.rows[0]?.n ?? 0) + 1;
    return `${prefix}-${new Date().getFullYear()}-${String(next).padStart(5, '0')}`;
  }
}
