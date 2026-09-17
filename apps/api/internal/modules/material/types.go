// Package material is material, inventory and MRP (Improvement PRD §11–§13):
// warehouses, stock with its reserved and incoming slices, BOM explosion
// into requirements, reservations against work orders, consumption with
// variance, and the MRP run over planning demand.
//
// Every stock movement is one ledger row (material_transaction) plus the
// running balance on material_inventory, written in the same transaction.
package material

// Warehouse is a stock location.
type Warehouse struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenantId"`
	PlantID       *string `json:"plantId,omitempty"`
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	WarehouseType string  `json:"warehouseType"`
	Status        string  `json:"status"`
}

// Inventory is the TypeScript MaterialInventory.
type Inventory struct {
	ID                string   `json:"id"`
	TenantID          string   `json:"tenantId"`
	MaterialID        string   `json:"materialId"`
	MaterialSKU       string   `json:"materialSku"`
	MaterialName      string   `json:"materialName"`
	WarehouseID       string   `json:"warehouseId"`
	WarehouseName     string   `json:"warehouseName"`
	UOM               string   `json:"uom"`
	OnHandQuantity    float64  `json:"onHandQuantity"`
	ReservedQuantity  float64  `json:"reservedQuantity"`
	IncomingQuantity  float64  `json:"incomingQuantity"`
	AvailableQuantity float64  `json:"availableQuantity"`
	ReorderPoint      *float64 `json:"reorderPoint,omitempty"`
	SafetyStock       *float64 `json:"safetyStock,omitempty"`
	State             string   `json:"state"`
	UpdatedAt         string   `json:"updatedAt"`
}

// Transaction is one ledger row, the TypeScript MaterialTransaction.
type Transaction struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	MaterialID      string  `json:"materialId"`
	MaterialSKU     string  `json:"materialSku"`
	MaterialName    string  `json:"materialName"`
	WarehouseID     *string `json:"warehouseId,omitempty"`
	TransactionType string  `json:"transactionType"`
	Quantity        float64 `json:"quantity"`
	UOM             string  `json:"uom"`
	BalanceAfter    float64 `json:"balanceAfter"`
	ReferenceType   *string `json:"referenceType,omitempty"`
	ReferenceID     *string `json:"referenceId,omitempty"`
	Reason          *string `json:"reason,omitempty"`
	ActorID         string  `json:"actorId"`
	ActorName       *string `json:"actorName,omitempty"`
	OccurredAt      string  `json:"occurredAt"`
}

// Reservation is the TypeScript MaterialReservation.
type Reservation struct {
	ID               string  `json:"id"`
	TenantID         string  `json:"tenantId"`
	MaterialID       string  `json:"materialId"`
	MaterialSKU      string  `json:"materialSku"`
	MaterialName     string  `json:"materialName"`
	WarehouseID      *string `json:"warehouseId,omitempty"`
	WorkOrderID      *string `json:"workOrderId,omitempty"`
	WorkOrderNumber  *string `json:"workOrderNumber,omitempty"`
	ProductionPlanID *string `json:"productionPlanId,omitempty"`
	Quantity         float64 `json:"quantity"`
	UOM              string  `json:"uom"`
	Status           string  `json:"status"` // RESERVED | ISSUED | RELEASED | CONSUMED
	ReservedBy       string  `json:"reservedBy"`
	ReservedAt       string  `json:"reservedAt"`
	ReleasedAt       *string `json:"releasedAt,omitempty"`
	Notes            *string `json:"notes,omitempty"`
}

// Requirement is the TypeScript MaterialRequirement.
type Requirement struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	SourceType        string  `json:"sourceType"`
	SourceID          string  `json:"sourceId"`
	SourceLabel       string  `json:"sourceLabel"`
	MaterialID        string  `json:"materialId"`
	MaterialSKU       string  `json:"materialSku"`
	MaterialName      string  `json:"materialName"`
	BomID             *string `json:"bomId,omitempty"`
	BomNumber         *string `json:"bomNumber,omitempty"`
	Level             int     `json:"level"`
	RequiredQuantity  float64 `json:"requiredQuantity"`
	OnHandQuantity    float64 `json:"onHandQuantity"`
	ReservedQuantity  float64 `json:"reservedQuantity"`
	IncomingQuantity  float64 `json:"incomingQuantity"`
	AvailableQuantity float64 `json:"availableQuantity"`
	ShortageQuantity  float64 `json:"shortageQuantity"`
	UOM               string  `json:"uom"`
	RequirementDate   string  `json:"requirementDate"`
	Status            string  `json:"status"`
	WarehouseID       *string `json:"warehouseId,omitempty"`
	CreatedAt         string  `json:"createdAt"`
}

// Readiness is the TypeScript MaterialReadiness.
type Readiness struct {
	SourceType           string        `json:"sourceType"`
	SourceID             string        `json:"sourceId"`
	SourceLabel          string        `json:"sourceLabel"`
	Status               string        `json:"status"`
	ReadinessPercentage  float64       `json:"readinessPercentage"`
	TotalRequirements    int           `json:"totalRequirements"`
	ReadyRequirements    int           `json:"readyRequirements"`
	ShortageRequirements int           `json:"shortageRequirements"`
	CheckedAt            string        `json:"checkedAt"`
	Requirements         []Requirement `json:"requirements"`
}

