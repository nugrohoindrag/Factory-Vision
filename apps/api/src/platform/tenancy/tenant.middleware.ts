import { Request, Response, NextFunction } from 'express';

export interface RequestContext {
  tenantId: string;
  userId?: string;
  userRole?: string;
}

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

/**
 * Multi-Tenancy Middleware
 * Resolves tenant from JWT / Header and sets RequestContext
 * Aligned with Tech Architecture &
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Default tenant for development / on-premise single-tenant mode
  const headerTenantId = req.headers['x-tenant-id'] as string;
  const tenantId = headerTenantId || process.env.DEFAULT_TENANT_ID || 'tenant-pilot-factory-01';

  req.context = {
    tenantId,
    userId: (req.headers['x-user-id'] as string) || 'user-default',
    userRole: (req.headers['x-user-role'] as string) || 'SUPERVISOR',
  };

  next();
}
