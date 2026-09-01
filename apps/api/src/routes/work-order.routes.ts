import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { ApiError } from '../platform/http/api-error.js';
import { ProcessChainService } from '../modules/production/process-chain.service.js';
import { PlanningFacade } from '../modules/planning/public/index.js';

/**
 * The v1.0 Work Order reads that cross a module boundary.
 *
 * `/chain` is production's own (MES-018-3). `/demand` is the read-only customer
 * view: a Work Order stores **no** customer, order or allocation (ADR-22), so
 * the answer is derived through planning's facade every time it is asked — which
 * is precisely why there is no column to go stale.
 */
export function workOrderRoutes(chains: ProcessChainService, planning: PlanningFacade): Router {
  const router = Router();

  router.get(
    '/work-orders/:id/chain',
    route(async (req, res) => {
      res.json(await chains.getChain(req.context!.tenantId, req.params.id));
    })
  );

  router.get(
    '/work-orders/:id/available-quantity',
    route(async (req, res) => {
      const chain = await chains.getChain(req.context!.tenantId, req.params.id);
      res.json({
        workOrderId: chain.workOrder.workOrderId,
        availableQuantity: chain.availableQuantity,
        // The formula's own inputs travel with the number (§18.3): a
        // recommendation a planner cannot check is a recommendation they will
        // not trust.
        inputs: {
          predecessorTransferred: chain.predecessors.length
            ? chain.predecessors[chain.predecessors.length - 1].transferredQuantity
            : 0,
          ownInput: chain.workOrder.inputQuantity,
        },
        isFirstProcess: chain.isFirstProcess,
      });
    })
  );

  router.get(
    '/work-orders/:id/demand',
    route(async (req, res) => {
      const demand = await planning.workOrderDemand(req.context!.tenantId, req.params.id);
      if (!demand) {
        throw ApiError.notFound(
          'Work Order tidak terhubung ke Production Plan Line, sehingga demand customer tidak dapat ditelusuri.'
        );
      }
      res.json(demand);
    })
  );

  return router;
}
