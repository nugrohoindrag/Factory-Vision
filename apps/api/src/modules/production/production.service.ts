import { ProductionOrderStatus, WorkOrderStatus } from '@factory-vision/domain-types';
import type { ProductionOrder, WorkOrder } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { withTenant } from '../../platform/db/pool.js';
import type { Executor } from '../../platform/db/executor.js';
import { WorkOrderStateMachine } from './work-order.state-machine.js';
import { WorkOrderRepository } from './work-order.repository.js';
import { ProductionOrderRepository } from './production-order.repository.js';
import { demoProductionOrders, demoWorkOrders } from './production.demo.js';

/**
 * Production orders and work orders, backed by PostgreSQL (persistence fix §10).
 *
 * A work order's status and its running good/reject totals are operational
 * state, not a cache: an order that comes back RELEASED after a restart tells
 * an operator to begin work that is already half finished, and the totals it
 * forgot are the ones the shift is measured on. Every method here therefore
 * reads and writes the database inside `withTenant`, which supplies both the
 * transaction and the `app.tenant_id` the row-level security policies read.
 *
 * The `…With` variants take an executor so a caller that already holds a
 * transaction can compose: recording production output updates a work order's
 * totals in the same transaction as the production_record that justifies them.
 */
export class ProductionService {
  private readonly workOrders = new WorkOrderRepository();
  private readonly productionOrders = new ProductionOrderRepository();

  // --- Production orders ---------------------------------------------

  async getProductionOrders(tenantId: string): Promise<ProductionOrder[]> {
    return withTenant(tenantId, (client) => this.productionOrders.list(client, tenantId));
  }

  async getProductionOrderById(tenantId: string, id: string): Promise<ProductionOrder | undefined> {
    return withTenant(tenantId, (client) => this.productionOrders.findById(client, tenantId, id));
  }

  async createProductionOrder(
    tenantId: string,
    payload: {
      orderNumber: string;
      productId: string;
      quantity: number;
      dueDate: string;
      createdBy: string;
    }
  ): Promise<ProductionOrder> {
    const order: ProductionOrder = {
      id: `po-${Date.now()}`,
      tenantId,
      orderNumber: payload.orderNumber,
      productId: payload.productId,
      quantity: payload.quantity,
      dueDate: payload.dueDate,
      status: ProductionOrderStatus.PLANNED,
      createdBy: payload.createdBy,
      createdAt: new Date().toISOString(),
    };
    return withTenant(tenantId, (client) => this.productionOrders.create(client, order));
  }

  async updateProductionOrder(
    tenantId: string,
    id: string,
    payload: Partial<Omit<ProductionOrder, 'id' | 'tenantId'>>
  ): Promise<ProductionOrder> {
    const updated = await withTenant(tenantId, (client) =>
      this.productionOrders.update(client, tenantId, id, payload)
    );
    if (!updated) throw ApiError.notFound('Production order tidak ditemukan.');
    return updated;
  }

  async deleteProductionOrder(tenantId: string, id: string): Promise<boolean> {
    const removed = await withTenant(tenantId, (client) =>
      this.productionOrders.delete(client, tenantId, id)
    );
    if (!removed) throw ApiError.notFound('Production order tidak ditemukan.');
    return true;
  }

