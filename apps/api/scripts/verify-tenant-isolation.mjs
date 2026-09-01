/**
 * Executable check for the persistence fix, §13 and §23 "Tenant isolation test".
 *
 * Migrations 001/002 have shipped `FORCE ROW LEVEL SECURITY` and a
 * `tenant_isolation` policy on every tenant-scoped table since the beginning,
 * and none of it applied: the API connected as the POSTGRES_USER superuser,
 * which carries BYPASSRLS and is exempt from every policy. Nothing failed, no
 * error was logged, and tenant B could read tenant A's production records.
 *
 * That is the failure mode this script exists for. A policy you have never
 * watched refuse a query is not a control, it is a comment, so this asserts
 * the refusals rather than the presence of the policy.
 *
 *   OWNER_DATABASE_URL=postgresql://factory:...@host/db \
 *   DATABASE_URL=postgresql://factory_app:...@host/db \
 *   pnpm verify:isolation
 *
 * OWNER_DATABASE_URL creates and removes the fixtures (the app role is not
 * allowed to write another tenant's rows, which is the very thing under test).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const OWNER_URL = process.env.OWNER_DATABASE_URL || process.env.DATABASE_URL;
const APP_URL =
  process.env.APP_DATABASE_URL ||
  `postgresql://${process.env.APP_DB_USER || 'factory_app'}:${process.env.APP_DB_PASSWORD || 'factory_app_password'}@localhost:5432/factory_vision`;

if (!APP_URL || !OWNER_URL) {
  console.error('Set OWNER_DATABASE_URL (schema owner) and DATABASE_URL (application role).');
  process.exit(2);
}

const A = 'iso-tenant-a';
const B = 'iso-tenant-b';
const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
}

/** Runs `fn` with the tenant declared, exactly as platform/db/pool.ts does. */
async function asTenant(client, tenantId, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function seed(owner) {
  await owner.query('BEGIN');
  for (const [t, suffix] of [
    [A, 'a'],
    [B, 'b'],
  ]) {
    await owner.query(`INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [t, `Iso ${suffix}`]);
    await owner.query(
      `INSERT INTO plant (id, tenant_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [`iso-plant-${suffix}`, t, `Plant ${suffix}`]
    );
    await owner.query(
      `INSERT INTO production_line (id, tenant_id, plant_id, code, name)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [`iso-line-${suffix}`, t, `iso-plant-${suffix}`, `IL${suffix}`, `Line ${suffix}`]
    );
    await owner.query(
      `INSERT INTO product (id, tenant_id, sku, name, ideal_cycle_time_seconds)
       VALUES ($1, $2, $3, $4, 12) ON CONFLICT (id) DO NOTHING`,
      [`iso-prod-${suffix}`, t, `ISO-${suffix}`, `Product ${suffix}`]
    );
    await owner.query(
      `INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date)
       VALUES ($1, $2, $3, $4, 10, CURRENT_DATE) ON CONFLICT (id) DO NOTHING`,
      [`iso-po-${suffix}`, t, `ISO-PO-${suffix}`, `iso-prod-${suffix}`]
    );
    await owner.query(
      `INSERT INTO work_order (id, tenant_id, production_order_id, wo_number, product_id, line_id,
                              target_quantity, planned_start, planned_end)
       VALUES ($1, $2, $3, $4, $5, $6, 10, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [`iso-wo-${suffix}`, t, `iso-po-${suffix}`, `ISO-WO-${suffix}`, `iso-prod-${suffix}`, `iso-line-${suffix}`]
    );
    await owner.query(
      `INSERT INTO production_record (id, tenant_id, work_order_id, machine_id, operator_id, shift_id,
                                     shift_date, good_quantity, recorded_at, client_event_id)
       VALUES ($1, $2, $3, 'iso-m1', 'iso-op1', 'iso-s1', CURRENT_DATE, 7, now(), $4)
       ON CONFLICT (id) DO NOTHING`,
      [`iso-pr-${suffix}`, t, `iso-wo-${suffix}`, `iso-ev-${suffix}`]
    );
  }
  await owner.query('COMMIT');
}

async function cleanup(owner) {
  await owner.query('BEGIN');
  for (const table of [
    'production_record',
    'work_order',
    'production_order',
    'product',
    'production_line',
    'plant',
  ]) {
    await owner.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [[A, B]]);
  }
  await owner.query('DELETE FROM tenant WHERE id = ANY($1)', [[A, B]]);
  await owner.query('COMMIT');
}

async function main() {
  const owner = new pg.Client({ connectionString: OWNER_URL });
  const app = new pg.Client({ connectionString: APP_URL });
  await owner.connect();
  await app.connect();

  try {
    await cleanup(owner);
    await seed(owner);

    // 1. The connecting role must be one the policies bind. This is the check
    //    that would have caught the original defect on day one.
    const role = await app.query(
      'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    );
    const r = role.rows[0];
    check(
      'application role is subject to RLS',
      r && !r.rolsuper && !r.rolbypassrls,
      `${r?.rolname}: superuser=${r?.rolsuper} bypassrls=${r?.rolbypassrls}`
    );

    // 2. Its own tenant's row is readable, or the policy is simply blocking
    //    everything and the tests below would pass for the wrong reason.
    const own = await asTenant(app, A, () =>
      app.query('SELECT count(*)::int AS n FROM production_record WHERE id = $1', ['iso-pr-a'])
    );
    check('tenant A reads its own production record', own.rows[0].n === 1, `saw ${own.rows[0].n}`);

    // 3. The actual isolation claim.
    const cross = await asTenant(app, B, () =>
      app.query('SELECT count(*)::int AS n FROM production_record WHERE id = $1', ['iso-pr-a'])
    );
    check("tenant B cannot read tenant A's production record", cross.rows[0].n === 0, `saw ${cross.rows[0].n}`);

    // 4. DEPLOYMENT.md's promise: no tenant declared means no rows.
    const undeclared = await app.query('SELECT count(*)::int AS n FROM production_record');
    check(
      'a connection with no tenant declared sees no rows',
      undeclared.rows[0].n === 0,
      `saw ${undeclared.rows[0].n}`
    );

    // 5. Reads are only half of isolation; a write must not cross either.
    let refused = false;
    let detail = 'insert was accepted';
    try {
      await asTenant(app, B, () =>
        app.query(
          `INSERT INTO production_record (id, tenant_id, work_order_id, machine_id, operator_id,
                                         shift_id, shift_date, good_quantity, recorded_at, client_event_id)
           VALUES ('iso-pr-evil', $1, 'iso-wo-a', 'm', 'o', 's', CURRENT_DATE, 999, now(), 'iso-ev-evil')`,
          [A]
        )
      );
    } catch (error) {
      refused = /row-level security/i.test(error.message);
      detail = error.message.split('\n')[0];
    }
    check("tenant B cannot write a row tagged tenant A", refused, detail);

    // 6. The application role has no business issuing DDL.
    let ddlRefused = false;
    let ddlDetail = 'CREATE TABLE was accepted';
    try {
      await app.query('CREATE TABLE iso_should_not_exist (id int)');
      await app.query('DROP TABLE iso_should_not_exist');
    } catch (error) {
      ddlRefused = /permission denied/i.test(error.message);
      ddlDetail = error.message.split('\n')[0];
    }
    check('application role cannot issue DDL', ddlRefused, ddlDetail);
  } finally {
    await cleanup(owner).catch(() => {});
    await app.end();
    await owner.end();
  }

  console.log('\nTenant isolation (persistence fix §13, §23)\n');
  for (const row of results) {
    console.log(`${row.passed ? 'PASS' : 'FAIL'}  ${row.name}`);
    if (row.detail) console.log(`        ${row.detail}`);
  }
  const failed = results.filter((row) => !row.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
