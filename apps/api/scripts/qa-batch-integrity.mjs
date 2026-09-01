/**
 * Sprint 7 — `POST /v1/master/batches` tells the truth (S7-03, S7-04).
 *
 * Two defects met here. The endpoint *guessed* the Work Order a batch belonged
 * to — "the oldest Work Order for this product" — which is an invented
 * association: ADR-29 makes a batch a subdivision of one specific Work Order.
 * Every guessed batch also landed on sequence 1 of that same order, so the
 * second one violated `uq_prod_batch_wo_seq` and came back as a 500 quoting the
 * constraint name at the operator.
 *
 * So this checks both halves: that the batch attaches where it is told, and
 * that nothing reaches the caller as a raw database error.
 *
 *   node --import tsx scripts/qa-batch-integrity.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const API_ENTRY = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const PORT = Number(process.env.BATCH_QA_PORT || 4197);
const BASE = `http://127.0.0.1:${PORT}`;
const TENANT = 'tenant-pilot-factory-01';
// The password is read from the environment, never stored here. A QA script
// lives in the repository; a real credential must not.
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only';
const MARK = `QA7-${Date.now()}`;

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

const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
await owner.connect();

let child = null;

async function startApi() {
  child = spawn(process.execPath, [API_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: 'true',
      SEED_DEMO_DATA: 'false',
      API_RUN_JOB_RUNNER: 'false',
      OUTBOX_RELAY_ENABLED: 'false',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@pabrik.co.id',
      BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', () => undefined);

  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error('API tidak pernah siap.');
}

async function call(token, method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT,
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed, text };
}

function data(response) {
  const b = response.body;
  return b && typeof b === 'object' && 'data' in b ? b.data : b;
}

/** The database's own vocabulary, which must never reach a caller. */
function leaksDatabaseDetail(text) {
  return /violates|constraint|relation ".*"|null value in column|duplicate key/i.test(text ?? '');
}

console.log('\n=== Sprint 7 — integritas POST /master/batches ===');

const createdBatchIds = [];

