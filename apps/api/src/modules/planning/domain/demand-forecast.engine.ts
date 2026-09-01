/**
 * Demand Forecast — historical average (MES-027, §45.5, ADR-20).
 *
 * The MVP method is **historical average and nothing else**. No statistical
 * model, no seasonality. That is a decision, not a shortcut: a number a PPIC
 * planner can reproduce on paper is a number they will act on, and every rule
 * below exists because getting it wrong quietly is worse than not forecasting.
 *
 * ```text
 * forecast = Σ monthly_quantity ÷ lookback_months
 * ```
 *
 * Four rules that decide whether the number means anything:
 *
 * 1. **The current month is excluded.** It is partial by definition; including
 *    it drags every forecast down by however much of the month is left.
 * 2. **A month with no orders counts as zero, it is not skipped.** Skipping it
 *    divides by fewer months and turns a quiet quarter into a boom.
 * 3. **Cancelled orders do not count.** They were never demand.
 * 4. **Too little history is flagged, not hidden.** A product with two months of
 *    orders and a twelve-month lookback gets `insufficient_history`, and its
 *    number is shown next to the flag rather than presented as fact.
 *
 * Pure: it takes months and rows, and returns lines. The query and the job
 * wrapper live elsewhere, so every rule here is unit-testable.
 */

export type LookbackMonths = 3 | 6 | 12;

export const ALLOWED_LOOKBACKS: LookbackMonths[] = [3, 6, 12];

/** One `(product, month)` total, as read from the order history. */
export interface MonthlyDemandRow {
  productId: string;
  customerId?: string;
  /** `YYYY-MM`. */
  month: string;
  quantity: number;
}

export interface ForecastLineResult {
  productId: string;
  customerId?: string;
  /** Every month in the lookback window, including the empty ones as 0. */
  historicalDemand: Record<string, number>;
  averageDemand: number;
  forecastQuantity: number;
  /** Months in the window that actually carried an order. */
  monthsWithHistory: number;
  insufficientHistory: boolean;
}

/**
 * The months a lookback covers, ending with the **last complete month**.
 *
 * `asOf` is normally today. For a lookback of 3 asked on 2026-08-31 the window
 * is 2026-05, 2026-06, 2026-07 — August is still running and is excluded.
 */
export function lookbackMonths(asOf: Date, lookback: LookbackMonths): string[] {
  const months: string[] = [];
  // Start from the first day of the current month, then step back one month to
  // land on the last complete one.
  const cursor = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  for (let i = 0; i < lookback; i += 1) {
    months.unshift(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
    );
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return months;
}

/** `YYYY-MM` of the month that is still running, and therefore excluded. */
export function currentMonth(asOf: Date): string {
  return `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface ForecastOptions {
  lookback: LookbackMonths;
  asOf: Date;
  /** Group by customer as well as product; off by default (§45.5 is per Product). */
  perCustomer?: boolean;
  /**
   * How many months of real history a forecast needs to stand on its own.
   * Defaults to the whole window: anything less is flagged.
   */
  minimumMonths?: number;
}

/**
 * Turns raw monthly totals into forecast lines.
 *
 * Rows outside the window are ignored rather than rejected — the caller is
 * free to over-fetch — and rows for the current month are dropped here as well
 * as in the query, because the rule must hold whichever way the data arrives.
 */
export function computeForecast(
  rows: MonthlyDemandRow[],
  options: ForecastOptions
): ForecastLineResult[] {
  const months = lookbackMonths(options.asOf, options.lookback);
  const window = new Set(months);
  const excluded = currentMonth(options.asOf);
  const minimumMonths = options.minimumMonths ?? options.lookback;

  const groups = new Map<string, { productId: string; customerId?: string; byMonth: Map<string, number> }>();

  for (const row of rows) {
    if (row.month === excluded) continue;
    if (!window.has(row.month)) continue;

    const key = options.perCustomer ? `${row.productId}::${row.customerId ?? ''}` : row.productId;
    let group = groups.get(key);
    if (!group) {
      group = {
        productId: row.productId,
        customerId: options.perCustomer ? row.customerId : undefined,
        byMonth: new Map(),
      };
      groups.set(key, group);
    }
    group.byMonth.set(row.month, (group.byMonth.get(row.month) ?? 0) + row.quantity);
  }

  const results: ForecastLineResult[] = [];
  for (const group of groups.values()) {
    const historicalDemand: Record<string, number> = {};
    let total = 0;
    let monthsWithHistory = 0;

    for (const month of months) {
      // A month with no order is a zero in the average, never an omission.
      const quantity = group.byMonth.get(month) ?? 0;
      historicalDemand[month] = quantity;
      total += quantity;
      if (quantity > 0) monthsWithHistory += 1;
    }

    // Divided by the full lookback, not by the months that happened to have
    // orders — that is the same rule as counting empty months as zero.
    const averageDemand = total / options.lookback;

    results.push({
      productId: group.productId,
      customerId: group.customerId,
      historicalDemand,
      averageDemand: Math.round(averageDemand * 100) / 100,
      // Demand is whole units; rounding up avoids planning one piece short.
      forecastQuantity: Math.ceil(averageDemand),
      monthsWithHistory,
      insufficientHistory: monthsWithHistory < minimumMonths,
    });
  }

  return results.sort((a, b) => a.productId.localeCompare(b.productId));
}
