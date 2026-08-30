/**
 * Factory Vision, Platform contracts
 *
 * Authentication, RBAC, API envelope, CSV onboarding, shift handover and the
 * analytics contracts introduced by PRD v1.5 (US-001-US-054). Kept apart
 * from `entities.ts` so the MES domain model stays readable; both are
 * re-exported from the package root.
 */

import { UserRole, DowntimeCategory, RejectCategory } from './enums.js';
import { AppUser, Operator, KpiStatus } from './entities.js';

// ============================================================
// US-054, API foundation: envelope, errors, pagination
// ============================================================

/** Machine-readable error codes. The console maps these to Indonesian copy. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'OUT_OF_SCOPE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

/** One field-level validation failure. */
export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * The single error shape every `/api/v1` endpoint returns on failure
 * (US-054: validation errors use a consistent structure).
 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: ApiFieldError[];
    /** Correlates the failure with the server log line and the audit entry. */
    requestId: string;
  };
}

/** Pagination envelope for list endpoints that opt into it (US-054). */
export interface Paginated<T> {
  data: T[];
  page: {
    number: number;
    size: number;
    totalItems: number;
    totalPages: number;
  };
}

/** Query convention shared by every paginated list endpoint. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

// ============================================================
// US-003, US-006, Permissions & roles
// ============================================================

/** Permission identifier, always `module:action`. */
export type PermissionId = string;

export interface PermissionDefinition {
  id: PermissionId;
  module: string;
  action: string;
  description: string;
  /**
   * Privileged permissions may only be granted by a user who already holds
   * them, and never to a custom role below Production Manager.
   */
  privileged: boolean;
}

/**
 * A role, either one of the seven system roles from or a
 * tenant-defined custom role.
 */
export interface RoleDefinition {
  id: string;
  tenantId: string;
  /** Stable key. System roles use the `UserRole` value. */
  key: string;
  name: string;
  description: string;
  /** System roles cannot be renamed, re-permissioned or deleted. */
  system: boolean;
  permissions: PermissionId[];
  /** Where the role lands after login (, landing page follows role). */
  landingPath: string;
  createdAt: string;
  updatedAt: string;
}

/** Operational scope attached to a session. */
export interface AccessScope {
  level: 'TENANT' | 'PLANT' | 'LINE' | 'WORK_CENTER';
  /** Absent for TENANT level. */
  id?: string;
  /** Plant/line/work-center ids the session may read, resolved at login. */
  plantIds: string[];
  lineIds: string[];
  workCenterIds: string[];
}

// ============================================================
// US-001, US-002, Sessions
// ============================================================

export type SessionKind = 'APPLICATION' | 'OPERATOR';

export interface SessionPrincipal {
  sessionId: string;
  kind: SessionKind;
  tenantId: string;
  /** `AppUser.id` for application sessions, `Operator.id` for operator ones. */
  subjectId: string;
  name: string;
  role: UserRole;
  permissions: PermissionId[];
  scope: AccessScope;
  issuedAt: string;
  /** Absolute expiry. Operator sessions are deliberately short. */
  expiresAt: string;
  /** Idle expiry, refreshed on every authenticated request. */
  idleExpiresAt: string;
  landingPath: string;
}

export interface LoginResponse {
  token: string;
  principal: SessionPrincipal;
  user?: AppUser;
  operator?: Operator;
  /** Seconds of inactivity after which the session is dropped. */
  idleTimeoutSeconds: number;
}

/** A live session shown to an admin so it can be revoked (US-005). */
export interface SessionSummary {
  sessionId: string;
  kind: SessionKind;
  subjectId: string;
  name: string;
  role: UserRole;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
}

// ============================================================
// US-008, CSV import / export
// ============================================================

/** Master-data collections that support CSV onboarding. */
export type CsvEntity =
  | 'products'
  | 'machines'
  | 'lines'
  | 'operators'
  | 'processes'
  | 'routings'
  | 'machine-rates'
  | 'shifts'
  | 'downtime-reasons'
  | 'reject-reasons';

export interface CsvColumnSpec {
  name: string;
  required: boolean;
  description: string;
  /** Referenced master-data entity, when the column is a foreign key. */
  references?: CsvEntity;
  example: string;
}

