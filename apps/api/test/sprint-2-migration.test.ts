/**
 * Sprint 2 — migration behaviour against a legacy-shaped database.
 *
 * The suite builds its own database from scratch on every run: baseline schema,
 * legacy fixture, then the Sprint 2 migrations. It depends on no seed and no
 * pre-existing state, which is what makes it safe to run in CI. Sprint 1's
 * suite needed a seed applied by hand and failed on a clean database; that is
 * the mistake this one avoids.
 *
 * The fixture stands in for the pilot dump, which is not yet available.
 * Validation against real pilot data remains OPEN — see the Sprint 2 report.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(REPO, 'db/migrations');
const ROLLBACKS = path.join(REPO, 'db/rollbacks');
const FIXTURE = path.join(REPO, 'db/fixtures/legacy_v1_5.sql');

const ADMIN_URL =
  process.env.OWNER_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://factory:factory@localhost:5432/factory_vision';
const TEST_DB = 'fv_sprint2_test';
const TENANT = 't-legacy';

const BASELINE = ['001', '002', '003', '004', '005', '006', '007', '008', '009'];
const SPRINT2 = ['010', '011', '012', '013', '014'];

function fileFor(dir: string, prefix: string): string | undefined {
  const hit = fs.readdirSync(dir).find((f) => f.startsWith(prefix + '_') && f.endsWith('.sql'));
  return hit ? path.join(dir, hit) : undefined;
}

async function run(client: pg.Client, file: string) {
  await client.query(fs.readFileSync(file, 'utf-8'));
}

function testUrl(): string {
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + TEST_DB;
  return u.toString();
}

async function scalar<T = string>(client: pg.Client, sql: string): Promise<T> {
  const r = await client.query(sql);
  return Object.values(r.rows[0])[0] as T;
}

test('Sprint 2: legacy migration, rollback and re-migration', async (t) => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: testUrl() });
  await db.connect();

  await t.test('baseline schema and legacy fixture apply', async () => {
    for (const p of BASELINE) {
      const f = fileFor(MIGRATIONS, p);
      assert.ok(f, `baseline migration ${p} must exist`);
      await run(db, f!);
    }
    await run(db, FIXTURE);

    const wos = await scalar<string>(db, `SELECT COUNT(*)::text FROM work_order WHERE tenant_id='${TENANT}'`);
    assert.equal(wos, '7', 'fixture must load seven legacy work orders');

    const legacyStatus = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM work_order WHERE status IN ('RELEASED','IN_PROGRESS','PAUSED')`
    );
    assert.equal(legacyStatus, '6', 'fixture must carry retired statuses before migration');
  });

  // Figures captured before the migrations, compared after.
  let poCount = '', poQty = '', recordCount = '', batchRefs = '';

  await t.test('capture pre-migration state', async () => {
    poCount = await scalar(db, `SELECT COUNT(*)::text FROM production_order WHERE tenant_id='${TENANT}'`);
    poQty = await scalar(db, `SELECT COALESCE(SUM(quantity),0)::text FROM production_order WHERE tenant_id='${TENANT}'`);
    recordCount = await scalar(db, `SELECT COUNT(*)::text FROM production_record WHERE tenant_id='${TENANT}'`);
    batchRefs = await scalar(db, `SELECT COUNT(*)::text FROM work_order WHERE batch_id IS NOT NULL`);
    assert.equal(batchRefs, '4', 'four work orders share one legacy batch');
  });

  await t.test('MES-009: every production order becomes a plan and a plan line', async () => {
    await run(db, fileFor(MIGRATIONS, '010')!);

    const plans = await scalar<string>(db, `SELECT COUNT(*)::text FROM production_plan WHERE tenant_id='${TENANT}'`);
    const lines = await scalar<string>(db, `SELECT COUNT(*)::text FROM production_plan_line WHERE tenant_id='${TENANT}'`);
    assert.equal(plans, poCount, 'one plan per production order');
    assert.equal(lines, poCount, 'one plan line per production order');

    const planQty = await scalar<string>(
      db,
      `SELECT COALESCE(SUM(planned_quantity),0)::text FROM production_plan_line WHERE tenant_id='${TENANT}'`
    );
    assert.equal(planQty, poQty, 'quantity is conserved through the backfill');

    const mapped = await db.query(
      `SELECT po.status AS old, pp.status AS new FROM production_order po
         JOIN production_plan pp ON pp.id = 'plan-mig-' || po.id
        WHERE po.tenant_id = $1 ORDER BY po.id`,
      [TENANT]
    );
    assert.deepEqual(
      mapped.rows.map((r) => [r.old, r.new]),
      [['RELEASED', 'CONFIRMED'], ['PLANNED', 'PLANNING']],
      'status mapping follows the documented table'
    );
  });

  await t.test('MES-009: re-running adds nothing', async () => {
    await run(db, fileFor(MIGRATIONS, '010')!);
    const plans = await scalar<string>(db, `SELECT COUNT(*)::text FROM production_plan WHERE tenant_id='${TENANT}'`);
    assert.equal(plans, poCount, 'idempotent');
  });

  await t.test('MES-010: plan line link, predecessor chain, good_quantity retired', async () => {
    await run(db, fileFor(MIGRATIONS, '011')!);

    const unlinked = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM work_order WHERE production_plan_line_id IS NULL`
    );
    assert.equal(unlinked, '0', 'every work order reaches a plan line');

    // The fixture's sequences are 1, 3, 4, 5 — deliberately not contiguous, so a
    // chain built by looking for "sequence - 1" would silently produce nothing.
    const chain = await db.query(
      `SELECT id, predecessor_work_order_id FROM work_order
        WHERE tenant_id=$1 AND id LIKE 'lg-wo-s%' ORDER BY sequence`,
      [TENANT]
    );
    assert.deepEqual(
      chain.rows.map((r) => [r.id, r.predecessor_work_order_id]),
      [
        ['lg-wo-s1', null],
        ['lg-wo-s3', 'lg-wo-s1'],
        ['lg-wo-s4', 'lg-wo-s3'],
        ['lg-wo-s5', 'lg-wo-s4'],
      ],
      'predecessor chain follows routing order, not sequence arithmetic'
    );

    // ADR-23: output is what passed quality. Reject is a separate bucket and is
    // never folded in — 9800, not 9900.
    const s1 = await db.query(
      `SELECT planned_quantity, output_quantity, reject_quantity FROM work_order WHERE id='lg-wo-s1'`
    );
    assert.equal(Number(s1.rows[0].planned_quantity), 10000);
    assert.equal(Number(s1.rows[0].output_quantity), 9800);
    assert.equal(Number(s1.rows[0].reject_quantity), 100);

    const hasGood = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM information_schema.columns
        WHERE table_name='work_order' AND column_name='good_quantity'`
    );
    assert.equal(hasGood, '0', 'work_order.good_quantity is gone (ADR-23)');
  });

  await t.test('MES-011: one legacy batch fans out to one batch per work order', async () => {
    await run(db, fileFor(MIGRATIONS, '012')!);

    const fanned = await db.query(
      `SELECT new_batch_number, work_order_id, process_sequence
         FROM migration_batch_identity_map WHERE tenant_id=$1 ORDER BY process_sequence`,
      [TENANT]
    );
    assert.deepEqual(
      fanned.rows.map((r) => [r.new_batch_number, r.work_order_id, Number(r.process_sequence)]),
      [
        ['LGB-001-S1', 'lg-wo-s1', 1],
        ['LGB-001-S3', 'lg-wo-s3', 3],
        ['LGB-001-S4', 'lg-wo-s4', 4],
        ['LGB-001-S5', 'lg-wo-s5', 5],
      ],
      'Batch A -> WO S1/S3/S4/S5 becomes A-S1/A-S3/A-S4/A-S5'
    );

    const legacyGone = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_batch WHERE id='lg-batch-1'`
    );
    assert.equal(legacyGone, '0', 'the legacy row is replaced, its identity kept in the map');

    const orphan = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_batch WHERE work_order_id IS NULL`
    );
    assert.equal(orphan, '0', 'no batch is left without an owner');

    const dup = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM (SELECT tenant_id, batch_number FROM production_batch
        GROUP BY tenant_id, batch_number HAVING COUNT(*) > 1) d`
    );
    assert.equal(dup, '0', 'business identity stays unique');

    const hasBatchId = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM information_schema.columns
        WHERE table_name='work_order' AND column_name='batch_id'`
    );
    assert.equal(hasBatchId, '0', 'the legacy pointer is dropped');
  });

  await t.test('MES-012/013: statuses migrated, execution path consistent', async () => {
    await run(db, fileFor(MIGRATIONS, '013')!);
    await run(db, fileFor(MIGRATIONS, '014')!);

    const legacyStatus = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM work_order WHERE status IN ('RELEASED','IN_PROGRESS','PAUSED')`
    );
    assert.equal(legacyStatus, '0', 'no retired status survives');

    const statuses = await db.query(
      `SELECT id, status FROM work_order WHERE tenant_id=$1 ORDER BY id`,
      [TENANT]
    );
    const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]));
    assert.equal(byId['lg-wo-s1'], 'IN_PRODUCTION', 'IN_PROGRESS -> IN_PRODUCTION');
    assert.equal(byId['lg-wo-s3'], 'IN_PRODUCTION', 'PAUSED -> IN_PRODUCTION');
    assert.equal(byId['lg-wo-s4'], 'CONFIRMED', 'RELEASED -> CONFIRMED');
    assert.equal(byId['lg-wo-s5'], 'DRAFT', 'DRAFT is untouched');

    // A work order that was PAUSED is now IN_PRODUCTION with its downtime still
    // open — that pairing IS how the new model represents a stopped job
    // (ADR-18). What must not survive is downtime open on a finished job.
    const danglingOnFinished = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM downtime_record dr JOIN work_order wo ON wo.id = dr.work_order_id
        WHERE dr.status='ACTIVE' AND wo.status IN ('COMPLETED','CANCELLED')`
    );
    assert.equal(danglingOnFinished, '0', 'no downtime dangles on a finished work order');

    const parent = await db.query(
      `SELECT id, has_child_work_order FROM work_order WHERE tenant_id=$1 AND id IN ('lg-wo-p','lg-wo-c1')`,
      [TENANT]
    );
    const flags = Object.fromEntries(parent.rows.map((r) => [r.id, r.has_child_work_order]));
    assert.equal(flags['lg-wo-p'], true, 'the parent is flagged');
    assert.equal(flags['lg-wo-c1'], false, 'a child is not');

    const e3 = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_record WHERE has_child_work_order = TRUE`
    );
    assert.equal(e3, '0', 'E3: no production record belongs to a parent');
  });

  await t.test('legacy data is preserved end to end', async () => {
    const records = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_record WHERE tenant_id='${TENANT}'`
    );
    assert.equal(records, recordCount, 'no production record was lost');

    const pos = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_order WHERE tenant_id='${TENANT}'`
    );
    assert.equal(pos, poCount, 'production_order survives as legacy read-only (step 16a)');

    const childOutput = await scalar<string>(
      db,
      `SELECT COALESCE(SUM(output_quantity),0)::text FROM work_order WHERE parent_work_order_id='lg-wo-p'`
    );
    assert.equal(childOutput, '3910', 'child quantities intact (2350 + 1560)');
  });

  await t.test('rollback restores the legacy shape', async () => {
    for (const p of [...SPRINT2].reverse()) {
      await run(db, fileFor(ROLLBACKS, p)!);
    }

    const batchIdBack = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM information_schema.columns
        WHERE table_name='work_order' AND column_name='batch_id'`
    );
    assert.equal(batchIdBack, '1', 'work_order.batch_id is restored');

    const refs = await scalar<string>(db, `SELECT COUNT(*)::text FROM work_order WHERE batch_id IS NOT NULL`);
    assert.equal(refs, batchRefs, 'every legacy batch pointer comes back');

    const legacyBatch = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_batch WHERE id='lg-batch-1'`
    );
    assert.equal(legacyBatch, '1', 'the legacy batch row is rebuilt');

    // The Sprint 1 defect: rolling back 005 dropped production_batch entirely.
    const tableAlive = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM information_schema.tables WHERE table_name='production_batch'`
    );
    assert.equal(tableAlive, '1', 'production_batch, created in 001, survives rollback');

    const goodBack = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM information_schema.columns
        WHERE table_name='work_order' AND column_name='good_quantity'`
    );
    assert.equal(goodBack, '1', 'good_quantity is restored from output_quantity');

    const plans = await scalar<string>(db, `SELECT COUNT(*)::text FROM production_plan WHERE tenant_id='${TENANT}'`);
    assert.equal(plans, '0', 'migrated plans are removed');

    const records = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_record WHERE tenant_id='${TENANT}'`
    );
    assert.equal(records, recordCount, 'rollback loses no production record');
  });

  await t.test('re-migration reproduces the same result', async () => {
    for (const p of SPRINT2) {
      await run(db, fileFor(MIGRATIONS, p)!);
    }

    const fanned = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM migration_batch_identity_map WHERE tenant_id='${TENANT}'`
    );
    assert.equal(fanned, '4', 'the fan-out is reproduced exactly');

    const legacyStatus = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM work_order WHERE status IN ('RELEASED','IN_PROGRESS','PAUSED')`
    );
    assert.equal(legacyStatus, '0', 'statuses are migrated again');

    const records = await scalar<string>(
      db,
      `SELECT COUNT(*)::text FROM production_record WHERE tenant_id='${TENANT}'`
    );
    assert.equal(records, recordCount, 'a full cycle loses nothing');
  });

  await db.end();
});
