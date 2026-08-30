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

    console.log('[DB Migrate] All migrations applied successfully!');
  } catch (err: any) {
    console.error('[DB Migrate] Migration failed:', err.message);
  } finally {
    await client.end();
  }
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
  } finally {
    await client.end();
  }
}

const action = process.argv[2];
if (action === 'seed') {
  runSeeds();
} else {
  runMigrations();
}