export interface CsvTemplate {
  entity: CsvEntity;
  label: string;
  columns: CsvColumnSpec[];
  /** Header row + one example row, ready to download. */
  csv: string;
}

export interface CsvRowError {
  /** 1-based row number as it appears in the uploaded file, header excluded. */
  row: number;
  column?: string;
  code: 'REQUIRED' | 'INVALID_FORMAT' | 'UNKNOWN_REFERENCE' | 'DUPLICATE' | 'OUT_OF_SCOPE';
  message: string;
}

export interface CsvImportResult {
  entity: CsvEntity;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: CsvRowError[];
  /** True when nothing was written because the file failed structural checks. */
  rejectedWholeFile: boolean;
}

// ============================================================
// US-023, Shift handover
// ============================================================

export interface ShiftHandoverRecord {
  id: string;
  tenantId: string;
  lineId: string;
  shiftId: string;
  shiftDate: string;
  outgoingSupervisorId: string;
  outgoingSupervisorName: string;
  incomingSupervisorId?: string;
  incomingSupervisorName?: string;
  notes: string;
  openIssues: string[];
  acknowledgedAt?: string;
  createdAt: string;
}

/** Everything a supervisor needs on the handover screen (US-022, US-023). */
export interface ShiftHandoverContext {
  lineId: string;
  lineName: string;
  shiftId: string;
  shiftName: string;
  shiftDate: string;
  targetQuantity: number;
  goodQuantity: number;
  rejectQuantity: number;
  achievementPct: number;
  remainingTarget: number;
  rejectRatePct: number;
  downtimeMinutes: number;
  unplannedDowntimeMinutes: number;
  topDowntimeReason: string | null;
  topRejectReason: string | null;
  openWorkOrders: Array<{
    id: string;
    woNumber: string;
    productName: string;
    status: string;
    achievementPct: number;
  }>;
  activeDowntimeCount: number;
  previousHandover: ShiftHandoverRecord | null;
}

// ============================================================
// US-025, Target vs Actual
// ============================================================

export type TargetVsActualDimension = 'LINE' | 'PROCESS' | 'PRODUCT' | 'SHIFT' | 'DATE';

export interface TargetVsActualRow {
  dimension: TargetVsActualDimension;
  key: string;
  label: string;
  targetQuantity: number;
  actualQuantity: number;
  rejectQuantity: number;
  variance: number;
  achievementPct: number;
  status: KpiStatus;
  /** Straight-line projection to the end of the window; null when unknowable. */
  forecastQuantity: number | null;
  forecastAchievementPct: number | null;
}

export interface TargetVsActualSummary {
  dimension: TargetVsActualDimension;
  totalTarget: number;
  totalActual: number;
  totalVariance: number;
  achievementPct: number;
  status: KpiStatus;
  rows: TargetVsActualRow[];
}

// ============================================================
// US-027, US-037, OEE drill-down and bottleneck
// ============================================================

/** Machine-grain OEE, the leaf of the Process-to-Machine drill-down (US-027). */
export interface MachinePerformanceRow {
  machineId: string;
  machineCode: string;
  machineName: string;
  workCenterId: string;
  workCenterName: string;
  processId: string | null;
  processName: string | null;
  lineId: string;
  lineName: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  goodQuantity: number;
  rejectQuantity: number;
  targetQuantity: number;
  achievementPct: number;
  plannedMinutes: number;
  runMinutes: number;
  downtimeMinutes: number;
  idealCycleSeconds: number | null;
  /**
   * True when no Product × Machine rate is configured. forbids a
   * silent default, so Performance is withheld rather than guessed.
   */
  idealCycleMissing: boolean;
  status: KpiStatus;
}

export type BottleneckKind = 'PROCESS' | 'MACHINE';

/** One rank in the bottleneck ladder (US-037). */
export interface BottleneckRow {
  kind: BottleneckKind;
  rank: number;
  entityId: string;
  entityName: string;
  /** Parent context, the line for a process, the process for a machine. */
  contextLabel: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  /**
   * Units lost against target across the window. The ranking key: the biggest
   * constraint is the one that costs the most output.
   */
  lostUnits: number;
  lostUnitsPct: number;
  downtimeMinutes: number;
  rejectQuantity: number;
  /** Which of the three OEE factors dominates the loss. */
  dominantLoss: 'AVAILABILITY' | 'PERFORMANCE' | 'QUALITY';
  dominantLossPct: number;
  drillDownPath: string;
}

