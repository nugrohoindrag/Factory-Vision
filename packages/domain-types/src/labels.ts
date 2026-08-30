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
  DowntimeCategory,
  MachineState,
  ProductionBatchStatus,
  ProductionOrderStatus,
  RejectCategory,
  UserRole,
  WorkOrderStatus,
} from './enums.js';

/** Work Order status, per the standard's status vocabulary. */
export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  [WorkOrderStatus.DRAFT]: 'Draft',
  [WorkOrderStatus.SCHEDULED]: 'Scheduled',
  [WorkOrderStatus.RELEASED]: 'Released',
  [WorkOrderStatus.IN_PROGRESS]: 'In Progress',
  [WorkOrderStatus.PAUSED]: 'Paused',
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
  [ProductionBatchStatus.ACTIVE]: 'Active',
  [ProductionBatchStatus.COMPLETED]: 'Completed',
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

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.EXECUTIVE]: 'Executive',
  [UserRole.PRODUCTION_MANAGER]: 'Production Manager',
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.OPERATOR]: 'Operator',
  [UserRole.PPIC]: 'PPIC',
  [UserRole.QUALITY]: 'Quality',
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
