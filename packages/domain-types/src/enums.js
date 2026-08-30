/**
 * Factory Vision - MES Domain Enums
 * Aligned with PRD v1.1 and Technical Architecture v1.7
 */
export var DeploymentMode;
(function (DeploymentMode) {
    DeploymentMode["CLOUD_MULTI_TENANT"] = "CLOUD_MULTI_TENANT";
    DeploymentMode["ON_PREMISE_SINGLE_TENANT"] = "ON_PREMISE_SINGLE_TENANT";
})(DeploymentMode || (DeploymentMode = {}));
export var UserRole;
(function (UserRole) {
    UserRole["EXECUTIVE"] = "EXECUTIVE";
    UserRole["PRODUCTION_MANAGER"] = "PRODUCTION_MANAGER";
    UserRole["SUPERVISOR"] = "SUPERVISOR";
    UserRole["OPERATOR"] = "OPERATOR";
    UserRole["PPIC"] = "PPIC";
    UserRole["QUALITY"] = "QUALITY";
    UserRole["ADMIN"] = "ADMIN";
})(UserRole || (UserRole = {}));
export var ProductionOrderStatus;
(function (ProductionOrderStatus) {
    ProductionOrderStatus["DRAFT"] = "DRAFT";
    ProductionOrderStatus["PLANNED"] = "PLANNED";
    ProductionOrderStatus["RELEASED"] = "RELEASED";
    ProductionOrderStatus["IN_PRODUCTION"] = "IN_PRODUCTION";
    ProductionOrderStatus["COMPLETED"] = "COMPLETED";
    ProductionOrderStatus["CANCELLED"] = "CANCELLED";
})(ProductionOrderStatus || (ProductionOrderStatus = {}));
export var WorkOrderStatus;
(function (WorkOrderStatus) {
    WorkOrderStatus["DRAFT"] = "DRAFT";
    WorkOrderStatus["SCHEDULED"] = "SCHEDULED";
    WorkOrderStatus["RELEASED"] = "RELEASED";
    WorkOrderStatus["IN_PROGRESS"] = "IN_PROGRESS";
    WorkOrderStatus["PAUSED"] = "PAUSED";
    WorkOrderStatus["COMPLETED"] = "COMPLETED";
    WorkOrderStatus["CANCELLED"] = "CANCELLED";
})(WorkOrderStatus || (WorkOrderStatus = {}));
export var MachineState;
(function (MachineState) {
    MachineState["RUNNING"] = "RUNNING";
    MachineState["IDLE"] = "IDLE";
    MachineState["DOWNTIME"] = "DOWNTIME";
    MachineState["SETUP"] = "SETUP";
    MachineState["MAINTENANCE"] = "MAINTENANCE";
    MachineState["OFFLINE"] = "OFFLINE";
})(MachineState || (MachineState = {}));
export var DowntimeCategory;
(function (DowntimeCategory) {
    DowntimeCategory["MACHINE"] = "MACHINE";
    DowntimeCategory["MATERIAL"] = "MATERIAL";
    DowntimeCategory["PROCESS"] = "PROCESS";
    DowntimeCategory["QUALITY"] = "QUALITY";
    DowntimeCategory["PEOPLE"] = "PEOPLE";
    DowntimeCategory["PLANNING"] = "PLANNING";
})(DowntimeCategory || (DowntimeCategory = {}));
export var DowntimeStatus;
(function (DowntimeStatus) {
    DowntimeStatus["ACTIVE"] = "ACTIVE";
    DowntimeStatus["RESOLVED"] = "RESOLVED";
})(DowntimeStatus || (DowntimeStatus = {}));
export var RejectCategory;
(function (RejectCategory) {
    RejectCategory["DIMENSION"] = "DIMENSION";
    RejectCategory["APPEARANCE"] = "APPEARANCE";
    RejectCategory["MATERIAL"] = "MATERIAL";
    RejectCategory["ASSEMBLY"] = "ASSEMBLY";
    RejectCategory["FUNCTION"] = "FUNCTION";
    RejectCategory["OTHER"] = "OTHER";
})(RejectCategory || (RejectCategory = {}));
export var RecordSource;
(function (RecordSource) {
    RecordSource["OPERATOR_MANUAL"] = "OPERATOR_MANUAL";
    RecordSource["CSV_IMPORT"] = "CSV_IMPORT";
    RecordSource["MACHINE_COUNTER"] = "MACHINE_COUNTER";
})(RecordSource || (RecordSource = {}));
export var CorrectionStatus;
(function (CorrectionStatus) {
    CorrectionStatus["PENDING"] = "PENDING";
    CorrectionStatus["APPROVED"] = "APPROVED";
    CorrectionStatus["APPLIED"] = "APPLIED";
    CorrectionStatus["REJECTED"] = "REJECTED";
})(CorrectionStatus || (CorrectionStatus = {}));
export var CorrectionEntityType;
(function (CorrectionEntityType) {
    CorrectionEntityType["PRODUCTION_RECORD"] = "PRODUCTION_RECORD";
    CorrectionEntityType["DOWNTIME_RECORD"] = "DOWNTIME_RECORD";
})(CorrectionEntityType || (CorrectionEntityType = {}));
export var OfflineCommandStatus;
(function (OfflineCommandStatus) {
    OfflineCommandStatus["PENDING"] = "PENDING";
    OfflineCommandStatus["SYNCING"] = "SYNCING";
    OfflineCommandStatus["SYNCED"] = "SYNCED";
    OfflineCommandStatus["FAILED"] = "FAILED";
})(OfflineCommandStatus || (OfflineCommandStatus = {}));
//# sourceMappingURL=enums.js.map