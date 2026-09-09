import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PermissionId } from '@factory-vision/domain-types';
import { ApiError } from '../http/api-error.js';

/**
 * Route → permission map (US-003, US-054).
 *
 * Declaring authorization in one table rather than sprinkling a guard onto each
 * of the API's ~120 handlers is what makes "API authorization menerapkan aturan
 * yang sama dengan UI" checkable: the console renders its navigation from the
 * same permission ids, and a reviewer can read the whole policy on one screen.
 *
 * Rules are matched most-specific first. An unmatched `/api/v1` route falls
 * back to `dashboard:view`, so a new endpoint is read-only-guarded by accident
 * rather than wide open by accident.
 */

interface Rule {
  method: string | '*';
  /** Express-style pattern; `:param` matches one segment, `*` matches the rest. */
  pattern: string;
  permission: PermissionId;
}

const RULES: Rule[] = [
  // --- Master data ------------------------------------------------
  { method: 'GET', pattern: '/api/v1/master/*', permission: 'master_data:view' },

  // User administration is method-sensitive: viewing the roster is not the
  // same right as creating an account or deactivating one.
  { method: 'GET', pattern: '/api/v1/master/users*', permission: 'user:view' },
  { method: 'POST', pattern: '/api/v1/master/users', permission: 'user:create' },
  { method: 'PUT', pattern: '/api/v1/master/users/:id', permission: 'user:edit' },
  { method: 'PATCH', pattern: '/api/v1/master/users/:id/status', permission: 'user:deactivate' },
  { method: 'DELETE', pattern: '/api/v1/master/users/:id', permission: 'user:deactivate' },

  { method: '*', pattern: '/api/v1/master/kpi-targets*', permission: 'configuration:manage' },
  { method: 'GET', pattern: '/api/v1/master/devices*', permission: 'device:view' },
  { method: '*', pattern: '/api/v1/master/devices*', permission: 'device:manage' },
  { method: 'GET', pattern: '/api/v1/master/batches*', permission: 'batch:view' },
  { method: 'POST', pattern: '/api/v1/master/batches', permission: 'batch:create' },
  { method: 'PUT', pattern: '/api/v1/master/batches/:id', permission: 'batch:edit' },
  { method: '*', pattern: '/api/v1/master/*', permission: 'master_data:manage' },

  // --- Users, roles, sessions -------------------------------------
  { method: 'GET', pattern: '/api/v1/users*', permission: 'user:view' },
  { method: 'POST', pattern: '/api/v1/users', permission: 'user:create' },
  { method: 'PUT', pattern: '/api/v1/users/:id', permission: 'user:edit' },
  { method: 'PATCH', pattern: '/api/v1/users/:id/status', permission: 'user:deactivate' },
  { method: 'POST', pattern: '/api/v1/users/:id/password', permission: 'user:edit' },
  { method: 'DELETE', pattern: '/api/v1/users/:id', permission: 'user:deactivate' },
  { method: 'GET', pattern: '/api/v1/roles*', permission: 'role:view' },
  { method: 'POST', pattern: '/api/v1/roles', permission: 'role:create' },
  { method: 'PUT', pattern: '/api/v1/roles/:id', permission: 'role:edit' },
  { method: 'DELETE', pattern: '/api/v1/roles/:id', permission: 'role:edit' },
  { method: 'GET', pattern: '/api/v1/permissions', permission: 'role:view' },
  { method: 'GET', pattern: '/api/v1/security/summary', permission: 'configuration:manage' },
  { method: 'GET', pattern: '/api/v1/sessions', permission: 'user:view' },
  { method: 'DELETE', pattern: '/api/v1/sessions*', permission: 'user:deactivate' },
  { method: 'POST', pattern: '/api/v1/operators/:id/pin', permission: 'user:edit' },

  // --- Demand & planning (MES Improvement v1.0) -------------------
  { method: 'GET', pattern: '/api/v1/customers*', permission: 'customer:view' },
  { method: '*', pattern: '/api/v1/customers*', permission: 'customer:manage' },

  { method: 'GET', pattern: '/api/v1/customer-orders*', permission: 'customer_order:view' },
  { method: 'POST', pattern: '/api/v1/customer-orders/:id/cancel', permission: 'customer_order:cancel' },
  { method: 'POST', pattern: '/api/v1/customer-orders', permission: 'customer_order:create' },
  { method: '*', pattern: '/api/v1/customer-orders*', permission: 'customer_order:edit' },

  { method: 'POST', pattern: '/api/v1/demand-forecasts/generate', permission: 'demand_forecast:generate' },
  { method: 'GET', pattern: '/api/v1/demand-forecasts*', permission: 'demand_forecast:view' },

  { method: 'POST', pattern: '/api/v1/capacity-plans/:id/recalculate', permission: 'capacity_plan:manage' },
  { method: 'GET', pattern: '/api/v1/capacity-plans*', permission: 'capacity_plan:view' },
  { method: '*', pattern: '/api/v1/capacity-plans*', permission: 'capacity_plan:manage' },

  { method: 'POST', pattern: '/api/v1/production-plans/:id/confirm', permission: 'production_plan:confirm' },
  { method: 'POST', pattern: '/api/v1/production-plans/:id/cancel', permission: 'production_plan:confirm' },
  { method: 'POST', pattern: '/api/v1/production-plans/:id/generate-work-orders', permission: 'work_order:create' },
  { method: 'GET', pattern: '/api/v1/production-plans*', permission: 'production_plan:view' },
  { method: 'POST', pattern: '/api/v1/production-plans', permission: 'production_plan:create' },
  { method: '*', pattern: '/api/v1/production-plans*', permission: 'production_plan:edit' },

  { method: 'GET', pattern: '/api/v1/planning/config', permission: 'production_plan:view' },
  { method: 'PUT', pattern: '/api/v1/planning/config', permission: 'configuration:manage' },

  { method: 'GET', pattern: '/api/v1/molds*', permission: 'master_data:view' },
  { method: '*', pattern: '/api/v1/molds*', permission: 'master_data:manage' },

  // --- Planning ---------------------------------------------------
  { method: 'GET', pattern: '/api/v1/production-orders*', permission: 'production_order:view' },
  { method: 'POST', pattern: '/api/v1/production-orders/:id/release', permission: 'production_order:release' },
  { method: 'POST', pattern: '/api/v1/production-orders', permission: 'production_order:create' },
  { method: 'PUT', pattern: '/api/v1/production-orders/:id', permission: 'production_order:edit' },
  { method: 'DELETE', pattern: '/api/v1/production-orders/:id', permission: 'production_order:delete' },

  { method: 'GET', pattern: '/api/v1/work-orders*', permission: 'work_order:view' },
  // Confirmation is the gate that puts a Work Order on the operator terminal
  // (§25.7). It had no rule at all, so it fell through to `dashboard:view` and
  // every signed-in role could call it.
  { method: 'POST', pattern: '/api/v1/work-orders/:id/confirm', permission: 'work_order:confirm' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/release', permission: 'work_order:confirm' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/cancel', permission: 'work_order:cancel' },
  // Splitting divides planned work; it is a planning act, not shop-floor execution.
  { method: 'POST', pattern: '/api/v1/work-orders/:id/split', permission: 'work_order:create' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/start', permission: 'shopfloor:execute' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/pause', permission: 'shopfloor:execute' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/resume', permission: 'shopfloor:execute' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/complete', permission: 'shopfloor:execute' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/batch', permission: 'batch:edit' },
  { method: 'POST', pattern: '/api/v1/work-orders', permission: 'work_order:create' },
  { method: 'PUT', pattern: '/api/v1/work-orders/:id', permission: 'work_order:edit' },
  { method: 'DELETE', pattern: '/api/v1/work-orders/:id', permission: 'work_order:cancel' },

  // --- Shop floor -------------------------------------------------
  { method: 'GET', pattern: '/api/v1/shop-floor/*', permission: 'work_order:view' },
  { method: 'POST', pattern: '/api/v1/shop-floor/output', permission: 'production_record:create' },
  { method: 'POST', pattern: '/api/v1/shop-floor/downtime/start', permission: 'downtime:create' },
  { method: 'POST', pattern: '/api/v1/shop-floor/downtime/:id/resolve', permission: 'downtime:create' },
  { method: 'POST', pattern: '/api/v1/shop-floor/sync-batch', permission: 'shopfloor:execute' },
  // Sync exceptions (MES-082). Reading is deliberately as wide as the shop
  // floor itself — an operator must be able to see that something they
  // recorded was not accepted. Acting on one is a data-correction decision,
  // which is why it takes `production_record:correct` rather than a new
  // permission no existing role would hold.
  { method: 'GET', pattern: '/api/v1/shop-floor/sync-exceptions*', permission: 'work_order:view' },
  {
    method: 'PATCH',
    pattern: '/api/v1/shop-floor/sync-exceptions/:id',
    permission: 'production_record:correct',
  },

  // --- Shift ------------------------------------------------------
  { method: 'GET', pattern: '/api/v1/shifts*', permission: 'shift:view' },
  { method: '*', pattern: '/api/v1/shifts/handover*', permission: 'shift:handover' },
  { method: '*', pattern: '/api/v1/shifts*', permission: 'shift:manage' },

  // --- Analytics, OEE, reports ------------------------------------
  { method: 'GET', pattern: '/api/v1/analytics/*', permission: 'analytics:view' },
  { method: 'GET', pattern: '/api/v1/oee/validation*', permission: 'analytics:view' },
  { method: '*', pattern: '/api/v1/oee/validation*', permission: 'configuration:manage' },
  { method: 'GET', pattern: '/api/v1/oee/config', permission: 'analytics:view' },
  { method: 'PUT', pattern: '/api/v1/oee/config', permission: 'configuration:manage' },
  { method: 'GET', pattern: '/api/v1/oee/*', permission: 'analytics:view' },
  { method: 'GET', pattern: '/api/v1/reports/*', permission: 'report:export' },

  // --- CSV --------------------------------------------------------
  { method: 'GET', pattern: '/api/v1/csv/*', permission: 'master_data:view' },
  { method: 'POST', pattern: '/api/v1/csv/*', permission: 'master_data:import' },

  // --- Governance -------------------------------------------------
  { method: 'GET', pattern: '/api/v1/corrections*', permission: 'production_record:correct' },
  { method: 'POST', pattern: '/api/v1/corrections/:id/approve', permission: 'correction:approve' },
  { method: 'POST', pattern: '/api/v1/corrections/:id/reject', permission: 'correction:approve' },
  { method: 'POST', pattern: '/api/v1/corrections', permission: 'production_record:correct' },
  { method: 'GET', pattern: '/api/v1/audit-logs*', permission: 'audit:view' },

  // --- Self-service and tenant setup ------------------------------
  //
  // Enrolling a second factor is something an account does to itself, so the
  // only right it can require is a valid session — `dashboard:view` is the
  // narrowest permission every signed-in role holds. The middleware still
  // refuses an unauthenticated caller; these rules exist so that is a decision
  // rather than a fallback nobody chose.
  { method: 'POST', pattern: '/api/v1/auth/mfa/enroll', permission: 'dashboard:view' },
  { method: 'POST', pattern: '/api/v1/auth/mfa/confirm', permission: 'dashboard:view' },
  { method: 'POST', pattern: '/api/v1/auth/mfa/disable', permission: 'dashboard:view' },

  // Onboarding writes the tenant's first master data and its guidance state.
  // Applying an industry template creates plants, lines, machines and products
  // wholesale, which is exactly `master_data:manage`; the wizard's own progress
  // is a per-user preference and needs no more than a session.
  { method: 'PUT', pattern: '/api/v1/onboarding/step', permission: 'dashboard:view' },
  { method: 'PUT', pattern: '/api/v1/onboarding/guidance', permission: 'dashboard:view' },
  { method: 'POST', pattern: '/api/v1/onboarding/events', permission: 'dashboard:view' },
  { method: 'POST', pattern: '/api/v1/onboarding/upgrade', permission: 'configuration:manage' },
  { method: '*', pattern: '/api/v1/onboarding/*', permission: 'master_data:manage' },

  // --- MES Improvement v2.0 (Improvement PRD §34) -----------------
  //
  // Ordered narrowest-first within each block. The sort below is by pattern
  // depth, so a `*` rule at the end of a block is the fallback for anything
  // the specific rules above it did not claim, never an accidental override.

  // Material. Reads are wide (an operator has to see what a work order needs);
  // writes split by what they do to stock, not by which screen calls them.
  { method: 'POST', pattern: '/api/v1/materials/inventory/adjust', permission: 'material:adjust' },
  { method: 'POST', pattern: '/api/v1/materials/inventory/receive', permission: 'material:adjust' },
  { method: 'POST', pattern: '/api/v1/materials/inventory/incoming', permission: 'material:adjust' },
  { method: 'POST', pattern: '/api/v1/materials/reservations/work-order/:id', permission: 'material:reserve' },
  { method: 'DELETE', pattern: '/api/v1/materials/reservations/:id', permission: 'material:reserve' },
  { method: 'POST', pattern: '/api/v1/materials/consumption', permission: 'material:consume' },
  { method: '*', pattern: '/api/v1/materials/warehouses*', permission: 'master_data:manage' },
  { method: 'GET', pattern: '/api/v1/materials/*', permission: 'material:view' },
  { method: 'POST', pattern: '/api/v1/materials/availability*', permission: 'material:view' },

  // MRP.
  { method: 'POST', pattern: '/api/v1/mrp/run', permission: 'mrp:run' },
  { method: 'GET', pattern: '/api/v1/mrp/*', permission: 'mrp:view' },

  // Quality.
  { method: 'POST', pattern: '/api/v1/quality/inspections', permission: 'quality:inspect' },
  { method: 'POST', pattern: '/api/v1/quality/holds/:id/release', permission: 'quality:release' },
  { method: 'POST', pattern: '/api/v1/quality/holds', permission: 'quality:hold' },
  { method: 'POST', pattern: '/api/v1/quality/dispositions', permission: 'quality:disposition' },
  { method: 'POST', pattern: '/api/v1/quality/ncr', permission: 'ncr:create' },
  { method: '*', pattern: '/api/v1/quality/ncr*', permission: 'ncr:manage' },
  { method: '*', pattern: '/api/v1/quality/inspection-plans*', permission: 'ncr:manage' },
  { method: 'GET', pattern: '/api/v1/quality/*', permission: 'quality:view' },

  // Maintenance.
  { method: 'POST', pattern: '/api/v1/maintenance/records/:id/start', permission: 'maintenance:execute' },
  { method: 'POST', pattern: '/api/v1/maintenance/records/:id/complete', permission: 'maintenance:complete' },
  { method: 'POST', pattern: '/api/v1/maintenance/records/:id/assign', permission: 'maintenance:assign' },
  { method: 'POST', pattern: '/api/v1/maintenance/requests/:id/accept', permission: 'maintenance:assign' },
  { method: 'POST', pattern: '/api/v1/maintenance/requests/:id/reject', permission: 'maintenance:assign' },
  { method: 'POST', pattern: '/api/v1/maintenance/requests', permission: 'maintenance:create' },
  { method: 'POST', pattern: '/api/v1/maintenance/emergency', permission: 'maintenance:execute' },
  { method: '*', pattern: '/api/v1/maintenance/plans*', permission: 'maintenance:create' },
  { method: 'GET', pattern: '/api/v1/maintenance/*', permission: 'maintenance:view' },

  // Workforce.
  { method: '*', pattern: '/api/v1/workforce/skills*', permission: 'workforce:manage' },
  { method: '*', pattern: '/api/v1/workforce/requirements*', permission: 'workforce:manage' },
  { method: '*', pattern: '/api/v1/workforce/qualifications*', permission: 'workforce:qualification' },
  { method: '*', pattern: '/api/v1/workforce/shift-assignments*', permission: 'workforce:assignment' },
  { method: '*', pattern: '/api/v1/workforce/assignments*', permission: 'workforce:assignment' },
  { method: '*', pattern: '/api/v1/workforce/availability*', permission: 'workforce:availability' },
  // How many operators a work order needs is a planning decision about that
  // work order, and clocked time is what the assignment produced — both belong
  // to whoever assigns, not to whoever administers the skill master.
  { method: '*', pattern: '/api/v1/workforce/labor-requirements*', permission: 'workforce:assignment' },
  { method: '*', pattern: '/api/v1/workforce/time-records*', permission: 'workforce:assignment' },
  { method: 'GET', pattern: '/api/v1/workforce/*', permission: 'workforce:view' },

  // WIP and handoff.
  { method: 'POST', pattern: '/api/v1/wip/transfers/:id/receive', permission: 'wip:receive' },
  { method: 'POST', pattern: '/api/v1/wip/transfers', permission: 'wip:transfer' },
  { method: 'POST', pattern: '/api/v1/wip/records/:id/hold', permission: 'wip:hold' },
  { method: 'POST', pattern: '/api/v1/wip/records/:id/release', permission: 'wip:release' },
  { method: 'POST', pattern: '/api/v1/wip/records', permission: 'wip:create' },
  { method: 'GET', pattern: '/api/v1/wip/*', permission: 'wip:view' },

  // Production board.
  { method: 'POST', pattern: '/api/v1/production-board/dispatch', permission: 'production_board:reschedule' },
  { method: 'GET', pattern: '/api/v1/production-board*', permission: 'production_board:view' },

  // Event history is read-only by design (BR-E02).
  { method: 'GET', pattern: '/api/v1/events*', permission: 'event:view' },
];

/** Longer patterns are more specific, so they are tried first. */
const ORDERED_RULES = [...RULES].sort((a, b) => {
  const specificity = (r: Rule) => r.pattern.split('/').length * 10 - (r.pattern.endsWith('*') ? 5 : 0);
  return specificity(b) - specificity(a) || (a.method === '*' ? 1 : -1);
});

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix);
  }
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

