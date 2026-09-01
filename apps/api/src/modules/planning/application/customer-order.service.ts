import { randomUUID } from 'crypto';
import { CustomerOrderStatus, OrderChannel } from '@factory-vision/domain-types';
import type { CustomerOrder, CustomerOrderLine } from '@factory-vision/domain-types';
import { withTenant } from '../../../platform/db/pool.js';
import type { Executor } from '../../../platform/db/executor.js';
import { ApiError } from '../../../platform/http/api-error.js';
import type { ApiFieldError } from '@factory-vision/domain-types';
import {
  CustomerOrderRepository,
  type CustomerOrderDocument,
  type CustomerOrderFilter,
} from '../infrastructure/customer-order.repository.js';
import { CustomerRepository } from '../infrastructure/customer.repository.js';
import { PlanningReferenceRepository } from '../infrastructure/planning-reference.repository.js';
import { PlanningAudit } from '../infrastructure/planning-audit.js';
import { OutboxRepository } from '../infrastructure/outbox.repository.js';
import { DocumentStorage } from '../infrastructure/document-storage.js';
import { customerOrderPrefix, nextNumber } from '../domain/numbering.js';
import { PLANNING_EVENTS, planningEvent } from '../domain/planning.events.js';
import {
  deriveCustomerOrderStatus,
  assertCancellable,
  type OrderDerivationFacts,
} from '../domain/customer-order.status.js';

/**
 * Customer Order (MES-021, MES-022, MES-025, MES-026).
 *
 * The order is where real demand enters the system, so three things are true of
 * every write here:
 *
 * - **The audit row goes in the same transaction as the change** (MES-020), via
 *   `PlanningAudit` rather than the fire-and-forget `AuditService`.
 * - **Status is derived, never typed.** `Received → Planned → In Production →
 *   Produced` follows from production facts (MES-026); the three logistics
 *   statuses after that stay manual because the MVP does not execute shipping.
 * - **Planning publishes, it does not call.** Everything another module might
 *   want to know about lands in `outbox_event`.
 */

export interface CustomerOrderLineInput {
  productId: string;
  orderedQuantity: number;
  unit?: string;
  modelType?: string;
  requestedDeliveryDate?: string;
}

export interface CustomerOrderInput {
  customerId: string;
  orderChannel: OrderChannel;
  orderDate?: string;
  requestedDeliveryDate: string;
  poNumber?: string;
  customerPic?: string;
  deliveryAddress?: string;
  dockNumber?: string;
  documentUrl?: string;
  lines?: CustomerOrderLineInput[];
}

export interface CustomerOrderDetail extends CustomerOrder {
  lines: CustomerOrderLine[];
  documents: CustomerOrderDocument[];
}

/** Uploads are bounded so a mistyped file cannot fill the volume (MES-025-2). */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

export class CustomerOrderService {
  private readonly orders = new CustomerOrderRepository();
  private readonly customers = new CustomerRepository();
  private readonly reference = new PlanningReferenceRepository();
  private readonly audit = new PlanningAudit();
  private readonly outbox = new OutboxRepository();
  private readonly storage = new DocumentStorage();

  // --- Reads ----------------------------------------------------------

  async list(tenantId: string, filter: CustomerOrderFilter = {}): Promise<CustomerOrderDetail[]> {
    return withTenant(tenantId, async (client) => {
      const orders = await this.orders.list(client, tenantId, filter);
      if (orders.length === 0) return [];
      const lines = await this.orders.listLinesForOrders(
        client,
        tenantId,
        orders.map((o) => o.id)
      );
      return orders.map((order) => ({
        ...order,
        lines: lines.filter((l) => l.customerOrderId === order.id),
        documents: [],
      }));
    });
  }

  async get(tenantId: string, id: string): Promise<CustomerOrderDetail> {
    return withTenant(tenantId, async (client) => this.readDetail(client, tenantId, id));
  }

