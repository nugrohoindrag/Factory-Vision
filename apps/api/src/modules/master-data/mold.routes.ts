import { Router } from 'express';
import type { Request } from 'express';
import { MoldStatus } from '@factory-vision/domain-types';
import { route } from '../../platform/http/envelope.js';
import { validate } from '../../platform/http/validate.js';
import type { MoldService } from './mold.service.js';

/**
 * `/v1/molds` (MES-006) and the compatibility beneath it (ADR-36).
 *
 * `route-permissions.ts` has guarded these paths since Sprint 4 — `GET` needs
 * `master_data:view`, everything else `master_data:manage`. Until now there was
 * nothing behind the guard, so the rules were enforced against a 404.
 */

export type MoldAuditHook = (
  req: Request,
  entityId: string,
  action: string,
  previousValue?: unknown,
  newValue?: unknown
) => void;

const STATUSES = Object.values(MoldStatus) as [string, ...string[]];

export function moldRoutes(molds: MoldService, recordAudit: MoldAuditHook): Router {
  const router = Router();

  router.get(
    '/molds',
    route(async (req, res) => {
      res.json(
        await molds.list(req.context!.tenantId, {
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          // The Work Order form asks with `productId`: ADR-36 makes the mould
          // field required exactly when this list is non-empty, so the same
          // query answers "which moulds?" and "is a mould needed at all?".
          productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
          machineId: typeof req.query.machineId === 'string' ? req.query.machineId : undefined,
        })
      );
    })
  );

  router.get(
    '/molds/:id',
    route(async (req, res) => {
      res.json(await molds.get(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/molds',
    route(async (req, res) => {
      const v = validate(req.body);
      const code = v.string('code', { min: 1, max: 64 });
      const name = v.string('name', { min: 1, max: 255 });
      // A mould with no cavities produces nothing; the column defaults to 1 and
      // a zero would silently break every capacity figure derived from it.
      const cavityCount = v.number('cavityCount', { integer: true, min: 1, max: 1000 });
      const status = v.oneOf('status', STATUSES, { optional: true });
      const currentMachineId = v.string('currentMachineId', { optional: true, max: 64 });
      v.done();

      const created = await molds.create(req.context!.tenantId, {
        code: code!,
        name: name!,
        cavityCount: cavityCount!,
        status,
        currentMachineId: currentMachineId ?? null,
      });
      recordAudit(req, created.id, 'CREATE', undefined, created);
      res.status(201).json(created);
    })
  );

  router.patch(
    '/molds/:id',
    route(async (req, res) => {
      const v = validate(req.body);
      const code = v.string('code', { min: 1, max: 64, optional: true });
      const name = v.string('name', { min: 1, max: 255, optional: true });
      const cavityCount = v.number('cavityCount', {
        integer: true,
        min: 1,
        max: 1000,
        optional: true,
      });
      const status = v.oneOf('status', STATUSES, { optional: true });
      v.done();

      const previous = await molds.get(req.context!.tenantId, req.params.id);

      // `currentMachineId: null` detaches the mould, which is different from
      // omitting the field. The validator collapses both to `undefined`, so the
      // raw body is what distinguishes them.
      const machineMentioned = Object.prototype.hasOwnProperty.call(
        req.body ?? {},
        'currentMachineId'
      );
      const rawMachine = (req.body as { currentMachineId?: unknown } | undefined)
        ?.currentMachineId;

      const updated = await molds.update(req.context!.tenantId, req.params.id, {
        code,
        name,
        cavityCount,
        status,
        ...(machineMentioned
          ? { currentMachineId: typeof rawMachine === 'string' && rawMachine ? rawMachine : null }
          : {}),
      });
      recordAudit(req, updated.id, 'UPDATE', previous, updated);
      res.json(updated);
    })
  );

  router.delete(
    '/molds/:id',
    route(async (req, res) => {
      const previous = await molds.get(req.context!.tenantId, req.params.id);
      await molds.remove(req.context!.tenantId, req.params.id);
      recordAudit(req, req.params.id, 'DELETE', previous, undefined);
      res.status(204).end();
    })
  );

  // --- Compatibility ---------------------------------------------------

  router.get(
    '/molds/:id/compatibilities',
    route(async (req, res) => {
      res.json(
        await molds.listCompatibilities(req.context!.tenantId, {
          moldId: req.params.id,
          activeOnly: req.query.activeOnly === 'true',
        })
      );
    })
  );

  router.post(
    '/molds/:id/compatibilities',
    route(async (req, res) => {
      const v = validate(req.body);
      const productId = v.string('productId', { min: 1, max: 64 });
      v.done();

      const created = await molds.addCompatibility(
        req.context!.tenantId,
        req.params.id,
        productId!
      );
      // Audited against the mould, not the link: "which products may this mould
      // run?" is the question an auditor asks, and it is answered by the
      // mould's history.
      recordAudit(req, req.params.id, 'MOLD_COMPATIBILITY_ADD', undefined, created);
      res.status(201).json(created);
    })
  );

  router.patch(
    '/molds/:id/compatibilities/:compatibilityId',
    route(async (req, res) => {
      const v = validate(req.body);
      const active = v.boolean('active');
      v.done();

      const updated = await molds.setCompatibilityActive(
        req.context!.tenantId,
        req.params.id,
        req.params.compatibilityId,
        active!
      );
      recordAudit(
        req,
        req.params.id,
        active ? 'MOLD_COMPATIBILITY_ACTIVATE' : 'MOLD_COMPATIBILITY_DEACTIVATE',
        undefined,
        updated
      );
      res.json(updated);
    })
  );

  router.delete(
    '/molds/:id/compatibilities/:compatibilityId',
    route(async (req, res) => {
      await molds.removeCompatibility(
        req.context!.tenantId,
        req.params.id,
        req.params.compatibilityId
      );
      recordAudit(req, req.params.id, 'MOLD_COMPATIBILITY_REMOVE');
      res.status(204).end();
    })
  );

  return router;
}
