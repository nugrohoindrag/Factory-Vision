/**
 * The planning module's public surface (MES-019).
 *
 * **This file is the only thing another module may import from `planning`.**
 * `scripts/check-module-boundaries.mjs` fails the lint step on any import that
 * reaches past it, and on any import of `production` from inside `planning`.
 *
 * The direction is deliberate and one-way: production may ask planning what a
 * work order is for; planning must never reach into execution. That is what
 * lets planning be tested without a shop floor, and what stops the pair from
 * becoming one module with two names.
 */

export { planningRoutes } from '../api/index.js';
export { PlanningFacade } from './planning.facade.js';
export type { PlanLineDemandView, WorkOrderDemandView } from './planning.facade.js';
export {
  PLANNING_EVENTS,
  planningEvent,
  type PlanningEvent,
  type PlanningEventType,
  type CapacityGapDetectedPayload,
  type ProductionPlanConfirmedPayload,
  type WorkOrdersGeneratedPayload,
} from '../domain/planning.events.js';
