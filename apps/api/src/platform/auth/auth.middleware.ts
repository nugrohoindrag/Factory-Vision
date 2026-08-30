import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PermissionId, SessionPrincipal } from '@factory-vision/domain-types';
import { ApiError } from '../http/api-error.js';
import { AuthService } from '../../modules/auth/auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: SessionPrincipal;
    }
  }
}

/**
 * Endpoints that must stay open: the login doors themselves, health, and the
 * API documentation. Everything else under `/api/v1` requires a session.
 */
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/operator-login',
  '/api/v1/meta/deployment',
  '/api/v1/meta/openapi.json',
  '/api/v1/docs',
]);

/**
 * Resolves the bearer token into a principal (US-001, US-002).
 *
 * Attaching the principal is separate from requiring one so that a public
 * endpoint can still see who is calling, and so the tenant middleware can be
 * corrected from the session rather than trusting the `X-Tenant-Id` header.
 */
export function attachPrincipal(auth: AuthService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const principal = auth.resolve(header.slice(7).trim());
      if (principal) {
        req.principal = principal;
        // The session is the authority on tenancy. A caller cannot widen its
        // reach by sending a different X-Tenant-Id.
        req.context = {
          tenantId: principal.tenantId,
          userId: principal.subjectId,
          userRole: principal.role,
        };
      }
    }
    next();
  };
}

/** Rejects unauthenticated traffic to everything that is not explicitly public. */
export function requireAuthentication(options: { enabled: boolean }): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!options.enabled) return next();
    if (!req.path.startsWith('/api/v1')) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (req.principal) return next();
    next(ApiError.unauthenticated('Diperlukan autentikasi. Silakan login kembali.'));
  };
}

/**
 * Guards a route with one permission.
 *
 * When authentication is switched off, the on-premise pilot boots with
 * `AUTH_REQUIRED=false` so the demo dataset is reachable without a login,
 * the guard steps aside rather than pretending everyone is an admin.
 */
export function requirePermission(permission: PermissionId, options: { enabled: boolean }): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!options.enabled) return next();
    const principal = req.principal;
    if (!principal) return next(ApiError.unauthenticated());
    if (!principal.permissions.includes(permission)) {
      return next(ApiError.forbidden(`Peran ${principal.role} tidak memiliki izin ${permission}.`));
    }
    next();
  };
}

/** Requires any one of several permissions, used where two roles both qualify. */
export function requireAnyPermission(
  permissions: PermissionId[],
  options: { enabled: boolean }
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!options.enabled) return next();
    const principal = req.principal;
    if (!principal) return next(ApiError.unauthenticated());
    if (!permissions.some((p) => principal.permissions.includes(p))) {
      return next(ApiError.forbidden(`Peran ${principal.role} tidak memiliki izin yang diperlukan.`));
    }
    next();
  };
}

/**
 * Scope helpers used inside handlers, where the check needs the record itself.
 *
 * These are the query-side half of: the middleware answers "may this role
 * do this at all", and these answer "may this session touch this row".
 */
export const scope = {
  /** Filters a list down to the lines the session may see. */
  lines<T extends { lineId?: string }>(principal: SessionPrincipal | undefined, rows: T[]): T[] {
    if (!principal || principal.scope.level === 'TENANT') return rows;
    const allowed = new Set(principal.scope.lineIds);
    return rows.filter((row) => !row.lineId || allowed.has(row.lineId));
  },

  /** Throws unless the line is inside the session's scope. */
  assertLine(principal: SessionPrincipal | undefined, lineId: string | undefined): void {
    if (!principal || !lineId || principal.scope.level === 'TENANT') return;
    if (!principal.scope.lineIds.includes(lineId)) {
      throw ApiError.outOfScope('Production line berada di luar cakupan akses Anda.');
    }
  },

  assertPlant(principal: SessionPrincipal | undefined, plantId: string | undefined): void {
    if (!principal || !plantId || principal.scope.level === 'TENANT') return;
    if (!principal.scope.plantIds.includes(plantId)) {
      throw ApiError.outOfScope('Plant berada di luar cakupan akses Anda.');
    }
  },

  /**
   * rule 4, an operator may execute only their own work orders.
   * Supervisors and managers execute on behalf of the line, so they pass.
   */
  assertAssignedWorkOrder(
    principal: SessionPrincipal | undefined,
    workOrder: { lineId: string; assignedOperatorId?: string } | undefined,
    operatorId: string | undefined
  ): void {
    if (!principal || !workOrder) return;
    scope.assertLine(principal, workOrder.lineId);
    if (principal.kind !== 'OPERATOR') return;
    if (operatorId && operatorId !== principal.subjectId) {
      throw ApiError.forbidden('Operator hanya dapat menjalankan work order yang ditugaskan kepadanya.');
    }
  },
};
