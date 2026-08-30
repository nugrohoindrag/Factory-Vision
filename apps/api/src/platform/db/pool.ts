import pg from 'pg';

/**
 * The PostgreSQL connection pool.
 *
 * Client management is the first module that genuinely persists: a customer
 * record has to survive a restart, which the in-memory MES services do not.
 * The pool is created lazily so an install without `DATABASE_URL` still boots,
 * with the client-management endpoints reporting that they are unavailable
 * rather than the whole API refusing to start.
 */

let pool: pg.Pool | null = null;
let warned = false;
let rlsBypassed = false;

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(databaseUrl());
}

export function getPool(): pg.Pool {
  const url = databaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL is not set, so no database connection is available.');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: url,
      // A small pool: this API is one process serving one plant, and a large
      // pool would take connections a shared Postgres needs for other work.
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (error) => {
      // A pooled connection can die while idle; log it rather than letting an
      // unhandled 'error' event take the process down.
      // eslint-disable-next-line no-console
      console.error('[db] idle client error:', error.message);
    });
  }
  return pool;
}

/** Runs a query, returning the rows. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

/** Runs a query expecting at most one row. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/**
 * Runs several statements in one transaction.
 *
 * Creating a client touches `tenant`, `client_account` and
 * `client_subscription`; a half-created customer is worse than a failed
 * request, so those go in together or not at all.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` with the tenant declared to PostgreSQL, so the `tenant_isolation`
 * policies on every tenant-scoped table apply to its queries (§13).
 *
 * The setting has to be transaction-local, hence the wrapping transaction:
 * `SET LOCAL` outside one either errors or leaks the tenant onto the next
 * borrower of that pooled connection, which is the worst possible failure mode
 * for an isolation control. `set_config` is used rather than `SET LOCAL
 * app.tenant_id = '...'` because the tenant id can then be a bind parameter;
 * `SET` takes no parameters and would mean interpolating it into SQL.
 *
 * This is defence in depth, not a replacement for scoping queries in the
 * application: it is what stops a query that forgot its `WHERE tenant_id`
 * from returning another factory's production.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!tenantId) throw new Error('withTenant requires a tenant id.');
  return transaction(async (client) => {
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    return fn(client);
  });
}

/** Verifies the database is reachable and the client tables are present. */
export async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  if (!isDatabaseConfigured()) {
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn('[db] DATABASE_URL is not set. Client management is unavailable.');
    }
    return { ok: false, detail: 'DATABASE_URL is not set' };
  }
  try {
    const row = await queryOne<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'client_account'"
    );
    if (row?.count === '0') {
      return { ok: false, detail: 'client_account table is missing, run pnpm db:migrate' };
    }

    // Tenant isolation is only real if the connecting role is subject to the
    // policies. A superuser (or any role with BYPASSRLS) is exempt from all of
    // them, so the tables would look protected while every tenant could read
    // every other tenant's rows. Checked at startup because the failure is
    // invisible in normal operation, right up to the moment it is a breach.
    const role = await queryOne<{ superuser: boolean; bypassrls: boolean; name: string }>(
      'SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user'
    );
    if (role && (role.superuser || role.bypassrls)) {
      rlsBypassed = true;
      // eslint-disable-next-line no-console
      console.error(
        `[db] SECURITY: connected as "${role.name}", which bypasses row-level security ` +
          `(superuser=${role.superuser}, bypassrls=${role.bypassrls}). Tenant isolation policies ` +
          'do NOT apply to this connection. Run pnpm db:migrate with APP_DB_PASSWORD set and point ' +
          'DATABASE_URL at the factory_app role.'
      );
      return { ok: true, detail: `connected as ${role.name}, ROW LEVEL SECURITY BYPASSED` };
    }

    return { ok: true, detail: 'connected' };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'connection failed' };
  }
}

/** Whether the connecting role is exempt from the tenant policies. */
export function isRlsBypassed(): boolean {
  return rlsBypassed;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
