import type { Executor } from '../../platform/db/executor.js';
import type { MasterDataService } from './master-data.service.js';

/**
 * Writes the master data that transactional rows point at into PostgreSQL.
 *
 * Phase 3 of the persistence fix moved work orders, production records and
 * downtime into the database, and each of those carries foreign keys:
 * `work_order` references `production_order`, `product`, `production_process`,
 * `production_batch` and `production_line`; `production_line` in turn
 * references `plant`, and everything references `tenant`. An insert whose
 * parent row is absent is rejected outright, so the referenced master data has
 * to exist before the first production record can be written at all.
 *
 * This is deliberately narrow. It syncs the closure the foreign keys require
 * and nothing else: machines, operators, shifts, reason codes, routings and
 * cycle rates are still served from `MasterDataService`'s in-memory state,
 * because nothing in the database points at them yet. Completing phase 2, so
 * that master data edited in Settings is itself durable, is separate work.
 *
 * Every statement is an upsert keyed on the id, so running it on each boot
 * converges rather than duplicating, and a row a customer has since edited in
 * the database is refreshed from the service rather than skipped.
 */
export class MasterDataRepository {
  async syncReferenceData(
    exec: Executor,
    masterData: MasterDataService,
    tenantId: string
  ): Promise<{ plants: number; lines: number; processes: number; products: number }> {
    // The tenant itself is the root of every foreign key in the schema.
    await exec.query(
      `INSERT INTO tenant (id, name, timezone, plan, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Factory Vision Tenant', 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE']
    );

    const plants = masterData.getPlants(tenantId);
    for (const plant of plants) {
      await exec.query(
        `INSERT INTO plant (id, tenant_id, name, location, timezone, status)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
        [
          plant.id,
          tenantId,
          plant.name,
          (plant as { location?: string }).location ?? null,
          (plant as { timezone?: string }).timezone ?? 'Asia/Jakarta',
          (plant as { status?: string }).status ?? 'ACTIVE',
        ]
      );
    }

    const lines = masterData.getLines(tenantId);
    for (const line of lines) {
      await exec.query(
        `INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               status = EXCLUDED.status,
               planned_production_time_minutes = EXCLUDED.planned_production_time_minutes`,
        [
          line.id,
          tenantId,
          line.plantId,
          line.code,
          line.name,
          line.status ?? 'ACTIVE',
          line.plannedProductionTimeMinutes ?? 480,
        ]
      );
    }

    const processes = masterData.getProcesses(tenantId);
    for (const process of processes) {
      await exec.query(
        `INSERT INTO production_process (id, tenant_id, code, name, description, sequence_default, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, sequence_default = EXCLUDED.sequence_default, status = EXCLUDED.status`,
        [
          process.id,
          tenantId,
          process.code,
          process.name,
          process.description ?? null,
          process.sequenceDefault ?? 1,
          process.status ?? 'ACTIVE',
        ]
      );
    }

    const products = masterData.getProducts(tenantId);
    for (const product of products) {
      await exec.query(
        `INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds,
               status = EXCLUDED.status`,
        [
          product.id,
          tenantId,
          product.sku,
          product.name,
          product.unit ?? 'PCS',
          product.idealCycleTimeSeconds ?? 60,
          product.status ?? 'ACTIVE',
        ]
      );
    }

    return {
      plants: plants.length,
      lines: lines.length,
      processes: processes.length,
      products: products.length,
    };
  }

  /**
   * Persists one batch.
   *
   * A batch created through Settings has to reach the database before a work
   * order can reference it: `work_order.batch_id` is a foreign key, so
   * attaching an unpersisted batch (US-013) is rejected outright.
   */
  async upsertBatch(
    exec: Executor,
    tenantId: string,
    batch: {
      id: string;
      batchNumber: string;
      productId: string;
      productionOrderId: string;
      productionDate: string;
      status?: string;
    }
  ): Promise<void> {
    await exec.query(
      `INSERT INTO production_batch (id, tenant_id, batch_number, product_id, production_order_id, production_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE
         SET batch_number = EXCLUDED.batch_number, status = EXCLUDED.status`,
      [
        batch.id,
        tenantId,
        batch.batchNumber,
        batch.productId,
        batch.productionOrderId,
        batch.productionDate,
        batch.status ?? 'OPEN',
      ]
    );
  }

  /**
   * Batches, which sit between production orders and work orders in the
   * foreign-key order: a batch references its production order, and a work
   * order references the batch. The caller therefore seeds production orders,
   * then calls this, then seeds work orders.
   */
  async syncBatches(
    exec: Executor,
    masterData: MasterDataService,
    tenantId: string
  ): Promise<{ batches: number }> {
    const batches = masterData.getBatches(tenantId);
    let batchCount = 0;
    for (const batch of batches) {
      const parent = await exec.query<{ id: string }>(
        'SELECT id FROM production_order WHERE tenant_id = $1 AND id = $2',
        [tenantId, batch.productionOrderId]
      );
      // A batch whose production order is not persisted would fail the foreign
      // key. Skipping it is correct: nothing can reference it either.
      if (parent.rows.length === 0) continue;

      await exec.query(
        `INSERT INTO production_batch (id, tenant_id, batch_number, product_id, production_order_id, production_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
        [
          batch.id,
          tenantId,
          batch.batchNumber,
          batch.productId,
          batch.productionOrderId,
          batch.productionDate,
          batch.status ?? 'OPEN',
        ]
      );
      batchCount += 1;
    }

    return { batches: batchCount };
  }
}
