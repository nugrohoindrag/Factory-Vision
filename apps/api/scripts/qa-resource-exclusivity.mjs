/**
 * Sprint 7 — one running Work Order per machine, and per mould.
 *
 * Architecture section 891 names the race: two operators start a Work Order on
 * the same machine at the same moment. Its answer has two halves — a lock while
 * the transaction runs, and a database constraint that holds regardless. Only
 * the constraint makes the invariant true across processes, and Sprint 7 has
 * just made a second process (the worker) part of the normal deployment.
 *
 * So this checks the constraint the way the race would: two starts on one
 * machine, issued concurrently, and then the same for a mould.
 *
 *   node --import tsx scripts/qa-resource-exclusivity.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { query, closePool } = await import('../src/platform/db/pool.ts');

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

console.log('\n=== Sprint 7 — exclusivity mesin dan mold ===\n');

const created = [];
const createdMachines = [];

async function makeWorkOrder(suffix, columns) {
  const id = `wo-qa-excl-${suffix}-${Date.now()}`;
  created.push(id);
  const keys = Object.keys(columns);
  const values = Object.values(columns);
  const placeholders = keys.map((_, i) => `$${i + 4}`).join(', ');
  await query(
    `INSERT INTO work_order (id, tenant_id, wo_number, ${keys.join(', ')})
     VALUES ($1, $2, $3, ${placeholders})`,
    [id, TENANT, `WO-QA-EXCL-${suffix}-${Date.now()}`, ...values]
  );
  return id;
}

try {
  // --- 0. The indexes exist at all -----------------------------------------
  console.log('0. Constraint terpasang');

  const indexes = await query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'work_order'
        AND indexname IN ('uq_work_order_machine_in_production', 'uq_work_order_mold_in_production')`
  );
  check('index exclusivity mesin ada', indexes.some((i) => i.indexname === 'uq_work_order_machine_in_production'));
  check('index exclusivity mold ada', indexes.some((i) => i.indexname === 'uq_work_order_mold_in_production'));
  check(
    'hanya berlaku pada status IN_PRODUCTION',
    indexes.every((i) => i.indexdef.includes("IN_PRODUCTION")),
    JSON.stringify(indexes.map((i) => i.indexdef))
  );

  // --- Fixtures -------------------------------------------------------------
  //
  // Dedicated machines rather than borrowed ones. The pilot tenant has real
  // Work Orders running, and this script deliberately provokes the very
  // constraint those rows already satisfy — reusing an occupied machine would
  // make the script collide with genuine production instead of testing it.
  const products = await query('SELECT id FROM product WHERE tenant_id = $1 LIMIT 1', [TENANT]);
  const lines = await query('SELECT id FROM production_line WHERE tenant_id = $1 LIMIT 1', [TENANT]);
  const workCenters = await query('SELECT id FROM work_center WHERE tenant_id = $1 LIMIT 1', [
    TENANT,
  ]);
  if (products.length === 0 || lines.length === 0 || workCenters.length === 0) {
    throw new Error('Tenant pilot tidak punya product/line/work center; jalankan seed.');
  }
  const productId = products[0].id;
  const lineId = lines[0].id;

  const stamp = Date.now();
  const machineId = `mc-qa-excl-a-${stamp}`;
  const secondMachineId = `mc-qa-excl-b-${stamp}`;
  for (const [id, code] of [
    [machineId, `MC-QA-EXCL-A-${stamp}`],
    [secondMachineId, `MC-QA-EXCL-B-${stamp}`],
  ]) {
    await query(
      `INSERT INTO machine (id, tenant_id, work_center_id, code, name, status, ideal_cycle_time_seconds)
       VALUES ($1, $2, $3, $4, 'Mesin QA Exclusivity', 'ACTIVE', 60)`,
      [id, TENANT, workCenters[0].id, code]
    );
  }
  createdMachines.push(machineId, secondMachineId);

  const moldId = `mold-qa-excl-${Date.now()}`;
  await query(
    `INSERT INTO mold (id, tenant_id, code, name, cavity_count, status)
     VALUES ($1, $2, $3, 'Mold QA Exclusivity', 1, 'AVAILABLE')`,
    [moldId, TENANT, `MLD-QA-EXCL-${Date.now()}`]
  );

  if (!lineId) throw new Error('Tenant pilot tidak punya production line; jalankan seed.');

  const base = {
    product_id: productId,
    line_id: lineId,
    status: 'CONFIRMED',
    planned_quantity: 10,
    planned_start: new Date().toISOString(),
    planned_end: new Date(Date.now() + 3600_000).toISOString(),
  };

  // --- 1. One machine, two starts ------------------------------------------
  console.log('\n1. Dua work order tidak boleh IN_PRODUCTION pada satu mesin');

  const first = await makeWorkOrder('m1', { ...base, machine_id: machineId });
  const second = await makeWorkOrder('m2', { ...base, machine_id: machineId });

  await query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [first]);
  check('work order pertama boleh berjalan', true);

  let machineRefused = null;
  try {
    await query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [second]);
  } catch (error) {
    machineRefused = error;
  }
  check('work order kedua ditolak database', machineRefused !== null, 'kedua-duanya diterima');
  check(
    'ditolak oleh constraint exclusivity, bukan kebetulan',
    machineRefused?.constraint === 'uq_work_order_machine_in_production',
    machineRefused?.constraint ?? machineRefused?.message
  );

  const runningOnMachine = await query(
    `SELECT count(*)::int AS n FROM work_order
      WHERE tenant_id = $1 AND machine_id = $2 AND status = 'IN_PRODUCTION'`,
    [TENANT, machineId]
  );
  check('tetap hanya satu WO berjalan pada mesin itu', runningOnMachine[0].n === 1, `n=${runningOnMachine[0].n}`);

  // --- 2. Freed when the first finishes ------------------------------------
  console.log('\n2. Mesin bebas kembali setelah WO pertama selesai');

  await query(`UPDATE work_order SET status = 'COMPLETED' WHERE id = $1`, [first]);
  let afterRelease = null;
  try {
    await query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [second]);
  } catch (error) {
    afterRelease = error;
  }
  check('WO berikutnya boleh mulai setelah mesin bebas', afterRelease === null, afterRelease?.message);
  await query(`UPDATE work_order SET status = 'COMPLETED' WHERE id = $1`, [second]);

  // --- 3. The same for a mould ---------------------------------------------
  console.log('\n3. Satu mold tidak dapat terpasang di dua mesin');

  const moldFirst = await makeWorkOrder('x1', {
    ...base,
    machine_id: machineId,
    mold_id: moldId,
  });
  const moldSecond = await makeWorkOrder('x2', {
    ...base,
    // A different machine on purpose: this must be refused by the *mould*
    // constraint, which is the whole point — the same physical mould cannot be
    // in two machines, however free those machines are.
    machine_id: secondMachineId,
    mold_id: moldId,
  });

  await query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [moldFirst]);

  let moldRefused = null;
  try {
    await query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [moldSecond]);
  } catch (error) {
    moldRefused = error;
  }
  check('WO kedua dengan mold sama ditolak', moldRefused !== null, 'kedua-duanya diterima');
  check(
    'ditolak oleh constraint mold, bukan constraint mesin',
    moldRefused?.constraint === 'uq_work_order_mold_in_production',
    moldRefused?.constraint ?? moldRefused?.message
  );

  await query(`UPDATE work_order SET status = 'COMPLETED' WHERE id = $1`, [moldFirst]);

  // --- 4. A concurrent race, not a sequential one --------------------------
  console.log('\n4. Balapan sungguhan: dua start bersamaan');

  const raceA = await makeWorkOrder('r1', { ...base, machine_id: machineId });
  const raceB = await makeWorkOrder('r2', { ...base, machine_id: machineId });

  const outcomes = await Promise.allSettled([
    query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [raceA]),
    query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [raceB]),
  ]);
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled').length;

  check('tepat satu dari dua start bersamaan berhasil', fulfilled === 1, `fulfilled=${fulfilled}`);

  const runningAfterRace = await query(
    `SELECT count(*)::int AS n FROM work_order
      WHERE tenant_id = $1 AND machine_id = $2 AND status = 'IN_PRODUCTION'`,
    [TENANT, machineId]
  );
  check(
    'database tetap konsisten setelah balapan',
    runningAfterRace[0].n === 1,
    `n=${runningAfterRace[0].n}`
  );

  // --- 5. Not applied to work orders that are not running ------------------
  console.log('\n5. Constraint tidak menghalangi penjadwalan');

  const scheduledA = await makeWorkOrder('s1', { ...base, machine_id: machineId });
  const scheduledB = await makeWorkOrder('s2', { ...base, machine_id: machineId });
  const bothScheduled = await query(
    `SELECT count(*)::int AS n FROM work_order WHERE id IN ($1, $2) AND status = 'CONFIRMED'`,
    [scheduledA, scheduledB]
  );
  check(
    'dua WO boleh dijadwalkan pada mesin yang sama',
    bothScheduled[0].n === 2,
    `n=${bothScheduled[0].n}`
  );

  await query(`UPDATE work_order SET status = 'COMPLETED' WHERE tenant_id = $1 AND id = ANY($2)`, [
    TENANT,
    created,
  ]);
} finally {
  if (created.length > 0) {
    await query('DELETE FROM work_order WHERE tenant_id = $1 AND id = ANY($2)', [TENANT, created]).catch(
      () => undefined
    );
  }
  await query("DELETE FROM mold WHERE tenant_id = $1 AND code LIKE 'MLD-QA-EXCL-%'", [TENANT]).catch(
    () => undefined
  );
  if (createdMachines.length > 0) {
    await query('DELETE FROM machine WHERE tenant_id = $1 AND id = ANY($2)', [
      TENANT,
      createdMachines,
    ]).catch(() => undefined);
  }
  await closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
