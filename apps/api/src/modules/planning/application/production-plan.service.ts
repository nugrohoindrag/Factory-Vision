import { randomUUID } from 'crypto';
import { CapacityStatus, CustomerOrderStatus, ProductionPlanStatus } from '@factory-vision/domain-types';
import type { ProductionPlanDemand } from '@factory-vision/domain-types';
import { withTenant } from '../../../platform/db/pool.js';
import type { Executor } from '../../../platform/db/executor.js';
import { ApiError } from '../../../platform/http/api-error.js';
import {
  ProductionPlanRepository,
  type ProductionPlanRecord,
  type ProductionPlanLineRecord,
} from '../infrastructure/production-plan.repository.js';
import { CustomerOrderRepository } from '../infrastructure/customer-order.repository.js';
import { PlanningReferenceRepository } from '../infrastructure/planning-reference.repository.js';
import { PlanningAudit } from '../infrastructure/planning-audit.js';
import { OutboxRepository } from '../infrastructure/outbox.repository.js';
import { CustomerOrderService } from './customer-order.service.js';
import { CapacityPlanService } from './capacity-plan.service.js';
import { nextNumber, productionPlanPrefix } from '../domain/numbering.js';
import { PLANNING_EVENTS, planningEvent } from '../domain/planning.events.js';
import {
  WIZARD_STEPS,
  assertStepReachable,
  type WizardReadiness,
} from '../domain/production-plan.wizard.js';

/**
 * Production Plan (MES-035, MES-036, MES-039, MES-040).
 *
 * Three rules from §8 and ADR-22 shape everything here:
 *
 * - **`production_plan_demand` is the only owner of demand.** Which Customer
 *   Order Line a plan line is producing for lives there and nowhere else — not
 *   on the Work Order, which stores no customer at all.
 * - **`demand_quantity` and `planned_quantity` are separate and both visible.**
 *   A planner who decides to make less than was ordered has made a decision, and
 *   collapsing the two numbers would hide it.
 * - **Aggregation never crosses processes.** A plan line's planned quantity is a
 *   decision, not `SUM(work_order.planned_quantity)`, which would report 40.000
 *   for a demand of 10.000 across a four-process routing.
 */

export interface ProductionPlanDetail extends ProductionPlanRecord {
  lines: ProductionPlanLineRecord[];
  demands: ProductionPlanDemand[];
}

export interface CreatePlanInput {
  periodStart: string;
  periodEnd: string;
  demandForecastId?: string;
  capacityPlanId?: string;
}

export interface AddDemandInput {
  customerOrderLineId: string;
  /** Defaults to the order line's outstanding quantity. */
  demandQuantity?: number;
}

export class ProductionPlanService {
  private readonly plans = new ProductionPlanRepository();
  private readonly orders = new CustomerOrderRepository();
  private readonly reference = new PlanningReferenceRepository();
  private readonly audit = new PlanningAudit();
  private readonly outbox = new OutboxRepository();
  private readonly customerOrders = new CustomerOrderService();
  private readonly capacity = new CapacityPlanService();

  // --- CRUD (MES-035) --------------------------------------------------

  async list(
    tenantId: string,
    filter: { status?: ProductionPlanStatus[]; periodStart?: string; periodEnd?: string } = {}
  ): Promise<ProductionPlanRecord[]> {
    return withTenant(tenantId, (client) => this.plans.list(client, tenantId, filter));
  }

  async get(tenantId: string, id: string): Promise<ProductionPlanDetail> {
    return withTenant(tenantId, (client) => this.readDetail(client, tenantId, id));
  }

