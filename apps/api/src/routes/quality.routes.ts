import { Router } from 'express';
import type { InspectionPlan, NcrStatus, QualityDisposition } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { ApiError } from '../platform/http/api-error.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { QualityService } from '../modules/quality/quality.service.js';

/**
 * Quality execution (Improvement PRD §4, §21).
 *
 * §39 requires an audit entry for every disposition, hold, release and NCR
 * change; those are the writes that decide what happens to product, and the
 * ones an auditor asks about by name.
 */
export function qualityRoutes(quality: QualityService, audit: AuditService): Router {
  const router = Router();

  const actorOf = (req: { principal?: { subjectId: string; name: string } }) => ({
    id: req.principal?.subjectId ?? 'system',
    name: req.principal?.name ?? 'System',
  });

  // --- Inspection plans (§4.2) --------------------------------------

  router.get(
    '/quality/inspection-plans',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await quality.listPlans(req.context!.tenantId, {
          productId: q.productId,
          processId: q.processId,
          status: q.status,
        })
      );
    })
  );

  router.get(
    '/quality/inspection-plans/:id',
    route(async (req, res) => {
      const plan = await quality.getPlan(req.context!.tenantId, req.params.id);
      if (!plan) throw ApiError.notFound('Inspection Plan tidak ditemukan.');
      res.json(plan);
    })
  );

  router.post(
    '/quality/inspection-plans',
    route(async (req, res) => {
      const v = validate(req.body);
      const name = v.string('name', { min: 2, max: 255 });
      const inspectionType = v.string('inspectionType');
      const productId = v.string('productId', { optional: true });
      const processId = v.string('processId', { optional: true });
      const samplingMethod = v.string('samplingMethod', { optional: true });
      const samplingQuantity = v.number('samplingQuantity', { min: 0, optional: true });
      const frequency = v.string('frequency', { optional: true, max: 128 });
      const mandatory = v.boolean('mandatory', { optional: true });
      const status = v.string('status', { optional: true });
      v.done();

      const characteristics = Array.isArray(req.body?.characteristics) ? req.body.characteristics : [];
      if (characteristics.length === 0) {
        throw ApiError.validation('Inspection Plan harus memiliki minimal satu karakteristik.');
      }

      const plan = await quality.createPlan(
        req.context!.tenantId,
        {
          name: name!,
          inspectionType: inspectionType as InspectionPlan['inspectionType'],
          productId,
          processId,
          samplingMethod: samplingMethod as InspectionPlan['samplingMethod'],
          samplingQuantity,
          frequency,
          mandatory,
          status: status as InspectionPlan['status'],
          characteristics,
        },
        actorOf(req)
      );
      res.status(201).json(plan);
    })
  );

  router.put(
    '/quality/inspection-plans/:id',
    route(async (req, res) => {
      res.json(await quality.updatePlan(req.context!.tenantId, req.params.id, req.body ?? {}));
    })
  );

  router.delete(
    '/quality/inspection-plans/:id',
    route(async (req, res) => {
      await quality.deletePlan(req.context!.tenantId, req.params.id);
      res.json({ success: true, message: 'Inspection Plan dihapus.' });
    })
  );

  // --- Inspections (US-Q001) ----------------------------------------

  router.get(
    '/quality/inspections',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await quality.listInspections(req.context!.tenantId, {
          workOrderId: q.workOrderId,
          batchId: q.batchId,
          productId: q.productId,
          result: q.result,
          from: q.from,
          to: q.to,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/quality/inspections',
    route(async (req, res) => {
      const v = validate(req.body);
      const inspectionPlanId = v.string('inspectionPlanId', { optional: true });
      const inspectionType = v.string('inspectionType', { optional: true });
      const workOrderId = v.string('workOrderId', { optional: true });
      const batchId = v.string('batchId', { optional: true });
      const productId = v.string('productId', { optional: true });
      const processId = v.string('processId', { optional: true });
      const machineId = v.string('machineId', { optional: true });
      const inspectedQuantity = v.number('inspectedQuantity', { min: 0.0001 });
      const failedQuantity = v.number('failedQuantity', { min: 0, optional: true });
      const uom = v.string('uom', { optional: true });
      const operatorId = v.string('operatorId', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      const idempotencyKey = v.string('idempotencyKey', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const inspection = await quality.recordInspection(
        tenantId,
        {
          inspectionPlanId,
          inspectionType: inspectionType as never,
          workOrderId,
          batchId,
          productId,
          processId,
          machineId,
          inspectedQuantity: inspectedQuantity!,
          failedQuantity,
          uom,
          operatorId,
          notes,
          idempotencyKey,
          measurements: Array.isArray(req.body?.measurements) ? req.body.measurements : [],
        },
        { ...actor, type: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER' }
      );

      await audit.record({
        tenantId,
        actorType: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER',
        actorId: actor.id,
        entityType: 'inspection',
        entityId: inspection.id,
        action: 'QUALITY_INSPECTION',
        newValue: {
          result: inspection.result,
          inspectedQuantity: inspection.inspectedQuantity,
          failedQuantity: inspection.failedQuantity,
          workOrderId: inspection.workOrderId,
        },
        ip: req.ip,
      });

      res.status(201).json(inspection);
    })
  );

  // --- Holds (§4.4) -------------------------------------------------

  router.get(
    '/quality/holds',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await quality.listHolds(req.context!.tenantId, {
          status: q.status,
          workOrderId: q.workOrderId,
          batchId: q.batchId,
        })
      );
    })
  );

  router.post(
    '/quality/holds',
    route(async (req, res) => {
      const v = validate(req.body);
      const workOrderId = v.string('workOrderId', { optional: true });
      const batchId = v.string('batchId', { optional: true });
      const productId = v.string('productId', { optional: true });
      const materialId = v.string('materialId', { optional: true });
      const inspectionId = v.string('inspectionId', { optional: true });
      const quantity = v.number('quantity', { min: 0.0001 });
      const uom = v.string('uom', { optional: true });
      const reason = v.string('reason', { min: 3, max: 1000 });
      const ownerId = v.string('ownerId');
      const ownerName = v.string('ownerName', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const hold = await quality.createHold(
        tenantId,
        {
          workOrderId,
          batchId,
          productId,
          materialId,
          inspectionId,
          quantity: quantity!,
          uom,
          reason: reason!,
          ownerId: ownerId!,
          ownerName,
          notes,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'quality_hold',
        entityId: hold.id,
        action: 'QUALITY_HOLD',
        newValue: { quantity: hold.quantity, reason: hold.reason, ownerId: hold.ownerId },
        ip: req.ip,
      });

      res.status(201).json(hold);
    })
  );

  router.post(
    '/quality/holds/:id/release',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const reason = v.string('reason', { min: 3, max: 1000 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const hold = await quality.releaseHold(tenantId, req.params.id, { reason: reason! }, actor);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'quality_hold',
        entityId: hold.id,
        action: 'QUALITY_RELEASE',
        newValue: { reason },
        ip: req.ip,
      });

      res.json(hold);
    })
  );

  /** BR-Q02 / BR-H04 — the gate a WIP transfer consults before moving. */
  router.get(
    '/quality/gate/:workOrderId',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await quality.transferBlock(req.context!.tenantId, req.params.workOrderId, {
          productId: q.productId,
          processId: q.processId,
        })
      );
    })
  );

  // --- Dispositions (US-Q002) ---------------------------------------

  router.get(
    '/quality/dispositions',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await quality.listDispositions(req.context!.tenantId, {
          workOrderId: q.workOrderId,
          inspectionId: q.inspectionId,
          decision: q.decision,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/quality/dispositions',
    route(async (req, res) => {
      const v = validate(req.body);
      const decision = v.string('decision');
      const quantity = v.number('quantity', { min: 0.0001 });
      const reason = v.string('reason', { min: 3, max: 1000 });
      const inspectionId = v.string('inspectionId', { optional: true });
      const qualityHoldId = v.string('qualityHoldId', { optional: true });
      const workOrderId = v.string('workOrderId', { optional: true });
      const batchId = v.string('batchId', { optional: true });
      const productId = v.string('productId', { optional: true });
      const uom = v.string('uom', { optional: true });
      const defectCode = v.string('defectCode', { optional: true });
      const ncrId = v.string('ncrId', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const disposition = await quality.createDisposition(
        tenantId,
        {
          decision: decision as QualityDisposition['decision'],
          quantity: quantity!,
          reason: reason!,
          inspectionId,
          qualityHoldId,
          workOrderId,
          batchId,
          productId,
          uom,
          defectCode,
          ncrId,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'quality_disposition',
        entityId: disposition.id,
        action: 'QUALITY_DISPOSITION',
        newValue: {
          decision: disposition.decision,
          quantity: disposition.quantity,
          reason: disposition.reason,
          workOrderId: disposition.workOrderId,
        },
        ip: req.ip,
      });

      res.status(201).json(disposition);
    })
  );

  // --- NCR and corrective action (US-Q003) --------------------------

  router.get(
    '/quality/ncr',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await quality.listNcrs(req.context!.tenantId, {
          status: q.status,
          workOrderId: q.workOrderId,
          overdue: q.overdue === 'true',
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/quality/ncr',
    route(async (req, res) => {
      const v = validate(req.body);
      const title = v.string('title', { min: 3, max: 255 });
      const description = v.string('description', { min: 3, max: 4000 });
      const severity = v.string('severity', { optional: true });
      const ownerId = v.string('ownerId');
      const ownerName = v.string('ownerName', { optional: true });
      const productId = v.string('productId', { optional: true });
      const batchId = v.string('batchId', { optional: true });
      const workOrderId = v.string('workOrderId', { optional: true });
      const processId = v.string('processId', { optional: true });
      const machineId = v.string('machineId', { optional: true });
      const operatorId = v.string('operatorId', { optional: true });
      const defectCode = v.string('defectCode', { optional: true });
      const inspectionId = v.string('inspectionId', { optional: true });
      const quantity = v.number('quantity', { min: 0, optional: true });
      const uom = v.string('uom', { optional: true });
      const dueDate = v.isoDate('dueDate', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const ncr = await quality.createNcr(
        tenantId,
        {
          title: title!,
          description: description!,
          severity: severity as never,
          ownerId: ownerId!,
          ownerName,
          productId,
          batchId,
          workOrderId,
          processId,
          machineId,
          operatorId,
          defectCode,
          inspectionId,
          quantity,
          uom,
          dueDate,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'ncr',
        entityId: ncr.id,
        action: 'NCR_CREATE',
        newValue: { ncrNumber: ncr.ncrNumber, severity: ncr.severity, ownerId: ncr.ownerId },
        ip: req.ip,
      });

      res.status(201).json(ncr);
    })
  );

  router.patch(
    '/quality/ncr/:id',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const status = v.string('status', { optional: true });
      const rootCause = v.string('rootCause', { optional: true, max: 4000 });
      const ownerId = v.string('ownerId', { optional: true });
      const ownerName = v.string('ownerName', { optional: true });
      const dueDate = v.isoDate('dueDate', { optional: true });
      const severity = v.string('severity', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const ncr = await quality.updateNcr(
        tenantId,
        req.params.id,
        {
          status: status as NcrStatus | undefined,
          rootCause,
          ownerId,
          ownerName,
          dueDate,
          severity: severity as never,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'ncr',
        entityId: ncr.id,
        action: 'NCR_UPDATE',
        newValue: { status: ncr.status, rootCause: ncr.rootCause, ownerId: ncr.ownerId },
        ip: req.ip,
      });

      res.json(ncr);
    })
  );

  router.post(
    '/quality/ncr/:id/actions',
    route(async (req, res) => {
      const v = validate(req.body);
      const action = v.string('action', { min: 3, max: 2000 });
      const ownerId = v.string('ownerId');
      const ownerName = v.string('ownerName', { optional: true });
      const dueDate = v.isoDate('dueDate', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      v.done();

      res.status(201).json(
        await quality.addCorrectiveAction(req.context!.tenantId, req.params.id, {
          action: action!,
          ownerId: ownerId!,
          ownerName,
          dueDate,
          notes,
        })
      );
    })
  );

  router.patch(
    '/quality/ncr/actions/:id',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const status = v.string('status', { optional: true });
      const evidence = v.string('evidence', { optional: true, max: 2000 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      await quality.updateCorrectiveAction(
        tenantId,
        req.params.id,
        { status: status as never, evidence },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'corrective_action',
        entityId: req.params.id,
        action: 'CORRECTIVE_ACTION_UPDATE',
        newValue: { status, evidence },
        ip: req.ip,
      });

      res.json({ success: true });
    })
  );

  // --- Dashboard (§22.2) --------------------------------------------

  router.get(
    '/quality/dashboard',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(await quality.dashboard(req.context!.tenantId, { from: q.from, to: q.to }));
    })
  );

  return router;
}
