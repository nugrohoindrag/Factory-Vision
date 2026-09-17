/**
 * Differential check of the vendor API (/api/internal/v1) between two API
 * instances over the same database (GO_API under test, NODE_API the
 * reference — historically the Node implementation, today any known-good
 * build), both logged in as the same internal administrator, replaying the
 * GET routes and diffing the normalised JSON.
 *
 *   INTERNAL_ADMIN_EMAIL=... INTERNAL_ADMIN_PASSWORD=... node scripts/qa-internal-diff.mjs
 *
 * The credentials come from the environment, never from this file: the
 * script lives in a public repository. Exits non-zero on any difference
 * outside the allowlist below.
 */
const GO = process.env.GO_API || 'http://localhost:4000';
const NODE = process.env.NODE_API || 'http://localhost:4001';
const EMAIL = process.env.INTERNAL_ADMIN_EMAIL;
const PASSWORD = process.env.INTERNAL_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set INTERNAL_ADMIN_EMAIL and INTERNAL_ADMIN_PASSWORD.');
  process.exit(2);
}

// Node reads DATE columns as local-midnight Dates and renders them through
// toISOString(), which in Asia/Jakarta lands on the previous UTC day; the Go
// API returns the stored date. Everything derived from renewsAt differs by
// that one day, so the client overview routes are allowed to differ.
const ALLOW = [/\/clients(\/[^/]+)?$/, /\/subscriptions$/];

const VOLATILE = new Set([
  'sessionId', 'issuedAt', 'expiresAt', 'idleExpiresAt', 'token', 'lastLoginAt', 'updatedAt',
  'occurredAt', 'id', 'capturedOn', 'lastActivityAt', 'daysSinceActivity',
]);

function normalise(value) {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE.has(key) || value[key] === null || value[key] === undefined) continue;
      out[key] = normalise(value[key]);
    }
    return out;
  }
  return value;
}

async function login(base) {
  const response = await fetch(`${base}/api/internal/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${base} login ${response.status} ${JSON.stringify(body)}`);
  return body.token;
}

const get = async (base, token, path) => {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const goToken = await login(GO);
const nodeToken = await login(NODE);

const clients = await get(GO, goToken, '/api/internal/v1/clients');
const firstClient = clients.body?.[0]?.client?.id;
const paths = [
  '/api/internal/v1/auth/session',
  '/api/internal/v1/summary',
  '/api/internal/v1/plans',
  '/api/internal/v1/clients',
  '/api/internal/v1/support-access',
  '/api/internal/v1/audit?limit=5',
  '/api/internal/v1/staff',
];
if (firstClient) {
  paths.push(
    `/api/internal/v1/clients/${firstClient}`,
    `/api/internal/v1/clients/${firstClient}/subscriptions`,
    `/api/internal/v1/clients/${firstClient}/usage`,
    `/api/internal/v1/clients/${firstClient}/support-access`
  );
}

let identical = 0;
let allowed = 0;
let unexpected = 0;
for (const path of paths) {
  const [go, node] = await Promise.all([get(GO, goToken, path), get(NODE, nodeToken, path)]);
  const same =
    go.status === node.status && JSON.stringify(normalise(go.body)) === JSON.stringify(normalise(node.body));
  if (same) {
    identical += 1;
    continue;
  }
  const tolerated = ALLOW.some((pattern) => pattern.test(path.split('?')[0]));
  if (tolerated) allowed += 1;
  else unexpected += 1;
  console.log(
    `${tolerated ? 'ALLOW' : 'DIFF '} ${path}\n  go   ${go.status} ${JSON.stringify(normalise(go.body)).slice(0, 300)}\n  node ${node.status} ${JSON.stringify(normalise(node.body)).slice(0, 300)}`
  );
}

// Without a session the vendor API answers 401 with the envelope.
const anonymous = await fetch(`${GO}/api/internal/v1/summary`);
const anonymousBody = await anonymous.json().catch(() => null);
const anonymousOk = anonymous.status === 401 && anonymousBody?.error?.code === 'UNAUTHENTICATED';
console.log(
  `${identical} identical, ${allowed} allowed differences, ${unexpected} unexpected; anonymous → ${anonymous.status} ${anonymousOk ? 'ok' : 'WRONG'}`
);
process.exit(unexpected === 0 && anonymousOk ? 0 : 1);
