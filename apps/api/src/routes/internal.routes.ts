import { Router } from 'express';
import type { Request } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { ApiError } from '../platform/http/api-error.js';
import { ClientAdminService } from '../modules/client-management/client.admin.service.js';
import { ClientManagementService } from '../modules/client-management/client.service.js';
import {
  InternalAuthService,
  type InternalPrincipal,
} from '../modules/client-management/internal-auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      internal?: InternalPrincipal;
    }
  }
}

/**
 * The vendor's own API, mounted under `/api/internal/v1`.
 *
 * A separate prefix from `/api/v1` on purpose: the customer-facing
 * authorization table never grants anything here, and nothing here is reachable
 * with a customer's token. The two are different products that happen to share
 * a process.
 */
export function internalRoutes(
  auth: InternalAuthService,
  read: ClientManagementService,
  admin: ClientAdminService
): Router {
  const router = Router();

  const actorOf = (req: Request) => ({
    email: req.internal!.email,
    ip: req.ip,
  });

  // Resolve the internal session on every request under this router.
  router.use((req, _res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.internal = auth.resolve(header.slice(7).trim());
    }
    next();
  });

  // --- Session ------------------------------------------------------

  router.post(
    '/auth/login',
    route(async (req, res) => {
      const v = validate(req.body);
      const email = v.email('email');
      const password = v.string('password', { min: 1 });
      v.done('Email dan kata sandi wajib diisi.');
      res.json(await auth.login(email!, password!, req.ip));
    })
  );

  router.get(
    '/auth/session',
    route(async (req, res) => {
      if (!req.internal) throw ApiError.unauthenticated('Sesi internal tidak aktif.');
      res.json({ principal: req.internal });
    })
  );

  router.post(
    '/auth/logout',
    route(async (req, res) => {
      if (req.internal) auth.logout(req.internal.sessionId);
      res.json({ success: true });
    })
  );

  // --- Portfolio ----------------------------------------------------

  router.get(
    '/summary',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await read.portfolioSummary());
    })
  );

  router.get(
    '/plans',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await read.listPlans());
    })
  );

  // --- Clients ------------------------------------------------------

  router.get(
    '/clients',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(
        await read.listClients({
          status: typeof req.query.status === 'string' ? (req.query.status as never) : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        })
      );
    })
  );

  router.get(
    '/clients/:id',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await read.getClient(req.params.id));
    })
  );

  router.post(
    '/clients',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:manage');
      const v = validate(req.body);
      const legalName = v.string('legalName', { min: 2, max: 255 });
      const displayName = v.string('displayName', { min: 2, max: 255 });
      const planId = v.string('planId');
      const startedAt = v.isoDate('startedAt');
      const lifecycleStatus = v.oneOf('lifecycleStatus', ['PROSPECT', 'TRIAL', 'ACTIVE'] as const);
      const deploymentMode = v.oneOf(
        'deploymentMode',
        ['CLOUD_MULTI_TENANT', 'ON_PREMISE_SINGLE_TENANT'] as const,
        { optional: true }
      );
      const industry = v.string('industry', { optional: true, max: 128 });
      const city = v.string('city', { optional: true, max: 128 });
      const contactName = v.string('contactName', { optional: true, max: 255 });
      const contactEmail = v.email('contactEmail', { optional: true });
      const contactPhone = v.string('contactPhone', { optional: true, max: 64 });
      const accountManager = v.string('accountManager', { optional: true, max: 255 });
      const renewsAt = v.isoDate('renewsAt', { optional: true });
      const notes = v.string('notes', { optional: true, max: 2000 });
      v.done();

      const result = await admin.createClient(
        {
          legalName: legalName!,
          displayName: displayName!,
          planId: planId!,
          startedAt: startedAt!.slice(0, 10),
          renewsAt: renewsAt?.slice(0, 10),
          lifecycleStatus: lifecycleStatus!,
          deploymentMode: deploymentMode ?? 'CLOUD_MULTI_TENANT',
          industry,
          city,
          contactName,
          contactEmail,
          contactPhone,
          accountManager,
          notes,
        },
        actorOf(req)
      );

      res.status(201).json(result);
    })
  );

  router.put(
    '/clients/:id',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:manage');
      const v = validate(req.body);
      const displayName = v.string('displayName', { optional: true, min: 2, max: 255 });
      const legalName = v.string('legalName', { optional: true, min: 2, max: 255 });
      const industry = v.string('industry', { optional: true, max: 128 });
      const city = v.string('city', { optional: true, max: 128 });
      const contactName = v.string('contactName', { optional: true, max: 255 });
      const contactEmail = v.email('contactEmail', { optional: true });
      const contactPhone = v.string('contactPhone', { optional: true, max: 64 });
      const accountManager = v.string('accountManager', { optional: true, max: 255 });
      const notes = v.string('notes', { optional: true, max: 2000 });
      v.done();

      res.json(
        await admin.updateClient(
          req.params.id,
          {
            displayName,
            legalName,
            industry,
            city,
            contactName,
            contactEmail,
            contactPhone,
            accountManager,
            notes,
          },
          actorOf(req)
        )
      );
    })
  );

  router.patch(
    '/clients/:id/status',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:manage');
      const v = validate(req.body);
      const status = v.oneOf('status', ['PROSPECT', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED'] as const);
      v.done();
      res.json(await admin.setLifecycleStatus(req.params.id, status!, actorOf(req)));
    })
  );

  // --- Subscription -------------------------------------------------

  router.get(
    '/clients/:id/subscriptions',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await admin.subscriptionHistory(req.params.id));
    })
  );

  router.post(
    '/clients/:id/subscription',
    route(async (req, res) => {
      auth.assert(req.internal, 'subscription:manage');
      const v = validate(req.body);
      const planId = v.string('planId');
      const startedAt = v.isoDate('startedAt');
      const renewsAt = v.isoDate('renewsAt', { optional: true });
      const maxPlants = v.number('overrideMaxPlants', { optional: true, min: 0, integer: true });
      const maxProductionLines = v.number('overrideMaxProductionLines', {
        optional: true,
        min: 0,
        integer: true,
      });
      const maxMachines = v.number('overrideMaxMachines', { optional: true, min: 0, integer: true });
      const maxUsers = v.number('overrideMaxUsers', { optional: true, min: 0, integer: true });
      const maxOperators = v.number('overrideMaxOperators', { optional: true, min: 0, integer: true });
      v.done();

      res.status(201).json(
        await admin.changePlan(
          {
            clientId: req.params.id,
            planId: planId!,
            startedAt: startedAt!.slice(0, 10),
            renewsAt: renewsAt?.slice(0, 10),
            overrides: { maxPlants, maxProductionLines, maxMachines, maxUsers, maxOperators },
          },
          actorOf(req)
        )
      );
    })
  );

  // --- Usage --------------------------------------------------------

  router.get(
    '/clients/:id/usage',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      const days = Math.min(Number(req.query.days ?? 30) || 30, 365);
      res.json(await read.usageHistory(req.params.id, days));
    })
  );

  router.post(
    '/usage/capture',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await read.captureUsage(req.internal!.email));
    })
  );

  // --- Support access -----------------------------------------------

  router.get(
    '/support-access',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await admin.listActiveSupportAccess());
    })
  );

  router.get(
    '/clients/:id/support-access',
    route(async (req, res) => {
      auth.assert(req.internal, 'client:view');
      res.json(await admin.listSupportAccess(req.params.id));
    })
  );

  router.post(
    '/clients/:id/support-access',
    route(async (req, res) => {
      auth.assert(req.internal, 'support:grant');
      const v = validate(req.body);
      const grantedTo = v.email('grantedTo');
      const reason = v.string('reason', { min: 10, max: 500 });
      const accessLevel = v.oneOf('accessLevel', ['READ_ONLY', 'READ_WRITE'] as const, { optional: true });
      const hours = v.number('hours', { optional: true, min: 1, max: 72, integer: true });
      v.done();

      res.status(201).json(
        await admin.grantSupportAccess(
          {
            clientId: req.params.id,
            grantedTo: grantedTo!,
            reason: reason!,
            accessLevel: accessLevel ?? 'READ_ONLY',
            hours: hours ?? 4,
          },
          actorOf(req)
        )
      );
    })
  );

  router.delete(
    '/support-access/:grantId',
    route(async (req, res) => {
      auth.assert(req.internal, 'support:grant');
      res.json(await admin.revokeSupportAccess(req.params.grantId, actorOf(req)));
    })
  );

  router.post(
    '/support-access/:grantId/use',
    route(async (req, res) => {
      auth.assert(req.internal, 'support:grant');
      res.json(await admin.useSupportAccess(req.params.grantId, actorOf(req)));
    })
  );

  // --- Audit and staff ----------------------------------------------

  router.get(
    '/audit',
    route(async (req, res) => {
      auth.assert(req.internal, 'audit:view');
      res.json(
        await admin.auditTrail({
          clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined,
          limit: Number(req.query.limit ?? 100) || 100,
        })
      );
    })
  );

  router.get(
    '/staff',
    route(async (req, res) => {
      auth.assert(req.internal, 'audit:view');
      res.json(await auth.listStaff());
    })
  );

  return router;
}
