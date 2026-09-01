/**
 * Document numbering, per the Naming Convention standard.
 *
 * ```text
 * CO-YYMMDD-NNN      Customer Order      (MES-021-2)
 * PLAN-YYYYMM-NNN    Production Plan     (MES-035-2)
 * FC-YYYYMM-NNN      Demand Forecast
 * CAP-YYYYMM-NNN     Capacity Plan
 * WO-<process>-NNN   Work Order          (built from the plan number)
 * ```
 *
 * The sequence is resolved from what is already stored rather than from a
 * counter in this process: two API instances would otherwise hand out the same
 * number, and the unique constraint would turn that into a 500 on an order the
 * user filled in correctly. `nextSequence` takes the highest suffix in use for
 * the prefix and adds one; the caller runs it inside the same transaction as
 * the insert, so the read and the write cannot be interleaved.
 */

import type { Executor } from '../../../platform/db/executor.js';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `YYMMDD` for a date-stamped prefix. */
export function yymmdd(date: Date): string {
  return (
    pad(date.getFullYear() % 100, 2) + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2)
  );
}

/** `YYYYMM` for a period-stamped prefix. */
export function yyyymm(date: Date): string {
  return String(date.getFullYear()) + pad(date.getMonth() + 1, 2);
}

export function customerOrderPrefix(orderDate: string | Date): string {
  const date = orderDate instanceof Date ? orderDate : new Date(orderDate);
  return `CO-${yymmdd(date)}`;
}

export function productionPlanPrefix(periodStart: string | Date): string {
  const date = periodStart instanceof Date ? periodStart : new Date(periodStart);
  return `PLAN-${yyyymm(date)}`;
}

export function demandForecastPrefix(periodStart: string | Date): string {
  const date = periodStart instanceof Date ? periodStart : new Date(periodStart);
  return `FC-${yyyymm(date)}`;
}

export function capacityPlanPrefix(periodStart: string | Date): string {
  const date = periodStart instanceof Date ? periodStart : new Date(periodStart);
  return `CAP-${yyyymm(date)}`;
}

/**
 * The next free `PREFIX-NNN` for a tenant.
 *
 * `LIKE prefix || '-%'` rather than a stored counter, and read inside the
 * caller's transaction. The suffix is compared as an integer so `-010` sorts
 * after `-009` rather than lexically before it.
 */
export async function nextNumber(
  exec: Executor,
  tenantId: string,
  table: string,
  column: string,
  prefix: string,
  width = 3
): Promise<string> {
  // `table` and `column` are compile-time literals from the repositories in
  // this module, never request input, so interpolating them is safe; the values
  // that come from outside stay bound parameters.
  const result = await exec.query<{ max_suffix: string | null }>(
    `SELECT MAX(NULLIF(regexp_replace(${column}, '^.*-', ''), '')::int)::text AS max_suffix
       FROM ${table}
      WHERE tenant_id = $1
        AND ${column} LIKE $2
        AND ${column} ~ ('^' || $3 || '-[0-9]+$')`,
    [tenantId, `${prefix}-%`, prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]
  );
  const highest = Number(result.rows[0]?.max_suffix ?? 0);
  return `${prefix}-${pad(highest + 1, width)}`;
}
