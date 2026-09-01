import {
  PostgresJobQueue,
  type JobHandlerRegistry,
  type JobQueue,
} from '@factory-vision/job-queue';
import { getPool, withTenant } from '../db/pool.js';

/**
 * The platform's queue binding (Architecture §22.5).
 *
 * The contract and its PostgreSQL implementation live in
 * `@factory-vision/job-queue`, below both the API and the worker, so the two
 * cannot disagree about what a job is. This is only where the implementation is
 * chosen and given a connection — the one place §22.5 allows a deployment
 * decision to be made.
 */

let queue: JobQueue | undefined;

export function getJobQueue(): JobQueue {
  if (!queue) {
    queue = new PostgresJobQueue({
      // Claim and completion run outside a tenant context on purpose: a runner
      // cannot know whose job is next, so it cannot declare a tenant first. The
      // tenant travels on the row and the handler declares it.
      //
      // `getPool()` is resolved per statement rather than captured here: a
      // service that merely constructs this queue — every planning service does,
      // as a field — must not open a connection pool as a side effect. That
      // would make a unit test with no `DATABASE_URL` throw at import, and would
      // hold a pool open for a process that never touches the queue.
      exec: {
        query: (text, params) => getPool().query(text, params as unknown[]),
      },
      withTenant,
    });
  }
  return queue;
}

/**
 * Builds the handler map for planning work.
 *
 * Exported as a factory rather than a constant so the worker can construct it
 * in its own process, and so nothing is instantiated at import time in a test
 * that never runs a job.
 */
export async function createPlanningJobHandlers(): Promise<JobHandlerRegistry> {
  // Imported lazily: the handlers pull in the whole planning application layer,
  // and a process that only enqueues should not pay for that.
  const { DemandForecastService } = await import(
    '../../modules/planning/application/demand-forecast.service.js'
  );
  const { CapacityPlanService } = await import(
    '../../modules/planning/application/capacity-plan.service.js'
  );
  const forecasts = new DemandForecastService();
  const capacity = new CapacityPlanService();

  return {
    DEMAND_FORECAST_GENERATE: async (job) => {
      const detail = await forecasts.runGenerate(
        job.tenantId,
        job.payload as never,
        job.requestedBy ?? 'system'
      );
      return {
        demandForecastId: detail.id,
        forecastNumber: detail.forecastNumber,
        lineCount: detail.lines.length,
        insufficientHistoryCount: detail.lines.filter((l) => l.insufficientHistory).length,
      };
    },

    CAPACITY_PLAN_RECALCULATE: async (job) => {
      const capacityPlanId = (job.payload as { capacityPlanId?: string }).capacityPlanId;
      if (!capacityPlanId) {
        throw new Error('Job CAPACITY_PLAN_RECALCULATE tanpa capacityPlanId.');
      }
      const detail = await capacity.runRecalculate(
        job.tenantId,
        capacityPlanId,
        job.requestedBy ?? 'system'
      );
      return {
        capacityPlanId: detail.id,
        planNumber: detail.planNumber,
        lineCount: detail.lines.length,
      };
    },
  };
}
