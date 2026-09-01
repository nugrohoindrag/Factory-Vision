import { CapacityStatus, ProductionPlanStatus } from '@factory-vision/domain-types';
import type {
  ProductionPlan,
  ProductionPlanDemand,
  ProductionPlanLine,
} from '@factory-vision/domain-types';
import { asDateString, asOptionalIsoString, orUndefined, type Executor } from '../../../platform/db/executor.js';

/** `production_plan`, `production_plan_line`, `production_plan_demand` (MES-035, MES-036). */

const PLAN_COLUMNS = `
  id, tenant_id, plan_number,
  to_char(period_start, 'YYYY-MM-DD') AS period_start,
  to_char(period_end, 'YYYY-MM-DD') AS period_end,
  demand_forecast_id, capacity_plan_id, status, wizard_step, wizard_state,
  planning_utilization_pct, confirmed_by, confirmed_at, version, created_by, created_at, updated_at
`;

const LINE_COLUMNS = `
  id, tenant_id, production_plan_id, product_id, demand_quantity, forecast_quantity,
  planned_quantity, to_char(required_delivery_date, 'YYYY-MM-DD') AS required_delivery_date,
  priority, capacity_status, status, demand_forecast_line_id, created_at, updated_at
`;

const DEMAND_COLUMNS = `
  id, tenant_id, production_plan_line_id, customer_order_id, customer_order_line_id, demand_quantity
`;

interface PlanRow {
  id: string;
  tenant_id: string;
  plan_number: string;
  period_start: string;
  period_end: string;
  demand_forecast_id: string | null;
  capacity_plan_id: string | null;
  status: string;
  wizard_step: number;
  wizard_state: Record<string, unknown>;
  planning_utilization_pct: string | number;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  version: number;
  created_by: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface LineRow {
  id: string;
  tenant_id: string;
  production_plan_id: string;
  product_id: string;
  demand_quantity: number;
  forecast_quantity: number;
  planned_quantity: number;
  required_delivery_date: string | null;
  priority: number;
  capacity_status: string;
  status: string;
  demand_forecast_line_id: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface DemandRow {
  id: string;
  tenant_id: string;
  production_plan_line_id: string;
  customer_order_id: string;
  customer_order_line_id: string;
  demand_quantity: number;
}

export interface ProductionPlanRecord extends ProductionPlan {
  wizardState: Record<string, unknown>;
  planningUtilizationPct: number;
}

export interface ProductionPlanLineRecord extends ProductionPlanLine {
  demandForecastLineId?: string;
}

function toPlan(row: PlanRow): ProductionPlanRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planNumber: row.plan_number,
    periodStart: asDateString(row.period_start),
    periodEnd: asDateString(row.period_end),
    demandForecastId: orUndefined(row.demand_forecast_id),
    capacityPlanId: orUndefined(row.capacity_plan_id),
    status: (row.status as ProductionPlanStatus) ?? ProductionPlanStatus.DRAFT,
    wizardStep: Number(row.wizard_step),
    wizardState: row.wizard_state ?? {},
    planningUtilizationPct: Number(row.planning_utilization_pct),
    confirmedBy: orUndefined(row.confirmed_by),
    confirmedAt: asOptionalIsoString(row.confirmed_at),
    version: Number(row.version),
    createdBy: orUndefined(row.created_by),
    createdAt: asOptionalIsoString(row.created_at),
    updatedAt: asOptionalIsoString(row.updated_at),
  };
}

function toLine(row: LineRow): ProductionPlanLineRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productionPlanId: row.production_plan_id,
    productId: row.product_id,
    demandQuantity: Number(row.demand_quantity),
    forecastQuantity: Number(row.forecast_quantity),
    plannedQuantity: Number(row.planned_quantity),
    requiredDeliveryDate: row.required_delivery_date
      ? asDateString(row.required_delivery_date)
      : undefined,
    priority: Number(row.priority),
    capacityStatus: (row.capacity_status as CapacityStatus) ?? CapacityStatus.WITHIN_PLAN,
    status: (row.status as ProductionPlanLine['status']) ?? 'DRAFT',
    demandForecastLineId: orUndefined(row.demand_forecast_line_id),
    createdAt: asOptionalIsoString(row.created_at),
    updatedAt: asOptionalIsoString(row.updated_at),
  };
}

