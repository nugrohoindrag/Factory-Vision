/**
 * Factory Vision - MES Domain Entities & Models
 * Aligned with PRD v1.6, Technical Architecture v1.9, and Technical Design Final v1.0
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
  CustomerOrderStatus,
  OrderChannel,
  DemandForecastStatus,
  DemandForecastMethod,
  CapacityPlanStatus,
  CapacityStatus,
  CapacityUpResponseType,
  CapacityUpRequestStatus,
  ProductionPlanStatus,
  MoldStatus,
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

export interface Mold {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  cavityCount: number;
  status: MoldStatus;
  currentMachineId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductMoldCompatibility {
  id: string;
  tenantId: string;
  productId: string;
  moldId: string;
  active: boolean;
  createdAt?: string;
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

// === CUSTOMER & DEMAND (MES-004) ===

export interface Customer {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  picName?: string;
  picContact?: string;
  deliveryAddress?: string;
  dockNumber?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerOrder {
  id: string;
  tenantId: string;
  orderNumber: string;
  customerId: string;
  poNumber?: string;
  orderChannel: OrderChannel;
  orderDate: string;
  requestedDeliveryDate: string;
  customerPic?: string;
  deliveryAddress?: string;
  dockNumber?: string;
  documentUrl?: string;
  status: CustomerOrderStatus;
  /** Why the order reached its current status; mandatory on cancellation. */
  statusReason?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  lines?: CustomerOrderLine[];
}

export interface CustomerOrderLine {
  id: string;
  tenantId: string;
  customerOrderId: string;
  productId: string;
  modelType?: string;
  orderedQuantity: number;
  unit: string;
  requestedDeliveryDate?: string;
  plannedQuantity: number;
  producedQuantity: number;
  lineNo: number;
  createdAt?: string;
  updatedAt?: string;
}

// === PLANNING (MES-005) ===

export interface DemandForecast {
  id: string;
  tenantId: string;
  forecastNumber: string;
  periodStart: string;
  periodEnd: string;
  lookbackMonths: number;
  method: DemandForecastMethod;
  generatedBy?: string;
  generatedAt?: string;
  status: DemandForecastStatus;
  /** The snapshot that replaced this one; set when SUPERSEDED (MES-028). */
  supersededById?: string;
  lines?: DemandForecastLine[];
}

export interface DemandForecastLine {
  id: string;
  tenantId: string;
  demandForecastId: string;
  customerId?: string;
  productId: string;
  historicalDemand: Record<string, number>;
  averageDemand: number;
  forecastQuantity: number;
  /** Fewer months carried an order than the lookback asked for (MES-027). */
  insufficientHistory?: boolean;
  monthsWithHistory?: number;
}

export interface CapacityPlan {
  id: string;
  tenantId: string;
  planNumber: string;
  periodStart: string;
  periodEnd: string;
  planningUtilizationPct: number;
  status: CapacityPlanStatus;
  computedAt?: string;
  supersededById?: string;
  lines?: CapacityPlanLine[];
}

export interface CapacityPlanLine {
  id: string;
  tenantId: string;
  capacityPlanId: string;
  plantId: string;
  lineId?: string;
  productId?: string;
  totalCapacity: number;
  planningCapacity: number;
  capacityBuffer: number;
  demandQuantity: number;
  plannedQuantity: number;
  capacityUtilization: number;
  capacityGap: number;
  capacityStatus: CapacityStatus;
  /** Machines excluded from the total, with the reason (§45.6). */
  uncomputedMachines?: UncomputedMachineRef[];
  availableMinutes?: number;
}

/**
 * A machine left out of Total Capacity, and why.
 *
 * Reported rather than silently counted as zero: a missing ideal cycle time is
 * a master-data gap, not an absence of capacity (§45.6).
 */
export interface UncomputedMachineRef {
  machineId: string;
  machineCode: string;
  reason: 'NO_IDEAL_CYCLE_TIME' | 'MACHINE_INACTIVE';
  message: string;
}

export interface ProductionPlan {
  id: string;
  tenantId: string;
  planNumber: string;
  periodStart: string;
  periodEnd: string;
  demandForecastId?: string;
  capacityPlanId?: string;
  status: ProductionPlanStatus;
  wizardStep: number;
  confirmedBy?: string;
  confirmedAt?: string;
  version: number;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Per-step wizard draft, so an abandoned wizard resumes (MES-039). */
  wizardState?: Record<string, unknown>;
  /** The utilization in force when the plan was created (§45.6). */
  planningUtilizationPct?: number;
  lines?: ProductionPlanLine[];
}

