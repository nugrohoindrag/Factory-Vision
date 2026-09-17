// Package production is the execution core: production orders, work orders
// and their lifecycle (§11), batches (§12), the quantity flow invariants
// (§10), the process chain (§13) and the dynamic split (§25.7).
//
// Every write runs inside one tenant transaction so the state machine
// judges the status that is actually stored, and the machine-state effect,
// the split roll-up and the outbox row commit with the status they describe.
package production

// WorkOrderStatus is the v1.0 lifecycle (ADR-18).
const (
	StatusDraft        = "DRAFT"
	StatusScheduled    = "SCHEDULED"
	StatusConfirmed    = "CONFIRMED"
	StatusInProduction = "IN_PRODUCTION"
	StatusCompleted    = "COMPLETED"
	StatusCancelled    = "CANCELLED"
)

// WorkOrder is the TypeScript WorkOrder, field for field. The seven flow
// quantities are never optional (ADR-23); targetQuantity and goodQuantity
// are the deprecated aliases the console still reads.
type WorkOrder struct {
	ID                     string  `json:"id"`
	TenantID               string  `json:"tenantId"`
	ProductionPlanLineID   *string `json:"productionPlanLineId,omitempty"`
	ParentWorkOrderID      *string `json:"parentWorkOrderId,omitempty"`
	PredecessorWorkOrderID *string `json:"predecessorWorkOrderId,omitempty"`
	WoNumber               string  `json:"woNumber"`
	ProductID              string  `json:"productId"`
	ProcessID              *string `json:"processId,omitempty"`
	RoutingID              *string `json:"routingId,omitempty"`
	Sequence               *int    `json:"sequence,omitempty"`
	IsBatchManaged         bool    `json:"isBatchManaged"`
	HasChildWorkOrder      bool    `json:"hasChildWorkOrder"`
	LineID                 string  `json:"lineId"`
	WorkCenterID           *string `json:"workCenterId,omitempty"`
	MachineID              *string `json:"machineId,omitempty"`
	MoldID                 *string `json:"moldId,omitempty"`
	ShiftID                *string `json:"shiftId,omitempty"`
	PlannedQuantity        int     `json:"plannedQuantity"`
	TargetQuantity         int     `json:"targetQuantity"`
	InputQuantity          int     `json:"inputQuantity"`
	OutputQuantity         int     `json:"outputQuantity"`
	GoodQuantity           int     `json:"goodQuantity"`
	RejectQuantity         int     `json:"rejectQuantity"`
	ScrapQuantity          int     `json:"scrapQuantity"`
	ReworkQuantity         int     `json:"reworkQuantity"`
	TransferredQuantity    int     `json:"transferredQuantity"`
	Unit                   string  `json:"unit"`
	PlannedStart           string  `json:"plannedStart"`
	PlannedEnd             string  `json:"plannedEnd"`
	ActualStart            *string `json:"actualStart,omitempty"`
	ActualEnd              *string `json:"actualEnd,omitempty"`
	Status                 string  `json:"status"`
	Priority               int     `json:"priority"`
	ConfirmedBy            *string `json:"confirmedBy,omitempty"`
	ConfirmedAt            *string `json:"confirmedAt,omitempty"`
	StatusReason           *string `json:"statusReason,omitempty"`
	Version                int     `json:"version"`
	CreatedAt              string  `json:"createdAt"`
	UpdatedAt              string  `json:"updatedAt"`
	ProductionOrderID      *string `json:"productionOrderId,omitempty"`
}

// Flow is the work order's quantity flow, the shape the invariants judge.
func (w WorkOrder) Flow() Flow {
	planned := w.PlannedQuantity
	return Flow{
		PlannedQuantity:     &planned,
		InputQuantity:       w.InputQuantity,
		OutputQuantity:      w.OutputQuantity,
		RejectQuantity:      w.RejectQuantity,
		ScrapQuantity:       w.ScrapQuantity,
		ReworkQuantity:      w.ReworkQuantity,
		TransferredQuantity: w.TransferredQuantity,
	}
}

