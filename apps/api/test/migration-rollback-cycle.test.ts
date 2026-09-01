import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * This suite rolls migrations back, which is destructive. It therefore builds
 * and tears down a database of its own rather than pointing at DATABASE_URL:
 * run against a shared database it would leave the schema half-rolled-back and
 * quietly break every suite that ran after it.
 */
const ADMIN_URL =
  process.env.OWNER_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://factory:factory@localhost:5432/postgres';
const TEST_DB = 'fv_rollback_cycle_test';

function scopedUrl(): string {
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + TEST_DB;
  return u.toString();
}

const DATABASE_URL = scopedUrl();
const ROOT_DIR = path.resolve(__dirname, '../../..');

test('P0 Verification: Migration Rollback and Re-migration Lifecycle', async () => {
  const admin = new pg.Client({
    connectionString: (() => {
      const u = new URL(ADMIN_URL);
      u.pathname = '/postgres';
      return u.toString();
    })(),
  });
  await admin.connect();
  // A previous run that failed part-way can leave a session on the test
  // database, and `DROP DATABASE` then refuses with "is being accessed by other
  // users" — so one failure would poison every run after it, presenting as a
  // hang rather than as the original failure. Evicting leftovers first makes
  // the suite recoverable on its own.
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {

  const migrationsDir = path.join(ROOT_DIR, 'db/migrations');
  const rollbacksDir = path.join(ROOT_DIR, 'db/rollbacks');

  // Helper to execute SQL file
  async function execSqlFile(filePath: string) {
    const sql = fs.readFileSync(filePath, 'utf-8');
    await client.query(sql);
  }

  // 0. Build the schema this suite operates on. The database was created empty
  //    a moment ago, so the baseline has to be applied before anything can be
  //    rolled back. Sprint 2 migrations (010+) are deliberately left off: this
  //    suite is about the Sprint 1 rollback boundary.
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const f of fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && f < '010')
    .sort()) {
    await execSqlFile(path.join(migrationsDir, f));
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
  }

  // 1. Verify production_batch exists initially
  const initialBatchCheck = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'production_batch'
    ) AS exists
  `);
  assert.equal(initialBatchCheck.rows[0].exists, true, 'production_batch must exist before test');

  // 2. Perform Rollbacks for 009 -> 008 -> 007 -> 006 -> 005
  console.log('Rolling back 009 -> 008 -> 007 -> 006 -> 005...');
  await client.query('BEGIN');
  try {
    await execSqlFile(path.join(rollbacksDir, '009_mes_v1_indexes.sql'));
    await client.query("DELETE FROM schema_migrations WHERE version = '009_mes_v1_indexes.sql'");

    await execSqlFile(path.join(rollbacksDir, '008_mes_v1_mold_compatibility.sql'));
    await client.query("DELETE FROM schema_migrations WHERE version = '008_mes_v1_mold_compatibility.sql'");

    await execSqlFile(path.join(rollbacksDir, '007_mes_v1_planning_schema.sql'));
    await client.query("DELETE FROM schema_migrations WHERE version = '007_mes_v1_planning_schema.sql'");

    await execSqlFile(path.join(rollbacksDir, '006_mes_v1_customer_demand.sql'));
    await client.query("DELETE FROM schema_migrations WHERE version = '006_mes_v1_customer_demand.sql'");

    await execSqlFile(path.join(rollbacksDir, '005_mes_v1_work_order.sql'));
    await client.query("DELETE FROM schema_migrations WHERE version = '005_mes_v1_work_order.sql'");

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  // 3. CRITICAL P0 CHECK: production_batch MUST SURVIVE ROLLBACK 005
  const postRollbackBatchCheck = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'production_batch'
    ) AS exists
  `);
  assert.equal(
    postRollbackBatchCheck.rows[0].exists,
    true,
    'CRITICAL: production_batch base table must survive rollback of migration 005'
  );

  // 4. Verify that columns added in 005 were cleanly removed
  const batchColsAfterRollback = await client.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'production_batch'
  `);
  const postRbCols = new Set(batchColsAfterRollback.rows.map((r) => r.column_name));
  assert.ok(!postRbCols.has('work_order_id'), 'work_order_id should be removed by rollback 005');
  assert.ok(postRbCols.has('batch_number'), 'batch_number from migration 001 must remain');

  // 5. Re-apply migrations 005 -> 006 -> 007 -> 008 -> 009
  console.log('Re-applying migrations 005 -> 006 -> 007 -> 008 -> 009...');
  await client.query('BEGIN');
  try {
    await execSqlFile(path.join(migrationsDir, '005_mes_v1_work_order.sql'));
    await client.query("INSERT INTO schema_migrations (version) VALUES ('005_mes_v1_work_order.sql')");

    await execSqlFile(path.join(migrationsDir, '006_mes_v1_customer_demand.sql'));
    await client.query("INSERT INTO schema_migrations (version) VALUES ('006_mes_v1_customer_demand.sql')");

    await execSqlFile(path.join(migrationsDir, '007_mes_v1_planning_schema.sql'));
    await client.query("INSERT INTO schema_migrations (version) VALUES ('007_mes_v1_planning_schema.sql')");

    await execSqlFile(path.join(migrationsDir, '008_mes_v1_mold_compatibility.sql'));
    await client.query("INSERT INTO schema_migrations (version) VALUES ('008_mes_v1_mold_compatibility.sql')");

    await execSqlFile(path.join(migrationsDir, '009_mes_v1_indexes.sql'));
    await client.query("INSERT INTO schema_migrations (version) VALUES ('009_mes_v1_indexes.sql')");

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  // 6. Verify full schema restored and columns present again
  const finalBatchCols = await client.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'production_batch'
  `);
  const finalCols = new Set(finalBatchCols.rows.map((r) => r.column_name));
  assert.ok(finalCols.has('work_order_id'), 'work_order_id must be restored after re-migration');
  assert.ok(finalCols.has('sequence'), 'sequence must be restored after re-migration');

  console.log('Migration rollback and re-migration lifecycle verified successfully!');
  } finally {
    // Closed whatever happened. Left open on an assertion failure, the client
    // keeps the Node process alive for ever: the suite reports nothing, and the
    // real failure is buried under a timeout.
    await client.end();
  }
});
