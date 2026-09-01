import { randomUUID } from 'crypto';
import type pg from 'pg';
import type {
  EnqueueRequest,
  Job,
  JobQueue,
  JobResult,
  JobType,
  TransactionalRunner,
} from './contract.js';

/**
 * The self-hosted queue: `planning_job` in PostgreSQL.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes a table a queue. Each claim takes a
 * row no other transaction holds, so the API's in-process runner and any number
 * of worker containers share the work instead of racing for it — and no broker
 * is needed to get there.
 *
 * The claim deliberately runs **outside** a tenant context: a runner cannot
 * know whose job is next, so it cannot declare a tenant before reading one. The
 * tenant travels on the row and the handler declares it before doing anything,
 * which is what §22.4 requires.
 */

interface Row {
  id: string;
  tenant_id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  last_error: string | null;
  attempts: number;
  max_attempts: number;
  requested_by: string | null;
  enqueued_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

const COLUMNS = `
  id, tenant_id, job_type, payload, status, result, last_error, attempts, max_attempts,
  requested_by, enqueued_at, started_at, finished_at
`;

function iso(value: Date | string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDomain(row: Row): Job {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    jobType: row.job_type as JobType,
    payload: row.payload ?? {},
    status: row.status as Job['status'],
    result: row.result ?? undefined,
    lastError: row.last_error ?? undefined,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    requestedBy: row.requested_by ?? undefined,
    enqueuedAt: iso(row.enqueued_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

/** Anything that can run a statement: a pool, or a client in a transaction. */
export interface QueryRunner {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>>;
}

export interface PostgresJobQueueOptions {
  /** Runs a statement outside any tenant context, for claim and completion. */
  exec: QueryRunner;
  /**
   * Runs `fn` with `app.tenant_id` set, for the tenant-scoped reads.
   *
   * Passed in rather than built here so the package never owns a connection
   * pool: the API and the worker each bring their own.
   */
  withTenant: <T>(tenantId: string, fn: (client: QueryRunner) => Promise<T>) => Promise<T>;
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly options: PostgresJobQueueOptions) {}

  async enqueue(request: EnqueueRequest, runner?: TransactionalRunner): Promise<Job> {
    const sql = `INSERT INTO planning_job (id, tenant_id, job_type, payload, requested_by, max_attempts)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         RETURNING ${COLUMNS}`;
    const params = [
      `job-${randomUUID()}`,
      request.tenantId,
      request.jobType,
      JSON.stringify(request.payload ?? {}),
      request.requestedBy ?? null,
      request.maxAttempts ?? 3,
    ];

    // A caller already inside a transaction enqueues on that connection, so the
    // job row and the change that justified it commit or roll back together.
    if (runner) {
      const result = await runner.query(sql, params);
      return toDomain(result.rows[0] as unknown as Row);
    }

    return this.options.withTenant(request.tenantId, async (client) => {
      const result = await client.query<Row>(sql, params);
      return toDomain(result.rows[0]);
    });
  }

  /**
   * Takes the oldest eligible job and marks it RUNNING, atomically.
   *
   * Jobs past `max_attempts` are skipped: one that fails deterministically must
   * stop consuming a runner rather than spin forever, and stay visible as
   * FAILED for someone to look at.
   */
  async claim(): Promise<Job | undefined> {
    const claimed = await this.options.exec.query<Row>(
      `UPDATE planning_job
          SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM planning_job
           WHERE status = 'PENDING' AND attempts < max_attempts
           ORDER BY enqueued_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING ${COLUMNS}`
    );
    return claimed.rows[0] ? toDomain(claimed.rows[0]) : undefined;
  }

  async succeed(jobId: string, result: JobResult): Promise<void> {
    await this.options.exec.query(
      `UPDATE planning_job
          SET status = 'SUCCEEDED', result = $2::jsonb,
              finished_at = CURRENT_TIMESTAMP, last_error = NULL
        WHERE id = $1`,
      [jobId, JSON.stringify(result ?? {})]
    );
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.options.exec.query(
      `UPDATE planning_job
          SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
              last_error = $2,
              finished_at = CASE WHEN attempts >= max_attempts THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = $1`,
      [jobId, error.slice(0, 2000)]
    );
  }

  async findById(tenantId: string, jobId: string): Promise<Job | undefined> {
    return this.options.withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT ${COLUMNS} FROM planning_job WHERE tenant_id = $1 AND id = $2`,
        [tenantId, jobId]
      );
      return result.rows[0] ? toDomain(result.rows[0]) : undefined;
    });
  }

  async list(
    tenantId: string,
    filter: { jobType?: JobType; limit?: number } = {}
  ): Promise<Job[]> {
    return this.options.withTenant(tenantId, async (client) => {
      const where = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (filter.jobType) {
        params.push(filter.jobType);
        where.push(`job_type = $${params.length}`);
      }
      params.push(Math.min(filter.limit ?? 50, 200));
      const result = await client.query<Row>(
        `SELECT ${COLUMNS} FROM planning_job WHERE ${where.join(' AND ')}
          ORDER BY enqueued_at DESC LIMIT $${params.length}`,
        params
      );
      return result.rows.map(toDomain);
    });
  }
}
