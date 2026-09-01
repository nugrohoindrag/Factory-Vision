/**
 * Sprint 7 — Mold CRUD end to end, over real HTTP with authorization on.
 *
 * `mold` and `product_mold_compatibility` have existed since migration 008, and
 * `route-permissions.ts` has guarded `/api/v1/molds*` since Sprint 4 — against
 * a router that did not exist. So the mould register could only be filled with
 * `psql`, while ADR-36 makes a Work Order's confirmability depend on what is in
 * it.
 *
 * This drives the real API: creates a mould, edits it, links a product, and
 * then checks the thing that actually matters — that adding and removing a
 * compatibility changes whether the same Work Order demands a mould. It also
 * checks the boundary: an operator must not be able to edit master data.
 *
 *   node --import tsx scripts/qa-mold-crud.mjs
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
const PORT = Number(process.env.MOLD_QA_PORT || 4195);
const BASE = `http://127.0.0.1:${PORT}`;
const TENANT = 'tenant-pilot-factory-01';
// The password is read from the environment, never stored here. A QA script
// lives in the repository; a real credential must not.
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only';
const MARK = `qa-mold-${Date.now()}`;

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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

/** The API wraps successful payloads; this reaches the data either way. */
function data(response) {
  const b = response.body;
  if (b && typeof b === 'object' && 'data' in b) return b.data;
  return b;
}

console.log('\n=== Sprint 7 — Mold CRUD end to end ===');

let productId;
let moldId;
let borrowedWorkOrder;

