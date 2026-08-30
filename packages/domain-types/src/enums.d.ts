/**
 * Factory Vision - MES Domain Enums
 * Aligned with PRD v1.1 and Technical Architecture v1.7
 */
export declare enum DeploymentMode {
  CLOUD_MULTI_TENANT = 'CLOUD_MULTI_TENANT',
  ON_PREMISE_SINGLE_TENANT = 'ON_PREMISE_SINGLE_TENANT',
}
export declare enum UserRole {
  EXECUTIVE = 'EXECUTIVE',
  PRODUCTION_MANAGER = 'PRODUCTION_MANAGER',
  SUPERVISOR = 'SUPERVISOR',
  OPERATOR = 'OPERATOR',
  PPIC = 'PPIC',
  QUALITY = 'QUALITY',
  ADMIN = 'ADMIN',
}
export declare enum ProductionOrderStatus {
  DRAFT = 'DRAFT',
  PLANNED = 'PLANNED',
  RELEASED = 'RELEASED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
export declare enum WorkOrderStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
export declare enum MachineState {
  RUNNING = 'RUNNING',
  IDLE = 'IDLE',
  DOWNTIME = 'DOWNTIME',
  SETUP = 'SETUP',
  MAINTENANCE = 'MAINTENANCE',
  OFFLINE = 'OFFLINE',
}
export declare enum DowntimeCategory {
  MACHINE = 'MACHINE',
  MATERIAL = 'MATERIAL',
  PROCESS = 'PROCESS',
  QUALITY = 'QUALITY',
  PEOPLE = 'PEOPLE',
  PLANNING = 'PLANNING',
}
export declare enum DowntimeStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
}
export declare enum RejectCategory {
  DIMENSION = 'DIMENSION',
  APPEARANCE = 'APPEARANCE',
  MATERIAL = 'MATERIAL',
  ASSEMBLY = 'ASSEMBLY',
  FUNCTION = 'FUNCTION',
  OTHER = 'OTHER',
}
export declare enum RecordSource {
  OPERATOR_MANUAL = 'OPERATOR_MANUAL',
  CSV_IMPORT = 'CSV_IMPORT',
  MACHINE_COUNTER = 'MACHINE_COUNTER',
}
export declare enum CorrectionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
}
export declare enum CorrectionEntityType {
  PRODUCTION_RECORD = 'PRODUCTION_RECORD',
  DOWNTIME_RECORD = 'DOWNTIME_RECORD',
}
export declare enum OfflineCommandStatus {
  PENDING = 'PENDING',
  SYNCING = 'SYNCING',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
}
//# sourceMappingURL=enums.d.ts.map