export interface ProductionPlanLine {
  id: string;
  tenantId: string;
  productionPlanId: string;
  productId: string;
  demandQuantity: number;
  forecastQuantity: number;
  plannedQuantity: number;
  requiredDeliveryDate?: string;
  priority: number;
  capacityStatus: CapacityStatus;
  status: 'DRAFT' | 'RELEASED' | 'CANCELLED';
  demandForecastLineId?: string;
  createdAt?: string;
  updatedAt?: string;
  demands?: ProductionPlanDemand[];
}

// === PLANNING VIEW CONTRACTS (Sprint 3–6) ===

/** Tenant planning policy: §45.6 utilization and §13 sequence strictness. */
export interface PlanningConfig {
  tenantId: string;
  planningUtilizationPct: number;
  strictProcessSequence: boolean;
}

/** One step of the six-step wizard, and why it may be closed (MES-038-5). */
export interface WizardStepAvailability {
  step: number;
  label: string;
  reachable: boolean;
  blockedBy?: string;
}

/** `GET /v1/production-plans/{id}/wizard` (MES-039). */
export interface ProductionPlanWizardState {
  planId: string;
  currentStep: number;
  resumeStep: number;
  demandCount: number;
  lineCount: number;
  linesWithPlannedQuantity: number;
  workOrderCount: number;
  scheduledWorkOrders: number;
  resourcedWorkOrders: number;
  confirmedWorkOrders: number;
  capacityUpRequiredLines: number;
  steps: WizardStepAvailability[];
}

/** One plan line with every Customer Order behind it (MES-036-4). */
export interface ProductionPlanDemandBreakdown {
  productionPlanLineId: string;
  productId: string;
  demandQuantity: number;
  plannedQuantity: number;
  sources: {
    customerOrderId: string;
    orderNumber: string;
    customerId: string;
    customerName: string;
    customerOrderLineId: string;
    demandQuantity: number;
    requestedDeliveryDate?: string;
  }[];
}

/**
 * `GET /v1/capacity-plans/assess` — a calculated metric with its inputs.
 *
 * §18.3: a `calculated` metric without `inputs` is a contract violation, so the
 * numbers that formed the ratio travel with it and the tooltip needs no second
 * call.
 */
export interface CapacityAssessment {
  metric: 'capacity_utilization';
  value: number;
  inputs: {
    demandQuantity: number;
    totalCapacity: number;
    planningCapacity: number;
    capacityBuffer: number;
    planningUtilizationPct: number;
    availableMinutes: number;
  };
  capacityStatus: CapacityStatus;
  capacityGap: number;
  uncomputedMachines: UncomputedMachineRef[];
  contributions: {
    machineId: string;
    machineCode: string;
    availableMinutes: number;
    idealCycleTimeSeconds: number;
    capacity: number;
  }[];
}

/** A queued planning computation (MES-027-5). */
export interface PlanningJobView {
  id: string;
  tenantId: string;
  jobType: 'DEMAND_FORECAST_GENERATE' | 'CAPACITY_PLAN_RECALCULATE';
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  result?: Record<string, unknown>;
  lastError?: string;
  attempts: number;
  enqueuedAt?: string;
  finishedAt?: string;
}

/** Forecast next to the orders that actually arrived (MES-030). */
export interface DemandForecastComparison {
  forecastId: string;
  periodStart: string;
  periodEnd: string;
  rows: {
    productId: string;
    forecastQuantity: number;
    actualOrderedQuantity: number;
    variance: number;
    insufficientHistory: boolean;
  }[];
}

/** `GET /v1/work-orders/{id}/chain` (MES-018-3). */
export interface ProcessChainNodeView {
  workOrderId: string;
  woNumber: string;
  processId?: string;
  sequence?: number;
  status: WorkOrderStatus;
  plannedQuantity: number;
  inputQuantity: number;
  outputQuantity: number;
  transferredQuantity: number;
  parentWorkOrderId?: string;
  isSplitParent: boolean;
}

export interface ProcessChainView {
  workOrder: ProcessChainNodeView;
  predecessors: ProcessChainNodeView[];
  predecessor?: ProcessChainNodeView;
  successors: ProcessChainNodeView[];
  isFirstProcess: boolean;
  isLastProcess: boolean;
  availableQuantity: number;
}

/** `GET /v1/work-orders/{id}/demand` — derived, read-only (ADR-22). */
export interface WorkOrderDemandTrace {
  workOrderId: string;
  productionPlanLineId: string;
  productId: string;
  plannedQuantity: number;
  demandQuantity: number;
  demands: {
    customerOrderId: string;
    customerOrderNumber: string;
    customerOrderLineId: string;
    customerId: string;
    customerName: string;
    demandQuantity: number;
    requestedDeliveryDate?: string;
  }[];
}

export interface ProductionPlanDemand {
  id: string;
  tenantId: string;
  productionPlanLineId: string;
  customerOrderId: string;
  customerOrderLineId: string;
  demandQuantity: number;
}

