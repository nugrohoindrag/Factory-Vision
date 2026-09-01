import type { Executor } from '../../../platform/db/executor.js';

/**
 * The master data planning reads, read straight from PostgreSQL.
 *
 * Planning could ask `MasterDataService` for some of this, but that service is
 * an in-memory projection rebuilt at boot and shaped around the shop floor's
 * hot path. Planning needs joins it does not hold — routing by product with the
 * process's active flag, machines compatible with a product *and* the cycle
 * time for that pair, shift minutes for a period — and needs them inside the
 * transaction it is already running. Reading them here keeps planning
 * independent of the shop-floor modules, which is what MES-019 is for.
 */

export interface PlanningProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  idealCycleTimeSeconds: number;
  status: string;
}

export interface PlanningRoutingStep {
  routingId: string;
  productId: string;
  processId: string;
  processCode: string;
  processName: string;
  processStatus: string;
  sequence: number;
  workCenterId?: string;
  machineId?: string;
  standardCycleTimeSeconds?: number;
  active: boolean;
}

export interface PlanningMachineRate {
  machineId: string;
  machineCode: string;
  machineName: string;
  lineId: string;
  plantId: string;
  machineStatus: string;
  /** `undefined` when no `product_machine_rate` row exists for the pair. */
  idealCycleTimeSeconds?: number;
}

export interface PlanningShift {
  id: string;
  plantId: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossesMidnight: boolean;
  active: boolean;
}

export interface PlanningConfig {
  tenantId: string;
  planningUtilizationPct: number;
  strictProcessSequence: boolean;
}

export class PlanningReferenceRepository {
  async findProduct(exec: Executor, tenantId: string, productId: string): Promise<PlanningProduct | undefined> {
    const result = await exec.query<{
      id: string;
      sku: string;
      name: string;
      unit: string;
      ideal_cycle_time_seconds: number | null;
      status: string;
    }>(
      `SELECT id, sku, name, unit, ideal_cycle_time_seconds, status
         FROM product WHERE tenant_id = $1 AND id = $2`,
      [tenantId, productId]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      unit: row.unit ?? 'PCS',
      idealCycleTimeSeconds: Number(row.ideal_cycle_time_seconds ?? 0),
      status: row.status,
    };
  }

