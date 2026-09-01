/**
 * Final QA — the SALES boundary over real HTTP, with authorization on.
 *
 * The unit tests assert the permission table; this asserts that the running API
 * actually enforces it. A boundary that only exists in a table is not a
 * boundary — the middleware has to refuse the request.
 *
 * Boots the API with AUTH_REQUIRED=true, signs in as each role, and calls the
 * endpoints that matter. Positive cases must not be 401/403; negative cases
 * must be 403.
 *
 *   node --import tsx scripts/qa-sales-http-boundary.mjs
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
const PORT = Number(process.env.SALES_QA_PORT || 4193);
const BASE = `http://127.0.0.1:${PORT}`;
const TENANT = 'tenant-pilot-factory-01';
// The password is read from the environment, never stored here. A QA script
// lives in the repository; a real credential must not.
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only';

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

// --- Test users, one per role under test ------------------------------
const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
await owner.connect();

const USERS = [
  { key: 'SALES', id: 'usr-qa-sales', email: 'qa.sales@factoryvision.local', name: 'QA Sales' },
  { key: 'PPIC', id: 'usr-qa-ppic', email: 'qa.ppic@factoryvision.local', name: 'QA PPIC' },
  { key: 'EXECUTIVE', id: 'usr-qa-exec', email: 'qa.exec@factoryvision.local', name: 'QA Executive' },
];

let child = null;

async function startApi() {
  child = spawn(process.execPath, [API_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_REQUIRED: 'true',
      SEED_DEMO_DATA: 'false',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@pabrik.co.id',
      BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', (d) => {
    const text = String(d);
    if (/Error|error:/.test(text)) process.stderr.write(`[api] ${text}`);
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error('API tidak pernah siap.');
}

async function login(email) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} gagal: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.token ?? body.accessToken ?? body.session?.token;
}

async function call(token, method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT,
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

try {
  // Seed the QA users with a known password hash by reusing the admin
  // bootstrap: create them through the database, then set their password via
  // the API as admin.
  for (const user of USERS) {
    await owner.query(
      `INSERT INTO app_user (id, tenant_id, email, name, role, account_type, scope_level, status)
       VALUES ($1, $2, $3, $4, $5, 'APPLICATION_USER', 'TENANT', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
      [user.id, TENANT, user.email, user.name, user.key]
    );
  }

  console.log('\nMenjalankan API dengan AUTH_REQUIRED=true…');
  await startApi();

  const adminToken = await login('admin@pabrik.co.id');
  check('admin dapat login', Boolean(adminToken));

  // Give each QA user a password through the admin API.
  for (const user of USERS) {
    const status = await call(adminToken, 'POST', `/api/v1/users/${user.id}/password`, {
      password: PASSWORD,
    });
    if (status >= 400) {
      // Older builds expose it under /master/users; try that shape too.
      await call(adminToken, 'PUT', `/api/v1/master/users/${user.id}`, { password: PASSWORD });
    }
  }

  const tokens = {};
  for (const user of USERS) {
    try {
      tokens[user.key] = await login(user.email);
    } catch (error) {
      check(`${user.key} dapat login`, false, error.message);
    }
  }
  for (const user of USERS) {
    check(`${user.key} dapat login`, Boolean(tokens[user.key]));
  }

  const salesToken = tokens.SALES;
  const ppicToken = tokens.PPIC;
  const execToken = tokens.EXECUTIVE;

  if (salesToken) {
    console.log('\nSALES — yang boleh (bukan 401/403)');
    for (const [method, endpoint] of [
      ['GET', '/api/v1/customers'],
      ['GET', '/api/v1/customer-orders'],
      ['GET', '/api/v1/master/products'],
    ]) {
      const status = await call(salesToken, method, endpoint);
      check(`SALES ${method} ${endpoint} → ${status}`, status !== 401 && status !== 403, String(status));
    }

    console.log('\nSALES — yang dilarang (harus 403)');
    for (const [method, endpoint, body] of [
      ['GET', '/api/v1/production-plans'],
      ['POST', '/api/v1/production-plans', { periodStart: '2026-10-01', periodEnd: '2026-10-31' }],
      ['GET', '/api/v1/demand-forecasts'],
      ['GET', '/api/v1/capacity-plans'],
      ['POST', '/api/v1/work-orders/wo-x/confirm'],
      ['POST', '/api/v1/work-orders/wo-x/start', { operatorId: 'op-001' }],
      ['POST', '/api/v1/shop-floor/output', { workOrderId: 'wo-x' }],
      ['POST', '/api/v1/master/products', { sku: 'X', name: 'X' }],
      ['GET', '/api/v1/users'],
      ['GET', '/api/v1/audit-logs'],
    ]) {
      const status = await call(salesToken, method, endpoint, body);
      check(`SALES ${method} ${endpoint} ditolak 403`, status === 403, `dapat ${status}`);
    }
  }

  if (ppicToken) {
    console.log('\nPPIC — kepemilikan order sudah pindah');
    const createStatus = await call(ppicToken, 'POST', '/api/v1/customer-orders', {
      customerId: 'x',
      orderChannel: 'MANUAL',
      requestedDeliveryDate: '2026-10-10',
    });
    check('PPIC tidak lagi dapat membuat Customer Order', createStatus === 403, `dapat ${createStatus}`);

    const readStatus = await call(ppicToken, 'GET', '/api/v1/customer-orders');
    check('PPIC tetap dapat membaca Customer Order', readStatus !== 403, String(readStatus));

    console.log('\nPPIC — tetap memiliki planning');
    for (const [method, endpoint] of [
      ['GET', '/api/v1/production-plans'],
      ['GET', '/api/v1/demand-forecasts'],
      ['GET', '/api/v1/capacity-plans'],
    ]) {
      const status = await call(ppicToken, method, endpoint);
      check(`PPIC ${method} ${endpoint} diizinkan`, status !== 403, String(status));
    }

    const confirmStatus = await call(ppicToken, 'POST', '/api/v1/work-orders/wo-x/confirm');
    check(
      'PPIC dapat mengonfirmasi Work Order (bukan 403)',
      confirmStatus !== 403,
      `dapat ${confirmStatus}`
    );
  }

  if (execToken) {
    console.log('\nEXECUTIVE — view-only');
    const readStatus = await call(execToken, 'GET', '/api/v1/production-plans');
    check('EXECUTIVE dapat membaca Production Plan', readStatus !== 403, String(readStatus));

    const writeStatus = await call(execToken, 'POST', '/api/v1/production-plans', {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    check('EXECUTIVE tidak dapat membuat Production Plan', writeStatus === 403, `dapat ${writeStatus}`);

    const confirmStatus = await call(execToken, 'POST', '/api/v1/work-orders/wo-x/confirm');
    check(
      'EXECUTIVE tidak dapat mengonfirmasi Work Order (lubang yang ditutup)',
      confirmStatus === 403,
      `dapat ${confirmStatus}`
    );
  }

  console.log('\nTanpa token sama sekali');
  const anonymous = await fetch(`${BASE}/api/v1/customer-orders`, {
    headers: { 'X-Tenant-Id': TENANT },
  });
  check('permintaan tanpa token ditolak 401', anonymous.status === 401, String(anonymous.status));

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length > 0) {
    console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  }
} catch (error) {
  failed += 1;
  console.error('\nException:', error.message);
} finally {
  if (child) child.kill('SIGTERM');
  await owner
    .query('DELETE FROM app_user WHERE id = ANY($1)', [USERS.map((u) => u.id)])
    .catch(() => undefined);
  await owner.end();
}

process.exit(failed > 0 ? 1 : 0);