  /**
   * Releases an order and, the first time, expands its routing into work
   * orders.
   *
   * The whole expansion is one transaction: an order marked RELEASED whose
   * work orders were only half created would leave the shop floor with a
   * partial routing and no indication that anything was missing.
   */
  async releaseProductionOrder(tenantId: string, id: string, routings?: any[]): Promise<ProductionOrder> {
    return withTenant(tenantId, async (client) => {
      const order = await this.productionOrders.findById(client, tenantId, id);
      if (!order) throw ApiError.notFound('Production order tidak ditemukan.');

      const released = await this.productionOrders.update(client, tenantId, id, {
        status: ProductionOrderStatus.RELEASED,
      });

      const existing = await this.workOrders.list(client, tenantId, {});
      const alreadyExpanded = existing.some((wo) => wo.productionOrderId === id);

      if (!alreadyExpanded && routings && routings.length > 0) {
        const productRoutings = routings.filter((r) => r.productId === order.productId && r.active);
        for (const route of productRoutings) {
          const now = new Date().toISOString();
          await this.workOrders.create(client, {
            id: `wo-${Date.now()}-${route.sequence}`,
            tenantId,
            productionOrderId: order.id,
            woNumber: `${order.orderNumber}-SEQ${route.sequence}`,
            productId: order.productId,
            processId: route.processId,
            sequence: route.sequence,
            batchId: undefined,
            lineId: 'line-01',
            workCenterId: route.workCenterId,
            machineId: route.machineId,
            targetQuantity: order.quantity,
            unit: 'PCS',
            plannedStart: now,
            plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
            goodQuantity: 0,
            rejectQuantity: 0,
            status: route.sequence === 1 ? WorkOrderStatus.RELEASED : WorkOrderStatus.SCHEDULED,
            priority: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      return released ?? order;
    });
  }

  // --- Work orders ----------------------------------------------------

  async getWorkOrders(
    tenantId: string,
    filter?: { lineId?: string; status?: string; processId?: string }
  ): Promise<WorkOrder[]> {
    const clean = {
      lineId: filter?.lineId && filter.lineId !== 'ALL' ? filter.lineId : undefined,
      status: filter?.status && filter.status !== 'ALL' ? filter.status : undefined,
      processId: filter?.processId && filter.processId !== 'ALL' ? filter.processId : undefined,
    };
    return withTenant(tenantId, (client) => this.workOrders.list(client, tenantId, clean));
  }

  async getWorkOrderById(tenantId: string, id: string): Promise<WorkOrder | undefined> {
    return withTenant(tenantId, (client) => this.workOrders.findById(client, tenantId, id));
  }

  /** For callers already inside a transaction. */
  async getWorkOrderByIdWith(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<WorkOrder | undefined> {
    return this.workOrders.findById(exec, tenantId, id);
  }

  async createWorkOrder(
    tenantId: string,
    payload: {
      productionOrderId: string;
      productId: string;
      lineId: string;
      processId?: string;
      sequence?: number;
      batchId?: string;
      workCenterId?: string;
      machineId?: string;
      targetQuantity: number;
      unit?: string;
      priority?: number;
      plannedStart: string;
      plannedEnd: string;
    }
  ): Promise<WorkOrder> {
    return withTenant(tenantId, async (client) => {
      const count = (await this.workOrders.count(client, tenantId)) + 1;
      const now = new Date().toISOString();
      return this.workOrders.create(client, {
        id: `wo-${Date.now()}`,
        tenantId,
        productionOrderId: payload.productionOrderId,
        woNumber: `WO-${now.substring(0, 10).replace(/-/g, '')}-${String(count).padStart(3, '0')}`,
        productId: payload.productId,
        processId: payload.processId,
        sequence: payload.sequence || 1,
        batchId: payload.batchId,
        lineId: payload.lineId,
        workCenterId: payload.workCenterId,
        machineId: payload.machineId,
        targetQuantity: payload.targetQuantity,
        unit: payload.unit || 'PCS',
        plannedStart: payload.plannedStart,
        plannedEnd: payload.plannedEnd,
        goodQuantity: 0,
        rejectQuantity: 0,
        status: WorkOrderStatus.SCHEDULED,
        priority: payload.priority || 1,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async updateWorkOrder(
    tenantId: string,
    id: string,
    payload: Partial<Omit<WorkOrder, 'id' | 'tenantId' | 'woNumber'>>
  ): Promise<WorkOrder> {
    return withTenant(tenantId, async (client) => {
      const current = await this.workOrders.findById(client, tenantId, id);
      if (!current) throw ApiError.notFound('Work order tidak ditemukan.');

      const updated = await this.workOrders.update(client, tenantId, id, {
        targetQuantity: payload.targetQuantity,
        plannedStart: payload.plannedStart,
        plannedEnd: payload.plannedEnd,
        priority: payload.priority,
        machineId: payload.machineId,
        batchId: payload.batchId,
        processId: payload.processId,
        lineId: payload.lineId,
        workCenterId: payload.workCenterId,
        productId: payload.productId,
        sequence: payload.sequence,
        unit: payload.unit,
      });

      // A status supplied here bypasses no rule the state machine enforces
      // elsewhere: the dedicated transitions below are the guarded path, and
      // this exists only for the planner's edit form.
      if (payload.status !== undefined && payload.status !== current.status) {
        return (await this.workOrders.updateStatus(client, tenantId, id, payload.status)) ?? updated!;
      }
      return updated!;
    });
  }

  async deleteWorkOrder(tenantId: string, id: string): Promise<boolean> {
    const removed = await withTenant(tenantId, (client) => this.workOrders.delete(client, tenantId, id));
    if (!removed) throw ApiError.notFound('Work order tidak ditemukan.');
    return true;
  }

  /**
   * Applies a guarded state transition.
   *
   * Read and write happen in one transaction so the state machine judges the
   * status that is actually stored. Reading outside it would let two requests
   * both see RELEASED and both "start" the same work order.
   */
  private async transition(
    tenantId: string,
    id: string,
    next: WorkOrderStatus,
    stamps: (current: WorkOrder) => { actualStart?: string; actualEnd?: string } = () => ({})
  ): Promise<WorkOrder> {
    return withTenant(tenantId, async (client) => {
      const current = await this.workOrders.findById(client, tenantId, id);
      if (!current) throw ApiError.notFound('Work order tidak ditemukan.');

      WorkOrderStateMachine.validateTransition(current.status, next);

      const updated = await this.workOrders.updateStatus(client, tenantId, id, next, stamps(current));
      if (!updated) throw ApiError.notFound('Work order tidak ditemukan.');
      return updated;
    });
  }

  async releaseWorkOrder(tenantId: string, id: string): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.RELEASED);
  }

  async startWorkOrder(
    tenantId: string,
    id: string,
    payload: { operatorId: string; occurredAt?: string }
  ): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.IN_PROGRESS, (current) => ({
      // COALESCE in the repository keeps the first start, so a resumed order
      // does not lose when it originally began.
      actualStart: current.actualStart ?? payload.occurredAt ?? new Date().toISOString(),
    }));
  }

  async pauseWorkOrder(tenantId: string, id: string): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.PAUSED);
  }

  async resumeWorkOrder(tenantId: string, id: string): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.IN_PROGRESS);
  }

  async completeWorkOrder(
    tenantId: string,
    id: string,
    payload?: { occurredAt?: string }
  ): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.COMPLETED, () => ({
      actualEnd: payload?.occurredAt ?? new Date().toISOString(),
    }));
  }

