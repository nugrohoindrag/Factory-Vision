/**
 * Pilot gate — the API running as `factory_app`, under real row-level security.
 *
 * Every other suite connects as the schema owner, which is a superuser and
 * therefore exempt from every policy. That means none of them can tell whether
 * the application actually *works* once RLS is binding — the failure mode being
 * a policy that denies a legitimate read, so a screen goes empty in production
 * and nowhere else.
 *
 * This walks the read and write surface with the production connection.
 *
 *   QA_API=http://localhost:4210 node scripts/qa-production-posture.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const BASE = process.env.QA_API || 'http://localhost:4210';
const TENANT = 'tenant-pilot-factory-01';
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@pabrik.co.id';
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

let token = '';
async function call(method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
await owner.connect();

try {
  console.log('\n1. Koneksi aplikasi benar-benar tunduk pada RLS');

  const role = await call('GET', '/api/v1/meta/deployment');
  check('API menjawab', role.status === 200 || role.status === 401, String(role.status));

  // The API reports whether its connection bypasses RLS; the pilot must not.
  const appRole = await owner.query(
    `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'factory_app'`
  );
  check(
    'peran factory_app ada, NOSUPERUSER dan NOBYPASSRLS',
    appRole.rows[0] && !appRole.rows[0].rolsuper && !appRole.rows[0].rolbypassrls,
    JSON.stringify(appRole.rows[0])
  );

  console.log('\n2. Login dan sesi');
  const login = await call('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
  check('administrator dapat login', login.status === 200, String(login.status));
  token = login.body?.token ?? '';
  check('token sesi diterbitkan', token.length > 10);

  console.log('\n3. Seluruh permukaan baca berfungsi di bawah RLS');

  const reads = [
    ['/api/v1/master/plants', 'plants'],
    ['/api/v1/master/lines', 'lines'],
    ['/api/v1/master/machines', 'machines'],
    ['/api/v1/master/products', 'products'],
    ['/api/v1/master/processes', 'processes'],
    ['/api/v1/master/operators', 'operators'],
    ['/api/v1/master/shifts', 'shifts'],
    ['/api/v1/master/downtime-reasons', 'downtime reasons'],
    ['/api/v1/master/reject-reasons', 'reject reasons'],
    ['/api/v1/work-orders', 'work orders'],
    ['/api/v1/customers', 'customers'],
    ['/api/v1/customer-orders', 'customer orders'],
    ['/api/v1/production-plans', 'production plans'],
    ['/api/v1/demand-forecasts', 'demand forecasts'],
    ['/api/v1/capacity-plans', 'capacity plans'],
    ['/api/v1/audit-logs', 'audit log'],
    ['/api/v1/planning/config', 'planning config'],
  ];

  for (const [endpoint, label] of reads) {
    const res = await call('GET', endpoint);
    check(`GET ${label} → ${res.status}`, res.status === 200, JSON.stringify(res.body).slice(0, 120));
  }

  // Master data must come back non-empty: an RLS policy that denies the read
  // returns an empty array rather than an error, which is the silent failure.
  const products = await call('GET', '/api/v1/master/products');
  check(
    'master data tidak kosong di bawah RLS (kegagalan senyap)',
    Array.isArray(products.body) && products.body.length > 0,
    `${products.body?.length ?? 0} product`
  );

  const rejectReasons = await call('GET', '/api/v1/master/reject-reasons');
  check(
    'reject reason terbaca — shop floor dapat memvalidasi reject',
    Array.isArray(rejectReasons.body) && rejectReasons.body.length > 0,
    `${rejectReasons.body?.length ?? 0} reason`
  );

  console.log('\n4. Tulis di bawah RLS');

  const stamp = Date.now().toString().slice(-6);
  const created = await call('POST', '/api/v1/customers', {
    code: `RLS-${stamp}`,
    name: 'QA RLS Posture',
  });
  check('membuat customer berhasil di bawah RLS', created.status === 201, String(created.status));

  if (created.status === 201) {
    const row = await owner.query('SELECT tenant_id FROM customer WHERE id = $1', [created.body.id]);
    check(
      'baris tersimpan dengan tenant yang benar',
      row.rows[0]?.tenant_id === TENANT,
      row.rows[0]?.tenant_id
    );
    await owner.query('DELETE FROM customer WHERE id = $1', [created.body.id]);
  }

  console.log('\n5. Analitik dan OEE di bawah RLS');
  for (const [endpoint, label] of [
    ['/api/v1/oee/report?days=7', 'laporan OEE'],
    ['/api/v1/oee/calculate?days=7', 'perhitungan OEE'],
    ['/api/v1/oee/bottlenecks?days=7', 'bottleneck'],
    ['/api/v1/analytics/downtime-pareto?days=7', 'pareto downtime'],
    ['/api/v1/reports/production?days=7', 'laporan produksi'],
  ]) {
    const res = await call('GET', endpoint);
    check(`GET ${label} → ${res.status}`, res.status === 200, JSON.stringify(res.body).slice(0, 100));
  }

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  if (failures.length) console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
} catch (error) {
  failed += 1;
  console.error('\nException:', error.message);
} finally {
  await owner.end();
}

process.exit(failed > 0 ? 1 : 0);
