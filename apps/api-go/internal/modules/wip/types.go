// Package wip is WIP and transactional process handoff (Improvement PRD §7,
// §8): WIP records with an aging status, transfers that move quantity into
// transit, and receipts that record what actually arrived, with a reason
// attached to any shortfall.
package wip

// Record is the TypeScript WipRecord (plus the line it sits on, carried for
// the dashboard's "WIP by line" and omitted from JSON like Node's extension).
type Record struct {
	ID                     string   `json:"id"`
	TenantID               string   `json:"tenantId"`
	WipNumber              string   `json:"wipNumber"`
	ProductID              string   `json:"productId"`
	ProductSku             *string  `json:"productSku,omitempty"`
	ProductName            string   `json:"productName"`
	WorkOrderID            string   `json:"workOrderId"`
	WorkOrderNumber        string   `json:"workOrderNumber"`
	BatchID                *string  `json:"batchId,omitempty"`
	BatchNumber            *string  `json:"batchNumber,omitempty"`
	SourceProcessID        *string  `json:"sourceProcessId,omitempty"`
	SourceProcessName      *string  `json:"sourceProcessName,omitempty"`
	DestinationProcessID   *string  `json:"destinationProcessId,omitempty"`
	DestinationProcessName *string  `json:"destinationProcessName,omitempty"`
	Quantity               float64  `json:"quantity"`
	Uom                    string   `json:"uom"`
	Status                 string   `json:"status"`
	LocationID             *string  `json:"locationId,omitempty"`
	LocationName           *string  `json:"locationName,omitempty"`
	QualityStatus          string   `json:"qualityStatus"`
	CreatedBy              string   `json:"createdBy"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
	Notes                  *string  `json:"notes,omitempty"`
	LineID                 *string  `json:"lineId,omitempty"`
	AgeHours               *float64 `json:"ageHours,omitempty"`
	AgingStatus            *string  `json:"agingStatus,omitempty"`
}

// StatusHistory is one WIP status change.
type StatusHistory struct {
	ID         string  `json:"id"`
	WipID      string  `json:"wipId"`
	FromStatus *string `json:"fromStatus,omitempty"`
	ToStatus   string  `json:"toStatus"`
	ChangedBy  string  `json:"changedBy"`
	ChangedAt  string  `json:"changedAt"`
	Reason     *string `json:"reason,omitempty"`
}

// Transfer is the TypeScript WipTransfer.
type Transfer struct {
	ID                         string  `json:"id"`
	TenantID                   string  `json:"tenantId"`
	TransferNumber             string  `json:"transferNumber"`
	WipID                      string  `json:"wipId"`
	ProductID                  string  `json:"productId"`
	ProductName                string  `json:"productName"`
	BatchID                    *string `json:"batchId,omitempty"`
	SourceWorkOrderID          string  `json:"sourceWorkOrderId"`
	SourceWorkOrderNumber      string  `json:"sourceWorkOrderNumber"`
	SourceProcessID            *string `json:"sourceProcessId,omitempty"`
	SourceProcessName          *string `json:"sourceProcessName,omitempty"`
	DestinationWorkOrderID     *string `json:"destinationWorkOrderId,omitempty"`
	DestinationWorkOrderNumber *string `json:"destinationWorkOrderNumber,omitempty"`
	DestinationProcessID       *string `json:"destinationProcessId,omitempty"`
	DestinationProcessName     *string `json:"destinationProcessName,omitempty"`
	Quantity                   float64 `json:"quantity"`
	Uom                        string  `json:"uom"`
	Status                     string  `json:"status"`
	CreatedBy                  string  `json:"createdBy"`
	CreatedByName              *string `json:"createdByName,omitempty"`
	TransferredAt              string  `json:"transferredAt"`
	ReceiptID                  *string `json:"receiptId,omitempty"`
	IdempotencyKey             *string `json:"idempotencyKey,omitempty"`
	Notes                      *string `json:"notes,omitempty"`
}

// Receipt is the TypeScript WipReceipt.
type Receipt struct {
	ID                  string  `json:"id"`
	TenantID            string  `json:"tenantId"`
	WipTransferID       string  `json:"wipTransferId"`
	TransferNumber      string  `json:"transferNumber"`
	ReceivedQuantity    float64 `json:"receivedQuantity"`
	TransferredQuantity float64 `json:"transferredQuantity"`
	VarianceQuantity    float64 `json:"varianceQuantity"`
	VarianceReason      *string `json:"varianceReason,omitempty"`
	Result              string  `json:"result"`
	Uom                 string  `json:"uom"`
	ReceivedBy          string  `json:"receivedBy"`
	ReceivedByName      *string `json:"receivedByName,omitempty"`
	ReceivedAt          string  `json:"receivedAt"`
	IdempotencyKey      *string `json:"idempotencyKey,omitempty"`
	Notes               *string `json:"notes,omitempty"`
}

// ReceiveOutcome is what a receipt returns: the receipt and, when quantity
// landed at a destination work order, the WIP record created there.
type ReceiveOutcome struct {
	Receipt Receipt `json:"receipt"`
	Wip     *Record `json:"wip,omitempty"`
}

// ProcessBucket, LineBucket and ProductBucket are the dashboard groupings.
type ProcessBucket struct {
	ProcessID   string  `json:"processId"`
	ProcessName string  `json:"processName"`
	Quantity    float64 `json:"quantity"`
	Records     int     `json:"records"`
}

// LineBucket is WIP by line.
type LineBucket struct {
	LineID   string  `json:"lineId"`
	LineName string  `json:"lineName"`
	Quantity float64 `json:"quantity"`
	Records  int     `json:"records"`
}

// ProductBucket is WIP by product.
type ProductBucket struct {
	ProductID   string  `json:"productId"`
	ProductName string  `json:"productName"`
	Quantity    float64 `json:"quantity"`
	Records     int     `json:"records"`
}

// AgingCounts is the aging distribution.
type AgingCounts struct {
	Normal   int `json:"normal"`
	Aging    int `json:"aging"`
	Critical int `json:"critical"`
}

// Dashboard is the TypeScript WipDashboard.
type Dashboard struct {
	TotalWip                float64         `json:"totalWip"`
	Uom                     string          `json:"uom"`
	ByProcess               []ProcessBucket `json:"byProcess"`
	ByLine                  []LineBucket    `json:"byLine"`
	ByProduct               []ProductBucket `json:"byProduct"`
	Aging                   AgingCounts     `json:"aging"`
	StuckRecords            int             `json:"stuckRecords"`
	OnHoldQuantity          float64         `json:"onHoldQuantity"`
	WaitingTransferQuantity float64         `json:"waitingTransferQuantity"`
	AgingThresholdHours     float64         `json:"agingThresholdHours"`
	CriticalThresholdHours  float64         `json:"criticalThresholdHours"`
}

// Actor is who performed a WIP action.
type Actor struct {
	ID   string
	Name *string
	Type string // USER | OPERATOR
}

// CreateInput is a new WIP record.
type CreateInput struct {
	WorkOrderID                                  string
	Quantity                                     float64
	ProductID, BatchID                           *string
	SourceProcessID, DestinationProcessID        *string
	Uom, LocationID, LocationName, QualityStatus *string
	Notes                                        *string
}

// TransferInput is a new transfer.
type TransferInput struct {
	WipID                                        string
	Quantity                                     float64
	DestinationWorkOrderID, DestinationProcessID *string
	Notes, IdempotencyKey                        *string
}

// ReceiveInput is a receipt against a transfer.
type ReceiveInput struct {
	ReceivedQuantity                             float64
	VarianceReason                               *string
	DestinationWorkOrderID, DestinationProcessID *string
	Notes, IdempotencyKey                        *string
}

// RecordFilter narrows WIP records.
type RecordFilter struct {
	ID, WorkOrderID, Status, DestinationProcessID, ProductID string
	OpenOnly, AgingOnly                                      bool
	Limit                                                    int
}

// TransferFilter narrows transfers.
type TransferFilter struct {
	ID, WipID, SourceWorkOrderID, DestinationWorkOrderID, Status, IdempotencyKey string
	Limit                                                                        int
}

// ReceiptFilter narrows receipts.
type ReceiptFilter struct {
	WipTransferID, IdempotencyKey string
	Limit                         int
}
