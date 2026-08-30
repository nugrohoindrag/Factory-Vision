/**
 * Factory Vision - MES Domain Entities & Models
 * Aligned with PRD v1.1 and Technical Architecture v1.7
 */

import {
  DeploymentMode,
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
  ProductionBatchStatus,
} from './enums.js';

// === MASTER DATA ===

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

export interface ProductionProcess {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  sequenceDefault: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
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

export interface ProductRouting {
  id: string;
  tenantId: string;
  productId: string;
  processId: string;
  sequence: number;
  workCenterId?: string;
  machineId?: string;
  standardCycleTimeSeconds?: number;
  active: boolean;
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
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
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

export interface DowntimeReasonScope {
  id: string;
  tenantId: string;
  reasonId: string;
  lineId?: string;
  workCenterId?: string;
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

export interface RejectReasonScope {
  id: string;
  tenantId: string;
  reasonId: string;
  productId?: string;
  workCenterId?: string;
}

// === TRANSACTIONAL & EXECUTION ===

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

export interface ProductionBatch {
  id: string;
  tenantId: string;
  batchNumber: string;
  productId: string;
  productionOrderId: string;
  productionDate: string;
  status: ProductionBatchStatus;
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  productionOrderId: string;
  woNumber: string;
  productId: string;
  processId?: string;
  sequence?: number;
  batchId?: string;
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

// === EVENTS (Immutable, Partitioned by month) ===

export interface ProductionRecord {
  id: string;
  tenantId: string;
  workOrderId: string;
  processId?: string;
  batchId?: string;
  machineId: string;
  operatorId: string;
  shiftId: string;
  shiftDate: string; // YYYY-MM-DD (determined by shift start)
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
  processId?: string;
  machineId: string;
  lineId: string;
  operatorId?: string;
  shiftId: string;
  shiftDate: string; // YYYY-MM-DD
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
  processId?: string;
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
  shiftDate: string; // YYYY-MM-DD
  startedAt: string;
  endedAt?: string;
  supervisorId: string;
  targetQuantity: number;
  handoverNotes?: string;
  status: 'ACTIVE' | 'CLOSED';
}

// === DERIVED & ANALYTICS ===

export interface OEEComponents {
  availability: number; // 0.0 - 1.0
  performance: number; // 0.0 - 1.0
  quality: number; // 0.0 - 1.0
  oee: number; // 0.0 - 1.0
}

export interface OEEDaily extends OEEComponents {
  tenantId: string;
  shiftDate: string;
  plantId: string;
  lineId: string;
  processId?: string;
  workCenterId?: string;
  machineId: string;
  shiftId: string;
  productId: string;
  plannedTimeSeconds: number;
  runTimeSeconds: number;
  downtimeSeconds: number;
  goodCount: number;
  rejectCount: number;
  totalCount: number;
  calcVersion?: number;
  computedAt: string;
  revisedAt?: string;
  revisionCount?: number;
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

// === PLATFORM & GOVERNANCE ===

export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type UserScopeLevel = 'TENANT' | 'PLANT' | 'LINE' | 'WORK_CENTER';
export type AccountType = 'APPLICATION_USER' | 'OPERATOR';

export interface AppUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  accountType: AccountType;
  scopeLevel: UserScopeLevel;
  scopeId?: string;
  employeeNumber?: string;
  status: UserStatus;
  lastLoginAt?: string;
  createdAt: string;
}

export interface DeviceTerminal {
  id: string;
  tenantId: string;
  deviceCode: string;
  name: string;
  assignedLineId?: string;
  assignedWorkCenterId?: string;
  status: 'ONLINE' | 'OFFLINE' | 'REVOKED';
  ipAddress?: string;
  lastHeartbeatAt?: string;
  registeredAt: string;
}

export interface Permission {
  id: string;
  module: string;
  action: string;
  description: string;
}

export interface CorrectionRequest {
  id: string;
  tenantId: string;
  entityType: CorrectionEntityType;
  entityId: string;
  shiftDate: string;
  fieldChanges: Record<string, { from: unknown; to: unknown }>;
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
  previousValue?: any;
  newValue?: any;
  ip?: string;
  userAgent?: string;
  occurredAt: string;
}

// === OFFLINE ENGINE (OPERATOR PWA) ===

export interface OfflineCommand {
  id?: number; // Auto-increment IndexedDB key
  clientEventId: string; // UUID v4 generated once at enqueue
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
  queuedAt: number; // Local client timestamp
  occurredAt: string; // ISO string adjusted with server clock offset
  status: OfflineCommandStatus;
  retryCount: number;
  errorMessage?: string;
}

// === EXECUTIVE DASHBOARD ===

/**
 * The eight KPI the Executive Dashboard leads with.
 */
export type KpiMetric =
  | 'OEE'
  | 'AVAILABILITY'
  | 'PERFORMANCE'
  | 'QUALITY'
  | 'PRODUCTION_OUTPUT'
  | 'PRODUCTION_ACHIEVEMENT'
  | 'REJECT_RATE'
  | 'DOWNTIME';

/** Whether a higher or a lower number is the better outcome for a metric. */
export type KpiDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';

/** Status classification shared by KPI cards and plant/line rows. */
export type KpiStatus = 'GOOD' | 'WATCH' | 'CRITICAL';

export type TrendDirection = 'UP' | 'DOWN' | 'FLAT';

/**
 * Configured target for one KPI. requires a target and a variance on
 * every card that has one; without this record a KPI renders value + trend only.
 */
export interface KpiTarget {
  id: string;
  tenantId: string;
  metric: KpiMetric;
  targetValue: number;
  unit: string;
  direction: KpiDirection;
  /** Attainment (% of target) at or below which status becomes WATCH. */
  watchThresholdPct: number;
  /** Attainment (% of target) at or below which status becomes CRITICAL. */
  criticalThresholdPct: number;
}

/** One Executive KPI card. */
export interface ExecutiveKpi {
  metric: KpiMetric;
  label: string;
  value: number;
  unit: string;
  direction: KpiDirection;
  /** Absent when no KpiTarget is configured for the metric. */
  target?: number;
  /** value - target. Absent when there is no target. */
  variance?: number;
  /** Attainment against target, as a percentage. Absent when there is no target. */
  attainmentPct?: number;
  status?: KpiStatus;
  previousValue: number;
  deltaVsPrevious: number;
  deltaPct: number;
  trend: TrendDirection;
  /** True when `trend` moves the metric toward its goal, given `direction`. */
  trendIsFavourable: boolean;
}

/**
 * One day of aggregated shop-floor performance, derived from production and
 * downtime records. Every trend endpoint is built from this.
 */
export interface DailyPerformancePoint {
  shiftDate: string;
  targetQuantity: number;
  goodQuantity: number;
  rejectQuantity: number;
  achievementPct: number;
  rejectRatePct: number;
  plannedMinutes: number;
  downtimeMinutes: number;
  plannedDowntimeMinutes: number;
  unplannedDowntimeMinutes: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

/** Target vs Actual over time. */
export interface ProductionTrendPoint {
  shiftDate: string;
  targetQuantity: number;
  goodQuantity: number;
  achievementPct: number;
  /** Same weekday-offset value from the preceding period, or null when unknown. */
  previousPeriodGoodQuantity: number | null;
}

/** OEE Actual vs Target vs Previous Period. */
export interface OeeTrendPoint {
  shiftDate: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  targetOee: number | null;
  previousPeriodOee: number | null;
}

/** One row of the plant / line comparison table. */
export interface LinePerformanceRow {
  lineId: string;
  lineName: string;
  plantId: string;
  plantName: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  goodQuantity: number;
  targetQuantity: number;
  achievementPct: number;
  downtimeMinutes: number;
  rejectQuantity: number;
  rejectRatePct: number;
  hasActiveDowntime: boolean;
  status: KpiStatus;
}

/** Plant-level rollup of `LinePerformanceRow` ( "by plant"). */
export interface PlantPerformanceRow {
  plantId: string;
  plantName: string;
  lineCount: number;
  oee: number;
  goodQuantity: number;
  targetQuantity: number;
  achievementPct: number;
  downtimeMinutes: number;
  rejectQuantity: number;
  rejectRatePct: number;
  status: KpiStatus;
}

/** Downtime reason ranked by lost time. */
export interface DowntimeParetoItem {
  reasonId: string;
  reasonCode: string;
  reasonName: string;
  category: DowntimeCategory;
  totalDurationSeconds: number;
  totalDurationMinutes: number;
  occurrenceCount: number;
  percentageOfTotal: number;
  cumulativePercentage: number;
}

/** Defect reason ranked by reject quantity. */
export interface RejectParetoItem {
  reasonId: string;
  reasonCode: string;
  reasonName: string;
  category: RejectCategory;
  totalRejectQuantity: number;
  occurrenceCount: number;
  percentageOfTotal: number;
  cumulativePercentage: number;
}

/** Loss overview that sits above the downtime Pareto. */
export interface DowntimeSummary {
  totalDowntimeMinutes: number;
  plannedDowntimeMinutes: number;
  unplannedDowntimeMinutes: number;
  plannedProductionMinutes: number;
  downtimeRatePct: number;
  occurrenceCount: number;
  averageDurationMinutes: number;
  pareto: DowntimeParetoItem[];
  byLine: Array<{ lineId: string; lineName: string; downtimeMinutes: number; occurrenceCount: number }>;
  topMachines: Array<{
    machineId: string;
    machineName: string;
    downtimeMinutes: number;
    occurrenceCount: number;
  }>;
}

/** Quality overview that sits above the defect Pareto. */
export interface QualitySummary {
  goodQuantity: number;
  rejectQuantity: number;
  totalQuantity: number;
  rejectRatePct: number;
  qualityPct: number;
  qualityTargetPct: number | null;
  qualityVariancePct: number | null;
  pareto: RejectParetoItem[];
  byLine: Array<{ lineId: string; lineName: string; rejectQuantity: number; rejectRatePct: number }>;
}

/** Schedule health. */
export interface OrderStatusSummary {
  planned: number;
  running: number;
  completed: number;
  atRisk: number;
  delayed: number;
  overdue: number;
  total: number;
  /** Orders behind schedule, newest due date first. Bounded list, not the full table. */
  attentionOrders: Array<{
    id: string;
    orderNumber: string;
    dueDate: string;
    status: string;
    achievementPct: number;
    daysToDue: number;
    classification: 'AT_RISK' | 'DELAYED' | 'OVERDUE';
  }>;
}

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFORMATIONAL';

/** One entry in the exception layer. */
export interface OperationalAlert {
  id: string;
  severity: AlertSeverity;
  /** Machine-readable rule that produced the alert. */
  rule: string;
  title: string;
  detail: string;
  /** Console route that answers the alert, per the drill-down principle. */
  drillDownPath: string;
  entityType: 'LINE' | 'MACHINE' | 'PRODUCTION_ORDER' | 'PLANT' | 'TENANT';
  entityId: string;
  observedValue: number;
  thresholdValue: number;
  raisedAt: string;
}

/** Process-level performance comparison row. */
export interface ProcessPerformanceRow {
  processId: string;
  processCode: string;
  processName: string;
  sequenceDefault: number;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  goodQuantity: number;
  rejectQuantity: number;
  targetQuantity: number;
  achievementPct: number;
  downtimeMinutes: number;
  status: KpiStatus;
}
