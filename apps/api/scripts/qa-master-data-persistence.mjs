/**
 * Final QA — does master data survive a restart?
 *
 * Reproduces the defect this fixes: create reference data through the service,
 * throw the in-memory state away (a fresh `MasterDataService`, which is what a
 * restart is), hydrate, and check the data came back.
 *
 * The reject-reason case is the one that mattered most in production: the shop
 * floor validates every reject against `getRejectReasons()`, so a reason that
 * did not survive the restart turned every reject capture into
 * "alasan reject tidak dikenal".
 *
 *   node --import tsx scripts/qa-master-data-persistence.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { withTenant, closePool } = await import('../src/platform/db/pool.ts');
const { MasterDataService } = await import('../src/modules/master-data/master-data.service.ts');

const TENANT = 'tenant-pilot-factory-01';
const STAMP = Date.now().toString().slice(-6);

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

/** Waits for the write-behind persist to reach PostgreSQL. */
async function settle(ms = 400) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const created = { productIds: [], reasonIds: [], machineIds: [] };

try {
  console.log('\n1. Create reference data through the service');

  const first = new MasterDataService();
  await first.hydrate(TENANT);

  const product = first.createProduct(TENANT, {
    sku: `QA-SKU-${STAMP}`,
    name: 'QA Persistence Product',
    unit: 'PCS',
    idealCycleTimeSeconds: 45,
    status: 'ACTIVE',
  });
  created.productIds.push(product.id);
  check('product created in memory', Boolean(product.id));

  const rejectReason = first.createRejectReason(TENANT, {
    category: 'DIMENSION',
    code: `QA-RJ-${STAMP}`,
    name: 'QA Persistence Reject Reason',
    active: true,
    sortOrder: 99,
  });
  created.reasonIds.push(rejectReason.id);
  check('reject reason created in memory', Boolean(rejectReason.id));

  const downtimeReason = first.createDowntimeReason(TENANT, {
    category: 'MACHINE',
    code: `QA-DT-${STAMP}`,
    name: 'QA Persistence Downtime Reason',
    isPlanned: false,
    active: true,
    sortOrder: 99,
  });
  created.reasonIds.push(downtimeReason.id);

  await settle();

  console.log('\n2. Confirm the rows actually reached PostgreSQL');

  const stored = await withTenant(TENANT, async (client) => {
    const p = await client.query('SELECT id FROM product WHERE tenant_id = $1 AND id = $2', [
      TENANT,
      product.id,
    ]);
    const r = await client.query('SELECT id, active FROM reject_reason WHERE tenant_id = $1 AND id = $2', [
      TENANT,
      rejectReason.id,
    ]);
    const d = await client.query('SELECT id FROM downtime_reason WHERE tenant_id = $1 AND id = $2', [
      TENANT,
      downtimeReason.id,
    ]);
    return { product: p.rowCount, reject: r.rows[0], downtime: d.rowCount };
  });

  check('product row written to the database', stored.product === 1);
  check('reject reason row written to the database', Boolean(stored.reject));
  check('downtime reason row written to the database', stored.downtime === 1);

  console.log('\n3. Restart: a fresh service instance, hydrated from the database');

  // A new MasterDataService is exactly what a process restart produces.
  const afterRestart = new MasterDataService();
  await afterRestart.hydrate(TENANT);

  const productBack = afterRestart.getProducts(TENANT).find((p) => p.id === product.id);
  check(
    'the product survives the restart',
    Boolean(productBack),
    `${afterRestart.getProducts(TENANT).length} product(s) in memory`
  );
  check('and keeps its cycle time', productBack?.idealCycleTimeSeconds === 45);

  const reasonBack = afterRestart.getRejectReasons(TENANT).find((r) => r.id === rejectReason.id);
  check(
    'the reject reason survives the restart (shop floor can validate again)',
    Boolean(reasonBack),
    `${afterRestart.getRejectReasons(TENANT).length} reason(s) in memory`
  );

  const downtimeBack = afterRestart.getDowntimeReasons(TENANT).find((r) => r.id === downtimeReason.id);
  check('the downtime reason survives the restart', Boolean(downtimeBack));

  check(
    'machines are hydrated, not empty',
    afterRestart.getMachines(TENANT).length > 0,
    `${afterRestart.getMachines(TENANT).length}`
  );
  check(
    'production lines are hydrated',
    afterRestart.getLines(TENANT).length > 0,
    `${afterRestart.getLines(TENANT).length}`
  );
  check(
    'processes are hydrated',
    afterRestart.getProcesses(TENANT).length > 0,
    `${afterRestart.getProcesses(TENANT).length}`
  );
  check(
    'product routings are hydrated',
    afterRestart.getProductRoutings(TENANT).length > 0,
    `${afterRestart.getProductRoutings(TENANT).length}`
  );

  console.log('\n4. An update survives too');

  afterRestart.updateProduct(TENANT, product.id, { name: 'QA Persistence Product (renamed)' });
  await settle();

  const third = new MasterDataService();
  await third.hydrate(TENANT);
  const renamed = third.getProducts(TENANT).find((p) => p.id === product.id);
  check(
    'the rename survives the next restart',
    renamed?.name === 'QA Persistence Product (renamed)',
    renamed?.name
  );

  console.log('\n5. A delete survives too');

  third.deleteRejectReason(TENANT, rejectReason.id);
  await settle();

  const fourth = new MasterDataService();
  await fourth.hydrate(TENANT);
  check(
    'the deleted reject reason does not come back',
    !fourth.getRejectReasons(TENANT).some((r) => r.id === rejectReason.id)
  );

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length > 0) {
    console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  }
} catch (error) {
  failed += 1;
  console.error('\nException:', error);
} finally {
  await withTenant(TENANT, async (client) => {
    await client.query('DELETE FROM reject_reason WHERE tenant_id = $1 AND id = ANY($2)', [
      TENANT,
      created.reasonIds,
    ]);
    await client.query('DELETE FROM downtime_reason WHERE tenant_id = $1 AND id = ANY($2)', [
      TENANT,
      created.reasonIds,
    ]);
    await client.query('DELETE FROM product WHERE tenant_id = $1 AND id = ANY($2)', [
      TENANT,
      created.productIds,
    ]);
  }).catch((error) => console.error('cleanup gagal:', error.message));
  await closePool();
}

process.exit(failed > 0 ? 1 : 0);
