import { Router } from 'express';
import type { ConsumptionStatus } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { ApiError } from '../platform/http/api-error.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { MaterialService } from '../modules/material/material.service.js';
import type { MrpService } from '../modules/material/mrp.service.js';
import type { PlanningFacade } from '../modules/planning/public/index.js';

/**
 * Material, readiness, consumption and MRP (Improvement PRD §3, §21).
 *
 * The audited writes are the ones §39 names: stock adjustment, consumption and
 * MRP configuration. Reads carry no audit entry — an audit trail that records
 * who looked at a stock figure is a trail nobody can search.
 */
export function materialRoutes(
  material: MaterialService,
  mrp: MrpService,
  planning: PlanningFacade,
  audit: AuditService
): Router {
  const router = Router();

  const actorOf = (req: { principal?: { subjectId: string; name: string } }) => ({
    id: req.principal?.subjectId ?? 'system',
    name: req.principal?.name ?? 'System',
  });

  // --- Warehouses ---------------------------------------------------

  router.get(
    '/materials/warehouses',
    route(async (req, res) => res.json(await material.listWarehouses(req.context!.tenantId)))
  );

  router.post(
    '/materials/warehouses',
    route(async (req, res) => {
      const v = validate(req.body);
      const code = v.string('code', { min: 2, max: 64 });
      const name = v.string('name', { min: 2, max: 255 });
      const plantId = v.string('plantId', { optional: true });
      const warehouseType = v.string('warehouseType', { optional: true });
      v.done();

      res.status(201).json(
        await material.createWarehouse(req.context!.tenantId, {
          code: code!,
          name: name!,
          plantId,
          warehouseType,
        })
      );
    })
  );

  // --- Inventory ----------------------------------------------------

  router.get(
    '/materials/inventory',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await material.listInventory(req.context!.tenantId, {
          materialId: q.materialId,
          warehouseId: q.warehouseId,
          belowReorder: q.belowReorder === 'true',
          search: q.search,
        })
      );
    })
  );

  /** §39 — every stock adjustment is audited. */
  router.post(
    '/materials/inventory/adjust',
    route(async (req, res) => {
      const v = validate(req.body);
      const materialId = v.string('materialId');
      const warehouseId = v.string('warehouseId', { optional: true });
      const onHandQuantity = v.number('onHandQuantity', { min: 0 });
      const uom = v.string('uom', { optional: true });
      const reorderPoint = v.number('reorderPoint', { min: 0, optional: true });
      const safetyStock = v.number('safetyStock', { min: 0, optional: true });
      const reason = v.string('reason', { min: 3, max: 500 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const before = (
        await material.listInventory(tenantId, { materialId: materialId!, warehouseId })
      )[0];

      const updated = await material.adjustInventory(tenantId, {
        materialId: materialId!,
        warehouseId,
        onHandQuantity: onHandQuantity!,
        uom,
        reorderPoint,
        safetyStock,
        reason: reason!,
        actorId: actor.id,
        actorName: actor.name,
      });

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'material_inventory',
        entityId: updated.id,
        action: 'MATERIAL_ADJUSTMENT',
        previousValue: before ? { onHandQuantity: before.onHandQuantity } : undefined,
        newValue: { onHandQuantity: updated.onHandQuantity, reason },
        ip: req.ip,
      });

      res.json(updated);
    })
  );

  router.post(
    '/materials/inventory/receive',
    route(async (req, res) => {
      const v = validate(req.body);
      const materialId = v.string('materialId');
      const warehouseId = v.string('warehouseId', { optional: true });
      const quantity = v.number('quantity', { min: 0.0001 });
      const uom = v.string('uom', { optional: true });
      const reference = v.string('reference', { optional: true });
      v.done();

      const actor = actorOf(req);
      res.status(201).json(
        await material.receiveMaterial(req.context!.tenantId, {
          materialId: materialId!,
          warehouseId,
          quantity: quantity!,
          uom,
          reference,
          actorId: actor.id,
          actorName: actor.name,
        })
      );
    })
  );

  /** Books supply that has not landed yet, so MRP can count it (§3.2). */
  router.post(
    '/materials/inventory/incoming',
    route(async (req, res) => {
      const v = validate(req.body);
      const materialId = v.string('materialId');
      const warehouseId = v.string('warehouseId', { optional: true });
      const quantity = v.number('quantity', { min: 0.0001 });
      const uom = v.string('uom', { optional: true });
      const reference = v.string('reference', { optional: true });
      v.done();

      const actor = actorOf(req);
      res.status(201).json(
        await material.recordIncoming(req.context!.tenantId, {
          materialId: materialId!,
          warehouseId,
          quantity: quantity!,
          uom,
          reference,
          actorId: actor.id,
          actorName: actor.name,
        })
      );
    })
  );

  router.get(
    '/materials/transactions',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await material.listTransactions(req.context!.tenantId, {
          materialId: q.materialId,
          referenceId: q.referenceId,
          from: q.from,
          to: q.to,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  // --- Readiness (US-M001) ------------------------------------------

  router.get(
    '/materials/requirements',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await material.storedRequirements(req.context!.tenantId, {
          sourceType: q.sourceType,
          sourceId: q.sourceId,
          status: q.status,
        })
      );
    })
  );

  router.post(
    '/materials/availability/work-order/:id',
    route(async (req, res) => {
      res.json(await material.checkWorkOrder(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/materials/availability/production-plan/:id',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const demand = await planning.planDemandLines(tenantId, { planIds: [req.params.id] });
      if (demand.length === 0) {
        throw ApiError.notFound('Production Plan tidak ditemukan atau belum memiliki line.');
      }
      res.json(await material.checkProductionPlan(tenantId, req.params.id, demand));
    })
  );

  /**
   * Readiness across every plan in the horizon — the Material Readiness screen.
   *
   * Recomputed rather than read from the stored requirements: a PPIC opening
   * this screen is asking about stock now, not stock at the last check.
   */
  router.get(
    '/materials/readiness',
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      const q = req.query as Record<string, string | undefined>;
      const demand = await planning.planDemandLines(tenantId, {
        horizonStart: q.from,
        horizonEnd: q.to,
      });

      const byPlan = new Map<string, typeof demand>();
      for (const line of demand) {
        const list = byPlan.get(line.productionPlanId) ?? [];
        list.push(line);
        byPlan.set(line.productionPlanId, list);
      }

      const readiness = [];
      for (const [planId, lines] of byPlan) {
        readiness.push(await material.checkProductionPlan(tenantId, planId, lines));
      }
      res.json(readiness);
    })
  );

  // --- Reservation --------------------------------------------------

  router.get(
    '/materials/reservations',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await material.listReservations(req.context!.tenantId, {
          workOrderId: q.workOrderId,
          materialId: q.materialId,
          status: q.status,
        })
      );
    })
  );

  router.post(
    '/materials/reservations/work-order/:id',
    route(async (req, res) => {
      res.status(201).json(await material.reserveForWorkOrder(req.context!.tenantId, req.params.id, actorOf(req)));
    })
  );

  router.delete(
    '/materials/reservations/:id',
    route(async (req, res) => {
      await material.releaseReservation(req.context!.tenantId, req.params.id, actorOf(req));
      res.json({ success: true, message: 'Reservasi material dilepas.' });
    })
  );

  // --- Consumption (US-M003) ----------------------------------------

  router.get(
    '/materials/consumption',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await material.listConsumption(req.context!.tenantId, {
          workOrderId: q.workOrderId,
          materialId: q.materialId,
          status: q.status as ConsumptionStatus | undefined,
          from: q.from,
          to: q.to,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/materials/consumption',
    route(async (req, res) => {
      const v = validate(req.body);
      const workOrderId = v.string('workOrderId');
      const materialId = v.string('materialId');
      const actualQuantity = v.number('actualQuantity', { min: 0.0001 });
      const plannedQuantity = v.number('plannedQuantity', { min: 0, optional: true });
      const warehouseId = v.string('warehouseId', { optional: true });
      const batchId = v.string('batchId', { optional: true });
      const processId = v.string('processId', { optional: true });
      const machineId = v.string('machineId', { optional: true });
      const operatorId = v.string('operatorId', { optional: true });
      const consumptionType = v.string('consumptionType', { optional: true });
      const uom = v.string('uom', { optional: true });
      const notes = v.string('notes', { optional: true, max: 500 });
      const idempotencyKey = v.string('idempotencyKey', { optional: true });
      const allowOverride = v.boolean('allowOverride', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);

      // BR-M04 — the override exists, and only an authorized principal has it.
      if (allowOverride && !req.principal?.permissions.includes('material:adjust')) {
        throw ApiError.forbidden('Override konsumsi melebihi stok memerlukan izin material:adjust.');
      }

      const record = await material.recordConsumption(
        tenantId,
        {
          workOrderId: workOrderId!,
          materialId: materialId!,
          actualQuantity: actualQuantity!,
          plannedQuantity,
          warehouseId,
          batchId,
          processId,
          machineId,
          operatorId,
          consumptionType: consumptionType as never,
          uom,
          notes,
          idempotencyKey,
          allowOverride,
        },
        { ...actor, type: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER' }
      );

      await audit.record({
        tenantId,
        actorType: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER',
        actorId: actor.id,
        entityType: 'material_consumption',
        entityId: record.id,
        action: 'MATERIAL_CONSUMPTION',
        newValue: {
          workOrderId: record.workOrderId,
          materialId: record.materialId,
          actualQuantity: record.actualQuantity,
          varianceQuantity: record.varianceQuantity,
          override: allowOverride ?? false,
        },
        ip: req.ip,
      });

      res.status(201).json(record);
    })
  );

  router.get(
    '/materials/consumption/variance/:workOrderId',
    route(async (req, res) => {
      res.json(await material.consumptionVariance(req.context!.tenantId, req.params.workOrderId));
    })
  );

  // --- MRP (US-M002) ------------------------------------------------

  router.get(
    '/mrp/runs',
    route(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json(await mrp.listRuns(req.context!.tenantId, limit));
    })
  );

  router.get(
    '/mrp/runs/latest',
    route(async (req, res) => {
      const latest = await mrp.latest(req.context!.tenantId);
      if (!latest) {
        res.json({ run: null, results: [] });
        return;
      }
      res.json(latest);
    })
  );

  router.get(
    '/mrp/runs/:id',
    route(async (req, res) => {
      const run = await mrp.getRun(req.context!.tenantId, req.params.id);
      if (!run) throw ApiError.notFound('MRP run tidak ditemukan.');
      res.json(run);
    })
  );

  router.post(
    '/mrp/run',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const horizonStart = v.isoDate('horizonStart', { optional: true });
      const horizonEnd = v.isoDate('horizonEnd', { optional: true });
      const planIds = v.stringArray('planIds', { optional: true });
      const notes = v.string('notes', { optional: true, max: 500 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const outcome = await mrp.run(tenantId, { horizonStart, horizonEnd, planIds, notes }, actor);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'mrp_run',
        entityId: outcome.run.id,
        action: 'MRP_RUN',
        newValue: {
          runNumber: outcome.run.runNumber,
          horizonStart: outcome.run.horizonStart,
          horizonEnd: outcome.run.horizonEnd,
          shortageMaterials: outcome.run.shortageMaterials,
        },
        ip: req.ip,
      });

      res.status(201).json(outcome);
    })
  );

  return router;
}
