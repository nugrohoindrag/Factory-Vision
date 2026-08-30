/**
 * Factory Vision - MES Domain Entities & Models
 * Aligned with PRD v1.1 and Technical Architecture v1.7
 */
import {
  UserRole,
  ProductionOrderStatus,
  WorkOrderStatus,
  MachineState,
  DowntimeCategory,
  DowntimeStatus,
  RejectCategory,
  RecordSource,
  CorrectionStatus,
  CorrectionEntityType,
  OfflineCommandStatus,
} from './enums.js';
export interface Tenant {
  id: string;
  name: string;
  timezone: string;
  plan: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string;
}
export interface Plant {
  id: string;
  tenantId: string;
  name: string;
  location: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
}
export interface ProductionLine {
  id: string;
  tenantId: string;
  plantId: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  plannedProductionTimeMinutes: number;
}
export interface WorkCenter {
  id: string;
  tenantId: string;
  productionLineId: string;
  code: string;
  name: string;
  sequence: number;
}
export interface Machine {
  id: string;
  tenantId: string;
  workCenterId: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  idealCycleTimeSeconds: number;
  currentState: MachineState;
  currentStateSince: string;
}
export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  unit: string;
  idealCycleTimeSeconds: number;
  status: 'ACTIVE' | 'INACTIVE';
}
export interface ProductMachineRate {
  id: string;
  tenantId: string;
  productId: string;
  machineId: string;
  idealCycleTimeSeconds: number;
}
export interface Operator {
  id: string;
  tenantId: string;
  employeeNumber: string;
  name: string;
  pinHash?: string;
  defaultLineId?: string;
  status: 'ACTIVE' | 'INACTIVE';
}
export interface Shift {
  id: string;
  tenantId: string;
  plantId: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossesMidnight: boolean;
  active: boolean;
}
export interface DowntimeReason {
  id: string;
  tenantId: string;
  parentId?: string;
  category: DowntimeCategory;
  code: string;
  name: string;
  description?: string;
  isPlanned: boolean;
  active: boolean;
  sortOrder: number;
}
export interface RejectReason {
  id: string;
  tenantId: string;
  parentId?: string;
  category: RejectCategory;
  code: string;
  name: string;
  description?: string;
  active: boolean;
  sortOrder: number;
}
export interface ProductionOrder {
  id: string;
  tenantId: string;
  orderNumber: string;
  productId: string;
  quantity: number;
  dueDate: string;
  status: ProductionOrderStatus;
  createdBy: string;
  createdAt: string;
}
export interface WorkOrder {
  id: string;
  tenantId: string;
  productionOrderId: string;
  woNumber: string;
  productId: string;
  lineId: string;
  workCenterId?: string;
  machineId?: string;
  targetQuantity: number;
  unit: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  goodQuantity: number;
  rejectQuantity: number;
  status: WorkOrderStatus;
  priority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface WorkOrderAssignment {
  id: string;
  tenantId: string;
  workOrderId: string;
  operatorId: string;
  shiftId: string;
  assignedAt: string;
  releasedAt?: string;
}
export interface ProductionRecord {
  id: string;
  tenantId: string;
  workOrderId: string;
  machineId: string;
  operatorId: string;
  shiftId: string;
  shiftDate: string;
  goodQuantity: number;
  rejectQuantity: number;
  rejectReasonId?: string;
  recordedAt: string;
  source: RecordSource;
  clientEventId: string;
  correctionOfId?: string;
  notes?: string;
}
export interface DowntimeRecord {
  id: string;
  tenantId: string;
  workOrderId?: string;
  machineId: string;
  lineId: string;
  operatorId?: string;
  shiftId: string;
  shiftDate: string;
  reasonId: string;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
  isPlanned: boolean;
  notes?: string;
  clientEventId: string;
  status: DowntimeStatus;
}
export interface MachineStateLog {
  id: string;
  tenantId: string;
  machineId: string;
  state: MachineState;
  reasonId?: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  workOrderId?: string;
  shiftDate?: string;
}
export interface ShiftSession {
  id: string;
  tenantId: string;
  lineId: string;
  shiftId: string;
  shiftDate: string;
  startedAt: string;
  endedAt?: string;
  supervisorId: string;
  targetQuantity: number;
  handoverNotes?: string;
  status: 'ACTIVE' | 'CLOSED';
}
export interface OEEComponents {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}
export interface OEEDaily extends OEEComponents {
  tenantId: string;
  shiftDate: string;
  plantId: string;
  lineId: string;
  machineId: string;
  shiftId: string;
  productId: string;
  plannedTimeSeconds: number;
  runTimeSeconds: number;
  downtimeSeconds: number;
  goodCount: number;
  rejectCount: number;
  totalCount: number;
  computedAt: string;
}
export interface WOProgressSnapshot {
  tenantId: string;
  workOrderId: string;
  asOf: string;
  actualQuantity: number;
  targetQuantity: number;
  achievementPct: number;
  productionRatePerHour: number;
  estimatedCompletion?: string;
  isDelayed: boolean;
}
export interface AppUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE';
  lastLoginAt?: string;
}
export interface CorrectionRequest {
  id: string;
  tenantId: string;
  entityType: CorrectionEntityType;
  entityId: string;
  shiftDate: string;
  fieldChanges: Record<
    string,
    {
      from: unknown;
      to: unknown;
    }
  >;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  status: CorrectionStatus;
  appliedAt?: string;
}
export interface AuditLog {
  id: string;
  tenantId: string;
  actorType: 'USER' | 'OPERATOR' | 'SYSTEM';
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  occurredAt: string;
}
export interface OfflineCommand {
  id?: number;
  clientEventId: string;
  tenantId: string;
  workOrderId: string;
  type:
    | 'START_WO'
    | 'PAUSE_WO'
    | 'RESUME_WO'
    | 'COMPLETE_WO'
    | 'RECORD_OUTPUT'
    | 'RECORD_DOWNTIME'
    | 'RESOLVE_DOWNTIME';
  payload: Record<string, unknown>;
  queuedAt: number;
  occurredAt: string;
  status: OfflineCommandStatus;
  retryCount: number;
  errorMessage?: string;
}
//# sourceMappingURL=entities.d.ts.map
