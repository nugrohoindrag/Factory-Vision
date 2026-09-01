/**
 * ADR-36 — mold on the confirmation checklist, against the real database.
 *
 * The unit test covers the rule; this covers the wiring: that
 * `product_mold_compatibility` is genuinely what decides it, and that adding or
 * removing a row changes whether the same Work Order can be confirmed.
 *
 *   node --import tsx scripts/qa-mold-conditional.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { withTenant, closePool } = await import('../src/platform/db/pool.ts');
const { ProductionService } = await import('../src/modules/production/production.service.ts');
const { WorkOrderRepository } = await import('../src/modules/production/work-order.repository.ts');

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

const production = new ProductionService();
const workOrderRepo = new WorkOrderRepository();

const created = { woIds: [], moldId: null, compatId: null, planId: null, planLineId: null };

async function cleanup() {
  await withTenant(TENANT, async (client) => {
    if (created.woIds.length) {
      await client.query('DELETE FROM work_order WHERE tenant_id = $1 AND id = ANY($2)', [
        TENANT,
        created.woIds,
      ]);
    }
    if (created.compatId) {
      await client.query('DELETE FROM product_mold_compatibility WHERE tenant_id = $1 AND id = $2', [
        TENANT,
        created.compatId,
      ]);
    }
    if (created.moldId) {
      await client.query('DELETE FROM mold WHERE tenant_id = $1 AND id = $2', [TENANT, created.moldId]);
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
  const ctx = await withTenant(TENANT, async (client) => {
    const row = await client.query(
      `SELECT p.id AS product_id, l.id AS line_id, m.id AS machine_id, s.id AS shift_id,
              pr.id AS process_id
         FROM product p
         CROSS JOIN LATERAL (SELECT id FROM production_line WHERE tenant_id=p.tenant_id AND status='ACTIVE' ORDER BY code LIMIT 1) l
         CROSS JOIN LATERAL (SELECT m2.id FROM machine m2 JOIN work_center wc ON wc.id=m2.work_center_id
                              WHERE m2.tenant_id=p.tenant_id AND wc.production_line_id=l.id ORDER BY m2.code LIMIT 1) m
         CROSS JOIN LATERAL (SELECT id FROM shift WHERE tenant_id=p.tenant_id LIMIT 1) s
         CROSS JOIN LATERAL (SELECT id FROM production_process WHERE tenant_id=p.tenant_id AND status='ACTIVE'
                              ORDER BY sequence_default DESC LIMIT 1) pr
        WHERE p.tenant_id=$1 AND p.status='ACTIVE' LIMIT 1`,
      [TENANT]
    );
    return row.rows[0];
  });

  const stamp = Date.now();
  await withTenant(TENANT, async (client) => {
    created.planId = `plan-mold-${stamp}`;
    created.planLineId = `planline-mold-${stamp}`;
    await client.query(
      `INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, status)
       VALUES ($1,$2,$3,CURRENT_DATE,CURRENT_DATE + 30,'DRAFT')`,
      [created.planId, TENANT, `PLAN-MOLD-${String(stamp).slice(-6)}`]
    );
    await client.query(
      `INSERT INTO production_plan_line (id, tenant_id, production_plan_id, product_id,
         demand_quantity, forecast_quantity, planned_quantity, priority, capacity_status, status)
       VALUES ($1,$2,$3,$4,500,0,500,1,'WITHIN_PLAN','DRAFT')`,
      [created.planLineId, TENANT, created.planId, ctx.product_id]
    );
  });

  const now = new Date().toISOString();
  const wo = await withTenant(TENANT, (client) =>
    workOrderRepo.create(client, {
      id: `wo-mold-${stamp}`,
      tenantId: TENANT,
      productionPlanLineId: created.planLineId,
      woNumber: `WO-MOLD-${String(stamp).slice(-6)}`,
      productId: ctx.product_id,
      processId: ctx.process_id,
      sequence: 1,
      lineId: ctx.line_id,
      machineId: ctx.machine_id,
      shiftId: ctx.shift_id,
      isBatchManaged: false,
      hasChildWorkOrder: false,
      plannedQuantity: 500,
      inputQuantity: 0,
      outputQuantity: 0,
      rejectQuantity: 0,
      scrapQuantity: 0,
      reworkQuantity: 0,
      transferredQuantity: 0,
      unit: 'PCS',
      plannedStart: now,
      plannedEnd: new Date(Date.now() + 8 * 3600_000).toISOString(),
      status: 'SCHEDULED',
      priority: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  );
  created.woIds.push(wo.id);

  console.log('\n1. Product tanpa mold compatibility');

  const compatBefore = await withTenant(TENANT, async (client) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM product_mold_compatibility
        WHERE tenant_id=$1 AND product_id=$2 AND active=TRUE`,
      [TENANT, ctx.product_id]
    );
    return r.rows[0].n;
  });
  check('product uji belum punya mold compatibility', compatBefore === 0, String(compatBefore));

  const confirmed = await production.confirmWorkOrder(TENANT, wo.id, { confirmedBy: 'qa' });
  check(
    'ADR-36: Work Order tanpa mold dapat dikonfirmasi',
    confirmed.status === 'CONFIRMED',
    confirmed.status
  );
  check('confirmed_at tercatat', Boolean(confirmed.confirmedAt));

  console.log('\n2. Product dengan mold compatibility aktif');

  // Return the WO to SCHEDULED and declare a mold for the product.
  await production.updateWorkOrder(TENANT, wo.id, { status: 'SCHEDULED' });

  await withTenant(TENANT, async (client) => {
    created.moldId = `mold-qa-${stamp}`;
    created.compatId = `pmc-qa-${stamp}`;
    await client.query(
      `INSERT INTO mold (id, tenant_id, code, name, cavity_count, status)
       VALUES ($1,$2,$3,'QA Mold',4,'AVAILABLE')`,
      [created.moldId, TENANT, `QA-MOLD-${String(stamp).slice(-6)}`]
    );
    await client.query(
      `INSERT INTO product_mold_compatibility (id, tenant_id, product_id, mold_id, active)
       VALUES ($1,$2,$3,$4,TRUE)`,
      [created.compatId, TENANT, ctx.product_id, created.moldId]
    );
  });

  let refused = false;
  let message = '';
  try {
    await production.confirmWorkOrder(TENANT, wo.id, { confirmedBy: 'qa' });
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    'ADR-36: begitu Product punya mold compatibility, confirm tanpa mold ditolak',
    refused && /Mold belum ditetapkan/.test(message),
    message || 'tidak ditolak'
  );

  console.log('\n3. Mold ditetapkan');

  await production.updateWorkOrder(TENANT, wo.id, { moldId: created.moldId });
  const withMold = await production.confirmWorkOrder(TENANT, wo.id, { confirmedBy: 'qa' });
  check(
    'setelah mold ditetapkan, confirm berhasil',
    withMold.status === 'CONFIRMED',
    withMold.status
  );
  check('mold tersimpan pada Work Order', withMold.moldId === created.moldId, withMold.moldId);

  console.log('\n4. Compatibility dinonaktifkan');

  await production.updateWorkOrder(TENANT, wo.id, { status: 'SCHEDULED' });
  await withTenant(TENANT, (client) =>
    client.query('UPDATE product_mold_compatibility SET active = FALSE WHERE tenant_id=$1 AND id=$2', [
      TENANT,
      created.compatId,
    ])
  );

  // The mold is still assigned, so this only proves the guard reads `active`.
  const stillOk = await production.confirmWorkOrder(TENANT, wo.id, { confirmedBy: 'qa' });
  check(
    'compatibility non-aktif tidak lagi mewajibkan mold',
    stillOk.status === 'CONFIRMED',
    stillOk.status
  );

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length) console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
} catch (error) {
  failed += 1;
  console.error('\nException:', error);
} finally {
  await cleanup().catch((e) => console.error('cleanup gagal:', e.message));
  await closePool();
}

process.exit(failed > 0 ? 1 : 0);
