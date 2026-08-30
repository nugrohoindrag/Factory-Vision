import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { MasterDataService } from '../modules/master-data/master-data.service.js';
import { ShiftHandoverService } from '../modules/shift/shift.service.js';

/**
 * Shift configuration (US-021) and handover (US-023).
 *
 * Mounted under `/api/v1/shifts` rather than `/api/v1/master/shifts` because a
 * handover is an operational transaction, not master data, the console's
 * supervisor area and its settings area both read from here.
 */
export function shiftRoutes(
  masterData: MasterDataService,
  handovers: ShiftHandoverService,
  audit: AuditService
): Router {
  const router = Router();

  // --- Handover (registered first: `/shifts/handover` must not be read as
  // `/shifts/:id`) ---------------------------------------------------

  router.get(
    '/shifts/handover/context',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const lineId = String(req.query.lineId ?? '');
      if (!lineId) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'lineId wajib diisi.',
            requestId: req.requestId ?? '',
          },
        });
        return;
      }
      res.json(
        await handovers.buildContext(tenantId, {
          lineId,
          shiftId: typeof req.query.shiftId === 'string' ? req.query.shiftId : undefined,
          shiftDate: typeof req.query.shiftDate === 'string' ? req.query.shiftDate : undefined,
        })
      );
    })
  );

  router.get(
    '/shifts/handover',
    route(async (req, res) => {
      res.json(
        handovers.list(req.context!.tenantId, {
          lineId: typeof req.query.lineId === 'string' ? req.query.lineId : undefined,
          shiftDate: typeof req.query.shiftDate === 'string' ? req.query.shiftDate : undefined,
        })
      );
    })
  );

  router.post(
    '/shifts/handover',
    route(async (req, res) => {
      const v = validate(req.body);
      const lineId = v.string('lineId');
      const shiftId = v.string('shiftId');
      const shiftDate = v.string('shiftDate');
      const notes = v.string('notes', { min: 1, max: 2000 });
      const openIssues = v.stringArray('openIssues', { optional: true });
      const incomingSupervisorId = v.string('incomingSupervisorId', { optional: true });
      const incomingSupervisorName = v.string('incomingSupervisorName', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const record = handovers.create(tenantId, {
        lineId: lineId!,
        shiftId: shiftId!,
        shiftDate: shiftDate!,
        outgoingSupervisorId: req.principal?.subjectId ?? 'system',
        outgoingSupervisorName: req.principal?.name ?? 'System',
        incomingSupervisorId,
        incomingSupervisorName,
        notes: notes!,
        openIssues,
      });

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'shift_handover',
        entityId: record.id,
        action: 'SHIFT_HANDOVER',
        newValue: { lineId: record.lineId, shiftId: record.shiftId, shiftDate: record.shiftDate },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json(record);
    })
  );

  router.post(
    '/shifts/handover/:id/acknowledge',
    route(async (req, res) => {
      const record = handovers.acknowledge(req.context!.tenantId, req.params.id, {
        id: req.principal?.subjectId ?? 'system',
        name: req.principal?.name ?? 'System',
      });
      res.json(record);
    })
  );

  // --- Shift configuration (US-021) ---------------------------------

  router.get(
    '/shifts',
    route(async (req, res) => res.json(masterData.getShifts(req.context!.tenantId)))
  );

  router.post(
    '/shifts',
    route(async (req, res) => {
      const v = validate(req.body);
      const plantId = v.string('plantId');
      const name = v.string('name', { min: 2, max: 60 });
      const startTime = v.clockTime('startTime');
      const endTime = v.clockTime('endTime');
      const breakMinutes = v.number('breakMinutes', { min: 0, max: 480, integer: true, optional: true });
      const active = v.boolean('active', { optional: true });
      const targetQuantity = v.number('targetQuantity', { min: 0, optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const shift = await masterData.createShift(tenantId, {
        plantId: plantId!,
        name: name!,
        startTime: startTime!,
        endTime: endTime!,
        breakMinutes: breakMinutes ?? 0,
        active: active ?? true,
      });

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'shift',
        entityId: shift.id,
        action: 'CREATE',
        newValue: { ...shift, targetQuantity },
        ip: req.ip,
      });

      res.status(201).json(shift);
    })
  );

  router.put(
    '/shifts/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const before = masterData.getShiftById(tenantId, req.params.id);

      const v = validate(req.body);
      const name = v.string('name', { optional: true, min: 2, max: 60 });
      const startTime = v.clockTime('startTime', { optional: true });
      const endTime = v.clockTime('endTime', { optional: true });
      const breakMinutes = v.number('breakMinutes', { min: 0, max: 480, integer: true, optional: true });
      const active = v.boolean('active', { optional: true });
      v.done();

      const shift = await masterData.updateShift(tenantId, req.params.id, {
        name,
        startTime,
        endTime,
        breakMinutes,
        active,
      });

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'shift',
        entityId: shift.id,
        action: 'UPDATE',
        previousValue: before ? { ...before } : undefined,
        newValue: { ...shift },
        ip: req.ip,
      });

      res.json(shift);
    })
  );

  router.delete(
    '/shifts/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const before = masterData.getShiftById(tenantId, req.params.id);
      await masterData.deleteShift(tenantId, req.params.id);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'shift',
        entityId: req.params.id,
        action: 'DELETE',
        previousValue: before ? { ...before } : undefined,
        ip: req.ip,
      });

      res.json({ success: true, message: 'Shift dihapus.' });
    })
  );

  return router;
}
