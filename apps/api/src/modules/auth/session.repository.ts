import { createHash } from 'crypto';
import type { SessionKind, SessionPrincipal, SessionSummary } from '@factory-vision/domain-types';
import { isDatabaseConfigured, query, withTenant } from '../../platform/db/pool.js';

/**
 * `app_session`, the durable half of authentication (§6).
 *
 * A session token carries its tenant as a prefix — `<tenantId>.<secret>` — for
 * one reason: row-level security keys on `app.tenant_id`, and a lookup by
 * token has to know which tenant to declare before it can read anything. The
 * prefix is not a secret and grants nothing on its own; the row is found by
 * the SHA-256 of the whole token, so a made-up prefix finds nothing.
 *
 * Only the hash is stored. A session that a database backup could hand to
 * whoever reads the backup is not a session, it is a spare key taped to the
 * door.
 */

export interface StoredSession {
  principal: SessionPrincipal;
  lastSeenAt: string;
  ip?: string;
  userAgent?: string;
  /** When the idle window was last written back, so it can be throttled. */
  touchedAt?: string;
}

interface Row {
  id: string;
  tenant_id: string;
  kind: string;
  subject_id: string;
  principal: SessionPrincipal;
  issued_at: Date | string;
  expires_at: Date | string;
  idle_expires_at: Date | string;
  last_seen_at: Date | string;
  ip: string | null;
  user_agent: string | null;
}

const iso = (value: Date | string): string =>
  typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `<tenantId>.<secret>`; anything else is not a token this API issued. */
export function tenantOfToken(token: string): string | undefined {
  const separator = token.indexOf('.');
  if (separator <= 0) return undefined;
  return token.slice(0, separator);
}

function toStored(row: Row): StoredSession {
  return {
    // The row's own columns are the authority on lifetime: the JSON snapshot
    // was written when the session was issued and does not move.
    principal: {
      ...row.principal,
      expiresAt: iso(row.expires_at),
      idleExpiresAt: iso(row.idle_expires_at),
    },
    lastSeenAt: iso(row.last_seen_at),
    ip: row.ip ?? undefined,
    userAgent: row.user_agent ?? undefined,
  };
}

export class SessionRepository {
  get enabled(): boolean {
    return isDatabaseConfigured();
  }

  async insert(
    principal: SessionPrincipal,
    token: string,
    context: { ip?: string; userAgent?: string }
  ): Promise<void> {
    if (!this.enabled) return;
    await withTenant(principal.tenantId, (client) =>
      client.query(
        `INSERT INTO app_session
           (id, tenant_id, kind, subject_id, token_hash, principal,
            issued_at, expires_at, idle_expires_at, last_seen_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $7, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          principal.sessionId,
          principal.tenantId,
          principal.kind,
          principal.subjectId,
          hashToken(token),
          JSON.stringify(principal),
          principal.issuedAt,
          principal.expiresAt,
          principal.idleExpiresAt,
          context.ip ?? null,
          context.userAgent ?? null,
        ]
      )
    );
  }

  /** Reads a live session by token. Expired rows are treated as absent. */
  async findByToken(token: string): Promise<StoredSession | undefined> {
    if (!this.enabled) return undefined;
    const tenantId = tenantOfToken(token);
    if (!tenantId) return undefined;

    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT id, tenant_id, kind, subject_id, principal,
                issued_at, expires_at, idle_expires_at, last_seen_at, ip, user_agent
           FROM app_session
          WHERE token_hash = $1
            AND expires_at > now()
            AND idle_expires_at > now()`,
        [hashToken(token)]
      );
      return result.rows;
    });

    return rows[0] ? toStored(rows[0]) : undefined;
  }

  /** Extends the idle window. Called on a throttle, not on every request. */
  async touch(tenantId: string, sessionId: string, idleExpiresAt: string): Promise<void> {
    if (!this.enabled) return;
    await withTenant(tenantId, (client) =>
      client.query(
        `UPDATE app_session SET last_seen_at = now(), idle_expires_at = $2 WHERE id = $1`,
        [sessionId, idleExpiresAt]
      )
    );
  }

  async delete(tenantId: string, sessionId: string): Promise<void> {
    if (!this.enabled) return;
    await withTenant(tenantId, (client) =>
      client.query('DELETE FROM app_session WHERE id = $1', [sessionId])
    );
  }

  /** Revocation. Returns the sessions that were removed, for the audit trail. */
  async deleteWhere(
    tenantId: string,
    opts: { sessionId?: string; subjectId?: string }
  ): Promise<SessionSummary[]> {
    if (!this.enabled) return [];
    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `DELETE FROM app_session
          WHERE ($1::text IS NULL OR id = $1)
            AND ($2::text IS NULL OR subject_id = $2)
        RETURNING id, tenant_id, kind, subject_id, principal,
                  issued_at, expires_at, idle_expires_at, last_seen_at, ip, user_agent`,
        [opts.sessionId ?? null, opts.subjectId ?? null]
      );
      return result.rows;
    });
    return rows.map((row) => summarise(toStored(row)));
  }

  async list(tenantId: string, subjectId?: string): Promise<SessionSummary[]> {
    if (!this.enabled) return [];
    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT id, tenant_id, kind, subject_id, principal,
                issued_at, expires_at, idle_expires_at, last_seen_at, ip, user_agent
           FROM app_session
          WHERE expires_at > now()
            AND idle_expires_at > now()
            AND ($1::text IS NULL OR subject_id = $1)
          ORDER BY last_seen_at DESC`,
        [subjectId ?? null]
      );
      return result.rows;
    });
    return rows.map((row) => summarise(toStored(row)));
  }

  /**
   * Removes what has already expired.
   *
   * Expired rows are never honoured — every read filters on the timestamps —
   * so this is housekeeping rather than a control, and it runs without a
   * tenant because it deletes across all of them.
   */
  async purgeExpired(): Promise<number> {
    if (!this.enabled) return 0;
    const rows = await query<{ id: string }>(
      'DELETE FROM app_session WHERE expires_at <= now() OR idle_expires_at <= now() RETURNING id'
    );
    return rows.length;
  }
}

export function summarise(session: StoredSession): SessionSummary {
  return {
    sessionId: session.principal.sessionId,
    kind: session.principal.kind as SessionKind,
    subjectId: session.principal.subjectId,
    name: session.principal.name,
    role: session.principal.role,
    issuedAt: session.principal.issuedAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.principal.expiresAt,
    ip: session.ip,
    userAgent: session.userAgent,
  };
}
