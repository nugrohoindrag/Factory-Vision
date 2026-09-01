import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';
import { WorkOrderStatus } from '@factory-vision/domain-types';
import { WorkOrderStateMachine } from '../src/modules/production/work-order.state-machine.js';
import { WorkOrderRepository } from '../src/modules/production/work-order.repository.js';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://factory:factory@localhost:5432/factory_vision';
const PILOT_TENANT = 'tenant-pilot-factory-01';

test('MES-001: Work Order Data Model Verification', async (t) => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const repo = new WorkOrderRepository();

  await t.test('MES-001-1: Column structure and schema verification', async () => {
    const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'work_order'`
    );
    const columns = new Map(result.rows.map((r) => [r.column_name, r]));

    // 1. Process-level & planning reference
    assert.ok(columns.has('production_plan_line_id'), 'production_plan_line_id column must exist');
    assert.ok(columns.has('routing_id'), 'routing_id column must exist');
    assert.ok(columns.has('process_id'), 'process_id column must exist');
    assert.ok(columns.has('sequence'), 'sequence column must exist');

    // 2. Parent / child & predecessor hierarchy
    assert.ok(columns.has('parent_work_order_id'), 'parent_work_order_id column must exist');
    assert.ok(columns.has('predecessor_work_order_id'), 'predecessor_work_order_id column must exist');

    // 3. Batch mode
    assert.ok(columns.has('is_batch_managed'), 'is_batch_managed column must exist');
    assert.equal(columns.get('is_batch_managed')?.data_type, 'boolean');

    // 4. Resource assignments
    assert.ok(columns.has('mold_id'), 'mold_id column must exist');
    assert.ok(columns.has('shift_id'), 'shift_id column must exist');
    assert.ok(columns.has('machine_id'), 'machine_id column must exist');
    assert.ok(columns.has('line_id'), 'line_id column must exist');

    // 5. 7 Quantity flow columns
    assert.ok(columns.has('planned_quantity'), 'planned_quantity column must exist');
    assert.ok(columns.has('input_quantity'), 'input_quantity column must exist');
    assert.ok(columns.has('output_quantity'), 'output_quantity column must exist');
    assert.ok(columns.has('reject_quantity'), 'reject_quantity column must exist');
    assert.ok(columns.has('scrap_quantity'), 'scrap_quantity column must exist');
    assert.ok(columns.has('rework_quantity'), 'rework_quantity column must exist');
    assert.ok(columns.has('transferred_quantity'), 'transferred_quantity column must exist');

    // 6. Confirmation columns
    assert.ok(columns.has('confirmed_by'), 'confirmed_by column must exist');
    assert.ok(columns.has('confirmed_at'), 'confirmed_at column must exist');

    // 7. Decoupled demand: Work order must NOT store direct customer or allocation columns
    assert.ok(!columns.has('customer_id'), 'work_order must NOT have direct customer_id');
    assert.ok(!columns.has('customer_order_id'), 'work_order must NOT have direct customer_order_id');
    assert.ok(!columns.has('allocated_quantity'), 'work_order must NOT have allocated_quantity');
  });

  await t.test('MES-001-2: Unique constraint on (id, is_batch_managed) for MES-003 FK support', async () => {
    const res = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'uq_wo_batch_mode'`
    );
    assert.equal(res.rows.length, 1, 'uq_wo_batch_mode constraint must exist');
  });

  await t.test('MES-001-3: Work Order creation with process hierarchy and quantity flow', async () => {
    const now = new Date().toISOString();
    const woParentId = `wo-test-parent-${Date.now()}`;
    const woSuccessorId = `wo-test-succ-${Date.now()}`;
    const woChildId = `wo-test-child-${Date.now()}`;

    // Sprint 2 (§22 step 15) made production_plan_line_id mandatory, so these
    // fixtures need a plan line to belong to.
    const planId = `plan-m1-${Date.now()}`;
    const planLineId = `planline-m1-${Date.now()}`;
    await client.query(
      `INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, status)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 7, 'CONFIRMED')
       ON CONFLICT (id) DO NOTHING`,
      [planId, PILOT_TENANT, `PLAN-M1-${Date.now()}`]
    );
    await client.query(
      `INSERT INTO production_plan_line
         (id, tenant_id, production_plan_id, product_id, demand_quantity, planned_quantity)
       VALUES ($1, $2, $3, 'prod-tire-a', 1000, 1000)
       ON CONFLICT (id) DO NOTHING`,
      [planLineId, PILOT_TENANT, planId]
    );

    // Clean up if existing
    await client.query('DELETE FROM work_order WHERE id IN ($1, $2, $3)', [
      woParentId,
      woSuccessorId,
      woChildId,
    ]);

    // 1. Create parent Work Order (Process 1: Mixing)
    const parentWo = await repo.create(client, {
      id: woParentId,
      tenantId: PILOT_TENANT,
      productionPlanLineId: planLineId,
      woNumber: `WO-TEST-MIX-01`,
      productId: 'prod-tire-a',
      processId: 'proc-mixing',
      sequence: 1,
      isBatchManaged: false,
      lineId: 'line-01',
      plannedQuantity: 1000,
      targetQuantity: 1000,
      inputQuantity: 1050,
      outputQuantity: 950,
      goodQuantity: 950,
      rejectQuantity: 30,
      scrapQuantity: 10,
      reworkQuantity: 20,
      transferredQuantity: 950,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
      status: WorkOrderStatus.CONFIRMED,
      priority: 1,
      confirmedBy: 'user-supervisor-01',
      confirmedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(parentWo.id, woParentId);
    assert.equal(parentWo.plannedQuantity, 1000);
    assert.equal(parentWo.isBatchManaged, false);
    assert.equal(parentWo.status, WorkOrderStatus.CONFIRMED);
    assert.equal(parentWo.transferredQuantity, 950);

    // 2. Create Successor Work Order (Process 2: Building, Predecessor = parentWo.id)
    const successorWo = await repo.create(client, {
      id: woSuccessorId,
      tenantId: PILOT_TENANT,
      productionPlanLineId: planLineId,
      predecessorWorkOrderId: parentWo.id,
      woNumber: `WO-TEST-BLD-01`,
      productId: 'prod-tire-a',
      processId: 'proc-building',
      sequence: 2,
      isBatchManaged: true,
      lineId: 'line-01',
      plannedQuantity: 950,
      targetQuantity: 950,
      goodQuantity: 0,
      rejectQuantity: 0,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
      status: WorkOrderStatus.SCHEDULED,
      priority: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(successorWo.predecessorWorkOrderId, parentWo.id);
    assert.equal(successorWo.isBatchManaged, true);

    // 3. Create Split Child Work Order (Parent = parentWo.id)
    const childWo = await repo.create(client, {
      id: woChildId,
      tenantId: PILOT_TENANT,
      productionPlanLineId: planLineId,
      parentWorkOrderId: parentWo.id,
      woNumber: `WO-TEST-MIX-01-A`,
      productId: 'prod-tire-a',
      processId: 'proc-mixing',
      sequence: 1,
      isBatchManaged: false,
      lineId: 'line-01',
      plannedQuantity: 600,
      targetQuantity: 600,
      goodQuantity: 0,
      rejectQuantity: 0,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      status: WorkOrderStatus.SCHEDULED,
      priority: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(childWo.parentWorkOrderId, parentWo.id);

    // 4. Test quantity incrementation
    const updatedWo = await repo.incrementQuantities(client, PILOT_TENANT, woParentId, 50, 5, {
      scrap: 2,
      rework: 3,
      transferred: 50,
    });

    assert.ok(updatedWo);
    assert.equal(updatedWo.goodQuantity, 1000);
    assert.equal(updatedWo.rejectQuantity, 35);
    assert.equal(updatedWo.scrapQuantity, 12);
    assert.equal(updatedWo.reworkQuantity, 23);
    assert.equal(updatedWo.transferredQuantity, 1000);

    // Clean up
    await client.query('DELETE FROM work_order WHERE id IN ($1, $2, $3)', [
      woChildId,
      woSuccessorId,
      woParentId,
    ]);
  });

  await t.test('MES-001-4: Work Order State Machine Transitions', () => {
    // Valid lifecycle
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED));
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.SCHEDULED, WorkOrderStatus.CONFIRMED));
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.CONFIRMED, WorkOrderStatus.IN_PRODUCTION));
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.IN_PRODUCTION, WorkOrderStatus.COMPLETED));

    // Invalid transitions
    assert.ok(!WorkOrderStateMachine.canTransition(WorkOrderStatus.DRAFT, WorkOrderStatus.IN_PRODUCTION));
    assert.ok(!WorkOrderStateMachine.canTransition(WorkOrderStatus.COMPLETED, WorkOrderStatus.DRAFT));
    assert.ok(!WorkOrderStateMachine.canTransition(WorkOrderStatus.COMPLETED, WorkOrderStatus.IN_PRODUCTION));

    // Cancellation
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.DRAFT, WorkOrderStatus.CANCELLED));
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.SCHEDULED, WorkOrderStatus.CANCELLED));
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.CONFIRMED, WorkOrderStatus.CANCELLED));
    assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.IN_PRODUCTION, WorkOrderStatus.CANCELLED));
  });

  await client.end();
});
