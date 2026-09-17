//go:build integration

package event

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/testkit"
)

// Tenant isolation and append-only are enforced by PostgreSQL, not by the
// Go code, so they are tested against PostgreSQL: a row written under one
// tenant must be invisible under another, and the application role must be
// refused an UPDATE on the timeline.
func TestOperationalEventIsolationAndAppendOnly(t *testing.T) {
	pools := testkit.Open(t)
	pools.RequireAppRole(t)
	ctx := context.Background()
	svc := NewService(pools.App, async.NewRunner(4, 5*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil))))

	written, err := svc.Record(ctx, Input{
		TenantID: testkit.Tenant, EventType: "WO_CREATED", EntityType: "WORK_ORDER", EntityID: "wo-testkit",
		ActorType: "SYSTEM", Summary: "testkit", Metadata: map[string]any{"source": "integration"},
	})
	if err != nil {
		t.Fatalf("record: %v", err)
	}
	if written.ID == "" || written.OccurredAt == "" || written.Metadata["source"] != "integration" {
		t.Fatalf("stored event incomplete: %+v", written)
	}

	own, err := svc.List(ctx, testkit.Tenant, Query{EntityType: "WORK_ORDER", EntityID: "wo-testkit"})
	if err != nil {
		t.Fatal(err)
	}
	if len(own) == 0 || own[0].ID != written.ID {
		t.Fatalf("own tenant must see the event, got %d rows", len(own))
	}

	// The other tenant declares itself and sees nothing, even asking for the
	// row by its subject — the policy filters before the WHERE clause runs.
	other, err := svc.List(ctx, testkit.OtherTenant, Query{EntityType: "WORK_ORDER", EntityID: "wo-testkit"})
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("cross-tenant read returned %d rows", len(other))
	}

	// Append-only by privilege: migration 026 grants factory_app SELECT and
	// INSERT only.
	err = pools.App.WithTenant(ctx, testkit.Tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE operational_event SET summary = 'tampered' WHERE id = $1`, written.ID)
		return err
	})
	if !db.IsInsufficientPrivilege(err) {
		t.Fatalf("UPDATE on operational_event must be refused, got %v", err)
	}
	err = pools.App.WithTenant(ctx, testkit.Tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM operational_event WHERE id = $1`, written.ID)
		return err
	})
	if !db.IsInsufficientPrivilege(err) {
		t.Fatalf("DELETE on operational_event must be refused, got %v", err)
	}

	// Keyset pagination continues strictly after the cursor.
	first, err := svc.List(ctx, testkit.Tenant, Query{Limit: db.Ptr(1)})
	if err != nil || len(first) != 1 {
		t.Fatalf("first page: %v %d", err, len(first))
	}
	next, err := svc.List(ctx, testkit.Tenant, Query{Limit: db.Ptr(1), Cursor: first[0].OccurredAt + "|" + first[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(next) == 1 && next[0].ID == first[0].ID {
		t.Fatal("cursor page repeated the first row")
	}

	// Housekeeping as the owner, which holds DELETE.
	if _, err := pools.Owner.Exec(ctx, `DELETE FROM operational_event WHERE entity_id = 'wo-testkit'`); err != nil {
		t.Fatal(err)
	}
}