  private async readDetail(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<CustomerOrderDetail> {
    const order = await this.orders.findById(exec, tenantId, id);
    if (!order) throw ApiError.notFound('Customer Order tidak ditemukan.');
    return {
      ...order,
      lines: await this.orders.listLines(exec, tenantId, id),
      documents: await this.orders.listDocuments(exec, tenantId, id),
    };
  }

  // --- Create (MES-021) -----------------------------------------------

  async create(
    tenantId: string,
    input: CustomerOrderInput,
    actorId: string
  ): Promise<CustomerOrderDetail> {
    return withTenant(tenantId, async (client) => {
      const customer = await this.customers.findById(client, tenantId, input.customerId);
      if (!customer) throw ApiError.notFound('Customer tidak ditemukan.');
      if (customer.status !== 'ACTIVE') {
        throw ApiError.validation('Customer tidak aktif tidak dapat dipilih untuk order baru.', [
          { field: 'customerId', code: 'INACTIVE', message: `Customer ${customer.code} tidak aktif.` },
        ]);
      }

      const orderDate = input.orderDate ?? new Date().toISOString().slice(0, 10);
      const orderNumber = await nextNumber(
        client,
        tenantId,
        'customer_order',
        'order_number',
        customerOrderPrefix(orderDate)
      );

      const order = await this.orders.insert(client, {
        id: `co-${randomUUID()}`,
        tenantId,
        orderNumber,
        customerId: input.customerId,
        poNumber: input.poNumber,
        orderChannel: input.orderChannel,
        orderDate,
        requestedDeliveryDate: input.requestedDeliveryDate,
        customerPic: input.customerPic ?? customer.picName,
        // Falling back to the customer's registered address and dock means the
        // common case needs no retyping, while a one-off delivery can still
        // override it on the order.
        deliveryAddress: input.deliveryAddress ?? customer.deliveryAddress,
        dockNumber: input.dockNumber ?? customer.dockNumber,
        documentUrl: input.documentUrl,
        status: CustomerOrderStatus.RECEIVED,
        createdBy: actorId,
      });

      const lines: CustomerOrderLine[] = [];
      let lineNo = 1;
      for (const lineInput of input.lines ?? []) {
        lines.push(await this.insertLine(client, tenantId, order.id, lineInput, lineNo));
        lineNo += 1;
      }

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order',
        entityId: order.id,
        action: 'CREATE',
        newValue: { ...order, lines },
      });

      await this.outbox.publish(
        client,
        tenantId,
        planningEvent(PLANNING_EVENTS.CUSTOMER_ORDER_RECEIVED, 'customer_order', order.id, {
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          orderChannel: order.orderChannel,
          requestedDeliveryDate: order.requestedDeliveryDate,
          lineCount: lines.length,
        })
      );

      return { ...order, lines, documents: [] };
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<CustomerOrderInput, 'lines'>>,
    actorId: string
  ): Promise<CustomerOrderDetail> {
    return withTenant(tenantId, async (client) => {
      const before = await this.orders.findById(client, tenantId, id);
      if (!before) throw ApiError.notFound('Customer Order tidak ditemukan.');
      if (
        before.status === CustomerOrderStatus.CANCELLED ||
        before.status === CustomerOrderStatus.COMPLETED
      ) {
        throw ApiError.invalidState(
          `Customer Order berstatus ${before.status} tidak dapat diubah.`
        );
      }

      if (patch.customerId && patch.customerId !== before.customerId) {
        const customer = await this.customers.findById(client, tenantId, patch.customerId);
        if (!customer) throw ApiError.notFound('Customer tidak ditemukan.');
        if (customer.status !== 'ACTIVE') {
          throw ApiError.validation('Customer tidak aktif tidak dapat dipilih.', [
            { field: 'customerId', code: 'INACTIVE', message: `Customer ${customer.code} tidak aktif.` },
          ]);
        }
      }

      const updated = await this.orders.update(client, tenantId, id, patch);
      if (!updated) throw ApiError.notFound('Customer Order tidak ditemukan.');

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order',
        entityId: id,
        action: 'UPDATE',
        previousValue: before,
        newValue: updated,
      });

      return this.readDetail(client, tenantId, id);
    });
  }

  // --- Lines (MES-022) ------------------------------------------------

  private async insertLine(
    exec: Executor,
    tenantId: string,
    orderId: string,
    input: CustomerOrderLineInput,
    lineNo: number
  ): Promise<CustomerOrderLine> {
    const product = await this.reference.findProduct(exec, tenantId, input.productId);
    if (!product) {
      throw ApiError.validation('Product pada order line tidak ditemukan.', [
        { field: 'productId', code: 'NOT_FOUND', message: `Product ${input.productId} tidak ditemukan.` },
      ]);
    }
    if (product.status !== 'ACTIVE') {
      throw ApiError.validation('Product tidak aktif tidak dapat dipesan.', [
        {
          field: 'productId',
          code: 'INACTIVE',
          message: `Product ${product.sku} berstatus ${product.status}.`,
        },
      ]);
    }
    if (!Number.isInteger(input.orderedQuantity) || input.orderedQuantity <= 0) {
      throw ApiError.validation('Ordered quantity harus bilangan bulat lebih dari nol.', [
        {
          field: 'orderedQuantity',
          code: 'OUT_OF_RANGE',
          message: `Ordered quantity ${input.orderedQuantity} tidak valid.`,
        },
      ]);
    }

    return this.orders.insertLine(exec, {
      id: `col-${randomUUID()}`,
      tenantId,
      customerOrderId: orderId,
      productId: input.productId,
      modelType: input.modelType,
      orderedQuantity: input.orderedQuantity,
      unit: input.unit ?? product.unit,
      requestedDeliveryDate: input.requestedDeliveryDate,
      plannedQuantity: 0,
      producedQuantity: 0,
      lineNo,
    });
  }

  async addLine(
    tenantId: string,
    orderId: string,
    input: CustomerOrderLineInput,
    actorId: string
  ): Promise<CustomerOrderLine> {
    return withTenant(tenantId, async (client) => {
      const order = await this.orders.findById(client, tenantId, orderId);
      if (!order) throw ApiError.notFound('Customer Order tidak ditemukan.');
      if (order.status !== CustomerOrderStatus.RECEIVED) {
        throw ApiError.invalidState(
          `Order line hanya dapat ditambahkan selama order berstatus RECEIVED, saat ini ${order.status}.`
        );
      }

      const lineNo = await this.orders.nextLineNo(client, tenantId, orderId);
      const line = await this.insertLine(client, tenantId, orderId, input, lineNo);

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order_line',
        entityId: line.id,
        action: 'CREATE',
        newValue: line,
      });
      return line;
    });
  }

  async updateLine(
    tenantId: string,
    orderId: string,
    lineId: string,
    patch: Partial<CustomerOrderLineInput>,
    actorId: string
  ): Promise<CustomerOrderLine> {
    return withTenant(tenantId, async (client) => {
      const before = await this.orders.findLineById(client, tenantId, lineId);
      if (!before || before.customerOrderId !== orderId) {
        throw ApiError.notFound('Order line tidak ditemukan.');
      }

      // `planned_quantity <= ordered_quantity` is a CHECK on the table, but
      // reducing the ordered quantity below what is already planned would
      // violate it with a message no planner could act on. Say it here instead.
      if (patch.orderedQuantity !== undefined && patch.orderedQuantity < before.plannedQuantity) {
        throw ApiError.validation('Ordered quantity tidak boleh di bawah planned quantity.', [
          {
            field: 'orderedQuantity',
            code: 'OUT_OF_RANGE',
            message:
              `Ordered quantity ${patch.orderedQuantity} lebih kecil dari planned quantity ` +
              `${before.plannedQuantity} yang sudah masuk Production Plan.`,
          },
        ]);
      }

      const updated = await this.orders.updateLine(client, tenantId, lineId, {
        orderedQuantity: patch.orderedQuantity,
        unit: patch.unit,
        modelType: patch.modelType,
        requestedDeliveryDate: patch.requestedDeliveryDate,
      });
      if (!updated) throw ApiError.notFound('Order line tidak ditemukan.');

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order_line',
        entityId: lineId,
        action: 'UPDATE',
        previousValue: before,
        newValue: updated,
      });
      return updated;
    });
  }

  async removeLine(tenantId: string, orderId: string, lineId: string, actorId: string): Promise<void> {
    await withTenant(tenantId, async (client) => {
      const before = await this.orders.findLineById(client, tenantId, lineId);
      if (!before || before.customerOrderId !== orderId) {
        throw ApiError.notFound('Order line tidak ditemukan.');
      }
      if (before.plannedQuantity > 0) {
        throw ApiError.invalidState(
          `Order line tidak dapat dihapus: ${before.plannedQuantity} pcs sudah masuk Production Plan.`
        );
      }
      await this.orders.deleteLine(client, tenantId, lineId);
      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order_line',
        entityId: lineId,
        action: 'DELETE',
        previousValue: before,
      });
    });
  }

  async listLines(tenantId: string, orderId: string): Promise<CustomerOrderLine[]> {
    return withTenant(tenantId, (client) => this.orders.listLines(client, tenantId, orderId));
  }

  // --- Documents (MES-025) --------------------------------------------

  async attachDocument(
    tenantId: string,
    orderId: string,
    input: {
      fileName: string;
      contentType: string;
      sizeBytes: number;
      /** Base64 payload; the bytes go to storage, never into the row. */
      content?: string;
      /** An already-stored object, for a caller that uploaded out of band. */
      storageUrl?: string;
    },
    actorId: string
  ): Promise<CustomerOrderDocument> {
    const fieldErrors: ApiFieldError[] = [];
    if (!ALLOWED_DOCUMENT_TYPES.includes(input.contentType)) {
      fieldErrors.push({
        field: 'contentType',
        code: 'UNSUPPORTED_TYPE',
        message:
          `Tipe file ${input.contentType} tidak didukung. ` +
          `Gunakan: ${ALLOWED_DOCUMENT_TYPES.join(', ')}.`,
      });
    }
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      fieldErrors.push({ field: 'sizeBytes', code: 'REQUIRED', message: 'Ukuran file tidak valid.' });
    } else if (input.sizeBytes > MAX_DOCUMENT_BYTES) {
      fieldErrors.push({
        field: 'sizeBytes',
        code: 'TOO_LARGE',
        message:
          `Ukuran file ${(input.sizeBytes / 1024 / 1024).toFixed(1)} MB melebihi batas ` +
          `${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`,
      });
    }
    if (fieldErrors.length > 0) {
      throw ApiError.validation('Dokumen order tidak dapat diunggah.', fieldErrors);
    }

    if (!input.content && !input.storageUrl) {
      throw ApiError.validation('Dokumen order tidak dapat diunggah.', [
        { field: 'content', code: 'REQUIRED', message: 'Isi dokumen (base64) wajib dikirim.' },
      ]);
    }

    const documentId = `codoc-${randomUUID()}`;
    // Written before the row so a row can never point at bytes that are not
    // there. An orphaned object costs disk; an orphaned row breaks a preview.
    const stored = input.content
      ? await this.storage.put(tenantId, documentId, input.contentType, input.content)
      : { storageUrl: input.storageUrl!, sizeBytes: input.sizeBytes };

    return withTenant(tenantId, async (client) => {
      const order = await this.orders.findById(client, tenantId, orderId);
      if (!order) throw ApiError.notFound('Customer Order tidak ditemukan.');

      const doc = await this.orders.insertDocument(client, {
        id: documentId,
        tenantId,
        customerOrderId: orderId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: stored.sizeBytes,
        storageUrl: stored.storageUrl,
        uploadedBy: actorId,
      });

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order_document',
        entityId: doc.id,
        action: 'CREATE',
        newValue: { ...doc, customerOrderNumber: order.orderNumber },
      });
      return doc;
    });
  }

  async listDocuments(tenantId: string, orderId: string): Promise<CustomerOrderDocument[]> {
    return withTenant(tenantId, (client) => this.orders.listDocuments(client, tenantId, orderId));
  }

  /** Streams a stored document back; the route guards who may ask. */
  async readDocumentContent(
    tenantId: string,
    objectId: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return {
      buffer: await this.storage.get(tenantId, objectId),
      contentType: this.storage.contentTypeOf(objectId),
    };
  }

  async removeDocument(tenantId: string, documentId: string, actorId: string): Promise<void> {
    await withTenant(tenantId, async (client) => {
      const documents = await client.query<{ storage_url: string }>(
        'SELECT storage_url FROM customer_order_document WHERE tenant_id = $1 AND id = $2',
        [tenantId, documentId]
      );
      const removed = await this.orders.deleteDocument(client, tenantId, documentId);
      if (!removed) throw ApiError.notFound('Dokumen tidak ditemukan.');

      const objectId = documents.rows[0]?.storage_url?.split('/').at(-2);
      if (objectId) await this.storage.remove(tenantId, objectId);
      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order_document',
        entityId: documentId,
        action: 'DELETE',
      });
    });
  }

  // --- Status (MES-026) -----------------------------------------------

  /**
   * Recomputes an order's status from production facts.
   *
   * Called from the event handlers rather than by a user: §45 makes the point
   * that a status a human retypes is a status that is wrong by lunchtime.
   */
  async refreshStatus(
    exec: Executor,
    tenantId: string,
    orderId: string,
    actorId = 'system'
  ): Promise<CustomerOrder | undefined> {
    const order = await this.orders.findByIdForUpdate(exec, tenantId, orderId);
    if (!order) return undefined;

    const facts = await this.derivationFacts(exec, tenantId, orderId);
    const next = deriveCustomerOrderStatus(order.status, facts);
    if (next === order.status) return order;

    const updated = await this.orders.updateStatus(exec, tenantId, orderId, next);
    await this.audit.record(exec, {
      tenantId,
      actorId,
      actorType: 'SYSTEM',
      entityType: 'customer_order',
      entityId: orderId,
      action: 'STATUS_DERIVED',
      previousValue: { status: order.status },
      newValue: { status: next, facts },
    });
    await this.outbox.publish(
      exec,
      tenantId,
      planningEvent(PLANNING_EVENTS.CUSTOMER_ORDER_STATUS_CHANGED, 'customer_order', orderId, {
        orderNumber: order.orderNumber,
        previousStatus: order.status,
        newStatus: next,
      })
    );
    return updated;
  }

  /** Public entry point for the recompute, opening its own transaction. */
  async recomputeStatus(tenantId: string, orderId: string): Promise<CustomerOrder | undefined> {
    return withTenant(tenantId, (client) => this.refreshStatus(client, tenantId, orderId));
  }

  /**
   * The facts status derivation runs on.
   *
   * Read as aggregates in one round trip: whether every line is fully covered by
   * Production Plan Demand, whether any Work Order serving the order has started,
   * and whether produced quantity has caught up with what was ordered.
   */
  private async derivationFacts(
    exec: Executor,
    tenantId: string,
    orderId: string
  ): Promise<OrderDerivationFacts> {
    const lines = await exec.query<{
      line_count: string;
      fully_planned_lines: string;
      fully_produced_lines: string;
    }>(
      `SELECT
         COUNT(*)::text AS line_count,
         COUNT(*) FILTER (WHERE col.planned_quantity >= col.ordered_quantity)::text AS fully_planned_lines,
         COUNT(*) FILTER (WHERE col.produced_quantity >= col.ordered_quantity)::text AS fully_produced_lines
       FROM customer_order_line col
      WHERE col.tenant_id = $1 AND col.customer_order_id = $2`,
      [tenantId, orderId]
    );

    // Work Orders reach the order through the plan line, never by storing a
    // customer id (ADR-22): plan demand → plan line → work order.
    const production = await exec.query<{ in_production: string; any_wo: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE wo.status IN ('IN_PRODUCTION', 'COMPLETED'))::text AS in_production,
         COUNT(*)::text AS any_wo
       FROM production_plan_demand ppd
       JOIN work_order wo ON wo.production_plan_line_id = ppd.production_plan_line_id
      WHERE ppd.tenant_id = $1 AND ppd.customer_order_id = $2`,
      [tenantId, orderId]
    );

    const row = lines.rows[0];
    return {
      lineCount: Number(row?.line_count ?? 0),
      fullyPlannedLines: Number(row?.fully_planned_lines ?? 0),
      fullyProducedLines: Number(row?.fully_produced_lines ?? 0),
      workOrdersInProduction: Number(production.rows[0]?.in_production ?? 0),
      workOrderCount: Number(production.rows[0]?.any_wo ?? 0),
    };
  }

  /**
   * Cancels an order, refusing while any Work Order serving it is running
   * (MES-026-3).
   */
  async cancel(
    tenantId: string,
    orderId: string,
    reason: string,
    actorId: string
  ): Promise<CustomerOrder> {
    if (!reason || reason.trim() === '') {
      throw ApiError.validation('Alasan pembatalan wajib diisi.', [
        { field: 'reason', code: 'REQUIRED', message: 'Alasan pembatalan wajib diisi.' },
      ]);
    }

    return withTenant(tenantId, async (client) => {
      const order = await this.orders.findByIdForUpdate(client, tenantId, orderId);
      if (!order) throw ApiError.notFound('Customer Order tidak ditemukan.');

      const facts = await this.derivationFacts(client, tenantId, orderId);
      assertCancellable(order.status, facts);

      const updated = await this.orders.updateStatus(
        client,
        tenantId,
        orderId,
        CustomerOrderStatus.CANCELLED,
        reason
      );
      if (!updated) throw ApiError.notFound('Customer Order tidak ditemukan.');

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order',
        entityId: orderId,
        action: 'CANCEL',
        previousValue: { status: order.status },
        newValue: { status: CustomerOrderStatus.CANCELLED, reason },
      });
      await this.outbox.publish(
        client,
        tenantId,
        planningEvent(PLANNING_EVENTS.CUSTOMER_ORDER_CANCELLED, 'customer_order', orderId, {
          orderNumber: order.orderNumber,
          previousStatus: order.status,
          newStatus: CustomerOrderStatus.CANCELLED,
          reason,
        })
      );
      return updated;
    });
  }

  /**
   * The three logistics statuses the MVP leaves to a human (MES-026 notes).
   *
   * Ready to Ship, Shipped and Completed are set by hand because the MVP does
   * not execute shipping; there is no fact to derive them from.
   */
  async setLogisticsStatus(
    tenantId: string,
    orderId: string,
    status: CustomerOrderStatus,
    actorId: string
  ): Promise<CustomerOrder> {
    const manual = [
      CustomerOrderStatus.READY_TO_SHIP,
      CustomerOrderStatus.SHIPPED,
      CustomerOrderStatus.COMPLETED,
    ];
    if (!manual.includes(status)) {
      throw ApiError.validation(
        `Status ${status} diturunkan sistem dari fakta produksi dan tidak dapat diset manual. ` +
          `Hanya ${manual.join(', ')} yang manual.`
      );
    }

    return withTenant(tenantId, async (client) => {
      const order = await this.orders.findByIdForUpdate(client, tenantId, orderId);
      if (!order) throw ApiError.notFound('Customer Order tidak ditemukan.');
      if (order.status === CustomerOrderStatus.CANCELLED) {
        throw ApiError.invalidState('Customer Order yang dibatalkan tidak dapat diubah statusnya.');
      }
      if (
        order.status !== CustomerOrderStatus.PRODUCED &&
        !manual.includes(order.status)
      ) {
        throw ApiError.invalidState(
          `Status logistik hanya dapat diset setelah order PRODUCED, saat ini ${order.status}.`
        );
      }

      const updated = await this.orders.updateStatus(client, tenantId, orderId, status);
      if (!updated) throw ApiError.notFound('Customer Order tidak ditemukan.');

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer_order',
        entityId: orderId,
        action: 'STATUS_SET',
        previousValue: { status: order.status },
        newValue: { status },
      });
      return updated;
    });
  }
}
