import { randomBytes } from 'crypto';
import { UserRole } from '@factory-vision/domain-types';
import type {
  AppUser,
  LoginOutcome,
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
import { assertPasswordPolicy, assertPinPolicy, describeCredentialProblem } from '../../platform/security/credential-policy.js';
import { loginGuard, pinGuard } from '../../platform/security/rate-limit.js';
import { recordSecurityEvent } from '../../platform/security/security-events.js';
import { MfaService } from './mfa.service.js';
import {
  SessionRepository,
  hashToken,
  summarise,
  type StoredSession,
} from './session.repository.js';

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

interface AuthContext {
  ip?: string;
  userAgent?: string;
}

const PILOT_TENANT = 'tenant-pilot-factory-01';

/**
 * How long a resolved session may be answered from memory before the store is
 * consulted again, and how often the idle window is written back.
 *
 * Ten seconds is the window in which a revocation made elsewhere is still
 * honoured here. Sixty seconds of write throttling keeps the shop floor's
 * capture path free of a database write per request.
 */
const CACHE_MS = 10_000;
const TOUCH_MS = 60_000;

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

  /**
   * Sessions live in `app_session` (§6). This map is only a read-through
   * cache in front of it, held for `CACHE_MS` so that a burst of shop-floor
   * requests does not become a burst of queries.
   *
   * The consequence worth stating: a revocation made on another replica takes
   * effect here within `CACHE_MS`, not instantly. That is a deliberate trade,
   * and it is the difference between "seconds" and the previous behaviour,
   * which was "never, because the other replica had its own sessions".
   */
  private readonly cache = new Map<string, { session: StoredSession; readAt: number }>();
  private readonly sessions = new SessionRepository();

  constructor(
    private masterData: MasterDataService,
    private rbac: RbacService,
    private audit: AuditService,
    readonly mfa: MfaService = new MfaService()
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

    const problem = describeCredentialProblem(password, 'password');
    if (problem) {
      // eslint-disable-next-line no-console
      console.warn(`[auth] BOOTSTRAP_ADMIN_PASSWORD rejected: ${problem} No account can sign in until it is fixed.`);
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
    const pinProblem = operatorPin ? describeCredentialProblem(operatorPin, 'pin') : undefined;
    if (operatorPin && pinProblem) {
      // eslint-disable-next-line no-console
      console.warn(`[auth] BOOTSTRAP_OPERATOR_PIN rejected: ${pinProblem} No starting PIN was applied.`);
    }
    if (operatorPin && !pinProblem) {
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

  /**
   * The tenants an application user with this email belongs to.
   *
   * The console does not know its tenant before login — a trial admin signs
   * in at the same address as everyone else — so the login route resolves
   * it from the email across the tenants loaded in memory. An email is
   * usually in one tenant; if it is in several, the caller tries each.
   */
  tenantsForEmail(email: string): string[] {
    const wanted = email.trim().toLowerCase();
    const seen = new Set<string>();
    for (const user of this.masterData.getAllUsers()) {
      if (user.accountType === 'APPLICATION_USER' && user.email.toLowerCase() === wanted) seen.add(user.tenantId);
    }
    return [...seen];
  }

  async login(tenantId: string, email: string, password: string, ctx: AuthContext = {}): Promise<LoginOutcome> {
    // Brute-force protection is keyed on the account being attacked, and the
    // lock is temporary: a permanent one keyed on something the attacker
    // supplies is a way to keep a supervisor out of their own shift (§7).
    const guardKey = `${tenantId}:${email.trim().toLowerCase()}`;
    loginGuard.assertAvailable(
      guardKey,
      'Terlalu banyak percobaan login yang gagal. Coba lagi dalam beberapa menit.'
    );

    const user = this.masterData
      .getUsers(tenantId)
      .find((u) => u.email.toLowerCase() === email.toLowerCase() && u.accountType === 'APPLICATION_USER');

    // A missing account and a wrong password are reported identically so the
    // login form cannot be used to enumerate who works here.
    if (!user || !verifySecret(password, this.userSecrets.get(user.id))) {
      const locked = loginGuard.recordFailure(guardKey);
      await this.audit.record({
        tenantId,
        actorType: 'SYSTEM',
        actorId: email,
        entityType: 'auth',
        entityId: email,
        action: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        newValue: { reason: 'INVALID_CREDENTIALS', locked },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (locked) {
        recordSecurityEvent({
          type: 'LOGIN_LOCKED',
          severity: 'WARNING',
          message: `Akun ${email} dikunci sementara setelah percobaan login berulang.`,
          tenantId,
          actor: email,
          ip: ctx.ip,
        });
        throw ApiError.rateLimited(
          'Terlalu banyak percobaan login yang gagal. Coba lagi dalam beberapa menit.'
        );
      }
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

    loginGuard.recordSuccess(guardKey);

    // Second factor (§5). The password alone gets a challenge, never a
    // session: what comes back carries no permissions and expires in minutes.
    if (await this.mfa.isActiveFor(tenantId, user.id)) {
      const challenge = this.mfa.issueChallenge(tenantId, user.id);
      await this.audit.record({
        tenantId,
        actorType: 'USER',
        actorId: user.id,
        entityType: 'auth',
        entityId: user.id,
        action: 'MFA_CHALLENGED',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { mfaRequired: true, ...challenge };
    }

    return this.completeLogin(tenantId, user, ctx, { usedRecoveryCode: false });
  }

  /**
   * Issues the session once every factor has been satisfied.
   *
   * Shared by the single-factor path and by MFA verification so there is only
   * one place where a session comes into existence.
   */
  private async completeLogin(
    tenantId: string,
    user: AppUser,
    ctx: AuthContext,
    options: { usedRecoveryCode: boolean; viaMfa?: boolean }
  ): Promise<LoginResponse> {
    const { principal, token } = this.issue('APPLICATION', {
      tenantId,
      subjectId: user.id,
      name: user.name,
      role: user.role as UserRole,
      scopeLevel: user.scopeLevel,
      scopeId: user.scopeId,
    });
    await this.persist(principal, token, ctx);

    user.lastLoginAt = new Date().toISOString();

    await this.audit.record({
      tenantId,
      actorType: 'USER',
      actorId: user.id,
      entityType: 'auth',
      entityId: user.id,
      action: 'LOGIN',
      newValue: {
        role: user.role,
        sessionId: principal.sessionId,
        mfa: options.viaMfa ? (options.usedRecoveryCode ? 'RECOVERY_CODE' : 'TOTP') : 'NONE',
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // A role that must carry a second factor, on an account that has not
    // enrolled one, is not refused at the door — that would leave the account
    // no way to fix it. It is flagged, and the console sends them to enrol.
    const mfaEnrollmentRequired =
      !options.viaMfa && this.mfa.available && this.mfa.isRequiredFor(user.role);

    return {
      token,
      principal,
      user,
      idleTimeoutSeconds: LIFETIMES.APPLICATION.idleSeconds,
      ...(mfaEnrollmentRequired ? { mfaEnrollmentRequired } : {}),
    };
  }

  /** Answers a login challenge and issues the session (§5). */
  async verifyMfaLogin(challengeToken: string, code: string, ctx: AuthContext = {}): Promise<LoginResponse> {
    const { tenantId, userId, usedRecoveryCode } = await this.mfa.verifyChallenge(challengeToken, code);
    const user = this.masterData.getUserById(tenantId, userId);
    if (!user || user.status !== 'ACTIVE') {
      throw ApiError.forbidden('Akun Anda tidak aktif. Hubungi administrator.');
    }

    if (usedRecoveryCode) {
      await this.audit.record({
        tenantId,
        actorType: 'USER',
        actorId: user.id,
        entityType: 'auth',
        entityId: user.id,
        action: 'MFA_RECOVERY_CODE_USED',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      recordSecurityEvent({
        type: 'MFA_RECOVERY_CODE_USED',
        severity: 'WARNING',
        message: `${user.email} masuk memakai recovery code, bukan aplikasi authenticator.`,
        tenantId,
        actor: user.id,
        ip: ctx.ip,
      });
    }

    return this.completeLogin(tenantId, user, ctx, { usedRecoveryCode, viaMfa: true });
  }

  // ---------------------------------------------------------
  // US-002, Operator login
  // ---------------------------------------------------------

  async operatorLogin(tenantId: string, employeeNumber: string, pin: string, ctx: AuthContext = {}): Promise<LoginResponse> {
    // A PIN pad has ten keys, so this is the smallest keyspace in the product
    // and the one that most needs a lock (§8). Keyed per employee number, not
    // per address: the whole plant shares one.
    const guardKey = `${tenantId}:${employeeNumber.trim().toLowerCase()}`;
    pinGuard.assertAvailable(
      guardKey,
      'PIN terkunci sementara karena terlalu banyak percobaan. Hubungi supervisor.'
    );

    const operator = this.masterData
      .getOperators(tenantId)
      .find((o) => o.employeeNumber.toLowerCase() === employeeNumber.toLowerCase());

    if (!operator || !verifySecret(pin, this.operatorSecrets.get(operator.id))) {
      const locked = pinGuard.recordFailure(guardKey);
      await this.audit.record({
        tenantId,
        actorType: 'SYSTEM',
        actorId: employeeNumber,
        entityType: 'auth',
        entityId: employeeNumber,
        action: locked ? 'OPERATOR_LOGIN_LOCKED' : 'OPERATOR_LOGIN_FAILED',
        newValue: { reason: 'INVALID_CREDENTIALS', locked },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (locked) {
        recordSecurityEvent({
          type: 'OPERATOR_LOGIN_LOCKED',
          severity: 'WARNING',
          message: `PIN operator ${employeeNumber} dikunci sementara setelah percobaan berulang.`,
          tenantId,
          actor: employeeNumber,
          ip: ctx.ip,
        });
        throw ApiError.rateLimited(
          'PIN terkunci sementara karena terlalu banyak percobaan. Hubungi supervisor.'
        );
      }
      throw ApiError.unauthenticated('Nomor karyawan atau PIN salah.');
    }

    pinGuard.recordSuccess(guardKey);

    if (operator.status !== 'ACTIVE') {
      throw ApiError.forbidden('Operator tidak aktif. Hubungi supervisor.');
    }

    // An operator is scoped to the line they are rostered on, which is what
    // makes "hanya melihat assigned shop-floor context" true at the API level
    // rather than only in the terminal UI.
    const { principal, token } = this.issue('OPERATOR', {
      tenantId,
      subjectId: operator.id,
      name: operator.name,
      role: UserRole.OPERATOR,
      scopeLevel: operator.defaultLineId ? 'LINE' : 'TENANT',
      scopeId: operator.defaultLineId,
    });
    await this.persist(principal, token, ctx);

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
      token,
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
  ): { principal: SessionPrincipal; token: string } {
    const now = Date.now();
    const lifetime = LIFETIMES[kind];
    const sessionId = `ses-${randomBytes(9).toString('hex')}`;
    // The tenant prefix is what lets a lookup by token declare a tenant before
    // row-level security will show it anything. See SessionRepository.
    const token = `${subject.tenantId}.${randomBytes(32).toString('base64url')}`;

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

    return { principal, token };
  }

  /**
   * Writes the session to the store and primes the cache.
   *
   * Separate from `issue` so the login paths can attach the IP and user agent
   * they know about before anything is persisted: a session row without them
   * is a session an administrator cannot recognise when deciding whether to
   * revoke it.
   */
  private async persist(
    principal: SessionPrincipal,
    token: string,
    ctx: AuthContext
  ): Promise<StoredSession> {
    const stored: StoredSession = {
      principal,
      lastSeenAt: principal.issuedAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };
    await this.sessions.insert(principal, token, ctx);
    this.cache.set(hashToken(token), { session: stored, readAt: Date.now() });
    return stored;
  }

  /**
   * Resolves a bearer token, sliding the idle window forward.
   *
   * Returns `undefined` for anything expired, revoked or unknown; the caller
   * decides whether that is a 401 or an anonymous request.
   */
  /**
   * Resolves a bearer token into a live principal (US-001, US-002, §6).
   *
   * The store is the authority; the cache in front of it holds a session for
   * CACHE_MS so a shift's worth of shop-floor traffic does not become a query
   * per request. Role, permission and scope are re-derived on every resolve,
   * so a role change or a suspension takes effect on the next request rather
   * than at the next login.
   */
  async resolve(token: string): Promise<SessionPrincipal | undefined> {
    const key = hashToken(token);
    const now = Date.now();

    const cached = this.cache.get(key);
    let session = cached && now - cached.readAt < CACHE_MS ? cached.session : undefined;

    if (!session) {
      session = await this.sessions.findByToken(token);
      if (!session) {
        this.cache.delete(key);
        return undefined;
      }
      this.cache.set(key, { session, readAt: now });
    }

    const principal = session.principal;
    if (now > Date.parse(principal.expiresAt) || now > Date.parse(principal.idleExpiresAt)) {
      await this.forget(principal.tenantId, principal.sessionId, key);
      return undefined;
    }

    // Role, permission or scope changes take effect on the next request rather
    // than at the next login, US-005 requires access to remain controlled.
    if (principal.kind === 'APPLICATION') {
      const subject = this.masterData.getUserById(principal.tenantId, principal.subjectId);
      if (!subject || subject.status !== 'ACTIVE') {
        await this.forget(principal.tenantId, principal.sessionId, key);
        return undefined;
      }
      principal.role = subject.role as UserRole;
      principal.permissions = this.rbac.permissionsFor(principal.tenantId, subject.role);
      principal.scope = this.rbac.resolveScope(subject);
    } else {
      const operator = this.masterData
        .getOperators(principal.tenantId)
        .find((o) => o.id === principal.subjectId);
      if (!operator || operator.status !== 'ACTIVE') {
        await this.forget(principal.tenantId, principal.sessionId, key);
        return undefined;
      }
    }

    // The idle window moves on a throttle. Writing it on every request would
    // turn a read-mostly table into a write on the shop floor's hot path for
    // a value measured in minutes.
    const lifetime = LIFETIMES[principal.kind];
    const idleExpiresAt = new Date(now + lifetime.idleSeconds * 1000).toISOString();
    principal.idleExpiresAt = idleExpiresAt;
    session.lastSeenAt = new Date(now).toISOString();

    if (now - Date.parse(session.touchedAt ?? '0') > TOUCH_MS) {
      session.touchedAt = new Date(now).toISOString();
      // Fire and forget: a slow write must not hold up the request, and a
      // failed one only means the idle window moves at the next request.
      void this.sessions
        .touch(principal.tenantId, principal.sessionId, idleExpiresAt)
        // eslint-disable-next-line no-console
        .catch((error) => console.warn('[auth] session touch failed:', error));
    }

    return principal;
  }

  /** Drops a session from both the store and the cache. */
  private async forget(tenantId: string, sessionId: string, cacheKey?: string): Promise<void> {
    if (cacheKey) this.cache.delete(cacheKey);
    else this.forgetBySessionId(sessionId);
    await this.sessions.delete(tenantId, sessionId);
  }

  private forgetBySessionId(sessionId: string): void {
    for (const [key, entry] of this.cache) {
      if (entry.session.principal.sessionId === sessionId) this.cache.delete(key);
    }
  }

  /**
   * Housekeeping, started once at boot: expired rows are already ignored by
   * every read, this only keeps the table from growing without bound.
   */
  startSessionSweeper(intervalMs = 15 * 60_000): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.sessions
        .purgeExpired()
        .then((removed) => {
          if (removed > 0) {
            // eslint-disable-next-line no-console
            console.log(`[auth] purged ${removed} expired session(s).`);
          }
        })
        // eslint-disable-next-line no-console
        .catch((error) => console.warn('[auth] session purge failed:', error));

      for (const [key, entry] of this.cache) {
        if (Date.now() > Date.parse(entry.session.principal.expiresAt)) this.cache.delete(key);
      }
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  async logout(sessionId: string): Promise<void> {
    const cached = Array.from(this.cache.values()).find(
      (entry) => entry.session.principal.sessionId === sessionId
    )?.session;
    if (!cached) return;

    await this.forget(cached.principal.tenantId, sessionId);
    await this.audit.record({
      tenantId: cached.principal.tenantId,
      actorType: cached.principal.kind === 'OPERATOR' ? 'OPERATOR' : 'USER',
      actorId: cached.principal.subjectId,
      entityType: 'auth',
      entityId: cached.principal.subjectId,
      action: 'LOGOUT',
      previousValue: { sessionId },
      ip: cached.ip,
      userAgent: cached.userAgent,
    });
  }

  async listSessions(tenantId: string, subjectId?: string): Promise<SessionSummary[]> {
    return this.sessions.list(tenantId, subjectId);
  }

  /**
   * US-005, revoke one session, or every session belonging to one account.
   *
   * The delete happens in the store, so the decision outlives this process —
   * which is the whole point of revocation. The local cache is cleared with
   * it; another replica stops honouring the session within CACHE_MS.
   */
  async revokeSessions(
    tenantId: string,
    opts: { sessionId?: string; subjectId?: string },
    actorId: string
  ): Promise<number> {
    const victims = await this.sessions.deleteWhere(tenantId, opts);

    for (const victim of victims) {
      this.forgetBySessionId(victim.sessionId);
      await this.audit.record({
        tenantId,
        actorType: 'USER',
        actorId,
        entityType: 'session',
        entityId: victim.sessionId,
        action: 'SESSION_REVOKED',
        previousValue: { subjectId: victim.subjectId, issuedAt: victim.issuedAt },
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
    assertPasswordPolicy(password);
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
    assertPinPolicy(pin);
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