// Consumption is the TypeScript MaterialConsumption.
type Consumption struct {
	ID                 string  `json:"id"`
	TenantID           string  `json:"tenantId"`
	WorkOrderID        string  `json:"workOrderId"`
	WorkOrderNumber    string  `json:"workOrderNumber"`
	BatchID            *string `json:"batchId,omitempty"`
	ProcessID          *string `json:"processId,omitempty"`
	MachineID          *string `json:"machineId,omitempty"`
	MaterialID         string  `json:"materialId"`
	MaterialSKU        string  `json:"materialSku"`
	MaterialName       string  `json:"materialName"`
	WarehouseID        *string `json:"warehouseId,omitempty"`
	PlannedQuantity    float64 `json:"plannedQuantity"`
	ActualQuantity     float64 `json:"actualQuantity"`
	VarianceQuantity   float64 `json:"varianceQuantity"`
	VariancePercentage float64 `json:"variancePercentage"`
	UOM                string  `json:"uom"`
	ConsumptionType    string  `json:"consumptionType"` // PRODUCTION | SCRAP | REWORK | RETURN
	Status             string  `json:"status"`          // NORMAL | OVER_CONSUMPTION | UNDER_CONSUMPTION
	OperatorID         *string `json:"operatorId,omitempty"`
	OperatorName       *string `json:"operatorName,omitempty"`
	RecordedBy         string  `json:"recordedBy"`
	ConsumedAt         string  `json:"consumedAt"`
	IdempotencyKey     *string `json:"idempotencyKey,omitempty"`
	Notes              *string `json:"notes,omitempty"`
}

// VarianceRow is one material of the consumption variance view.
type VarianceRow struct {
	MaterialID         string  `json:"materialId"`
	MaterialSKU        string  `json:"materialSku"`
	MaterialName       string  `json:"materialName"`
	PlannedQuantity    float64 `json:"plannedQuantity"`
	ActualQuantity     float64 `json:"actualQuantity"`
	VarianceQuantity   float64 `json:"varianceQuantity"`
	VariancePercentage float64 `json:"variancePercentage"`
	UOM                string  `json:"uom"`
	Status             string  `json:"status"`
}

// MrpRun is the TypeScript MrpRun.
type MrpRun struct {
	ID                string   `json:"id"`
	TenantID          string   `json:"tenantId"`
	RunNumber         string   `json:"runNumber"`
	HorizonStart      string   `json:"horizonStart"`
	HorizonEnd        string   `json:"horizonEnd"`
	Status            string   `json:"status"`
	DemandSource      string   `json:"demandSource"`
	PlanIDs           []string `json:"planIds"`
	TotalMaterials    int      `json:"totalMaterials"`
	ShortageMaterials int      `json:"shortageMaterials"`
	RunBy             string   `json:"runBy"`
	StartedAt         string   `json:"startedAt"`
	CompletedAt       *string  `json:"completedAt,omitempty"`
	ErrorMessage      *string  `json:"errorMessage,omitempty"`
	Notes             *string  `json:"notes,omitempty"`
}

// MrpResult is the TypeScript MrpResult.
type MrpResult struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	MrpRunID          string  `json:"mrpRunId"`
	MaterialID        string  `json:"materialId"`
	MaterialSKU       string  `json:"materialSku"`
	MaterialName      string  `json:"materialName"`
	Level             int     `json:"level"`
	GrossRequirement  float64 `json:"grossRequirement"`
	OnHandQuantity    float64 `json:"onHandQuantity"`
	ReservedQuantity  float64 `json:"reservedQuantity"`
	IncomingQuantity  float64 `json:"incomingQuantity"`
	AvailableQuantity float64 `json:"availableQuantity"`
	NetRequirement    float64 `json:"netRequirement"`
	UOM               string  `json:"uom"`
	RequirementDate   string  `json:"requirementDate"`
	RequirementSource string  `json:"requirementSource"`
	Status            string  `json:"status"`
	Recommendation    *string `json:"recommendation,omitempty"`
}

// MrpOutcome is a run with its results.
type MrpOutcome struct {
	Run     MrpRun      `json:"run"`
	Results []MrpResult `json:"results"`
}

// DemandLine is one plan line planning hands to material (M5 fills the
// source; the shape is planning's PlanDemandLine).
type DemandLine struct {
	ProductionPlanID string  `json:"productionPlanId"`
	PlanNumber       string  `json:"planNumber"`
	ProductID        string  `json:"productId"`
	PlannedQuantity  float64 `json:"plannedQuantity"`
	RequiredDate     string  `json:"requiredDate"`
}

// Actor is who performed a material action.
type Actor struct {
	ID   string
	Name *string
	Type string // USER | OPERATOR
}

// Movement is one stock change: the ledger row and the balance update.
type Movement struct {
	TenantID        string
	MaterialID      string
	WarehouseID     string
	TransactionType string
	OnHandDelta     float64
	ReservedDelta   float64
	IncomingDelta   float64
	UOM             string
	ReferenceType   *string
	ReferenceID     *string
	Reason          *string
	ActorID         string
	ActorName       *string
}

// StockTotal is a material's stock summed over warehouses.
type StockTotal struct {
	OnHand, Reserved, Incoming, Available float64
	UOM                                   string
}

// InventoryFilter narrows a stock listing.
type InventoryFilter struct {
	MaterialID   string
	WarehouseID  string
	BelowReorder bool
	Search       string
}

// TransactionFilter narrows the ledger.
type TransactionFilter struct {
	MaterialID, ReferenceID, From, To string
	Limit                             int
}

// ReservationFilter narrows reservations.
type ReservationFilter struct {
	WorkOrderID, MaterialID, Status string
}

// RequirementFilter narrows stored requirements.
type RequirementFilter struct {
	SourceType, SourceID, Status string
}

// ConsumptionFilter narrows consumption.
type ConsumptionFilter struct {
	WorkOrderID, MaterialID, Status, IdempotencyKey, From, To string
	Limit                                                     int
}
