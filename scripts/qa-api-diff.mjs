/**
 * Differential contract check: the Go API against the Node API.
 *
 * Both servers run against the same seeded database. Every GET route in the
 * exported inventory (apps/api-go/fixtures/routes.node.json) is replayed
 * against both, and status plus normalised JSON are compared. GETs are safe
 * to replay; the story script is not, which is why this only reads.
 *
 *   GO_API=http://localhost:4000 NODE_API=http://localhost:4001 \
 *     node scripts/qa-api-diff.mjs --include=/api/v1/master,/api/v1/events
 *
 *   --include=<prefix,...>   only routes under these prefixes (default: all)
 *   --allow=<prefix,...>     routes allowed to differ (reported, not failed)
 *   --verbose                print the first difference of every route
 *
 * Normalisation drops null-valued keys (Node writes `undefined` as absent,
 * Go omits nil pointers), sorts keys, and ignores fields that legitimately
 * differ between two processes: timestamps of the request itself, session
 * windows, request ids.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GO = (process.env.GO_API || 'http://localhost:4000').replace(/\/$/, '');
const NODE = (process.env.NODE_API || 'http://localhost:4001').replace(/\/$/, '');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-pilot-factory-01';
const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@pabrik.co.id';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const include = args.include ? String(args.include).split(',') : null;
const allow = args.allow ? String(args.allow).split(',') : [];
const verbose = Boolean(args.verbose);

const VOLATILE = new Set([
  'time', 'serverTime', 'requestId', 'lastSeenAt', 'idleExpiresAt', 'expiresAt', 'issuedAt',
  'sessionId', 'since', 'counters', 'currentStateSince', 'lastLoginAt',
]);

function normalise(value) {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE.has(key)) continue;
      const v = value[key];
      if (v === null || v === undefined) continue;
      out[key] = normalise(v);
    }
    return out;
  }
  return value;
}

function firstDifference(a, b, trail = '$') {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${trail}: array length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDifference(a[i], b[i], `${trail}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      if (!(key in a)) return `${trail}.${key}: missing on Go`;
      if (!(key in b)) return `${trail}.${key}: missing on Node`;
      const d = firstDifference(a[key], b[key], `${trail}.${key}`);
      if (d) return d;
    }
    return null;
  }
  if (a !== b) return `${trail}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  return null;
}

async function login(base) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`${base}: login failed ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

async function get(base, token, route) {
  const res = await fetch(base + route, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': TENANT },
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, contentType: res.headers.get('content-type') ?? '' };
}

/** Turns `/api/v1/master/users/:id` into a concrete path using the collection's first id. */
async function concretise(route, base, token) {
  if (!route.includes(':')) return route;
  const segments = route.split('/');
  const out = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg.startsWith(':')) {
      out.push(seg);
      continue;
    }
    const collection = out.join('/');
    const list = await get(base, token, collection);
    const first = Array.isArray(list.body) ? list.body[0] : Array.isArray(list.body?.data) ? list.body.data[0] : undefined;
    const id = first?.id ?? first?.[seg.slice(1)];
    if (!id) return null;
    out.push(String(id));
  }
  return out.join('/');
}

async function main() {
  const inventory = JSON.parse(
    fs.readFileSync(path.resolve(here, '../apps/api-go/fixtures/routes.node.json'), 'utf-8')
  );
  const routes = inventory
    .filter((r) => r.method === 'GET' && r.path.startsWith('/api/v1'))
    .filter((r) => !include || include.some((p) => r.path.startsWith(p)))
    // Documentation and the session probe carry deployment-specific bodies.
    .filter((r) => !['/api/v1/docs', '/api/v1/meta/openapi.json', '/api/v1/auth/mfa'].includes(r.path));

  const [goToken, nodeToken] = await Promise.all([login(GO), login(NODE)]);
  console.log(`API diff — Go ${GO} vs Node ${NODE}, ${routes.length} GET routes\n`);

  let same = 0;
  let allowed = 0;
  let skipped = 0;
  const failures = [];

  for (const route of routes) {
    const concrete = await concretise(route.path, NODE, nodeToken);
    if (!concrete) {
      skipped += 1;
      if (verbose) console.log(`  SKIP  ${route.path} (no id to substitute)`);
      continue;
    }
    const [g, n] = await Promise.all([get(GO, goToken, concrete), get(NODE, nodeToken, concrete)]);
    let difference = null;
    if (g.status !== n.status) difference = `status ${g.status} vs ${n.status}`;
    else if (typeof g.body === 'object' && typeof n.body === 'object') {
      difference = firstDifference(normalise(g.body), normalise(n.body));
    } else if (g.body !== n.body) difference = 'body differs';

    const isAllowed = allow.some((p) => concrete.startsWith(p));
    if (!difference) {
      same += 1;
      if (verbose) console.log(`  SAME  ${concrete}`);
    } else if (isAllowed) {
      allowed += 1;
      console.log(`  ALLOW ${concrete}\n        ${difference}`);
    } else {
      failures.push({ route: concrete, difference });
      console.log(`  DIFF  ${concrete}\n        ${difference}`);
    }
  }

  console.log(`\n${same} identical, ${allowed} allowed differences, ${failures.length} unexpected, ${skipped} skipped.`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