  async cancelWorkOrder(tenantId: string, id: string): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.CANCELLED);
  }

  async incrementQuantities(tenantId: string, id: string, good: number, reject: number): Promise<void> {
    await withTenant(tenantId, (client) =>
      this.workOrders.incrementQuantities(client, tenantId, id, good, reject)
    );
  }

  /** For callers already inside a transaction, see the class comment. */
  async incrementQuantitiesWith(
    exec: Executor,
    tenantId: string,
    id: string,
    good: number,
    reject: number
  ): Promise<void> {
    await this.workOrders.incrementQuantities(exec, tenantId, id, good, reject);
  }

  async counts(tenantId: string): Promise<{ productionOrders: number; workOrders: number }> {
    return withTenant(tenantId, async (client) => ({
      productionOrders: await this.productionOrders.count(client, tenantId),
      workOrders: await this.workOrders.count(client, tenantId),
    }));
  }

  /**
   * Writes the demo plant's planned work into PostgreSQL, once.
   *
   * Every insert is `ON CONFLICT (id) DO NOTHING`, so a second boot adds
   * nothing and, more importantly, does not reset a work order the shop floor
   * has since advanced. Nothing here runs unless SEED_DEMO_DATA is on.
   */
  async seedDemoProductionOrders(exec: Executor, tenantId: string): Promise<number> {
    let created = 0;
    for (const order of demoProductionOrders()) {
      if (!(await this.productionOrders.findById(exec, tenantId, order.id))) {
        await this.productionOrders.create(exec, order);
        created += 1;
      }
    }
    return created;
  }

  /**
   * Work orders are seeded after production orders and batches, which they
   * reference by foreign key.
   */
  async seedDemoWorkOrders(exec: Executor, tenantId: string): Promise<number> {
    let created = 0;
    for (const workOrder of demoWorkOrders()) {
      if (!(await this.workOrders.findById(exec, tenantId, workOrder.id))) {
        await this.workOrders.create(exec, workOrder);
        created += 1;
      }
    }
    return created;
  }
}
