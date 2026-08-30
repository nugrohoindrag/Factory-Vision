import { randomBytes } from 'crypto';
import { UserRole } from '@factory-vision/domain-types';
import type {
  AppUser,
  LoginResponse,
  Operator,
  SessionKind,
  SessionPrincipal,
  SessionSummary,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { AuditService } from '../audit/audit.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { hashSecret, verifySecret } from './credentials.js';

/**
 * Session lifetimes (, US-002).
 *
 * An operator terminal is shared hardware on a noisy shop floor, so its session
 * is short-lived in absolute terms and drops quickly on inactivity. A console
 * session belongs to one named person at a desk and can afford a longer idle
 * window.
 */
const LIFETIMES: Record<SessionKind, { absoluteSeconds: number; idleSeconds: number }> = {
  APPLICATION: { absoluteSeconds: 12 * 60 * 60, idleSeconds: 60 * 60 },
  OPERATOR: { absoluteSeconds: 8 * 60 * 60, idleSeconds: 15 * 60 },
};

interface StoredSession {
  principal: SessionPrincipal;
  token: string;
  lastSeenAt: string;
  ip?: string;
  userAgent?: string;
}

interface AuthContext {
  ip?: string;
  userAgent?: string;
}

const PILOT_TENANT = 'tenant-pilot-factory-01';

/**
 * Authentication for both front doors (US-001, US-002) and the session store
 * behind them.
 *
 * Credentials live beside the account rather than on it: `AppUser` and
 * `Operator` are domain records that travel to the console, and a password
 * hash has no business being part of that payload.
 */
export class AuthService {
  private readonly userSecrets = new Map<string, string>();
  private readonly operatorSecrets = new Map<string, string>();
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private masterData: MasterDataService,
    private rbac: RbacService,
    private audit: AuditService
  ) {}

  /**
   * Establishes the single bootstrap administrator from the environment.
   *
   * No account ships with a password. A deployment that reaches the public
   * internet with a known built-in credential is compromised the moment
   * anyone recognises the product, so the only way in is a password the
   * operator of the install chose themselves:
   *
   * BOOTSTRAP_ADMIN_EMAIL=admin@pabrik.co.id
   * BOOTSTRAP_ADMIN_PASSWORD=<chosen by the installer>
   *
   * With those unset nobody can sign in at all, deliberately. That is a
   * visible, fixable failure; a default password is an invisible one. Every
   * other account gets its password from an administrator afterwards
   * (`POST /api/v1/users/:id/password`), and operators get their PIN the same
   * way (`POST /api/v1/operators/:id/pin`).
   */
  async bootstrapAdminCredential(): Promise<void> {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!email || !password) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth] No BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD set, no account can sign in. ' +
          'Set both and restart to create the first administrator.'
      );
      return;
    }

    if (password.length < 12) {
      // eslint-disable-next-line no-console
      console.warn('[auth] BOOTSTRAP_ADMIN_PASSWORD is shorter than 12 characters. Refusing to use it.');
      return;
    }

    let user = this.masterData
      .getUsers(PILOT_TENANT)
      .find((u) => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
      user = await this.masterData.createUser(PILOT_TENANT, {
        email,
        name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator',
        role: UserRole.ADMIN,
        accountType: 'APPLICATION_USER',
        scopeLevel: 'TENANT',
        status: 'ACTIVE',
      });
    }

    const passwordHash = hashSecret(password);
    this.userSecrets.set(user.id, passwordHash);
    await this.masterData.saveUserPassword(PILOT_TENANT, user.id, passwordHash);

    // eslint-disable-next-line no-console
    console.log(`[auth] Bootstrap administrator ready: ${user.email}`);

    // A shared starting PIN for the shop-floor terminals is offered only when
    // the installer asks for one; otherwise operators cannot sign in until an
    // administrator issues each of them a PIN.
    const operatorPin = process.env.BOOTSTRAP_OPERATOR_PIN;
    if (operatorPin && /^\d{4,8}$/.test(operatorPin)) {
      // A *starting* PIN, which is only a starting point. Applying it to every
      // operator on every boot would silently reset a PIN an administrator had
      // issued, so an operator whose credential was rotated last week would be
      // back on the shared one after the next deployment.
      let seeded = 0;
      for (const operator of this.masterData.getOperators(PILOT_TENANT)) {
        if (operator.pinHash) continue;
        const pinHash = hashSecret(operatorPin);
        this.operatorSecrets.set(operator.id, pinHash);
        await this.masterData.saveOperatorPin(PILOT_TENANT, operator.id, pinHash, 'bootstrap');
        seeded += 1;
      }
      if (seeded > 0) {
        // eslint-disable-next-line no-console
        console.log(`[auth] ${seeded} shop-floor terminal(s) seeded with the configured starting PIN.`);
      }
    }
  }

  /**
   * Loads stored credentials into the in-process maps.
   *
   * Password and PIN hashes used to exist only here, so every restart left
   * every account created through Settings unable to sign in. They now live in
   * `app_user.password_hash` and `operator.pin_hash`; this reads them back.
   */
  hydrateCredentials(tenantId: string): { users: number; operators: number } {
    let users = 0;
    for (const user of this.masterData.getUsers(tenantId)) {
      const hash = this.masterData.getUserPasswordHash(user.id);
      if (hash) {
        this.userSecrets.set(user.id, hash);
        users += 1;
      }
    }
    let operators = 0;
    for (const operator of this.masterData.getOperators(tenantId)) {
      if (operator.pinHash) {
        this.operatorSecrets.set(operator.id, operator.pinHash);
        operators += 1;
      }
    }
    return { users, operators };
  }

  // ---------------------------------------------------------
  // US-001, Application login
  // ---------------------------------------------------------

  async login(tenantId: string, email: string, password: string, ctx: AuthContext = {}): Promise<LoginResponse> {
    const user = this.masterData
      .getUsers(tenantId)
      .find((u) => u.email.toLowerCase() === email.toLowerCase() && u.accountType === 'APPLICATION_USER');

    // A missing account and a wrong password are reported identically so the
    // login form cannot be used to enumerate who works here.
    if (!user || !verifySecret(password, this.userSecrets.get(user.id))) {
      await this.audit.record({
        tenantId,
        actorType: 'SYSTEM',
        actorId: email,
        entityType: 'auth',
        entityId: email,
        action: 'LOGIN_FAILED',
        newValue: { reason: 'INVALID_CREDENTIALS' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw ApiError.unauthenticated('Email atau kata sandi salah.');
    }

    if (user.status !== 'ACTIVE') {
      await this.audit.record({
        tenantId,
        actorType: 'SYSTEM',
        actorId: user.id,
        entityType: 'auth',
        entityId: user.id,
        action: 'LOGIN_BLOCKED',
        newValue: { status: user.status },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw ApiError.forbidden(
        user.status === 'SUSPENDED'
          ? 'Akun Anda ditangguhkan. Hubungi administrator.'
          : 'Akun Anda tidak aktif. Hubungi administrator.'
      );
    }

    const principal = this.issue('APPLICATION', {
      tenantId,
      subjectId: user.id,
      name: user.name,
      role: user.role,
      scopeLevel: user.scopeLevel,
      scopeId: user.scopeId,
    });

    const stored = this.sessions.get(principal.sessionId)!;
    stored.ip = ctx.ip;
    stored.userAgent = ctx.userAgent;

    user.lastLoginAt = new Date().toISOString();

    await this.audit.record({
      tenantId,
      actorType: 'USER',
      actorId: user.id,
      entityType: 'auth',
      entityId: user.id,
      action: 'LOGIN',
      newValue: { role: user.role, sessionId: principal.sessionId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      token: stored.token,
      principal,
      user,
      idleTimeoutSeconds: LIFETIMES.APPLICATION.idleSeconds,
    };
  }

  // ---------------------------------------------------------
  // US-002, Operator login
  // ---------------------------------------------------------

  async operatorLogin(tenantId: string, employeeNumber: string, pin: string, ctx: AuthContext = {}): Promise<LoginResponse> {
    const operator = this.masterData
      .getOperators(tenantId)
      .find((o) => o.employeeNumber.toLowerCase() === employeeNumber.toLowerCase());

    if (!operator || !verifySecret(pin, this.operatorSecrets.get(operator.id))) {
      await this.audit.record({
        tenantId,
        actorType: 'SYSTEM',
        actorId: employeeNumber,
        entityType: 'auth',
        entityId: employeeNumber,
        action: 'OPERATOR_LOGIN_FAILED',
        newValue: { reason: 'INVALID_CREDENTIALS' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw ApiError.unauthenticated('Nomor karyawan atau PIN salah.');
    }

    if (operator.status !== 'ACTIVE') {
      throw ApiError.forbidden('Operator tidak aktif. Hubungi supervisor.');
    }

    // An operator is scoped to the line they are rostered on, which is what
    // makes "hanya melihat assigned shop-floor context" true at the API level
    // rather than only in the terminal UI.
    const principal = this.issue('OPERATOR', {
      tenantId,
      subjectId: operator.id,
      name: operator.name,
      role: UserRole.OPERATOR,
      scopeLevel: operator.defaultLineId ? 'LINE' : 'TENANT',
      scopeId: operator.defaultLineId,
    });

    const stored = this.sessions.get(principal.sessionId)!;
    stored.ip = ctx.ip;
    stored.userAgent = ctx.userAgent;

    await this.audit.record({
      tenantId,
      actorType: 'OPERATOR',
      actorId: operator.id,
      entityType: 'auth',
      entityId: operator.id,
      action: 'OPERATOR_LOGIN',
      newValue: { employeeNumber: operator.employeeNumber, sessionId: principal.sessionId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      token: stored.token,
      principal,
      operator,
      idleTimeoutSeconds: LIFETIMES.OPERATOR.idleSeconds,
    };
  }

  // ---------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------

  private issue(
    kind: SessionKind,
    subject: {
      tenantId: string;
      subjectId: string;
      name: string;
      role: UserRole;
      scopeLevel: AppUser['scopeLevel'];
      scopeId?: string;
    }
  ): SessionPrincipal {
    const now = Date.now();
    const lifetime = LIFETIMES[kind];
    const sessionId = `ses-${randomBytes(9).toString('hex')}`;
    const token = randomBytes(32).toString('base64url');

    const principal: SessionPrincipal = {
      sessionId,
      kind,
      tenantId: subject.tenantId,
      subjectId: subject.subjectId,
      name: subject.name,
      role: subject.role,
      permissions: this.rbac.permissionsFor(subject.tenantId, subject.role),
      scope: this.rbac.resolveScope({
        tenantId: subject.tenantId,
        scopeLevel: subject.scopeLevel,
        scopeId: subject.scopeId,
      }),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + lifetime.absoluteSeconds * 1000).toISOString(),
      idleExpiresAt: new Date(now + lifetime.idleSeconds * 1000).toISOString(),
      landingPath: kind === 'OPERATOR' ? '/terminal' : this.rbac.landingPathFor(subject.tenantId, subject.role),
    };

    this.sessions.set(sessionId, {
      principal,
      token,
      lastSeenAt: principal.issuedAt,
    });

    return principal;
  }

  /**
   * Resolves a bearer token, sliding the idle window forward.
   *
   * Returns `undefined` for anything expired, revoked or unknown; the caller
   * decides whether that is a 401 or an anonymous request.
   */
  resolve(token: string): SessionPrincipal | undefined {
    const entry = Array.from(this.sessions.values()).find((s) => s.token === token);
    if (!entry) return undefined;

    const now = Date.now();
    if (now > Date.parse(entry.principal.expiresAt) || now > Date.parse(entry.principal.idleExpiresAt)) {
      this.sessions.delete(entry.principal.sessionId);
      return undefined;
    }

    const lifetime = LIFETIMES[entry.principal.kind];
    entry.lastSeenAt = new Date(now).toISOString();
    entry.principal.idleExpiresAt = new Date(now + lifetime.idleSeconds * 1000).toISOString();

    // Role, permission or scope changes take effect on the next request rather
    // than at the next login, US-005 requires access to remain controlled.
    const subject = this.masterData.getUserById(entry.principal.tenantId, entry.principal.subjectId);
    if (entry.principal.kind === 'APPLICATION') {
      if (!subject || subject.status !== 'ACTIVE') {
        this.sessions.delete(entry.principal.sessionId);
        return undefined;
      }
      entry.principal.role = subject.role;
      entry.principal.permissions = this.rbac.permissionsFor(entry.principal.tenantId, subject.role);
      entry.principal.scope = this.rbac.resolveScope(subject);
    } else {
      const operator = this.masterData
        .getOperators(entry.principal.tenantId)
        .find((o) => o.id === entry.principal.subjectId);
      if (!operator || operator.status !== 'ACTIVE') {
        this.sessions.delete(entry.principal.sessionId);
        return undefined;
      }
    }

    return entry.principal;
  }

  async logout(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    await this.audit.record({
      tenantId: entry.principal.tenantId,
      actorType: entry.principal.kind === 'OPERATOR' ? 'OPERATOR' : 'USER',
      actorId: entry.principal.subjectId,
      entityType: 'auth',
      entityId: entry.principal.subjectId,
      action: 'LOGOUT',
      previousValue: { sessionId },
      ip: entry.ip,
      userAgent: entry.userAgent,
    });
  }

  listSessions(tenantId: string, subjectId?: string): SessionSummary[] {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .filter((s) => s.principal.tenantId === tenantId)
      .filter((s) => !subjectId || s.principal.subjectId === subjectId)
      .filter((s) => now <= Date.parse(s.principal.expiresAt) && now <= Date.parse(s.principal.idleExpiresAt))
      .map((s) => ({
        sessionId: s.principal.sessionId,
        kind: s.principal.kind,
        subjectId: s.principal.subjectId,
        name: s.principal.name,
        role: s.principal.role,
        issuedAt: s.principal.issuedAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.principal.expiresAt,
        ip: s.ip,
        userAgent: s.userAgent,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  /** US-005, revoke one session, or every session belonging to one account. */
  async revokeSessions(tenantId: string, opts: { sessionId?: string; subjectId?: string }, actorId: string): Promise<number> {
    const victims = Array.from(this.sessions.values()).filter(
      (s) =>
        s.principal.tenantId === tenantId &&
        (opts.sessionId ? s.principal.sessionId === opts.sessionId : true) &&
        (opts.subjectId ? s.principal.subjectId === opts.subjectId : true)
    );

    for (const victim of victims) {
      this.sessions.delete(victim.principal.sessionId);
      await this.audit.record({
        tenantId,
        actorType: 'USER',
        actorId,
        entityType: 'session',
        entityId: victim.principal.sessionId,
        action: 'SESSION_REVOKED',
        previousValue: { subjectId: victim.principal.subjectId, issuedAt: victim.principal.issuedAt },
      });
    }

    return victims.length;
  }

  // ---------------------------------------------------------
  // Credential administration
  // ---------------------------------------------------------

  async setUserPassword(tenantId: string, userId: string, password: string, actorId: string): Promise<void> {
    const user = this.masterData.getUserById(tenantId, userId);
    if (!user) throw ApiError.notFound('Pengguna tidak ditemukan.');
    if (password.length < 8) {
      throw ApiError.validation('Kata sandi minimal 8 karakter.', [
        { field: 'password', code: 'TOO_SHORT', message: 'Kata sandi minimal 8 karakter.' },
      ]);
    }
    const hash = hashSecret(password);
    this.userSecrets.set(userId, hash);
    await this.masterData.saveUserPassword(tenantId, userId, hash);
    await this.revokeSessions(tenantId, { subjectId: userId }, actorId);
    await this.audit.record({
      tenantId,
      actorType: 'USER',
      actorId,
      entityType: 'app_user',
      entityId: userId,
      action: 'PASSWORD_RESET',
      newValue: { by: actorId },
    });
  }

  async setOperatorPin(tenantId: string, operatorId: string, pin: string, actorId: string): Promise<void> {
    const operator = this.masterData.getOperators(tenantId).find((o) => o.id === operatorId);
    if (!operator) throw ApiError.notFound('Operator tidak ditemukan.');
    if (!/^\d{4,8}$/.test(pin)) {
      throw ApiError.validation('PIN harus 4-8 digit angka.', [
        { field: 'pin', code: 'INVALID_FORMAT', message: 'PIN harus 4-8 digit angka.' },
      ]);
    }
    const hash = hashSecret(pin);
    this.operatorSecrets.set(operatorId, hash);
    await this.masterData.saveOperatorPin(tenantId, operatorId, hash, actorId);
    await this.revokeSessions(tenantId, { subjectId: operatorId }, actorId);
    await this.audit.record({
      tenantId,
      actorType: 'USER',
      actorId,
      entityType: 'operator',
      entityId: operatorId,
      action: 'PIN_RESET',
      newValue: { by: actorId },
    });
  }

  /** Called when an account is created so it can log in straight away. */
  /** For a user created through Settings; the hash is written down as well. */
  async registerUserPassword(tenantId: string, userId: string, password: string): Promise<void> {
    const hash = hashSecret(password);
    this.userSecrets.set(userId, hash);
    await this.masterData.saveUserPassword(tenantId, userId, hash);
  }

  registerUserPasswordInMemory(userId: string, password: string): void {
    this.userSecrets.set(userId, hashSecret(password));
  }

  registerOperatorPin(operatorId: string, pin: string): void {
    this.operatorSecrets.set(operatorId, hashSecret(pin));
  }

  /** True when the account has a usable credential, surfaced in the admin UI. */
  hasCredential(kind: SessionKind, subjectId: string): boolean {
    return kind === 'OPERATOR' ? this.operatorSecrets.has(subjectId) : this.userSecrets.has(subjectId);
  }

  operatorFor(tenantId: string, operatorId: string): Operator | undefined {
    return this.masterData.getOperators(tenantId).find((o) => o.id === operatorId);
  }
}