function toDemand(row: DemandRow): ProductionPlanDemand {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productionPlanLineId: row.production_plan_line_id,
    customerOrderId: row.customer_order_id,
    customerOrderLineId: row.customer_order_line_id,
    demandQuantity: Number(row.demand_quantity),
  };
}

export class ProductionPlanRepository {
  // --- Plans -----------------------------------------------------------

  async insert(exec: Executor, plan: ProductionPlanRecord): Promise<ProductionPlanRecord> {
    const result = await exec.query<PlanRow>(
      `INSERT INTO production_plan (
         id, tenant_id, plan_number, period_start, period_end, demand_forecast_id,
         capacity_plan_id, status, wizard_step, planning_utilization_pct, created_by
       ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11)
       RETURNING ${PLAN_COLUMNS}`,
      [
        plan.id,
        plan.tenantId,
        plan.planNumber,
        plan.periodStart,
        plan.periodEnd,
        plan.demandForecastId ?? null,
        plan.capacityPlanId ?? null,
        plan.status,
        plan.wizardStep,
        plan.planningUtilizationPct,
        plan.createdBy ?? null,
      ]
    );
    return toPlan(result.rows[0]);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<ProductionPlanRecord | undefined> {
    const result = await exec.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM production_plan WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toPlan(result.rows[0]) : undefined;
  }

  async findByIdForUpdate(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<ProductionPlanRecord | undefined> {
    const result = await exec.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM production_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id]
    );
    return result.rows[0] ? toPlan(result.rows[0]) : undefined;
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { status?: ProductionPlanStatus[]; periodStart?: string; periodEnd?: string; limit?: number } = {}
  ): Promise<ProductionPlanRecord[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.status && filter.status.length > 0) {
      params.push(filter.status);
      where.push(`status = ANY($${params.length})`);
    }
    if (filter.periodStart) {
      params.push(filter.periodStart);
      where.push(`period_end >= $${params.length}::date`);
    }
    if (filter.periodEnd) {
      params.push(filter.periodEnd);
      where.push(`period_start <= $${params.length}::date`);
    }
    params.push(Math.min(filter.limit ?? 200, 1000));
    const result = await exec.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM production_plan WHERE ${where.join(' AND ')}
        ORDER BY period_start DESC, plan_number DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map(toPlan);
  }

  /**
   * Patches a plan, guarded by `version` (MES-035-3).
   *
   * `WHERE version = $expected` is what makes the lock optimistic rather than
   * decorative: two planners editing the same wizard both send version 3, the
   * second update matches no row, and the caller reports a conflict instead of
   * silently overwriting the first one's work.
   */
  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    expectedVersion: number,
    patch: {
      periodStart?: string;
      periodEnd?: string;
      demandForecastId?: string;
      capacityPlanId?: string;
      status?: ProductionPlanStatus;
      wizardStep?: number;
      wizardState?: Record<string, unknown>;
      planningUtilizationPct?: number;
      confirmedBy?: string;
      confirmedAt?: string;
    }
  ): Promise<ProductionPlanRecord | undefined> {
    const result = await exec.query<PlanRow>(
      `UPDATE production_plan SET
         period_start = COALESCE($4::date, period_start),
         period_end = COALESCE($5::date, period_end),
         demand_forecast_id = COALESCE($6, demand_forecast_id),
         capacity_plan_id = COALESCE($7, capacity_plan_id),
         status = COALESCE($8, status),
         wizard_step = COALESCE($9, wizard_step),
         wizard_state = COALESCE($10::jsonb, wizard_state),
         planning_utilization_pct = COALESCE($11, planning_utilization_pct),
         confirmed_by = COALESCE($12, confirmed_by),
         confirmed_at = COALESCE($13, confirmed_at),
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2 AND version = $3
       RETURNING ${PLAN_COLUMNS}`,
      [
        tenantId,
        id,
        expectedVersion,
        patch.periodStart ?? null,
        patch.periodEnd ?? null,
        patch.demandForecastId ?? null,
        patch.capacityPlanId ?? null,
        patch.status ?? null,
        patch.wizardStep ?? null,
        patch.wizardState === undefined ? null : JSON.stringify(patch.wizardState),
        patch.planningUtilizationPct ?? null,
        patch.confirmedBy ?? null,
        patch.confirmedAt ?? null,
      ]
    );
    return result.rows[0] ? toPlan(result.rows[0]) : undefined;
  }

  // --- Lines -----------------------------------------------------------

  async listLines(exec: Executor, tenantId: string, planId: string): Promise<ProductionPlanLineRecord[]> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM production_plan_line
        WHERE tenant_id = $1 AND production_plan_id = $2
        ORDER BY priority, product_id`,
      [tenantId, planId]
    );
    return result.rows.map(toLine);
  }

  async findLineById(
    exec: Executor,
    tenantId: string,
    lineId: string
  ): Promise<ProductionPlanLineRecord | undefined> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM production_plan_line WHERE tenant_id = $1 AND id = $2`,
      [tenantId, lineId]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  /** The plan line for a product within a plan, if one already exists. */
  async findLineByProduct(
    exec: Executor,
    tenantId: string,
    planId: string,
    productId: string
  ): Promise<ProductionPlanLineRecord | undefined> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM production_plan_line
        WHERE tenant_id = $1 AND production_plan_id = $2 AND product_id = $3
        FOR UPDATE`,
      [tenantId, planId, productId]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  async insertLine(exec: Executor, line: ProductionPlanLineRecord): Promise<ProductionPlanLineRecord> {
    const result = await exec.query<LineRow>(
      `INSERT INTO production_plan_line (
         id, tenant_id, production_plan_id, product_id, demand_quantity, forecast_quantity,
         planned_quantity, required_delivery_date, priority, capacity_status, status,
         demand_forecast_line_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12)
       RETURNING ${LINE_COLUMNS}`,
      [
        line.id,
        line.tenantId,
        line.productionPlanId,
        line.productId,
        line.demandQuantity,
        line.forecastQuantity,
        line.plannedQuantity,
        line.requiredDeliveryDate ?? null,
        line.priority,
        line.capacityStatus,
        line.status,
        line.demandForecastLineId ?? null,
      ]
    );
    return toLine(result.rows[0]);
  }

  async updateLine(
    exec: Executor,
    tenantId: string,
    lineId: string,
    patch: Partial<
      Pick<
        ProductionPlanLineRecord,
        | 'demandQuantity'
        | 'forecastQuantity'
        | 'plannedQuantity'
        | 'requiredDeliveryDate'
        | 'priority'
        | 'capacityStatus'
        | 'status'
      >
    >
  ): Promise<ProductionPlanLineRecord | undefined> {
    const result = await exec.query<LineRow>(
      `UPDATE production_plan_line SET
         demand_quantity = COALESCE($3, demand_quantity),
         forecast_quantity = COALESCE($4, forecast_quantity),
         planned_quantity = COALESCE($5, planned_quantity),
         required_delivery_date = COALESCE($6::date, required_delivery_date),
         priority = COALESCE($7, priority),
         capacity_status = COALESCE($8, capacity_status),
         status = COALESCE($9, status),
         updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${LINE_COLUMNS}`,
      [
        tenantId,
        lineId,
        patch.demandQuantity ?? null,
        patch.forecastQuantity ?? null,
        patch.plannedQuantity ?? null,
        patch.requiredDeliveryDate ?? null,
        patch.priority ?? null,
        patch.capacityStatus ?? null,
        patch.status ?? null,
      ]
    );
    return result.rows[0] ? toLine(result.rows[0]) : undefined;
  }

  async deleteLine(exec: Executor, tenantId: string, lineId: string): Promise<boolean> {
    const result = await exec.query(
      'DELETE FROM production_plan_line WHERE tenant_id = $1 AND id = $2',
      [tenantId, lineId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // --- Demand (MES-036-3) ----------------------------------------------

  async listDemand(
    exec: Executor,
    tenantId: string,
    planLineId: string
  ): Promise<ProductionPlanDemand[]> {
    const result = await exec.query<DemandRow>(
      `SELECT ${DEMAND_COLUMNS} FROM production_plan_demand
        WHERE tenant_id = $1 AND production_plan_line_id = $2
        ORDER BY customer_order_id, customer_order_line_id`,
      [tenantId, planLineId]
    );
    return result.rows.map(toDemand);
  }

  async listDemandForPlan(
    exec: Executor,
    tenantId: string,
    planId: string
  ): Promise<ProductionPlanDemand[]> {
    const result = await exec.query<DemandRow>(
      `SELECT ppd.id, ppd.tenant_id, ppd.production_plan_line_id, ppd.customer_order_id,
              ppd.customer_order_line_id, ppd.demand_quantity
         FROM production_plan_demand ppd
         JOIN production_plan_line ppl ON ppl.id = ppd.production_plan_line_id
        WHERE ppd.tenant_id = $1 AND ppl.production_plan_id = $2
        ORDER BY ppd.production_plan_line_id, ppd.customer_order_id`,
      [tenantId, planId]
    );
    return result.rows.map(toDemand);
  }

  async findDemandByOrderLine(
    exec: Executor,
    tenantId: string,
    planLineId: string,
    customerOrderLineId: string
  ): Promise<ProductionPlanDemand | undefined> {
    const result = await exec.query<DemandRow>(
      `SELECT ${DEMAND_COLUMNS} FROM production_plan_demand
        WHERE tenant_id = $1 AND production_plan_line_id = $2 AND customer_order_line_id = $3`,
      [tenantId, planLineId, customerOrderLineId]
    );
    return result.rows[0] ? toDemand(result.rows[0]) : undefined;
  }

  async insertDemand(exec: Executor, demand: ProductionPlanDemand): Promise<ProductionPlanDemand> {
    const result = await exec.query<DemandRow>(
      `INSERT INTO production_plan_demand (
         id, tenant_id, production_plan_line_id, customer_order_id, customer_order_line_id, demand_quantity
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${DEMAND_COLUMNS}`,
      [
        demand.id,
        demand.tenantId,
        demand.productionPlanLineId,
        demand.customerOrderId,
        demand.customerOrderLineId,
        demand.demandQuantity,
      ]
    );
    return toDemand(result.rows[0]);
  }

  async deleteDemand(exec: Executor, tenantId: string, demandId: string): Promise<ProductionPlanDemand | undefined> {
    const result = await exec.query<DemandRow>(
      `DELETE FROM production_plan_demand WHERE tenant_id = $1 AND id = $2
        RETURNING ${DEMAND_COLUMNS}`,
      [tenantId, demandId]
    );
    return result.rows[0] ? toDemand(result.rows[0]) : undefined;
  }

  /** Work Orders already generated for a plan, for the confirm guard. */
  async workOrderStatusCounts(
    exec: Executor,
    tenantId: string,
    planId: string
  ): Promise<{ status: string; count: number }[]> {
    const result = await exec.query<{ status: string; n: string }>(
      `SELECT wo.status, count(*)::text AS n
         FROM work_order wo
         JOIN production_plan_line ppl ON ppl.id = wo.production_plan_line_id
        WHERE wo.tenant_id = $1 AND ppl.production_plan_id = $2
        GROUP BY wo.status`,
      [tenantId, planId]
    );
    return result.rows.map((row) => ({ status: row.status, count: Number(row.n) }));
  }
}
