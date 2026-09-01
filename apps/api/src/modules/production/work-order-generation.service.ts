import { randomUUID } from 'crypto';
import { WorkOrderStatus } from '@factory-vision/domain-types';
import type { WorkOrder } from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import type { Executor } from '../../platform/db/executor.js';
import { ApiError } from '../../platform/http/api-error.js';
import { WorkOrderRepository } from './work-order.repository.js';
import {
  assertRoutingValid,
  RoutingValidationError,
  type RoutingStepInput,
} from './routing-validation.js';

/**
 * Work Order generation from a Production Plan (MES-041, MES-042).
 *
 * Lives in `production`, not in `planning`: it writes `work_order` rows, and
 * planning is forbidden from depending on execution (MES-019). Planning's route
 * calls in here; the dependency runs one way.
 *
 * The four rules that decide whether the result is trustworthy:
 *
 * - **One Work Order per routing process.** Not one per plan line — a plan line
 *   for 10.000 pcs across a four-process routing produces four work orders of
 *   10.000, not one of 40.000 (§8 A2).
 * - **`planned_quantity` of the first process = the plan line's planned
 *   quantity.** Later processes start from the same figure, and reality narrows
 *   it as reject and scrap accumulate.
 * - **The chain is explicit.** `predecessor_work_order_id` is written as the
 *   work orders are created, never inferred later from sequence numbers.
 * - **Regenerating produces no duplicates.** The unique index
 *   `uq_wo_plan_line_process` enforces it in the database, so two concurrent
 *   generate calls cannot both insert; this service reports what already existed
 *   rather than failing.
 */

export interface GenerateWorkOrdersResult {
  productionPlanId: string;
  created: WorkOrder[];
  /** Work Orders that already existed for a `(plan line, process)` pair. */
  existing: WorkOrder[];
  /** Plan lines skipped because their planned quantity is still zero. */
  skippedPlanLineIds: string[];
}

interface PlanLineForGeneration {
  id: string;
  productId: string;
  plannedQuantity: number;
  requiredDeliveryDate?: string;
  priority: number;
}

export class WorkOrderGenerationService {
  private readonly workOrders = new WorkOrderRepository();

