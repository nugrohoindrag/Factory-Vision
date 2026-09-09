/**
 * Replay guard: every migration must survive being applied twice.
 *
 * The runner inside the API image (`apps/api/src/migrate.ts`) keeps no
 * `schema_migrations` table. A pull-based host has no checkout to record state
 * in, so it reads `db/migrations` and applies every file on every deploy. That
 * makes idempotence a property each migration must have, not one it may have.
 *
 * CI could not catch a violation before this existed: it migrates a database
 * created seconds earlier, so it only ever exercises the first application. The
 * second application happens exclusively on a real host — which is where
 * migration 022 failed, with `policy "rls_bill_of_material" ... already
 * exists`, taking every later migration down with it including the ten a
 * release needed.
 *
 * So this does what the host does: applies the whole directory twice against
 * one database, in filename order, and reports the first file that cannot
 * tolerate it.
 *
 *   DATABASE_URL=postgresql://factory:factory@host/db node db/verify-replay.mjs
 *
 * The database is created and dropped by the caller, or pass REPLAY_DATABASE
 * to have this script manage a throwaway one. Never point it at a database
 * anyone cares about: it applies DDL and data migrations directly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

// Same as `db/migrate.ts`: a developer running this locally should not have to
// restate a connection string that is already in `.env`. An exported
// DATABASE_URL still wins, which is how CI hands over its own database.
dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('Set DATABASE_URL to a superuser/owner connection before running.');
  process.exit(2);
}

/**
 * The throwaway database. Named rather than reused so a mistake cannot land on
 * the real one, and dropped at the end whatever happened.
 */
const replayDb = process.env.REPLAY_DATABASE || 'fv_replay_check';

function urlFor(database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Applies each file, then immediately applies it a second time.
 *
 * Replaying the whole directory twice is the obvious test and it is the wrong
 * one: a later migration can undo what an earlier one created, hiding the
 * defect. That is exactly what happened here — 026 drops the very policy 022
 * creates, so on a second full pass 022 found nothing in its way and
 * succeeded, while the pilot host (which had never run 026) failed.
 *
 * Applying each file back to back removes that interference. It is also the
 * stricter reading of what the image runner needs: on a re-deploy, file N is
 * applied to a database where N has already run, whatever else has or has not.
 */
async function applyEachTwice(client, files) {
  const failures = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      await client.query(sql);
    } catch (error) {
      failures.push({ file, pass: 1, message: error.message });
      console.error(`  FAIL  ${file} — first application`);
      console.error(`        ${error.message}`);
      continue; // A file that cannot apply once tells us nothing about twice.
    }
    try {
      await client.query(sql);
    } catch (error) {
      failures.push({ file, pass: 2, message: error.message });
      console.error(`  FAIL  ${file} — reapplied`);
      console.error(`        ${error.message}`);
    }
  }
  return failures;
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`\nReplay guard — ${files.length} migration file(s), applied twice\n`);

await withClient(adminUrl, async (admin) => {
  await admin.query(`DROP DATABASE IF EXISTS ${replayDb} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${replayDb}`);
});

let failures = [];
try {
  await withClient(urlFor(replayDb), async (client) => {
    failures = await applyEachTwice(client, files);
    if (failures.length === 0) {
      console.log(`  PASS  ${files.length}/${files.length} file dapat diterapkan dua kali`);
    }
  });
} finally {
  await withClient(adminUrl, (admin) => admin.query(`DROP DATABASE IF EXISTS ${replayDb} WITH (FORCE)`));
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} failure(s). A migration that cannot be applied twice will break the next ` +
      'deployment to any host, because the image runner replays the whole directory every time.\n' +
      'Guard the offending statement — DROP POLICY IF EXISTS before CREATE POLICY, IF NOT EXISTS on ' +
      'CREATE, ON CONFLICT DO NOTHING on INSERT — as the rest of db/migrations does.\n'
  );
  process.exit(1);
}

console.log('\nOK — every migration survives a replay.\n');
