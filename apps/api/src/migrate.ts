import fs from 'fs';
import path from 'path';
import pg from 'pg';

/**
 * The migration runner that ships inside the API image.
 *
 * `pnpm db:migrate` needs a source checkout, which a pull-based deployment
 * does not have: the VPS pulls images and never clones the repository. The
 * schema still has to be applied before the API will start, so the SQL travels
 * with the image and this entry point applies it:
 *
 *   docker compose -f deploy/docker-compose.yml run --rm migrate
 *
 * It stays a deliberate, separate step rather than something the API does on
 * boot. Migrations are the one part of a deployment that can destroy data, and
 * §18 of the deployment doc is explicit that they run under supervision, not
 * as a side effect of a container restarting.
 */
const databaseUrl = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
const sqlRoot = process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), 'db');

async function applyDirectory(client: pg.Client, dir: string, label: string): Promise<number> {
  if (!fs.existsSync(dir)) {
    console.warn(`[migrate] ${label} directory not found at ${dir}, skipping.`);
    return 0;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    console.log(`[migrate] ${label}: ${file}`);
    await client.query(fs.readFileSync(path.join(dir, file), 'utf-8'));
  }
  return files.length;
}

/**
 * Gives the RLS-bound application role its password, mirroring db/migrate.ts.
 * Migration 004 creates it NOLOGIN precisely so no credential lives in a
 * committed .sql file.
 */
async function grantAppRoleLogin(client: pg.Client): Promise<void> {
  const role = process.env.APP_DB_USER || 'factory_app';
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    console.warn(
      `[migrate] APP_DB_PASSWORD is not set, so ${role} stays NOLOGIN. The API connects as that role; ` +
        'connecting as the bootstrap superuser instead would bypass row-level security.'
    );
    return;
  }
  const quoted = await client.query<{ ident: string }>('SELECT quote_ident($1) AS ident', [role]);
  const literal = await client.query<{ lit: string }>('SELECT quote_literal($1) AS lit', [password]);
  await client.query(`ALTER ROLE ${quoted.rows[0].ident} LOGIN PASSWORD ${literal.rows[0].lit}`);
  console.log(`[migrate] ${role} can now log in (NOSUPERUSER, NOBYPASSRLS).`);
}

async function main(): Promise<void> {
  if (!databaseUrl) {
    throw new Error('Set MIGRATE_DATABASE_URL (or DATABASE_URL) to the schema owner connection.');
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const migrations = await applyDirectory(client, path.join(sqlRoot, 'migrations'), 'migration');
    await grantAppRoleLogin(client);

    if (/^(1|true|yes)$/i.test(process.env.SEED_DEMO_DATA ?? '')) {
      await applyDirectory(client, path.join(sqlRoot, 'seeds'), 'seed');
    }

    console.log(`[migrate] ${migrations} migration file(s) applied.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error);
  // A swallowed failure would let the API start against a half-applied schema.
  process.exit(1);
});
