//go:build integration

package outbox

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/testkit"
)

// Port of qa-outbox-relay.mjs: an event published in a transaction is
// delivered once and marked PUBLISHED; a subscriber failure leaves the row
// PENDING with the attempt counted, and stays FAILED after MaxAttempts.
func TestRelayDeliversAndRecordsFailures(t *testing.T) {
	pools := testkit.Open(t)
	ctx := context.Background()
	repo := Repository{}

	// A rolled-back transaction leaves no event behind.
	sentinel := errors.New("rollback")
	err := pools.App.WithTenant(ctx, testkit.Tenant, func(tx pgx.Tx) error {
		if err := repo.Publish(ctx, tx, testkit.Tenant, Event{Type: "TestkitRolledBack", AggregateType: "testkit", AggregateID: "x", Payload: map[string]any{"n": 0}}); err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected rollback, got %v", err)
	}
	var rolledBack int
	if err := pools.Owner.QueryRow(ctx, `SELECT count(*) FROM outbox_event WHERE event_type = 'TestkitRolledBack'`).Scan(&rolledBack); err != nil {
		t.Fatal(err)
	}
	if rolledBack != 0 {
		t.Fatalf("rolled-back event persisted %d rows", rolledBack)
	}

	if err := pools.App.WithTenant(ctx, testkit.Tenant, func(tx pgx.Tx) error {
		return repo.PublishAll(ctx, tx, testkit.Tenant, []Event{
			{Type: "TestkitOK", AggregateType: "testkit", AggregateID: "a", Payload: map[string]any{"n": 1}},
			{Type: "TestkitBad", AggregateType: "testkit", AggregateID: "b", Payload: map[string]any{"n": 2}},
		})
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	relay := NewRelay(pools.App, slog.New(slog.NewTextHandler(io.Discard, nil)))
	var seen []string
	relay.Subscribe(func(_ context.Context, e Row) error {
		if e.EventType == "TestkitBad" {
			return errors.New("subscriber refuses")
		}
		seen = append(seen, e.EventType)
		return nil
	})
	res, err := relay.RelayTenant(ctx, testkit.Tenant, 50)
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	if res.Failed != 1 {
		t.Fatalf("expected one failure, got %+v", res)
	}
	ok := false
	for _, s := range seen {
		if s == "TestkitOK" {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("subscriber never saw TestkitOK: %v", seen)
	}

	var status string
	var attempts int
	if err := pools.Owner.QueryRow(ctx, `SELECT status, attempts FROM outbox_event WHERE tenant_id = $1 AND event_type = 'TestkitOK' ORDER BY occurred_at DESC LIMIT 1`, testkit.Tenant).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "PUBLISHED" || attempts != 1 {
		t.Fatalf("delivered event: status=%s attempts=%d", status, attempts)
	}
	if err := pools.Owner.QueryRow(ctx, `SELECT status, attempts FROM outbox_event WHERE tenant_id = $1 AND event_type = 'TestkitBad' ORDER BY occurred_at DESC LIMIT 1`, testkit.Tenant).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "PENDING" || attempts != 1 {
		t.Fatalf("failed event after one attempt: status=%s attempts=%d", status, attempts)
	}

	// Keep failing: after MaxAttempts the row is FAILED and no longer offered.
	for i := 0; i < MaxAttempts; i++ {
		if _, err := relay.RelayTenant(ctx, testkit.Tenant, 50); err != nil {
			t.Fatal(err)
		}
	}
	if err := pools.Owner.QueryRow(ctx, `SELECT status, attempts FROM outbox_event WHERE tenant_id = $1 AND event_type = 'TestkitBad' ORDER BY occurred_at DESC LIMIT 1`, testkit.Tenant).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "FAILED" || attempts != MaxAttempts {
		t.Fatalf("exhausted event: status=%s attempts=%d", status, attempts)
	}
	tenants, err := relay.TenantsWithPending(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range tenants {
		if id == testkit.Tenant {
			var pending int
			_ = pools.Owner.QueryRow(ctx, `SELECT count(*) FROM outbox_event WHERE tenant_id = $1 AND status = 'PENDING' AND event_type LIKE 'Testkit%'`, testkit.Tenant).Scan(&pending)
			if pending > 0 {
				t.Fatalf("testkit events still pending: %d", pending)
			}
		}
	}
}
