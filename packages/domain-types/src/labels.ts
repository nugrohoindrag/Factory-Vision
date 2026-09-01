/**
 * Official display labels.
 *
 * The naming standard fixes one word per concept and forbids synonyms, so the
 * words a user reads cannot be chosen at each call site. Every screen in both
 * apps renders a status through this module, which is what makes "In Progress"
 * read the same on the Work Order table, the live board and the operator
 * terminal instead of drifting into "Running", "Active" or "Berjalan".
 *
 * Enum values stay SCREAMING_SNAKE on the wire and in the database; only the
 * presentation form lives here.
 */

import {
  CapacityPlanStatus,
  CapacityStatus,
  CustomerOrderStatus,
  DemandForecastStatus,
  DowntimeCategory,
  MachineState,
  OrderChannel,
  ProductionBatchStatus,
  ProductionOrderStatus,
  ProductionPlanStatus,
  RejectCategory,
  UserRole,
  WorkOrderStatus,
} from './enums.js';

/** Work Order status, per the standard's status vocabulary. */
export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  [WorkOrderStatus.DRAFT]: 'Draft',
  [WorkOrderStatus.SCHEDULED]: 'Scheduled',
  [WorkOrderStatus.CONFIRMED]: 'Confirmed',
  [WorkOrderStatus.IN_PRODUCTION]: 'In Production',
  [WorkOrderStatus.COMPLETED]: 'Completed',
  [WorkOrderStatus.CANCELLED]: 'Cancelled',
};

/** Production Order status. */
export const PRODUCTION_ORDER_STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  [ProductionOrderStatus.DRAFT]: 'Draft',
  [ProductionOrderStatus.PLANNED]: 'Planned',
  [ProductionOrderStatus.RELEASED]: 'Released',
  [ProductionOrderStatus.IN_PRODUCTION]: 'In Progress',
  [ProductionOrderStatus.COMPLETED]: 'Completed',
  [ProductionOrderStatus.CANCELLED]: 'Cancelled',
};

/** Machine status. */
export const MACHINE_STATE_LABEL: Record<MachineState, string> = {
  [MachineState.RUNNING]: 'Running',
  [MachineState.IDLE]: 'Idle',
  [MachineState.DOWNTIME]: 'Downtime',
  [MachineState.SETUP]: 'Setup',
  [MachineState.OFFLINE]: 'Offline',
};

export const PRODUCTION_BATCH_STATUS_LABEL: Record<ProductionBatchStatus, string> = {
  [ProductionBatchStatus.PLANNED]: 'Planned',
  [ProductionBatchStatus.IN_PRODUCTION]: 'In Production',
  [ProductionBatchStatus.COMPLETED]: 'Completed',
  [ProductionBatchStatus.CANCELLED]: 'Cancelled',
  // Legacy aliases
  [ProductionBatchStatus.ACTIVE]: 'Active',
  [ProductionBatchStatus.HOLD]: 'Hold',
  [ProductionBatchStatus.SCRAPPED]: 'Scrapped',
};

/** Downtime Reason category. */
export const DOWNTIME_CATEGORY_LABEL: Record<DowntimeCategory, string> = {
  [DowntimeCategory.MACHINE]: 'Machine',
  [DowntimeCategory.MATERIAL]: 'Material',
  [DowntimeCategory.PROCESS]: 'Process',
  [DowntimeCategory.QUALITY]: 'Quality',
  [DowntimeCategory.PEOPLE]: 'People',
  [DowntimeCategory.PLANNING]: 'Planning',
};

/** Reject Reason category. */
export const REJECT_CATEGORY_LABEL: Record<RejectCategory, string> = {
  [RejectCategory.DIMENSION]: 'Dimension',
  [RejectCategory.APPEARANCE]: 'Appearance',
  [RejectCategory.MATERIAL]: 'Material',
  [RejectCategory.ASSEMBLY]: 'Assembly',
  [RejectCategory.FUNCTION]: 'Function',
  [RejectCategory.OTHER]: 'Other',
};

/**
 * Customer Order status (MES-026).
 *
 * The first four are derived from production facts; the last three are set by
 * hand because the MVP does not execute shipping.
 */
export const CUSTOMER_ORDER_STATUS_LABEL: Record<CustomerOrderStatus, string> = {
  [CustomerOrderStatus.RECEIVED]: 'Received',
  [CustomerOrderStatus.PLANNED]: 'Planned',
  [CustomerOrderStatus.IN_PRODUCTION]: 'In Production',
  [CustomerOrderStatus.PRODUCED]: 'Produced',
  [CustomerOrderStatus.READY_TO_SHIP]: 'Ready to Ship',
  [CustomerOrderStatus.SHIPPED]: 'Shipped',
  [CustomerOrderStatus.COMPLETED]: 'Completed',
  [CustomerOrderStatus.CANCELLED]: 'Cancelled',
};

