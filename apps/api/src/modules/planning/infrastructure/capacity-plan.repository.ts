import { CapacityPlanStatus, CapacityStatus } from '@factory-vision/domain-types';
import type { CapacityPlan, CapacityPlanLine } from '@factory-vision/domain-types';
import { asDateString, asOptionalIsoString, orUndefined, type Executor } from '../../../platform/db/executor.js';
import type { UncomputedMachine } from '../domain/capacity.engine.js';

/** `capacity_plan` and `capacity_plan_line` (MES-033). */

const PLAN_COLUMNS = `
  id, tenant_id, plan_number,
  to_char(period_start, 'YYYY-MM-DD') AS period_start,
  to_char(period_end, 'YYYY-MM-DD') AS period_end,
  planning_utilization_pct, status, computed_at, superseded_by_id
`;

const LINE_COLUMNS = `
  id, tenant_id, capacity_plan_id, plant_id, line_id, product_id,
  total_capacity, planning_capacity, capacity_buffer, demand_quantity, planned_quantity,
  capacity_utilization, capacity_gap, capacity_status, uncomputed_machines, available_minutes
`;

interface PlanRow {
  id: string;
  tenant_id: string;
  plan_number: string;
  period_start: string;
  period_end: string;
  planning_utilization_pct: string | number;
  status: string;
  computed_at: Date | string | null;
  superseded_by_id: string | null;
}

interface LineRow {
  id: string;
  tenant_id: string;
  capacity_plan_id: string;
  plant_id: string;
  line_id: string | null;
  product_id: string | null;
  total_capacity: number;
  planning_capacity: number;
  capacity_buffer: number;
  demand_quantity: number;
  planned_quantity: number;
  capacity_utilization: string | number;
  capacity_gap: number;
  capacity_status: string;
  uncomputed_machines: UncomputedMachine[];
  available_minutes: string | number;
}

export interface CapacityPlanLineRecord extends CapacityPlanLine {
  /** Machines left out of the total, each with the reason (§45.6). */
  uncomputedMachines: UncomputedMachine[];
  availableMinutes: number;
}

export interface CapacityPlanRecord extends CapacityPlan {
  supersededById?: string;
  lines?: CapacityPlanLineRecord[];
}

function toPlan(row: PlanRow): CapacityPlanRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planNumber: row.plan_number,
    periodStart: asDateString(row.period_start),
    periodEnd: asDateString(row.period_end),
    planningUtilizationPct: Number(row.planning_utilization_pct),
    status: (row.status as CapacityPlanStatus) ?? CapacityPlanStatus.DRAFT,
    computedAt: asOptionalIsoString(row.computed_at),
    supersededById: orUndefined(row.superseded_by_id),
  };
}

function toLine(row: LineRow): CapacityPlanLineRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    capacityPlanId: row.capacity_plan_id,
    plantId: row.plant_id,
    lineId: orUndefined(row.line_id),
    productId: orUndefined(row.product_id),
    totalCapacity: Number(row.total_capacity),
    planningCapacity: Number(row.planning_capacity),
    capacityBuffer: Number(row.capacity_buffer),
    demandQuantity: Number(row.demand_quantity),
    plannedQuantity: Number(row.planned_quantity),
    capacityUtilization: Number(row.capacity_utilization),
    capacityGap: Number(row.capacity_gap),
    capacityStatus: (row.capacity_status as CapacityStatus) ?? CapacityStatus.WITHIN_PLAN,
    uncomputedMachines: row.uncomputed_machines ?? [],
    availableMinutes: Number(row.available_minutes),
  };
}

export class CapacityPlanRepository {
  async insert(exec: Executor, plan: CapacityPlanRecord): Promise<CapacityPlanRecord> {
    const result = await exec.query<PlanRow>(
      `INSERT INTO capacity_plan (
         id, tenant_id, plan_number, period_start, period_end, planning_utilization_pct, status
       ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7)
       RETURNING ${PLAN_COLUMNS}`,
      [
        plan.id,
        plan.tenantId,
        plan.planNumber,
        plan.periodStart,
        plan.periodEnd,
        plan.planningUtilizationPct,
        plan.status,
      ]
    );
    return toPlan(result.rows[0]);
  }

