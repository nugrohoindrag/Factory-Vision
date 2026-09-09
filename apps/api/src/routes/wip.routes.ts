import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { WipService } from '../modules/wip/wip.service.js';

/**
 * WIP and process handoff (Improvement PRD §7, §8, §21).
 *
 * §39 audits WIP correction and transfer correction; a receipt with a variance
 * is exactly that, so every receipt is audited with the reason it carries.
 */
export function wipRoutes(wip: WipService, audit: AuditService): Router {
  const router = Router();

  const actorOf = (req: { principal?: { subjectId: string; name: string; kind?: string } }) => ({
    id: req.principal?.subjectId ?? 'system',
    name: req.principal?.name ?? 'System',
    type: (req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER') as 'OPERATOR' | 'USER',
  });

  // --- WIP records (US-WIP001, US-WIP004) ---------------------------

  router.get(
    '/wip/records',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await wip.listWip(req.context!.tenantId, {
          workOrderId: q.workOrderId,
          status: q.status,
          openOnly: q.openOnly !== 'false',
          destinationProcessId: q.destinationProcessId,
          productId: q.productId,
          agingOnly: q.agingOnly === 'true',
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/wip/records',
    route(async (req, res) => {
      const v = validate(req.body);
      const workOrderId = v.string('workOrderId');
      const quantity = v.number('quantity', { min: 0.0001 });
      const productId = v.string('productId', { optional: true });
      const batchId = v.string('batchId', { optional: true });
      const sourceProcessId = v.string('sourceProcessId', { optional: true });
      const destinationProcessId = v.string('destinationProcessId', { optional: true });
      const uom = v.string('uom', { optional: true });
      const locationId = v.string('locationId', { optional: true });
      const locationName = v.string('locationName', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      v.done();

      res.status(201).json(
        await wip.createWip(
          req.context!.tenantId,
          {
            workOrderId: workOrderId!,
            quantity: quantity!,
            productId,
            batchId,
            sourceProcessId,
            destinationProcessId,
            uom,
            locationId,
            locationName,
            notes,
          },
          actorOf(req)
        )
      );
    })
  );

  router.get(
    '/wip/records/:id/history',
    route(async (req, res) => {
      res.json(await wip.statusHistory(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/wip/records/:id/hold',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const reason = v.string('reason', { min: 3, max: 500 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const record = await wip.holdWip(tenantId, req.params.id, { reason: reason! }, actor);

      await audit.record({
        tenantId,
        actorType: actor.type,
        actorId: actor.id,
        entityType: 'wip_record',
        entityId: record.id,
        action: 'WIP_HOLD',
        newValue: { reason, quantity: record.quantity },
        ip: req.ip,
      });

      res.json(record);
    })
  );

  router.post(
    '/wip/records/:id/release',
    route(async (req, res) => {
      const v = validate(req.body ?? {});
      const reason = v.string('reason', { min: 3, max: 500 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const record = await wip.releaseWip(tenantId, req.params.id, { reason: reason! }, actor);

      await audit.record({
        tenantId,
        actorType: actor.type,
        actorId: actor.id,
        entityType: 'wip_record',
        entityId: record.id,
        action: 'WIP_RELEASE',
        newValue: { reason },
        ip: req.ip,
      });

      res.json(record);
    })
  );

  // --- Transfers (US-WIP002) ----------------------------------------

  router.get(
    '/wip/transfers',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await wip.listTransfers(req.context!.tenantId, {
          wipId: q.wipId,
          sourceWorkOrderId: q.sourceWorkOrderId,
          destinationWorkOrderId: q.destinationWorkOrderId,
          status: q.status,
          limit: q.limit ? Number(q.limit) : undefined,
        })
      );
    })
  );

  router.post(
    '/wip/transfers',
    route(async (req, res) => {
      const v = validate(req.body);
      const wipId = v.string('wipId');
      const quantity = v.number('quantity', { min: 0.0001 });
      const destinationWorkOrderId = v.string('destinationWorkOrderId', { optional: true });
      const destinationProcessId = v.string('destinationProcessId', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      const idempotencyKey = v.string('idempotencyKey', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const transfer = await wip.createTransfer(
        tenantId,
        {
          wipId: wipId!,
          quantity: quantity!,
          destinationWorkOrderId,
          destinationProcessId,
          notes,
          idempotencyKey,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: actor.type,
        actorId: actor.id,
        entityType: 'wip_transfer',
        entityId: transfer.id,
        action: 'WIP_TRANSFER',
        newValue: {
          quantity: transfer.quantity,
          sourceWorkOrderId: transfer.sourceWorkOrderId,
          destinationWorkOrderId: transfer.destinationWorkOrderId,
        },
        ip: req.ip,
      });

      res.status(201).json(transfer);
    })
  );

  // --- Receiving (US-WIP003) ----------------------------------------

  router.post(
    '/wip/transfers/:id/receive',
    route(async (req, res) => {
      const v = validate(req.body);
      const receivedQuantity = v.number('receivedQuantity', { min: 0 });
      const varianceReason = v.string('varianceReason', { optional: true, max: 500 });
      const destinationWorkOrderId = v.string('destinationWorkOrderId', { optional: true });
      const destinationProcessId = v.string('destinationProcessId', { optional: true });
      const notes = v.string('notes', { optional: true, max: 1000 });
      const idempotencyKey = v.string('idempotencyKey', { optional: true });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = actorOf(req);
      const outcome = await wip.receiveTransfer(
        tenantId,
        req.params.id,
        {
          receivedQuantity: receivedQuantity!,
          varianceReason,
          destinationWorkOrderId,
          destinationProcessId,
          notes,
          idempotencyKey,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: actor.type,
        actorId: actor.id,
        entityType: 'wip_receipt',
        entityId: outcome.receipt.id,
        action: 'WIP_RECEIVE',
        newValue: {
          transferId: req.params.id,
          receivedQuantity: outcome.receipt.receivedQuantity,
          transferredQuantity: outcome.receipt.transferredQuantity,
          varianceQuantity: outcome.receipt.varianceQuantity,
          varianceReason: outcome.receipt.varianceReason,
          result: outcome.receipt.result,
        },
        ip: req.ip,
      });

      res.status(201).json(outcome);
    })
  );

  router.get(
    '/wip/receipts',
    route(async (req, res) => {
      const transferId = typeof req.query.transferId === 'string' ? req.query.transferId : undefined;
      res.json(await wip.listReceipts(req.context!.tenantId, transferId));
    })
  );

  // --- Dashboard (§7.5) ---------------------------------------------

  router.get(
    '/wip/dashboard',
    route(async (req, res) => res.json(await wip.dashboard(req.context!.tenantId)))
  );

  return router;
}
