import { Router } from 'express';
import { ProductionPlanStatus } from '@factory-vision/domain-types';
import { route } from '../../../platform/http/envelope.js';
import { validate } from '../../../platform/http/validate.js';
import { ApiError } from '../../../platform/http/api-error.js';
import type { ProductionPlanService } from '../application/production-plan.service.js';
import { stepAvailability, furthestReachableStep } from '../domain/production-plan.wizard.js';
import { actorOf } from './customer.routes.js';

/**
 * What planning needs from execution to generate Work Orders.
 *
 * Injected as a function rather than imported: the generator writes `work_order`
 * rows and therefore lives in `production`, which planning may not depend on
 * (MES-019). The composition root supplies it.
 */
export interface WorkOrderGenerator {
  generateForPlan(
    tenantId: string,
    productionPlanId: string,
    actorId: string
  ): Promise<{ created: unknown[]; existing: unknown[]; skippedPlanLineIds: string[] }>;
}

/** `/v1/production-plans` (MES-035, MES-036, MES-039, MES-040, MES-041). */
export function productionPlanRoutes(
  plans: ProductionPlanService,
  workOrders?: WorkOrderGenerator
): Router {
  const router = Router();

  router.get(
    '/production-plans',
    route(async (req, res) => {
      const statusParam = req.query.status;
      const statuses =
        typeof statusParam === 'string' && statusParam
          ? (statusParam
              .split(',')
              .filter((s) =>
                (Object.values(ProductionPlanStatus) as string[]).includes(s)
              ) as ProductionPlanStatus[])
          : undefined;

      res.json(
        await plans.list(req.context!.tenantId, {
          status: statuses,
          periodStart: typeof req.query.periodStart === 'string' ? req.query.periodStart : undefined,
          periodEnd: typeof req.query.periodEnd === 'string' ? req.query.periodEnd : undefined,
        })
      );
    })
  );

  router.post(
    '/production-plans',
    route(async (req, res) => {
      const v = validate(req.body);
      const periodStart = v.isoDate('periodStart');
      const periodEnd = v.isoDate('periodEnd');
      const demandForecastId = v.string('demandForecastId', { optional: true });
      const capacityPlanId = v.string('capacityPlanId', { optional: true });
      v.done();

      res.status(201).json(
        await plans.create(
          req.context!.tenantId,
          {
            periodStart: periodStart!.slice(0, 10),
            periodEnd: periodEnd!.slice(0, 10),
            demandForecastId,
            capacityPlanId,
          },
          actorOf(req)
        )
      );
    })
  );

  router.get(
    '/production-plans/:id',
    route(async (req, res) => {
      res.json(await plans.get(req.context!.tenantId, req.params.id));
    })
  );

  /**
   * Patches the plan. `version` is required, not optional (MES-039-3): a wizard
   * two planners can open is a wizard where last-write-wins loses work.
   */
  router.patch(
    '/production-plans/:id',
    route(async (req, res) => {
      const v = validate(req.body);
      const version = v.number('version', { integer: true, min: 1 });
      const periodStart = v.isoDate('periodStart', { optional: true });
      const periodEnd = v.isoDate('periodEnd', { optional: true });
      const demandForecastId = v.string('demandForecastId', { optional: true });
      const capacityPlanId = v.string('capacityPlanId', { optional: true });
      const wizardStep = v.number('wizardStep', { optional: true, integer: true, min: 1, max: 6 });
      const rawState = (req.body as { wizardState?: unknown }).wizardState;
      if (rawState !== undefined && (typeof rawState !== 'object' || rawState === null)) {
        v.reject('wizardState', 'INVALID_TYPE', 'wizardState harus berupa objek.');
      }
      v.done();

      res.json(
        await plans.update(
          req.context!.tenantId,
          req.params.id,
          version!,
          {
            periodStart: periodStart?.slice(0, 10),
            periodEnd: periodEnd?.slice(0, 10),
            demandForecastId,
            capacityPlanId,
            wizardStep,
            wizardState: rawState as Record<string, unknown> | undefined,
          },
          actorOf(req)
        )
      );
    })
  );

  // --- Wizard (MES-037, MES-038, MES-039) -----------------------------

  router.get(
    '/production-plans/:id/wizard',
    route(async (req, res) => {
      const readiness = await plans.readiness(req.context!.tenantId, req.params.id);
      res.json({
        ...readiness,
        // The resume point: the step the data actually supports, so an
        // abandoned wizard reopens where it left off whatever the browser
        // remembers (MES-039-2).
        resumeStep: Math.min(readiness.currentStep, furthestReachableStep(readiness)),
        steps: stepAvailability(readiness),
      });
    })
  );

  // --- Lines & demand (MES-036) ---------------------------------------

  router.get(
    '/production-plans/:id/lines',
    route(async (req, res) => {
      res.json(await plans.listLines(req.context!.tenantId, req.params.id));
    })
  );

  router.patch(
    '/production-plans/:id/lines/:lineId',
    route(async (req, res) => {
      const v = validate(req.body);
      const plannedQuantity = v.number('plannedQuantity', { optional: true, integer: true, min: 0 });
      const priority = v.number('priority', { optional: true, integer: true, min: 1 });
      const requiredDeliveryDate = v.isoDate('requiredDeliveryDate', { optional: true });
      v.done();

      res.json(
        await plans.updateLine(
          req.context!.tenantId,
          req.params.id,
          req.params.lineId,
          {
            plannedQuantity,
            priority,
            requiredDeliveryDate: requiredDeliveryDate?.slice(0, 10),
          },
          actorOf(req)
        )
      );
    })
  );

  router.get(
    '/production-plans/:id/demand',
    route(async (req, res) => {
      res.json(await plans.demandBreakdown(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/production-plans/:id/demand',
    route(async (req, res) => {
      const v = validate(req.body);
      const customerOrderLineId = v.string('customerOrderLineId');
      const demandQuantity = v.number('demandQuantity', { optional: true, integer: true, min: 1 });
      v.done();

      res.status(201).json(
        await plans.addDemand(
          req.context!.tenantId,
          req.params.id,
          { customerOrderLineId: customerOrderLineId!, demandQuantity },
          actorOf(req)
        )
      );
    })
  );

  router.delete(
    '/production-plans/:id/demand/:demandId',
    route(async (req, res) => {
      await plans.removeDemand(
        req.context!.tenantId,
        req.params.id,
        req.params.demandId,
        actorOf(req)
      );
      res.json({ success: true, message: 'Demand dilepas dari Production Plan.' });
    })
  );

  // --- Work Order generation (MES-041) --------------------------------

  router.post(
    '/production-plans/:id/generate-work-orders',
    route(async (req, res) => {
      if (!workOrders) {
        throw ApiError.internal('Work Order generator belum terpasang pada API.');
      }
      const result = await workOrders.generateForPlan(
        req.context!.tenantId,
        req.params.id,
        actorOf(req)
      );
      res.status(201).json({
        ...result,
        createdCount: result.created.length,
        existingCount: result.existing.length,
        message:
          result.created.length === 0 && result.existing.length > 0
            ? 'Seluruh Work Order sudah ada; generate ulang tidak membuat duplikat.'
            : `${result.created.length} Work Order dibuat.`,
      });
    })
  );

  // --- Confirmation (MES-040) -----------------------------------------

  router.post(
    '/production-plans/:id/confirm',
    route(async (req, res) => {
      res.json(await plans.confirm(req.context!.tenantId, req.params.id, actorOf(req)));
    })
  );

  router.post(
    '/production-plans/:id/cancel',
    route(async (req, res) => {
      const v = validate(req.body);
      const reason = v.string('reason', { min: 3 });
      v.done();
      res.json(await plans.cancel(req.context!.tenantId, req.params.id, reason!, actorOf(req)));
    })
  );

  return router;
}
