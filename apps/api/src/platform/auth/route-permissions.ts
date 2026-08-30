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
  { method: 'GET', pattern: '/api/v1/sessions', permission: 'user:view' },
  { method: 'DELETE', pattern: '/api/v1/sessions*', permission: 'user:deactivate' },
  { method: 'POST', pattern: '/api/v1/operators/:id/pin', permission: 'user:edit' },

  // --- Planning ---------------------------------------------------
  { method: 'GET', pattern: '/api/v1/production-orders*', permission: 'production_order:view' },
  { method: 'POST', pattern: '/api/v1/production-orders/:id/release', permission: 'production_order:release' },
  { method: 'POST', pattern: '/api/v1/production-orders', permission: 'production_order:create' },
  { method: 'PUT', pattern: '/api/v1/production-orders/:id', permission: 'production_order:edit' },
  { method: 'DELETE', pattern: '/api/v1/production-orders/:id', permission: 'production_order:delete' },

  { method: 'GET', pattern: '/api/v1/work-orders*', permission: 'work_order:view' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/release', permission: 'work_order:release' },
  { method: 'POST', pattern: '/api/v1/work-orders/:id/cancel', permission: 'work_order:cancel' },
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

const PUBLIC_PATHS = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/operator-login',
  '/api/v1/auth/session',
  '/api/v1/auth/logout',
  '/api/v1/meta/deployment',
  '/api/v1/meta/openapi.json',
  '/api/v1/docs',
]);

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
    if (PUBLIC_PATHS.has(req.path)) return next();

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
