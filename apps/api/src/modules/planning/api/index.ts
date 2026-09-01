import { Router } from 'express';
import { route } from '../../../platform/http/envelope.js';
import { validate } from '../../../platform/http/validate.js';
import { withTenant } from '../../../platform/db/pool.js';
import { CustomerService } from '../application/customer.service.js';
import { CustomerOrderService } from '../application/customer-order.service.js';
import { DemandForecastService } from '../application/demand-forecast.service.js';
import { CapacityPlanService } from '../application/capacity-plan.service.js';
import { ProductionPlanService } from '../application/production-plan.service.js';
import { JobRunner } from '@factory-vision/job-queue';
import { createPlanningJobHandlers, getJobQueue } from '../../../platform/queue/index.js';
import { PlanningReferenceRepository } from '../infrastructure/planning-reference.repository.js';
import { customerRoutes } from './customer.routes.js';
import { customerOrderRoutes } from './customer-order.routes.js';
import { demandForecastRoutes } from './demand-forecast.routes.js';
import { capacityPlanRoutes } from './capacity-plan.routes.js';
import { productionPlanRoutes, type WorkOrderGenerator } from './production-plan.routes.js';

export type { WorkOrderGenerator } from './production-plan.routes.js';

export interface PlanningRoutesOptions {
  /**
   * Generates Work Orders from a Production Plan.
   *
   * Supplied by the composition root because the generator writes `work_order`
   * rows and so belongs to `production` — the module planning may not depend on
   * (MES-019). Omitting it leaves the endpoint reporting that it is not wired,
   * which is what a test harness without execution wants.
   */
  workOrderGenerator?: WorkOrderGenerator;
  /**
   * Runs the queue in the API process too.
   *
   * Defaults to on, so a developer with no worker container still sees
   * forecasts complete. Production sets `API_RUN_JOB_RUNNER=false` and lets the
   * worker own the queue — `SKIP LOCKED` makes either arrangement correct, this
   * only decides who does the work.
   */
  startJobRunner?: boolean;
}

/**
 * The planning module's HTTP surface, mounted once by the composition root.
 *
 * Services are constructed here rather than in `main.ts`, so nothing outside the
 * module has to know which application services exist — `main.ts` mounts a
 * router and that is the whole of its knowledge of planning (MES-019).
 */
export function planningRoutes(options: PlanningRoutesOptions = {}): Router {
  const router = Router();

  const customers = new CustomerService();
  const orders = new CustomerOrderService();
  const forecasts = new DemandForecastService();
  const capacity = new CapacityPlanService();
  const plans = new ProductionPlanService();
  const reference = new PlanningReferenceRepository();

  const runInApi =
    options.startJobRunner ?? process.env.API_RUN_JOB_RUNNER !== 'false';

  let runner: JobRunner | undefined;
  if (runInApi) {
    runner = new JobRunner({
      queue: getJobQueue(),
      // Empty at construction because mounting routes is synchronous while
      // building the planning handlers is not; they are registered, and the
      // loop started, as soon as they resolve.
      handlers: {},
      label: 'api-job-runner',
      // eslint-disable-next-line no-console
      logError: (message) => console.error(message),
    });
    const started = runner;
    void createPlanningJobHandlers().then((handlers) => {
      started.register(handlers);
      started.start(Number(process.env.PLANNING_JOB_INTERVAL_MS ?? 5000));
    });
  }

  router.use(customerRoutes(customers));
  router.use(customerOrderRoutes(orders));
  router.use(demandForecastRoutes(forecasts, runner));
  router.use(capacityPlanRoutes(capacity, runner));
  router.use(productionPlanRoutes(plans, options.workOrderGenerator));

  // Planning policy: the utilization the capacity engine applies (§45.6) and
  // the process-sequence strictness the WO guard reads (§13). Configurable per
  // tenant, which is why they are rows rather than constants.
  router.get(
    '/planning/config',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      res.json(await withTenant(tenantId, (client) => reference.getConfig(client, tenantId)));
    })
  );

  router.put(
    '/planning/config',
    route(async (req, res) => {
      const v = validate(req.body);
      const planningUtilizationPct = v.number('planningUtilizationPct', {
        optional: true,
        min: 1,
        max: 100,
      });
      const strictProcessSequence = v.boolean('strictProcessSequence', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      res.json(
        await withTenant(tenantId, (client) =>
          reference.upsertConfig(client, tenantId, { planningUtilizationPct, strictProcessSequence })
        )
      );
    })
  );

  return router;
}
