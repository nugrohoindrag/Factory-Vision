import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/factory_vision';

async function ensureMigrationTable(client: pg.Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function runMigrations() {
  console.log(`[DB Migrate] Connecting to PostgreSQL at ${databaseUrl.replace(/:[^:@]+@/, ':***@')}...`);
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('[DB Migrate] Connected successfully.');

    await ensureMigrationTable(client);

    const appliedRows = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((r) => r.version));

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[DB Migrate] Skipping already applied: ${file}`);
        continue;
      }

      console.log(`[DB Migrate] Executing migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[DB Migrate] Migration completed and recorded: ${file}`);
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        throw migrationErr;
      }
    }

    await grantAppRoleLogin(client);

    console.log('[DB Migrate] All migrations applied successfully!');
  } catch (err: any) {
    console.error('[DB Migrate] Migration failed:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

export async function runRollback() {
  console.log(`[DB Rollback] Connecting to PostgreSQL at ${databaseUrl.replace(/:[^:@]+@/, ':***@')}...`);
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('[DB Rollback] Connected successfully.');

    await ensureMigrationTable(client);

    const lastApplied = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );

    if (lastApplied.rows.length === 0) {
      console.log('[DB Rollback] No migrations to rollback.');
      return;
    }

    const version = lastApplied.rows[0].version;
    const rollbackFile = path.join(__dirname, 'rollbacks', version);

    if (!fs.existsSync(rollbackFile)) {
      console.warn(`[DB Rollback] No rollback file found at ${rollbackFile}. Removing version record.`);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      return;
    }

    console.log(`[DB Rollback] Executing rollback for: ${version}...`);
    const sql = fs.readFileSync(rollbackFile, 'utf-8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      await client.query('COMMIT');
      console.log(`[DB Rollback] Rollback completed for: ${version}`);
    } catch (rbErr) {
      await client.query('ROLLBACK');
      throw rbErr;
    }
  } catch (err: any) {
    console.error('[DB Rollback] Rollback failed:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

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
let runner = runMigrations;
if (action === 'seed') runner = runSeeds;
if (action === 'rollback') runner = runRollback;

runner().catch(() => process.exit(1));
