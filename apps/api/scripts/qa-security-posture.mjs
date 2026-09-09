/**
 * Security gate — the MUST controls of the Cyber Security Requirement, checked
 * against a running API rather than against the source.
 *
 * Each check corresponds to a line in the Definition of Done (§72), and each
 * one closed a gap found by reading the requirement against the code: an open
 * realtime channel, a wildcard CORS policy, no headers, no lockout, and a
 * public trial form that accepted a six-character password.
 *
 *   QA_API=http://localhost:4000 node apps/api/scripts/qa-security-posture.mjs
 */
const BASE = process.env.QA_API || process.env.API_BASE || 'http://localhost:4000';
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-pilot-factory-01';

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

async function call(method, endpoint, { body, headers = {}, token } = {}) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  return { status: res.status, headers: res.headers, body: payload };
}

console.log(`\nSecurity posture — ${BASE}\n`);

// --- §29 Security headers ---------------------------------------------
{
  const res = await call('GET', '/health');
  const required = [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'strict-transport-security',
  ];
  for (const header of required) {
    check(`header ${header} terkirim`, Boolean(res.headers.get(header)), 'header absent');
  }
  check(
    'X-Powered-By tidak diumumkan',
    !res.headers.get('x-powered-by'),
    res.headers.get('x-powered-by') ?? ''
  );
}

// --- §11 Backend authorization ----------------------------------------
{
  const res = await call('GET', '/api/v1/work-orders');
  check('endpoint terproteksi menolak permintaan tanpa sesi', res.status === 401, `status ${res.status}`);
}

// --- §28 CORS allowlist -----------------------------------------------
{
  const res = await call('GET', '/health', { headers: { Origin: 'https://evil.example.net' } });
  const allowed = res.headers.get('access-control-allow-origin');
  check('origin asing tidak mendapat izin CORS', !allowed, `Access-Control-Allow-Origin: ${allowed}`);
}

// --- §23 Realtime handshake -------------------------------------------
{
  // Engine.IO hands out a transport session id before the namespace is
  // reached, so a sid alone proves nothing. What matters is the namespace
  // CONNECT: a rejected client gets an error packet (`44`), an accepted one
  // gets `40` and lands in a tenant room.
  const socketUrl = `${BASE}/socket.io/?EIO=4&transport=polling`;
  const open = await fetch(`${socketUrl}&tenantId=${TENANT}`);
  const opened = await open.text();
  const sid = opened.match(/"sid":"([^"]+)"/)?.[1];

  let joined = false;
  let detail = `no sid issued (status ${open.status})`;

  if (sid) {
    // `40` is the namespace connect packet; the token would ride in it.
    await fetch(`${socketUrl}&sid=${sid}&tenantId=${TENANT}`, { method: 'POST', body: '40' });
    const poll = await fetch(`${socketUrl}&sid=${sid}&tenantId=${TENANT}`);
    const answer = await poll.text();
    joined = /^\d*4?0\{?"?sid/.test(answer) || /40\{"sid"/.test(answer);
    detail = answer.slice(0, 140);
  }

  check('realtime menolak koneksi tanpa sesi', !joined, detail);
}

// --- §4.1 Password policy on the public path --------------------------
{
  const res = await call('POST', '/api/v1/auth/trial-register', {
    body: {
      fullName: 'QA Posture',
      email: `qa-posture-${Date.now()}@example.com`,
      password: 'short12',
      factoryName: `QA Posture ${Date.now()}`,
      industry: 'general',
    },
  });
  check(
    'pendaftaran trial menolak kata sandi di bawah kebijakan',
    res.status === 422,
    `status ${res.status}`
  );
}

// --- §7 Brute-force lockout -------------------------------------------
{
  // An account that does not exist, so a real administrator is never locked
  // out by running this suite.
  const email = `qa-lockout-${Date.now()}@example.com`;
  let sawLock = false;
  for (let attempt = 0; attempt < 12 && !sawLock; attempt += 1) {
    const res = await call('POST', '/api/v1/auth/login', {
      body: { email, password: `wrong-password-${attempt}` },
    });
    if (res.status === 429) sawLock = true;
  }
  check('login gagal berulang memicu penguncian sementara', sawLock, 'no 429 within 12 attempts');
}

// --- §8 Operator PIN lockout ------------------------------------------
{
  const employeeNumber = `QA-${Date.now()}`;
  let sawLock = false;
  for (let attempt = 0; attempt < 10 && !sawLock; attempt += 1) {
    const res = await call('POST', '/api/v1/auth/operator-login', {
      body: { employeeNumber, pin: '284617' },
    });
    if (res.status === 429) sawLock = true;
  }
  check('PIN operator terkunci setelah percobaan berulang', sawLock, 'no 429 within 10 attempts');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailing checks:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
