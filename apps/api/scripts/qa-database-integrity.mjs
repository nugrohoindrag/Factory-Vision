/**
 * Final QA — database-level integrity.
 *
 * Everything here is asserted against **real database state**, and the tenant
 * isolation half connects as `factory_app` (NOSUPERUSER, NOBYPASSRLS) rather
 * than as the owner — a superuser is exempt from every policy, so testing
 * isolation as one proves nothing at all.
 *
 *   node --import tsx scripts/qa-database-integrity.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const OWNER_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL;
const TENANT_A = 'tenant-pilot-factory-01';
const TENANT_B = 'tenant-qa-isolation-probe';

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

const owner = new pg.Client({ connectionString: OWNER_URL });
await owner.connect();

async function asTenant(client, tenantId, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    return await fn();
  } finally {
    await client.query('COMMIT').catch(() => client.query('ROLLBACK'));
  }
}

try {
  // =====================================================================
  console.log('\n1. Schema & constraint integrity');
  // =====================================================================

  const exclusivity = await owner.query(`
    SELECT conname FROM pg_constraint
     WHERE conname IN ('ck_prod_record_batch_exclusive', 'ck_prod_record_not_parent',
                       'fk_prod_record_wo_exec_mode', 'fk_prod_record_batch_wo')`);
  check(
    'E1/E2/E3 execution path exclusivity constraints present',
    exclusivity.rows.length === 4,
    exclusivity.rows.map((r) => r.conname).join(', ')
  );

  const plannedCheck = await owner.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'ck_cust_order_line_planned'`
  );
  check('planned_quantity <= ordered_quantity enforced by the database', plannedCheck.rows.length === 1);

  const idempotency = await owner.query(
    `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_wo_plan_line_process'`
  );
  check(
    'WO generation idempotency index excludes split children',
    idempotency.rows[0]?.indexdef?.includes('parent_work_order_id IS NULL'),
    idempotency.rows[0]?.indexdef
  );

  // Retired columns must actually be gone (ADR-23, ADR-29).
  const retired = await owner.query(`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE (table_name = 'work_order' AND column_name IN ('good_quantity', 'batch_id'))`);
  check(
    'work_order.good_quantity and work_order.batch_id are retired',
    retired.rows.length === 0,
    retired.rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ')
  );

  // §11: the retired statuses must not exist in stored data.
  const retiredStatus = await owner.query(
    `SELECT DISTINCT status FROM work_order WHERE status IN ('RELEASED', 'IN_PROGRESS', 'PAUSED')`
  );
  check(
    'no work order carries RELEASED / IN_PROGRESS / PAUSED',
    retiredStatus.rows.length === 0,
    retiredStatus.rows.map((r) => r.status).join(', ')
  );

  // =====================================================================
  console.log('\n2. Quantity invariants across stored data (§10)');
  // =====================================================================

  const woViolations = await owner.query(`
    SELECT id, wo_number, input_quantity, output_quantity, reject_quantity,
           scrap_quantity, rework_quantity, transferred_quantity
      FROM work_order
     WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity
        OR transferred_quantity > output_quantity`);
  check(
    'every stored Work Order satisfies the quantity invariants',
    woViolations.rows.length === 0,
    woViolations.rows.map((r) => r.wo_number).join(', ')
  );

  const batchViolations = await owner.query(`
    SELECT id, batch_number FROM production_batch
     WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity
        OR transferred_quantity > output_quantity`);
  check(
    'every stored Batch satisfies the same invariants',
    batchViolations.rows.length === 0,
    batchViolations.rows.map((r) => r.batch_number).join(', ')
  );

  const negatives = await owner.query(`
    SELECT count(*)::int AS n FROM work_order
     WHERE input_quantity < 0 OR output_quantity < 0 OR reject_quantity < 0
        OR scrap_quantity < 0 OR rework_quantity < 0 OR transferred_quantity < 0`);
  check('no negative quantity anywhere on work_order', negatives.rows[0].n === 0);

  // §9 Q1: SUM(batch.planned) <= work_order.planned
  const batchOverrun = await owner.query(`
    SELECT wo.wo_number, wo.planned_quantity, SUM(pb.planned_quantity) AS batch_total
      FROM work_order wo JOIN production_batch pb ON pb.work_order_id = wo.id
     GROUP BY wo.id, wo.wo_number, wo.planned_quantity
    HAVING SUM(pb.planned_quantity) > wo.planned_quantity`);
  check(
    '§9 Q1: no Work Order has batches planned beyond its own planned quantity',
    batchOverrun.rows.length === 0,
    batchOverrun.rows.map((r) => `${r.wo_number}: ${r.batch_total} > ${r.planned_quantity}`).join('; ')
  );

  // =====================================================================
  console.log('\n3. Double-counting prevention (§7, §8, §24)');
  // =====================================================================

  // E1/E2: a record on a non-batch WO must carry no batch, and vice versa.
  const e1 = await owner.query(`
    SELECT count(*)::int AS n FROM production_record
     WHERE (is_batch_managed = FALSE AND batch_id IS NOT NULL)
        OR (is_batch_managed = TRUE AND batch_id IS NULL)`);
  check('E1/E2: batch exclusivity holds for every production record', e1.rows[0].n === 0);

  // E3: a split parent never carries records of its own.
  const e3 = await owner.query(
    `SELECT count(*)::int AS n FROM production_record WHERE has_child_work_order = TRUE`
  );
  check('E3: no production record belongs directly to a split parent', e3.rows[0].n === 0);

  // The flags on a record must agree with the work order it points at,
  // otherwise the composite FK is being satisfied by stale duplication.
  const flagDrift = await owner.query(`
    SELECT count(*)::int AS n FROM production_record pr JOIN work_order wo ON wo.id = pr.work_order_id
     WHERE pr.is_batch_managed <> wo.is_batch_managed
        OR pr.has_child_work_order <> wo.has_child_work_order`);
  check('record execution-path flags match their work order', flagDrift.rows[0].n === 0);

  // §8 A2: a plan line's planned quantity is a decision, never SUM over the
  // work orders of its routing. Detect the double-count if anyone ever wrote it.
  const crossProcess = await owner.query(`
    SELECT ppl.id, ppl.planned_quantity, SUM(wo.planned_quantity) AS wo_total, COUNT(wo.id) AS wo_count
      FROM production_plan_line ppl
      JOIN work_order wo ON wo.production_plan_line_id = ppl.id AND wo.parent_work_order_id IS NULL
     GROUP BY ppl.id, ppl.planned_quantity
    HAVING COUNT(wo.id) > 1 AND ppl.planned_quantity = SUM(wo.planned_quantity)`);
  check(
    '§8 A2: no plan line equals the SUM of its work orders across processes',
    crossProcess.rows.length === 0,
    `${crossProcess.rows.length} plan line(s) look cross-process summed`
  );

  // Each (plan line, process) has at most one root work order — the generation
  // idempotency rule, checked against the data rather than the index.
  const duplicateWo = await owner.query(`
    SELECT production_plan_line_id, process_id, count(*)::int AS n
      FROM work_order
     WHERE production_plan_line_id IS NOT NULL AND process_id IS NOT NULL
       AND parent_work_order_id IS NULL
     GROUP BY production_plan_line_id, process_id HAVING count(*) > 1`);
  check(
    'MES-041: one root Work Order per (plan line, process)',
    duplicateWo.rows.length === 0,
    `${duplicateWo.rows.length} duplicate pair(s)`
  );

  // =====================================================================
  console.log('\n4. Process chain integrity (§6, MES-018)');
  // =====================================================================

  const selfPredecessor = await owner.query(
    'SELECT count(*)::int AS n FROM work_order WHERE predecessor_work_order_id = id'
  );
  check('no work order is its own predecessor', selfPredecessor.rows[0].n === 0);

  const danglingPredecessor = await owner.query(`
    SELECT count(*)::int AS n FROM work_order wo
     WHERE wo.predecessor_work_order_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM work_order p WHERE p.id = wo.predecessor_work_order_id)`);
  check('every predecessor reference resolves', danglingPredecessor.rows[0].n === 0);

  // A chain must be a chain: at most one successor per predecessor within a
  // plan line, otherwise the routing forked without a split.
  const forked = await owner.query(`
    SELECT predecessor_work_order_id, count(*)::int AS n
      FROM work_order
     WHERE predecessor_work_order_id IS NOT NULL AND parent_work_order_id IS NULL
     GROUP BY predecessor_work_order_id HAVING count(*) > 1`);
  check(
    'no root work order has two successors on the same chain',
    forked.rows.length === 0,
    `${forked.rows.length} forked node(s)`
  );

  // §8 A1b: a split parent's planned quantity equals the sum of its children.
  const splitMismatch = await owner.query(`
    SELECT parent.wo_number, parent.planned_quantity, SUM(child.planned_quantity) AS child_total
      FROM work_order parent JOIN work_order child ON child.parent_work_order_id = parent.id
     GROUP BY parent.id, parent.wo_number, parent.planned_quantity
    HAVING SUM(child.planned_quantity) <> parent.planned_quantity`);
  check(
    '§25.7: SUM(child.planned) = parent.planned for every split',
    splitMismatch.rows.length === 0,
    splitMismatch.rows.map((r) => r.wo_number).join(', ')
  );

  // =====================================================================
  console.log('\n5. Legacy data preservation (Sprint 2)');
  // =====================================================================

  const orphanBatches = await owner.query(
    `SELECT count(*)::int AS n FROM production_batch WHERE work_order_id IS NULL OR work_order_id = ''`
  );
  check('no batch is left without a Work Order', orphanBatches.rows[0].n === 0);

  const orphanWo = await owner.query(`
    SELECT count(*)::int AS n FROM work_order
     WHERE production_plan_line_id IS NULL AND production_order_id IS NOT NULL`);
  check(
    'every legacy Work Order has a Production Plan Line',
    orphanWo.rows[0].n === 0,
    String(orphanWo.rows[0].n)
  );

  const identityMap = await owner.query(
    `SELECT count(*)::int AS n FROM migration_batch_identity_map`
  );
  check(
    'batch identity map survives the inversion (auditable after the fact)',
    Number.isInteger(identityMap.rows[0].n)
  );

  const recordsIntact = await owner.query('SELECT count(*)::int AS n FROM production_record');
  check(
    'production records preserved through migration',
    recordsIntact.rows[0].n > 0,
    `${recordsIntact.rows[0].n} records`
  );

  // =====================================================================
  console.log('\n6. OEE & machine state integration');
  // =====================================================================

  const openStates = await owner.query(`
    SELECT machine_id, count(*)::int AS n FROM machine_state_log
     WHERE ended_at IS NULL GROUP BY machine_id HAVING count(*) > 1`);
  check(
    'no machine has two open state rows (run time would double-count)',
    openStates.rows.length === 0,
    openStates.rows.map((r) => r.machine_id).join(', ')
  );

  const negativeDuration = await owner.query(
    'SELECT count(*)::int AS n FROM machine_state_log WHERE duration_seconds < 0'
  );
  check('no machine state has a negative duration', negativeDuration.rows[0].n === 0);

  const hangingDowntime = await owner.query(`
    SELECT count(*)::int AS n FROM downtime_record dr
      JOIN work_order wo ON wo.id = dr.work_order_id
     WHERE dr.status = 'ACTIVE' AND wo.status = 'COMPLETED'`);
  check(
    '§11: no COMPLETED work order has a downtime still ACTIVE',
    hangingDowntime.rows[0].n === 0,
    String(hangingDowntime.rows[0].n)
  );

  const unresolvedDuration = await owner.query(`
    SELECT count(*)::int AS n FROM downtime_record
     WHERE status = 'RESOLVED' AND (end_time IS NULL OR duration_seconds IS NULL)`);
  check('every resolved downtime has an end time and a duration', unresolvedDuration.rows[0].n === 0);

  // =====================================================================
  console.log('\n7. RBAC seed state');
  // =====================================================================

  const roles = await owner.query(
    `SELECT key FROM role_definition WHERE tenant_id = $1 AND is_system = TRUE ORDER BY key`,
    [TENANT_A]
  );
  const roleKeys = roles.rows.map((r) => r.key);
  for (const expected of [
    'ADMIN', 'EXECUTIVE', 'OPERATOR', 'PPIC', 'PRODUCTION_MANAGER', 'QUALITY', 'SALES', 'SUPERVISOR',
  ]) {
    check(`system role ${expected} exists in the database`, roleKeys.includes(expected));
  }

  const salesPerms = await owner.query(`
    SELECT rp.permission FROM role_permission rp JOIN role_definition rd ON rd.id = rp.role_id
     WHERE rd.tenant_id = $1 AND rd.key = 'SALES' ORDER BY rp.permission`, [TENANT_A]);
  const sales = salesPerms.rows.map((r) => r.permission);
  check('SALES can create a Customer Order', sales.includes('customer_order:create'));
  check('SALES holds no production_plan permission', !sales.some((p) => p.startsWith('production_plan:')));
  check('SALES holds no work_order permission', !sales.some((p) => p.startsWith('work_order:')));
  check('SALES cannot execute on the shop floor', !sales.includes('shopfloor:execute'));

  const ppicPerms = await owner.query(`
    SELECT rp.permission FROM role_permission rp JOIN role_definition rd ON rd.id = rp.role_id
     WHERE rd.tenant_id = $1 AND rd.key = 'PPIC' ORDER BY rp.permission`, [TENANT_A]);
  const ppic = ppicPerms.rows.map((r) => r.permission);
  check('PPIC keeps customer_order:view', ppic.includes('customer_order:view'));
  check('PPIC no longer creates orders', !ppic.includes('customer_order:create'));
  check('PPIC keeps production_plan:confirm', ppic.includes('production_plan:confirm'));
  check('PPIC can confirm a Work Order (ACL §22.4)', ppic.includes('work_order:confirm'));

  const confirmHolders = await owner.query(`
    SELECT rd.key FROM role_permission rp JOIN role_definition rd ON rd.id = rp.role_id
     WHERE rd.tenant_id = $1 AND rp.permission = 'work_order:confirm' ORDER BY rd.key`, [TENANT_A]);
  check(
    'work_order:confirm is held by exactly the four ACL roles',
    JSON.stringify(confirmHolders.rows.map((r) => r.key)) ===
      JSON.stringify(['ADMIN', 'PPIC', 'PRODUCTION_MANAGER', 'SUPERVISOR']),
    confirmHolders.rows.map((r) => r.key).join(', ')
  );

  // =====================================================================
  console.log('\n8. Tenant isolation as the application role (RLS)');
  // =====================================================================

  if (!APP_URL) {
    check('APP_DATABASE_URL configured so RLS can be tested as factory_app', false, 'not set');
  } else {
    // A second tenant with one row of its own, so "cannot see" is a real claim
    // rather than an empty table.
    await owner.query(
      `INSERT INTO tenant (id, name, timezone, plan, status)
       VALUES ($1, 'QA Isolation Probe', 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_B]
    );
    await owner.query(
      `INSERT INTO customer (id, tenant_id, code, name, status)
       VALUES ('cust-qa-probe', $1, 'QA-PROBE', 'Probe Customer', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_B]
    );

    const app = new pg.Client({ connectionString: APP_URL });
    await app.connect();
    try {
      const role = await app.query(
        'SELECT rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user'
      );
      check(
        'the application role is NOSUPERUSER and NOBYPASSRLS',
        role.rows[0] && !role.rows[0].superuser && !role.rows[0].bypass,
        JSON.stringify(role.rows[0])
      );

      // Declared as tenant A: tenant B's customer must be invisible.
      const crossRead = await asTenant(app, TENANT_A, () =>
        app.query('SELECT count(*)::int AS n FROM customer WHERE tenant_id = $1', [TENANT_B])
      );
      check(
        "tenant A cannot read tenant B's customers",
        crossRead.rows[0].n === 0,
        `saw ${crossRead.rows[0].n}`
      );

      // The probe row is genuinely there — proving the zero above is isolation
      // rather than an empty table.
      const ownerSees = await owner.query(
        'SELECT count(*)::int AS n FROM customer WHERE tenant_id = $1',
        [TENANT_B]
      );
      check('the probe row exists (so the zero above means isolation)', ownerSees.rows[0].n === 1);

      // Declared as tenant B: it sees its own row and none of tenant A's.
      const ownRead = await asTenant(app, TENANT_B, () =>
        app.query('SELECT count(*)::int AS n FROM customer')
      );
      check("tenant B sees exactly its own customer", ownRead.rows[0].n === 1, String(ownRead.rows[0].n));

      // Writing another tenant's id must be refused by WITH CHECK.
      let writeRefused = false;
      try {
        await asTenant(app, TENANT_A, () =>
          app.query(
            `INSERT INTO customer (id, tenant_id, code, name, status)
             VALUES ('cust-qa-crosswrite', $1, 'QA-CROSS', 'Cross Write', 'ACTIVE')`,
            [TENANT_B]
          )
        );
      } catch {
        writeRefused = true;
      }
      check('a cross-tenant INSERT is refused by the policy', writeRefused);

      // With no tenant declared at all, nothing is visible.
      const undeclared = await app.query('SELECT count(*)::int AS n FROM customer');
      check(
        'a connection that declares no tenant sees nothing',
        undeclared.rows[0].n === 0,
        `saw ${undeclared.rows[0].n}`
      );

      // The same, for the tables Sprint 3–6 added.
      for (const table of [
        'customer_order', 'customer_order_line', 'production_plan', 'production_plan_line',
        'production_plan_demand', 'demand_forecast', 'capacity_plan', 'outbox_event', 'planning_job',
      ]) {
        const rows = await app.query(`SELECT count(*)::int AS n FROM ${table}`);
        check(`${table}: invisible without a declared tenant`, rows.rows[0].n === 0);
      }
    } finally {
      await app.end();
      await owner.query('DELETE FROM customer WHERE id IN ($1, $2)', [
        'cust-qa-probe',
        'cust-qa-crosswrite',
      ]);
      await owner.query('DELETE FROM tenant WHERE id = $1', [TENANT_B]);
    }
  }

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length > 0) {
    console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  }
} catch (error) {
  failed += 1;
  console.error('\nException:', error);
} finally {
  await owner.end();
}

process.exit(failed > 0 ? 1 : 0);
