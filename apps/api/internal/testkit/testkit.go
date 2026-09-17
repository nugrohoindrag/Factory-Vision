// Package testkit connects integration tests to the CI database: the
// application role for what the API does, the schema owner for reading the
// rows back — the same split verify-mes-improvement.mjs uses.
package testkit

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Tenant is the pilot tenant every seed writes.
const Tenant = "tenant-pilot-factory-01"

// OtherTenant is a second tenant, created on demand, for isolation checks.
const OtherTenant = "tenant-testkit-other"

// Pools is the pair of connections a test needs.
type Pools struct {
	App   *db.Pool
	Owner *db.Pool
}

// Open connects, or skips the test when DATABASE_URL is not set: the unit
// suite must stay runnable on a laptop without PostgreSQL.
func Open(t *testing.T) *Pools {
	t.Helper()
	appURL := os.Getenv("DATABASE_URL")
	if appURL == "" {
		t.Skip("DATABASE_URL not set; integration test skipped")
	}
	ownerURL := os.Getenv("OWNER_DATABASE_URL")
	if ownerURL == "" {
		ownerURL = appURL
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx := context.Background()
	app, err := db.Open(ctx, appURL, db.Options{MaxConns: 4, Logger: log})
	if err != nil {
		t.Fatalf("app pool: %v", err)
	}
	owner, err := db.Open(ctx, ownerURL, db.Options{MaxConns: 4, Logger: log})
	if err != nil {
		t.Fatalf("owner pool: %v", err)
	}
	t.Cleanup(func() {
		app.Close()
		owner.Close()
	})
	// The isolation checks need a second tenant; the owner can write it
	// because `tenant` keys its policy on id and the owner bypasses RLS.
	if _, err := owner.Exec(ctx,
		`INSERT INTO tenant (id, name, timezone, plan, status) VALUES ($1, 'Testkit Other', 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
		OtherTenant); err != nil {
		t.Fatalf("other tenant: %v", err)
	}
	return &Pools{App: app, Owner: owner}
}

// RequireAppRole fails when the application connection bypasses RLS: the
// isolation tests would pass vacuously against a superuser.
func (p *Pools) RequireAppRole(t *testing.T) {
	t.Helper()
	role, err := p.App.CheckRole(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if role.Bypassed() {
		t.Fatalf("DATABASE_URL connects as %s, which bypasses row-level security; point it at factory_app", role.Name)
	}
}
