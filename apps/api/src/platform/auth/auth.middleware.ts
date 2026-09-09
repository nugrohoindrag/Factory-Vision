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

/*
 * There is deliberately no second list of public paths here. This file used to
 * carry one, beside the one in `route-permissions.ts` that is actually
 * mounted, and the two had already drifted: the copy here still exempted the
 * API documentation after the enforced policy stopped doing so. One policy,
 * in one place, is the only version of this that stays true.
 */

/**
 * Resolves the bearer token into a principal (US-001, US-002).
 *
 * Attaching the principal is separate from requiring one so that a public
 * endpoint can still see who is calling, and so the tenant middleware can be
 * corrected from the session rather than trusting the `X-Tenant-Id` header.
 */
export function attachPrincipal(auth: AuthService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      // Resolving reads the session store (§6), so this middleware is async.
      // A failure here must not become a 500 on a protected route: no
      // principal is attached, and the guard below answers 401.
      const principal = await auth.resolve(header.slice(7).trim()).catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[auth] session lookup failed:', error);
        return undefined;
      });
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
