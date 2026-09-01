import { CustomerOrderStatus, OrderChannel } from '@factory-vision/domain-types';
import type { CustomerOrder, CustomerOrderLine } from '@factory-vision/domain-types';
import {
  asDateString,
  asOptionalIsoString,
  orUndefined,
  type Executor,
} from '../../../platform/db/executor.js';

/**
 * `customer_order`, `customer_order_line`, `customer_order_document`
 * (MES-021, MES-022, MES-025).
 *
 * Dates are read with `to_char` and handled as calendar dates, never as
 * moments: `requested_delivery_date` decides whether an order is late, and a
 * server west of the database would otherwise render it as the previous day.
 */

const ORDER_COLUMNS = `
  id, tenant_id, order_number, customer_id, po_number, order_channel,
  to_char(order_date, 'YYYY-MM-DD') AS order_date,
  to_char(requested_delivery_date, 'YYYY-MM-DD') AS requested_delivery_date,
  customer_pic, delivery_address, dock_number, document_url, status, status_reason,
  created_by, created_at, updated_at
`;

/** The same columns for the list query, which joins and so needs the alias. */
const ALIASED_ORDER_COLUMNS = `
  co.id, co.tenant_id, co.order_number, co.customer_id, co.po_number, co.order_channel,
  to_char(co.order_date, 'YYYY-MM-DD') AS order_date,
  to_char(co.requested_delivery_date, 'YYYY-MM-DD') AS requested_delivery_date,
  co.customer_pic, co.delivery_address, co.dock_number, co.document_url, co.status,
  co.status_reason, co.created_by, co.created_at, co.updated_at
`;

const LINE_COLUMNS = `
  id, tenant_id, customer_order_id, product_id, model_type, ordered_quantity, unit,
  to_char(requested_delivery_date, 'YYYY-MM-DD') AS requested_delivery_date,
  planned_quantity, produced_quantity, line_no, created_at, updated_at
`;

interface OrderRow {
  id: string;
  tenant_id: string;
  order_number: string;
  customer_id: string;
  po_number: string | null;
  order_channel: string;
  order_date: string;
  requested_delivery_date: string;
  customer_pic: string | null;
  delivery_address: string | null;
  dock_number: string | null;
  document_url: string | null;
  status: string;
  status_reason: string | null;
  created_by: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface LineRow {
  id: string;
  tenant_id: string;
  customer_order_id: string;
  product_id: string;
  model_type: string | null;
  ordered_quantity: number;
  unit: string;
  requested_delivery_date: string | null;
  planned_quantity: number;
  produced_quantity: number;
  line_no: number;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

export interface CustomerOrderDocument {
  id: string;
  tenantId: string;
  customerOrderId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageUrl: string;
  uploadedBy?: string;
  uploadedAt?: string;
}

function toOrder(row: OrderRow): CustomerOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    poNumber: orUndefined(row.po_number),
    orderChannel: (row.order_channel as OrderChannel) ?? OrderChannel.MANUAL,
    orderDate: asDateString(row.order_date),
    requestedDeliveryDate: asDateString(row.requested_delivery_date),
    customerPic: orUndefined(row.customer_pic),
    deliveryAddress: orUndefined(row.delivery_address),
    dockNumber: orUndefined(row.dock_number),
    documentUrl: orUndefined(row.document_url),
    status: (row.status as CustomerOrderStatus) ?? CustomerOrderStatus.RECEIVED,
    statusReason: orUndefined(row.status_reason),
    createdBy: orUndefined(row.created_by),
    createdAt: asOptionalIsoString(row.created_at),
    updatedAt: asOptionalIsoString(row.updated_at),
  };
}

function toLine(row: LineRow): CustomerOrderLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerOrderId: row.customer_order_id,
    productId: row.product_id,
    modelType: orUndefined(row.model_type),
    orderedQuantity: Number(row.ordered_quantity),
    unit: row.unit,
    requestedDeliveryDate: row.requested_delivery_date
      ? asDateString(row.requested_delivery_date)
      : undefined,
    plannedQuantity: Number(row.planned_quantity),
    producedQuantity: Number(row.produced_quantity),
    lineNo: Number(row.line_no),
    createdAt: asOptionalIsoString(row.created_at),
    updatedAt: asOptionalIsoString(row.updated_at),
  };
}

export interface CustomerOrderFilter {
  status?: CustomerOrderStatus | CustomerOrderStatus[];
  customerId?: string;
  productId?: string;
  deliveryFrom?: string;
  deliveryTo?: string;
  search?: string;
  limit?: number;
}

export class CustomerOrderRepository {
  // --- Orders ---------------------------------------------------------

