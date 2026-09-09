import { Router } from 'express';
import type { EventEntityType, OperationalEventType } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import type { EventService } from '../modules/event/event.service.js';

/**
 * Event History (Improvement PRD §10, US-E001).
 *
 * Read-only by design: events are written by the modules that cause them, and
 * BR-E02 says no normal application user may change one. There is deliberately
 * no POST here — an endpoint that let the console append to the timeline would
 * make the timeline evidence of nothing.
 */
export function eventRoutes(events: EventService): Router {
  const router = Router();

  router.get(
    '/events',
    route(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      res.json(
        await events.list(req.context!.tenantId, {
          entityType: q.entityType as EventEntityType | undefined,
          entityId: q.entityId,
          eventType: q.eventType as OperationalEventType | undefined,
          workOrderId: q.workOrderId,
          machineId: q.machineId,
          batchId: q.batchId,
          from: q.from,
          to: q.to,
          limit: q.limit ? Number(q.limit) : undefined,
          offset: q.offset ? Number(q.offset) : undefined,
        })
      );
    })
  );

  /** Chronological timeline of one entity, oldest first (§10.3). */
  router.get(
    '/events/timeline/:entityType/:entityId',
    route(async (req, res) => {
      const entityType = req.params.entityType.toUpperCase() as EventEntityType;
      res.json(await events.timeline(req.context!.tenantId, entityType, req.params.entityId));
    })
  );

  router.get(
    '/events/summary',
    route(async (req, res) => {
      const days = Number(req.query.days ?? 7);
      res.json(await events.summary(req.context!.tenantId, Number.isFinite(days) ? days : 7));
    })
  );

  return router;
}
