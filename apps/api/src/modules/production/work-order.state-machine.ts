import { WorkOrderStatus } from '@factory-vision/domain-types';

/**
 * Valid Work Order State Transitions (PRD v1.1 & Tech Arch)
 */
const LEGAL_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  [WorkOrderStatus.DRAFT]: [WorkOrderStatus.SCHEDULED, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.SCHEDULED]: [WorkOrderStatus.RELEASED, WorkOrderStatus.DRAFT, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.RELEASED]: [
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.PAUSED,
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.IN_PROGRESS]: [WorkOrderStatus.PAUSED, WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.PAUSED]: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.COMPLETED]: [],
  [WorkOrderStatus.CANCELLED]: [],
};

export class WorkOrderStateMachine {
  static canTransition(current: WorkOrderStatus, next: WorkOrderStatus): boolean {
    const allowed = LEGAL_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  static validateTransition(current: WorkOrderStatus, next: WorkOrderStatus): void {
    if (!this.canTransition(current, next)) {
      throw new Error(`Invalid state transition: Cannot move Work Order from '${current}' to '${next}'`);
    }
  }
}
