/**
 * Final QA — migration lifecycle on a throwaway database.
 *
 * Builds a database from nothing, applies every migration, rolls the reversible
 * ones back, applies them again, and checks the schema and the legacy data
 * survived. Run against a scratch database so nothing here can touch the pilot.
 *
 *   node --import tsx scripts/qa-migration-lifecycle.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const SCRATCH_DB = process.env.QA_MIGRATION_DB || 'factory_vision_qa_migration';
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('DATABASE_URL tidak diset.');
  process.exit(1);
}
const scratchUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB}$1`);

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

const migrationsDir = path.join(repoRoot, 'db', 'migrations');
const rollbacksDir = path.join(repoRoot, 'db', 'rollbacks');
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

async function applyAll(client, label) {
  for (const file of migrations) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${label}: ${file} gagal — ${error.message}`);
    }
  }
}

// Drop and recreate the scratch database from the maintenance connection.
const admin = new pg.Client({ connectionString: adminUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
} finally {
  await admin.end();
}

const db = new pg.Client({ connectionString: scratchUrl });
await db.connect();

try {
  console.log(`\n1. Fresh install: ${migrations.length} migrations onto an empty database`);
  await applyAll(db, 'fresh install');
  check('every migration applies to an empty database', true);

  const tables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  const names = tables.rows.map((r) => r.table_name);
  for (const expected of [
    'work_order', 'production_batch', 'production_record', 'customer', 'customer_order',
    'customer_order_line', 'customer_order_document', 'demand_forecast', 'demand_forecast_line',
    'capacity_plan', 'capacity_plan_line', 'production_plan', 'production_plan_line',
    'production_plan_demand', 'mold', 'product_mold_compatibility', 'outbox_event',
    'planning_config', 'planning_job',
  ]) {
    check(`table ${expected} created`, names.includes(expected));
  }

  const policies = await db.query(
    "SELECT tablename FROM pg_policies WHERE policyname = 'tenant_isolation'"
  );
  check(
    'tenant_isolation policies created on a fresh install',
    policies.rows.length >= 30,
    `${policies.rows.length} policies`
  );

  console.log('\n2. Re-migration: every migration applied a second time');
  await applyAll(db, 're-migration');
  check('every migration is replayable without error', true);

  const tablesAfter = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  check(
    're-migration changes no table',
    tablesAfter.rows.length === tables.rows.length,
    `${tables.rows.length} → ${tablesAfter.rows.length}`
  );

  console.log('\n3. Legacy data through the migration path');

  // A tenant with pre-v1.0 shaped data, then the v2 migrations again.
  await db.query(`
    INSERT INTO tenant (id, name, timezone, plan, status)
    VALUES ('t-legacy', 'Legacy Tenant', 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING`);
  await db.query(`
    INSERT INTO plant (id, tenant_id, name, location, timezone, status)
    VALUES ('pl-legacy', 't-legacy', 'Legacy Plant', 'Cikarang', 'Asia/Jakarta', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING`);
  await db.query(`
    INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes)
    VALUES ('line-legacy', 't-legacy', 'pl-legacy', 'L1', 'Legacy Line', 'ACTIVE', 480)
    ON CONFLICT (id) DO NOTHING`);
  await db.query(`
    INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status)
    VALUES ('prod-legacy', 't-legacy', 'SKU-L', 'Legacy Product', 'PCS', 30, 'ACTIVE')
    ON CONFLICT (id) DO NOTHING`);
  await db.query(`
    INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date, status, created_by)
    VALUES ('po-legacy', 't-legacy', 'PO-LEGACY-1', 'prod-legacy', 5000, CURRENT_DATE + 7, 'RELEASED', 'seed')
    ON CONFLICT (id) DO NOTHING`);

  // Migration 010 turns a production order into a plan + plan line.
  await applyAll(db, 'legacy re-run');

  const planLine = await db.query(
    "SELECT id, planned_quantity FROM production_plan_line WHERE id = 'planline-mig-po-legacy'"
  );
  check(
    'a legacy production order becomes a Production Plan Line',
    planLine.rows.length === 1,
    JSON.stringify(planLine.rows)
  );
  check(
    'and it carries the order quantity, unchanged',
    Number(planLine.rows[0]?.planned_quantity) === 5000,
    String(planLine.rows[0]?.planned_quantity)
  );

  const orderIntact = await db.query("SELECT quantity FROM production_order WHERE id = 'po-legacy'");
  check(
    'the legacy production order itself is not destroyed',
    Number(orderIntact.rows[0]?.quantity) === 5000
  );

  console.log('\n4. Rollback of the reversible migrations, then forward again');

  // Roll back in reverse order, exactly as the runner does one step at a time.
  const reversible = [...migrations].reverse().filter((file) =>
    fs.existsSync(path.join(rollbacksDir, file))
  );

  let rolledBack = 0;
  for (const file of reversible) {
    const sql = fs.readFileSync(path.join(rollbacksDir, file), 'utf-8');
    try {
      await db.query('BEGIN');
      await db.query(sql);
      await db.query('COMMIT');
      rolledBack += 1;
    } catch (error) {
      await db.query('ROLLBACK');
      check(`rollback ${file}`, false, error.message);
      break;
    }
  }
  check(
    `every reversible migration rolls back (${rolledBack}/${reversible.length})`,
    rolledBack === reversible.length
  );

  const afterRollback = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('outbox_event','planning_job','customer_order','production_plan')"
  );
  check(
    'the v1.0 tables are gone after rollback',
    afterRollback.rows.length === 0,
    afterRollback.rows.map((r) => r.table_name).join(', ')
  );

  const coreIntact = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('work_order','production_record','production_order')"
  );
  check(
    'rollback leaves the core execution tables intact',
    coreIntact.rows.length === 3,
    coreIntact.rows.map((r) => r.table_name).join(', ')
  );

  const recordsSurvive = await db.query("SELECT count(*)::int AS n FROM production_order WHERE id = 'po-legacy'");
  check('rollback does not destroy legacy data', recordsSurvive.rows[0].n === 1);

  console.log('\n5. Forward again after the rollback');
  await applyAll(db, 'forward after rollback');
  check('the full set re-applies after a rollback', true);

  const restored = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('outbox_event','planning_job','customer_order','production_plan')"
  );
  check('the v1.0 tables come back', restored.rows.length === 4, `${restored.rows.length}/4`);

  const salesRole = await db.query("SELECT count(*)::int AS n FROM role_definition WHERE key = 'SALES'");
  check('the SALES role is re-created by the migration', salesRole.rows[0].n >= 1);

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length > 0) {
    console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  }
} catch (error) {
  failed += 1;
  console.error('\nException:', error.message);
} finally {
  await db.end();
  if (!process.env.QA_KEEP_DB) {
    const cleanup = new pg.Client({
      connectionString: adminUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1'),
    });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`).catch(() => undefined);
    await cleanup.end();
  }
}

process.exit(failed > 0 ? 1 : 0);
