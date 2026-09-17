// Package shopfloor is shop-floor capture (US-014 … US-020, US-045,
// US-046): production output, downtime, the machine state each implies,
// and the offline sync that replays a terminal's queue exactly once.
//
// Every method writes PostgreSQL before it answers. These records are the
// MES system of record: good and reject quantity, downtime start and end,
// and the shift context each belongs to are what every OEE figure and
// every report is derived from.
package shopfloor

// ProductionRecord is one output capture, field for field the TypeScript
// ProductionRecord.
type ProductionRecord struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	WorkOrderID       string  `json:"workOrderId"`
	ProcessID         *string `json:"processId,omitempty"`
	BatchID           *string `json:"batchId,omitempty"`
	MachineID         string  `json:"machineId"`
	OperatorID        string  `json:"operatorId"`
	ShiftID           string  `json:"shiftId"`
	ShiftDate         string  `json:"shiftDate"`
	GoodQuantity      int     `json:"goodQuantity"`
	RejectQuantity    int     `json:"rejectQuantity"`
	RejectReasonID    *string `json:"rejectReasonId,omitempty"`
	RecordedAt        string  `json:"recordedAt"`
	Source            string  `json:"source"`
	ClientEventID     string  `json:"clientEventId"`
	CorrectionOfID    *string `json:"correctionOfId,omitempty"`
	Notes             *string `json:"notes,omitempty"`
	InputQuantity     int     `json:"inputQuantity"`
	ScrapQuantity     int     `json:"scrapQuantity"`
	ReworkQuantity    int     `json:"reworkQuantity"`
	IsBatchManaged    bool    `json:"isBatchManaged"`
	HasChildWorkOrder bool    `json:"hasChildWorkOrder"`
}

// DowntimeRecord is one stoppage, field for field the TypeScript
// DowntimeRecord.
type DowntimeRecord struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	WorkOrderID     *string `json:"workOrderId,omitempty"`
	ProcessID       *string `json:"processId,omitempty"`
	MachineID       string  `json:"machineId"`
	LineID          string  `json:"lineId"`
	OperatorID      *string `json:"operatorId,omitempty"`
	ShiftID         string  `json:"shiftId"`
	ShiftDate       string  `json:"shiftDate"`
	ReasonID        string  `json:"reasonId"`
	StartTime       string  `json:"startTime"`
	EndTime         *string `json:"endTime,omitempty"`
	DurationSeconds *int    `json:"durationSeconds,omitempty"`
	IsPlanned       bool    `json:"isPlanned"`
	Notes           *string `json:"notes,omitempty"`
	ClientEventID   string  `json:"clientEventId"`
	Status          string  `json:"status"`
}

// SyncException is a command the shop floor captured and the server
// refused (MES-082), with the work order number and line name joined for
// display.
type SyncException struct {
	ID              string         `json:"id"`
	TenantID        string         `json:"tenantId"`
	ClientEventID   string         `json:"clientEventId"`
	CommandType     string         `json:"commandType"`
	WorkOrderID     *string        `json:"workOrderId,omitempty"`
	OperatorID      *string        `json:"operatorId,omitempty"`
	Payload         map[string]any `json:"payload"`
	OccurredAt      *string        `json:"occurredAt,omitempty"`
	ErrorCode       string         `json:"errorCode"`
	Reason          string         `json:"reason"`
	Retryable       bool           `json:"retryable"`
	LineID          *string        `json:"lineId,omitempty"`
	ShiftDate       *string        `json:"shiftDate,omitempty"`
	Status          string         `json:"status"`
	ResolvedBy      *string        `json:"resolvedBy,omitempty"`
	ResolvedAt      *string        `json:"resolvedAt,omitempty"`
	ResolutionNote  *string        `json:"resolutionNote,omitempty"`
	CreatedAt       *string        `json:"createdAt,omitempty"`
	WorkOrderNumber *string        `json:"workOrderNumber,omitempty"`
	LineName        *string        `json:"lineName,omitempty"`
}

// ExceptionSummaryRow is the open count for one line.
type ExceptionSummaryRow struct {
	LineID   *string `json:"lineId,omitempty"`
	LineName *string `json:"lineName,omitempty"`
	Count    int     `json:"count"`
}

// ExceptionFilter narrows the exception list.
type ExceptionFilter struct {
	LineID      string
	ShiftDate   string
	Status      string
	WorkOrderID string
	Limit       int
}

// SyncCommand is one queued command from an operator terminal.
type SyncCommand struct {
	Type          string         `json:"type"`
	ClientEventID string         `json:"clientEventId"`
	Payload       map[string]any `json:"payload"`
	OccurredAt    string         `json:"occurredAt"`
	WorkOrderID   string         `json:"workOrderId"`
}

// SyncCommandResult is the individual outcome the terminal acts on.
type SyncCommandResult struct {
	ClientEventID string  `json:"clientEventId"`
	Status        string  `json:"status"` // APPLIED | DUPLICATE | FAILED
	EntityID      *string `json:"entityId,omitempty"`
	ErrorCode     *string `json:"errorCode,omitempty"`
	ErrorMessage  *string `json:"errorMessage,omitempty"`
	Retryable     bool    `json:"retryable"`
}

// SyncBatchResult is the reply to a sync-batch.
type SyncBatchResult struct {
	Processed  int                 `json:"processed"`
	Applied    int                 `json:"applied"`
	Duplicates int                 `json:"duplicates"`
	Failed     int                 `json:"failed"`
	Results    []SyncCommandResult `json:"results"`
	ServerTime string              `json:"serverTime"`
}

// OutputInput is a production output capture.
type OutputInput struct {
	WorkOrderID    string
	MachineID      *string
	OperatorID     string
	ShiftID        *string
	GoodQuantity   int
	RejectQuantity int
	RejectReasonID *string
	ClientEventID  string
	OccurredAt     string
	Notes          *string
}

// DowntimeInput is a downtime start.
type DowntimeInput struct {
	MachineID     string
	LineID        *string
	WorkOrderID   *string
	OperatorID    *string
	ShiftID       *string
	ReasonID      string
	Notes         *string
	ClientEventID string
	OccurredAt    string
}

// ResolveInput closes a downtime.
type ResolveInput struct {
	ClientEventID string
	OccurredAt    string
}

// ProductionRecordFilter narrows a production record listing.
type ProductionRecordFilter struct {
	WorkOrderID   string
	FromShiftDate string
	ToShiftDate   string
	Limit         int
	Offset        int
}

// DowntimeFilter narrows a downtime listing.
type DowntimeFilter struct {
	LineID        string
	FromShiftDate string
	ToShiftDate   string
	Limit         int
	Offset        int
}
