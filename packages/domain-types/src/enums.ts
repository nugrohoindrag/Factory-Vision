/**
 * Factory Vision - MES Domain Enums
 * Aligned with PRD v1.1 and Technical Architecture v1.7
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
  ADMIN = 'ADMIN',
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
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
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

export enum ProductionBatchStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  HOLD = 'HOLD',
  SCRAPPED = 'SCRAPPED',
}