// ============================================================
// US-032-US-036, OEE calculation configuration and validation
// ============================================================

/**
 * Tenant-level OEE configuration. Every stored OEE row
 * carries the `calcVersion` that produced it so a definition change is
 * traceable rather than retroactive.
 */
export interface OeeCalculationConfig {
  tenantId: string;
  calcVersion: number;
  /**, whether planned downtime is removed from Planned Production Time. */
  pptExcludesPlannedDowntime: boolean;
  /** Rate source precedence when resolving Ideal Cycle Time. */
  idealCycleSource: 'PRODUCT_MACHINE' | 'ROUTING' | 'PRODUCT';
  /**, never substitute a default when the rate is missing. */
  allowIdealCycleFallback: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** One reproducible OEE computation with its inputs exposed (US-032-US-035). */
export interface OeeCalculationResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  inputs: {
    plannedProductionSeconds: number;
    plannedDowntimeSeconds: number;
    unplannedDowntimeSeconds: number;
    runTimeSeconds: number;
    idealCycleSeconds: number | null;
    goodCount: number;
    rejectCount: number;
    totalCount: number;
  };
  calcVersion: number;
  pptExcludesPlannedDowntime: boolean;
  /** Set when Ideal Cycle Time is unknown; Performance and OEE are then 0. */
  idealCycleMissing: boolean;
  computedAt: string;
}

/** The six pilot validation items V1-V6 from */
export type OeeValidationItem = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

export type OeeValidationGapClass = 'DEFINITION' | 'DATA_CAPTURE' | 'MASTER_DATA' | 'NONE';

export interface OeeValidationEntry {
  id: string;
  tenantId: string;
  item: OeeValidationItem;
  title: string;
  /** The pilot area under validation, a line, process or machine. */
  scopeLabel: string;
  shiftDate: string;
  mesValue: number | null;
  factoryValue: number | null;
  gap: number | null;
  gapClass: OeeValidationGapClass;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
  resolution: string;
  /** Configuration change + recompute, never an ad-hoc patch. */
  resolvedByConfigChange: boolean;
  calcVersion: number;
  notes: string;
  recordedBy: string;
  recordedAt: string;
  updatedAt: string;
}

// ============================================================
// US-041, OEE report
// ============================================================

export interface OeeReportItem {
  shiftDate: string;
  shiftId: string;
  shiftName: string;
  lineId: string;
  lineName: string;
  machineId: string;
  machineName: string;
  processId: string | null;
  processName: string | null;
  productId: string | null;
  productName: string | null;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  plannedMinutes: number;
  runMinutes: number;
  downtimeMinutes: number;
  goodQuantity: number;
  rejectQuantity: number;
  totalQuantity: number;
  idealCycleMissing: boolean;
  calcVersion: number;
}

// ============================================================
// US-045, US-046, Offline sync reporting
// ============================================================

export interface SyncCommandResult {
  clientEventId: string;
  status: 'APPLIED' | 'DUPLICATE' | 'FAILED';
  entityId?: string;
  errorCode?: ApiErrorCode;
  errorMessage?: string;
  /** True when the command may be retried; false means it is permanently bad. */
  retryable: boolean;
}

export interface SyncBatchResult {
  processed: number;
  applied: number;
  duplicates: number;
  failed: number;
  results: SyncCommandResult[];
  serverTime: string;
}

// ============================================================
// US-052, US-053, Deployment
// ============================================================

export interface DeploymentInfo {
  mode: 'CLOUD_MULTI_TENANT' | 'ON_PREMISE_SINGLE_TENANT';
  version: string;
  apiVersion: string;
  /** On-premise pins a single tenant; cloud resolves it per request. */
  tenantId: string | null;
  features: {
    multiTenant: boolean;
    offlineTerminal: boolean;
    realtime: boolean;
  };
  serverTime: string;
}

/** Downtime/reject reason grouping used by the CSV templates and pickers. */
export type ReasonCategory = DowntimeCategory | RejectCategory;
