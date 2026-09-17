// Package quality is the quality lifecycle (Improvement PRD §14–§18):
// inspection plans and their characteristics, inspections judged against
// them, holds, dispositions (which move a work order's scrap and rework),
// non-conformance records with corrective actions, and the transfer gate a
// WIP handoff consults.
package quality

// Characteristic is one measured or judged attribute of a plan.
type Characteristic struct {
	ID               string   `json:"id"`
	InspectionPlanID string   `json:"inspectionPlanId"`
	Sequence         int      `json:"sequence"`
	Name             string   `json:"name"`
	DataType         string   `json:"dataType"` // NUMERIC | ATTRIBUTE
	Specification    *string  `json:"specification,omitempty"`
	LowerLimit       *float64 `json:"lowerLimit,omitempty"`
	UpperLimit       *float64 `json:"upperLimit,omitempty"`
	TargetValue      *float64 `json:"targetValue,omitempty"`
	UOM              *string  `json:"uom,omitempty"`
	Required         bool     `json:"required"`
}

// Plan is the TypeScript InspectionPlan.
type Plan struct {
	ID               string           `json:"id"`
	TenantID         string           `json:"tenantId"`
	PlanNumber       string           `json:"planNumber"`
	Name             string           `json:"name"`
	InspectionType   string           `json:"inspectionType"`
	ProductID        *string          `json:"productId,omitempty"`
	ProductName      *string          `json:"productName,omitempty"`
	ProcessID        *string          `json:"processId,omitempty"`
	ProcessName      *string          `json:"processName,omitempty"`
	SamplingMethod   string           `json:"samplingMethod"`
	SamplingQuantity *float64         `json:"samplingQuantity,omitempty"`
	Frequency        *string          `json:"frequency,omitempty"`
	Mandatory        bool             `json:"mandatory"`
	Status           string           `json:"status"` // DRAFT | ACTIVE | INACTIVE
	Characteristics  []Characteristic `json:"characteristics"`
	CreatedBy        *string          `json:"createdBy,omitempty"`
	CreatedAt        string           `json:"createdAt"`
	UpdatedAt        string           `json:"updatedAt"`
}

// ResultLine is one measurement of an inspection.
type ResultLine struct {
	ID                 string   `json:"id"`
	InspectionID       string   `json:"inspectionId"`
	CharacteristicID   string   `json:"characteristicId"`
	CharacteristicName string   `json:"characteristicName"`
	ExpectedValue      *string  `json:"expectedValue,omitempty"`
	ActualValue        *string  `json:"actualValue,omitempty"`
	NumericValue       *float64 `json:"numericValue,omitempty"`
	Result             string   `json:"result"` // PASS | FAIL
	Notes              *string  `json:"notes,omitempty"`
}

// Inspection is the TypeScript Inspection.
type Inspection struct {
	ID                 string       `json:"id"`
	TenantID           string       `json:"tenantId"`
	InspectionNumber   string       `json:"inspectionNumber"`
	InspectionPlanID   *string      `json:"inspectionPlanId,omitempty"`
	InspectionPlanName *string      `json:"inspectionPlanName,omitempty"`
	InspectionType     string       `json:"inspectionType"`
	WorkOrderID        *string      `json:"workOrderId,omitempty"`
	WorkOrderNumber    *string      `json:"workOrderNumber,omitempty"`
	BatchID            *string      `json:"batchId,omitempty"`
	BatchNumber        *string      `json:"batchNumber,omitempty"`
	ProductID          *string      `json:"productId,omitempty"`
	ProductName        *string      `json:"productName,omitempty"`
	ProcessID          *string      `json:"processId,omitempty"`
	MachineID          *string      `json:"machineId,omitempty"`
	InspectedQuantity  float64      `json:"inspectedQuantity"`
	PassedQuantity     float64      `json:"passedQuantity"`
	FailedQuantity     float64      `json:"failedQuantity"`
	UOM                *string      `json:"uom,omitempty"`
	Result             string       `json:"result"`
	OperatorID         *string      `json:"operatorId,omitempty"`
	OperatorName       *string      `json:"operatorName,omitempty"`
	InspectorID        string       `json:"inspectorId"`
	InspectorName      string       `json:"inspectorName"`
	InspectedAt        string       `json:"inspectedAt"`
	DispositionID      *string      `json:"dispositionId,omitempty"`
	IdempotencyKey     *string      `json:"idempotencyKey,omitempty"`
	Notes              *string      `json:"notes,omitempty"`
	Lines              []ResultLine `json:"lines"`
}

// Disposition is the TypeScript QualityDisposition.
type Disposition struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	InspectionID    *string `json:"inspectionId,omitempty"`
	QualityHoldID   *string `json:"qualityHoldId,omitempty"`
	WorkOrderID     *string `json:"workOrderId,omitempty"`
	WorkOrderNumber *string `json:"workOrderNumber,omitempty"`
	BatchID         *string `json:"batchId,omitempty"`
	ProductID       *string `json:"productId,omitempty"`
	Decision        string  `json:"decision"` // RELEASE | REWORK | SCRAP | HOLD | RETURN
	Quantity        float64 `json:"quantity"`
	UOM             *string `json:"uom,omitempty"`
	Reason          string  `json:"reason"`
	DefectCode      *string `json:"defectCode,omitempty"`
	NcrID           *string `json:"ncrId,omitempty"`
	DecidedBy       string  `json:"decidedBy"`
	DecidedByName   *string `json:"decidedByName,omitempty"`
	DecidedAt       string  `json:"decidedAt"`
}