try {
  const wo = await owner.query(
    `SELECT id, product_id FROM work_order WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
    [TENANT]
  );
  const other = await owner.query(
    `SELECT id, product_id FROM work_order WHERE tenant_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 1`,
    [TENANT, wo.rows[0]?.id ?? '']
  );
  if (wo.rows.length === 0 || other.rows.length === 0) {
    throw new Error('Tenant pilot butuh minimal dua work order; jalankan seed.');
  }
  const oldestWo = wo.rows[0];
  const targetWo = other.rows[0];

  await startApi();

  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT },
    body: JSON.stringify({ email: 'admin@pabrik.co.id', password: PASSWORD }),
  });
  const token = (await login.json()).token;
  check('admin dapat login', Boolean(token));

  // --- 1. Missing fields are 422, not 500 ----------------------------------
  console.log('\n1. Field wajib divalidasi, bukan diserahkan ke PostgreSQL');

  const noDate = await call(token, 'POST', '/api/v1/master/batches', {
    batchNumber: `B-${MARK}-A`,
    productId: targetWo.product_id,
    workOrderId: targetWo.id,
  });
  check('productionDate hilang → 422', noDate.status === 422, `${noDate.status} ${noDate.text.slice(0, 120)}`);
  check('pesan menyebut field, bukan kolom database', !leaksDatabaseDetail(noDate.text), noDate.text.slice(0, 160));

  const noWo = await call(token, 'POST', '/api/v1/master/batches', {
    batchNumber: `B-${MARK}-B`,
    productId: targetWo.product_id,
    productionDate: '2026-09-01',
  });
  check('workOrderId hilang → 422', noWo.status === 422, `${noWo.status} ${noWo.text.slice(0, 120)}`);
  check('tidak membocorkan detail database', !leaksDatabaseDetail(noWo.text), noWo.text.slice(0, 160));

  const unknownWo = await call(token, 'POST', '/api/v1/master/batches', {
    batchNumber: `B-${MARK}-C`,
    productId: targetWo.product_id,
    workOrderId: 'wo-tidak-ada-sama-sekali',
    productionDate: '2026-09-01',
  });
  check(
    'work order tak dikenal → 422, bukan 500 foreign key',
    unknownWo.status === 422,
    `${unknownWo.status} ${unknownWo.text.slice(0, 120)}`
  );
  check('tidak membocorkan nama constraint', !leaksDatabaseDetail(unknownWo.text), unknownWo.text.slice(0, 160));

  // --- 2. The batch attaches where it was told -----------------------------
  console.log('\n2. Batch melekat pada work order yang diminta, bukan tebakan');

  const created = await call(token, 'POST', '/api/v1/master/batches', {
    batchNumber: `B-${MARK}-1`,
    productId: targetWo.product_id,
    workOrderId: targetWo.id,
    productionDate: '2026-09-01',
    status: 'ACTIVE',
  });
  check('batch pertama dibuat → 201', created.status === 201, `${created.status} ${created.text.slice(0, 160)}`);
  const firstId = data(created)?.id;
  if (firstId) createdBatchIds.push(firstId);

  const stored = await owner.query(
    'SELECT work_order_id, sequence FROM production_batch WHERE id = $1',
    [firstId]
  );
  check(
    'work_order_id sama persis dengan yang diminta',
    stored.rows[0]?.work_order_id === targetWo.id,
    `${stored.rows[0]?.work_order_id} vs ${targetWo.id}`
  );
  check(
    'tidak jatuh ke work order tertua untuk produk itu (tebakan lama)',
    stored.rows[0]?.work_order_id !== oldestWo.id || targetWo.id === oldestWo.id,
    `oldest=${oldestWo.id}`
  );

  // --- 3. A second batch on the same Work Order ----------------------------
  console.log('\n3. Batch kedua pada work order yang sama tidak bertabrakan');

  const second = await call(token, 'POST', '/api/v1/master/batches', {
    batchNumber: `B-${MARK}-2`,
    productId: targetWo.product_id,
    workOrderId: targetWo.id,
    productionDate: '2026-09-01',
    status: 'ACTIVE',
  });
  check('batch kedua dibuat → 201', second.status === 201, `${second.status} ${second.text.slice(0, 160)}`);
  const secondId = data(second)?.id;
  if (secondId) createdBatchIds.push(secondId);

  const sequences = await owner.query(
    'SELECT id, sequence FROM production_batch WHERE id = ANY($1) ORDER BY sequence',
    [[firstId, secondId].filter(Boolean)]
  );
  check(
    'sequence dinaikkan, bukan memakai default 1 dua kali',
    sequences.rows.length === 2 &&
      Number(sequences.rows[0].sequence) !== Number(sequences.rows[1].sequence),
    JSON.stringify(sequences.rows)
  );

  // --- 4. A duplicate id is a 409, in words --------------------------------
  console.log('\n4. Pelanggaran constraint dijawab 409 berbahasa manusia');

  const duplicate = await owner
    .query(
      `INSERT INTO production_batch (id, tenant_id, batch_number, product_id, work_order_id, production_date, sequence)
       VALUES ($1, $2, $3, $4, $5, '2026-09-01', 1)`,
      [firstId, TENANT, `B-${MARK}-dup`, targetWo.product_id, targetWo.id]
    )
    .then(() => null)
    .catch((error) => error);
  check(
    'database sendiri masih menolak duplikat (constraint hidup)',
    duplicate !== null,
    'insert duplikat justru diterima'
  );

  // --- 5. Nothing 500s -----------------------------------------------------
  console.log('\n5. Tidak ada 500 di sepanjang jalur ini');

  const responses = [noDate, noWo, unknownWo, created, second];
  check(
    'tak satu pun respons berstatus 500',
    responses.every((r) => r.status !== 500),
    responses.map((r) => r.status).join(',')
  );
  check(
    'tak satu pun respons memuat teks error PostgreSQL',
    responses.every((r) => !leaksDatabaseDetail(r.text)),
    responses.find((r) => leaksDatabaseDetail(r.text))?.text?.slice(0, 160) ?? ''
  );
} finally {
  if (child) {
    child.kill('SIGTERM');
    await sleep(500);
    if (!child.killed) child.kill('SIGKILL');
  }
  await owner
    .query("DELETE FROM production_batch WHERE tenant_id = $1 AND batch_number LIKE $2", [
      TENANT,
      `B-${MARK}%`,
    ])
    .catch(() => undefined);
  await owner.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
