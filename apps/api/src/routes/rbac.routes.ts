import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { RbacService } from '../modules/rbac/rbac.service.js';

/**
 * Roles and permissions (US-006).
 *
 * Every mutation is audited: lists "Role changed" and "Permission
 * changed" as mandatory audit events, and a permission grant is exactly the
 * kind of change that needs an actor's name attached forever.
 */
export function rbacRoutes(rbac: RbacService, audit: AuditService): Router {
  const router = Router();

  router.get(
    '/permissions',
    route(async (_req, res) => res.json(rbac.getPermissionCatalog()))
  );

  router.get(
    '/roles',
    route(async (req, res) => res.json(rbac.getRoles(req.context!.tenantId)))
  );

  router.get(
    '/roles/:id',
    route(async (req, res) => res.json(rbac.getRole(req.context!.tenantId, req.params.id)))
  );

  router.post(
    '/roles',
    route(async (req, res) => {
      const v = validate(req.body);
      const key = v.string('key', { min: 2, max: 40 });
      const name = v.string('name', { min: 2, max: 60 });
      const description = v.string('description', { optional: true, max: 240 });
      const permissions = v.stringArray('permissions');
      const landingPath = v.string('landingPath', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const role = await rbac.createRole(
        tenantId,
        { key: key!, name: name!, description, permissions: permissions!, landingPath },
        req.principal?.permissions ?? rbac.getPermissionCatalog().map((p) => p.id)
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'role',
        entityId: role.id,
        action: 'ROLE_CREATED',
        newValue: { key: role.key, permissions: role.permissions },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json(role);
    })
  );

  router.put(
    '/roles/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const before = rbac.getRole(tenantId, req.params.id);
      const previous = { name: before.name, permissions: [...before.permissions] };

      const v = validate(req.body);
      const name = v.string('name', { optional: true, min: 2, max: 60 });
      const description = v.string('description', { optional: true, max: 240 });
      const permissions = v.stringArray('permissions', { optional: true });
      const landingPath = v.string('landingPath', { optional: true });
      v.done();

      const role = await rbac.updateRole(
        tenantId,
        req.params.id,
        { name, description, permissions, landingPath },
        req.principal?.permissions ?? rbac.getPermissionCatalog().map((p) => p.id)
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'role',
        entityId: role.id,
        action: 'PERMISSION_CHANGED',
        previousValue: previous,
        newValue: { name: role.name, permissions: role.permissions },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json(role);
    })
  );

  router.delete(
    '/roles/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const role = rbac.getRole(tenantId, req.params.id);
      const result = await rbac.deleteRole(tenantId, req.params.id);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'role',
        entityId: role.id,
        action: 'ROLE_DELETED',
        previousValue: { key: role.key, permissions: role.permissions },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json(result);
    })
  );

  return router;
}