// Hold is the TypeScript QualityHold.
type Hold struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	HoldNumber      string  `json:"holdNumber"`
	WorkOrderID     *string `json:"workOrderId,omitempty"`
	WorkOrderNumber *string `json:"workOrderNumber,omitempty"`
	BatchID         *string `json:"batchId,omitempty"`
	BatchNumber     *string `json:"batchNumber,omitempty"`
	ProductID       *string `json:"productId,omitempty"`
	ProductName     *string `json:"productName,omitempty"`
	MaterialID      *string `json:"materialId,omitempty"`
	InspectionID    *string `json:"inspectionId,omitempty"`
	Quantity        float64 `json:"quantity"`
	UOM             *string `json:"uom,omitempty"`
	Reason          string  `json:"reason"`
	OwnerID         string  `json:"ownerId"`
	OwnerName       string  `json:"ownerName"`
	Status          string  `json:"status"` // OPEN | RELEASED | DISPOSITIONED
	HeldBy          string  `json:"heldBy"`
	HeldAt          string  `json:"heldAt"`
	ReleasedBy      *string `json:"releasedBy,omitempty"`
	ReleasedAt      *string `json:"releasedAt,omitempty"`
	DispositionID   *string `json:"dispositionId,omitempty"`
	Notes           *string `json:"notes,omitempty"`
}

// Action is the TypeScript CorrectiveAction.
type Action struct {
	ID          string  `json:"id"`
	TenantID    string  `json:"tenantId"`
	NcrID       string  `json:"ncrId"`
	Sequence    int     `json:"sequence"`
	Action      string  `json:"action"`
	OwnerID     string  `json:"ownerId"`
	OwnerName   string  `json:"ownerName"`
	DueDate     *string `json:"dueDate,omitempty"`
	Status      string  `json:"status"` // OPEN | IN_PROGRESS | COMPLETED | VERIFIED | CANCELLED
	CompletedAt *string `json:"completedAt,omitempty"`
	CompletedBy *string `json:"completedBy,omitempty"`
	VerifiedAt  *string `json:"verifiedAt,omitempty"`
	VerifiedBy  *string `json:"verifiedBy,omitempty"`
	Evidence    *string `json:"evidence,omitempty"`
	Notes       *string `json:"notes,omitempty"`
}

// Ncr is the TypeScript NonConformanceRecord.
type Ncr struct {
	ID              string   `json:"id"`
	TenantID        string   `json:"tenantId"`
	NcrNumber       string   `json:"ncrNumber"`
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Severity        string   `json:"severity"`
	Status          string   `json:"status"`
	ProductID       *string  `json:"productId,omitempty"`
	ProductName     *string  `json:"productName,omitempty"`
	BatchID         *string  `json:"batchId,omitempty"`
	WorkOrderID     *string  `json:"workOrderId,omitempty"`
	WorkOrderNumber *string  `json:"workOrderNumber,omitempty"`
	ProcessID       *string  `json:"processId,omitempty"`
	MachineID       *string  `json:"machineId,omitempty"`
	OperatorID      *string  `json:"operatorId,omitempty"`
	DefectCode      *string  `json:"defectCode,omitempty"`
	InspectionID    *string  `json:"inspectionId,omitempty"`
	Quantity        *float64 `json:"quantity,omitempty"`
	UOM             *string  `json:"uom,omitempty"`
	RootCause       *string  `json:"rootCause,omitempty"`
	OwnerID         string   `json:"ownerId"`
	OwnerName       string   `json:"ownerName"`
	RaisedBy        string   `json:"raisedBy"`
	RaisedAt        string   `json:"raisedAt"`
	DueDate         *string  `json:"dueDate,omitempty"`
	ClosedBy        *string  `json:"closedBy,omitempty"`
	ClosedAt        *string  `json:"closedAt,omitempty"`
	Actions         []Action `json:"actions"`
}

// Gate is the transfer gate's answer.
type Gate struct {
	Blocked bool    `json:"blocked"`
	Reason  *string `json:"reason,omitempty"`
}

// Dashboard is the quality overview.
type Dashboard struct {
	FirstPassYield    float64 `json:"firstPassYield"`
	InspectedQuantity float64 `json:"inspectedQuantity"`
	PassedQuantity    float64 `json:"passedQuantity"`
	FailedQuantity    float64 `json:"failedQuantity"`
	FailRate          float64 `json:"failRate"`
	Inspections       int     `json:"inspections"`
	FailedInspections int     `json:"failedInspections"`
	OpenHolds         int     `json:"openHolds"`
	HeldQuantity      float64 `json:"heldQuantity"`
	ReworkQuantity    float64 `json:"reworkQuantity"`
	ScrapQuantity     float64 `json:"scrapQuantity"`
	OpenNcr           int     `json:"openNcr"`
	OverdueNcr        int     `json:"overdueNcr"`
	From              string  `json:"from"`
	To                string  `json:"to"`
}

// Actor is who performed a quality action.
type Actor struct {
	ID   string
	Name *string
	Type string
}

// PlanFilter narrows plans.
type PlanFilter struct{ ProductID, ProcessID, Status string }

// InspectionFilter narrows inspections.
type InspectionFilter struct {
	WorkOrderID, BatchID, ProductID, Result, IdempotencyKey, From, To string
	Limit                                                             int
}

// HoldFilter narrows holds.
type HoldFilter struct{ ID, Status, WorkOrderID, BatchID string }

// DispositionFilter narrows dispositions.
type DispositionFilter struct {
	WorkOrderID, InspectionID, Decision string
	Limit                               int
}

// NcrFilter narrows NCRs.
type NcrFilter struct {
	ID, Status, WorkOrderID string
	Overdue                 bool
	Limit                   int
}
