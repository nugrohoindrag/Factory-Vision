//go:build integration

package bootstrap

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/testkit"
)

// The demo seed runs on every SEED_DEMO_DATA boot, so it has to be a no-op
// the second time and has to restore the reference rows it owns without
// touching what the shop floor wrote.
func TestDemoSeedIsIdempotent(t *testing.T) {
	pools := testkit.Open(t)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	master, err := masterdata.NewService(pools.App)
	if err != nil {
		t.Fatal(err)
	}
	detached := async.NewRunner(4, time.Second, log)
	loc, _ := time.LoadLocation("Asia/Jakarta")
	prod := production.NewService(pools.App, outbox.Repository{}, detached, log)
	sf := shopfloor.NewService(pools.App, prod, master, outbox.Repository{}, loc, log)
	svc := DemoServices{Pool: pools.App, Master: master, Production: prod, ShopFloor: sf}

	// Disturb a row the seed owns; the upsert puts it back.
	if err := pools.Owner.WithoutTenant(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE plant SET name = 'disturbed' WHERE id = 'plant-cikarang-01'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	plant, err := SeedDemoPlant(ctx, testkit.Tenant, svc)
	if err != nil {
		t.Fatalf("plant: %v", err)
	}
	if plant.Lines != 3 || plant.Products != 7 || plant.Processes != 9 {
		t.Fatalf("plant: %+v", plant)
	}
	var name string
	if err := pools.Owner.QueryRow(ctx, `SELECT name FROM plant WHERE id = 'plant-cikarang-01'`).Scan(&name); err != nil || name != "Main Plant Cikarang" {
		t.Fatalf("plant name after seed: %q %v", name, err)
	}

	first, err := SeedDemoHistory(ctx, testkit.Tenant, svc)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	second, err := SeedDemoHistory(ctx, testkit.Tenant, svc)
	if err != nil {
		t.Fatalf("history again: %v", err)
	}
	if second.ProductionCount != 0 || second.DowntimeCount != 0 {
		t.Fatalf("second run must add nothing, added %+v (first %+v)", second, first)
	}
	// Every generated production row is in the table, whichever run wrote it.
	input, err := demoHistoryInput(ctx, testkit.Tenant, svc)
	if err != nil {
		t.Fatal(err)
	}
	generated, _ := shopfloor.GenerateHistory(input)
	ids := make([]string, len(generated))
	for i, g := range generated {
		ids[i] = g.ID
	}
	var present int
	if err := pools.Owner.QueryRow(ctx, `SELECT count(*) FROM production_record WHERE tenant_id = $1 AND id = ANY($2)`, testkit.Tenant, ids).Scan(&present); err != nil {
		t.Fatal(err)
	}
	if present != len(ids) {
		t.Fatalf("%d of %d generated production rows present", present, len(ids))
	}
}
