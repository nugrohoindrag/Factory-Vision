// Package outbox is the transactional outbox (Architecture §176).
//
// A module that changes state writes the event describing it with the same
// transaction as the change, so an event for a rolled-back write cannot
// exist and a committed write cannot go unannounced. Delivery is somebody
// else's job: the relay (fv worker, or the API when it runs the relay)
// claims PENDING rows with SKIP LOCKED and hands them to subscribers — the
// SSE hub today, webhooks tomorrow.
package outbox

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Event is what a module publishes. The realtime names the console once
// received over socket.io (work-order:updated, production:output-recorded,
// downtime:started, …) are event types here, so the SSE stream carries the
// same vocabulary.
type Event struct {
	Type          string
	AggregateType string
	AggregateID   string
	Payload       any
}

// Row is a stored event as the relay reads it.
type Row struct {
	ID            string         `json:"id"`
	TenantID      string         `json:"tenantId"`
	EventType     string         `json:"eventType"`
	AggregateType string         `json:"aggregateType"`
	AggregateID   string         `json:"aggregateId"`
	Payload       map[string]any `json:"payload"`
	OccurredAt    string         `json:"occurredAt"`
}

// Writer appends events inside a caller's transaction.
type Writer interface {
	Publish(ctx context.Context, tx pgx.Tx, tenantID string, e Event) error
}

// Repository is the outbox_event table.
type Repository struct{}

// Publish appends one event to the caller's transaction.
func (Repository) Publish(ctx context.Context, tx pgx.Tx, tenantID string, e Event) error {
	payload, err := db.JSONB(e.Payload)
	if err != nil {
		return fmt.Errorf("outbox payload: %w", err)
	}
	if payload == nil {
		payload = []byte("{}")
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO outbox_event (id, tenant_id, event_type, aggregate_type, aggregate_id, payload, occurred_at, status)
		 VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'PENDING')`,
		"evt-"+uuid.NewString(), tenantID, e.Type, e.AggregateType, e.AggregateID, payload)
	return err
}

// PublishAll appends several events in order.
func (r Repository) PublishAll(ctx context.Context, tx pgx.Tx, tenantID string, events []Event) error {
	for _, e := range events {
		if err := r.Publish(ctx, tx, tenantID, e); err != nil {
			return err
		}
	}
	return nil
}

// Discard is a Writer that drops events, for tests and for tools that must
// not announce what they do (the migrator, the demo seed).
type Discard struct{}

// Publish drops the event.
func (Discard) Publish(context.Context, pgx.Tx, string, Event) error { return nil }
