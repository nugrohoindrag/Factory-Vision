import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { ApiError } from '../platform/http/api-error.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { MasterDataService } from '../modules/master-data/master-data.service.js';

/**
 * Authentication endpoints (US-001, US-002) and session administration
 * (US-005). Login is deliberately the only unauthenticated write in the API.
 */
/** MFA belongs to a named person, so an operator terminal session cannot use it. */
function requireApplicationSession(req: import('express').Request) {
  const principal = req.principal;
  if (!principal) throw ApiError.unauthenticated('Sesi tidak aktif.');
  if (principal.kind !== 'APPLICATION') {
    throw ApiError.forbidden('MFA hanya berlaku untuk akun pengguna aplikasi.');
  }
  return principal;
}

export function authRoutes(auth: AuthService, masterData: MasterDataService): Router {
  const router = Router();

  const clientContext = (req: import('express').Request) => ({
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // US-001, application login
  router.post(
    '/auth/login',
    route(async (req, res) => {
      const v = validate(req.body);
      const email = v.email('email');
      const password = v.string('password', { min: 1 });
      v.done('Email dan kata sandi wajib diisi.');

      // The console names no tenant: a trial admin and the pilot's supervisor
      // sign in at the same address. So the tenant comes from the email when
      // the client did not say. The header still wins when present (the
      // operator terminal and integrations set it), and an unknown email
      // falls through to the default tenant so the failure reads the same as
      // a wrong password — the form must not reveal who exists.
      const headerTenant = typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : undefined;
      const candidates = headerTenant ? [headerTenant] : auth.tenantsForEmail(email!);
      const tenants = candidates.length > 0 ? candidates : [req.context?.tenantId ?? 'tenant-pilot-factory-01'];

      let outcome: unknown;
      let lastError: unknown;
      for (const tenantId of tenants) {
        try {
          outcome = await auth.login(tenantId, email!, password!, clientContext(req));
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      res.json(outcome);
    })
  );

  // US-002, operator login
  router.post(
    '/auth/operator-login',
    route(async (req, res) => {
      const v = validate(req.body);
      const employeeNumber = v.string('employeeNumber', { min: 1 });
      const pin = v.string('pin', { min: 1, max: 32 });
      v.done('Nomor karyawan dan PIN wajib diisi.');

      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      res.json(await auth.operatorLogin(tenantId, employeeNumber!, pin!, clientContext(req)));
    })
  );

  // §5, second factor. The challenge token is what the login answered with;
  // it is single use and expires in minutes.
  router.post(
    '/auth/mfa/verify',
    route(async (req, res) => {
      const v = validate(req.body);
      const challengeToken = v.string('challengeToken', { min: 1 });
      const code = v.string('code', { min: 6, max: 16 });
      v.done('Token verifikasi dan kode MFA wajib diisi.');

      res.json(await auth.verifyMfaLogin(challengeToken!, code!, clientContext(req)));
    })
  );

  /** Where the signed-in user stands on MFA, and whether their role needs it. */
  router.get(
    '/auth/mfa',
    route(async (req, res) => {
      const principal = requireApplicationSession(req);
      const status = await auth.mfa.status(principal.tenantId, principal.subjectId, principal.role);
      res.json({ ...status, available: auth.mfa.available });
    })
  );

  /**
   * Starts enrolment: issues a secret and the otpauth URI for the app.
   * Nothing is enforced until it is confirmed with a code, so a botched scan
   * cannot lock anyone out.
   */
  router.post(
    '/auth/mfa/enroll',
    route(async (req, res) => {
      const principal = requireApplicationSession(req);
      const user = masterData.getUserById(principal.tenantId, principal.subjectId);
      const enrolment = await auth.mfa.beginEnrolment(
        principal.tenantId,
        principal.subjectId,
        user?.email ?? principal.name
      );
      res.json(enrolment);
    })
  );

  /** Confirms enrolment. The recovery codes in the response are shown once. */
  router.post(
    '/auth/mfa/confirm',
    route(async (req, res) => {
      const principal = requireApplicationSession(req);
      const v = validate(req.body);
      const code = v.string('code', { min: 6, max: 8 });
      v.done('Kode MFA wajib diisi.');

      const recoveryCodes = await auth.mfa.confirmEnrolment(
        principal.tenantId,
        principal.subjectId,
        code!
      );
      res.json({ success: true, recoveryCodes });
    })
  );

  /**
   * Turns MFA off for the signed-in account, and only after a current code:
   * an unlocked console left on a desk should not be able to remove the
   * factor that protects it.
   */
  router.post(
    '/auth/mfa/disable',
    route(async (req, res) => {
      const principal = requireApplicationSession(req);
      const v = validate(req.body);
      const code = v.string('code', { min: 6, max: 16 });
      v.done('Kode MFA wajib diisi untuk menonaktifkan MFA.');

      const challenge = auth.mfa.issueChallenge(principal.tenantId, principal.subjectId);
      await auth.mfa.verifyChallenge(challenge.challengeToken, code!);
      await auth.mfa.disable(principal.tenantId, principal.subjectId);
      res.json({ success: true });
    })
  );

  /**
   * Session probe. The console calls this on boot to decide whether to restore
   * a session or show the login screen, and the operator terminal polls it to
   * detect the inactivity logout US-002 requires.
   */
  router.get(
    '/auth/session',
    route(async (req, res) => {
      if (!req.principal) throw ApiError.unauthenticated('Sesi tidak aktif.');
      const principal = req.principal;
      res.json({
        principal,
        user:
          principal.kind === 'APPLICATION'
            ? masterData.getUserById(principal.tenantId, principal.subjectId)
            : undefined,
        operator:
          principal.kind === 'OPERATOR' ? auth.operatorFor(principal.tenantId, principal.subjectId) : undefined,
      });
    })
  );

  router.post(
    '/auth/logout',
    route(async (req, res) => {
      if (req.principal) await auth.logout(req.principal.sessionId);
      res.json({ success: true });
    })
  );

  // US-005, live sessions and revocation
  router.get(
    '/sessions',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
      res.json(await auth.listSessions(tenantId, subjectId));
    })
  );

  router.delete(
    '/sessions/:sessionId',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const revoked = await auth.revokeSessions(
        tenantId,
        { sessionId: req.params.sessionId },
        req.principal?.subjectId ?? 'system'
      );
      res.json({ success: revoked > 0, revoked });
    })
  );

  router.delete(
    '/sessions',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
      if (!subjectId) throw ApiError.validation('subjectId wajib diisi untuk mencabut sesi pengguna.');
      const revoked = await auth.revokeSessions(tenantId, { subjectId }, req.principal?.subjectId ?? 'system');
      res.json({ success: true, revoked });
    })
  );

  // Credential administration ( audits both of these)
  router.post(
    '/users/:id/password',
    route(async (req, res) => {
      const v = validate(req.body);
      const password = v.string('password', { min: 8 });
      v.done();
      await auth.setUserPassword(
        req.context!.tenantId,
        req.params.id,
        password!,
        req.principal?.subjectId ?? 'system'
      );
      res.json({ success: true, message: 'Kata sandi diperbarui dan sesi aktif dicabut.' });
    })
  );

  router.post(
    '/operators/:id/pin',
    route(async (req, res) => {
      const v = validate(req.body);
      const pin = v.string('pin', { min: 4, max: 8 });
      v.done();
      await auth.setOperatorPin(req.context!.tenantId, req.params.id, pin!, req.principal?.subjectId ?? 'system');
      res.json({ success: true, message: 'PIN operator diperbarui dan sesi aktif dicabut.' });
    })
  );

  return router;
}
