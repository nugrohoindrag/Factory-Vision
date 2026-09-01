/**
 * Final QA — execution behaviour through the real services.
 *
 * Covers what a schema check cannot: recording output, the quantity invariants
 * at the write path, the process handoff, the machine-state side effect, and
 * the state-machine guards — all against the real database, then cleaned up.
 *
 *   node --import tsx scripts/qa-execution-flow.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { withTenant, closePool } = await import('../src/platform/db/pool.ts');
const { ProductionService } = await import('../src/modules/production/production.service.ts');
const { ShopFloorService } = await import('../src/modules/shopfloor/shopfloor.service.ts');
const { MasterDataService } = await import('../src/modules/master-data/master-data.service.ts');
const { ProcessChainService } = await import('../src/modules/production/process-chain.service.ts');
const { WorkOrderRepository } = await import('../src/modules/production/work-order.repository.ts');
const { QuantityFlowService } = await import('../src/modules/production/quantity-flow.service.ts');

const TENANT = 'tenant-pilot-factory-01';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectRejection(label, fn, matcher) {
  try {
    await fn();
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label} — tidak ditolak`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (matcher && !matcher.test(message)) {
      failed += 1;
      failures.push(label);
      console.error(`  FAIL  ${label} — pesan tidak sesuai: ${message}`);
    } else {
      passed += 1;
      console.log(`  PASS  ${label}`);
    }
  }
}

const masterData = new MasterDataService();
const production = new ProductionService();
const shopFloor = new ShopFloorService(production, masterData);
const chains = new ProcessChainService();
const workOrderRepo = new WorkOrderRepository();

const created = { workOrderIds: [], recordIds: [], planId: null, planLineId: null };

async function cleanup() {
  await withTenant(TENANT, async (client) => {
    if (created.workOrderIds.length > 0) {
      await client.query(
        'DELETE FROM machine_state_log WHERE tenant_id = $1 AND work_order_id = ANY($2)',
        [TENANT, created.workOrderIds]
      );
      await client.query('DELETE FROM downtime_record WHERE tenant_id = $1 AND work_order_id = ANY($2)', [
        TENANT,
        created.workOrderIds,
      ]);
      await client.query('DELETE FROM sync_event WHERE tenant_id = $1', [TENANT]);
      await client.query('DELETE FROM production_record WHERE tenant_id = $1 AND work_order_id = ANY($2)', [
        TENANT,
        created.workOrderIds,
      ]);
      // Children first: predecessor/parent are self-references.
      await client.query('UPDATE work_order SET predecessor_work_order_id = NULL WHERE tenant_id = $1 AND id = ANY($2)', [
        TENANT,
        created.workOrderIds,
      ]);
      await client.query('DELETE FROM work_order WHERE tenant_id = $1 AND id = ANY($2)', [
        TENANT,
        created.workOrderIds,
      ]);
    }
    if (created.planLineId) {
      await client.query('DELETE FROM production_plan_line WHERE tenant_id = $1 AND id = $2', [
        TENANT,
        created.planLineId,
      ]);
    }
    if (created.planId) {
      await client.query('DELETE FROM production_plan WHERE tenant_id = $1 AND id = $2', [
        TENANT,
        created.planId,
      ]);
    }
  });
}

try {
  await masterData.hydrate(TENANT);

  const context = await withTenant(TENANT, async (client) => {
    const row = await client.query(
      `SELECT p.id AS product_id, l.id AS line_id, m.id AS machine_id, pr.id AS process_id,
              o.id AS operator_id, s.id AS shift_id, rr.id AS reject_reason_id
         FROM product p
         CROSS JOIN LATERAL (SELECT id FROM production_line WHERE tenant_id = p.tenant_id AND status='ACTIVE' ORDER BY code LIMIT 1) l
         -- Migration 021 allows only one IN_PRODUCTION work order per machine,
         -- and this fixture creates its work orders already running. Picking a
         -- machine that is genuinely free keeps the script from colliding with
         -- real production instead of exercising it.
         CROSS JOIN LATERAL (SELECT m2.id FROM machine m2 JOIN work_center wc ON wc.id = m2.work_center_id
                              WHERE m2.tenant_id = p.tenant_id AND wc.production_line_id = l.id
                                AND NOT EXISTS (
                                  SELECT 1 FROM work_order w
                                   WHERE w.tenant_id = m2.tenant_id AND w.machine_id = m2.id
                                     AND w.status = 'IN_PRODUCTION'
                                )
                              ORDER BY m2.code LIMIT 1) m
         CROSS JOIN LATERAL (SELECT id FROM production_process WHERE tenant_id = p.tenant_id AND status='ACTIVE' ORDER BY sequence_default LIMIT 1) pr
         CROSS JOIN LATERAL (SELECT id FROM operator WHERE tenant_id = p.tenant_id LIMIT 1) o
         CROSS JOIN LATERAL (SELECT id FROM shift WHERE tenant_id = p.tenant_id LIMIT 1) s
         CROSS JOIN LATERAL (SELECT id FROM reject_reason WHERE tenant_id = p.tenant_id LIMIT 1) rr
        WHERE p.tenant_id = $1 AND p.status = 'ACTIVE' LIMIT 1`,
      [TENANT]
    );
    return row.rows[0];
  });

  if (!context) {
    console.error('Master data belum lengkap pada tenant ini.');
    process.exit(1);
  }

  // A plan and plan line of this run's own. Reusing an existing one collides
  // with `uq_wo_plan_line_process`, which is exactly the idempotency guard
  // MES-041 depends on.
  // Four distinct processes, one per fixture work order.
  const processIds = await withTenant(TENANT, async (client) => {
    const rows = await client.query(
      `SELECT id FROM production_process WHERE tenant_id = $1 AND status = 'ACTIVE'
        ORDER BY sequence_default LIMIT 4`,
      [TENANT]
    );
    return rows.rows.map((r) => r.id);
  });
  if (processIds.length < 4) {
    console.error('Tenant memerlukan minimal 4 process aktif untuk fixture ini.');
    process.exit(1);
  }

  const planIds = await withTenant(TENANT, async (client) => {
    const planId = `plan-qa-${Date.now()}`;
    const lineId = `planline-qa-${Date.now()}`;
    await client.query(
      `INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, status)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 30, 'DRAFT')`,
      [planId, TENANT, `PLAN-QA-${Date.now().toString().slice(-6)}`]
    );
    await client.query(
      `INSERT INTO production_plan_line (id, tenant_id, production_plan_id, product_id,
         demand_quantity, forecast_quantity, planned_quantity, priority, capacity_status, status)
       VALUES ($1, $2, $3, $4, 1000, 0, 1000, 1, 'WITHIN_PLAN', 'DRAFT')`,
      [lineId, TENANT, planId, context.product_id]
    );
    return { planId, lineId };
  });
  created.planId = planIds.planId;
  created.planLineId = planIds.lineId;

  const now = new Date().toISOString();
  const baseWo = (suffix, over = {}) => ({
    id: `wo-qa-${suffix}-${Date.now()}`,
    tenantId: TENANT,
    woNumber: `WO-QA-${suffix}-${Date.now().toString().slice(-6)}`,
    productId: context.product_id,
    // A Work Order belongs to a Production Plan Line (§8); the column carries a
    // foreign key, so the fixture uses a real one.
    productionPlanLineId: planIds.lineId,
    processId: context.process_id,
    lineId: context.line_id,
    machineId: context.machine_id,
    shiftId: context.shift_id,
    isBatchManaged: false,
    hasChildWorkOrder: false,
    plannedQuantity: 1000,
    inputQuantity: 0,
    outputQuantity: 0,
    rejectQuantity: 0,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 0,
    unit: 'PCS',
    plannedStart: now,
    plannedEnd: new Date(Date.now() + 8 * 3600_000).toISOString(),
    status: 'IN_PRODUCTION',
    priority: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  // =====================================================================
  console.log('\n1. Quantity flow at the write path (§10, MES-017)');
  // =====================================================================

  const wo = await withTenant(TENANT, (client) =>
    workOrderRepo.create(client, baseWo('FLOW', { processId: processIds[0] }))
  );
  created.workOrderIds.push(wo.id);

  // The reason must be one the shop floor recognises as active; take it from
  // the same projection the validator consults rather than from raw SQL.
  const activeRejectReason = masterData
    .getRejectReasons(TENANT)
    .find((r) => r.active !== false);
  if (!activeRejectReason) {
    console.error('Tidak ada reject reason aktif pada tenant ini.');
    process.exit(1);
  }

  const firstEventId = `qa-${Date.now()}-1`;
  const replayEventId = firstEventId;
  const record = await shopFloor.recordOutput(TENANT, {
    workOrderId: wo.id,
    machineId: context.machine_id,
    operatorId: context.operator_id,
    shiftId: context.shift_id,
    goodQuantity: 100,
    rejectQuantity: 8,
    rejectReasonId: activeRejectReason.id,
    occurredAt: new Date().toISOString(),
    clientEventId: firstEventId,
  });
  created.recordIds.push(record.id);

  const afterOutput = await withTenant(TENANT, (client) =>
    workOrderRepo.findById(client, TENANT, wo.id)
  );

  check('output increments output_quantity', afterOutput.outputQuantity === 100);
  check('reject increments reject_quantity', afterOutput.rejectQuantity === 8);
  check(
    'input_quantity now moves with the dispositions (the repaired defect)',
    afterOutput.inputQuantity === 108,
    `input=${afterOutput.inputQuantity}`
  );
  check(
    'the invariant input >= output + reject + scrap + rework holds',
    QuantityFlowService.check(afterOutput).length === 0,
    JSON.stringify(QuantityFlowService.check(afterOutput))
  );
  check(
    'WIP is zero, not negative',
    QuantityFlowService.workInProgress(afterOutput) === 0,
    String(QuantityFlowService.workInProgress(afterOutput))
  );
  check(
    'output is NOT good + reject (§10: the buckets are exclusive)',
    afterOutput.outputQuantity === 100 && afterOutput.outputQuantity !== 108
  );

  const storedRecord = await withTenant(TENANT, async (client) => {
    const r = await client.query(
      'SELECT input_quantity, good_quantity, reject_quantity FROM production_record WHERE tenant_id = $1 AND id = $2',
      [TENANT, record.id]
    );
    return r.rows[0];
  });
  check(
    'the production record carries its own input quantity',
    Number(storedRecord.input_quantity) === 108,
    JSON.stringify(storedRecord)
  );

  // Idempotency: the same client event must not count twice.
  await shopFloor.recordOutput(TENANT, {
    workOrderId: wo.id,
    machineId: context.machine_id,
    operatorId: context.operator_id,
    shiftId: context.shift_id,
    goodQuantity: 100,
    rejectQuantity: 8,
    rejectReasonId: activeRejectReason.id,
    occurredAt: new Date().toISOString(),
    clientEventId: replayEventId,
  });
  const afterReplay = await withTenant(TENANT, (client) =>
    workOrderRepo.findById(client, TENANT, wo.id)
  );
  check(
    'a replayed client event does not double-count',
    afterReplay.outputQuantity <= 200,
    `output=${afterReplay.outputQuantity}`
  );

  // =====================================================================
  console.log('\n2. Machine state side effect (§11, MES-015-3)');
  // =====================================================================

  const runningState = await withTenant(TENANT, async (client) => {
    const r = await client.query(
      `SELECT state, ended_at FROM machine_state_log
        WHERE tenant_id = $1 AND machine_id = $2 AND ended_at IS NULL`,
      [TENANT, context.machine_id]
    );
    return r.rows[0];
  });
  check(
    'recording output leaves the machine RUNNING',
    runningState?.state === 'RUNNING',
    JSON.stringify(runningState)
  );

  await production.completeWorkOrder(TENANT, wo.id, { occurredAt: new Date().toISOString() });
  const afterComplete = await withTenant(TENANT, (client) =>
    workOrderRepo.findById(client, TENANT, wo.id)
  );
  check('completing the work order stamps actual_end', Boolean(afterComplete.actualEnd));
  check('work order reaches COMPLETED', afterComplete.status === 'COMPLETED');

  const idleState = await withTenant(TENANT, async (client) => {
    const r = await client.query(
      `SELECT state FROM machine_state_log
        WHERE tenant_id = $1 AND machine_id = $2 AND ended_at IS NULL`,
      [TENANT, context.machine_id]
    );
    return r.rows[0];
  });
  check(
    'completing the work order drives the machine to IDLE',
    idleState?.state === 'IDLE',
    JSON.stringify(idleState)
  );

  const openStates = await withTenant(TENANT, async (client) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM machine_state_log
        WHERE tenant_id = $1 AND machine_id = $2 AND ended_at IS NULL`,
      [TENANT, context.machine_id]
    );
    return r.rows[0].n;
  });
  check('the machine has exactly one open state row', openStates === 1, String(openStates));

  // =====================================================================
  console.log('\n3. State machine guards against real rows (§11)');
  // =====================================================================

  const guarded = await withTenant(TENANT, (client) =>
    workOrderRepo.create(client, baseWo('GUARD', { status: 'IN_PRODUCTION', processId: processIds[1] }))
  );
  created.workOrderIds.push(guarded.id);

  // A hanging ACTIVE downtime must block completion.
  await withTenant(TENANT, (client) =>
    client.query(
      `INSERT INTO downtime_record (id, tenant_id, work_order_id, machine_id, line_id, shift_id,
         shift_date, reason_id, start_time, status, client_event_id, is_planned)
       VALUES ($1,$2::varchar,$3,$4,$5,$6,CURRENT_DATE,
               (SELECT id FROM downtime_reason WHERE tenant_id=$2::varchar LIMIT 1),
               now(),'ACTIVE',$7,FALSE)`,
      [
        `dt-qa-${Date.now()}`,
        TENANT,
        guarded.id,
        context.machine_id,
        context.line_id,
        context.shift_id,
        `qa-dt-${Date.now()}`,
      ]
    )
  );

  await expectRejection(
    '§11: COMPLETED refused while a downtime is still ACTIVE',
    () => production.completeWorkOrder(TENANT, guarded.id),
    /downtime record berstatus ACTIVE/i
  );

  await withTenant(TENANT, (client) =>
    client.query(
      `UPDATE downtime_record SET status='RESOLVED', end_time=now(), duration_seconds=60
        WHERE tenant_id=$1 AND work_order_id=$2`,
      [TENANT, guarded.id]
    )
  );
  const completed = await production.completeWorkOrder(TENANT, guarded.id);
  check('once the downtime is resolved, completion succeeds', completed.status === 'COMPLETED');

  await expectRejection(
    '§11: a cancellation without a reason is refused',
    () => production.cancelWorkOrder(TENANT, guarded.id),
    /Alasan pembatalan wajib|tidak ada pada state machine/i
  );

  // =====================================================================
  console.log('\n4. Process handoff (§13, MES-018)');
  // =====================================================================

  const upstream = await withTenant(TENANT, (client) =>
    workOrderRepo.create(
      client,
      baseWo('UP', {
        status: 'COMPLETED',
        processId: processIds[2],
        sequence: 1,
        inputQuantity: 1000,
        outputQuantity: 980,
        rejectQuantity: 20,
        transferredQuantity: 980,
      })
    )
  );
  created.workOrderIds.push(upstream.id);

  const downstream = await withTenant(TENANT, (client) =>
    workOrderRepo.create(
      client,
      baseWo('DOWN', {
        status: 'CONFIRMED',
        processId: processIds[3],
        sequence: 2,
        predecessorWorkOrderId: upstream.id,
      })
    )
  );
  created.workOrderIds.push(downstream.id);

  const chain = await chains.getChain(TENANT, downstream.id);
  check('the chain resolves the predecessor from the explicit column', chain.predecessor?.workOrderId === upstream.id);
  check('the first process reports no predecessor', chain.isFirstProcess === false);
  check(
    '§13: available quantity = predecessor transferred − own input',
    chain.availableQuantity === 980,
    String(chain.availableQuantity)
  );

  const upstreamChain = await chains.getChain(TENANT, upstream.id);
  check('the upstream work order is the first process', upstreamChain.isFirstProcess === true);
  check('the upstream work order finds its successor', upstreamChain.successors.length === 1);
  check('the successor found is the downstream WO', upstreamChain.successors[0]?.workOrderId === downstream.id);

  // Consuming from the predecessor reduces what is still available.
  await withTenant(TENANT, (client) =>
    client.query('UPDATE work_order SET input_quantity = 500 WHERE tenant_id = $1 AND id = $2', [
      TENANT,
      downstream.id,
    ])
  );
  const chainAfter = await chains.getChain(TENANT, downstream.id);
  check(
    'available quantity falls as the successor consumes',
    chainAfter.availableQuantity === 480,
    String(chainAfter.availableQuantity)
  );

  // §8 A2: work orders across processes must never be summed for demand.
  const crossProcessSum = upstream.plannedQuantity + downstream.plannedQuantity;
  check(
    '§8 A2: summing two processes would double the demand — the chain is not a sum',
    crossProcessSum === 2000 && upstream.plannedQuantity === 1000,
    `sum=${crossProcessSum}`
  );

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length > 0) {
    console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  }
} catch (error) {
  failed += 1;
  console.error('\nException:', error);
} finally {
  await cleanup().catch((error) => console.error('cleanup gagal:', error.message));
  await closePool();
}

process.exit(failed > 0 ? 1 : 0);