export interface CapacityUpRequest {
  id: string;
  tenantId: string;
  requestNumber: string;
  productionPlanId: string;
  capacityGap: number;
  responseType: CapacityUpResponseType;
  responseDetail: Record<string, unknown>;
  reason: string;
  status: CapacityUpRequestStatus;
  requestedBy: string;
  requestedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  appliedAt?: string;
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

export interface CustomerOrderDocumentRef {
  id: string;
  tenantId: string;
  customerOrderId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageUrl: string;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface ProductionBatch {
  id: string;
  tenantId: string;
  batchNumber: string;
  workOrderId?: string;
  productId: string;
  processId?: string;
  sequence?: number;
  plannedQuantity?: number;
  inputQuantity?: number;
  outputQuantity?: number;
  rejectQuantity?: number;
  scrapQuantity?: number;
  reworkQuantity?: number;
  transferredQuantity?: number;
  status: ProductionBatchStatus;
  statusReason?: string;
  materialLotReference?: string;
  machineId?: string;
  moldId?: string;
  operatorId?: string;
  shiftId?: string;
  productionDate: string;
  expiryDate?: string;
  actualStart?: string;
  actualEnd?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  // Legacy optional
  productionOrderId?: string;
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  productionPlanLineId?: string;
  parentWorkOrderId?: string;
  predecessorWorkOrderId?: string;
  woNumber: string;
  productId: string;
  processId?: string;
  routingId?: string;
  sequence?: number;
  isBatchManaged?: boolean;
  hasChildWorkOrder?: boolean;
  lineId: string;
  workCenterId?: string;
  machineId?: string;
  moldId?: string;
  shiftId?: string;
  // Production Quantity Flow (ADR-23). Every field below is NOT NULL in the
  // database, so none of them is optional here: a Work Order read from the
  // repository always carries all seven. Output means "passed quality and fit to
  // move on" — reject, scrap and rework are separate buckets, never folded in.
  plannedQuantity: number;
  inputQuantity: number;
  outputQuantity: number;
  rejectQuantity: number;
  scrapQuantity: number;
  reworkQuantity: number;
  transferredQuantity: number;
  /** @deprecated Use plannedQuantity (ADR-23). Column drops in Sprint 6. */
  targetQuantity?: number;
  /** @deprecated Identical to outputQuantity (ADR-23). Column already dropped. */
  goodQuantity?: number;
  unit: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: WorkOrderStatus;
  /** Mandatory when CANCELLED (§11); free text otherwise. */
  statusReason?: string;
  priority: number;
  confirmedBy?: string;
  confirmedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  // Legacy fields retained during migration phase
  productionOrderId?: string;
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
  isBatchManaged?: boolean;
  hasChildWorkOrder?: boolean;
  machineId: string;
  operatorId: string;
  shiftId: string;
  shiftDate: string; // YYYY-MM-DD (determined by shift start)
  inputQuantity?: number;
  goodQuantity: number;
  rejectQuantity: number;
  scrapQuantity?: number;
  reworkQuantity?: number;
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
  shiftDate: string;
  startedAt: string;
  endedAt?: string;
  supervisorId?: string;
  targetQuantity: number;
  handoverNotes?: string;
  status: 'ACTIVE' | 'CLOSED';
}

// === DERIVED & AGGREGATES ===

export interface OeeDaily {
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
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  calcVersion: number;
  computedAt: string;
  revisedAt?: string;
  revisionCount: number;
}

export type OEEDaily = OeeDaily;

export interface OEEComponents {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export interface WOProgressSnapshot {
  workOrderId: string;
  woNumber: string;
  productName: string;
  targetQuantity: number;
  goodQuantity: number;
  rejectQuantity: number;
  achievementPct: number;
  status: string;
}

export interface DowntimeParetoItem {
  reasonId: string;
  reasonCode: string;
  reasonName: string;
  category: DowntimeCategory;
  isPlanned?: boolean;
  totalDurationSeconds: number;
  totalDurationMinutes: number;
  occurrenceCount: number;
  percentageOfTotal: number;
  cumulativePercentage: number;
}

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

export interface DailyPerformancePoint {
  shiftDate: string;
  goodQuantity: number;
  rejectQuantity: number;
  targetQuantity: number;
  plannedMinutes: number;
  downtimeMinutes: number;
  plannedDowntimeMinutes: number;
  unplannedDowntimeMinutes: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  achievementPct: number;
  rejectRatePct: number;
}

export interface ProductionTrendPoint {
  shiftDate: string;
  targetQuantity: number;
  goodQuantity: number;
  achievementPct: number;
  previousPeriodGoodQuantity: number;
  date?: string;
  actualQuantity?: number;
  rejectQuantity?: number;
}

export interface OeeTrendPoint {
  shiftDate: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  targetOee: number | null;
  previousPeriodOee: number | null;
}

export type KpiMetric =
  | 'OEE'
  | 'AVAILABILITY'
  | 'PERFORMANCE'
  | 'QUALITY'
  | 'PRODUCTION_OUTPUT'
  | 'PRODUCTION_ACHIEVEMENT'
  | 'REJECT_RATE'
  | 'DOWNTIME';

export interface ExecutiveKpi {
  metric: KpiMetric;
  label: string;
  value: number;
  unit: string;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  previousValue: number;
  deltaVsPrevious: number;
  deltaPct: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  trendIsFavourable: boolean;
  target?: number;
  variance?: number;
  attainmentPct?: number;
  status?: KpiStatus;
}

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

export interface DowntimeSummary {
  totalDowntimeMinutes: number;
  plannedDowntimeMinutes: number;
  unplannedDowntimeMinutes: number;
  plannedProductionMinutes: number;
  downtimeRatePct: number;
  occurrenceCount: number;
  averageDurationMinutes: number;
  pareto: DowntimeParetoItem[];
  byLine: Array<{
    lineId: string;
    lineName: string;
    downtimeMinutes: number;
    occurrenceCount: number;
  }>;
  topMachines: Array<{
    machineId: string;
    machineName: string;
    downtimeMinutes: number;
    occurrenceCount: number;
  }>;
}

export interface QualitySummary {
  goodQuantity: number;
  rejectQuantity: number;
  totalQuantity: number;
  rejectRatePct: number;
  qualityPct: number;
  qualityTargetPct: number | null;
  qualityVariancePct: number | null;
  pareto: RejectParetoItem[];
  byLine: Array<{
    lineId: string;
    lineName: string;
    rejectQuantity: number;
    rejectRatePct: number;
  }>;
}

export interface OrderStatusSummary {
  planned: number;
  running: number;
  completed: number;
  atRisk: number;
  delayed: number;
  overdue: number;
  total: number;
  attentionOrders: Array<{
    id: string;
    orderNumber: string;
    dueDate: string;
    status: ProductionOrderStatus;
    achievementPct: number;
    daysToDue: number;
    classification: 'AT_RISK' | 'DELAYED' | 'OVERDUE';
  }>;
}

export interface OperationalAlert {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFORMATIONAL';
  rule: string;
  title: string;
  detail: string;
  drillDownPath: string;
  entityType: 'LINE' | 'MACHINE' | 'TENANT' | 'PRODUCTION_ORDER' | 'WORK_ORDER';
  entityId: string;
  observedValue: number;
  thresholdValue: number;
  raisedAt: string;
}

// === PLATFORM, GOVERNANCE & AUDIT ===

export interface AppUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash?: string;
  name: string;
  role: UserRole | string;
  accountType?: 'APPLICATION_USER' | 'OPERATOR' | 'APPLICATION' | string;
  scopeLevel?: 'TENANT' | 'PLANT' | 'LINE' | 'WORK_CENTER';
  scopeId?: string;
  employeeNumber?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'INVITED';
  lastLoginAt?: string;
  createdAt: string;
}

export interface OfflineCommand {
  id?: number;
  tenantId?: string;
  clientEventId: string;
  type: 'PRODUCTION' | 'DOWNTIME_START' | 'DOWNTIME_RESOLVE' | 'WORK_ORDER_STATUS' | 'BATCH_PRODUCTION' | string;
  payload: Record<string, unknown> | any;
  status: OfflineCommandStatus;
  workOrderId?: string;
  machineId?: string;
  operatorId?: string;
  shiftId?: string;
  shiftDate?: string;
  occurredAt: string;
  queuedAt: number;
  retryCount: number;
  lastAttemptAt?: string;
  errorMessage?: string;
  createdAt?: string;
}

export interface DeviceTerminal {
  id: string;
  tenantId: string;
  deviceCode: string;
  name: string;
  assignedLineId?: string;
  assignedWorkCenterId?: string;
  status: 'ONLINE' | 'OFFLINE';
  ipAddress?: string;
  lastHeartbeatAt?: string;
  registeredAt: string;
}

export interface CorrectionRequest {
  id: string;
  tenantId: string;
  entityType: CorrectionEntityType;
  entityId: string;
  shiftDate: string;
  fieldChanges: Record<string, { oldValue?: unknown; newValue?: unknown; from?: unknown; to?: unknown }>;
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

export type KpiStatus = 'GOOD' | 'WATCH' | 'CRITICAL';

export interface KpiTarget {
  id: string;
  tenantId: string;
  metric: string;
  targetValue: number;
  unit: string;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  watchThresholdPct: number;
  criticalThresholdPct: number;
}
