/**
 * Audits every registered API route against the permission table.
 *
 * `authorizeRoutes` falls back to `dashboard:view` for any route with no rule.
 * That fallback is deliberate — a new endpoint should be guarded by accident
 * rather than open by accident — but it is only safe for *reads*. A mutating
 * endpoint that falls through is effectively public to every signed-in user,
 * which is how `POST /work-orders/:id/confirm` ended up reachable by anyone
 * holding `dashboard:view`.
 *
 * So: walk the Express router, resolve each route through the same function the
 * middleware uses, and fail on any mutating route that has no explicit rule.
 *
 *   node --import tsx scripts/audit-route-permissions.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');

const { permissionForRoute, PUBLIC_API_PATHS } = await import(
  '../src/platform/auth/route-permissions.ts'
);

/**
 * Routes are read from the sources rather than from a booted app: booting
 * requires a database and a seeded tenant, and this check has to be runnable in
 * CI without either.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ROUTE_PATTERNS = [
  // app.post('/api/v1/...', ...)
  /\bapp\.(get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]+)['"`]/g,
  // router.post('/work-orders/:id/confirm', ...) inside a module router
  /\brouter\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/g,
];

/** Where each router file is mounted, so a router path becomes a full path. */
const ROUTER_MOUNTS = {
  'routes/auth.routes.ts': '/api/v1',
  'routes/rbac.routes.ts': '/api/v1',
  'routes/shift.routes.ts': '/api/v1',
  'routes/csv.routes.ts': '/api/v1',
  'routes/oee.routes.ts': '/api/v1',
  'routes/meta.routes.ts': '/api/v1',
  'routes/work-order.routes.ts': '/api/v1',
  'routes/internal.routes.ts': '/api/internal/v1',
  'modules/planning/api/customer.routes.ts': '/api/v1',
  'modules/planning/api/customer-order.routes.ts': '/api/v1',
  'modules/planning/api/demand-forecast.routes.ts': '/api/v1',
  'modules/planning/api/capacity-plan.routes.ts': '/api/v1',
  'modules/planning/api/production-plan.routes.ts': '/api/v1',
  'modules/planning/api/index.ts': '/api/v1',
  'modules/master-data/mold.routes.ts': '/api/v1',
};

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, found);
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

const routes = [];
/**
 * Router files that declare routes but are not in ROUTER_MOUNTS.
 *
 * The map is hand-written, so a new router file used to be skipped in silence:
 * its endpoints were simply never seen, and the audit reported OK because it
 * had not looked. An audit that passes by not looking is worse than no audit,
 * so an unmapped router file is now a failure of its own.
 */
const unmappedRouterFiles = [];

for (const file of walk(path.join(apiRoot, 'src'))) {
  const relative = path.relative(path.join(apiRoot, 'src'), file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf-8');
  const mount = ROUTER_MOUNTS[relative];

  for (const pattern of ROUTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const method = match[1].toUpperCase();
      let routePath = match[2];
      const isRouter = pattern.source.startsWith('\\brouter');
      if (isRouter) {
        if (!mount) {
          if (!unmappedRouterFiles.includes(relative)) unmappedRouterFiles.push(relative);
          continue;
        }
        routePath = `${mount}${routePath}`;
      }
      routes.push({ method, path: routePath, file: relative });
    }
  }
}

// The internal vendor console has its own auth and is not covered by the
// tenant permission table.
const relevant = routes.filter((r) => r.path.startsWith('/api/v1'));

const unguarded = [];
const guarded = [];
for (const route of relevant) {
  // The login doors and the docs are public by design; the middleware lets them
  // past before it ever consults the table.
  if (PUBLIC_API_PATHS.has(route.path)) continue;

  const permission = permissionForRoute(route.method, route.path);
  if (permission === undefined && MUTATING.has(route.method)) {
    unguarded.push(route);
  } else {
    guarded.push({ ...route, permission: permission ?? 'dashboard:view (fallback)' });
  }
}

console.log(`Rute /api/v1 terdeteksi : ${relevant.length}`);
console.log(`Punya aturan eksplisit  : ${guarded.filter((g) => !g.permission.includes('fallback')).length}`);
console.log(`Read jatuh ke fallback  : ${guarded.filter((g) => g.permission.includes('fallback')).length}`);

if (unmappedRouterFiles.length > 0) {
  console.error(`\nBERKAS ROUTER TIDAK TERDAFTAR (${unmappedRouterFiles.length}):\n`);
  for (const file of unmappedRouterFiles) console.error(`  ${file}`);
  console.error(
    '\nBerkas di atas mendeklarasikan route tetapi tidak ada di ROUTER_MOUNTS, ' +
      'sehingga endpoint-nya tidak pernah diperiksa. Tambahkan mount-nya.\n'
  );
  process.exit(1);
}

if (unguarded.length > 0) {
  console.error(`\nENDPOINT MUTASI TANPA ATURAN PERMISSION (${unguarded.length}):\n`);
  for (const route of unguarded) {
    console.error(`  ${route.method.padEnd(6)} ${route.path.padEnd(52)} ${route.file}`);
  }
  console.error(
    '\nSetiap endpoint yang mengubah data wajib punya baris di route-permissions.ts. ' +
      'Tanpa itu ia jatuh ke dashboard:view, yang berarti hampir setiap peran dapat memanggilnya.\n'
  );
  process.exit(1);
}

console.log('\nOK — seluruh endpoint mutasi /api/v1 memiliki aturan permission eksplisit.');
