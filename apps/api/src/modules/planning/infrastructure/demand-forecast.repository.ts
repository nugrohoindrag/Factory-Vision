import {
  CustomerOrderStatus,
  DemandForecastMethod,
  DemandForecastStatus,
} from '@factory-vision/domain-types';
import type { DemandForecast, DemandForecastLine } from '@factory-vision/domain-types';
import { asDateString, asOptionalIsoString, orUndefined, type Executor } from '../../../platform/db/executor.js';
import type { MonthlyDemandRow } from '../domain/demand-forecast.engine.js';

/** `demand_forecast` and `demand_forecast_line` (MES-027, MES-028). */

const FORECAST_COLUMNS = `
  id, tenant_id, forecast_number,
  to_char(period_start, 'YYYY-MM-DD') AS period_start,
  to_char(period_end, 'YYYY-MM-DD') AS period_end,
  lookback_months, method, generated_by, generated_at, status, superseded_by_id
`;

const LINE_COLUMNS = `
  id, tenant_id, demand_forecast_id, customer_id, product_id, historical_demand,
  average_demand, forecast_quantity, insufficient_history, months_with_history
`;

interface ForecastRow {
  id: string;
  tenant_id: string;
  forecast_number: string;
  period_start: string;
  period_end: string;
  lookback_months: number;
  method: string;
  generated_by: string | null;
  generated_at: Date | string | null;
  status: string;
  superseded_by_id: string | null;
}

interface LineRow {
  id: string;
  tenant_id: string;
  demand_forecast_id: string;
  customer_id: string | null;
  product_id: string;
  historical_demand: Record<string, number>;
  average_demand: string | number;
  forecast_quantity: number;
  insufficient_history: boolean;
  months_with_history: number;
}

export interface DemandForecastLineRecord extends DemandForecastLine {
  insufficientHistory: boolean;
  monthsWithHistory: number;
}

export interface DemandForecastRecord extends DemandForecast {
  supersededById?: string;
  lines?: DemandForecastLineRecord[];
}

function toForecast(row: ForecastRow): DemandForecastRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    forecastNumber: row.forecast_number,
    periodStart: asDateString(row.period_start),
    periodEnd: asDateString(row.period_end),
    lookbackMonths: Number(row.lookback_months),
    method: (row.method as DemandForecastMethod) ?? DemandForecastMethod.HISTORICAL_AVERAGE,
    generatedBy: orUndefined(row.generated_by),
    generatedAt: asOptionalIsoString(row.generated_at),
    status: (row.status as DemandForecastStatus) ?? DemandForecastStatus.DRAFT,
    supersededById: orUndefined(row.superseded_by_id),
  };
}

function toLine(row: LineRow): DemandForecastLineRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    demandForecastId: row.demand_forecast_id,
    customerId: orUndefined(row.customer_id),
    productId: row.product_id,
    historicalDemand: row.historical_demand ?? {},
    averageDemand: Number(row.average_demand),
    forecastQuantity: Number(row.forecast_quantity),
    insufficientHistory: row.insufficient_history,
    monthsWithHistory: Number(row.months_with_history),
  };
}

export class DemandForecastRepository {
  /**
   * Monthly order quantity per product, for the forecast window (MES-027-1).
   *
   * Aggregated on `customer_order.order_date` — when the demand arrived — not on
   * the delivery date, because a forecast of incoming demand that keyed on
   * delivery would shift every order into a future month.
   *
   * `status <> 'CANCELLED'` is the rule "order cancelled tidak dihitung"; the
   * current month is excluded here as well as in the engine, so the rule holds
   * whichever path the data takes.
   */
  async monthlyHistory(
    exec: Executor,
    tenantId: string,
    options: { fromMonth: string; toMonth: string; productIds?: string[] }
  ): Promise<MonthlyDemandRow[]> {
    const params: unknown[] = [
      tenantId,
      `${options.fromMonth}-01`,
      `${options.toMonth}-01`,
      CustomerOrderStatus.CANCELLED,
    ];
    let productFilter = '';
    if (options.productIds && options.productIds.length > 0) {
      params.push(options.productIds);
      productFilter = ` AND col.product_id = ANY($${params.length})`;
    }

    const result = await exec.query<{
      product_id: string;
      customer_id: string;
      month: string;
      quantity: string;
    }>(
      `SELECT col.product_id,
              co.customer_id,
              to_char(co.order_date, 'YYYY-MM') AS month,
              SUM(col.ordered_quantity)::text AS quantity
         FROM customer_order_line col
         JOIN customer_order co ON co.id = col.customer_order_id
        WHERE col.tenant_id = $1
          AND co.order_date >= $2::date
          AND co.order_date < ($3::date + INTERVAL '1 month')
          AND co.status <> $4
          ${productFilter}
        GROUP BY col.product_id, co.customer_id, to_char(co.order_date, 'YYYY-MM')
        ORDER BY col.product_id, month`,
      params
    );

    return result.rows.map((row) => ({
      productId: row.product_id,
      customerId: row.customer_id,
      month: row.month,
      quantity: Number(row.quantity),
    }));
  }