  async list(exec: Executor, tenantId: string, filter: CustomerOrderFilter = {}): Promise<CustomerOrder[]> {
    const where = ['co.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      params.push(statuses);
      where.push(`co.status = ANY($${params.length})`);
    }
    if (filter.customerId) {
      params.push(filter.customerId);
      where.push(`co.customer_id = $${params.length}`);
    }
    if (filter.deliveryFrom) {
      params.push(filter.deliveryFrom);
      where.push(`co.requested_delivery_date >= $${params.length}::date`);
    }
    if (filter.deliveryTo) {
      params.push(filter.deliveryTo);
      where.push(`co.requested_delivery_date <= $${params.length}::date`);
    }
    if (filter.productId) {
      params.push(filter.productId);
      where.push(
        `EXISTS (SELECT 1 FROM customer_order_line col
                  WHERE col.customer_order_id = co.id AND col.product_id = $${params.length})`
      );
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      where.push(
        `(LOWER(co.order_number) LIKE $${params.length} OR LOWER(COALESCE(co.po_number, '')) LIKE $${params.length})`
      );
    }

    params.push(Math.min(filter.limit ?? 500, 2000));
    const result = await exec.query<OrderRow>(
      `SELECT ${ALIASED_ORDER_COLUMNS}
         FROM customer_order co
        WHERE ${where.join(' AND ')}
        ORDER BY co.order_date DESC, co.order_number DESC
        LIMIT $${params.length}`,
      params
    );
    return result.rows.map(toOrder);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<CustomerOrder | undefined> {
    const result = await exec.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM customer_order WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toOrder(result.rows[0]) : undefined;
  }

  /** Locks the row for the rest of the transaction, for status derivation. */
  async findByIdForUpdate(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<CustomerOrder | undefined> {
    const result = await exec.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM customer_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id]
    );
    return result.rows[0] ? toOrder(result.rows[0]) : undefined;
  }