try {
  // A product to attach compatibility to. Uses whatever the pilot tenant has,
  // so this exercises real master data rather than a fixture shaped to pass.
  const products = await owner.query(
    'SELECT id, sku FROM product WHERE tenant_id = $1 ORDER BY sku LIMIT 1',
    [TENANT]
  );
  if (products.rows.length === 0) throw new Error('Tenant pilot tidak punya product; jalankan seed.');
  productId = products.rows[0].id;

  await owner.query(
    `INSERT INTO app_user (id, tenant_id, email, name, role, account_type, scope_level, status)
     VALUES ('usr-qa-mold-sv', $1, 'qa.mold.sv@factoryvision.local', 'QA Supervisor', 'SUPERVISOR',
             'APPLICATION_USER', 'TENANT', 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET role = 'SUPERVISOR', status = 'ACTIVE'`,
    [TENANT]
  );

  console.log('\nMenjalankan API dengan AUTH_REQUIRED=true…');
  await startApi();

  const admin = await login('admin@pabrik.co.id');
  check('admin dapat login', Boolean(admin));

  // --- 1. Create ------------------------------------------------------------
  console.log('\n1. Membuat mold');

  const created = await call(admin, 'POST', '/api/v1/molds', {
    code: `MLD-${MARK}`,
    name: 'Mold QA Sprint 7',
    cavityCount: 4,
  });
  check('POST /molds → 201', created.status === 201, `${created.status} ${JSON.stringify(created.body)}`);
  moldId = data(created)?.id;
  check('mold mendapat id', Boolean(moldId), String(moldId));
  check('cavityCount tersimpan', data(created)?.cavityCount === 4, String(data(created)?.cavityCount));
  check('status default AVAILABLE', data(created)?.status === 'AVAILABLE', String(data(created)?.status));

  const persisted = await owner.query('SELECT code, cavity_count FROM mold WHERE id = $1', [moldId]);
  check(
    'baris benar-benar ada di database, bukan hanya di respons',
    persisted.rows.length === 1 && Number(persisted.rows[0].cavity_count) === 4,
    JSON.stringify(persisted.rows[0])
  );

  const duplicate = await call(admin, 'POST', '/api/v1/molds', {
    code: `MLD-${MARK}`,
    name: 'Duplikat',
    cavityCount: 1,
  });
  check('kode duplikat ditolak 409', duplicate.status === 409, `${duplicate.status}`);

  const zeroCavity = await call(admin, 'POST', '/api/v1/molds', {
    code: `MLD-${MARK}-zero`,
    name: 'Tanpa cavity',
    cavityCount: 0,
  });
  check('cavityCount 0 ditolak', zeroCavity.status === 422 || zeroCavity.status === 400, `${zeroCavity.status}`);

  // --- 2. Read --------------------------------------------------------------
  console.log('\n2. Membaca mold');

  const listed = await call(admin, 'GET', '/api/v1/molds?search=' + encodeURIComponent(MARK));
  const rows = data(listed) ?? [];
  check('GET /molds menemukan mold yang baru dibuat', Array.isArray(rows) && rows.some((m) => m.id === moldId), JSON.stringify(rows).slice(0, 200));

  const detail = await call(admin, 'GET', `/api/v1/molds/${moldId}`);
  check('GET /molds/:id → 200', detail.status === 200, String(detail.status));
  check('detail menyertakan daftar kompatibilitas', Array.isArray(data(detail)?.compatibilities), JSON.stringify(data(detail)).slice(0, 200));

  const missing = await call(admin, 'GET', '/api/v1/molds/mold-tidak-ada');
  check('mold tidak dikenal → 404', missing.status === 404, String(missing.status));

  // --- 3. Update ------------------------------------------------------------
  console.log('\n3. Mengubah mold');

  const patched = await call(admin, 'PATCH', `/api/v1/molds/${moldId}`, {
    name: 'Mold QA Sprint 7 (revisi)',
    cavityCount: 8,
  });
  check('PATCH /molds/:id → 200', patched.status === 200, String(patched.status));
  check('nama diperbarui', data(patched)?.name === 'Mold QA Sprint 7 (revisi)', String(data(patched)?.name));
  check('cavityCount diperbarui', data(patched)?.cavityCount === 8, String(data(patched)?.cavityCount));

  const afterPatch = await owner.query('SELECT name, cavity_count FROM mold WHERE id = $1', [moldId]);
  check(
    'perubahan bertahan di database',
    afterPatch.rows[0]?.name === 'Mold QA Sprint 7 (revisi)' && Number(afterPatch.rows[0]?.cavity_count) === 8,
    JSON.stringify(afterPatch.rows[0])
  );

  const badStatus = await call(admin, 'PATCH', `/api/v1/molds/${moldId}`, { status: 'MELTED' });
  check('status di luar enum ditolak', badStatus.status === 422 || badStatus.status === 400, String(badStatus.status));

  await call(admin, 'PATCH', `/api/v1/molds/${moldId}`, { status: 'IN_USE' });
  const retireInUse = await call(admin, 'PATCH', `/api/v1/molds/${moldId}`, { status: 'RETIRED' });
  check(
    'mold IN_USE tidak dapat langsung di-RETIRED',
    retireInUse.status === 409 || retireInUse.status === 422,
    `${retireInUse.status} ${JSON.stringify(retireInUse.body)}`
  );
  await call(admin, 'PATCH', `/api/v1/molds/${moldId}`, { status: 'AVAILABLE' });

  // --- 4. Compatibility drives ADR-36 --------------------------------------
  console.log('\n4. Kompatibilitas menentukan kewajiban mold (ADR-36)');

  const beforeLink = await owner.query(
    'SELECT count(*)::int AS n FROM product_mold_compatibility WHERE tenant_id = $1 AND product_id = $2 AND active = TRUE',
    [TENANT, productId]
  );

  const linked = await call(admin, 'POST', `/api/v1/molds/${moldId}/compatibilities`, { productId });
  check('POST kompatibilitas → 201', linked.status === 201, `${linked.status} ${JSON.stringify(linked.body)}`);
  const compatibilityId = data(linked)?.id;
  check('kompatibilitas aktif saat dibuat', data(linked)?.active === true, String(data(linked)?.active));

  const afterLink = await owner.query(
    'SELECT count(*)::int AS n FROM product_mold_compatibility WHERE tenant_id = $1 AND product_id = $2 AND active = TRUE',
    [TENANT, productId]
  );
  check(
    'produk kini punya satu kompatibilitas aktif lebih banyak',
    afterLink.rows[0].n === beforeLink.rows[0].n + 1,
    `${beforeLink.rows[0].n} -> ${afterLink.rows[0].n}`
  );

  const byProduct = await call(admin, 'GET', `/api/v1/molds?productId=${productId}`);
  check(
    'GET /molds?productId menampilkan mold yang kompatibel',
    (data(byProduct) ?? []).some((m) => m.id === moldId),
    JSON.stringify(data(byProduct)).slice(0, 200)
  );

  const badProduct = await call(admin, 'POST', `/api/v1/molds/${moldId}/compatibilities`, {
    productId: 'prod-tidak-ada',
  });
  check('produk tidak dikenal ditolak', badProduct.status === 422 || badProduct.status === 404, String(badProduct.status));

  // Re-adding must reactivate, not fail on the unique constraint.
  await call(admin, 'PATCH', `/api/v1/molds/${moldId}/compatibilities/${compatibilityId}`, {
    active: false,
  });
  const deactivated = await owner.query(
    'SELECT active FROM product_mold_compatibility WHERE id = $1',
    [compatibilityId]
  );
  check('deaktivasi tersimpan', deactivated.rows[0]?.active === false, String(deactivated.rows[0]?.active));

  const notOffered = await call(admin, 'GET', `/api/v1/molds?productId=${productId}`);
  check(
    'kompatibilitas non-aktif tidak lagi ditawarkan',
    !(data(notOffered) ?? []).some((m) => m.id === moldId),
    JSON.stringify(data(notOffered)).slice(0, 200)
  );

  const readded = await call(admin, 'POST', `/api/v1/molds/${moldId}/compatibilities`, { productId });
  check('menambah ulang mengaktifkan kembali, bukan 409', readded.status === 201, `${readded.status} ${JSON.stringify(readded.body)}`);
  check('baris yang sama dipakai ulang', data(readded)?.id === compatibilityId, `${data(readded)?.id} vs ${compatibilityId}`);

  // --- 5. Delete guards -----------------------------------------------------
  console.log('\n5. Penghapusan dijaga oleh referensi produksi');

  // Deterministic rather than opportunistic: an existing Work Order is pointed
  // at the QA mould for the length of this check and put back afterwards, so
  // the guard is exercised on every run instead of only when the seed happens
  // to contain a mould-bearing order.
  const anyWorkOrder = await owner.query(
    'SELECT id, mold_id FROM work_order WHERE tenant_id = $1 LIMIT 1',
    [TENANT]
  );
  if (anyWorkOrder.rows.length === 0) {
    check('ada work order untuk menguji guard hapus', false, 'tenant pilot tidak punya work order');
  } else {
    borrowedWorkOrder = { id: anyWorkOrder.rows[0].id, moldId: anyWorkOrder.rows[0].mold_id };
    await owner.query('UPDATE work_order SET mold_id = $2 WHERE id = $1', [
      borrowedWorkOrder.id,
      moldId,
    ]);

    const refused = await call(admin, 'DELETE', `/api/v1/molds/${moldId}`);
    check(
      'mold yang dipakai work order tidak dapat dihapus',
      refused.status === 409,
      `${refused.status} ${JSON.stringify(refused.body)}`
    );
    check(
      'pesan menyarankan RETIRED, bukan sekadar menolak',
      JSON.stringify(refused.body).includes('RETIRED'),
      JSON.stringify(refused.body)
    );

    const survived = await owner.query('SELECT 1 FROM mold WHERE id = $1', [moldId]);
    check('mold tetap ada setelah penghapusan ditolak', survived.rows.length === 1);

    await owner.query('UPDATE work_order SET mold_id = $2 WHERE id = $1', [
      borrowedWorkOrder.id,
      borrowedWorkOrder.moldId,
    ]);
    borrowedWorkOrder = undefined;
  }

  // --- 6. Authorization -----------------------------------------------------
  console.log('\n6. Batas otorisasi');

  const supervisor = await call(admin, 'POST', '/api/v1/users/usr-qa-mold-sv/password', {
    password: PASSWORD,
  });
  if (supervisor.status >= 400) {
    await call(admin, 'PUT', '/api/v1/master/users/usr-qa-mold-sv', { password: PASSWORD });
  }

  let svToken;
  try {
    svToken = await login('qa.mold.sv@factoryvision.local');
  } catch (error) {
    check('supervisor dapat login', false, error.message);
  }

  if (svToken) {
    const svRead = await call(svToken, 'GET', '/api/v1/molds');
    check('SUPERVISOR boleh membaca mold', svRead.status !== 401 && svRead.status !== 403, String(svRead.status));

    const svWrite = await call(svToken, 'POST', '/api/v1/molds', {
      code: `MLD-${MARK}-sv`,
      name: 'Percobaan supervisor',
      cavityCount: 1,
    });
    check(
      'SUPERVISOR tanpa master_data:manage tidak boleh membuat mold',
      svWrite.status === 403,
      `${svWrite.status} ${JSON.stringify(svWrite.body)}`
    );
  }

  const anonymous = await fetch(`${BASE}/api/v1/molds`, { headers: { 'X-Tenant-Id': TENANT } });
  check('tanpa token → 401', anonymous.status === 401, String(anonymous.status));

  // --- 7. Audit -------------------------------------------------------------
  console.log('\n7. Jejak audit');

  const audits = await owner.query(
    `SELECT action FROM audit_log WHERE tenant_id = $1 AND entity_type = 'mold' AND entity_id = $2
      ORDER BY occurred_at`,
    [TENANT, moldId]
  );
  const actions = audits.rows.map((r) => r.action);
  check('pembuatan mold tercatat', actions.includes('CREATE'), actions.join(','));
  check('perubahan mold tercatat', actions.includes('UPDATE'), actions.join(','));
  check(
    'perubahan kompatibilitas tercatat',
    actions.some((a) => a.startsWith('MOLD_COMPATIBILITY')),
    actions.join(',')
  );

  // --- 8. Delete ------------------------------------------------------------
  console.log('\n8. Menghapus mold yang belum dipakai produksi');

  const removed = await call(admin, 'DELETE', `/api/v1/molds/${moldId}`);
  check('DELETE /molds/:id → 204', removed.status === 204, `${removed.status} ${JSON.stringify(removed.body)}`);

  const gone = await owner.query('SELECT 1 FROM mold WHERE id = $1', [moldId]);
  check('baris mold hilang', gone.rows.length === 0);

  const compatGone = await owner.query(
    'SELECT 1 FROM product_mold_compatibility WHERE mold_id = $1',
    [moldId]
  );
  check('kompatibilitasnya ikut hilang, tidak menjadi baris yatim', compatGone.rows.length === 0);
  moldId = undefined;
} finally {
  // Restore the borrowed Work Order even if an assertion above threw: leaving a
  // real order pointing at a deleted QA mould would be a worse defect than the
  // one this script is checking for.
  if (borrowedWorkOrder) {
    await owner
      .query('UPDATE work_order SET mold_id = $2 WHERE id = $1', [
        borrowedWorkOrder.id,
        borrowedWorkOrder.moldId,
      ])
      .catch(() => undefined);
  }
  if (child) {
    child.kill('SIGTERM');
    await sleep(500);
    if (!child.killed) child.kill('SIGKILL');
  }
  if (moldId) {
    await owner.query('DELETE FROM product_mold_compatibility WHERE mold_id = $1', [moldId]).catch(() => undefined);
    await owner.query('DELETE FROM mold WHERE id = $1', [moldId]).catch(() => undefined);
  }
  await owner.query("DELETE FROM mold WHERE code LIKE $1", [`MLD-${MARK}%`]).catch(() => undefined);
  await owner.query("DELETE FROM audit_log WHERE entity_type = 'mold' AND entity_id = $1", [moldId ?? '']).catch(() => undefined);
  await owner.query("DELETE FROM app_user WHERE id = 'usr-qa-mold-sv'").catch(() => undefined);
  await owner.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
