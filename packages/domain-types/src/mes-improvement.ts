/**
 * Factory Vision — MES Improvement v2.0 domain contract.
 *
 * One module for the six capabilities the Improvement PRD adds on top of
 * v1.7 — material, MRP, quality, maintenance, workforce, WIP/handoff — plus
 * the operational event history that ties them into one timeline.
 *
 * Kept apart from `entities.ts` because it is a distinct release of the
 * domain: a reader wanting to know what the improvement introduced can read
 * this file, and the v1.7 model stays readable as what it was.
 *
 * States are string unions rather than TypeScript enums. The API stores them
 * as VARCHAR and the console renders them from label maps; a union keeps the
 * wire format and the type identical, which an enum does not.
 */

// ============================================================
// §10 Event History
// ============================================================

/** §10.2 — the minimum operational vocabulary. */
export const OPERATIONAL_EVENT_TYPES = [
  'WO_CREATED',
  'WO_SCHEDULED',
  'WO_CONFIRMED',
  'WO_STARTED',
  'PRODUCTION_RECORDED',
  'REJECT_RECORDED',
  'DOWNTIME_STARTED',
  'DOWNTIME_ENDED',
  'BATCH_STARTED',
  'BATCH_COMPLETED',
  'MATERIAL_RESERVED',
  'MATERIAL_CONSUMED',
  'MATERIAL_RETURNED',
  'MATERIAL_TRANSFERRED',
  'MRP_RUN',
  'WIP_CREATED',
  'WIP_TRANSFERRED',
  'WIP_RECEIVED',
  'QUALITY_INSPECTION',
  'QUALITY_HOLD',
  'QUALITY_RELEASE',
  'QUALITY_DISPOSITION',
  'NCR_OPENED',
  'NCR_CLOSED',
  'REWORK_STARTED',
  'SCRAP_RECORDED',
  'MAINTENANCE_REQUESTED',
  'MAINTENANCE_STARTED',
  'MAINTENANCE_COMPLETED',
  'OPERATOR_ASSIGNED',
  'OPERATOR_UNASSIGNED',
  'SCHEDULE_CHANGED',
  'WO_COMPLETED',
  'WO_CANCELLED',
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

export type EventEntityType =
  | 'WORK_ORDER'
  | 'PRODUCTION_ORDER'
  | 'BATCH'
  | 'MACHINE'
  | 'OPERATOR'
  | 'MATERIAL'
  | 'INSPECTION'
  | 'NCR'
  | 'MAINTENANCE'
  | 'WIP'
  | 'MRP_RUN';

/** §10.4 — one row of the operational timeline. Append-only (BR-E01). */
export interface OperationalEvent {
  id: string;
  tenantId: string;
  eventType: OperationalEventType;
  entityType: EventEntityType;
  entityId: string;
  actorType: 'USER' | 'OPERATOR' | 'SYSTEM';
  actorId?: string;
  actorName?: string;
  occurredAt: string;
  plantId?: string;
  lineId?: string;
  machineId?: string;
  processId?: string;
  workOrderId?: string;
  batchId?: string;
  /** One line of Indonesian, rendered by the writer. */
  summary: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  metadata?: Record<string, unknown>;
}

export interface EventHistoryQuery {
  entityType?: EventEntityType;
  entityId?: string;
  eventType?: OperationalEventType;
  workOrderId?: string;
  machineId?: string;
  batchId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ============================================================
// §3 Material, §15 Material State
// ============================================================

export type MaterialState =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'ALLOCATED'
  | 'ISSUED'
  | 'IN_PROCESS'
  | 'CONSUMED'
  | 'RETURNED'
  | 'QUARANTINED'
  | 'BLOCKED';

/** §3.1 — readiness of one requirement, or of a plan/work order as a whole. */
export type MaterialReadinessStatus = 'READY' | 'PARTIAL' | 'SHORTAGE' | 'NOT_CHECKED';

/** On-hand stock of one material in one warehouse (§13 Material Inventory). */
export interface MaterialInventory {
  id: string;
  tenantId: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  warehouseId: string;
  warehouseName: string;
  uom: string;
  onHandQuantity: number;
  reservedQuantity: number;
  /** Purchase or transfer already scheduled to land inside the horizon. */
  incomingQuantity: number;
  /** `onHand - reserved + incoming` (§3.1). */
  availableQuantity: number;
  reorderPoint?: number;
  safetyStock?: number;
  state: MaterialState;
  updatedAt: string;
}

export interface MaterialReservation {
  id: string;
  tenantId: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  warehouseId?: string;
  workOrderId?: string;
  workOrderNumber?: string;
  productionPlanId?: string;
  quantity: number;
  uom: string;
  status: 'RESERVED' | 'ISSUED' | 'RELEASED' | 'CONSUMED';
  reservedBy: string;
  reservedAt: string;
  releasedAt?: string;
  notes?: string;
}

/** One exploded BOM line, resolved against inventory (§3.1, US-M001). */
export interface MaterialRequirement {
  id: string;
  tenantId: string;
  /** What generated it: a plan line, a work order, or an MRP run. */
  sourceType: 'PRODUCTION_PLAN' | 'WORK_ORDER' | 'MRP_RUN';
  sourceId: string;
  sourceLabel: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  bomId?: string;
  bomNumber?: string;
  /** Depth in a multi-level explosion; 1 is a direct component. */
  level: number;
  requiredQuantity: number;
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  /** `required - available`, floored at zero. */
  shortageQuantity: number;
  uom: string;
  requirementDate: string;
  status: MaterialReadinessStatus;
  warehouseId?: string;
  createdAt: string;
}

/** Aggregate readiness of a plan or work order (§22.1). */
export interface MaterialReadiness {
  sourceType: 'PRODUCTION_PLAN' | 'WORK_ORDER';
  sourceId: string;
  sourceLabel: string;
  status: MaterialReadinessStatus;
  /** `ready / total × 100` (§25). */
  readinessPercentage: number;
  totalRequirements: number;
  readyRequirements: number;
  shortageRequirements: number;
  checkedAt: string;
  requirements: MaterialRequirement[];
}

export type ConsumptionStatus = 'NORMAL' | 'OVER_CONSUMPTION' | 'UNDER_CONSUMPTION';

/** §3.3 — actual material issued against a work order. */
export interface MaterialConsumption {
  id: string;
  tenantId: string;
  workOrderId: string;
  workOrderNumber: string;
  batchId?: string;
  processId?: string;
  machineId?: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  warehouseId?: string;
  plannedQuantity: number;
  actualQuantity: number;
  /** `actual - planned` (§3.3). */
  varianceQuantity: number;
  variancePercentage: number;
  uom: string;
  consumptionType: 'PRODUCTION' | 'SCRAP' | 'REWORK' | 'RETURN';
  status: ConsumptionStatus;
  operatorId?: string;
  operatorName?: string;
  recordedBy: string;
  consumedAt: string;
  /** Offline terminals replay; the key makes a replay a no-op (§38). */
  idempotencyKey?: string;
  notes?: string;
}

/** Every movement of stock, so inventory has an explanation (§13). */
export interface MaterialTransaction {
  id: string;
  tenantId: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  warehouseId?: string;
  transactionType:
    | 'RECEIPT'
    | 'ISSUE'
    | 'RETURN'
    | 'ADJUSTMENT'
    | 'RESERVATION'
    | 'RELEASE'
    | 'SCRAP'
    | 'TRANSFER';
  quantity: number;
  uom: string;
  /** Stock after the movement, so a ledger reads without replaying it. */
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  actorId: string;
  actorName?: string;
  occurredAt: string;
}

// ============================================================
// §3.2 MRP
// ============================================================

export type MrpRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface MrpRun {
  id: string;
  tenantId: string;
  runNumber: string;
  /** BR-M08 — both are stored; a result without them is unreadable. */
  horizonStart: string;
  horizonEnd: string;
  status: MrpRunStatus;
  demandSource: 'PRODUCTION_PLAN' | 'CUSTOMER_ORDER';
  planIds: string[];
  totalMaterials: number;
  shortageMaterials: number;
  runBy: string;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  notes?: string;
}

/** One line of the §3.2 output table. */
export interface MrpResult {
  id: string;
  tenantId: string;
  mrpRunId: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  level: number;
  grossRequirement: number;
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  availableQuantity: number;
  /** `gross - available`, floored at zero (§3.2). */
  netRequirement: number;
  uom: string;
  requirementDate: string;
  requirementSource: string;
  status: MaterialReadinessStatus;
  /** MRP recommends; it never purchases (BR-M07). */
  recommendation?: string;
}

// ============================================================
// §4 Quality, §16 Quality State
// ============================================================

export type QualityState =
  | 'PENDING_INSPECTION'
  | 'PASS'
  | 'FAIL'
  | 'HOLD'
  | 'REWORK'
  | 'SCRAP'
  | 'RELEASED';

export type InspectionType = 'INCOMING' | 'IN_PROCESS' | 'FINAL' | 'FIRST_ARTICLE' | 'PATROL';

export type SamplingMethod = 'FIXED_QUANTITY' | 'PERCENTAGE' | 'ALL' | 'AQL';

/** §4.2 — one measurable characteristic on an inspection plan. */
export interface InspectionCharacteristic {
  id: string;
  inspectionPlanId: string;
  sequence: number;
  name: string;
  /** A numeric characteristic has limits; an attribute one is pass/fail. */
  dataType: 'NUMERIC' | 'ATTRIBUTE';
  specification?: string;
  lowerLimit?: number;
  upperLimit?: number;
  targetValue?: number;
  uom?: string;
  required: boolean;
}

export interface InspectionPlan {
  id: string;
  tenantId: string;
  planNumber: string;
  name: string;
  inspectionType: InspectionType;
  productId?: string;
  productName?: string;
  processId?: string;
  processName?: string;
  samplingMethod: SamplingMethod;
  samplingQuantity?: number;
  /** e.g. "setiap batch", "setiap 2 jam" — free text, shown as written. */
  frequency?: string;
  /** BR-Q02 — a mandatory plan that has not passed blocks the handoff. */
  mandatory: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  characteristics: InspectionCharacteristic[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionResultLine {
  id: string;
  inspectionId: string;
  characteristicId: string;
  characteristicName: string;
  expectedValue?: string;
  actualValue?: string;
  numericValue?: number;
  result: 'PASS' | 'FAIL';
  notes?: string;
}

/** §4.3 — one executed inspection. */
export interface Inspection {
  id: string;
  tenantId: string;
  inspectionNumber: string;
  inspectionPlanId?: string;
  inspectionPlanName?: string;
  inspectionType: InspectionType;
  workOrderId?: string;
  workOrderNumber?: string;
  batchId?: string;
  batchNumber?: string;
  productId?: string;
  productName?: string;
  processId?: string;
  machineId?: string;
  inspectedQuantity: number;
  passedQuantity: number;
  failedQuantity: number;
  uom?: string;
  result: 'PASS' | 'FAIL';
  operatorId?: string;
  operatorName?: string;
  inspectorId: string;
  inspectorName: string;
  inspectedAt: string;
  /** Set once a disposition has resolved the failed quantity (BR-Q03). */
  dispositionId?: string;
  idempotencyKey?: string;
  notes?: string;
  lines: InspectionResultLine[];
}

export type DispositionDecision = 'RELEASE' | 'REWORK' | 'SCRAP' | 'HOLD' | 'RETURN';

/** §4.5 — what was decided about a failed quantity, and by whom. */
export interface QualityDisposition {
  id: string;
  tenantId: string;
  inspectionId?: string;
  qualityHoldId?: string;
  workOrderId?: string;
  workOrderNumber?: string;
  batchId?: string;
  productId?: string;
  decision: DispositionDecision;
  quantity: number;
  uom?: string;
  reason: string;
  defectCode?: string;
  ncrId?: string;
  decidedBy: string;
  decidedByName?: string;
  decidedAt: string;
}

/** §4.4 — quantity taken out of circulation until someone decides. */
export interface QualityHold {
  id: string;
  tenantId: string;
  holdNumber: string;
  workOrderId?: string;
  workOrderNumber?: string;
  batchId?: string;
  batchNumber?: string;
  productId?: string;
  productName?: string;
  materialId?: string;
  inspectionId?: string;
  quantity: number;
  uom?: string;
  /** BR-Q04 — both are mandatory. */
  reason: string;
  ownerId: string;
  ownerName: string;
  status: 'OPEN' | 'RELEASED' | 'DISPOSITIONED';
  heldBy: string;
  heldAt: string;
  releasedBy?: string;
  releasedAt?: string;
  dispositionId?: string;
  notes?: string;
}

export type NcrStatus = 'OPEN' | 'INVESTIGATION' | 'ACTION' | 'VERIFICATION' | 'CLOSED';

/** §4.6 — a quality failure that needs investigating. */
export interface NonConformanceRecord {
  id: string;
  tenantId: string;
  ncrNumber: string;
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: NcrStatus;
  productId?: string;
  productName?: string;
  batchId?: string;
  workOrderId?: string;
  workOrderNumber?: string;
  processId?: string;
  machineId?: string;
  operatorId?: string;
  defectCode?: string;
  inspectionId?: string;
  quantity?: number;
  uom?: string;
  rootCause?: string;
  ownerId: string;
  ownerName: string;
  raisedBy: string;
  raisedAt: string;
  dueDate?: string;
  closedBy?: string;
  closedAt?: string;
  actions: CorrectiveAction[];
}

/** §4.7 */
export interface CorrectiveAction {
  id: string;
  tenantId: string;
  ncrId: string;
  sequence: number;
  action: string;
  ownerId: string;
  ownerName: string;
  dueDate?: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CANCELLED';
  completedAt?: string;
  completedBy?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  evidence?: string;
  notes?: string;
}

// ============================================================
// §5 Maintenance, §17 Maintenance State
// ============================================================

export type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'EMERGENCY';

export type MaintenanceState =
  | 'PLANNED'
  | 'UPCOMING'
  | 'DUE'
  | 'OVERDUE'
  | 'REQUESTED'
  | 'IN_PROGRESS'
  | 'WAITING_PART'
  | 'TESTING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'SKIPPED';

export type MaintenanceTriggerType = 'CALENDAR' | 'OPERATING_HOURS' | 'PRODUCTION_CYCLES';

/** §5.2 — the rule that generates preventive work. */
export interface MaintenancePlan {
  id: string;
  tenantId: string;
  planNumber: string;
  name: string;
  machineId: string;
  machineName: string;
  triggerType: MaintenanceTriggerType;
  /** Days for CALENDAR, hours for OPERATING_HOURS, cycles for PRODUCTION_CYCLES. */
  intervalValue: number;
  intervalUnit: string;
  tasks: string[];
  estimatedDurationMinutes?: number;
  lastPerformedAt?: string;
  /** Meter reading at the last service, for the non-calendar triggers. */
  lastPerformedMeter?: number;
  nextDueAt?: string;
  nextDueMeter?: number;
  /** How far ahead a plan starts showing as UPCOMING. */
  warningThreshold?: number;
  status: 'ACTIVE' | 'INACTIVE';
  /** Derived on read: where this plan stands right now (§5.2). */
  dueStatus?: 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'SKIPPED';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** §5.3 — someone reports a problem. */
export interface MaintenanceRequest {
  id: string;
  tenantId: string;
  requestNumber: string;
  machineId: string;
  machineName: string;
  maintenanceType: MaintenanceType;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  problemDescription: string;
  reportedSymptom?: string;
  workOrderId?: string;
  downtimeId?: string;
  requestedBy: string;
  requestedByName?: string;
  requestedAt: string;
  status: 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED';
  maintenanceRecordId?: string;
  notes?: string;
}

export interface MaintenancePartUsage {
  id: string;
  maintenanceRecordId: string;
  partId?: string;
  partName: string;
  quantity: number;
  uom: string;
  costReference?: number;
}

/** §5.5 — the work itself, from acceptance to completion. */
export interface MaintenanceRecord {
  id: string;
  tenantId: string;
  maintenanceNumber: string;
  machineId: string;
  machineName: string;
  maintenanceType: MaintenanceType;
  maintenancePlanId?: string;
  maintenanceRequestId?: string;
  /** BR-MT03 — emergency work is downtime, and points at it. */
  downtimeId?: string;
  status: MaintenanceState;
  problem?: string;
  rootCause?: string;
  actionTaken?: string;
  requesterId?: string;
  requesterName?: string;
  technicianId?: string;
  technicianName?: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  /** Minutes, derived from start/end when both are present. */
  durationMinutes?: number;
  /** BR-MT05 — completion has to say how it went. */
  result?: 'REPAIRED' | 'REPLACED' | 'ADJUSTED' | 'NO_FAULT_FOUND' | 'DEFERRED';
  costReference?: number;
  parts: MaintenancePartUsage[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** §22.3 */
export interface MaintenanceKpi {
  machineAvailabilityPercentage: number;
  pmCompliancePercentage: number;
  breakdownCount: number;
  /** Hours. `operating time / failures` (§25). */
  mtbfHours: number;
  /** Hours. `repair time / failures` (§25). */
  mttrHours: number;
  overdueCount: number;
  emergencyCount: number;
  maintenanceDowntimeMinutes: number;
}

// ============================================================
// §6 Workforce, §19 Workforce State
// ============================================================

export type OperatorAvailabilityState =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'WORKING'
  | 'BREAK'
  | 'ABSENT'
  | 'LEAVE'
  | 'SICK'
  | 'OFFLINE';

export type QualificationStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export interface Skill {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  category?: string;
  description?: string;
  /** 1..n; a requirement asks for "this skill at level >= x". */
  maxLevel: number;
  createdAt: string;
}

/** §6.1 — one operator holds one skill at one level, until it expires. */
export interface OperatorQualification {
  id: string;
  tenantId: string;
  operatorId: string;
  operatorName: string;
  skillId: string;
  skillCode: string;
  skillName: string;
  level: number;
  certifiedDate: string;
  expiryDate?: string;
  issuer?: string;
  certificateNumber?: string;
  /** Derived on read: an expiry in the past is EXPIRED (BR-W02). */
  status: QualificationStatus;
  suspendedReason?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** §6.2, §6.3 — what a machine or a process demands of whoever runs it. */
export interface QualificationRequirement {
  id: string;
  tenantId: string;
  targetType: 'MACHINE' | 'PROCESS';
  targetId: string;
  targetName: string;
  skillId: string;
  skillCode: string;
  skillName: string;
  minimumLevel: number;
  mandatory: boolean;
  createdAt: string;
}

/** §6.4 */
export interface OperatorShiftAssignment {
  id: string;
  tenantId: string;
  operatorId: string;
  operatorName: string;
  shiftId: string;
  shiftName: string;
  effectiveFrom: string;
  effectiveTo?: string;
  isDefault: boolean;
  createdBy?: string;
  createdAt: string;
}

/** §6.5 — where an operator stands right now. */
export interface OperatorAvailability {
  id: string;
  tenantId: string;
  operatorId: string;
  operatorName: string;
  state: OperatorAvailabilityState;
  shiftId?: string;
  shiftName?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reason?: string;
  updatedBy?: string;
  updatedAt: string;
}

export type LaborStatus = 'SUFFICIENT' | 'SHORTAGE' | 'OVERSTAFFED';

/** §6.6 — required vs available, per work order. */
export interface LaborRequirement {
  id: string;
  tenantId: string;
  workOrderId: string;
  workOrderNumber: string;
  processId?: string;
  machineId?: string;
  requiredOperators: number;
  assignedOperators: number;
  availableQualifiedOperators: number;
  status: LaborStatus;
  shiftId?: string;
  notes?: string;
  updatedAt: string;
}

/** One operator on one work order (§13 Labor Assignment). */
export interface LaborAssignment {
  id: string;
  tenantId: string;
  workOrderId: string;
  workOrderNumber: string;
  operatorId: string;
  operatorName: string;
  role?: string;
  shiftId?: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt?: string;
  status: 'ASSIGNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  /** What the assignment was validated against, kept for the audit. */
  qualificationCheck?: {
    qualified: boolean;
    matchedSkills: string[];
    missingSkills: string[];
  };
}

/** Clocked time, the numerator and denominator of §6.7. */
export interface LaborTimeRecord {
  id: string;
  tenantId: string;
  operatorId: string;
  operatorName: string;
  workOrderId?: string;
  workOrderNumber?: string;
  shiftId?: string;
  shiftDate: string;
  startedAt: string;
  endedAt?: string;
  productiveMinutes: number;
  availableMinutes: number;
  category: 'PRODUCTIVE' | 'DOWNTIME' | 'BREAK' | 'SETUP' | 'IDLE';
  recordedBy?: string;
}

/** §6.7 — `productive / available × 100`. */
export interface LaborUtilization {
  scope: 'OPERATOR' | 'SHIFT' | 'PROCESS' | 'LINE' | 'PLANT';
  scopeId: string;
  scopeName: string;
  shiftDate?: string;
  productiveMinutes: number;
  availableMinutes: number;
  utilizationPercentage: number;
}

/** The answer to "is this operator allowed on this machine" (BR-W01/02/03). */
export interface OperatorEligibility {
  operatorId: string;
  operatorName: string;
  eligible: boolean;
  qualified: boolean;
  available: boolean;
  availabilityState: OperatorAvailabilityState;
  matchedSkills: Array<{ skillCode: string; skillName: string; level: number }>;
  missingSkills: Array<{ skillCode: string; skillName: string; minimumLevel: number; reason: string }>;
  shiftId?: string;
  shiftName?: string;
  blockedReason?: string;
}

// ============================================================
// §7, §8 WIP and handoff, §18 WIP State
// ============================================================

export type WipState =
  | 'CREATED'
  | 'AT_PROCESS'
  | 'WAITING_TRANSFER'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'ON_HOLD'
  | 'REWORK'
  | 'COMPLETED'
  | 'SCRAPPED';

export type WipAgingStatus = 'NORMAL' | 'AGING' | 'CRITICAL';

/** §7.3 */
export interface WipRecord {
  id: string;
  tenantId: string;
  wipNumber: string;
  productId: string;
  productSku?: string;
  productName: string;
  workOrderId: string;
  workOrderNumber: string;
  batchId?: string;
  batchNumber?: string;
  sourceProcessId?: string;
  sourceProcessName?: string;
  destinationProcessId?: string;
  destinationProcessName?: string;
  quantity: number;
  uom: string;
  status: WipState;
  locationId?: string;
  locationName?: string;
  qualityStatus: QualityState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Derived on read (§7.4). */
  ageHours?: number;
  agingStatus?: WipAgingStatus;
  notes?: string;
}

/** §8.2 */
export interface WipTransfer {
  id: string;
  tenantId: string;
  transferNumber: string;
  wipId: string;
  productId: string;
  productName: string;
  batchId?: string;
  sourceWorkOrderId: string;
  sourceWorkOrderNumber: string;
  sourceProcessId?: string;
  sourceProcessName?: string;
  destinationWorkOrderId?: string;
  destinationWorkOrderNumber?: string;
  destinationProcessId?: string;
  destinationProcessName?: string;
  quantity: number;
  uom: string;
  status: 'CREATED' | 'IN_TRANSIT' | 'RECEIVED' | 'PARTIAL' | 'REJECTED' | 'CANCELLED';
  createdBy: string;
  createdByName?: string;
  transferredAt: string;
  receiptId?: string;
  idempotencyKey?: string;
  notes?: string;
}

/** §8.3 */
export interface WipReceipt {
  id: string;
  tenantId: string;
  wipTransferId: string;
  transferNumber: string;
  receivedQuantity: number;
  transferredQuantity: number;
  /** `transferred - received`; non-zero demands a reason (BR-WIP04). */
  varianceQuantity: number;
  varianceReason?: string;
  result: 'FULL' | 'PARTIAL' | 'REJECTED';
  uom: string;
  receivedBy: string;
  receivedByName?: string;
  receivedAt: string;
  idempotencyKey?: string;
  notes?: string;
}

export interface WipStatusHistory {
  id: string;
  wipId: string;
  fromStatus?: WipState;
  toStatus: WipState;
  changedBy: string;
  changedAt: string;
  reason?: string;
}

/** §7.5 */
export interface WipDashboard {
  totalWip: number;
  uom: string;
  byProcess: Array<{ processId: string; processName: string; quantity: number; records: number }>;
  byLine: Array<{ lineId: string; lineName: string; quantity: number; records: number }>;
  byProduct: Array<{ productId: string; productName: string; quantity: number; records: number }>;
  aging: { normal: number; aging: number; critical: number };
  stuckRecords: number;
  onHoldQuantity: number;
  waitingTransferQuantity: number;
  agingThresholdHours: number;
  criticalThresholdHours: number;
}

// ============================================================
// §9, §23 Visual Production Board
// ============================================================

export type BoardItemStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'RUNNING'
  | 'DELAYED'
  | 'AT_RISK'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'MAINTENANCE'
  | 'DOWNTIME';

export type BoardConflictType =
  | 'MACHINE_CONFLICT'
  | 'OPERATOR_CONFLICT'
  | 'MOLD_CONFLICT'
  | 'MAINTENANCE_CONFLICT'
  | 'CAPACITY_CONFLICT'
  | 'DELIVERY_RISK'
  | 'MATERIAL_SHORTAGE'
  | 'LABOR_SHORTAGE';

export interface BoardConflict {
  type: BoardConflictType;
  /** §9.5 — a conflict that makes execution invalid blocks dispatch. */
  blocking: boolean;
  message: string;
  relatedItemIds: string[];
}

/** One bar on the timeline: a work order, or a maintenance window. */
export interface BoardItem {
  id: string;
  kind: 'WORK_ORDER' | 'MAINTENANCE';
  label: string;
  workOrderId?: string;
  workOrderNumber?: string;
  maintenanceRecordId?: string;
  productId?: string;
  productName?: string;
  plantId?: string;
  lineId?: string;
  lineName?: string;
  workCenterId?: string;
  machineId?: string;
  machineName?: string;
  processId?: string;
  processName?: string;
  moldId?: string;
  shiftId?: string;
  operatorIds: string[];
  operatorNames: string[];
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  quantity: number;
  producedQuantity: number;
  progressPercentage: number;
  priority: number;
  status: BoardItemStatus;
  materialStatus?: MaterialReadinessStatus;
  laborStatus?: LaborStatus;
  conflicts: BoardConflict[];
}

export interface BoardLane {
  /** Machine, line or process, depending on the requested view. */
  id: string;
  name: string;
  subtitle?: string;
  items: BoardItem[];
}

export type BoardViewMode = 'MACHINE' | 'LINE' | 'PROCESS' | 'SHIFT' | 'CALENDAR' | 'TIMELINE';

export interface ProductionBoard {
  viewMode: BoardViewMode;
  windowStart: string;
  windowEnd: string;
  lanes: BoardLane[];
  conflicts: BoardConflict[];
  generatedAt: string;
}

export interface ProductionBoardQuery {
  viewMode?: BoardViewMode;
  date?: string;
  days?: number;
  plantId?: string;
  lineId?: string;
  workCenterId?: string;
  machineId?: string;
  processId?: string;
  productId?: string;
  shiftId?: string;
  status?: BoardItemStatus;
  priority?: number;
}

/** §9.6 — what a dispatcher may change, all of it audited. */
export interface DispatchAction {
  action:
    | 'RESCHEDULE'
    | 'REASSIGN_MACHINE'
    | 'REASSIGN_OPERATOR'
    | 'RESEQUENCE'
    | 'REPRIORITISE'
    | 'CONFIRM'
    | 'CANCEL';
  workOrderId: string;
  plannedStart?: string;
  plannedEnd?: string;
  machineId?: string;
  operatorIds?: string[];
  sequence?: number;
  priority?: number;
  reason?: string;
}
