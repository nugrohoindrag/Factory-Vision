import { MachineState, ProductionOrderStatus, WorkOrderStatus } from '@factory-vision/domain-types';
import type { ProductionOrder, WorkOrder } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { withTenant } from '../../platform/db/pool.js';
import type { Executor } from '../../platform/db/executor.js';
import {
  WorkOrderStateMachine,
  WorkOrderTransitionError,
  type WorkOrderTransitionContext,
} from './work-order.state-machine.js';
import { WorkOrderRepository } from './work-order.repository.js';
import { ProductionOrderRepository } from './production-order.repository.js';
import { BatchRepository } from './batch.repository.js';
import { MachineStateRepository } from '../shopfloor/machine-state.repository.js';
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
  private readonly batches = new BatchRepository();
  // §11's side effects include driving the machine: a work order that starts
  // leaves its machine RUNNING, and one that completes leaves it IDLE. Without
  // this the machine state log — and therefore Availability — would only ever
  // be moved by downtime.
  private readonly machineStates = new MachineStateRepository();

  /**
   * How production tells planning that a fact changed (MES-026-1).
   *
   * Injected rather than imported so production does not construct planning's
   * services, and optional so the module still works in a test that has no
   * planning at all. Customer Order status is *derived* from these facts
   * (MES-026), and the derivation rules live in planning where they belong.
   */
  private planning?: {
    refreshOrdersForPlanLine(tenantId: string, planLineId: string): Promise<number>;
    propagateProducedQuantity(
      tenantId: string,
      planLineId: string,
      outputQuantity: number
    ): Promise<number>;
  };

  attachPlanning(planning: {
    refreshOrdersForPlanLine(tenantId: string, planLineId: string): Promise<number>;
    propagateProducedQuantity(
      tenantId: string,
      planLineId: string,
      outputQuantity: number
    ): Promise<number>;
  }): void {
    this.planning = planning;
  }

  /**
   * Fires the derivation for whatever orders a work order serves.
   *
   * Detached: the transition it follows has already committed, and an order
   * status that lags by a moment is a far smaller problem than a completed work
   * order that reports a 500.
   */
  private notifyPlanning(tenantId: string, workOrder: WorkOrder): void {
    const planLineId = workOrder.productionPlanLineId;
    if (!this.planning || !planLineId) return;
    this.planning.refreshOrdersForPlanLine(tenantId, planLineId).catch((error) => {
      // eslint-disable-next-line no-console
      console.error(
        '[planning] gagal memperbarui status Customer Order:',
        error instanceof Error ? error.message : error
      );
    });
  }

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
            lineId: 'line-01',
            workCenterId: route.workCenterId,
            machineId: route.machineId,
            targetQuantity: order.quantity,
            plannedQuantity: order.quantity,
            unit: 'PCS',
            plannedStart: now,
            plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
            inputQuantity: 0,
            outputQuantity: 0,
            rejectQuantity: 0,
            scrapQuantity: 0,
            reworkQuantity: 0,
            transferredQuantity: 0,
            status: route.sequence === 1 ? WorkOrderStatus.CONFIRMED : WorkOrderStatus.SCHEDULED,
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

  /**
   * Resolves the Production Plan Line a Work Order belongs to.
   *
   * §8 makes the plan line the owner of demand, and migration 011 backs that
   * with a foreign key, so a Work Order without one cannot be stored. A caller
   * may name the plan line directly; a caller still working in the legacy
   * production-order vocabulary gets the plan line migration 010 created for
   * that order. Neither available is a refusal with a reason, not a 500.
   */
  private async resolvePlanLineId(
    exec: Executor,
    tenantId: string,
    payload: { productionPlanLineId?: string; productionOrderId?: string }
  ): Promise<string> {
    if (payload.productionPlanLineId) {
      const found = await exec.query<{ id: string }>(
        'SELECT id FROM production_plan_line WHERE tenant_id = $1 AND id = $2',
        [tenantId, payload.productionPlanLineId]
      );
      if (!found.rows[0]) {
        throw ApiError.validation('Production Plan Line tidak ditemukan.', [
          {
            field: 'productionPlanLineId',
            code: 'NOT_FOUND',
            message: `Production Plan Line ${payload.productionPlanLineId} tidak ada.`,
          },
        ]);
      }
      return found.rows[0].id;
    }

    if (payload.productionOrderId) {
      // The identity migration 010 gave every legacy production order.
      const legacy = await exec.query<{ id: string }>(
        'SELECT id FROM production_plan_line WHERE tenant_id = $1 AND id = $2',
        [tenantId, `planline-mig-${payload.productionOrderId}`]
      );
      if (legacy.rows[0]) return legacy.rows[0].id;
    }

    throw ApiError.validation(
      'Work Order harus menempel pada Production Plan Line.',
      [
        {
          field: 'productionPlanLineId',
          code: 'REQUIRED',
          message:
            'Sertakan productionPlanLineId. Work Order pada v1.0 dihasilkan dari Production Plan ' +
            '(POST /v1/production-plans/{id}/generate-work-orders); pembuatan manual tetap ' +
            'memerlukan plan line sebagai pemilik demand-nya.',
        },
      ]
    );
  }

  async createWorkOrder(
    tenantId: string,
    payload: {
      productionOrderId?: string;
      /** The plan line this Work Order serves. Required on the v1.0 model (§8). */
      productionPlanLineId?: string;
      productId: string;
      lineId: string;
      processId?: string;
      sequence?: number;
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
      const productionPlanLineId = await this.resolvePlanLineId(client, tenantId, payload);
      const count = (await this.workOrders.count(client, tenantId)) + 1;
      const now = new Date().toISOString();
      return this.workOrders.create(client, {
        id: `wo-${Date.now()}`,
        tenantId,
        productionPlanLineId,
        productionOrderId: payload.productionOrderId,
        woNumber: `WO-${now.substring(0, 10).replace(/-/g, '')}-${String(count).padStart(3, '0')}`,
        productId: payload.productId,
        processId: payload.processId,
        sequence: payload.sequence || 1,
        lineId: payload.lineId,
        workCenterId: payload.workCenterId,
        machineId: payload.machineId,
        targetQuantity: payload.targetQuantity,
        plannedQuantity: payload.targetQuantity,
        unit: payload.unit || 'PCS',
        plannedStart: payload.plannedStart,
        plannedEnd: payload.plannedEnd,
        inputQuantity: 0,
        outputQuantity: 0,
        rejectQuantity: 0,
        scrapQuantity: 0,
        reworkQuantity: 0,
        transferredQuantity: 0,
        status: WorkOrderStatus.SCHEDULED,
        priority: payload.priority || 1,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  /**
   * Assigns an existing batch to a work order.
   *
   * Under ADR-29 the relation points the other way round: a batch names its
   * work order, a work order does not name a batch. "Attaching" is therefore an
   * update to production_batch.work_order_id plus flipping the work order into
   * batch-managed mode, not a write to a column on work_order.
   *
   * Switching a work order that already has direct production records into
   * batch mode is refused by the execution-path constraint (E1/E2). That
   * rejection is correct — the mode cannot change once production has been
   * recorded — so it is surfaced as a domain error rather than a raw
   * constraint violation.
   */
  async assignBatchToWorkOrder(tenantId: string, workOrderId: string, batchId: string): Promise<WorkOrder> {
    return withTenant(tenantId, async (client) => {
      const wo = await this.workOrders.findById(client, tenantId, workOrderId);
      if (!wo) throw ApiError.notFound('Work order tidak ditemukan.');

      const batch = await this.batches.findById(client, tenantId, batchId);
      if (!batch) throw ApiError.notFound('Batch tidak ditemukan.');

      try {
        await this.batches.update(client, tenantId, batchId, { workOrderId });
        const updated = await this.workOrders.update(client, tenantId, workOrderId, {
          isBatchManaged: true,
        });
        if (!updated) throw ApiError.notFound('Work order tidak ditemukan.');
        return updated;
      } catch (err: any) {
        if (err?.code === '23514' || err?.code === '23503') {
          throw ApiError.invalidState(
            'Work order sudah memiliki production record tanpa batch, sehingga tidak dapat diubah menjadi batch-managed.'
          );
        }
        throw err;
      }
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
        // MES-001-4 added mold and shift as Work Order resource assignments and
        // the repository has always written them, but this pass-through dropped
        // both. §11's confirmation checklist requires machine, mold and shift,
        // so the checklist was unsatisfiable through the API — a Work Order
        // could never legitimately reach CONFIRMED.
        moldId: payload.moldId,
        shiftId: payload.shiftId,
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
   * Gathers the facts §11's guards judge (MES-015-2, MES-015-4).
   *
   * Read inside the caller's transaction, alongside the status itself. Two
   * things here are not optional:
   *
   * - **`activeDowntimeCount`** — completing a work order with a downtime still
   *   open leaves an interval that never ends, and every OEE figure derived from
   *   it is wrong from then on.
   * - **`predecessor`** — the soft process guard (§13). Whether it is soft or
   *   strict is a tenant policy, read from `planning_config`, so the same code
   *   serves a plant that enforces sequence and one that does not.
   */
  private async transitionContext(
    exec: Executor,
    tenantId: string,
    workOrder: WorkOrder
  ): Promise<WorkOrderTransitionContext> {
    const downtime = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM downtime_record
        WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'ACTIVE'`,
      [tenantId, workOrder.id]
    );

    const config = await exec.query<{ strict_process_sequence: boolean }>(
      'SELECT strict_process_sequence FROM planning_config WHERE tenant_id = $1',
      [tenantId]
    );

    // ADR-36: mold is on the confirmation checklist only where the product
    // declares an active `product_mold_compatibility`. §15 makes that table the
    // source of truth for whether a product uses a mold at all, and a product
    // with none has nothing to assign — requiring one would make confirmation
    // impossible rather than careful.
    const moldCompatibility = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM product_mold_compatibility
        WHERE tenant_id = $1 AND product_id = $2 AND active = TRUE`,
      [tenantId, workOrder.productId]
    );

    const context: WorkOrderTransitionContext = {
      plannedQuantity: workOrder.plannedQuantity,
      plannedStart: workOrder.plannedStart,
      plannedEnd: workOrder.plannedEnd,
      sequence: workOrder.sequence,
      machineId: workOrder.machineId,
      moldId: workOrder.moldId,
      moldRequired: Number(moldCompatibility.rows[0]?.n ?? 0) > 0,
      shiftId: workOrder.shiftId,
      activeDowntimeCount: Number(downtime.rows[0]?.n ?? 0),
      strictProcessSequence: config.rows[0]?.strict_process_sequence ?? false,
    };

    if (workOrder.predecessorWorkOrderId) {
      const predecessor = await this.workOrders.findById(
        exec,
        tenantId,
        workOrder.predecessorWorkOrderId
      );
      if (predecessor) {
        context.predecessor = {
          workOrderId: predecessor.woNumber,
          status: predecessor.status,
          availableQuantity: Math.max(
            predecessor.transferredQuantity - workOrder.inputQuantity,
            0
          ),
        };
      }
    }

    return context;
  }

  /**
   * Applies a guarded state transition.
   *
   * Read and write happen in one transaction so the state machine judges the
   * status that is actually stored. Reading outside it would let two requests
   * both see CONFIRMED and both "start" the same work order.
   */
  /**
   * Turns a resource-exclusivity unique violation into a 409 anyone can read.
   *
   * Returns `undefined` for anything else, so a genuine failure is never
   * disguised as a scheduling conflict.
   */
  private asResourceConflict(error: unknown, workOrder: WorkOrder): ApiError | undefined {
    const constraint = (error as { constraint?: string })?.constraint;
    const code = (error as { code?: string })?.code;
    if (code !== '23505') return undefined;

    if (constraint === 'uq_work_order_machine_in_production') {
      return ApiError.conflict(
        `Mesin ${workOrder.machineId ?? ''} sudah menjalankan work order lain. ` +
          'Satu mesin hanya dapat menjalankan satu work order pada satu waktu, ' +
          'selesaikan atau hentikan work order tersebut lebih dulu.'
      );
    }
    if (constraint === 'uq_work_order_mold_in_production') {
      return ApiError.conflict(
        `Mold ${workOrder.moldId ?? ''} sedang dipakai work order lain. ` +
          'Satu mold fisik tidak dapat terpasang di dua mesin sekaligus.'
      );
    }
    return undefined;
  }

  private async transition(
    tenantId: string,
    id: string,
    next: WorkOrderStatus,
    stamps: (current: WorkOrder) => Partial<WorkOrder> = () => ({}),
    overrides: Partial<WorkOrderTransitionContext> = {}
  ): Promise<WorkOrder> {
    return withTenant(tenantId, async (client) => {
      const current = await this.workOrders.findById(client, tenantId, id);
      if (!current) throw ApiError.notFound('Work order tidak ditemukan.');

      const context = { ...(await this.transitionContext(client, tenantId, current)), ...overrides };
      try {
        WorkOrderStateMachine.validateTransition(current.status, next, context);
      } catch (error) {
        // The state machine speaks in guard failures; the API speaks in status
        // codes. A refused-but-legal transition is 409, and the individual
        // reasons travel as field errors so a console can list them.
        if (error instanceof WorkOrderTransitionError) {
          throw ApiError.invalidState(error.message);
        }
        throw error;
      }

      let updated;
      try {
        updated = await this.workOrders.updateStatus(client, tenantId, id, next, stamps(current));
      } catch (error) {
        // Migration 021 makes "one running Work Order per machine, and per
        // mould" a database invariant (Architecture section 891). Two operators
        // starting on the same machine at the same moment is a real race, and
        // the loser must be told what happened rather than shown a 500 — the
        // constraint is the correctness mechanism, this is only its manners.
        throw this.asResourceConflict(error, current) ?? error;
      }
      if (!updated) throw ApiError.notFound('Work order tidak ditemukan.');

      // MES-015-3: apply the machine-state effect the state machine decided.
      // In the same transaction as the status change, so a work order can never
      // be IN_PRODUCTION on a machine the log still calls idle.
      const decision = WorkOrderStateMachine.evaluate(current.status, next, context);
      if (decision.effects.machineState && updated.machineId) {
        await this.machineStates.transition(client, {
          tenantId,
          machineId: updated.machineId,
          processId: updated.processId,
          state:
            decision.effects.machineState === 'RUNNING'
              ? MachineState.RUNNING
              : MachineState.IDLE,
          startedAt: new Date().toISOString(),
          workOrderId: updated.id,
        });
      }

      // §11: completing the **last** process is what produces finished goods,
      // so that is the only point at which produced quantity reaches the
      // Customer Order. Summing across processes would report an order of
      // 10.000 as 38.750 (§8 A2).
      if (next === WorkOrderStatus.COMPLETED) {
        const successors = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM work_order
            WHERE tenant_id = $1 AND predecessor_work_order_id = $2`,
          [tenantId, id]
        );
        const isLastProcess = Number(successors.rows[0]?.n ?? 0) === 0;
        if (isLastProcess && updated.productionPlanLineId && this.planning) {
          await this.planning.propagateProducedQuantity(
            tenantId,
            updated.productionPlanLineId,
            updated.outputQuantity
          );
        }
      }

      this.notifyPlanning(tenantId, updated);
      return updated;
    });
  }

  async confirmWorkOrder(
    tenantId: string,
    id: string,
    payload?: { confirmedBy?: string }
  ): Promise<WorkOrder> {
    return this.transition(tenantId, id, WorkOrderStatus.CONFIRMED, () => ({
      confirmedBy: payload?.confirmedBy,
      confirmedAt: new Date().toISOString(),
    }));
  }

  async releaseWorkOrder(tenantId: string, id: string): Promise<WorkOrder> {
    return this.confirmWorkOrder(tenantId, id);
  }

  async startWorkOrder(
    tenantId: string,
    id: string,
    payload: { operatorId: string; occurredAt?: string }
  ): Promise<WorkOrder> {
    return this.transition(
      tenantId,
      id,
      WorkOrderStatus.IN_PRODUCTION,
      (current) => ({
        // COALESCE in the repository keeps the first start, so a resumed order
        // does not lose when it originally began.
        actualStart: current.actualStart ?? payload.occurredAt ?? new Date().toISOString(),
      }),
      // The operator issuing the start is the assignment for this transition:
      // a dedicated `work_order_assignment` arrives with resource assignment in
      // Sprint 8 (MES-052), and until then the caller is the fact we have.
      { assignedOperatorIds: payload.operatorId ? [payload.operatorId] : [] }
    );
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

  /**
   * Cancels a work order. The reason is mandatory (§11) and is stored on the
   * row, not only in the audit trail: the shop floor sees why on the card.
   */
  async cancelWorkOrder(tenantId: string, id: string, reason?: string): Promise<WorkOrder> {
    return this.transition(
      tenantId,
      id,
      WorkOrderStatus.CANCELLED,
      () => ({ statusReason: reason }),
      { reason }
    );
  }

  async incrementQuantities(
    tenantId: string,
    id: string,
    good: number,
    reject: number,
    extra: { scrap?: number; rework?: number; input?: number; transferred?: number } = {}
  ): Promise<void> {
    await withTenant(tenantId, (client) =>
      this.workOrders.incrementQuantities(client, tenantId, id, good, reject, extra)
    );
  }

  /**
   * For callers already inside a transaction, see the class comment.
   *
   * `extra.input` matters: §10's first invariant is
   * `input >= output + reject + scrap + rework`, so a caller that adds to the
   * dispositions without adding to input drives the work order to negative WIP.
   */
  async incrementQuantitiesWith(
    exec: Executor,
    tenantId: string,
    id: string,
    good: number,
    reject: number,
    extra: { scrap?: number; rework?: number; input?: number; transferred?: number } = {}
  ): Promise<void> {
    await this.workOrders.incrementQuantities(exec, tenantId, id, good, reject, extra);
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