  private async readDetail(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<ProductionPlanDetail> {
    const plan = await this.plans.findById(exec, tenantId, id);
    if (!plan) throw ApiError.notFound('Production Plan tidak ditemukan.');
    return {
      ...plan,
      lines: await this.plans.listLines(exec, tenantId, id),
      demands: await this.plans.listDemandForPlan(exec, tenantId, id),
    };
  }

  async create(tenantId: string, input: CreatePlanInput, actorId: string): Promise<ProductionPlanDetail> {
    if (Date.parse(input.periodEnd) < Date.parse(input.periodStart)) {
      throw ApiError.validation('Periode plan tidak valid.', [
        { field: 'periodEnd', code: 'OUT_OF_RANGE', message: 'Period end harus setelah period start.' },
      ]);
    }

    return withTenant(tenantId, async (client) => {
      const config = await this.reference.getConfig(client, tenantId);
      const planNumber = await nextNumber(
        client,
        tenantId,
        'production_plan',
        'plan_number',
        productionPlanPrefix(input.periodStart)
      );

      const plan = await this.plans.insert(client, {
        id: `plan-${randomUUID()}`,
        tenantId,
        planNumber,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        demandForecastId: input.demandForecastId,
        capacityPlanId: input.capacityPlanId,
        status: ProductionPlanStatus.DRAFT,
        wizardStep: 1,
        wizardState: {},
        // The utilization in force when the plan was created travels with it
        // (§45.6): a later policy change must not silently restate a decision
        // that was already taken.
        planningUtilizationPct: config.planningUtilizationPct,
        version: 1,
        createdBy: actorId,
      });

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan',
        entityId: plan.id,
        action: 'CREATE',
        newValue: plan,
      });

      return { ...plan, lines: [], demands: [] };
    });
  }

  /**
   * Patches a plan under optimistic locking (MES-035-3, MES-039-3).
   *
   * `expectedVersion` is required. Two planners in the same wizard is not a
   * hypothetical — the plan takes an afternoon and PPIC works in pairs — and
   * last-write-wins would quietly discard one of them.
   */
  async update(
    tenantId: string,
    id: string,
    expectedVersion: number,
    patch: {
      periodStart?: string;
      periodEnd?: string;
      demandForecastId?: string;
      capacityPlanId?: string;
      wizardStep?: number;
      wizardState?: Record<string, unknown>;
    },
    actorId: string
  ): Promise<ProductionPlanDetail> {
    return withTenant(tenantId, async (client) => {
      const before = await this.plans.findByIdForUpdate(client, tenantId, id);
      if (!before) throw ApiError.notFound('Production Plan tidak ditemukan.');
      this.assertEditable(before);

      if (patch.wizardStep !== undefined) {
        const readiness = await this.wizardReadiness(client, tenantId, before);
        assertStepReachable(patch.wizardStep, readiness);
      }

      const updated = await this.plans.update(client, tenantId, id, expectedVersion, patch);
      if (!updated) {
        throw ApiError.conflict(
          `Production Plan sudah diubah orang lain (versi ${before.version}, Anda mengirim ${expectedVersion}). ` +
            'Muat ulang plan lalu ulangi perubahan Anda.'
        );
      }

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan',
        entityId: id,
        action: 'UPDATE',
        previousValue: before,
        newValue: updated,
      });

      return this.readDetail(client, tenantId, id);
    });
  }

  private assertEditable(plan: ProductionPlanRecord): void {
    if (
      plan.status === ProductionPlanStatus.CONFIRMED ||
      plan.status === ProductionPlanStatus.IN_EXECUTION ||
      plan.status === ProductionPlanStatus.COMPLETED ||
      plan.status === ProductionPlanStatus.CANCELLED
    ) {
      throw ApiError.invalidState(
        `Production Plan berstatus ${plan.status} tidak dapat diubah. ` +
          'Plan yang sudah dikonfirmasi adalah komitmen produksi.'
      );
    }
  }

  // --- Lines & demand aggregation (MES-036) ----------------------------

  async listLines(tenantId: string, planId: string): Promise<ProductionPlanLineRecord[]> {
    return withTenant(tenantId, (client) => this.plans.listLines(client, tenantId, planId));
  }

  /**
   * Adds a Customer Order Line's demand to the plan (MES-036-2, MES-036-3).
   *
   * Demand for the same Product **aggregates into one plan line**, because that
   * is what lets it be produced in a single run. What it must not lose is who
   * ordered it: every contributing order line gets its own
   * `production_plan_demand` row, which is the only place that relationship
   * lives (ADR-22).
   *
   * `customer_order_line.planned_quantity` is raised by the same amount in the
   * same transaction, so `planned <= ordered` cannot be violated by two planners
   * committing the same order line to two plans.
   */
  async addDemand(
    tenantId: string,
    planId: string,
    input: AddDemandInput,
    actorId: string
  ): Promise<{ line: ProductionPlanLineRecord; demand: ProductionPlanDemand }> {
    return withTenant(tenantId, async (client) => {
      const plan = await this.plans.findByIdForUpdate(client, tenantId, planId);
      if (!plan) throw ApiError.notFound('Production Plan tidak ditemukan.');
      this.assertEditable(plan);

      const orderLine = await this.orders.findLineById(client, tenantId, input.customerOrderLineId);
      if (!orderLine) throw ApiError.notFound('Customer Order Line tidak ditemukan.');

      const order = await this.orders.findById(client, tenantId, orderLine.customerOrderId);
      if (!order) throw ApiError.notFound('Customer Order tidak ditemukan.');
      if (order.status === CustomerOrderStatus.CANCELLED) {
        throw ApiError.invalidState('Customer Order yang dibatalkan tidak dapat masuk Production Plan.');
      }

      const outstanding = orderLine.orderedQuantity - orderLine.plannedQuantity;
      const demandQuantity = input.demandQuantity ?? outstanding;
      if (demandQuantity <= 0) {
        // The headline says which of the two situations this is. "Demand
        // quantity harus lebih dari nol" on a line that is simply already fully
        // planned sends a planner looking for a number they never typed.
        const fullyPlanned = outstanding <= 0;
        throw ApiError.validation(
          fullyPlanned
            ? `Order line ini sudah seluruhnya masuk Production Plan (${orderLine.plannedQuantity} dari ${orderLine.orderedQuantity}).`
            : 'Demand quantity harus lebih dari nol.',
          [
            {
              field: 'demandQuantity',
              code: fullyPlanned ? 'ALREADY_PLANNED' : 'OUT_OF_RANGE',
              message: fullyPlanned
                ? `Sisa order line ${orderLine.id} adalah ${outstanding}; tidak ada yang dapat direncanakan lagi.`
                : `Demand quantity ${demandQuantity} tidak valid.`,
            },
          ]
        );
      }
      if (demandQuantity > outstanding) {
        throw ApiError.validation('Demand melebihi sisa order line.', [
          {
            field: 'demandQuantity',
            code: 'OUT_OF_RANGE',
            message:
              `Demand ${demandQuantity} melebihi sisa ${outstanding} pada order line ` +
              `(ordered ${orderLine.orderedQuantity}, sudah direncanakan ${orderLine.plannedQuantity}).`,
          },
        ]);
      }

      const existingDemandRows = await this.plans.listDemandForPlan(client, tenantId, planId);
      const alreadyLinked = existingDemandRows.find(
        (d) => d.customerOrderLineId === orderLine.id
      );
      if (alreadyLinked) {
        throw ApiError.conflict(
          `Order line ini sudah masuk plan pada plan line ${alreadyLinked.productionPlanLineId}.`
        );
      }

      // One plan line per product: the aggregation §45.7 asks for.
      let line = await this.plans.findLineByProduct(client, tenantId, planId, orderLine.productId);
      if (!line) {
        const priority =
          (await this.plans.listLines(client, tenantId, planId)).length + 1;
        line = await this.plans.insertLine(client, {
          id: `planline-${randomUUID()}`,
          tenantId,
          productionPlanId: planId,
          productId: orderLine.productId,
          demandQuantity: 0,
          forecastQuantity: 0,
          // Planned starts at the demand and stays editable: Step 2 is where the
          // planner decides how much of it to actually make.
          plannedQuantity: 0,
          requiredDeliveryDate: orderLine.requestedDeliveryDate ?? order.requestedDeliveryDate,
          priority,
          capacityStatus: CapacityStatus.WITHIN_PLAN,
          status: 'DRAFT',
        });
      }

      const demand = await this.plans.insertDemand(client, {
        id: `plandem-${randomUUID()}`,
        tenantId,
        productionPlanLineId: line.id,
        customerOrderId: order.id,
        customerOrderLineId: orderLine.id,
        demandQuantity,
      });

      const aggregated = line.demandQuantity + demandQuantity;
      // The earliest date any contributing order needs: a plan line is only as
      // late as its most urgent customer.
      const lineDeliveryDate = orderLine.requestedDeliveryDate ?? order.requestedDeliveryDate;
      const requiredDeliveryDate =
        !line.requiredDeliveryDate || lineDeliveryDate < line.requiredDeliveryDate
          ? lineDeliveryDate
          : line.requiredDeliveryDate;

      const updatedLine = await this.plans.updateLine(client, tenantId, line.id, {
        demandQuantity: aggregated,
        // Planned follows demand until a planner overrides it in Step 2.
        plannedQuantity: line.plannedQuantity === line.demandQuantity ? aggregated : undefined,
        requiredDeliveryDate,
      });

      await this.orders.addPlannedQuantity(client, tenantId, orderLine.id, demandQuantity);

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan_demand',
        entityId: demand.id,
        action: 'CREATE',
        newValue: {
          ...demand,
          productId: orderLine.productId,
          customerOrderNumber: order.orderNumber,
        },
      });

      // The order may now be fully planned, which moves it to `Planned`.
      await this.customerOrders.refreshStatus(client, tenantId, order.id, actorId);

      return { line: updatedLine ?? line, demand };
    });
  }

  /** Removes one demand link, returning the quantity to the order line. */
  async removeDemand(
    tenantId: string,
    planId: string,
    demandId: string,
    actorId: string
  ): Promise<void> {
    await withTenant(tenantId, async (client) => {
      const plan = await this.plans.findByIdForUpdate(client, tenantId, planId);
      if (!plan) throw ApiError.notFound('Production Plan tidak ditemukan.');
      this.assertEditable(plan);

      const removed = await this.plans.deleteDemand(client, tenantId, demandId);
      if (!removed) throw ApiError.notFound('Production Plan Demand tidak ditemukan.');

      const line = await this.plans.findLineById(client, tenantId, removed.productionPlanLineId);
      if (line) {
        const remaining = await this.plans.listDemand(client, tenantId, line.id);
        const aggregated = remaining.reduce((sum, d) => sum + d.demandQuantity, 0);
        if (remaining.length === 0) {
          // A plan line with no demand behind it is not a decision any more.
          await this.plans.deleteLine(client, tenantId, line.id);
        } else {
          await this.plans.updateLine(client, tenantId, line.id, {
            demandQuantity: aggregated,
            plannedQuantity: Math.min(line.plannedQuantity, aggregated),
          });
        }
      }

      await this.orders.addPlannedQuantity(
        client,
        tenantId,
        removed.customerOrderLineId,
        -removed.demandQuantity
      );

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan_demand',
        entityId: demandId,
        action: 'DELETE',
        previousValue: removed,
      });

      await this.customerOrders.refreshStatus(client, tenantId, removed.customerOrderId, actorId);
    });
  }

  /**
   * Step 2's decision: how much to actually produce, and at what priority.
   *
   * The capacity status is recomputed here rather than accepted from the client
   * — §45.6 is explicit that it is determined by the system and cannot be typed.
   */
  async updateLine(
    tenantId: string,
    planId: string,
    lineId: string,
    patch: { plannedQuantity?: number; priority?: number; requiredDeliveryDate?: string },
    actorId: string
  ): Promise<ProductionPlanLineRecord> {
    const plan = await this.get(tenantId, planId);
    this.assertEditable(plan);

    const before = plan.lines.find((l) => l.id === lineId);
    if (!before) throw ApiError.notFound('Production Plan Line tidak ditemukan.');

    if (patch.plannedQuantity !== undefined && patch.plannedQuantity < 0) {
      throw ApiError.validation('Planned quantity tidak boleh negatif.', [
        { field: 'plannedQuantity', code: 'OUT_OF_RANGE', message: 'Planned quantity minimal 0.' },
      ]);
    }

    const plannedQuantity = patch.plannedQuantity ?? before.plannedQuantity;
    const assessment = await this.capacity.assessProduct(tenantId, {
      productId: before.productId,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      demandQuantity: plannedQuantity,
    });

    return withTenant(tenantId, async (client) => {
      const updated = await this.plans.updateLine(client, tenantId, lineId, {
        plannedQuantity: patch.plannedQuantity,
        priority: patch.priority,
        requiredDeliveryDate: patch.requiredDeliveryDate,
        capacityStatus: assessment.capacityStatus,
      });
      if (!updated) throw ApiError.notFound('Production Plan Line tidak ditemukan.');

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan_line',
        entityId: lineId,
        action: 'UPDATE',
        previousValue: before,
        newValue: { ...updated, capacityAssessment: assessment },
      });
      return updated;
    });
  }

  /** `GET /v1/production-plans/{id}/demand` (MES-036-4). */
  async demandBreakdown(
    tenantId: string,
    planId: string
  ): Promise<
    {
      productionPlanLineId: string;
      productId: string;
      demandQuantity: number;
      plannedQuantity: number;
      sources: {
        customerOrderId: string;
        orderNumber: string;
        customerId: string;
        customerName: string;
        customerOrderLineId: string;
        demandQuantity: number;
        requestedDeliveryDate?: string;
      }[];
    }[]
  > {
    return withTenant(tenantId, async (client) => {
      const lines = await this.plans.listLines(client, tenantId, planId);
      if (lines.length === 0) return [];

      const rows = await client.query<{
        production_plan_line_id: string;
        customer_order_id: string;
        order_number: string;
        customer_id: string;
        customer_name: string;
        customer_order_line_id: string;
        demand_quantity: number;
        requested_delivery_date: string | null;
      }>(
        `SELECT ppd.production_plan_line_id, ppd.customer_order_id, co.order_number,
                co.customer_id, c.name AS customer_name, ppd.customer_order_line_id,
                ppd.demand_quantity,
                to_char(COALESCE(col.requested_delivery_date, co.requested_delivery_date), 'YYYY-MM-DD')
                  AS requested_delivery_date
           FROM production_plan_demand ppd
           JOIN customer_order co ON co.id = ppd.customer_order_id
           JOIN customer c ON c.id = co.customer_id
           JOIN customer_order_line col ON col.id = ppd.customer_order_line_id
          WHERE ppd.tenant_id = $1 AND ppd.production_plan_line_id = ANY($2)
          ORDER BY ppd.production_plan_line_id, co.order_number`,
        [tenantId, lines.map((l) => l.id)]
      );

      return lines.map((line) => ({
        productionPlanLineId: line.id,
        productId: line.productId,
        demandQuantity: line.demandQuantity,
        plannedQuantity: line.plannedQuantity,
        sources: rows.rows
          .filter((r) => r.production_plan_line_id === line.id)
          .map((r) => ({
            customerOrderId: r.customer_order_id,
            orderNumber: r.order_number,
            customerId: r.customer_id,
            customerName: r.customer_name,
            customerOrderLineId: r.customer_order_line_id,
            demandQuantity: Number(r.demand_quantity),
            requestedDeliveryDate: r.requested_delivery_date ?? undefined,
          })),
      }));
    });
  }

  // --- Wizard state (MES-039) ------------------------------------------

  /**
   * Which wizard steps are reachable, and why the others are not.
   *
   * Read from the plan's own data rather than from a flag the client sets: a
   * step is unlocked because its prerequisite exists, not because a browser
   * said so.
   */
  async readiness(tenantId: string, planId: string): Promise<WizardReadiness> {
    return withTenant(tenantId, async (client) => {
      const plan = await this.plans.findById(client, tenantId, planId);
      if (!plan) throw ApiError.notFound('Production Plan tidak ditemukan.');
      return this.wizardReadiness(client, tenantId, plan);
    });
  }

  private async wizardReadiness(
    exec: Executor,
    tenantId: string,
    plan: ProductionPlanRecord
  ): Promise<WizardReadiness> {
    const lines = await this.plans.listLines(exec, tenantId, plan.id);
    const demands = await this.plans.listDemandForPlan(exec, tenantId, plan.id);
    const workOrders = await exec.query<{
      total: string;
      scheduled: string;
      resourced: string;
      confirmed: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE wo.status <> 'DRAFT')::text AS scheduled,
              count(*) FILTER (WHERE wo.machine_id IS NOT NULL AND wo.mold_id IS NOT NULL)::text AS resourced,
              count(*) FILTER (WHERE wo.status IN ('CONFIRMED', 'IN_PRODUCTION', 'COMPLETED'))::text AS confirmed
         FROM work_order wo
         JOIN production_plan_line ppl ON ppl.id = wo.production_plan_line_id
        WHERE wo.tenant_id = $1 AND ppl.production_plan_id = $2 AND wo.parent_work_order_id IS NULL`,
      [tenantId, plan.id]
    );

    const row = workOrders.rows[0];
    return {
      planId: plan.id,
      currentStep: plan.wizardStep,
      demandCount: demands.length,
      lineCount: lines.length,
      linesWithPlannedQuantity: lines.filter((l) => l.plannedQuantity > 0).length,
      workOrderCount: Number(row?.total ?? 0),
      scheduledWorkOrders: Number(row?.scheduled ?? 0),
      resourcedWorkOrders: Number(row?.resourced ?? 0),
      confirmedWorkOrders: Number(row?.confirmed ?? 0),
      capacityUpRequiredLines: lines.filter(
        (l) => l.capacityStatus === CapacityStatus.CAPACITY_UP_REQUIRED
      ).length,
    };
  }

  // --- Confirmation (MES-040) ------------------------------------------

  /**
   * Confirms the plan, turning it from an intention into a commitment.
   *
   * Two guards, both from MES-040:
   *
   * - A plan line still marked `CAPACITY_UP_REQUIRED` blocks. The gap has to be
   *   dealt with — a Capacity Up decision, or less planned quantity — before the
   *   plant commits to something it cannot make.
   * - Every generated Work Order must be confirmed. Confirming a plan whose work
   *   orders are still drafts commits to work nobody has checked the resources
   *   for.
   */
  async confirm(tenantId: string, planId: string, actorId: string): Promise<ProductionPlanDetail> {
    return withTenant(tenantId, async (client) => {
      const plan = await this.plans.findByIdForUpdate(client, tenantId, planId);
      if (!plan) throw ApiError.notFound('Production Plan tidak ditemukan.');
      if (plan.status === ProductionPlanStatus.CONFIRMED) {
        throw ApiError.invalidState('Production Plan sudah dikonfirmasi.');
      }
      if (
        plan.status === ProductionPlanStatus.CANCELLED ||
        plan.status === ProductionPlanStatus.COMPLETED
      ) {
        throw ApiError.invalidState(`Production Plan berstatus ${plan.status} tidak dapat dikonfirmasi.`);
      }

      const lines = await this.plans.listLines(client, tenantId, planId);
      if (lines.length === 0) {
        throw ApiError.invalidState('Production Plan tanpa plan line tidak dapat dikonfirmasi.');
      }

      const blocked = lines.filter(
        (line) => line.capacityStatus === CapacityStatus.CAPACITY_UP_REQUIRED
      );
      if (blocked.length > 0) {
        throw ApiError.invalidState(
          `${blocked.length} plan line berstatus CAPACITY_UP_REQUIRED belum ditangani: ` +
            `${blocked.map((l) => l.productId).join(', ')}. ` +
            'Ajukan Capacity Up atau turunkan planned quantity sebelum konfirmasi.'
        );
      }

      const workOrderCounts = await this.plans.workOrderStatusCounts(client, tenantId, planId);
      const total = workOrderCounts.reduce((sum, row) => sum + row.count, 0);
      if (total === 0) {
        throw ApiError.invalidState(
          'Belum ada Work Order yang di-generate untuk plan ini. Jalankan generate-work-orders lebih dahulu.'
        );
      }
      const unconfirmed = workOrderCounts
        .filter((row) => !['CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED'].includes(row.status))
        .reduce((sum, row) => sum + row.count, 0);
      if (unconfirmed > 0) {
        throw ApiError.invalidState(
          `${unconfirmed} Work Order belum dikonfirmasi. Konfirmasi seluruh Work Order sebelum plan dikonfirmasi.`
        );
      }

      const confirmedAt = new Date().toISOString();
      const updated = await this.plans.update(client, tenantId, planId, plan.version, {
        status: ProductionPlanStatus.CONFIRMED,
        confirmedBy: actorId,
        confirmedAt,
        wizardStep: WIZARD_STEPS.CONFIRMATION,
      });
      if (!updated) {
        throw ApiError.conflict('Production Plan berubah saat konfirmasi berlangsung. Muat ulang lalu ulangi.');
      }

      for (const line of lines) {
        await this.plans.updateLine(client, tenantId, line.id, { status: 'RELEASED' });
      }

      // Confirming the plan is what moves the orders it serves to `Planned`.
      const demands = await this.plans.listDemandForPlan(client, tenantId, planId);
      const orderIds = [...new Set(demands.map((d) => d.customerOrderId))];
      for (const orderId of orderIds) {
        await this.customerOrders.refreshStatus(client, tenantId, orderId, actorId);
      }

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan',
        entityId: planId,
        action: 'CONFIRM',
        previousValue: { status: plan.status },
        newValue: { status: ProductionPlanStatus.CONFIRMED, confirmedBy: actorId, confirmedAt },
      });

      await this.outbox.publish(
        client,
        tenantId,
        planningEvent(PLANNING_EVENTS.PRODUCTION_PLAN_CONFIRMED, 'production_plan', planId, {
          planNumber: plan.planNumber,
          periodStart: plan.periodStart,
          periodEnd: plan.periodEnd,
          confirmedBy: actorId,
          customerOrderIds: orderIds,
          plannedQuantityTotal: lines.reduce((sum, l) => sum + l.plannedQuantity, 0),
        })
      );

      return this.readDetail(client, tenantId, planId);
    });
  }

  async cancel(
    tenantId: string,
    planId: string,
    reason: string,
    actorId: string
  ): Promise<ProductionPlanDetail> {
    if (!reason || reason.trim() === '') {
      throw ApiError.validation('Alasan pembatalan wajib diisi.', [
        { field: 'reason', code: 'REQUIRED', message: 'Alasan pembatalan wajib diisi.' },
      ]);
    }

    return withTenant(tenantId, async (client) => {
      const plan = await this.plans.findByIdForUpdate(client, tenantId, planId);
      if (!plan) throw ApiError.notFound('Production Plan tidak ditemukan.');
      if (plan.status === ProductionPlanStatus.CANCELLED) {
        throw ApiError.invalidState('Production Plan sudah dibatalkan.');
      }

      const workOrderCounts = await this.plans.workOrderStatusCounts(client, tenantId, planId);
      const running = workOrderCounts
        .filter((row) => ['IN_PRODUCTION', 'COMPLETED'].includes(row.status))
        .reduce((sum, row) => sum + row.count, 0);
      if (running > 0) {
        throw ApiError.invalidState(
          `Production Plan tidak dapat dibatalkan: ${running} Work Order sudah masuk produksi.`
        );
      }

      const updated = await this.plans.update(client, tenantId, planId, plan.version, {
        status: ProductionPlanStatus.CANCELLED,
      });
      if (!updated) {
        throw ApiError.conflict('Production Plan berubah saat pembatalan berlangsung.');
      }

      // Cancelling releases the demand back to the customer order lines, so it
      // can be planned again somewhere else.
      const demands = await this.plans.listDemandForPlan(client, tenantId, planId);
      for (const demand of demands) {
        await this.orders.addPlannedQuantity(
          client,
          tenantId,
          demand.customerOrderLineId,
          -demand.demandQuantity
        );
      }
      for (const orderId of [...new Set(demands.map((d) => d.customerOrderId))]) {
        await this.customerOrders.refreshStatus(client, tenantId, orderId, actorId);
      }

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'production_plan',
        entityId: planId,
        action: 'CANCEL',
        previousValue: { status: plan.status },
        newValue: { status: ProductionPlanStatus.CANCELLED, reason },
      });
      await this.outbox.publish(
        client,
        tenantId,
        planningEvent(PLANNING_EVENTS.PRODUCTION_PLAN_CANCELLED, 'production_plan', planId, {
          planNumber: plan.planNumber,
          reason,
        })
      );

      return this.readDetail(client, tenantId, planId);
    });
  }
}
