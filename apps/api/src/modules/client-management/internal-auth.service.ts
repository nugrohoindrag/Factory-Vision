import { randomBytes } from 'crypto';
import type { InternalRole, InternalUser } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { isDatabaseConfigured } from '../../platform/db/pool.js';
import { hashSecret, verifySecret } from '../auth/credentials.js';
import { internalAudit, internalUsers } from './client.repository.js';

/**
 * Authentication for vendor staff.
 *
 * Deliberately a separate store and a separate session type from the customer
 * `AuthService`. A customer's administrator has full rights inside their own
 * tenant, and if the two shared a table or a token namespace, a role edit
 * there could become vendor-wide access here. They never touch.
 */

const SESSION_HOURS = 8;
const IDLE_MINUTES = 30;

export interface InternalPrincipal {
  sessionId: string;
  email: string;
  name: string;
  role: InternalRole;
  issuedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
}

interface StoredSession {
  principal: InternalPrincipal;
  token: string;
  ip?: string;
}

/** What each internal role may do. Support cannot change commercial terms. */
const ROLE_RIGHTS: Record<InternalRole, string[]> = {
  OWNER: ['client:view', 'client:manage', 'subscription:manage', 'support:grant', 'audit:view', 'staff:manage'],
  ACCOUNT_MANAGER: ['client:view', 'client:manage', 'subscription:manage', 'support:grant', 'audit:view'],
  SUPPORT: ['client:view', 'support:grant', 'audit:view'],
};

export class InternalAuthService {
  private sessions = new Map<string, StoredSession>();

  /**
   * Creates the first vendor administrator from the environment, the same way
   * the customer API bootstraps its own. No internal account ships with a
   * password.
   */
  async bootstrap(): Promise<void> {
    if (!isDatabaseConfigured()) return;

    const email = process.env.INTERNAL_ADMIN_EMAIL?.trim();
    const password = process.env.INTERNAL_ADMIN_PASSWORD;
    if (!email || !password) {
      // eslint-disable-next-line no-console
      console.warn(
        '[internal-auth] INTERNAL_ADMIN_EMAIL / INTERNAL_ADMIN_PASSWORD not set. The admin console has no way in.'
      );
      return;
    }
    if (password.length < 12) {
      // eslint-disable-next-line no-console
      console.warn(
        '[internal-auth] INTERNAL_ADMIN_PASSWORD is shorter than 12 characters. Refusing to use it.'
      );
      return;
    }

    await internalUsers.upsert({
      email,
      name: process.env.INTERNAL_ADMIN_NAME?.trim() || 'Internal Administrator',
      role: 'OWNER',
      passwordHash: hashSecret(password),
    });
    // eslint-disable-next-line no-console
    console.log(`[internal-auth] Internal administrator ready: ${email}`);
  }

  async login(
    email: string,
    password: string,
    ip?: string
  ): Promise<{ token: string; principal: InternalPrincipal }> {
    const user = await internalUsers.byEmail(email);

    // A missing account and a wrong password fail identically, so the form
    // cannot be used to discover who works for the vendor.
    if (!user || !verifySecret(password, user.passwordHash ?? undefined)) {
      await internalAudit.record({
        actorEmail: email,
        action: 'INTERNAL_LOGIN_FAILED',
        entityType: 'internal_user',
        ip,
      });
      throw ApiError.unauthenticated('Email atau kata sandi salah.');
    }
    if (user.status !== 'ACTIVE') {
      throw ApiError.forbidden('Akun internal Anda tidak aktif.');
    }

    const now = Date.now();
    const principal: InternalPrincipal = {
      sessionId: `ises-${randomBytes(9).toString('hex')}`,
      email: user.email,
      name: user.name,
      role: user.role,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_HOURS * 3_600_000).toISOString(),
      idleExpiresAt: new Date(now + IDLE_MINUTES * 60_000).toISOString(),
    };
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(principal.sessionId, { principal, token, ip });

    await internalUsers.touchLogin(user.email);
    await internalAudit.record({
      actorEmail: user.email,
      action: 'INTERNAL_LOGIN',
      entityType: 'internal_user',
      entityId: user.id,
      ip,
    });

    return { token, principal };
  }

  resolve(token: string): InternalPrincipal | undefined {
    const entry = Array.from(this.sessions.values()).find((s) => s.token === token);
    if (!entry) return undefined;

    const now = Date.now();
    if (now > Date.parse(entry.principal.expiresAt) || now > Date.parse(entry.principal.idleExpiresAt)) {
      this.sessions.delete(entry.principal.sessionId);
      return undefined;
    }
    entry.principal.idleExpiresAt = new Date(now + IDLE_MINUTES * 60_000).toISOString();
    return entry.principal;
  }

  logout(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  can(principal: InternalPrincipal, right: string): boolean {
    return ROLE_RIGHTS[principal.role].includes(right);
  }

  assert(principal: InternalPrincipal | undefined, right: string): InternalPrincipal {
    if (!principal) throw ApiError.unauthenticated();
    if (!this.can(principal, right)) {
      throw ApiError.forbidden(`Peran ${principal.role} tidak memiliki izin ${right}.`);
    }
    return principal;
  }

  async listStaff(): Promise<InternalUser[]> {
    return internalUsers.list();
  }
}
