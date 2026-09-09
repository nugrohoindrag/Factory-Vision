import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { OnboardingService } from '../modules/onboarding/onboarding.service.js';

export function onboardingRoutes(service: OnboardingService): Router {
  const router = Router();

  const clientContext = (req: import('express').Request) => ({
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Public Free Trial registration endpoint
  router.post(
    '/auth/trial-register',
    route(async (req, res) => {
      const v = validate(req.body);
      const fullName = v.string('fullName', { min: 2 });
      const email = v.email('email');
      // Length is checked against the shared policy in the service; the field
      // check here only ensures the value is present and a string.
      const password = v.string('password', { min: 1 });
      const factoryName = v.string('factoryName', { min: 2 });
      const industry = v.string('industry', { min: 2 }) as any;
      const city = typeof req.body.city === 'string' ? req.body.city : undefined;
      v.done('Lengkapi semua kolom formulir trial.');

      const result = await service.registerTrial(
        {
          fullName: fullName!,
          email: email!,
          password: password!,
          factoryName: factoryName!,
          industry: industry || 'general',
          city,
        },
        clientContext(req)
      );

      res.status(201).json(result);
    })
  );

  // List all available Industry Seed Templates
  router.get(
    '/onboarding/templates',
    route(async (_req, res) => {
      res.json(service.listTemplates());
    })
  );

  // Apply chosen industry template to tenant's factory
  router.post(
    '/onboarding/apply-template',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const v = validate(req.body);
      const industry = (v.string('industry') || 'general') as any;
      const factoryName = typeof req.body.factoryName === 'string' ? req.body.factoryName : undefined;
      const city = typeof req.body.city === 'string' ? req.body.city : undefined;
      const timezone = typeof req.body.timezone === 'string' ? req.body.timezone : undefined;

      const result = await service.applyTemplate(tenantId, industry, {
        factoryName,
        city,
        timezone,
      });

      res.json(result);
    })
  );

  // Create a blank factory without seed template
  router.post(
    '/onboarding/create-blank',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const v = validate(req.body);
      const factoryName = v.string('factoryName', { min: 2 })!;
      const industry = (v.string('industry') || 'general') as any;
      const country = v.string('country') || 'Indonesia';
      const city = typeof req.body.city === 'string' ? req.body.city : undefined;
      const timezone = v.string('timezone') || 'Asia/Jakarta';
      const workingCalendar = v.string('workingCalendar') || '2 Shift';
      v.done();

      const result = await service.createBlankFactory(tenantId, {
        factoryName,
        industry,
        country,
        city,
        timezone,
        workingCalendar,
      });

      res.json(result);
    })
  );

  // Get current tenant's onboarding progress & checklist
  router.get(
    '/onboarding/status',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const userId = req.principal?.subjectId;
      const status = await service.getStatus(tenantId, userId);
      res.json(status);
    })
  );

  // Update a specific onboarding step status
  router.put(
    '/onboarding/step',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const v = validate(req.body);
      const stepId = v.string('stepId', { min: 1 }) as any;
      const status = v.string('status', { min: 1 }) as any;
      v.done('stepId dan status wajib diisi.');

      const result = service.updateStep(tenantId, stepId, status);
      res.json(result);
    })
  );

  // Get Welcome Tour & guidance states
  router.get(
    '/onboarding/guidance',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      res.json(service.getGuidance(tenantId));
    })
  );

  // Update Welcome Tour or dismiss tooltips
  router.put(
    '/onboarding/guidance',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const patch = req.body || {};
      res.json(service.updateGuidance(tenantId, patch));
    })
  );

  // Execute interactive first production workflow (PO -> WO -> Output -> Value Result)
  router.post(
    '/onboarding/first-workflow',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const result = await service.executeFirstWorkflow(tenantId, req.body);
      res.json(result);
    })
  );

  // Record onboarding funnel analytics events
  router.post(
    '/onboarding/events',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const eventName = req.body.eventName;
      if (!eventName) {
        res.status(400).json({ error: 'eventName wajib diisi.' });
        return;
      }
      service.recordAnalyticsEvent({
        eventName,
        tenantId,
        userId: req.principal?.subjectId,
        timestamp: new Date().toISOString(),
        metadata: req.body.metadata,
      });
      res.json({ success: true });
    })
  );

  // Commercial upgrade request
  router.post(
    '/onboarding/upgrade',
    route(async (req, res) => {
      const tenantId = req.context?.tenantId ?? 'tenant-pilot-factory-01';
      const planCode = req.body.planCode || 'GROWTH';
      const result = await service.upgradePlan(tenantId, planCode);
      res.json(result);
    })
  );

  return router;
}