export function permissionForRoute(method: string, path: string): PermissionId | undefined {
  const rule = ORDERED_RULES.find((r) => (r.method === '*' || r.method === method) && matches(r.pattern, path));
  return rule?.permission;
}

/**
 * Paths the middleware lets past before consulting the table.
 *
 * Exported so `scripts/audit-route-permissions.mjs` can tell "public by design"
 * apart from "someone forgot a rule" — the distinction that matters when the
 * fallback for a forgotten rule is `dashboard:view`.
 */
export const PUBLIC_API_PATHS = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/trial-register',
  '/api/v1/auth/operator-login',
  // The second half of a login: it carries a single-use challenge token, not
  // a session, so it cannot require one (§5).
  '/api/v1/auth/mfa/verify',
  '/api/v1/auth/session',
  '/api/v1/auth/logout',
  '/api/v1/meta/deployment',
]);

/**
 * The endpoint inventory and the API documentation (§16).
 *
 * Public by default handed an unauthenticated caller a map of every endpoint
 * in the product plus its version — useful to an integrator, and just as
 * useful to somebody deciding what to try. They stay reachable with any
 * session; `API_DOCS_PUBLIC=true` puts them back on the open internet for a
 * deployment that publishes its API deliberately.
 */
const DOC_PATHS = new Set(['/api/v1/meta/openapi.json', '/api/v1/docs']);

function docsArePublic(): boolean {
  return /^(1|true|yes)$/i.test(process.env.API_DOCS_PUBLIC ?? '');
}

/**
 * Enforces the table above on every request.
 *
 * Placed once, after `attachPrincipal`, so no handler can be added later that
 * forgets its guard.
 */
export function authorizeRoutes(options: { enabled: boolean }): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!options.enabled) return next();
    if (!req.path.startsWith('/api/v1')) return next();
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (DOC_PATHS.has(req.path) && docsArePublic()) return next();

    const principal = req.principal;
    if (!principal) return next(ApiError.unauthenticated());

    const required = permissionForRoute(req.method, req.path) ?? 'dashboard:view';
    if (!principal.permissions.includes(required)) {
      return next(
        ApiError.forbidden(
          `Peran ${principal.role} tidak memiliki izin ${required} untuk ${req.method} ${req.path}.`
        )
      );
    }

    next();
  };
}
