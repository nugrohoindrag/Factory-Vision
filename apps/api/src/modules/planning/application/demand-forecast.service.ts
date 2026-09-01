import { randomUUID } from 'crypto';
import { DemandForecastMethod, DemandForecastStatus } from '@factory-vision/domain-types';
import { withTenant } from '../../../platform/db/pool.js';
import type { Executor } from '../../../platform/db/executor.js';
import { ApiError } from '../../../platform/http/api-error.js';
import {
  DemandForecastRepository,
  type DemandForecastRecord,
  type DemandForecastLineRecord,
} from '../infrastructure/demand-forecast.repository.js';
import type { Job } from '@factory-vision/job-queue';
import { getJobQueue } from '../../../platform/queue/index.js';
import { PlanningAudit } from '../infrastructure/planning-audit.js';
import { OutboxRepository } from '../infrastructure/outbox.repository.js';
import { demandForecastPrefix, nextNumber } from '../domain/numbering.js';
import { PLANNING_EVENTS, planningEvent } from '../domain/planning.events.js';
import {
  ALLOWED_LOOKBACKS,
  computeForecast,
  lookbackMonths,
  type LookbackMonths,
} from '../domain/demand-forecast.engine.js';

/**
 * Demand Forecast (MES-027, MES-028).
 *
 * Two properties the rest of planning depends on:
 *
 * - **Generation is a job, not a request.** `enqueue` returns immediately with a
 *   job id; the runner does the aggregation. A twelve-month history over a
 *   pilot's orders is not work to hold a browser open for.
 * - **A forecast is an immutable snapshot.** Regenerating writes a *new* row and
 *   marks the old one `SUPERSEDED`; the old row's lines are never touched, so a
 *   Production Plan built on last month's numbers can still show the numbers it
 *   was built on.
 */

export interface GenerateForecastInput {
  periodStart: string;
  periodEnd: string;
  lookbackMonths: LookbackMonths;
  productIds?: string[];
  perCustomer?: boolean;
  /** Overrides "now" for the current-month exclusion; used by tests. */
  asOf?: string;
}

export interface DemandForecastDetail extends DemandForecastRecord {
  lines: DemandForecastLineRecord[];
  /** Production Plans built on this snapshot (MES-028 traceability). */
  usedByPlans: { productionPlanId: string; planNumber: string; status: string }[];
}

export class DemandForecastService {
  private readonly forecasts = new DemandForecastRepository();
  private readonly jobs = getJobQueue();
  private readonly audit = new PlanningAudit();
  private readonly outbox = new OutboxRepository();

  // --- Generation (MES-027) -------------------------------------------

  /** `POST /v1/demand-forecasts/generate` — enqueues, returns 202 (MES-028-1). */
  async enqueueGenerate(
    tenantId: string,
    input: GenerateForecastInput,
    actorId: string
  ): Promise<Job> {
    this.assertInput(input);
    // Enqueued on the request's own connection so the job row commits with the
    // rest of the request, not on a second one that could succeed alone.
    return withTenant(tenantId, (client) =>
      this.jobs.enqueue(
        {
          tenantId,
          jobType: 'DEMAND_FORECAST_GENERATE',
          payload: { ...input },
          requestedBy: actorId,
        },
        client
      )
    );
  }

  async getJob(tenantId: string, jobId: string): Promise<Job> {
    const job = await this.jobs.findById(tenantId, jobId);
    if (!job) throw ApiError.notFound('Job forecast tidak ditemukan.');
    return job;
  }

  async listJobs(tenantId: string): Promise<Job[]> {
    return this.jobs.list(tenantId, { jobType: 'DEMAND_FORECAST_GENERATE' });
  }

  private assertInput(input: GenerateForecastInput): void {
    if (!ALLOWED_LOOKBACKS.includes(input.lookbackMonths)) {
      throw ApiError.validation(
        `Lookback harus salah satu dari ${ALLOWED_LOOKBACKS.join(', ')} bulan.`,
        [
          {
            field: 'lookbackMonths',
            code: 'INVALID_VALUE',
            message: `Lookback ${input.lookbackMonths} tidak didukung.`,
          },
        ]
      );
    }
    if (Date.parse(input.periodEnd) < Date.parse(input.periodStart)) {
      throw ApiError.validation('Periode forecast tidak valid.', [
        {
          field: 'periodEnd',
          code: 'OUT_OF_RANGE',
          message: 'Period end harus setelah atau sama dengan period start.',
        },
      ]);
    }
  }