  async insert(exec: Executor, order: CustomerOrder): Promise<CustomerOrder> {
    const result = await exec.query<OrderRow>(
      `INSERT INTO customer_order (
         id, tenant_id, order_number, customer_id, po_number, order_channel, order_date,
         requested_delivery_date, customer_pic, delivery_address, dock_number, document_url,
         status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14)
       RETURNING ${ORDER_COLUMNS}`,
      [
        order.id,
        order.tenantId,
        order.orderNumber,
        order.customerId,
        order.poNumber ?? null,
        order.orderChannel,
        order.orderDate,
        order.requestedDeliveryDate,
        order.customerPic ?? null,
        order.deliveryAddress ?? null,
        order.dockNumber ?? null,
        order.documentUrl ?? null,
        order.status,
        order.createdBy ?? null,
      ]
    );
    return toOrder(result.rows[0]);
  }

  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<Omit<CustomerOrder, 'id' | 'tenantId' | 'orderNumber'>>
  ): Promise<CustomerOrder | undefined> {
    const result = await exec.query<OrderRow>(
      `UPDATE customer_order SET
         customer_id = COALESCE($3, customer_id),
         po_number = COALESCE($4, po_number),
         order_channel = COALESCE($5, order_channel),
         requested_delivery_date = COALESCE($6::date, requested_delivery_date),
         customer_pic = COALESCE($7, customer_pic),
         delivery_address = COALESCE($8, delivery_address),
         dock_number = COALESCE($9, dock_number),
         document_url = COALESCE($10, document_url),
         updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${ORDER_COLUMNS}`,
      [
        tenantId,
        id,
        patch.customerId ?? null,
        patch.poNumber ?? null,
        patch.orderChannel ?? null,
        patch.requestedDeliveryDate ?? null,
        patch.customerPic ?? null,
        patch.deliveryAddress ?? null,
        patch.dockNumber ?? null,
        patch.documentUrl ?? null,
      ]
    );
    return result.rows[0] ? toOrder(result.rows[0]) : undefined;
  }

  async updateStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: CustomerOrderStatus,
    reason?: string
  ): Promise<CustomerOrder | undefined> {
    const result = await exec.query<OrderRow>(
      `UPDATE customer_order
          SET status = $3, status_reason = COALESCE($4, status_reason), updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${ORDER_COLUMNS}`,
      [tenantId, id, status, reason ?? null]
    );
    return result.rows[0] ? toOrder(result.rows[0]) : undefined;
  }

  // --- Lines ----------------------------------------------------------

  async listLines(exec: Executor, tenantId: string, orderId: string): Promise<CustomerOrderLine[]> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM customer_order_line
        WHERE tenant_id = $1 AND customer_order_id = $2 ORDER BY line_no`,
      [tenantId, orderId]
    );
    return result.rows.map(toLine);
  }

  async listLinesForOrders(
    exec: Executor,
    tenantId: string,
    orderIds: string[]
  ): Promise<CustomerOrderLine[]> {
    if (orderIds.length === 0) return [];
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM customer_order_line
        WHERE tenant_id = $1 AND customer_order_id = ANY($2) ORDER BY customer_order_id, line_no`,
      [tenantId, orderIds]
    );
    return result.rows.map(toLine);
  }

  async findLineById(
    exec: Executor,
    tenantId: string,
    lineId: string
  ): Promise<CustomerOrderLine | undefined> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM customer_order_line WHERE tenant_id = $1 AND id = $2`,
      [tenantId, lineId]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  async nextLineNo(exec: Executor, tenantId: string, orderId: string): Promise<number> {
    const result = await exec.query<{ next: string }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS next FROM customer_order_line
        WHERE tenant_id = $1 AND customer_order_id = $2`,
      [tenantId, orderId]
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  async insertLine(exec: Executor, line: CustomerOrderLine): Promise<CustomerOrderLine> {
    const result = await exec.query<LineRow>(
      `INSERT INTO customer_order_line (
         id, tenant_id, customer_order_id, product_id, model_type, ordered_quantity, unit,
         requested_delivery_date, planned_quantity, produced_quantity, line_no
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11)
       RETURNING ${LINE_COLUMNS}`,
      [
        line.id,
        line.tenantId,
        line.customerOrderId,
        line.productId,
        line.modelType ?? null,
        line.orderedQuantity,
        line.unit,
        line.requestedDeliveryDate ?? null,
        line.plannedQuantity,
        line.producedQuantity,
        line.lineNo,
      ]
    );
    return toLine(result.rows[0]);
  }

  async updateLine(
    exec: Executor,
    tenantId: string,
    lineId: string,
    patch: Partial<Pick<CustomerOrderLine, 'orderedQuantity' | 'unit' | 'modelType' | 'requestedDeliveryDate'>>
  ): Promise<CustomerOrderLine | undefined> {
    const result = await exec.query<LineRow>(
      `UPDATE customer_order_line SET
         ordered_quantity = COALESCE($3, ordered_quantity),
         unit = COALESCE($4, unit),
         model_type = COALESCE($5, model_type),
         requested_delivery_date = COALESCE($6::date, requested_delivery_date),
         updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${LINE_COLUMNS}`,
      [
        tenantId,
        lineId,
        patch.orderedQuantity ?? null,
        patch.unit ?? null,
        patch.modelType ?? null,
        patch.requestedDeliveryDate ?? null,
      ]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  async deleteLine(exec: Executor, tenantId: string, lineId: string): Promise<boolean> {
    const result = await exec.query(
      'DELETE FROM customer_order_line WHERE tenant_id = $1 AND id = $2',
      [tenantId, lineId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Adds `delta` to a line's planned quantity, refusing to exceed the ordered
   * quantity.
   *
   * The `ck_cust_order_line_planned` CHECK would refuse it anyway; doing it here
   * turns a constraint violation into a message that names the two numbers.
   */
  async addPlannedQuantity(
    exec: Executor,
    tenantId: string,
    lineId: string,
    delta: number
  ): Promise<CustomerOrderLine | undefined> {
    const result = await exec.query<LineRow>(
      `UPDATE customer_order_line
          SET planned_quantity = planned_quantity + $3, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${LINE_COLUMNS}`,
      [tenantId, lineId, delta]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  async addProducedQuantity(
    exec: Executor,
    tenantId: string,
    lineId: string,
    delta: number
  ): Promise<CustomerOrderLine | undefined> {
    const result = await exec.query<LineRow>(
      `UPDATE customer_order_line
          SET produced_quantity = GREATEST(produced_quantity + $3, 0), updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${LINE_COLUMNS}`,
      [tenantId, lineId, delta]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  // --- Documents (MES-025) --------------------------------------------

  async listDocuments(
    exec: Executor,
    tenantId: string,
    orderId: string
  ): Promise<CustomerOrderDocument[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      customer_order_id: string;
      file_name: string;
      content_type: string;
      size_bytes: number;
      storage_url: string;
      uploaded_by: string | null;
      uploaded_at: Date | string | null;
    }>(
      `SELECT id, tenant_id, customer_order_id, file_name, content_type, size_bytes,
              storage_url, uploaded_by, uploaded_at
         FROM customer_order_document
        WHERE tenant_id = $1 AND customer_order_id = $2
        ORDER BY uploaded_at DESC, id`,
      [tenantId, orderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      customerOrderId: row.customer_order_id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      storageUrl: row.storage_url,
      uploadedBy: orUndefined(row.uploaded_by),
      uploadedAt: asOptionalIsoString(row.uploaded_at),
    }));
  }

  async insertDocument(exec: Executor, doc: CustomerOrderDocument): Promise<CustomerOrderDocument> {
    await exec.query(
      `INSERT INTO customer_order_document (
         id, tenant_id, customer_order_id, file_name, content_type, size_bytes, storage_url, uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        doc.id,
        doc.tenantId,
        doc.customerOrderId,
        doc.fileName,
        doc.contentType,
        doc.sizeBytes,
        doc.storageUrl,
        doc.uploadedBy ?? null,
      ]
    );
    const rows = await this.listDocuments(exec, doc.tenantId, doc.customerOrderId);
    return rows.find((d) => d.id === doc.id) ?? doc;
  }

  async deleteDocument(exec: Executor, tenantId: string, documentId: string): Promise<boolean> {
    const result = await exec.query(
      'DELETE FROM customer_order_document WHERE tenant_id = $1 AND id = $2',
      [tenantId, documentId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
