/**
 * The queue contract shared by the API and the worker.
 *
 * Architecture §22.5 (ADR-09) requires every external dependency to sit behind
 * an interface chosen at bootstrap, with a self-hosted implementation that is
 * exercised in CI. This file is that interface for the job queue; the Postgres
 * implementation beside it is the self-hosted one.
 *
 * It lives in its own package rather than inside the API because the API and
 * the worker must agree on it exactly. When the definition lived in the API,
 * moving work to the worker meant reaching into another app's build output,
 * and the two could drift without anything failing.
 *
 * A BullMQ/Redis implementation would satisfy the same interface. It is
 * deliberately not written yet: the architecture's own note on the queue is
 * "cukup untuk agregasi & alert; upgrade saat Phase 6", and adding a broker to
 * a single-VPS deployment before anything demands one is complexity with no
 * question behind it.
 */

/**
 * Job kinds the platform knows. Adding one is a deliberate, typed change.
 *
 * The outbox relay is deliberately *not* a job type. Its only subscriber today
 * is the realtime gateway, which exists in the API process alone; a worker that
 * claimed a relay job would mark events published without anybody having heard
 * them. The relay therefore runs as its own loop in the process that owns the
 * subscribers, not as queued work any runner may pick up.
 */
export type JobType = 'DEMAND_FORECAST_GENERATE' | 'CAPACITY_PLAN_RECALCULATE';

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface Job {
  id: string;
  /**
   * Every job carries its tenant explicitly.
   *
   * §22.4: "Job dan worker menjalankan tenant context yang sama secara
   * eksplisit; tidak ada job yang berjalan tanpa tenant." A queue row without
   * a tenant would execute outside every RLS policy.
   */
  tenantId: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  result?: Record<string, unknown>;
  lastError?: string;
  attempts: number;
  maxAttempts: number;
  requestedBy?: string;
  enqueuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface EnqueueRequest {
  tenantId: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  requestedBy?: string;
  maxAttempts?: number;
}

/**
 * What a handler returns: whatever the caller should be able to read back from
 * `job.result`. Kept as a plain record so the queue never depends on a domain
 * type, which is what lets this package sit below both apps.
 */
export type JobResult = Record<string, unknown>;

export type JobHandler = (job: Job) => Promise<JobResult>;

/** The handler map a runner is constructed with. */
export type JobHandlerRegistry = Partial<Record<JobType, JobHandler>>;

/**
 * Anything that can run a statement: a pool, or a client already inside a
 * transaction. Structural so the queue never depends on a particular driver
 * wrapper — the API's `Executor` and a raw `pg.PoolClient` both satisfy it.
 */
export interface TransactionalRunner {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * The queue itself.
 *
 * `claim` is the only subtle method: it must hand exactly one job to exactly
 * one runner, so that the API's in-process runner and a worker container can
 * both poll the same queue without doing the same work twice.
 */
export interface JobQueue {
  /**
   * Adds a job.
   *
   * `runner` lets the caller enqueue **inside its own transaction**, which is
   * the whole reason a queue in the database is worth having: the job row and
   * the state change that justifies it commit together, so there is never a
   * forecast job for a forecast that rolled back, nor a committed request with
   * no job. Omit it and the queue opens its own transaction.
   */
  enqueue(request: EnqueueRequest, runner?: TransactionalRunner): Promise<Job>;
  /** Takes the oldest eligible job and marks it RUNNING. */
  claim(): Promise<Job | undefined>;
  succeed(jobId: string, result: JobResult): Promise<void>;
  /** Records a failure; returns the job to PENDING while retries remain. */
  fail(jobId: string, error: string): Promise<void>;
  findById(tenantId: string, jobId: string): Promise<Job | undefined>;
  list(tenantId: string, filter?: { jobType?: JobType; limit?: number }): Promise<Job[]>;
}
