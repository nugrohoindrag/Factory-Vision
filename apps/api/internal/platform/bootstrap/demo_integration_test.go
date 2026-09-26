//go:build integration

package bootstrap

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/testkit"
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

	// The catalogue is in place after a run, and a second run adds none of
	// it again: moulds and BOMs are written only where missing.
	again, err := SeedDemoPlant(ctx, testkit.Tenant, svc)
	if err != nil {
		t.Fatalf("plant again: %v", err)
	}
	if again.Materials != len(demoMaterials) || again.Molds != 0 || again.MoldCompatibilities != 0 || again.Boms != 0 || again.BomItems != 0 {
		t.Fatalf("second run must add no moulds or BOMs: %+v", again)
	}
	var molds, activeBoms, items int
	if err := pools.Owner.QueryRow(ctx, `SELECT
		  (SELECT count(*) FROM mold WHERE tenant_id = $1 AND id = ANY($2)),
		  (SELECT count(DISTINCT product_id) FROM bill_of_material WHERE tenant_id = $1 AND status = 'ACTIVE' AND product_id IN ('prod-tire-a','prod-tire-b','prod-tire-c')),
		  (SELECT count(*) FROM bill_of_material_item WHERE tenant_id = $1 AND bom_id = 'bom-tire-a-v21')`,
		testkit.Tenant, demoMoldIDs()).Scan(&molds, &activeBoms, &items); err != nil {
		t.Fatal(err)
	}
	if molds != len(demoMolds) || activeBoms != 3 || items != len(demoBoms[0].lines) {
		t.Fatalf("catalogue after seed: %d molds, %d products with an active BOM, %d lines on bom-tire-a-v21", molds, activeBoms, items)
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
	// Every generated production id is in the table, whichever run wrote it.
	// Two work orders on one line and process generate the same id, and the
	// first wins, so the ids are counted once.
	input, err := demoHistoryInput(ctx, testkit.Tenant, svc)
	if err != nil {
		t.Fatal(err)
	}
	generated, _ := shopfloor.GenerateHistory(input)
	seen := map[string]bool{}
	var ids []string
	for _, g := range generated {
		if !seen[g.ID] {
			seen[g.ID] = true
			ids = append(ids, g.ID)
		}
	}
	var present int
	if err := pools.Owner.QueryRow(ctx, `SELECT count(*) FROM production_record WHERE tenant_id = $1 AND id = ANY($2)`, testkit.Tenant, ids).Scan(&present); err != nil {
		t.Fatal(err)
	}
	if present != len(ids) {
		t.Fatalf("%d of %d generated production rows present", present, len(ids))
	}
}

func demoMoldIDs() []string {
	ids := make([]string, len(demoMolds))
	for i, m := range demoMolds {
		ids[i] = m.id
	}
	return ids
}
