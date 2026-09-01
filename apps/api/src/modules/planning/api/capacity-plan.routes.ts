import { Router } from 'express';
import { CapacityPlanStatus } from '@factory-vision/domain-types';
import { route } from '../../../platform/http/envelope.js';
import { validate } from '../../../platform/http/validate.js';
import type { CapacityPlanService } from '../application/capacity-plan.service.js';
import type { JobRunner } from '@factory-vision/job-queue';
import { actorOf } from './customer.routes.js';

/** `/v1/capacity-plans` (MES-033). */
export function capacityPlanRoutes(
  capacity: CapacityPlanService,
  runner: JobRunner | undefined
): Router {
  const router = Router();

  router.get(
    '/capacity-plans',
    route(async (req, res) => {
      const status =
        typeof req.query.status === 'string' &&
        (Object.values(CapacityPlanStatus) as string[]).includes(req.query.status)
          ? (req.query.status as CapacityPlanStatus)
          : undefined;
      res.json(await capacity.list(req.context!.tenantId, { status }));
    })
  );

  /** The live snapshot for a period; what the Capacity Planning screen opens on. */
  router.get(
    '/capacity-plans/current',
    route(async (req, res) => {
      const periodStart =
        typeof req.query.periodStart === 'string'
          ? req.query.periodStart
          : new Date().toISOString().slice(0, 8) + '01';
      const plan = await capacity.latestForPeriod(req.context!.tenantId, periodStart);
      if (!plan) {
        // Not an error: a period nobody has computed yet is an empty state, and
        // the console renders a "hitung kapasitas" call to action from it.
        res.json({ periodStart, plan: null, lines: [] });
        return;
      }
      res.json({ periodStart, plan, lines: plan.lines });
    })
  );

  router.post(
    '/capacity-plans',
    route(async (req, res) => {
      const v = validate(req.body);
      const periodStart = v.isoDate('periodStart');
      const periodEnd = v.isoDate('periodEnd');
      const planningUtilizationPct = v.number('planningUtilizationPct', {
        optional: true,
        min: 1,
        max: 100,
      });
      const plantId = v.string('plantId', { optional: true });
      const lineId = v.string('lineId', { optional: true });
      v.done();

      res.status(201).json(
        await capacity.compute(
          req.context!.tenantId,
          {
            periodStart: periodStart!.slice(0, 10),
            periodEnd: periodEnd!.slice(0, 10),
            planningUtilizationPct,
            plantId,
            lineId,
          },
          actorOf(req)
        )
      );
    })
  );

  router.post(
    '/capacity-plans/:id/recalculate',
    route(async (req, res) => {
      const job = await capacity.enqueueRecalculate(
        req.context!.tenantId,
        req.params.id,
        actorOf(req)
      );
      void runner?.runOnce().catch(() => undefined);
      res.status(202).json({
        jobId: job.id,
        status: job.status,
        message:
          'Rekalkulasi dijalankan sebagai job dan menghasilkan snapshot baru; ' +
          'snapshot lama ditandai SUPERSEDED dan angkanya tidak diubah.',
      });
    })
  );

  /**
   * Capacity for one product and quantity, without writing a snapshot.
   *
   * The wizard's Step 2 asks this on every quantity change; writing a snapshot
   * per keystroke would bury the real ones.
   */
  router.get(
    '/capacity-plans/assess',
    route(async (req, res) => {
      const productId = String(req.query.productId ?? '');
      const periodStart = String(req.query.periodStart ?? '');
      const periodEnd = String(req.query.periodEnd ?? '');
      const demandQuantity = Number(req.query.demandQuantity ?? 0);
      const v = validate({ productId, periodStart, periodEnd });
      v.string('productId');
      v.isoDate('periodStart');
      v.isoDate('periodEnd');
      v.done();

      const assessment = await capacity.assessProduct(req.context!.tenantId, {
        productId,
        periodStart: periodStart.slice(0, 10),
        periodEnd: periodEnd.slice(0, 10),
        demandQuantity: Number.isFinite(demandQuantity) ? demandQuantity : 0,
      });

      // §18.3: a calculated metric travels with the numbers that formed it, so
      // the console can render the formula tooltip without a second call.
      res.json({
        metric: 'capacity_utilization',
        value: assessment.capacityUtilization,
        inputs: {
          demandQuantity: assessment.demandQuantity,
          totalCapacity: assessment.totalCapacity,
          planningCapacity: assessment.planningCapacity,
          capacityBuffer: assessment.capacityBuffer,
          planningUtilizationPct: assessment.planningUtilizationPct,
          availableMinutes: assessment.availableMinutes,
        },
        capacityStatus: assessment.capacityStatus,
        capacityGap: assessment.capacityGap,
        uncomputedMachines: assessment.uncomputedMachines,
        contributions: assessment.contributions,
      });
    })
  );

  router.get(
    '/capacity-plans/:id',
    route(async (req, res) => {
      res.json(await capacity.get(req.context!.tenantId, req.params.id));
    })
  );

  return router;
}