// ProductionOrder is the legacy sales-side order a routing was expanded from.
type ProductionOrder struct {
	ID          string `json:"id"`
	TenantID    string `json:"tenantId"`
	OrderNumber string `json:"orderNumber"`
	ProductID   string `json:"productId"`
	Quantity    int    `json:"quantity"`
	DueDate     string `json:"dueDate"`
	Status      string `json:"status"`
	CreatedBy   string `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
}

// Batch is a subdivision of one work order's execution (ADR-29).
type Batch struct {
	ID                   string  `json:"id"`
	TenantID             string  `json:"tenantId"`
	BatchNumber          string  `json:"batchNumber"`
	WorkOrderID          string  `json:"workOrderId"`
	ProductID            string  `json:"productId"`
	ProcessID            *string `json:"processId,omitempty"`
	Sequence             int     `json:"sequence"`
	PlannedQuantity      int     `json:"plannedQuantity"`
	InputQuantity        int     `json:"inputQuantity"`
	OutputQuantity       int     `json:"outputQuantity"`
	RejectQuantity       int     `json:"rejectQuantity"`
	ScrapQuantity        int     `json:"scrapQuantity"`
	ReworkQuantity       int     `json:"reworkQuantity"`
	TransferredQuantity  int     `json:"transferredQuantity"`
	Status               string  `json:"status"`
	StatusReason         *string `json:"statusReason,omitempty"`
	MaterialLotReference *string `json:"materialLotReference,omitempty"`
	MachineID            *string `json:"machineId,omitempty"`
	MoldID               *string `json:"moldId,omitempty"`
	OperatorID           *string `json:"operatorId,omitempty"`
	ShiftID              *string `json:"shiftId,omitempty"`
	ProductionDate       string  `json:"productionDate"`
	ExpiryDate           *string `json:"expiryDate,omitempty"`
	ActualStart          *string `json:"actualStart,omitempty"`
	ActualEnd            *string `json:"actualEnd,omitempty"`
	Version              int     `json:"version"`
	CreatedAt            string  `json:"createdAt"`
	UpdatedAt            string  `json:"updatedAt"`
	ProductionOrderID    *string `json:"productionOrderId,omitempty"`
}

// ChainNode is one work order as the process chain shows it (MES-018-3).
type ChainNode struct {
	WorkOrderID         string  `json:"workOrderId"`
	WoNumber            string  `json:"woNumber"`
	ProcessID           *string `json:"processId,omitempty"`
	Sequence            *int    `json:"sequence,omitempty"`
	Status              string  `json:"status"`
	PlannedQuantity     int     `json:"plannedQuantity"`
	InputQuantity       int     `json:"inputQuantity"`
	OutputQuantity      int     `json:"outputQuantity"`
	TransferredQuantity int     `json:"transferredQuantity"`
	ParentWorkOrderID   *string `json:"parentWorkOrderId,omitempty"`
	IsSplitParent       bool    `json:"isSplitParent"`
}

// Chain is the process chain around one work order.
type Chain struct {
	WorkOrder         ChainNode   `json:"workOrder"`
	Predecessors      []ChainNode `json:"predecessors"`
	Predecessor       *ChainNode  `json:"predecessor,omitempty"`
	Successors        []ChainNode `json:"successors"`
	IsFirstProcess    bool        `json:"isFirstProcess"`
	IsLastProcess     bool        `json:"isLastProcess"`
	AvailableQuantity int         `json:"availableQuantity"`
}

// SplitPart is one child of a dynamic split (§25.7).
type SplitPart struct {
	PlannedQuantity float64 `json:"plannedQuantity"`
	MachineID       *string `json:"machineId,omitempty"`
	WorkCenterID    *string `json:"workCenterId,omitempty"`
	MoldID          *string `json:"moldId,omitempty"`
	ShiftID         *string `json:"shiftId,omitempty"`
	PlannedStart    *string `json:"plannedStart,omitempty"`
	PlannedEnd      *string `json:"plannedEnd,omitempty"`
}

// SplitResult is what a split returns: the flagged parent and its children.
type SplitResult struct {
	Parent   WorkOrder   `json:"parent"`
	Children []WorkOrder `json:"children"`
}

// WorkOrderFilter narrows a listing; "ALL" and "" mean unfiltered.
type WorkOrderFilter struct {
	LineID    string
	Status    string
	ProcessID string
	Limit     int
	Offset    int
}

// Stamps are the columns a status transition may set alongside the status.
type Stamps struct {
	ActualStart  *string
	ActualEnd    *string
	ConfirmedBy  *string
	ConfirmedAt  *string
	StatusReason *string
}

// Patch is the subset of columns the planner's edit form may change.
type Patch struct {
	PlannedQuantity        *int
	PlannedStart           *string
	PlannedEnd             *string
	Priority               *int
	MachineID              *string
	MoldID                 *string
	ShiftID                *string
	ProcessID              *string
	RoutingID              *string
	LineID                 *string
	WorkCenterID           *string
	ProductID              *string
	Sequence               *int
	Unit                   *string
	IsBatchManaged         *bool
	HasChildWorkOrder      *bool
	ProductionPlanLineID   *string
	ParentWorkOrderID      *string
	PredecessorWorkOrderID *string
}

// Increment is what a production record adds to a work order's counters.
type Increment struct {
	Good        int
	Reject      int
	Scrap       int
	Rework      int
	Input       int
	Transferred int
	// Output overrides good when set (a batch aggregation, a correction).
	Output *int
}
