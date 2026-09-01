import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { JobRunner } from '@factory-vision/job-queue';
import { createPlanningJobHandlers, getJobQueue } from '@factory-vision/api/jobs';

// The worker's own .env first, then the repository root — the file the
// workspace scripts actually share. Neither overrides a variable the process
// already has, so docker compose stays authoritative.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(here, '../../../.env') });

/**
 * The background worker process.
 *
 * This is where the planning queue runs. Forecast aggregation and capacity
 * recalculation are `planning_job` rows (`db/migrations/016_mes_v1_planning_jobs.sql`);
 * the API enqueues one and answers 202, and this process claims and executes
 * it. `FOR UPDATE SKIP LOCKED` is what allows that split — a claim takes a row
 * no other transaction holds, so the API's optional in-process runner and any
 * number of these containers share the queue rather than doing the same job
 * twice.
 *
 * The queue contract and its runner live in `@factory-vision/job-queue`, below
 * both apps, so the two cannot disagree about what a job is. The handlers are
 * the API's — they run the planning application services — and are reached
 * through the `./jobs` entry point the API package declares, not by reaching
 * into its `dist` directory.
 *
 * The outbox relay deliberately does **not** run here: its only subscriber is
 * the realtime gateway, which exists in the API process alone. See
 * `platform/outbox/outbox.relay.ts`.
 */

const INTERVAL_MS = Number(process.env.PLANNING_JOB_INTERVAL_MS ?? 5000);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // Without a database there is no queue to poll. Exiting non-zero is the
    // honest signal: a worker that idles silently looks healthy while every
    // enqueued forecast waits for ever.
    // eslint-disable-next-line no-console
    console.error('[worker] DATABASE_URL belum diset. Worker tidak dapat memproses job queue.');
    process.exit(1);
  }

  const runner = new JobRunner({
    queue: getJobQueue(),
    handlers: await createPlanningJobHandlers(),
    label: 'worker',
    // eslint-disable-next-line no-console
    log: (message) => console.log(message),
    // eslint-disable-next-line no-console
    logError: (message) => console.error(message),
  });

  runner.start(INTERVAL_MS);

  // The runner's interval is `unref`'d so it never holds a process open by
  // itself; this is what keeps the container alive, and what a signal clears.
  const keepAlive = setInterval(() => undefined, 1 << 30);

  function shutdown(signal: string): void {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${signal} diterima, menghentikan runner.`);
    runner.stop();
    clearInterval(keepAlive);
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[worker] gagal start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
