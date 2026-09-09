import { Router } from 'express';
import type { MaintenancePlan, MaintenanceRecord } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { MaintenanceService } from '../modules/maintenance/maintenance.service.js';

/**
 * Maintenance (Improvement PRD §5, §21).
 *
 * §39 audits maintenance changes; the entries here are the ones that change
 * what a machine is allowed to do — starting work, completing it, and raising
 * an emergency, which takes a machine out of production on the spot.
 */
export function maintenanceRoutes(maintenance: MaintenanceService, audit: AuditService): Router {
  const router = Router();

  const actorOf = (req: { principal?: { subjectId: string; name: string } }) => ({
    id: req.principal?.subjectId ?? 'system',
    name: req.principal?.name ?? 'System',
  });

  // --- Preventive plans (§5.2, US-MT001) ----------------------------

  router.get(
    '/maintenance/plans',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(await maintenance.listPlans(req.context!.tenantId, { machineId: q.machineId, status: q.status }));
    })
  );

  router.post(
    '/maintenance/plans',
    route(async (req, res) => {
      const v = validate(req.body);
      const name = v.string('name', { min: 2, max: 255 });
      const machineId = v.string('machineId');
      const triggerType = v.string('triggerType');
      const intervalValue = v.number('intervalValue', { min: 0.01 });
      const intervalUnit = v.string('intervalUnit', { optional: true });
      const estimatedDurationMinutes = v.number('estimatedDurationMinutes', { min: 0, optional: true });
      const warningThreshold = v.number('warningThreshold', { min: 0, optional: true });
      const startFrom = v.isoDate('startFrom', { optional: true });
      const tasks = v.stringArray('tasks', { optional: true });
      v.done();

      res.status(201).json(
        await maintenance.createPlan(
          req.context!.tenantId,
          {
            name: name!,
            machineId: machineId!,
            triggerType: triggerType as MaintenancePlan['triggerType'],
            intervalValue: intervalValue!,
            intervalUnit,
            tasks,
            estimatedDurationMinutes,
            warningThreshold,
            startFrom,
          },
          actorOf(req)
        )
      );
    })
  );

  router.put(
    '/maintenance/plans/:id',
    route(async (req, res) => {
      res.json(await maintenance.updatePlan(req.context!.tenantId, req.params.id, req.body ?? {}));
    })
  );

  router.delete(
    '/maintenance/plans/:id',
    route(async (req, res) => {
      await maintenance.deletePlan(req.context!.tenantId, req.params.id);
      res.json({ success: true, message: 'Maintenance Plan dihapus.' });
    })
  );

  /** BR-MT01 — turn every due plan into work. Safe to call repeatedly. */
  router.post(
    '/maintenance/plans/generate',
    route(async (req, res) => {
      const created = await maintenance.generateDueWork(req.context!.tenantId, actorOf(req));
      res.status(201).json({ created: created.length, records: created });
    })
  );

  // --- Requests (§5.3, US-MT002) ------------------------------------

  router.get(
    '/maintenance/requests',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await maintenance.listRequests(req.context!.tenantId, {
          status: q.status,
          machineId: q.machineId,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/maintenance/requests',
    route(async (req, res) => {
      const v = validate(req.body);
      const machineId = v.string('machineId');
      const maintenanceType = v.string('maintenanceType', { optional: true });
      const priority = v.string('priority', { optional: true });
      const problemDescription = v.string('problemDescription', { min: 3, max: 2000 });
      const reportedSymptom = v.string('reportedSymptom', { optional: true, max: 2000 });
      const workOrderId = v.string('workOrderId', { optional: true });
      const downtimeId = v.string('downtimeId', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      v.done();

      const actor = actorOf(req);
      res.status(201).json(
        await maintenance.createRequest(
          req.context!.tenantId,
          {
            machineId: machineId!,
            maintenanceType: maintenanceType as never,
            priority: priority as never,
            problemDescription: problemDescription!,
            reportedSymptom,
            workOrderId,
            downtimeId,
            notes,
          },
          { ...actor, type: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER' }
        )
      );
    })
  );

  router.post(
    '/maintenance/requests/:id/accept',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const technicianId = v.string('technicianId', { optional: true });
      const technicianName = v.string('technicianName', { optional: true });
      const scheduledFor = v.isoDate('scheduledFor', { optional: true });
      v.done();

      res.status(201).json(
        await maintenance.acceptRequest(
          req.context!.tenantId,
          req.params.id,
          { technicianId, technicianName, scheduledFor },
          actorOf(req)
        )
      );
    })
  );

  router.post(
    '/maintenance/requests/:id/reject',
    route(async (req, res) => {
      await maintenance.rejectRequest(req.context!.tenantId, req.params.id);
      res.json({ success: true, message: 'Permintaan maintenance ditolak.' });
    })
  );

  // --- Records (§5.5) -----------------------------------------------

  router.get(
    '/maintenance/records',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await maintenance.listRecords(req.context!.tenantId, {
          machineId: q.machineId,
          status: q.status,
          maintenanceType: q.maintenanceType,
          from: q.from,
          to: q.to,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/maintenance/records/:id/assign',
    route(async (req, res) => {
      const v = validate(req.body);
      const technicianId = v.string('technicianId');
      const technicianName = v.string('technicianName', { optional: true });
      const scheduledFor = v.isoDate('scheduledFor', { optional: true });
      v.done();

      res.json(
        await maintenance.assignTechnician(req.context!.tenantId, req.params.id, {
          technicianId: technicianId!,
          technicianName,
          scheduledFor,
        })
      );
    })
  );

  router.post(
    '/maintenance/records/:id/start',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const record = await maintenance.startWork(tenantId, req.params.id, actor);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'maintenance_record',
        entityId: record.id,
        action: 'MAINTENANCE_START',
        newValue: { machineId: record.machineId, maintenanceType: record.maintenanceType },
        ip: req.ip,
      });

      res.json(record);
    })
  );

  router.post(
    '/maintenance/records/:id/complete',
    route(async (req, res) => {
      const v = validate(req.body);
      const result = v.string('result');
      const rootCause = v.string('rootCause', { optional: true, max: 2000 });
      const actionTaken = v.string('actionTaken', { optional: true, max: 2000 });
      const costReference = v.number('costReference', { min: 0, optional: true });
      const meterReading = v.number('meterReading', { min: 0, optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const record = await maintenance.completeWork(
        tenantId,
        req.params.id,
        {
          result: result as NonNullable<MaintenanceRecord['result']>,
          rootCause,
          actionTaken,
          costReference,
          meterReading,
          notes,
          parts: Array.isArray(req.body?.parts) ? req.body.parts : [],
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'maintenance_record',
        entityId: record.id,
        action: 'MAINTENANCE_COMPLETE',
        newValue: {
          result,
          durationMinutes: record.durationMinutes,
          rootCause,
          machineId: record.machineId,
        },
        ip: req.ip,
      });

      res.json(record);
    })
  );

  // --- Emergency (§5.4, US-MT003) -----------------------------------

  router.post(
    '/maintenance/emergency',
    route(async (req, res) => {
      const v = validate(req.body);
      const machineId = v.string('machineId');
      const problem = v.string('problem', { min: 3, max: 2000 });
      const workOrderId = v.string('workOrderId', { optional: true });
      const lineId = v.string('lineId', { optional: true });
      const operatorId = v.string('operatorId', { optional: true });
      const shiftId = v.string('shiftId', { optional: true });
      const reasonId = v.string('reasonId', { optional: true });
      const technicianId = v.string('technicianId', { optional: true });
      const technicianName = v.string('technicianName', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const outcome = await maintenance.raiseEmergency(
        tenantId,
        {
          machineId: machineId!,
          problem: problem!,
          workOrderId,
          lineId,
          operatorId,
          shiftId,
          reasonId,
          technicianId,
          technicianName,
        },
        { ...actor, type: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER' }
      );

      await audit.record({
        tenantId,
        actorType: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER',
        actorId: actor.id,
        entityType: 'maintenance_record',
        entityId: outcome.record.id,
        action: 'MAINTENANCE_EMERGENCY',
        newValue: { machineId, problem, downtimeId: outcome.downtimeId },
        ip: req.ip,
      });

      res.status(201).json(outcome);
    })
  );

  // --- Dashboard (§22.3) --------------------------------------------

  router.get(
    '/maintenance/kpi',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await maintenance.kpi(req.context!.tenantId, {
          from: q.from,
          to: q.to,
          machineId: q.machineId,
        })
      );
    })
  );

  return router;
}