  async insertLine(exec: Executor, line: CapacityPlanLineRecord): Promise<CapacityPlanLineRecord> {
    const result = await exec.query<LineRow>(
      `INSERT INTO capacity_plan_line (
         id, tenant_id, capacity_plan_id, plant_id, line_id, product_id,
         total_capacity, planning_capacity, capacity_buffer, demand_quantity, planned_quantity,
         capacity_utilization, capacity_gap, capacity_status, uncomputed_machines, available_minutes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
       RETURNING ${LINE_COLUMNS}`,
      [
        line.id,
        line.tenantId,
        line.capacityPlanId,
        line.plantId,
        line.lineId ?? null,
        line.productId ?? null,
        line.totalCapacity,
        line.planningCapacity,
        line.capacityBuffer,
        line.demandQuantity,
        line.plannedQuantity,
        line.capacityUtilization,
        line.capacityGap,
        line.capacityStatus,
        JSON.stringify(line.uncomputedMachines ?? []),
        line.availableMinutes,
      ]
    );
    return toLine(result.rows[0]);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<CapacityPlanRecord | undefined> {
    const result = await exec.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM capacity_plan WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toPlan(result.rows[0]) : undefined;
  }

  async listLines(exec: Executor, tenantId: string, planId: string): Promise<CapacityPlanLineRecord[]> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM capacity_plan_line
        WHERE tenant_id = $1 AND capacity_plan_id = $2 ORDER BY product_id NULLS LAST, id`,
      [tenantId, planId]
    );
    return result.rows.map(toLine);
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { status?: CapacityPlanStatus; periodStart?: string; limit?: number } = {}
  ): Promise<CapacityPlanRecord[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.periodStart) {
      params.push(filter.periodStart);
      where.push(`period_start = $${params.length}::date`);
    }
    params.push(Math.min(filter.limit ?? 100, 500));
    const result = await exec.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM capacity_plan WHERE ${where.join(' AND ')}
        ORDER BY period_start DESC, plan_number DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map(toPlan);
  }

  /**
   * Marks a plan superseded.
   *
   * Its lines are left untouched: a Production Plan that was decided against
   * those numbers has to keep showing them (MES-033).
   */
  async markSuperseded(
    exec: Executor,
    tenantId: string,
    id: string,
    supersededById: string
  ): Promise<void> {
    await exec.query(
      `UPDATE capacity_plan SET status = $3, superseded_by_id = $4
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, CapacityPlanStatus.SUPERSEDED, supersededById]
    );
  }

  /** Whether any Production Plan already points at this snapshot. */
  async isReferencedByPlan(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM production_plan WHERE tenant_id = $1 AND capacity_plan_id = $2',
      [tenantId, id]
    );
    return Number(result.rows[0]?.n ?? 0) > 0;
  }

  /**
   * Demand per product for a period, from Customer Orders.
   *
   * Read from `customer_order_line`, never from Work Orders: §8 A5 makes the
   * order line and the plan line the only owners of demand, because summing
   * work orders across a four-process routing would report 40.000 for a demand
   * of 10.000.
   */
  async demandByProduct(
    exec: Executor,
    tenantId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<{ productId: string; demandQuantity: number; plannedQuantity: number }[]> {
    const result = await exec.query<{ product_id: string; demand: string; planned: string }>(
      `SELECT col.product_id,
              SUM(col.ordered_quantity)::text AS demand,
              SUM(col.planned_quantity)::text AS planned
         FROM customer_order_line col
         JOIN customer_order co ON co.id = col.customer_order_id
        WHERE col.tenant_id = $1
          AND co.status <> 'CANCELLED'
          AND COALESCE(col.requested_delivery_date, co.requested_delivery_date)
              BETWEEN $2::date AND $3::date
        GROUP BY col.product_id
        ORDER BY col.product_id`,
      [tenantId, periodStart, periodEnd]
    );
    return result.rows.map((row) => ({
      productId: row.product_id,
      demandQuantity: Number(row.demand),
      plannedQuantity: Number(row.planned),
    }));
  }

  /**
   * Planned downtime already scheduled in the period, per machine.
   *
   * `is_planned` marks maintenance and changeover the plant has committed to;
   * that time is not available for production and §45.6 requires it to come off
   * the top rather than surprise the plan later.
   */
  async plannedDowntimeMinutes(
    exec: Executor,
    tenantId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<Map<string, number>> {
    const result = await exec.query<{ machine_id: string; minutes: string }>(
      `SELECT machine_id,
              (COALESCE(SUM(duration_seconds), 0) / 60.0)::text AS minutes
         FROM downtime_record
        WHERE tenant_id = $1 AND is_planned = TRUE
          AND shift_date BETWEEN $2::date AND $3::date
        GROUP BY machine_id`,
      [tenantId, periodStart, periodEnd]
    );
    return new Map(result.rows.map((row) => [row.machine_id, Number(row.minutes)]));
  }
}
