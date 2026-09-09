import { Router } from 'express';
import type { BoardItemStatus, BoardViewMode, DispatchAction } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { ApiError } from '../platform/http/api-error.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { ProductionBoardService } from '../modules/board/production-board.service.js';

/**
 * Visual Production Board (Improvement PRD §9, §23, US-PB001..005).
 *
 * One read endpoint and one write endpoint. The write is a single `dispatch`
 * action rather than five verbs because §9.6 lists five things a dispatcher
 * may do and §39 requires all of them audited the same way — one shape, one
 * audit entry, one place to add the sixth.
 */
export function productionBoardRoutes(
  board: ProductionBoardService,
  audit: AuditService
): Router {
  const router = Router();

  router.get(
    '/production-board',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await board.build(req.context!.tenantId, {
          viewMode: q.viewMode as BoardViewMode | undefined,
          date: q.date,
          days: q.days ? Number(q.days) : undefined,
          plantId: q.plantId,
          lineId: q.lineId,
          workCenterId: q.workCenterId,
          machineId: q.machineId,
          processId: q.processId,
          productId: q.productId,
          shiftId: q.shiftId,
          status: q.status as BoardItemStatus | undefined,
          priority: q.priority ? Number(q.priority) : undefined,
        })
      );
    })
  );

  router.post(
    '/production-board/dispatch',
    route(async (req, res) => {
      const v = validate(req.body);
      const action = v.string('action');
      const workOrderId = v.string('workOrderId');
      const plannedStart = v.string('plannedStart', { optional: true });
      const plannedEnd = v.string('plannedEnd', { optional: true });
      const machineId = v.string('machineId', { optional: true });
      const operatorIds = v.stringArray('operatorIds', { optional: true });
      const sequence = v.number('sequence', { min: 0, integer: true, optional: true });
      const priority = v.number('priority', { min: 0, max: 100, integer: true, optional: true });
      const reason = v.string('reason', { optional: true, max: 500 });
      v.done();

      const tenantId = req.context!.tenantId;
      const actor = {
        id: req.principal?.subjectId ?? 'system',
        name: req.principal?.name ?? 'System',
      };

      // The three narrower rights from §34, checked where the action is known.
      // The route table can only see the path, and the path is the same for
      // all six actions.
      const needed =
        action === 'REASSIGN_MACHINE' || action === 'REASSIGN_OPERATOR'
          ? 'production_board:assign'
          : action === 'CONFIRM' || action === 'CANCEL'
            ? 'production_board:dispatch'
            : 'production_board:reschedule';
      if (req.principal && !req.principal.permissions.includes(needed)) {
        throw ApiError.forbidden(`Aksi ${action} memerlukan izin ${needed}.`);
      }

      const workOrder = await board.dispatch(
        tenantId,
        {
          action: action as DispatchAction['action'],
          workOrderId: workOrderId!,
          plannedStart,
          plannedEnd,
          machineId,
          operatorIds,
          sequence,
          priority,
          reason,
        },
        actor
      );

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        entityType: 'work_order',
        entityId: workOrderId!,
        action: `BOARD_${action}`,
        newValue: {
          plannedStart: workOrder.plannedStart,
          plannedEnd: workOrder.plannedEnd,
          machineId: workOrder.machineId,
          priority: workOrder.priority,
          sequence: workOrder.sequence,
          reason,
        },
        ip: req.ip,
      });

      res.json(workOrder);
    })
  );

  return router;
}
