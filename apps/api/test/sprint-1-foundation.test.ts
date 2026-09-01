import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';
import { WorkOrderStatus, ProductionBatchStatus } from '@factory-vision/domain-types';
import { WorkOrderRepository } from '../src/modules/production/work-order.repository.js';
import { BatchRepository } from '../src/modules/production/batch.repository.js';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://factory:factory@localhost:5432/factory_vision';
const PILOT_TENANT = 'tenant-pilot-factory-01';

test('Sprint 1 Foundation: Database Schema, Constraints & Execution Path Exclusivity', async (t) => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const woRepo = new WorkOrderRepository();
  const batchRepo = new BatchRepository();

  async function assertThrowsPgError(fn: () => Promise<unknown>, msg: string) {
    let failed = false;
    try {
      await fn();
    } catch (err: any) {
      failed = true;
    }
    assert.ok(failed, `Expected operation to fail at database level: ${msg}`);
  }

  await t.test('MES-001: Work Order Schema & Hierarchy', async () => {
    const res = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'work_order'`
    );
    const cols = new Set(res.rows.map((r) => r.column_name));

    assert.ok(cols.has('production_plan_line_id'), 'production_plan_line_id column must exist');
    assert.ok(cols.has('parent_work_order_id'), 'parent_work_order_id column must exist');
    assert.ok(cols.has('predecessor_work_order_id'), 'predecessor_work_order_id column must exist');
    assert.ok(cols.has('routing_id'), 'routing_id column must exist');
    assert.ok(cols.has('process_id'), 'process_id column must exist');
    assert.ok(cols.has('sequence'), 'sequence column must exist');
    assert.ok(cols.has('is_batch_managed'), 'is_batch_managed column must exist');
    assert.ok(cols.has('has_child_work_order'), 'has_child_work_order column must exist');
    assert.ok(cols.has('mold_id'), 'mold_id column must exist');
    assert.ok(cols.has('shift_id'), 'shift_id column must exist');
    assert.ok(cols.has('planned_quantity'), 'planned_quantity column must exist');
    assert.ok(cols.has('input_quantity'), 'input_quantity column must exist');
    assert.ok(cols.has('output_quantity'), 'output_quantity column must exist');
    assert.ok(cols.has('reject_quantity'), 'reject_quantity column must exist');
    assert.ok(cols.has('scrap_quantity'), 'scrap_quantity column must exist');
    assert.ok(cols.has('rework_quantity'), 'rework_quantity column must exist');
    assert.ok(cols.has('transferred_quantity'), 'transferred_quantity column must exist');

    // Work Order does NOT have direct customer columns (ADR-22)
    assert.ok(!cols.has('customer_id'), 'work_order must NOT have direct customer_id');
    assert.ok(!cols.has('customer_order_id'), 'work_order must NOT have direct customer_order_id');
    assert.ok(!cols.has('allocated_quantity'), 'work_order must NOT have allocated_quantity');
  });

  await t.test('MES-002: Batch (production_batch) Schema', async () => {
    const res = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'production_batch'`
    );
    const cols = new Set(res.rows.map((r) => r.column_name));

    assert.ok(cols.has('work_order_id'), 'work_order_id column must exist');
    assert.ok(cols.has('batch_number'), 'batch_number column must exist');
    assert.ok(cols.has('sequence'), 'sequence column must exist');
    assert.ok(cols.has('planned_quantity'), 'planned_quantity column must exist');
    assert.ok(cols.has('input_quantity'), 'input_quantity column must exist');
    assert.ok(cols.has('output_quantity'), 'output_quantity column must exist');
    assert.ok(cols.has('reject_quantity'), 'reject_quantity column must exist');
    assert.ok(cols.has('scrap_quantity'), 'scrap_quantity column must exist');
    assert.ok(cols.has('rework_quantity'), 'rework_quantity column must exist');
    assert.ok(cols.has('transferred_quantity'), 'transferred_quantity column must exist');
    assert.ok(cols.has('status'), 'status column must exist');
    assert.ok(cols.has('status_reason'), 'status_reason column must exist');
    assert.ok(cols.has('machine_id'), 'machine_id column must exist');
    assert.ok(cols.has('mold_id'), 'mold_id column must exist');
    assert.ok(cols.has('operator_id'), 'operator_id column must exist');
    assert.ok(cols.has('shift_id'), 'shift_id column must exist');

    // Batch does NOT have predecessor_batch_id (ADR-30)
    assert.ok(!cols.has('predecessor_batch_id'), 'production_batch must NOT have predecessor_batch_id');
  });

  await t.test('MES-003 & MES-115: T1-T8, T9a-T9d Database Exclusivity Tests', async (sub) => {
    const now = new Date().toISOString();
    const testSuffix = Date.now();

    const woDirectId = `wo-t-direct-${testSuffix}`;
    const woBatchId = `wo-t-batch-${testSuffix}`;
    const woOtherId = `wo-t-other-${testSuffix}`;
    const woParentId = `wo-t-parent-${testSuffix}`;
    const woChildDirectId = `wo-t-child-dir-${testSuffix}`;
    const woChildBatchId = `wo-t-child-bat-${testSuffix}`;

    const batch1Id = `bat-t-1-${testSuffix}`;
    const batchOtherId = `bat-t-other-${testSuffix}`;
    const batchChildId = `bat-t-child-${testSuffix}`;

    // Clean up before test
    await client.query(`DELETE FROM production_record WHERE work_order_id LIKE 'wo-t-%'`);
    await client.query(`DELETE FROM production_batch WHERE id LIKE 'bat-t-%'`);
    await client.query(`DELETE FROM work_order WHERE id LIKE 'wo-t-%'`);

    // Sprint 2 (§22 step 15) made production_plan_line_id mandatory: a work
    // order without a plan line is no longer a legal row. The fixtures below
    // therefore need a plan to hang from.
    const planId = `plan-t-${testSuffix}`;
    const planLineId = `planline-t-${testSuffix}`;
    // One process per root work order: `uq_wo_plan_line_process` enforces
    // MES-041's "generate ulang tidak menghasilkan duplikat", so two roots on
    // one (plan line, process) is precisely what must be refused.
    await client.query(
      `INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, status)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 7, 'CONFIRMED')
       ON CONFLICT (id) DO NOTHING`,
      [planId, PILOT_TENANT, `PLAN-T-${testSuffix}`]
    );
    await client.query(
      `INSERT INTO production_plan_line
         (id, tenant_id, production_plan_id, product_id, demand_quantity, planned_quantity)
       VALUES ($1, $2, $3, 'prod-tire-a', 1000, 1000)
       ON CONFLICT (id) DO NOTHING`,
      [planLineId, PILOT_TENANT, planId]
    );

    // 1. Direct WO (non-batch, no child)
    await woRepo.create(client, {
      id: woDirectId,
      tenantId: PILOT_TENANT,
      productionPlanLineId: planLineId,
      woNumber: `WO-DIR-${testSuffix}`,
      productId: 'prod-tire-a',
      processId: 'proc-mixing',
      sequence: 1,
      lineId: 'line-01',
      plannedQuantity: 1000,
      targetQuantity: 1000,
      goodQuantity: 0,
      rejectQuantity: 0,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: now,
      status: WorkOrderStatus.SCHEDULED,
      priority: 1,
      isBatchManaged: false,
      hasChildWorkOrder: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Batch-managed WO
    await woRepo.create(client, {
      id: woBatchId,
      tenantId: PILOT_TENANT,
      productionPlanLineId: planLineId,
      woNumber: `WO-BAT-${testSuffix}`,
      productId: 'prod-tire-a',
      processId: 'proc-calendering',
      sequence: 1,
      lineId: 'line-01',
      plannedQuantity: 1000,
      targetQuantity: 1000,
      goodQuantity: 0,
      rejectQuantity: 0,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: now,
      status: WorkOrderStatus.SCHEDULED,
      priority: 1,
      isBatchManaged: true,
      hasChildWorkOrder: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Other batch WO (for foreign batch test)
    await woRepo.create(client, {
      id: woOtherId,
      tenantId: PILOT_TENANT,
      productionPlanLineId: planLineId,
      woNumber: `WO-OTH-${testSuffix}`,
      productId: 'prod-tire-a',
      processId: 'proc-extrusion',
      sequence: 1,
      lineId: 'line-01',
      plannedQuantity: 1000,
      targetQuantity: 1000,
      goodQuantity: 0,
      rejectQuantity: 0,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: now,
      status: WorkOrderStatus.SCHEDULED,
      priority: 1,
      isBatchManaged: true,
      hasChildWorkOrder: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Create Batches
    await batchRepo.create(client, {
      id: batch1Id,
      tenantId: PILOT_TENANT,
      batchNumber: `B-1-${testSuffix}`,
      workOrderId: woBatchId,
      productId: 'prod-tire-a',
      // A batch runs the process of the Work Order it belongs to (§4).
      processId: 'proc-calendering',
      sequence: 1,
      plannedQuantity: 500,
      inputQuantity: 0,
      outputQuantity: 0,
      rejectQuantity: 0,
      scrapQuantity: 0,
      reworkQuantity: 0,
      transferredQuantity: 0,
      status: ProductionBatchStatus.PLANNED,
      productionDate: now.slice(0, 10),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await batchRepo.create(client, {
      id: batchOtherId,
      tenantId: PILOT_TENANT,
      batchNumber: `B-OTH-${testSuffix}`,
      workOrderId: woOtherId,
      productId: 'prod-tire-a',
      processId: 'proc-extrusion',
      sequence: 1,
      plannedQuantity: 500,
      inputQuantity: 0,
      outputQuantity: 0,
      rejectQuantity: 0,
      scrapQuantity: 0,
      reworkQuantity: 0,
      transferredQuantity: 0,
      status: ProductionBatchStatus.PLANNED,
      productionDate: now.slice(0, 10),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // T1: Insert record without batch on non-batch WO -> Success
    await sub.test('T1: Insert record without batch on non-batch WO (DIRECT)', async () => {
      const recId = `rec-t1-${testSuffix}`;
      await client.query(
        `INSERT INTO production_record (
           id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
           batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
         ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,NULL,FALSE,FALSE,10,0,NOW(),'OPERATOR_MANUAL',$4)`,
        [recId, PILOT_TENANT, woDirectId, `evt-${recId}`]
      );
      const res = await client.query('SELECT id FROM production_record WHERE id = $1', [recId]);
      assert.equal(res.rows.length, 1);
    });

    // T2: Insert record with batch on batch-managed WO -> Success
    await sub.test('T2: Insert record with batch on batch-managed WO (BATCH)', async () => {
      const recId = `rec-t2-${testSuffix}`;
      await client.query(
        `INSERT INTO production_record (
           id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
           batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
         ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,$4,TRUE,FALSE,15,0,NOW(),'OPERATOR_MANUAL',$5)`,
        [recId, PILOT_TENANT, woBatchId, batch1Id, `evt-${recId}`]
      );
      const res = await client.query('SELECT id FROM production_record WHERE id = $1', [recId]);
      assert.equal(res.rows.length, 1);
    });

    // T3: Insert record without batch on batch-managed WO -> Rejected
    await sub.test('T3: Insert record without batch on batch-managed WO -> REJECTED', async () => {
      const recId = `rec-t3-${testSuffix}`;
      await assertThrowsPgError(
        () =>
          client.query(
            `INSERT INTO production_record (
               id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
               batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
             ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,NULL,TRUE,FALSE,10,0,NOW(),'OPERATOR_MANUAL',$4)`,
            [recId, PILOT_TENANT, woBatchId, `evt-${recId}`]
          ),
        'T3: batch-managed WO must reject NULL batch_id'
      );
    });

    // T4: Insert record with batch on non-batch WO -> Rejected
    await sub.test('T4: Insert record with batch on non-batch WO -> REJECTED', async () => {
      const recId = `rec-t4-${testSuffix}`;
      await assertThrowsPgError(
        () =>
          client.query(
            `INSERT INTO production_record (
               id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
               batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
             ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,$4,FALSE,FALSE,10,0,NOW(),'OPERATOR_MANUAL',$5)`,
            [recId, PILOT_TENANT, woDirectId, batch1Id, `evt-${recId}`]
          ),
        'T4: non-batch WO must reject NOT NULL batch_id'
      );
    });

    // T5: Insert record with batch belonging to another WO -> Rejected
    await sub.test('T5: Insert record with batch belonging to another WO -> REJECTED', async () => {
      const recId = `rec-t5-${testSuffix}`;
      await assertThrowsPgError(
        () =>
          client.query(
            `INSERT INTO production_record (
               id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
               batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
             ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,$4,TRUE,FALSE,10,0,NOW(),'OPERATOR_MANUAL',$5)`,
            [recId, PILOT_TENANT, woBatchId, batchOtherId, `evt-${recId}`]
          ),
        'T5: Foreign key fk_prod_record_batch_wo must reject foreign batch_id'
      );
    });

    // T6: Insert record with faked is_batch_managed mismatch -> Rejected
    await sub.test('T6: Insert with faked is_batch_managed mismatch -> REJECTED', async () => {
      const recId = `rec-t6-${testSuffix}`;
      await assertThrowsPgError(
        () =>
          client.query(
            `INSERT INTO production_record (
               id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
               batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
             ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,NULL,TRUE,FALSE,10,0,NOW(),'OPERATOR_MANUAL',$4)`,
            [recId, PILOT_TENANT, woDirectId, `evt-${recId}`]
          ),
        'T6: Composite FK fk_prod_record_wo_exec_mode must reject mismatched is_batch_managed'
      );
    });

    // T7: Flip is_batch_managed on WO without records -> Success
    await sub.test('T7: Flip is_batch_managed on WO without records -> SUCCESS', async () => {
      await client.query('UPDATE work_order SET is_batch_managed = FALSE WHERE id = $1', [woOtherId]);
      const res = await client.query('SELECT is_batch_managed FROM work_order WHERE id = $1', [woOtherId]);
      assert.equal(res.rows[0].is_batch_managed, false);
    });

    // T8: Flip is_batch_managed on WO with records -> Rejected (via cascade + check)
    await sub.test('T8: Flip is_batch_managed on WO with records -> REJECTED', async () => {
      await assertThrowsPgError(
        () => client.query('UPDATE work_order SET is_batch_managed = TRUE WHERE id = $1', [woDirectId]),
        'T8: Changing is_batch_managed on WO with existing record cascades and fails CHECK ck_prod_record_batch_exclusive'
      );
    });

    // T9a: Insert record on parent WO that has children -> Rejected
    await sub.test('T9a: Insert record on parent WO with child -> REJECTED', async () => {
      await woRepo.create(client, {
        id: woParentId,
        tenantId: PILOT_TENANT,
        productionPlanLineId: planLineId,
        woNumber: `WO-PAR-${testSuffix}`,
        productId: 'prod-tire-a',
        processId: 'proc-cutting',
        sequence: 1,
        lineId: 'line-01',
        plannedQuantity: 10000,
        targetQuantity: 10000,
        goodQuantity: 0,
        rejectQuantity: 0,
        unit: 'PCS',
        plannedStart: now,
        plannedEnd: now,
        status: WorkOrderStatus.CONFIRMED,
        priority: 1,
        isBatchManaged: false,
        hasChildWorkOrder: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const recId = `rec-t9a-${testSuffix}`;
      await assertThrowsPgError(
        () =>
          client.query(
            `INSERT INTO production_record (
               id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
               batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
             ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,NULL,FALSE,TRUE,10,0,NOW(),'OPERATOR_MANUAL',$4)`,
            [recId, PILOT_TENANT, woParentId, `evt-${recId}`]
          ),
        'T9a: Parent WO cannot have production records directly (ck_prod_record_not_parent)'
      );
    });

    // T9b: Split WO that already has production records -> Rejected
    await sub.test('T9b: Split WO with existing production records -> REJECTED', async () => {
      await assertThrowsPgError(
        () => client.query('UPDATE work_order SET has_child_work_order = TRUE WHERE id = $1', [woDirectId]),
        'T9b: Setting has_child_work_order = TRUE cascades to production_record and fails ck_prod_record_not_parent'
      );
    });

    // T9c: Child WO DIRECT path receives production records -> Success
    await sub.test('T9c: Child WO DIRECT path receives record -> SUCCESS', async () => {
      await woRepo.create(client, {
        id: woChildDirectId,
        tenantId: PILOT_TENANT,
        productionPlanLineId: planLineId,
        parentWorkOrderId: woParentId,
        woNumber: `WO-CHD-DIR-${testSuffix}`,
        productId: 'prod-tire-a',
        processId: 'proc-cutting',
        sequence: 1,
        lineId: 'line-01',
        plannedQuantity: 6000,
        targetQuantity: 6000,
        goodQuantity: 0,
        rejectQuantity: 0,
        unit: 'PCS',
        plannedStart: now,
        plannedEnd: now,
        status: WorkOrderStatus.SCHEDULED,
        priority: 1,
        isBatchManaged: false,
        hasChildWorkOrder: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const recId = `rec-t9c-${testSuffix}`;
      await client.query(
        `INSERT INTO production_record (
           id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
           batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
         ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,NULL,FALSE,FALSE,50,0,NOW(),'OPERATOR_MANUAL',$4)`,
        [recId, PILOT_TENANT, woChildDirectId, `evt-${recId}`]
      );
      const res = await client.query('SELECT id FROM production_record WHERE id = $1', [recId]);
      assert.equal(res.rows.length, 1);
    });

    // T9d: Child WO BATCH path receives production records -> Success
    await sub.test('T9d: Child WO BATCH path receives record -> SUCCESS', async () => {
      await woRepo.create(client, {
        id: woChildBatchId,
        tenantId: PILOT_TENANT,
        productionPlanLineId: planLineId,
        parentWorkOrderId: woParentId,
        woNumber: `WO-CHD-BAT-${testSuffix}`,
        productId: 'prod-tire-a',
        processId: 'proc-cutting',
        sequence: 1,
        lineId: 'line-01',
        plannedQuantity: 4000,
        targetQuantity: 4000,
        goodQuantity: 0,
        rejectQuantity: 0,
        unit: 'PCS',
        plannedStart: now,
        plannedEnd: now,
        status: WorkOrderStatus.SCHEDULED,
        priority: 1,
        isBatchManaged: true,
        hasChildWorkOrder: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      await batchRepo.create(client, {
        id: batchChildId,
        tenantId: PILOT_TENANT,
        batchNumber: `B-CHD-${testSuffix}`,
        workOrderId: woChildBatchId,
        productId: 'prod-tire-a',
        processId: 'proc-cutting',
        sequence: 1,
        plannedQuantity: 4000,
        inputQuantity: 0,
        outputQuantity: 0,
        rejectQuantity: 0,
        scrapQuantity: 0,
        reworkQuantity: 0,
        transferredQuantity: 0,
        status: ProductionBatchStatus.PLANNED,
        productionDate: now.slice(0, 10),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const recId = `rec-t9d-${testSuffix}`;
      await client.query(
        `INSERT INTO production_record (
           id, tenant_id, work_order_id, machine_id, operator_id, shift_id, shift_date,
           batch_id, is_batch_managed, has_child_work_order, good_quantity, reject_quantity, recorded_at, source, client_event_id
         ) VALUES ($1,$2,$3,'mc-mix-01','op-001','shift-1',CURRENT_DATE,$4,TRUE,FALSE,30,0,NOW(),'OPERATOR_MANUAL',$5)`,
        [recId, PILOT_TENANT, woChildBatchId, batchChildId, `evt-${recId}`]
      );
      const res = await client.query('SELECT id FROM production_record WHERE id = $1', [recId]);
      assert.equal(res.rows.length, 1);
    });

    // Clean up
    await client.query(`DELETE FROM production_record WHERE work_order_id LIKE 'wo-t-%'`);
    await client.query(`DELETE FROM production_batch WHERE id LIKE 'bat-t-%'`);
    await client.query(`DELETE FROM work_order WHERE id LIKE 'wo-t-%'`);
  });

  await t.test('MES-004: Customer & Demand Schema', async () => {
    const custId = `cust-t-${Date.now()}`;
    const orderId = `co-t-${Date.now()}`;
    const lineId = `col-t-${Date.now()}`;

    // 1. Insert Customer
    await client.query(
      `INSERT INTO customer (id, tenant_id, code, name, status)
       VALUES ($1, $2, 'CUST-TEST-01', 'PT Test Customer', 'ACTIVE')`,
      [custId, PILOT_TENANT]
    );

    // 2. Insert Customer Order
    await client.query(
      `INSERT INTO customer_order (id, tenant_id, order_number, customer_id, order_channel, order_date, requested_delivery_date, status)
       VALUES ($1, $2, 'CO-TEST-001', $3, 'KANBAN_CARD', CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', 'RECEIVED')`,
      [orderId, PILOT_TENANT, custId]
    );

    // 3. Insert Customer Order Line
    await client.query(
      `INSERT INTO customer_order_line (id, tenant_id, customer_order_id, product_id, ordered_quantity, planned_quantity, line_no)
       VALUES ($1, $2, $3, 'prod-tire-a', 500, 200, 1)`,
      [lineId, PILOT_TENANT, orderId]
    );

    // Verify planned <= ordered constraint
    await assertThrowsPgError(
      () =>
        client.query(
          `INSERT INTO customer_order_line (id, tenant_id, customer_order_id, product_id, ordered_quantity, planned_quantity, line_no)
           VALUES ($1, $2, $3, 'prod-tire-a', 500, 600, 2)`,
          [`col-invalid-${Date.now()}`, PILOT_TENANT, orderId]
        ),
      'planned_quantity cannot exceed ordered_quantity'
    );

    // Clean up
    await client.query(`DELETE FROM customer_order_line WHERE id = $1`, [lineId]);
    await client.query(`DELETE FROM customer_order WHERE id = $1`, [orderId]);
    await client.query(`DELETE FROM customer WHERE id = $1`, [custId]);
  });

  await t.test('MES-005: Planning Schema', async () => {
    const dfId = `df-t-${Date.now()}`;
    const cpId = `cp-t-${Date.now()}`;
    const ppId = `pp-t-${Date.now()}`;
    const pplId = `ppl-t-${Date.now()}`;
    const curId = `cur-t-${Date.now()}`;

    // 1. Demand Forecast
    await client.query(
      `INSERT INTO demand_forecast (id, tenant_id, forecast_number, period_start, period_end, status)
       VALUES ($1, $2, 'DF-TEST-001', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'DRAFT')`,
      [dfId, PILOT_TENANT]
    );

    // 2. Capacity Plan
    await client.query(
      `INSERT INTO capacity_plan (id, tenant_id, plan_number, period_start, period_end, status)
       VALUES ($1, $2, 'CP-TEST-001', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'DRAFT')`,
      [cpId, PILOT_TENANT]
    );

    // 3. Production Plan
    await client.query(
      `INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, demand_forecast_id, capacity_plan_id, status)
       VALUES ($1, $2, 'PP-TEST-001', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', $3, $4, 'DRAFT')`,
      [ppId, PILOT_TENANT, dfId, cpId]
    );

    // 4. Production Plan Line
    await client.query(
      `INSERT INTO production_plan_line (id, tenant_id, production_plan_id, product_id, planned_quantity)
       VALUES ($1, $2, $3, 'prod-tire-a', 2000)`,
      [pplId, PILOT_TENANT, ppId]
    );

    // 5. Capacity Up Request
    await client.query(
      `INSERT INTO capacity_up_request (id, tenant_id, request_number, production_plan_id, capacity_gap, response_type, reason, requested_by)
       VALUES ($1, $2, 'CUR-TEST-001', $3, 200, 'OVERTIME', 'High demand peak', 'user-ppic-01')`,
      [curId, PILOT_TENANT, ppId]
    );

    // Clean up
    await client.query(`DELETE FROM capacity_up_request WHERE id = $1`, [curId]);
    await client.query(`DELETE FROM production_plan_line WHERE id = $1`, [pplId]);
    await client.query(`DELETE FROM production_plan WHERE id = $1`, [ppId]);
    await client.query(`DELETE FROM capacity_plan WHERE id = $1`, [cpId]);
    await client.query(`DELETE FROM demand_forecast WHERE id = $1`, [dfId]);
  });

  await t.test('MES-006: Mold & Compatibility Master', async () => {
    const moldId = `mold-t-${Date.now()}`;
    const compatId = `pmc-t-${Date.now()}`;

    // 1. Insert Mold
    await client.query(
      `INSERT INTO mold (id, tenant_id, code, name, cavity_count, status)
       VALUES ($1, $2, 'MOLD-PCR-15-A', 'Mold Passenger Car 15 A', 2, 'AVAILABLE')`,
      [moldId, PILOT_TENANT]
    );

    // 2. Insert Product-Mold Compatibility
    await client.query(
      `INSERT INTO product_mold_compatibility (id, tenant_id, product_id, mold_id, active)
       VALUES ($1, $2, 'prod-tire-a', $3, true)`,
      [compatId, PILOT_TENANT, moldId]
    );

    // Verify unique product-mold compatibility
    await assertThrowsPgError(
      () =>
        client.query(
          `INSERT INTO product_mold_compatibility (id, tenant_id, product_id, mold_id, active)
           VALUES ($1, $2, 'prod-tire-a', $3, true)`,
          [`pmc-dup-${Date.now()}`, PILOT_TENANT, moldId]
        ),
      'Duplicate product-mold compatibility must be rejected'
    );

    // Clean up
    await client.query(`DELETE FROM product_mold_compatibility WHERE id = $1`, [compatId]);
    await client.query(`DELETE FROM mold WHERE id = $1`, [moldId]);
  });

  await t.test('MES-007: Database Indexes Present', async () => {
    const res = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const indexes = new Set(res.rows.map((r) => r.indexname));

    assert.ok(indexes.has('idx_customer_order_unique'));
    assert.ok(indexes.has('idx_production_plan_unique'));
    assert.ok(indexes.has('idx_production_plan_line_lookup'));
    assert.ok(indexes.has('idx_work_order_plan_line'));
    assert.ok(indexes.has('idx_work_order_generate_idempotency'));
    assert.ok(indexes.has('idx_production_batch_num'));
    assert.ok(indexes.has('idx_production_batch_wo_seq'));
    assert.ok(indexes.has('idx_product_mold_compat_unique'));
  });

  await t.test('MES-008: Migration Tracking Baseline', async () => {
    const res = await client.query<{ version: string }>(
      `SELECT version FROM schema_migrations ORDER BY version ASC`
    );
    const versions = res.rows.map((r) => r.version);

    assert.ok(versions.includes('001_initial_schema.sql'));
    assert.ok(versions.includes('002_platform_rbac_oee.sql'));
    assert.ok(versions.includes('003_client_management.sql'));
    assert.ok(versions.includes('004_app_role_rls.sql'));
    assert.ok(versions.includes('005_mes_v1_work_order.sql'));
    assert.ok(versions.includes('006_mes_v1_customer_demand.sql'));
    assert.ok(versions.includes('007_mes_v1_planning_schema.sql'));
    assert.ok(versions.includes('008_mes_v1_mold_compatibility.sql'));
    assert.ok(versions.includes('009_mes_v1_indexes.sql'));
  });

  await client.end();
});
