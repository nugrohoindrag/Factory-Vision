import type {
  DowntimeCategory,
  DowntimeReason,
  Machine,
  MachineState,
  Plant,
  Product,
  ProductMachineRate,
  ProductRouting,
  ProductionLine,
  ProductionProcess,
  RejectCategory,
  RejectReason,
  WorkCenter,
} from '@factory-vision/domain-types';
import { asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * Manufacturing reference data, read back from PostgreSQL.
 *
 * **Why this exists.** `MasterDataService` serves plants, lines, machines,
 * products, processes, routings and reason codes from memory, which is right —
 * a production record's validation reads them on the hot path. But the memory
 * was only ever *written to* the database, by `syncReferenceData` during demo
 * seeding, and never read back. Every one of these tables has existed since
 * migration 001, and the application has been ignoring all of them.
 *
 * The consequence on a real install was silent and total: an administrator
 * created a Product, a Machine or a Reject Reason through the console, it lived
 * in one process's heap, and the next restart erased it. Worse, the shop floor
 * validates a reject against `getRejectReasons()`, so after a restart every
 * reject capture would be refused as "alasan reject tidak dikenal".
 *
 * With this, memory becomes what the bootstrap comment always claimed it was: a
 * projection of the database rather than the record itself.
 */

export class MasterReferenceRepository {
  // --- Plants ---------------------------------------------------------

  async listPlants(exec: Executor, tenantId: string): Promise<Plant[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      name: string;
      location: string | null;
      timezone: string | null;
      status: string;
    }>(
      'SELECT id, tenant_id, name, location, timezone, status FROM plant WHERE tenant_id = $1 ORDER BY name',
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      location: row.location ?? '',
      timezone: row.timezone ?? 'Asia/Jakarta',
      status: (row.status as Plant['status']) ?? 'ACTIVE',
    }));
  }

  async upsertPlant(exec: Executor, plant: Plant): Promise<void> {
    await exec.query(
      `INSERT INTO plant (id, tenant_id, name, location, timezone, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, location = EXCLUDED.location,
             timezone = EXCLUDED.timezone, status = EXCLUDED.status`,
      [plant.id, plant.tenantId, plant.name, plant.location ?? null, plant.timezone ?? 'Asia/Jakarta', plant.status]
    );
  }

  // --- Production lines -----------------------------------------------

  async listLines(exec: Executor, tenantId: string): Promise<ProductionLine[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      plant_id: string;
      code: string;
      name: string;
      status: string;
      planned_production_time_minutes: number | null;
    }>(
      `SELECT id, tenant_id, plant_id, code, name, status, planned_production_time_minutes
         FROM production_line WHERE tenant_id = $1 ORDER BY code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      plantId: row.plant_id,
      code: row.code,
      name: row.name,
      status: (row.status as ProductionLine['status']) ?? 'ACTIVE',
      plannedProductionTimeMinutes: Number(row.planned_production_time_minutes ?? 480),
    }));
  }

  async upsertLine(exec: Executor, line: ProductionLine): Promise<void> {
    await exec.query(
      `INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE
         SET plant_id = EXCLUDED.plant_id, code = EXCLUDED.code, name = EXCLUDED.name,
             status = EXCLUDED.status,
             planned_production_time_minutes = EXCLUDED.planned_production_time_minutes`,
      [
        line.id,
        line.tenantId,
        line.plantId,
        line.code,
        line.name,
        line.status ?? 'ACTIVE',
        line.plannedProductionTimeMinutes ?? 480,
      ]
    );
  }

  // --- Work centers ----------------------------------------------------

  async listWorkCenters(exec: Executor, tenantId: string): Promise<WorkCenter[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      production_line_id: string;
      code: string;
      name: string;
      sequence: number | null;
    }>(
      `SELECT id, tenant_id, production_line_id, code, name, sequence
         FROM work_center WHERE tenant_id = $1 ORDER BY sequence, code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      productionLineId: row.production_line_id,
      code: row.code,
      name: row.name,
      sequence: Number(row.sequence ?? 1),
    }));
  }

  async upsertWorkCenter(exec: Executor, workCenter: WorkCenter): Promise<void> {
    await exec.query(
      `INSERT INTO work_center (id, tenant_id, production_line_id, code, name, sequence)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE
         SET production_line_id = EXCLUDED.production_line_id, code = EXCLUDED.code,
             name = EXCLUDED.name, sequence = EXCLUDED.sequence`,
      [
        workCenter.id,
        workCenter.tenantId,
        workCenter.productionLineId,
        workCenter.code,
        workCenter.name,
        workCenter.sequence ?? 1,
      ]
    );
  }

  // --- Machines --------------------------------------------------------

  async listMachines(exec: Executor, tenantId: string): Promise<Machine[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      work_center_id: string;
      code: string;
      name: string;
      status: string;
      ideal_cycle_time_seconds: string | number;
      current_state: string;
      current_state_since: Date | string | null;
    }>(
      `SELECT id, tenant_id, work_center_id, code, name, status, ideal_cycle_time_seconds,
              current_state, current_state_since
         FROM machine WHERE tenant_id = $1 ORDER BY code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workCenterId: row.work_center_id,
      code: row.code,
      name: row.name,
      status: (row.status as Machine['status']) ?? 'ACTIVE',
      idealCycleTimeSeconds: Number(row.ideal_cycle_time_seconds),
      currentState: (row.current_state as MachineState) ?? ('IDLE' as MachineState),
      currentStateSince: row.current_state_since
        ? asIsoString(row.current_state_since)
        : new Date().toISOString(),
    }));
  }

  async upsertMachine(exec: Executor, machine: Machine): Promise<void> {
    await exec.query(
      `INSERT INTO machine (id, tenant_id, work_center_id, code, name, status,
                            ideal_cycle_time_seconds, current_state, current_state_since)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
         SET work_center_id = EXCLUDED.work_center_id, code = EXCLUDED.code, name = EXCLUDED.name,
             status = EXCLUDED.status,
             ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds`,
      [
        machine.id,
        machine.tenantId,
        machine.workCenterId,
        machine.code,
        machine.name,
        machine.status ?? 'ACTIVE',
        machine.idealCycleTimeSeconds ?? 0,
        machine.currentState ?? 'IDLE',
        machine.currentStateSince ?? new Date().toISOString(),
      ]
    );
  }

  // --- Products --------------------------------------------------------

  async listProducts(exec: Executor, tenantId: string): Promise<Product[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      sku: string;
      name: string;
      unit: string | null;
      ideal_cycle_time_seconds: string | number;
      status: string;
    }>(
      `SELECT id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status
         FROM product WHERE tenant_id = $1 ORDER BY sku`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      sku: row.sku,
      name: row.name,
      unit: row.unit ?? 'PCS',
      idealCycleTimeSeconds: Number(row.ideal_cycle_time_seconds),
      status: (row.status as Product['status']) ?? 'ACTIVE',
    }));
  }

  async upsertProduct(exec: Executor, product: Product): Promise<void> {
    await exec.query(
      `INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE
         SET sku = EXCLUDED.sku, name = EXCLUDED.name, unit = EXCLUDED.unit,
             ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds,
             status = EXCLUDED.status`,
      [
        product.id,
        product.tenantId,
        product.sku,
        product.name,
        product.unit ?? 'PCS',
        product.idealCycleTimeSeconds ?? 0,
        product.status ?? 'ACTIVE',
      ]
    );
  }

  // --- Processes -------------------------------------------------------

  async listProcesses(exec: Executor, tenantId: string): Promise<ProductionProcess[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      code: string;
      name: string;
      description: string | null;
      sequence_default: number | null;
      status: string;
    }>(
      `SELECT id, tenant_id, code, name, description, sequence_default, status
         FROM production_process WHERE tenant_id = $1 ORDER BY sequence_default, code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      description: orUndefined(row.description),
      sequenceDefault: Number(row.sequence_default ?? 1),
      status: (row.status as ProductionProcess['status']) ?? 'ACTIVE',
    }));
  }

  async upsertProcess(exec: Executor, process: ProductionProcess): Promise<void> {
    await exec.query(
      `INSERT INTO production_process (id, tenant_id, code, name, description, sequence_default, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE
         SET code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
             sequence_default = EXCLUDED.sequence_default, status = EXCLUDED.status,
             updated_at = CURRENT_TIMESTAMP`,
      [
        process.id,
        process.tenantId,
        process.code,
        process.name,
        process.description ?? null,
        process.sequenceDefault ?? 1,
        process.status ?? 'ACTIVE',
      ]
    );
  }

  // --- Routing ---------------------------------------------------------

  async listRoutings(exec: Executor, tenantId: string): Promise<ProductRouting[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      product_id: string;
      process_id: string;
      sequence: number;
      work_center_id: string | null;
      machine_id: string | null;
      standard_cycle_time_seconds: string | number | null;
      active: boolean | null;
    }>(
      `SELECT id, tenant_id, product_id, process_id, sequence, work_center_id, machine_id,
              standard_cycle_time_seconds, active
         FROM product_routing WHERE tenant_id = $1 ORDER BY product_id, sequence`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      productId: row.product_id,
      processId: row.process_id,
      sequence: Number(row.sequence),
      workCenterId: orUndefined(row.work_center_id),
      machineId: orUndefined(row.machine_id),
      standardCycleTimeSeconds:
        row.standard_cycle_time_seconds === null ? undefined : Number(row.standard_cycle_time_seconds),
      active: row.active !== false,
    }));
  }

  async upsertRouting(exec: Executor, routing: ProductRouting): Promise<void> {
    await exec.query(
      `INSERT INTO product_routing (id, tenant_id, product_id, process_id, sequence,
                                    work_center_id, machine_id, standard_cycle_time_seconds, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
         SET product_id = EXCLUDED.product_id, process_id = EXCLUDED.process_id,
             sequence = EXCLUDED.sequence, work_center_id = EXCLUDED.work_center_id,
             machine_id = EXCLUDED.machine_id,
             standard_cycle_time_seconds = EXCLUDED.standard_cycle_time_seconds,
             active = EXCLUDED.active`,
      [
        routing.id,
        routing.tenantId,
        routing.productId,
        routing.processId,
        routing.sequence,
        routing.workCenterId ?? null,
        routing.machineId ?? null,
        routing.standardCycleTimeSeconds ?? null,
        routing.active !== false,
      ]
    );
  }

  // --- Product / machine rates -----------------------------------------

  async listRates(exec: Executor, tenantId: string): Promise<ProductMachineRate[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      product_id: string;
      machine_id: string;
      ideal_cycle_time_seconds: string | number;
    }>(
      `SELECT id, tenant_id, product_id, machine_id, ideal_cycle_time_seconds
         FROM product_machine_rate WHERE tenant_id = $1 ORDER BY product_id, machine_id`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      productId: row.product_id,
      machineId: row.machine_id,
      idealCycleTimeSeconds: Number(row.ideal_cycle_time_seconds),
    }));
  }

  async upsertRate(exec: Executor, rate: ProductMachineRate): Promise<void> {
    await exec.query(
      `INSERT INTO product_machine_rate (id, tenant_id, product_id, machine_id, ideal_cycle_time_seconds)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE
         SET product_id = EXCLUDED.product_id, machine_id = EXCLUDED.machine_id,
             ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds`,
      [rate.id, rate.tenantId, rate.productId, rate.machineId, rate.idealCycleTimeSeconds]
    );
  }

  // --- Reason codes ----------------------------------------------------

  async listDowntimeReasons(exec: Executor, tenantId: string): Promise<DowntimeReason[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      parent_id: string | null;
      category: string;
      code: string;
      name: string;
      description: string | null;
      is_planned: boolean | null;
      active: boolean | null;
      sort_order: number | null;
    }>(
      `SELECT id, tenant_id, parent_id, category, code, name, description, is_planned, active, sort_order
         FROM downtime_reason WHERE tenant_id = $1 ORDER BY sort_order, code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      parentId: orUndefined(row.parent_id),
      category: row.category as DowntimeCategory,
      code: row.code,
      name: row.name,
      description: orUndefined(row.description),
      isPlanned: Boolean(row.is_planned),
      active: row.active !== false,
      sortOrder: Number(row.sort_order ?? 0),
    }));
  }

  async upsertDowntimeReason(exec: Executor, reason: DowntimeReason): Promise<void> {
    await exec.query(
      `INSERT INTO downtime_reason (id, tenant_id, parent_id, category, code, name, description,
                                    is_planned, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE
         SET parent_id = EXCLUDED.parent_id, category = EXCLUDED.category, code = EXCLUDED.code,
             name = EXCLUDED.name, description = EXCLUDED.description,
             is_planned = EXCLUDED.is_planned, active = EXCLUDED.active,
             sort_order = EXCLUDED.sort_order`,
      [
        reason.id,
        reason.tenantId,
        reason.parentId ?? null,
        reason.category,
        reason.code,
        reason.name,
        reason.description ?? null,
        reason.isPlanned ?? false,
        reason.active !== false,
        reason.sortOrder ?? 0,
      ]
    );
  }

  async listRejectReasons(exec: Executor, tenantId: string): Promise<RejectReason[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      parent_id: string | null;
      category: string;
      code: string;
      name: string;
      description: string | null;
      active: boolean | null;
      sort_order: number | null;
    }>(
      `SELECT id, tenant_id, parent_id, category, code, name, description, active, sort_order
         FROM reject_reason WHERE tenant_id = $1 ORDER BY sort_order, code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      parentId: orUndefined(row.parent_id),
      category: row.category as RejectCategory,
      code: row.code,
      name: row.name,
      description: orUndefined(row.description),
      active: row.active !== false,
      sortOrder: Number(row.sort_order ?? 0),
    }));
  }

  async upsertRejectReason(exec: Executor, reason: RejectReason): Promise<void> {
    await exec.query(
      `INSERT INTO reject_reason (id, tenant_id, parent_id, category, code, name, description,
                                  active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
         SET parent_id = EXCLUDED.parent_id, category = EXCLUDED.category, code = EXCLUDED.code,
             name = EXCLUDED.name, description = EXCLUDED.description,
             active = EXCLUDED.active, sort_order = EXCLUDED.sort_order`,
      [
        reason.id,
        reason.tenantId,
        reason.parentId ?? null,
        reason.category,
        reason.code,
        reason.name,
        reason.description ?? null,
        reason.active !== false,
        reason.sortOrder ?? 0,
      ]
    );
  }

  /**
   * Removes a reference row.
   *
   * The table name is a compile-time literal from the service, never request
   * input. A row still referenced by production is protected by its foreign
   * key, so the delete surfaces as an error rather than orphaning history.
   */
  async remove(
    exec: Executor,
    table:
      | 'plant'
      | 'production_line'
      | 'work_center'
      | 'machine'
      | 'product'
      | 'production_process'
      | 'product_routing'
      | 'product_machine_rate'
      | 'downtime_reason'
      | 'reject_reason',
    tenantId: string,
    id: string
  ): Promise<void> {
    await exec.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  }
}