  async insert(exec: Executor, forecast: DemandForecastRecord): Promise<DemandForecastRecord> {
    const result = await exec.query<ForecastRow>(
      `INSERT INTO demand_forecast (
         id, tenant_id, forecast_number, period_start, period_end, lookback_months,
         method, generated_by, status
       ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9)
       RETURNING ${FORECAST_COLUMNS}`,
      [
        forecast.id,
        forecast.tenantId,
        forecast.forecastNumber,
        forecast.periodStart,
        forecast.periodEnd,
        forecast.lookbackMonths,
        forecast.method,
        forecast.generatedBy ?? null,
        forecast.status,
      ]
    );
    return toForecast(result.rows[0]);
  }

  async insertLine(exec: Executor, line: DemandForecastLineRecord): Promise<DemandForecastLineRecord> {
    const result = await exec.query<LineRow>(
      `INSERT INTO demand_forecast_line (
         id, tenant_id, demand_forecast_id, customer_id, product_id, historical_demand,
         average_demand, forecast_quantity, insufficient_history, months_with_history
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       RETURNING ${LINE_COLUMNS}`,
      [
        line.id,
        line.tenantId,
        line.demandForecastId,
        line.customerId ?? null,
        line.productId,
        JSON.stringify(line.historicalDemand),
        line.averageDemand,
        line.forecastQuantity,
        line.insufficientHistory,
        line.monthsWithHistory,
      ]
    );
    return toLine(result.rows[0]);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<DemandForecastRecord | undefined> {
    const result = await exec.query<ForecastRow>(
      `SELECT ${FORECAST_COLUMNS} FROM demand_forecast WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toForecast(result.rows[0]) : undefined;
  }

  async listLines(exec: Executor, tenantId: string, forecastId: string): Promise<DemandForecastLineRecord[]> {
    const result = await exec.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM demand_forecast_line
        WHERE tenant_id = $1 AND demand_forecast_id = $2
        ORDER BY product_id`,
      [tenantId, forecastId]
    );
    return result.rows.map(toLine);
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { status?: DemandForecastStatus; periodStart?: string; limit?: number } = {}
  ): Promise<DemandForecastRecord[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.periodStart) {
      params.push(filter.periodStart);
      where.push(`period_start = $${params.length}::date`);
    }
    params.push(Math.min(filter.limit ?? 100, 500));
    const result = await exec.query<ForecastRow>(
      `SELECT ${FORECAST_COLUMNS} FROM demand_forecast
        WHERE ${where.join(' AND ')}
        ORDER BY period_start DESC, forecast_number DESC
        LIMIT $${params.length}`,
      params
    );
    return result.rows.map(toForecast);
  }

  /**
   * The forecasts a regenerate replaces.
   *
   * Same period and same lookback, still `GENERATED`. A different lookback is a
   * different question, so it is not superseded by this one.
   */
  async findSupersedable(
    exec: Executor,
    tenantId: string,
    periodStart: string,
    lookbackMonths: number
  ): Promise<DemandForecastRecord[]> {
    const result = await exec.query<ForecastRow>(
      `SELECT ${FORECAST_COLUMNS} FROM demand_forecast
        WHERE tenant_id = $1 AND period_start = $2::date AND lookback_months = $3
          AND status = $4
        FOR UPDATE`,
      [tenantId, periodStart, lookbackMonths, DemandForecastStatus.GENERATED]
    );
    return result.rows.map(toForecast);
  }

  /**
   * Marks a forecast superseded.
   *
   * The old row's **lines are never touched** (MES-028): a Production Plan built
   * on those numbers has to keep explaining itself with the numbers that were
   * true at the time.
   */
  async markSuperseded(
    exec: Executor,
    tenantId: string,
    id: string,
    supersededById: string
  ): Promise<void> {
    await exec.query(
      `UPDATE demand_forecast SET status = $3, superseded_by_id = $4
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, DemandForecastStatus.SUPERSEDED, supersededById]
    );
  }

  /** Production Plans that reference a forecast, for the traceability panel. */
  async plansUsing(
    exec: Executor,
    tenantId: string,
    forecastId: string
  ): Promise<{ productionPlanId: string; planNumber: string; status: string }[]> {
    const result = await exec.query<{ id: string; plan_number: string; status: string }>(
      `SELECT id, plan_number, status FROM production_plan
        WHERE tenant_id = $1 AND demand_forecast_id = $2 ORDER BY plan_number`,
      [tenantId, forecastId]
    );
    return result.rows.map((row) => ({
      productionPlanId: row.id,
      planNumber: row.plan_number,
      status: row.status,
    }));
  }
}
