import { Router } from 'express';
import { DemandForecastStatus } from '@factory-vision/domain-types';
import { route } from '../../../platform/http/envelope.js';
import { validate } from '../../../platform/http/validate.js';
import type { DemandForecastService } from '../application/demand-forecast.service.js';
import type { JobRunner } from '@factory-vision/job-queue';
import { ALLOWED_LOOKBACKS, type LookbackMonths } from '../domain/demand-forecast.engine.js';
import { actorOf } from './customer.routes.js';

/** `/v1/demand-forecasts` (MES-027, MES-028). */
export function demandForecastRoutes(
  forecasts: DemandForecastService,
  runner: JobRunner | undefined
): Router {
  const router = Router();

  /**
   * Enqueues the generation and answers **202 with a job id** (MES-027).
   *
   * The aggregation is a worker job, not request work: twelve months of a
   * pilot's order history is not something to hold a browser open for, and a
   * request that times out halfway would leave a half-written snapshot.
   */
  router.post(
    '/demand-forecasts/generate',
    route(async (req, res) => {
      const v = validate(req.body);
      const periodStart = v.isoDate('periodStart');
      const periodEnd = v.isoDate('periodEnd');
      const lookback = v.number('lookbackMonths', { integer: true });
      const perCustomer = v.boolean('perCustomer', { optional: true });
      const rawProducts = (req.body as { productIds?: unknown }).productIds;
      if (rawProducts !== undefined && !Array.isArray(rawProducts)) {
        v.reject('productIds', 'INVALID_TYPE', 'productIds harus berupa daftar id product.');
      }
      if (lookback !== undefined && !ALLOWED_LOOKBACKS.includes(lookback as LookbackMonths)) {
        v.reject(
          'lookbackMonths',
          'INVALID_VALUE',
          `Lookback harus salah satu dari ${ALLOWED_LOOKBACKS.join(', ')} bulan (ADR-20).`
        );
      }
      v.done();

      const job = await forecasts.enqueueGenerate(
        req.context!.tenantId,
        {
          periodStart: periodStart!.slice(0, 10),
          periodEnd: periodEnd!.slice(0, 10),
          lookbackMonths: lookback as LookbackMonths,
          perCustomer,
          productIds: Array.isArray(rawProducts) ? (rawProducts as string[]) : undefined,
        },
        actorOf(req)
      );

      // Nudge the runner so an interactive request does not wait for the next
      // poll tick; the job is still executed by the runner, not by this handler.
      void runner?.runOnce().catch(() => undefined);

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        message: 'Perhitungan forecast dijalankan sebagai job. Pantau status lewat /demand-forecasts/jobs.',
      });
    })
  );

  router.get(
    '/demand-forecasts/jobs',
    route(async (req, res) => {
      res.json(await forecasts.listJobs(req.context!.tenantId));
    })
  );

  router.get(
    '/demand-forecasts/jobs/:jobId',
    route(async (req, res) => {
      res.json(await forecasts.getJob(req.context!.tenantId, req.params.jobId));
    })
  );

  router.get(
    '/demand-forecasts',
    route(async (req, res) => {
      const status =
        typeof req.query.status === 'string' &&
        (Object.values(DemandForecastStatus) as string[]).includes(req.query.status)
          ? (req.query.status as DemandForecastStatus)
          : undefined;
      res.json(await forecasts.list(req.context!.tenantId, { status }));
    })
  );

  /** Forecast beside the orders that actually arrived (MES-030). */
  router.get(
    '/demand-forecasts/:id/comparison',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const forecast = await forecasts.get(tenantId, req.params.id);
      const actuals = await forecasts.actualsForPeriod(
        tenantId,
        forecast.periodStart,
        forecast.periodEnd
      );
      const actualByProduct = new Map(actuals.map((a) => [a.productId, a.orderedQuantity]));
      res.json({
        forecastId: forecast.id,
        periodStart: forecast.periodStart,
        periodEnd: forecast.periodEnd,
        rows: forecast.lines.map((line) => ({
          productId: line.productId,
          forecastQuantity: line.forecastQuantity,
          actualOrderedQuantity: actualByProduct.get(line.productId) ?? 0,
          variance: (actualByProduct.get(line.productId) ?? 0) - line.forecastQuantity,
          insufficientHistory: line.insufficientHistory,
        })),
      });
    })
  );

  router.get(
    '/demand-forecasts/:id',
    route(async (req, res) => {
      res.json(await forecasts.get(req.context!.tenantId, req.params.id));
    })
  );

  return router;
}
