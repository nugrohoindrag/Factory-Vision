import type { Job, JobHandlerRegistry, JobQueue } from './contract.js';

/**
 * Drains a queue by handing each claimed job to its registered handler.
 *
 * The runner owns no domain knowledge: it is constructed with a handler map, so
 * the same loop serves the API process and the worker container. That is the
 * point of putting it here — the two used to have to be the same process
 * because the dispatch lived next to the planning services.
 *
 * The loop never throws. A job that fails is recorded against its row and
 * retried until `max_attempts`; a runner that died on a bad payload would take
 * every later job with it.
 */

export interface JobRunnerOptions {
  queue: JobQueue;
  handlers: JobHandlerRegistry;
  /** Names the process in log lines, so two runners are tellable apart. */
  label?: string;
  /** Most jobs to take in one drain, so one busy tenant cannot monopolise. */
  batchSize?: number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export class JobRunner {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private draining = false;

  private readonly handlers: JobHandlerRegistry;

  constructor(private readonly options: JobRunnerOptions) {
    this.handlers = { ...options.handlers };
  }

  /**
   * Adds handlers after construction.
   *
   * The API mounts its routes synchronously but builds the planning handlers
   * asynchronously (they pull in the whole application layer). Without this the
   * runner would have to be constructed inside a promise, and the router would
   * have nothing to nudge when a request enqueues a job.
   */
  register(handlers: JobHandlerRegistry): void {
    Object.assign(this.handlers, handlers);
  }

  private get label(): string {
    return this.options.label ?? 'job-runner';
  }

  /** Processes one job. Returns `undefined` when the queue was empty. */
  async runOnce(): Promise<Job | undefined> {
    const job = await this.options.queue.claim();
    if (!job) return undefined;

    const handler = this.handlers[job.jobType];
    if (!handler) {
      // A job nobody can run must not sit RUNNING for ever, and must not be
      // retried by a runner that will never have the handler either.
      const message =
        `Tidak ada handler untuk job type ${job.jobType} pada ${this.label}. ` +
        'Job ditandai gagal agar tidak menggantung.';
      await this.options.queue.fail(job.id, message);
      this.options.logError?.(`[${this.label}] ${message}`);
      return { ...job, status: 'FAILED', lastError: message };
    }

    try {
      const result = await handler(job);
      await this.options.queue.succeed(job.id, result);
      return { ...job, status: 'SUCCEEDED', result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.queue.fail(job.id, message);
      this.options.logError?.(`[${this.label}] ${job.jobType} ${job.id} gagal: ${message}`);
      return { ...job, status: 'FAILED', lastError: message };
    }
  }

  /**
   * Drains the queue, then waits.
   *
   * Draining first means a burst is not spread across one poll interval each: a
   * planner who queued three forecasts gets all three without a minute between
   * them.
   */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let processed = 0;
    try {
      const limit = this.options.batchSize ?? 20;
      for (let i = 0; i < limit; i += 1) {
        const job = await this.runOnce();
        if (!job) break;
        processed += 1;
      }
    } catch (error) {
      this.options.logError?.(
        `[${this.label}] runner error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.draining = false;
    }
    return processed;
  }

  start(intervalMs = 5000): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.drain(), intervalMs);
    // `unref` so the interval never keeps a process alive by itself; the API and
    // the worker each have their own reason to stay up.
    this.timer.unref?.();
    void this.drain();
    this.options.log?.(`[${this.label}] aktif, interval ${intervalMs} ms`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
