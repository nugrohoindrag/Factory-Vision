// Package event is the Operational Event History (Improvement PRD §10).
//
// Every capability the improvement adds writes here, which is what lets one
// screen answer "apa yang terjadi pada WO ini" without each module inventing
// its own timeline. Writes are append-only and never block the operation
// that caused them: Record returns an error, RecordDetached does not, and
// callers whose work is already committed use the latter.
package event

// OperationalEvent is one row of the timeline (§10.4), field for field the
// TypeScript OperationalEvent.
type OperationalEvent struct {
	ID          string         `json:"id"`
	TenantID    string         `json:"tenantId"`
	EventType   string         `json:"eventType"`
	EntityType  string         `json:"entityType"`
	EntityID    string         `json:"entityId"`
	ActorType   string         `json:"actorType"` // USER | OPERATOR | SYSTEM
	ActorID     *string        `json:"actorId,omitempty"`
	ActorName   *string        `json:"actorName,omitempty"`
	OccurredAt  string         `json:"occurredAt"`
	PlantID     *string        `json:"plantId,omitempty"`
	LineID      *string        `json:"lineId,omitempty"`
	MachineID   *string        `json:"machineId,omitempty"`
	ProcessID   *string        `json:"processId,omitempty"`
	WorkOrderID *string        `json:"workOrderId,omitempty"`
	BatchID     *string        `json:"batchId,omitempty"`
	Summary     string         `json:"summary"`
	BeforeValue any            `json:"beforeValue,omitempty"`
	AfterValue  any            `json:"afterValue,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// Input is what a caller supplies; the service fills in id and timestamp.
type Input struct {
	TenantID    string
	EventType   string
	EntityType  string
	EntityID    string
	ActorType   string
	ActorID     *string
	ActorName   *string
	OccurredAt  string // optional
	PlantID     *string
	LineID      *string
	MachineID   *string
	ProcessID   *string
	WorkOrderID *string
	BatchID     *string
	Summary     string
	BeforeValue any
	AfterValue  any
	Metadata    map[string]any
}

// Query filters the timeline.
type Query struct {
	EntityType  string
	EntityID    string
	EventType   string
	WorkOrderID string
	MachineID   string
	BatchID     string
	From        string
	To          string
	Limit       *int
	Offset      *int
	// Cursor is the additive keyset form: "<occurredAt>|<id>" of the last
	// row seen, for timelines too long for OFFSET.
	Cursor string
}

// Summary is one row of the per-type count.
type Summary struct {
	EventType string `json:"eventType"`
	Count     int    `json:"count"`
}
