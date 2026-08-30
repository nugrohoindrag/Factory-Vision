import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/factory_vision';

export async function runMigrations() {
  console.log(`[DB Migrate] Connecting to PostgreSQL at ${databaseUrl.replace(/:[^:@]+@/, ':***@')}...`);
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('[DB Migrate] Connected successfully.');

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      console.log(`[DB Migrate] Executing migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      console.log(`[DB Migrate] Migration completed: ${file}`);
    }

    await grantAppRoleLogin(client);

    console.log('[DB Migrate] All migrations applied successfully!');
  } catch (err: any) {
    console.error('[DB Migrate] Migration failed:', err.message);
    // Rethrow: a swallowed failure exits 0, so a deploy script or CI job reads
    // a half-applied schema as success.
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Gives the RLS-bound application role its password.
 *
 * Migration 004 creates `factory_app` NOLOGIN and deliberately carries no
 * password: a credential in a committed .sql file is a credential in the Git
 * history forever. The password therefore arrives from the environment, and
 * the role stays unusable until it does.
 */
async function grantAppRoleLogin(client: pg.Client) {
  const role = process.env.APP_DB_USER || 'factory_app';
  const password = process.env.APP_DB_PASSWORD;

  if (!password) {
    console.warn(
      `[DB Migrate] APP_DB_PASSWORD is not set, so ${role} stays NOLOGIN. ` +
        'Set it and re-run, then point DATABASE_URL at that role: connecting as the ' +
        'bootstrap superuser bypasses row-level security and disables tenant isolation.'
    );
    return;
  }

  // The role name cannot be a bind parameter in ALTER ROLE, so it is quoted as
  // an identifier by the server rather than interpolated raw.
  const quoted = await client.query<{ ident: string }>('SELECT quote_ident($1) AS ident', [role]);
  const literal = await client.query<{ lit: string }>('SELECT quote_literal($1) AS lit', [password]);
  await client.query(`ALTER ROLE ${quoted.rows[0].ident} LOGIN PASSWORD ${literal.rows[0].lit}`);
  console.log(`[DB Migrate] ${role} can now log in (NOSUPERUSER, NOBYPASSRLS).`);
}

export async function runSeeds() {
  console.log(`[DB Seed] Connecting to PostgreSQL at ${databaseUrl.replace(/:[^:@]+@/, ':***@')}...`);
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('[DB Seed] Connected successfully.');

    const seedsDir = path.join(__dirname, 'seeds');
    const files = fs.readdirSync(seedsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      console.log(`[DB Seed] Executing seed: ${file}...`);
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf-8');
      await client.query(sql);
      console.log(`[DB Seed] Seed completed: ${file}`);
    }

    console.log('[DB Seed] All seeds executed successfully!');
  } catch (err: any) {
    console.error('[DB Seed] Seeding failed:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

const action = process.argv[2];
const run = action === 'seed' ? runSeeds : runMigrations;
run().catch(() => process.exit(1));
