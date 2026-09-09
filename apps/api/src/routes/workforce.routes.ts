import { Router } from 'express';
import type { LaborUtilization, OperatorAvailabilityState } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { ApiError } from '../platform/http/api-error.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { WorkforceService } from '../modules/workforce/workforce.service.js';

/**
 * Workforce and labour (Improvement PRD §6, §21).
 *
 * §39 audits operator qualification and operator assignment, which are the two
 * decisions that say who is allowed to run a machine.
 */
export function workforceRoutes(workforce: WorkforceService, audit: AuditService): Router {
  const router = Router();

  const actorOf = (req: { principal?: { subjectId: string; name: string } }) => ({
    id: req.principal?.subjectId ?? 'system',
    name: req.principal?.name ?? 'System',
  });

  // --- Skills -------------------------------------------------------

  router.get(
    '/workforce/skills',
    route(async (req, res) => res.json(await workforce.listSkills(req.context!.tenantId)))
  );

  router.post(
    '/workforce/skills',
    route(async (req, res) => {
      const v = validate(req.body);
      const code = v.string('code', { min: 2, max: 64 });
      const name = v.string('name', { min: 2, max: 255 });
      const category = v.string('category', { optional: true, max: 64 });
      const description = v.string('description', { optional: true, max: 1000 });
      const maxLevel = v.number('maxLevel', { min: 1, max: 10, integer: true, optional: true });
      v.done();

      res.status(201).json(
        await workforce.createSkill(req.context!.tenantId, {
          code: code!,
          name: name!,
          category,
          description,
          maxLevel,
        })
      );
    })
  );

  router.put(
    '/workforce/skills/:id',
    route(async (req, res) => {
      res.json(await workforce.updateSkill(req.context!.tenantId, req.params.id, req.body ?? {}));
    })
  );

  router.delete(
    '/workforce/skills/:id',
    route(async (req, res) => {
      await workforce.deleteSkill(req.context!.tenantId, req.params.id);
      res.json({ success: true, message: 'Skill dihapus.' });
    })
  );

  // --- Qualification requirements (§6.2, §6.3) ----------------------

  router.get(
    '/workforce/requirements',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await workforce.listRequirements(req.context!.tenantId, {
          targetType: q.targetType,
          targetId: q.targetId,
        })
      );
    })
  );

  router.post(
    '/workforce/requirements',
    route(async (req, res) => {
      const v = validate(req.body);
      const targetType = v.string('targetType');
      const targetId = v.string('targetId');
      const skillId = v.string('skillId');
      const minimumLevel = v.number('minimumLevel', { min: 1, max: 10, integer: true, optional: true });
      const mandatory = v.boolean('mandatory', { optional: true });
      v.done();

      if (targetType !== 'MACHINE' && targetType !== 'PROCESS') {
        throw ApiError.validation('targetType harus MACHINE atau PROCESS.');
      }

      res.status(201).json(
        await workforce.setRequirement(req.context!.tenantId, {
          targetType,
          targetId: targetId!,
          skillId: skillId!,
          minimumLevel,
          mandatory,
        })
      );
    })
  );

  router.delete(
    '/workforce/requirements/:id',
    route(async (req, res) => {
      await workforce.deleteRequirement(req.context!.tenantId, req.params.id);
      res.json({ success: true, message: 'Requirement kualifikasi dihapus.' });
    })
  );

  // --- Qualifications (US-W001) -------------------------------------

  router.get(
    '/workforce/qualifications',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await workforce.listQualifications(req.context!.tenantId, {
          operatorId: q.operatorId,
          skillId: q.skillId,
          expiringWithinDays: q.expiringWithinDays ? Number(q.expiringWithinDays) : undefined,
        })
      );
    })
  );

  router.post(
    '/workforce/qualifications',
    route(async (req, res) => {
      const v = validate(req.body);
      const operatorId = v.string('operatorId');
      const skillId = v.string('skillId');
      const level = v.number('level', { min: 1, max: 10, integer: true });
      const certifiedDate = v.isoDate('certifiedDate', { optional: true });
      const expiryDate = v.isoDate('expiryDate', { optional: true });
      const issuer = v.string('issuer', { optional: true, max: 255 });
      const certificateNumber = v.string('certificateNumber', { optional: true, max: 128 });
      const status = v.string('status', { optional: true });
      const suspendedReason = v.string('suspendedReason', { optional: true, max: 1000 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const qualification = await workforce.setQualification(
        tenantId,
        {
          operatorId: operatorId!,
          skillId: skillId!,
          level: level!,
          certifiedDate,
          expiryDate,
          issuer,
          certificateNumber,
          status: status as never,
          suspendedReason,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'operator_qualification',
        entityId: qualification.id,
        action: 'QUALIFICATION_SET',
        newValue: {
          operatorId: qualification.operatorId,
          skillCode: qualification.skillCode,
          level: qualification.level,
          expiryDate: qualification.expiryDate,
          status: qualification.status,
        },
        ip: req.ip,
      });

      res.status(201).json(qualification);
    })
  );

  router.delete(
    '/workforce/qualifications/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      await workforce.deleteQualification(tenantId, req.params.id);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'operator_qualification',
        entityId: req.params.id,
        action: 'QUALIFICATION_REMOVE',
        ip: req.ip,
      });

      res.json({ success: true, message: 'Kualifikasi dihapus.' });
    })
  );

  // --- Shift assignment (US-W002) -----------------------------------

  router.get(
    '/workforce/shift-assignments',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await workforce.listShiftAssignments(req.context!.tenantId, {
          operatorId: q.operatorId,
          shiftId: q.shiftId,
          onDate: q.onDate,
        })
      );
    })
  );

  router.post(
    '/workforce/shift-assignments',
    route(async (req, res) => {
      const v = validate(req.body);
      const operatorId = v.string('operatorId');
      const shiftId = v.string('shiftId');
      const effectiveFrom = v.isoDate('effectiveFrom', { optional: true });
      const effectiveTo = v.isoDate('effectiveTo', { optional: true });
      const isDefault = v.boolean('isDefault', { optional: true });
      v.done();

      res.status(201).json(
        await workforce.assignShift(
          req.context!.tenantId,
          { operatorId: operatorId!, shiftId: shiftId!, effectiveFrom, effectiveTo, isDefault },
          actorOf(req)
        )
      );
    })
  );

  router.delete(
    '/workforce/shift-assignments/:id',
    route(async (req, res) => {
      await workforce.removeShiftAssignment(req.context!.tenantId, req.params.id);
      res.json({ success: true, message: 'Penugasan shift dihapus.' });
    })
  );

  // --- Availability (US-W003) ---------------------------------------

  router.get(
    '/workforce/availability',
    route(async (req, res) => {
      const operatorId = typeof req.query.operatorId === 'string' ? req.query.operatorId : undefined;
      res.json(await workforce.listAvailability(req.context!.tenantId, operatorId));
    })
  );

  router.post(
    '/workforce/availability',
    route(async (req, res) => {
      const v = validate(req.body);
      const operatorId = v.string('operatorId');
      const state = v.string('state');
      const shiftId = v.string('shiftId', { optional: true });
      const effectiveFrom = v.string('effectiveFrom', { optional: true });
      const effectiveTo = v.string('effectiveTo', { optional: true });
      const reason = v.string('reason', { optional: true, max: 500 });
      v.done();

      res.status(201).json(
        await workforce.setAvailability(
          req.context!.tenantId,
          {
            operatorId: operatorId!,
            state: state as OperatorAvailabilityState,
            shiftId,
            effectiveFrom,
            effectiveTo,
            reason,
          },
          actorOf(req)
        )
      );
    })
  );

  // --- Eligibility (US-W004) ----------------------------------------

  router.get(
    '/workforce/eligibility',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await workforce.eligibility(req.context!.tenantId, {
          machineId: q.machineId,
          processId: q.processId,
          onDate: q.onDate,
          operatorIds: q.operatorIds ? q.operatorIds.split(',') : undefined,
        })
      );
    })
  );

  // --- Labour requirement and assignment (§6.6) ---------------------

  router.get(
    '/workforce/labor-requirements/:workOrderId',
    route(async (req, res) => {
      res.json(await workforce.laborStatus(req.context!.tenantId, req.params.workOrderId));
    })
  );

  router.put(
    '/workforce/labor-requirements/:workOrderId',
    route(async (req, res) => {
      const v = validate(req.body);
      const requiredOperators = v.number('requiredOperators', { min: 0, max: 100, integer: true });
      const shiftId = v.string('shiftId', { optional: true });
      const notes = v.string('notes', { optional: true, max: 500 });
      v.done();

      res.json(
        await workforce.setLaborRequirement(req.context!.tenantId, req.params.workOrderId, {
          requiredOperators: requiredOperators!,
          shiftId,
          notes,
        })
      );
    })
  );

  router.get(
    '/workforce/assignments',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await workforce.listAssignments(req.context!.tenantId, {
          workOrderId: q.workOrderId,
          operatorId: q.operatorId,
          status: q.status,
          active: q.active === 'true',
        })
      );
    })
  );

  router.post(
    '/workforce/assignments',
    route(async (req, res) => {
      const v = validate(req.body);
      const workOrderId = v.string('workOrderId');
      const operatorId = v.string('operatorId');
      const role = v.string('role', { optional: true, max: 64 });
      const shiftId = v.string('shiftId', { optional: true });
      const force = v.boolean('force', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);

      // Overriding a qualification check is a decision somebody has to own, so
      // it takes the manage right rather than the everyday assignment right.
      if (force && !req.principal?.permissions.includes('workforce:manage')) {
        throw ApiError.forbidden(
          'Menugaskan operator yang tidak memenuhi syarat memerlukan izin workforce:manage.'
        );
      }

      const assignment = await workforce.assignOperator(
        tenantId,
        { workOrderId: workOrderId!, operatorId: operatorId!, role, shiftId, force },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'labor_assignment',
        entityId: assignment.id,
        action: 'OPERATOR_ASSIGNED',
        newValue: {
          workOrderId: assignment.workOrderId,
          operatorId: assignment.operatorId,
          qualificationCheck: assignment.qualificationCheck,
          forced: force ?? false,
        },
        ip: req.ip,
      });

      res.status(201).json(assignment);
    })
  );

  router.delete(
    '/workforce/assignments/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      await workforce.unassignOperator(tenantId, req.params.id, actor);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'labor_assignment',
        entityId: req.params.id,
        action: 'OPERATOR_UNASSIGNED',
        ip: req.ip,
      });

      res.json({ success: true, message: 'Penugasan operator dilepas.' });
    })
  );

  // --- Labour time and utilisation (US-W005) ------------------------

  router.get(
    '/workforce/time-records',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await workforce.listTimeRecords(req.context!.tenantId, {
          operatorId: q.operatorId,
          workOrderId: q.workOrderId,
          from: q.from,
          to: q.to,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/workforce/time-records',
    route(async (req, res) => {
      const v = validate(req.body);
      const operatorId = v.string('operatorId');
      const workOrderId = v.string('workOrderId', { optional: true });
      const shiftId = v.string('shiftId', { optional: true });
      const shiftDate = v.isoDate('shiftDate', { optional: true });
      const startedAt = v.string('startedAt');
      const endedAt = v.string('endedAt', { optional: true });
      const productiveMinutes = v.number('productiveMinutes', { min: 0 });
      const availableMinutes = v.number('availableMinutes', { min: 0 });
      const category = v.string('category', { optional: true });
      v.done();

      res.status(201).json(
        await workforce.recordTime(
          req.context!.tenantId,
          {
            operatorId: operatorId!,
            workOrderId,
            shiftId,
            shiftDate,
            startedAt: startedAt!,
            endedAt,
            productiveMinutes: productiveMinutes!,
            availableMinutes: availableMinutes!,
            category: category as never,
          },
          actorOf(req)
        )
      );
    })
  );

  router.get(
    '/workforce/utilization',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const scope = (q.scope ?? 'OPERATOR') as LaborUtilization['scope'];
      res.json(await workforce.utilization(req.context!.tenantId, scope, { from: q.from, to: q.to }));
    })
  );

  router.get(
    '/workforce/dashboard',
    route(async (req, res) => res.json(await workforce.dashboard(req.context!.tenantId)))
  );

  return router;
}
