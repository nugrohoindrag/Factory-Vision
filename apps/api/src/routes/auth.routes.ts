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

      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      res.json(await auth.login(tenantId, email!, password!, clientContext(req)));
    })
  );

  // US-002, operator login
  router.post(
    '/auth/operator-login',
    route(async (req, res) => {
      const v = validate(req.body);
      const employeeNumber = v.string('employeeNumber', { min: 1 });
      const pin = v.string('pin', { min: 4, max: 8 });
      v.done('Nomor karyawan dan PIN wajib diisi.');

      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      res.json(await auth.operatorLogin(tenantId, employeeNumber!, pin!, clientContext(req)));
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
      res.json(auth.listSessions(tenantId, subjectId));
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
