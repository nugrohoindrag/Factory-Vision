/**
 * Factory Vision - MES Domain Enums
 * Aligned with PRD v1.6, Technical Architecture v1.9, and Technical Design Final v1.0
 */

export enum DeploymentMode {
  CLOUD_MULTI_TENANT = 'CLOUD_MULTI_TENANT',
  ON_PREMISE_SINGLE_TENANT = 'ON_PREMISE_SINGLE_TENANT',
}

export enum UserRole {
  EXECUTIVE = 'EXECUTIVE',
  PRODUCTION_MANAGER = 'PRODUCTION_MANAGER',
  SUPERVISOR = 'SUPERVISOR',
  OPERATOR = 'OPERATOR',
  PPIC = 'PPIC',
  QUALITY = 'QUALITY',
  /**
   * Receives and records Customer Orders (Improvement PRD §5, §8.1).
   *
   * Order Receiving is Sales' decision and nobody else's; everything after it —
   * forecast, capacity, plan, work orders — belongs to PPIC. The role exists so
   * that ownership is enforced rather than merely documented.
   */
  SALES = 'SALES',
  ADMIN = 'ADMIN',
}

export enum CustomerOrderStatus {
  RECEIVED = 'RECEIVED',
  PLANNED = 'PLANNED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  PRODUCED = 'PRODUCED',
  READY_TO_SHIP = 'READY_TO_SHIP',
  SHIPPED = 'SHIPPED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum OrderChannel {
  KANBAN_CARD = 'KANBAN_CARD',
  EMAIL = 'EMAIL',
  INVOICE = 'INVOICE',
  PO_DOCUMENT = 'PO_DOCUMENT',
  MANUAL = 'MANUAL',
}

export enum DemandForecastStatus {
  DRAFT = 'DRAFT',
  GENERATED = 'GENERATED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum DemandForecastMethod {
  HISTORICAL_AVERAGE = 'HISTORICAL_AVERAGE',
}

export enum CapacityPlanStatus {
  DRAFT = 'DRAFT',
  COMPUTED = 'COMPUTED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum CapacityStatus {
  WITHIN_PLAN = 'WITHIN_PLAN',
  ADDITIONAL_DEMAND = 'ADDITIONAL_DEMAND',
  CAPACITY_UP_REQUIRED = 'CAPACITY_UP_REQUIRED',
}

export enum CapacityUpResponseType {
  ADDITIONAL_SHIFT = 'ADDITIONAL_SHIFT',
  OVERTIME = 'OVERTIME',
  ADDITIONAL_MACHINE = 'ADDITIONAL_MACHINE',
  PARALLEL_MACHINE = 'PARALLEL_MACHINE',
  ADDITIONAL_OPERATOR = 'ADDITIONAL_OPERATOR',
  RESCHEDULE = 'RESCHEDULE',
}

export enum CapacityUpRequestStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  APPLIED = 'APPLIED',
}

export enum ProductionPlanStatus {
  DRAFT = 'DRAFT',
  PLANNING = 'PLANNING',
  READY = 'READY',
  CONFIRMED = 'CONFIRMED',
  IN_EXECUTION = 'IN_EXECUTION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum MoldStatus {
  AVAILABLE = 'AVAILABLE',
  IN_USE = 'IN_USE',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

export enum ProductionOrderStatus {
  DRAFT = 'DRAFT',
  PLANNED = 'PLANNED',
  RELEASED = 'RELEASED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum WorkOrderStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ProductionBatchStatus {
  PLANNED = 'PLANNED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  // Legacy aliases
  ACTIVE = 'ACTIVE',
  HOLD = 'HOLD',
  SCRAPPED = 'SCRAPPED',
}

export enum MachineState {
  RUNNING = 'RUNNING',
  IDLE = 'IDLE',
  DOWNTIME = 'DOWNTIME',
  SETUP = 'SETUP',
  OFFLINE = 'OFFLINE',
}

export enum DowntimeCategory {
  MACHINE = 'MACHINE',
  MATERIAL = 'MATERIAL',
  PROCESS = 'PROCESS',
  QUALITY = 'QUALITY',
  PEOPLE = 'PEOPLE',
  PLANNING = 'PLANNING',
}

export enum DowntimeStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
}

export enum RejectCategory {
  DIMENSION = 'DIMENSION',
  APPEARANCE = 'APPEARANCE',
  MATERIAL = 'MATERIAL',
  ASSEMBLY = 'ASSEMBLY',
  FUNCTION = 'FUNCTION',
  OTHER = 'OTHER',
}

export enum RecordSource {
  OPERATOR_MANUAL = 'OPERATOR_MANUAL',
  CSV_IMPORT = 'CSV_IMPORT',
  MACHINE_COUNTER = 'MACHINE_COUNTER',
}

export enum CorrectionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
}

export enum CorrectionEntityType {
  PRODUCTION_RECORD = 'PRODUCTION_RECORD',
  DOWNTIME_RECORD = 'DOWNTIME_RECORD',
}

export enum OfflineCommandStatus {
  PENDING = 'PENDING',
  SYNCING = 'SYNCING',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
}
