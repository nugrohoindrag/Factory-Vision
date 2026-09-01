/**
 * Sprint 7 — the dedicated worker really executes the planning queue.
 *
 * The point of this script is that it does not trust the runner it can see. It
 * enqueues through the same path the API uses, then starts the worker as a
 * *separate operating-system process* and waits for that process to move the
 * row. If the worker were still the idle stub — or if the shared contract had
 * drifted from the API's — the job would sit PENDING and this fails.
 *
 *   node --import tsx scripts/qa-worker-queue.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
dotenv.config({ path: path.resolve(repoRoot, '.env') });

const { query, withTenant, closePool } = await import('../src/platform/db/pool.ts');
const { PostgresJobQueue, JobRunner } = await import('@factory-vision/job-queue');

const TENANT = 'tenant-pilot-factory-01';
const OTHER_TENANT = 'tenant-qa-worker-other';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = new PostgresJobQueue({ exec: { query: (t, p) => query(t, p).then((rows) => ({ rows })) }, withTenant });

// `query` returns rows, not a QueryResult, so the adapter above restores the
// shape the queue expects. The real API passes the pool itself.

async function jobStatus(id) {
  const rows = await query('SELECT status, result, last_error, attempts FROM planning_job WHERE id = $1', [id]);
  return rows[0];
}

async function waitForStatus(id, wanted, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await jobStatus(id);
    if (row && wanted.includes(row.status)) return row;
    await sleep(250);
  }
  return jobStatus(id);
}

console.log('\n=== Sprint 7 — planning queue executed by the dedicated worker ===\n');

const created = [];

try {
  // --- 1. The API's enqueue path -------------------------------------------
  console.log('1. Enqueue melalui kontrak bersama');

  const enqueued = await withTenant(TENANT, (client) =>
    queue.enqueue(
      {
        tenantId: TENANT,
        jobType: 'CAPACITY_PLAN_RECALCULATE',
        // No such plan: the handler must fail on the missing plan, which still
        // proves the worker claimed, dispatched and recorded the outcome. A
        // successful job would prove the same thing but would need a whole
        // capacity plan fixture to exist first.
        payload: { capacityPlanId: 'capplan-qa-worker-missing' },
        requestedBy: 'qa-worker-queue',
        maxAttempts: 1,
      },
      client
    )
  );
  created.push(enqueued.id);

  check('enqueue mengembalikan job PENDING', enqueued.status === 'PENDING', enqueued.status);
  check('job membawa tenant secara eksplisit (§22.4)', enqueued.tenantId === TENANT, enqueued.tenantId);

  // --- 2. Transactional enqueue --------------------------------------------
  console.log('\n2. Enqueue ikut transaksi pemanggil');

  let rolledBackId;
  await withTenant(TENANT, async (client) => {
    const job = await queue.enqueue(
      {
        tenantId: TENANT,
        jobType: 'DEMAND_FORECAST_GENERATE',
        payload: { rolledBack: true },
        requestedBy: 'qa-worker-queue',
      },
      client
    );
    rolledBackId = job.id;
    // Force the transaction to roll back. If the queue had opened its own
    // connection the job row would survive this, and a forecast job would exist
    // for a request that failed.
    throw new Error('rollback on purpose');
  }).catch(() => undefined);

  const ghost = await jobStatus(rolledBackId);
  check('job hilang bersama transaksi yang rollback', ghost === undefined, ghost && ghost.status);

  // --- 3. The worker process ------------------------------------------------
  console.log('\n3. Worker process mengeksekusi job');

  const before = await jobStatus(enqueued.id);
  check('job masih PENDING sebelum worker start', before.status === 'PENDING', before.status);

  const worker = spawn(process.execPath, [path.join(repoRoot, 'apps/worker/dist/main.js')], {
    cwd: repoRoot,
    env: { ...process.env, PLANNING_JOB_INTERVAL_MS: '500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let workerOutput = '';
  worker.stdout.on('data', (chunk) => {
    workerOutput += String(chunk);
  });
  worker.stderr.on('data', (chunk) => {
    workerOutput += String(chunk);
  });

  const settled = await waitForStatus(enqueued.id, ['SUCCEEDED', 'FAILED'], 25_000);

  check(
    'worker terpisah menyelesaikan job (bukan runner in-process)',
    settled && (settled.status === 'SUCCEEDED' || settled.status === 'FAILED'),
    settled ? `status=${settled.status}` : 'job tidak ditemukan'
  );
  check(
    'kegagalan handler tercatat pada baris job, bukan menggantung RUNNING',
    settled && settled.status === 'FAILED' && String(settled.last_error || '').length > 0,
    settled ? `status=${settled.status} error=${settled.last_error}` : ''
  );
  check(
    'attempts bertambah tepat satu kali',
    settled && Number(settled.attempts) === 1,
    settled ? `attempts=${settled.attempts}` : ''
  );
  check(
    'worker melaporkan dirinya, bukan diam',
    workerOutput.includes('worker'),
    workerOutput.slice(0, 200) || '(tidak ada output)'
  );

  worker.kill('SIGTERM');
  await sleep(500);
  if (!worker.killed) worker.kill('SIGKILL');

  // --- 4. Unknown job type does not hang a runner ---------------------------
  console.log('\n4. Job tanpa handler ditandai gagal, tidak menggantung');

  const unknownId = `job-qa-unknown-${Date.now()}`;
  await query(
    `INSERT INTO planning_job (id, tenant_id, job_type, payload, requested_by, max_attempts)
     VALUES ($1, $2, 'DEMAND_FORECAST_GENERATE', '{}'::jsonb, 'qa-worker-queue', 1)`,
    [unknownId, TENANT]
  );
  created.push(unknownId);

  const bareRunner = new JobRunner({ queue, handlers: {}, label: 'qa-empty-registry' });
  await bareRunner.runOnce();

  const orphan = await jobStatus(unknownId);
  check(
    'runner tanpa handler menandai job FAILED',
    orphan && orphan.status === 'FAILED',
    orphan ? orphan.status : 'hilang'
  );
  check(
    'alasan gagal menyebut handler yang hilang',
    orphan && String(orphan.last_error || '').includes('handler'),
    orphan ? orphan.last_error : ''
  );

  // --- 5. Claim is not blind to tenants ------------------------------------
  console.log('\n5. Claim lintas tenant tetap membawa tenant baris');

  await query(
    `INSERT INTO tenant (id, name, status) VALUES ($1, 'QA Worker Other', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [OTHER_TENANT]
  );
  const otherId = `job-qa-other-${Date.now()}`;
  await query(
    `INSERT INTO planning_job (id, tenant_id, job_type, payload, requested_by, max_attempts)
     VALUES ($1, $2, 'DEMAND_FORECAST_GENERATE', '{}'::jsonb, 'qa-worker-queue', 1)`,
    [otherId, OTHER_TENANT]
  );
  created.push(otherId);

  let seenTenant;
  const tenantRunner = new JobRunner({
    queue,
    handlers: {
      DEMAND_FORECAST_GENERATE: async (job) => {
        seenTenant = job.tenantId;
        return { ok: true };
      },
    },
    label: 'qa-tenant-runner',
  });
  await tenantRunner.runOnce();

  check(
    'handler menerima tenant dari baris job, bukan dari proses',
    seenTenant === OTHER_TENANT,
    `seen=${seenTenant}`
  );
  const otherRow = await jobStatus(otherId);
  check('job tenant lain selesai SUCCEEDED', otherRow && otherRow.status === 'SUCCEEDED', otherRow && otherRow.status);
} finally {
  for (const id of created) {
    await query('DELETE FROM planning_job WHERE id = $1', [id]).catch(() => undefined);
  }
  await query('DELETE FROM planning_job WHERE requested_by = $1', ['qa-worker-queue']).catch(() => undefined);
  await query('DELETE FROM tenant WHERE id = $1', [OTHER_TENANT]).catch(() => undefined);
  await closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