  async listProducts(exec: Executor, tenantId: string): Promise<PlanningProduct[]> {
    const result = await exec.query<{
      id: string;
      sku: string;
      name: string;
      unit: string;
      ideal_cycle_time_seconds: number | null;
      status: string;
    }>(
      `SELECT id, sku, name, unit, ideal_cycle_time_seconds, status
         FROM product WHERE tenant_id = $1 ORDER BY sku`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      unit: row.unit ?? 'PCS',
      idealCycleTimeSeconds: Number(row.ideal_cycle_time_seconds ?? 0),
      status: row.status,
    }));
  }

  /**
   * The routing for a product, in sequence order.
   *
   * Includes inactive rows and inactive processes on purpose: MES-042 has to
   * *report* that a routing references an inactive process, which it cannot do
   * if the query silently drops it.
   */
  async listRouting(exec: Executor, tenantId: string, productId: string): Promise<PlanningRoutingStep[]> {
    const result = await exec.query<{
      routing_id: string;
      product_id: string;
      process_id: string;
      process_code: string;
      process_name: string;
      process_status: string;
      sequence: number;
      work_center_id: string | null;
      machine_id: string | null;
      standard_cycle_time_seconds: number | null;
      active: boolean;
    }>(
      `SELECT pr.id AS routing_id, pr.product_id, pr.process_id,
              pp.code AS process_code, pp.name AS process_name, pp.status AS process_status,
              pr.sequence, pr.work_center_id, pr.machine_id, pr.standard_cycle_time_seconds, pr.active
         FROM product_routing pr
         JOIN production_process pp ON pp.id = pr.process_id
        WHERE pr.tenant_id = $1 AND pr.product_id = $2
        ORDER BY pr.sequence, pr.id`,
      [tenantId, productId]
    );
    return result.rows.map((row) => ({
      routingId: row.routing_id,
      productId: row.product_id,
      processId: row.process_id,
      processCode: row.process_code,
      processName: row.process_name,
      processStatus: row.process_status,
      sequence: Number(row.sequence),
      workCenterId: row.work_center_id ?? undefined,
      machineId: row.machine_id ?? undefined,
      standardCycleTimeSeconds:
        row.standard_cycle_time_seconds === null ? undefined : Number(row.standard_cycle_time_seconds),
      active: row.active,
    }));
  }

  /**
   * Machines that can make a product, each with the cycle time for that pair.
   *
   * A `LEFT JOIN` on `product_machine_rate`, deliberately: a machine with no
   * rate has to come back with `idealCycleTimeSeconds` undefined so capacity can
   * report it as "kapasitas belum terhitung". An inner join would make it
   * disappear, which is exactly the silent zero §45.6 forbids.
   */
  async listMachineRates(
    exec: Executor,
    tenantId: string,
    productId: string,
    scope: { plantId?: string; lineId?: string } = {}
  ): Promise<PlanningMachineRate[]> {
    const params: unknown[] = [tenantId, productId];
    const where = ['m.tenant_id = $1'];
    if (scope.lineId) {
      params.push(scope.lineId);
      where.push(`wc.production_line_id = $${params.length}`);
    }
    if (scope.plantId) {
      params.push(scope.plantId);
      where.push(`pl.plant_id = $${params.length}`);
    }

    const result = await exec.query<{
      machine_id: string;
      machine_code: string;
      machine_name: string;
      line_id: string;
      plant_id: string;
      machine_status: string;
      ideal_cycle_time_seconds: number | null;
    }>(
      `SELECT m.id AS machine_id, m.code AS machine_code, m.name AS machine_name,
              pl.id AS line_id, pl.plant_id, m.status AS machine_status,
              pmr.ideal_cycle_time_seconds
         FROM machine m
         JOIN work_center wc ON wc.id = m.work_center_id
         JOIN production_line pl ON pl.id = wc.production_line_id
         LEFT JOIN product_machine_rate pmr
                ON pmr.machine_id = m.id
               AND pmr.product_id = $2
               AND pmr.tenant_id = m.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.code`,
      params
    );
    return result.rows.map((row) => ({
      machineId: row.machine_id,
      machineCode: row.machine_code,
      machineName: row.machine_name,
      lineId: row.line_id,
      plantId: row.plant_id,
      machineStatus: row.machine_status,
      idealCycleTimeSeconds:
        row.ideal_cycle_time_seconds === null || Number(row.ideal_cycle_time_seconds) <= 0
          ? undefined
          : Number(row.ideal_cycle_time_seconds),
    }));
  }

  /** Machines that hold a `product_machine_rate` row, i.e. are compatible. */
  async listCompatibleMachines(
    exec: Executor,
    tenantId: string,
    productId: string,
    scope: { plantId?: string; lineId?: string } = {}
  ): Promise<PlanningMachineRate[]> {
    const all = await this.listMachineRates(exec, tenantId, productId, scope);
    const compatible = await exec.query<{ machine_id: string }>(
      'SELECT machine_id FROM product_machine_rate WHERE tenant_id = $1 AND product_id = $2',
      [tenantId, productId]
    );
    const declared = new Set(compatible.rows.map((r) => r.machine_id));
    // A rate row is the compatibility declaration; if a tenant has declared none
    // at all for the product, every machine on the line is a candidate and each
    // one is reported as uncomputed rather than the product having no capacity.
    return declared.size === 0 ? all : all.filter((m) => declared.has(m.machineId));
  }

  async listShifts(exec: Executor, tenantId: string): Promise<PlanningShift[]> {
    const result = await exec.query<{
      id: string;
      plant_id: string;
      name: string;
      start_time: string;
      end_time: string;
      break_minutes: number | null;
      crosses_midnight: boolean | null;
      active: boolean | null;
    }>(
      `SELECT id, plant_id, name, start_time, end_time, break_minutes, crosses_midnight, active
         FROM shift WHERE tenant_id = $1 ORDER BY start_time`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      plantId: row.plant_id,
      name: row.name,
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      breakMinutes: Number(row.break_minutes ?? 0),
      crossesMidnight: Boolean(row.crosses_midnight),
      active: row.active !== false,
    }));
  }

  /** Molds declared compatible with a product (MES-006). */
  async listCompatibleMolds(
    exec: Executor,
    tenantId: string,
    productId: string
  ): Promise<{ moldId: string; code: string; name: string; status: string; cavityCount: number }[]> {
    const result = await exec.query<{
      id: string;
      code: string;
      name: string;
      status: string;
      cavity_count: number;
    }>(
      `SELECT m.id, m.code, m.name, m.status, m.cavity_count
         FROM product_mold_compatibility pmc
         JOIN mold m ON m.id = pmc.mold_id
        WHERE pmc.tenant_id = $1 AND pmc.product_id = $2 AND pmc.active = TRUE
        ORDER BY m.code`,
      [tenantId, productId]
    );
    return result.rows.map((row) => ({
      moldId: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      cavityCount: Number(row.cavity_count ?? 1),
    }));
  }

  /** The default production line a plant runs, used when a plan names none. */
  async firstActiveLine(
    exec: Executor,
    tenantId: string
  ): Promise<{ lineId: string; plantId: string } | undefined> {
    const result = await exec.query<{ id: string; plant_id: string }>(
      `SELECT id, plant_id FROM production_line
        WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`,
      [tenantId]
    );
    const row = result.rows[0];
    return row ? { lineId: row.id, plantId: row.plant_id } : undefined;
  }

  // --- Planning configuration (§13, §45.6) ----------------------------

  async getConfig(exec: Executor, tenantId: string): Promise<PlanningConfig> {
    const result = await exec.query<{
      tenant_id: string;
      planning_utilization_pct: string;
      strict_process_sequence: boolean;
    }>(
      `SELECT tenant_id, planning_utilization_pct, strict_process_sequence
         FROM planning_config WHERE tenant_id = $1`,
      [tenantId]
    );
    const row = result.rows[0];
    if (!row) {
      // The documented defaults, not a guess: 80% utilization (§45.6) and the
      // soft predecessor guard (§13).
      return { tenantId, planningUtilizationPct: 80, strictProcessSequence: false };
    }
    return {
      tenantId: row.tenant_id,
      planningUtilizationPct: Number(row.planning_utilization_pct),
      strictProcessSequence: row.strict_process_sequence,
    };
  }

  async upsertConfig(
    exec: Executor,
    tenantId: string,
    patch: { planningUtilizationPct?: number; strictProcessSequence?: boolean }
  ): Promise<PlanningConfig> {
    await exec.query(
      `INSERT INTO planning_config (tenant_id, planning_utilization_pct, strict_process_sequence)
       VALUES ($1, COALESCE($2, 80.0), COALESCE($3, FALSE))
       ON CONFLICT (tenant_id) DO UPDATE SET
         planning_utilization_pct = COALESCE($2, planning_config.planning_utilization_pct),
         strict_process_sequence = COALESCE($3, planning_config.strict_process_sequence),
         updated_at = CURRENT_TIMESTAMP`,
      [tenantId, patch.planningUtilizationPct ?? null, patch.strictProcessSequence ?? null]
    );
    return this.getConfig(exec, tenantId);
  }
}