  /**
   * Runs one generation. Called by the job runner, never from a request handler.
   *
   * Everything — history read, supersede, insert, audit, event — happens in one
   * transaction: a forecast that superseded its predecessor but failed to write
   * its own lines would leave the tenant with no current forecast at all.
   */
  async runGenerate(
    tenantId: string,
    input: GenerateForecastInput,
    actorId: string
  ): Promise<DemandForecastDetail> {
    this.assertInput(input);
    const asOf = input.asOf ? new Date(input.asOf) : new Date();
    const months = lookbackMonths(asOf, input.lookbackMonths);

    return withTenant(tenantId, async (client) => {
      const history = await this.forecasts.monthlyHistory(client, tenantId, {
        fromMonth: months[0],
        toMonth: months[months.length - 1],
        productIds: input.productIds,
      });

      const computed = computeForecast(history, {
        lookback: input.lookbackMonths,
        asOf,
        perCustomer: input.perCustomer,
      });

      const forecastNumber = await nextNumber(
        client,
        tenantId,
        'demand_forecast',
        'forecast_number',
        demandForecastPrefix(input.periodStart)
      );

      const forecast = await this.forecasts.insert(client, {
        id: `fc-${randomUUID()}`,
        tenantId,
        forecastNumber,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        lookbackMonths: input.lookbackMonths,
        method: DemandForecastMethod.HISTORICAL_AVERAGE,
        generatedBy: actorId,
        status: DemandForecastStatus.GENERATED,
      });

      const lines: DemandForecastLineRecord[] = [];
      for (const result of computed) {
        lines.push(
          await this.forecasts.insertLine(client, {
            id: `fcl-${randomUUID()}`,
            tenantId,
            demandForecastId: forecast.id,
            customerId: result.customerId,
            productId: result.productId,
            historicalDemand: result.historicalDemand,
            averageDemand: result.averageDemand,
            forecastQuantity: result.forecastQuantity,
            insufficientHistory: result.insufficientHistory,
            monthsWithHistory: result.monthsWithHistory,
          })
        );
      }

      // Supersede the previous snapshot for the same question. Its lines stay
      // exactly as they were (MES-028): a plan that used them must still be
      // explainable with the numbers that were true when it was decided.
      const superseded = await this.forecasts.findSupersedable(
        client,
        tenantId,
        input.periodStart,
        input.lookbackMonths
      );
      for (const previous of superseded) {
        if (previous.id === forecast.id) continue;
        await this.forecasts.markSuperseded(client, tenantId, previous.id, forecast.id);
      }

      await this.audit.record(client, {
        tenantId,
        actorId,
        actorType: 'SYSTEM',
        entityType: 'demand_forecast',
        entityId: forecast.id,
        action: 'GENERATE',
        previousValue: superseded.length
          ? { supersededForecastIds: superseded.map((f) => f.id) }
          : undefined,
        newValue: {
          forecastNumber: forecast.forecastNumber,
          lookbackMonths: forecast.lookbackMonths,
          months,
          lineCount: lines.length,
          insufficientHistoryCount: lines.filter((l) => l.insufficientHistory).length,
        },
      });

      await this.outbox.publish(
        client,
        tenantId,
        planningEvent(PLANNING_EVENTS.DEMAND_FORECAST_GENERATED, 'demand_forecast', forecast.id, {
          forecastNumber: forecast.forecastNumber,
          periodStart: forecast.periodStart,
          periodEnd: forecast.periodEnd,
          lookbackMonths: forecast.lookbackMonths,
          lineCount: lines.length,
          insufficientHistoryCount: lines.filter((l) => l.insufficientHistory).length,
          supersededForecastId: superseded[0]?.id,
        })
      );

      return { ...forecast, lines, usedByPlans: [] };
    });
  }

  // --- Reads (MES-028-2) ----------------------------------------------

  async list(tenantId: string, filter: { status?: DemandForecastStatus } = {}): Promise<DemandForecastRecord[]> {
    return withTenant(tenantId, (client) => this.forecasts.list(client, tenantId, filter));
  }

  async get(tenantId: string, id: string): Promise<DemandForecastDetail> {
    return withTenant(tenantId, async (client) => this.readDetail(client, tenantId, id));
  }

  /** The current snapshot for a period, or `undefined` if none was generated. */
  async latestForPeriod(
    tenantId: string,
    periodStart: string
  ): Promise<DemandForecastDetail | undefined> {
    return withTenant(tenantId, async (client) => {
      const [latest] = await this.forecasts.list(client, tenantId, {
        status: DemandForecastStatus.GENERATED,
        periodStart,
      });
      return latest ? this.readDetail(client, tenantId, latest.id) : undefined;
    });
  }

  private async readDetail(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<DemandForecastDetail> {
    const forecast = await this.forecasts.findById(exec, tenantId, id);
    if (!forecast) throw ApiError.notFound('Demand forecast tidak ditemukan.');
    return {
      ...forecast,
      lines: await this.forecasts.listLines(exec, tenantId, id),
      usedByPlans: await this.forecasts.plansUsing(exec, tenantId, id),
    };
  }

  /**
   * Actual order quantity for the forecast period, so the UI can put the
   * forecast next to what really arrived (MES-030).
   */
  async actualsForPeriod(
    tenantId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<{ productId: string; orderedQuantity: number }[]> {
    return withTenant(tenantId, async (client) => {
      const result = await client.query<{ product_id: string; ordered: string }>(
        `SELECT col.product_id, SUM(col.ordered_quantity)::text AS ordered
           FROM customer_order_line col
           JOIN customer_order co ON co.id = col.customer_order_id
          WHERE col.tenant_id = $1
            AND co.order_date >= $2::date AND co.order_date <= $3::date
            AND co.status <> 'CANCELLED'
          GROUP BY col.product_id
          ORDER BY col.product_id`,
        [tenantId, periodStart, periodEnd]
      );
      return result.rows.map((row) => ({
        productId: row.product_id,
        orderedQuantity: Number(row.ordered),
      }));
    });
  }
}