  /**
   * `POST /v1/production-plans/{id}/generate-work-orders` (MES-041-1).
   *
   * One transaction for the whole plan (MES-041-5): a routing that fails
   * validation halfway must leave nothing behind, which is exactly the "no
   * partial Work Orders" rule MES-042 exists for.
   */
  async generateForPlan(
    tenantId: string,
    productionPlanId: string,
    actorId: string
  ): Promise<GenerateWorkOrdersResult> {
    return withTenant(tenantId, async (client) => {
      const plan = await client.query<{
        id: string;
        plan_number: string;
        status: string;
        period_start: string;
        period_end: string;
      }>(
        `SELECT id, plan_number, status,
                to_char(period_start, 'YYYY-MM-DD') AS period_start,
                to_char(period_end, 'YYYY-MM-DD') AS period_end
           FROM production_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, productionPlanId]
      );
      const planRow = plan.rows[0];
      if (!planRow) throw ApiError.notFound('Production Plan tidak ditemukan.');
      if (['CONFIRMED', 'IN_EXECUTION', 'COMPLETED', 'CANCELLED'].includes(planRow.status)) {
        throw ApiError.invalidState(
          `Production Plan berstatus ${planRow.status}; Work Order tidak dapat di-generate ulang.`
        );
      }

      const lines = await client.query<{
        id: string;
        product_id: string;
        planned_quantity: number;
        required_delivery_date: string | null;
        priority: number;
      }>(
        `SELECT id, product_id, planned_quantity,
                to_char(required_delivery_date, 'YYYY-MM-DD') AS required_delivery_date, priority
           FROM production_plan_line
          WHERE tenant_id = $1 AND production_plan_id = $2 AND status <> 'CANCELLED'
          ORDER BY priority, product_id`,
        [tenantId, productionPlanId]
      );

      const planLines: PlanLineForGeneration[] = lines.rows.map((row) => ({
        id: row.id,
        productId: row.product_id,
        plannedQuantity: Number(row.planned_quantity),
        requiredDeliveryDate: row.required_delivery_date ?? undefined,
        priority: Number(row.priority),
      }));

      if (planLines.length === 0) {
        throw ApiError.invalidState('Production Plan belum memiliki plan line.');
      }

      // Validate every routing before writing anything. A single invalid routing
      // aborts the whole generate, so no plan line is left half-generated.
      const routings = new Map<string, RoutingStepInput[]>();
      const failures: RoutingValidationError[] = [];
      for (const line of planLines) {
        if (line.plannedQuantity <= 0) continue;
        const steps = await this.readRouting(client, tenantId, line.productId);
        routings.set(line.productId, steps);
        try {
          assertRoutingValid(line.productId, steps);
        } catch (error) {
          if (error instanceof RoutingValidationError) failures.push(error);
          else throw error;
        }
      }

      if (failures.length > 0) {
        throw ApiError.validation(
          'Generate Work Order dibatalkan karena routing tidak valid; tidak ada Work Order yang dibuat.',
          failures.flatMap((failure) =>
            failure.problems.map((problem) => ({
              field: `product:${failure.productId}`,
              code: problem.code,
              message: problem.message,
            }))
          )
        );
      }

      const created: WorkOrder[] = [];
      const existing: WorkOrder[] = [];
      const skippedPlanLineIds: string[] = [];

      const fallbackLine = await client.query<{ id: string }>(
        `SELECT id FROM production_line WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`,
        [tenantId]
      );

      for (const line of planLines) {
        if (line.plannedQuantity <= 0) {
          skippedPlanLineIds.push(line.id);
          continue;
        }

        const steps = (routings.get(line.productId) ?? [])
          .filter((step) => step.active)
          .sort((a, b) => a.sequence - b.sequence);

        let predecessorId: string | undefined;
        for (const step of steps) {
          const alreadyThere = await this.findExisting(client, tenantId, line.id, step.processId);
          if (alreadyThere) {
            // Idempotency (MES-041-4): a regenerate reports what is already
            // there instead of inserting a second work order for the same
            // (plan line, process).
            existing.push(alreadyThere);
            predecessorId = alreadyThere.id;
            continue;
          }

          const lineId = await this.resolveLineId(client, tenantId, step, fallbackLine.rows[0]?.id);
          if (!lineId) {
            throw ApiError.invalidState(
              `Tidak ada production line aktif untuk process ${step.processCode}; ` +
                'tetapkan production line sebelum generate Work Order.'
            );
          }

          const workOrder = await this.workOrders.create(client, {
            id: `wo-${randomUUID()}`,
            tenantId,
            productionPlanLineId: line.id,
            predecessorWorkOrderId: predecessorId,
            woNumber: await this.nextWoNumber(client, tenantId, planRow.plan_number, step.processCode),
            productId: line.productId,
            processId: step.processId,
            routingId: step.routingId,
            sequence: step.sequence,
            isBatchManaged: false,
            hasChildWorkOrder: false,
            lineId,
            workCenterId: step.workCenterId,
            machineId: step.machineId,
            // Every process starts planned for the plan line's quantity. What
            // actually arrives at process 2 is decided by process 1's output, not
            // by planning it lower up front (§10).
            plannedQuantity: line.plannedQuantity,
            inputQuantity: 0,
            outputQuantity: 0,
            rejectQuantity: 0,
            scrapQuantity: 0,
            reworkQuantity: 0,
            transferredQuantity: 0,
            unit: 'PCS',
            plannedStart: `${planRow.period_start}T00:00:00.000Z`,
            plannedEnd: `${line.requiredDeliveryDate ?? planRow.period_end}T23:59:59.000Z`,
            status: WorkOrderStatus.DRAFT,
            priority: line.priority,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          created.push(workOrder);
          predecessorId = workOrder.id;
        }
      }

      await this.recordAudit(client, tenantId, actorId, productionPlanId, {
        planNumber: planRow.plan_number,
        created: created.map((wo) => wo.id),
        existing: existing.map((wo) => wo.id),
        skippedPlanLineIds,
      });

      return { productionPlanId, created, existing, skippedPlanLineIds };
    });
  }

  /** The routing rows plus the count of machines that can actually run each. */
  private async readRouting(
    exec: Executor,
    tenantId: string,
    productId: string
  ): Promise<RoutingStepInput[]> {
    const result = await exec.query<{
      routing_id: string;
      process_id: string;
      process_code: string;
      process_name: string;
      process_status: string;
      sequence: number;
      work_center_id: string | null;
      machine_id: string | null;
      active: boolean;
      eligible_machines: string;
    }>(
      `SELECT pr.id AS routing_id, pr.process_id, pp.code AS process_code, pp.name AS process_name,
              pp.status AS process_status, pr.sequence, pr.work_center_id, pr.machine_id, pr.active,
              (SELECT count(*)::text FROM product_machine_rate pmr
                WHERE pmr.tenant_id = pr.tenant_id AND pmr.product_id = pr.product_id) AS eligible_machines
         FROM product_routing pr
         JOIN production_process pp ON pp.id = pr.process_id
        WHERE pr.tenant_id = $1 AND pr.product_id = $2
        ORDER BY pr.sequence, pr.id`,
      [tenantId, productId]
    );

    return result.rows.map((row) => ({
      routingId: row.routing_id,
      processId: row.process_id,
      processCode: row.process_code,
      processName: row.process_name,
      processStatus: row.process_status,
      sequence: Number(row.sequence),
      workCenterId: row.work_center_id ?? undefined,
      machineId: row.machine_id ?? undefined,
      active: row.active !== false,
      eligibleMachineCount: Number(row.eligible_machines ?? 0),
    }));
  }

  /** The existing root Work Order for a `(plan line, process)` pair, if any. */
  private async findExisting(
    exec: Executor,
    tenantId: string,
    planLineId: string,
    processId: string
  ): Promise<WorkOrder | undefined> {
    const result = await exec.query<{ id: string }>(
      `SELECT id FROM work_order
        WHERE tenant_id = $1 AND production_plan_line_id = $2 AND process_id = $3
          AND parent_work_order_id IS NULL
        LIMIT 1`,
      [tenantId, planLineId, processId]
    );
    const id = result.rows[0]?.id;
    return id ? this.workOrders.findById(exec, tenantId, id) : undefined;
  }

  /**
   * The production line a work order runs on.
   *
   * Preferred order: the machine named on the routing, then the work centre's
   * line, then the tenant's first active line. `work_order.line_id` is NOT NULL
   * and a work order with no line cannot appear on a board.
   */
  private async resolveLineId(
    exec: Executor,
    tenantId: string,
    step: RoutingStepInput,
    fallbackLineId?: string
  ): Promise<string | undefined> {
    if (step.machineId) {
      const result = await exec.query<{ line_id: string }>(
        `SELECT wc.production_line_id AS line_id
           FROM machine m JOIN work_center wc ON wc.id = m.work_center_id
          WHERE m.tenant_id = $1 AND m.id = $2`,
        [tenantId, step.machineId]
      );
      if (result.rows[0]?.line_id) return result.rows[0].line_id;
    }
    if (step.workCenterId) {
      const result = await exec.query<{ production_line_id: string }>(
        'SELECT production_line_id FROM work_center WHERE tenant_id = $1 AND id = $2',
        [tenantId, step.workCenterId]
      );
      if (result.rows[0]?.production_line_id) return result.rows[0].production_line_id;
    }
    return fallbackLineId;
  }

  /**
   * `WO-<PLAN>-<PROCESS>-NNN`, unique per tenant.
   *
   * Derived from the plan number so the work order says where it came from on
   * the shop-floor card, without needing a lookup.
   */
  private async nextWoNumber(
    exec: Executor,
    tenantId: string,
    planNumber: string,
    processCode: string
  ): Promise<string> {
    const prefix = `WO-${planNumber.replace(/^PLAN-/, '')}-${processCode}`;
    const result = await exec.query<{ max_suffix: string | null }>(
      `SELECT MAX(NULLIF(regexp_replace(wo_number, '^.*-', ''), '')::int)::text AS max_suffix
         FROM work_order
        WHERE tenant_id = $1 AND wo_number LIKE $2`,
      [tenantId, `${prefix}-%`]
    );
    const next = Number(result.rows[0]?.max_suffix ?? 0) + 1;
    return `${prefix}-${String(next).padStart(3, '0')}`;
  }

  private async recordAudit(
    exec: Executor,
    tenantId: string,
    actorId: string,
    productionPlanId: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    await exec.query(
      `INSERT INTO audit_log (
         id, tenant_id, actor_type, actor_id, entity_type, entity_id, action, new_value, occurred_at
       ) VALUES ($1, $2, 'USER', $3, 'production_plan', $4, 'GENERATE_WORK_ORDERS', $5::jsonb, CURRENT_TIMESTAMP)`,
      [`audit-${randomUUID()}`, tenantId, actorId, productionPlanId, JSON.stringify(detail)]
    );
  }
}
