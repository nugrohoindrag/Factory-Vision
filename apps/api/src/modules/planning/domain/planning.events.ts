/**
 * The events planning publishes (MES-019-2, MES-020-2).
 *
 * Planning never calls production, quality or shop floor directly — that is the
 * boundary MES-019 exists to enforce, and a direct call would make the two
 * modules impossible to test or deploy apart. It writes an `outbox_event` row
 * inside the transaction that changed the data, and whoever cares reads it.
 *
 * The payloads are deliberately thin: an id and the few figures a consumer
 * needs to decide whether to look further. Anything richer would be planning's
 * internal model leaking through the boundary it just declared.
 */

export const PLANNING_EVENTS = {
  CUSTOMER_ORDER_RECEIVED: 'CustomerOrderReceived',
  CUSTOMER_ORDER_CANCELLED: 'CustomerOrderCancelled',
  CUSTOMER_ORDER_STATUS_CHANGED: 'CustomerOrderStatusChanged',
  DEMAND_FORECAST_GENERATED: 'DemandForecastGenerated',
  CAPACITY_GAP_DETECTED: 'CapacityGapDetected',
  PRODUCTION_PLAN_CONFIRMED: 'ProductionPlanConfirmed',
  PRODUCTION_PLAN_CANCELLED: 'ProductionPlanCancelled',
  WORK_ORDERS_GENERATED: 'WorkOrdersGenerated',
} as const;

export type PlanningEventType = (typeof PLANNING_EVENTS)[keyof typeof PLANNING_EVENTS];

export type PlanningAggregate =
  | 'customer_order'
  | 'demand_forecast'
  | 'capacity_plan'
  | 'production_plan';

export interface PlanningEvent<T = Record<string, unknown>> {
  type: PlanningEventType;
  aggregateType: PlanningAggregate;
  aggregateId: string;
  payload: T;
}

export interface CustomerOrderReceivedPayload {
  orderNumber: string;
  customerId: string;
  orderChannel: string;
  requestedDeliveryDate: string;
  lineCount: number;
}

export interface CustomerOrderStatusChangedPayload {
  orderNumber: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
}

export interface DemandForecastGeneratedPayload {
  forecastNumber: string;
  periodStart: string;
  periodEnd: string;
  lookbackMonths: number;
  lineCount: number;
  insufficientHistoryCount: number;
  supersededForecastId?: string;
}

export interface CapacityGapDetectedPayload {
  capacityPlanId: string;
  productId?: string;
  demandQuantity: number;
  totalCapacity: number;
  capacityGap: number;
  capacityStatus: string;
}

export interface ProductionPlanConfirmedPayload {
  planNumber: string;
  periodStart: string;
  periodEnd: string;
  confirmedBy: string;
  /** Customer orders this plan commits to, so demand can move to `Planned`. */
  customerOrderIds: string[];
  plannedQuantityTotal: number;
}

export interface WorkOrdersGeneratedPayload {
  planNumber: string;
  productionPlanLineId: string;
  createdWorkOrderIds: string[];
  /** Work orders that already existed; a regenerate produces no duplicates. */
  existingWorkOrderIds: string[];
}

export function planningEvent<T extends Record<string, unknown>>(
  type: PlanningEventType,
  aggregateType: PlanningAggregate,
  aggregateId: string,
  payload: T
): PlanningEvent<T> {
  return { type, aggregateType, aggregateId, payload };
}