/** Where an order came from. Mandatory on every order, so it is never blank. */
export const ORDER_CHANNEL_LABEL: Record<OrderChannel, string> = {
  [OrderChannel.KANBAN_CARD]: 'Kartu Kanban',
  [OrderChannel.EMAIL]: 'Email',
  [OrderChannel.INVOICE]: 'Invoice',
  [OrderChannel.PO_DOCUMENT]: 'Dokumen PO',
  [OrderChannel.MANUAL]: 'Input Manual',
};

export const PRODUCTION_PLAN_STATUS_LABEL: Record<ProductionPlanStatus, string> = {
  [ProductionPlanStatus.DRAFT]: 'Draft',
  [ProductionPlanStatus.PLANNING]: 'Planning',
  [ProductionPlanStatus.READY]: 'Ready',
  [ProductionPlanStatus.CONFIRMED]: 'Confirmed',
  [ProductionPlanStatus.IN_EXECUTION]: 'In Execution',
  [ProductionPlanStatus.COMPLETED]: 'Completed',
  [ProductionPlanStatus.CANCELLED]: 'Cancelled',
};

/**
 * Capacity status (S45.6). Determined by the system from demand against
 * capacity; there is no screen on which a user types one.
 */
export const CAPACITY_STATUS_LABEL: Record<CapacityStatus, string> = {
  [CapacityStatus.WITHIN_PLAN]: 'Within Plan',
  [CapacityStatus.ADDITIONAL_DEMAND]: 'Additional Demand',
  [CapacityStatus.CAPACITY_UP_REQUIRED]: 'Capacity Up Required',
};

/** What each capacity status means, for the badge's tooltip. */
export const CAPACITY_STATUS_DESCRIPTION: Record<CapacityStatus, string> = {
  [CapacityStatus.WITHIN_PLAN]: 'Demand masih di dalam Planning Capacity.',
  [CapacityStatus.ADDITIONAL_DEMAND]:
    'Demand melewati Planning Capacity tetapi masih tertampung Capacity Buffer.',
  [CapacityStatus.CAPACITY_UP_REQUIRED]:
    'Demand melebihi Total Capacity; ada gap yang membutuhkan keputusan Capacity Up.',
};

export const DEMAND_FORECAST_STATUS_LABEL: Record<DemandForecastStatus, string> = {
  [DemandForecastStatus.DRAFT]: 'Draft',
  [DemandForecastStatus.GENERATED]: 'Generated',
  [DemandForecastStatus.SUPERSEDED]: 'Superseded',
};

export const CAPACITY_PLAN_STATUS_LABEL: Record<CapacityPlanStatus, string> = {
  [CapacityPlanStatus.DRAFT]: 'Draft',
  [CapacityPlanStatus.COMPUTED]: 'Computed',
  [CapacityPlanStatus.SUPERSEDED]: 'Superseded',
};

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.EXECUTIVE]: 'Executive',
  [UserRole.PRODUCTION_MANAGER]: 'Production Manager',
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.OPERATOR]: 'Operator',
  [UserRole.PPIC]: 'PPIC',
  [UserRole.QUALITY]: 'Quality',
  [UserRole.SALES]: 'Sales',
  [UserRole.ADMIN]: 'Admin',
};

/**
 * Resolves any status value to its official label, falling back to a readable
 * form so an unmapped value never reaches the screen as SCREAMING_SNAKE.
 */
export function statusLabel(value: string | undefined | null): string {
  if (!value) return '-';
  const maps: Array<Record<string, string>> = [
    WORK_ORDER_STATUS_LABEL,
    PRODUCTION_ORDER_STATUS_LABEL,
    MACHINE_STATE_LABEL,
    PRODUCTION_BATCH_STATUS_LABEL,
    // Planning statuses come after execution: WorkOrderStatus and
    // CustomerOrderStatus share IN_PRODUCTION, COMPLETED and CANCELLED, and
    // both render identically, so the collision is harmless in either order.
    CUSTOMER_ORDER_STATUS_LABEL,
    PRODUCTION_PLAN_STATUS_LABEL,
    CAPACITY_STATUS_LABEL,
  ];
  for (const map of maps) {
    if (value in map) return map[value];
  }
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
