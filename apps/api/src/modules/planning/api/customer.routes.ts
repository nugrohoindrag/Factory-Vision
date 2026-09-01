import { Router } from 'express';
import type { Request } from 'express';
import { route } from '../../../platform/http/envelope.js';
import { validate } from '../../../platform/http/validate.js';
import type { CustomerService } from '../application/customer.service.js';

/** The actor recorded in the audit trail; falls back for the auth-off demo. */
export function actorOf(req: Request): string {
  return req.principal?.subjectId ?? req.context?.userId ?? 'system';
}

/** `/v1/customers` (MES-029-1). */
export function customerRoutes(customers: CustomerService): Router {
  const router = Router();

  router.get(
    '/customers',
    route(async (req, res) => {
      res.json(
        await customers.list(req.context!.tenantId, {
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          // The order form asks for `activeOnly`: an inactive customer must not
          // appear in the picker for a new order (MES-029), while remaining
          // readable on the orders that already name it.
          activeOnly: req.query.activeOnly === 'true',
        })
      );
    })
  );

  router.get(
    '/customers/:id',
    route(async (req, res) => {
      res.json(await customers.get(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/customers',
    route(async (req, res) => {
      const v = validate(req.body);
      const code = v.string('code', { min: 1, max: 64 });
      const name = v.string('name', { min: 1, max: 255 });
      const picName = v.string('picName', { optional: true, max: 255 });
      const picContact = v.string('picContact', { optional: true, max: 255 });
      const deliveryAddress = v.string('deliveryAddress', { optional: true });
      const dockNumber = v.string('dockNumber', { optional: true, max: 64 });
      const status = v.oneOf('status', ['ACTIVE', 'INACTIVE'] as const, { optional: true });
      v.done();

      const created = await customers.create(
        req.context!.tenantId,
        { code: code!, name: name!, picName, picContact, deliveryAddress, dockNumber, status },
        actorOf(req)
      );
      res.status(201).json(created);
    })
  );

  router.patch(
    '/customers/:id',
    route(async (req, res) => {
      const v = validate(req.body);
      const code = v.string('code', { optional: true, max: 64 });
      const name = v.string('name', { optional: true, max: 255 });
      const picName = v.string('picName', { optional: true, max: 255 });
      const picContact = v.string('picContact', { optional: true, max: 255 });
      const deliveryAddress = v.string('deliveryAddress', { optional: true });
      const dockNumber = v.string('dockNumber', { optional: true, max: 64 });
      const status = v.oneOf('status', ['ACTIVE', 'INACTIVE'] as const, { optional: true });
      v.done();

      res.json(
        await customers.update(
          req.context!.tenantId,
          req.params.id,
          { code, name, picName, picContact, deliveryAddress, dockNumber, status },
          actorOf(req)
        )
      );
    })
  );

  return router;
}
