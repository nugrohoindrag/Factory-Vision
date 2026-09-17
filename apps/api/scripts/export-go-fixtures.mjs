/**
 * Exports the tables the Go backend must agree with, from the TypeScript that
 * defines them today.
 *
 * The Go rewrite (`apps/api-go`) hand-writes its permission catalogue and its
 * route → permission table so the policy stays readable on one screen — but
 * "readable" is not "correct". Correct means identical to what the Node API
 * enforces, and this script is how that is checked: it writes the TypeScript
 * truth to JSON, and a Go test compares the hand-written tables against it.
 * CI regenerates the fixtures and fails on `git diff`, so the two cannot drift
 * while both exist. When the Node runtime is removed, the JSON stays as the
 * frozen contract snapshot.
 *
 *   node --import tsx apps/api/scripts/export-go-fixtures.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const outDir = path.resolve(apiRoot, '../api-go/fixtures');

const { PERMISSION_CATALOG, SYSTEM_ROLE_PERMISSIONS, ROLE_LANDING_PATH, ROLE_DESCRIPTION } =
  await import('../src/modules/rbac/permissions.ts');
const { permissionForRoute, PUBLIC_API_PATHS } = await import(
  '../src/platform/auth/route-permissions.ts'
);

// --- Route inventory ---------------------------------------------------
//
// Read from the sources, the same way `audit-route-permissions.mjs` does, so
// this can run without a database. The mount map is copied rather than shared
// because the audit script runs `main` on import.

const ROUTE_PATTERNS = [
  /\bapp\.(get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]+)['"`]/g,
  /\brouter\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/g,
];

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
  'routes/onboarding.routes.ts': '/api/v1',
  'routes/event.routes.ts': '/api/v1',
  'routes/material.routes.ts': '/api/v1',
  'routes/quality.routes.ts': '/api/v1',
  'routes/maintenance.routes.ts': '/api/v1',
  'routes/workforce.routes.ts': '/api/v1',
  'routes/wip.routes.ts': '/api/v1',
  'routes/production-board.routes.ts': '/api/v1',
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
      if (pattern.source.startsWith('\\brouter')) {
        if (!mount) continue;
        routePath = `${mount}${routePath}`;
      }
      routes.push({ method, path: routePath, file: relative });
    }
  }
}

// Stable order and no duplicates: the same route registered twice (Express
// keeps the first) must not produce two golden rows.
const seen = new Set();
const inventory = routes
  .filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  // Byte-wise, not localeCompare: the latter follows the machine's locale,
  // and an export that sorts differently on a Windows laptop and a Linux
  // runner fails the "fixtures are current" check for no real reason.
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.method < b.method ? -1 : a.method > b.method ? 1 : 0));

// --- Golden permission table --------------------------------------------
//
// `permissionForRoute` matches a pattern's `:param` against a concrete path
// segment, so the inventory path is made concrete the way `meta.routes.ts`
// does (`:id` → `x`). `null` means the middleware falls back to
// `dashboard:view`; `public` means the middleware never consults the table.

const golden = inventory
  .filter((r) => r.path.startsWith('/api/v1'))
  .map((r) => {
    const concrete = r.path.replace(/:[^/]+/g, 'x');
    const isPublic = PUBLIC_API_PATHS.has(r.path);
    return {
      method: r.method,
      path: r.path,
      concretePath: concrete,
      public: isPublic,
      permission: isPublic ? null : (permissionForRoute(r.method, concrete) ?? null),
    };
  });

// --- Endpoint documentation inventory -----------------------------------
//
// `ENDPOINTS` in meta.routes.ts is not exported; it is a literal array, so a
// regex over the source is the least invasive way to read it.

const metaSource = fs.readFileSync(path.join(apiRoot, 'src/routes/meta.routes.ts'), 'utf-8');
const endpoints = [];
const endpointPattern =
  /method:\s*'([A-Z]+)',\s*path:\s*'([^']+)',\s*summary:\s*'([^']*)'/g;
let m;
while ((m = endpointPattern.exec(metaSource)) !== null) {
  endpoints.push({ method: m[1], path: m[2], summary: m[3] });
}

// --- Write -------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });

function write(name, value) {
  const target = path.join(outDir, name);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`[fixtures] ${path.relative(process.cwd(), target)}`);
}

write('permission-catalog.json', PERMISSION_CATALOG);
write('system-role-permissions.json', SYSTEM_ROLE_PERMISSIONS);
write('role-landing-paths.json', ROLE_LANDING_PATH);
write('role-descriptions.json', ROLE_DESCRIPTION);
write('public-api-paths.json', [...PUBLIC_API_PATHS].sort());
write('routes.node.json', inventory);
write('route-permissions.golden.json', golden);
write('endpoints.json', endpoints);

console.log(
  `[fixtures] ${inventory.length} routes, ${golden.length} under /api/v1, ` +
    `${PERMISSION_CATALOG.length} permissions, ${endpoints.length} documented endpoints.`
);
