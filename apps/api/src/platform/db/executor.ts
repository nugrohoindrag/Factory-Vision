import type pg from 'pg';

/**
 * Anything that can run a statement: the pool itself, or a client already
 * inside a transaction.
 *
 * Repository methods take one of these rather than reaching for the pool
 * themselves, so a caller can compose several of them into one transaction.
 * Recording production output, for example, inserts a production_record and
 * updates the work order's running totals; those go in together or not at all
 * (persistence fix §7), which is only expressible if both repositories accept
 * the same client.
 */
export interface Executor {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>>;
}

/**
 * Reads a DATE column as the calendar date PostgreSQL holds, not as a moment.
 *
 * node-postgres turns DATE into a JS Date at local midnight, so a server in
 * any timezone west of the database renders `shift_date` as the previous day.
 * `shift_date` decides which shift a record belongs to and therefore every OEE
 * figure derived from it, so the queries select `to_char(...)` and this only
 * guards the value that arrives.
 */
export function asDateString(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

/** Reads a TIMESTAMPTZ column as an ISO-8601 string. */
export function asIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
}

/** Reads a TIMESTAMPTZ column that the schema allows to be null. */
export function asOptionalIsoString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return asIsoString(value);
}

/** Turns a nullable column into an absent property rather than an explicit null. */
export function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}
