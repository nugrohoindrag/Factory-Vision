// Package bootstrap seeds what a SEED_DEMO_DATA install shows on first boot:
// the pilot tyre plant's reference rows, its demo production orders and sixty
// days of deterministic shop-floor history. Every write is an upsert or a
// DO NOTHING, so a second boot adds nothing and never resets a work order the
// shop floor has advanced.
package bootstrap

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/fixtures"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// DemoServices are the services the seed writes through, so their caches
// see what it wrote.
type DemoServices struct {
	Pool       *db.Pool
	Master     *masterdata.Service
	Production *production.Service
	ShopFloor  *shopfloor.Service
}

// PlantResult counts what the plant seed covered. Materials counts the
// catalogue rows upserted; Molds, MoldCompatibilities, Boms and BomItems count
// only the rows this run added, so a second run reports zero for them.
type PlantResult struct {
	Plants, Lines, Processes, Products, ProductionOrders  int
	Materials, Molds, MoldCompatibilities, Boms, BomItems int
}

// HistoryResult counts the rows the history seed added.
type HistoryResult struct {
	ProductionCount, DowntimeCount int
}

// SeedDemoPlant upserts the demo plant's reference rows and inserts the
// demo production orders that are missing, in one transaction: a
// half-seeded plant never becomes visible. Order matters — `work_order`
// references `product`, `production_process` and `production_line`.
func SeedDemoPlant(ctx context.Context, tenantID string, svc DemoServices) (PlantResult, error) {
	plant := fixtures.LoadDemoPlant()
	var out PlantResult
	err := svc.Pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// The tenant itself is the root of every foreign key in the schema.
		if _, err := tx.Exec(ctx, `INSERT INTO tenant (id, name, timezone, plan, status) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, tenantID, plant.Tenant.Name, plant.Tenant.Timezone, plant.Tenant.Plan, plant.Tenant.Status); err != nil {
			return err
		}
		for _, p := range plant.Plants {
			if p.TenantID != tenantID {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO plant (id, tenant_id, name, location, timezone, status) VALUES ($1,$2,$3,$4,$5,$6)
				ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
				p.ID, tenantID, p.Name, p.Location, db.Deref(p.Timezone, "Asia/Jakarta"), db.Deref(p.Status, "ACTIVE")); err != nil {
				return err
			}
			out.Plants++
		}
		for _, l := range plant.Lines {
			if l.TenantID != tenantID {
				continue
			}
			minutes := 480
			if l.PlannedProductionTimeMinutes != nil {
				minutes = *l.PlannedProductionTimeMinutes
			}
			if _, err := tx.Exec(ctx, `INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, planned_production_time_minutes = EXCLUDED.planned_production_time_minutes`,
				l.ID, tenantID, l.PlantID, l.Code, l.Name, db.Deref(l.Status, "ACTIVE"), minutes); err != nil {
				return err
			}
			out.Lines++
		}
		for _, p := range plant.Processes {
			if p.TenantID != tenantID {
				continue
			}
			sequence := 1
			if p.SequenceDefault != nil {
				sequence = *p.SequenceDefault
			}
			if _, err := tx.Exec(ctx, `INSERT INTO production_process (id, tenant_id, code, name, description, sequence_default, status) VALUES ($1,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sequence_default = EXCLUDED.sequence_default, status = EXCLUDED.status`,
				p.ID, tenantID, p.Code, p.Name, p.Description, sequence, db.Deref(p.Status, "ACTIVE")); err != nil {
				return err
			}
			out.Processes++
		}
		for _, p := range plant.Products {
			if p.TenantID != tenantID {
				continue
			}
			cycle := 60.0
			if p.IdealCycleTimeSeconds != nil {
				cycle = *p.IdealCycleTimeSeconds
			}
			if _, err := tx.Exec(ctx, `INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status) VALUES ($1,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds, status = EXCLUDED.status`,
				p.ID, tenantID, p.SKU, p.Name, db.Deref(p.Unit, "PCS"), cycle, db.Deref(p.Status, "ACTIVE")); err != nil {
				return err
			}
			out.Products++
		}
		// The demo production orders, only where missing: the SQL seed
		// usually wrote them already, and a released order is never reset.
		now := time.Now()
		for _, o := range demoProductionOrders(now) {
			tag, err := tx.Exec(ctx, `INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date, status, created_by, created_at)
				VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9::timestamptz) ON CONFLICT (id) DO NOTHING`,
				o.id, tenantID, o.orderNumber, o.productID, o.quantity, o.dueDate, o.status, o.createdBy, o.createdAt)
			if err != nil {
				return err
			}
			out.ProductionOrders += int(tag.RowsAffected())
		}
		// The catalogue references the fixture's products, so it belongs to
		// the fixture's tenant only.
		if tenantID != plant.Tenant.ID {
			return nil
		}
		return seedDemoCatalog(ctx, tx, tenantID, &out)
	})
	if err != nil {
		return out, err
	}
	svc.Master.Invalidate(tenantID)
	if out.ProductionOrders > 0 {
		svc.Production.Changed(tenantID)
	}
	return out, nil
}

type demoProductionOrder struct {
	id, orderNumber, productID string
	quantity                   int
	dueDate, status, createdBy string
	createdAt                  string
}

// demoProductionOrders are the pilot's three orders; due dates are relative
// to today so the demo never shows an order that is already overdue.
func demoProductionOrders(now time.Time) []demoProductionOrder {
	due := func(days int) string { return now.UTC().AddDate(0, 0, days).Format("2006-01-02") }
	return []demoProductionOrder{
		{"po-260829-001", "PO-260829-001", "prod-tire-a", 2000, due(2), "RELEASED", "PPIC Supervisor", "2026-08-28T00:00:00.000Z"},
		{"po-260829-002", "PO-260829-002", "prod-tire-b", 1500, due(3), "RELEASED", "PPIC Supervisor", "2026-08-28T02:00:00.000Z"},
		{"po-260829-003", "PO-260829-003", "prod-tire-c", 800, due(4), "DRAFT", "PPIC Supervisor", "2026-08-28T04:00:00.000Z"},
	}
}

// SeedDemoHistory writes the deterministic back-catalogue behind the
// executive dashboard's trend and previous-period figures, against every
// executable work order of the tenant.
func SeedDemoHistory(ctx context.Context, tenantID string, svc DemoServices) (HistoryResult, error) {
	input, err := demoHistoryInput(ctx, tenantID, svc)
	if err != nil {
		return HistoryResult{}, err
	}
	productionCount, downtimeCount, err := svc.ShopFloor.SeedHistory(ctx, input)
	return HistoryResult{ProductionCount: productionCount, DowntimeCount: downtimeCount}, err
}

// demoHistoryInput builds the generator's input from the tenant's work
// orders and the demo plant's own reference rows. The Node seed ran before
// its reference data was hydrated from PostgreSQL, so operator, planned
// minutes and ideal cycle times came from the in-memory demo rows; reading
// the fixture keeps every generated figure identical.
func demoHistoryInput(ctx context.Context, tenantID string, svc DemoServices) (shopfloor.HistoryInput, error) {
	var none shopfloor.HistoryInput
	plant := fixtures.LoadDemoPlant()
	workOrders, err := svc.Production.WorkOrders(ctx, tenantID, production.WorkOrderFilter{})
	if err != nil {
		return none, err
	}
	operatorID := "op-001"
	if len(plant.Operators) > 0 {
		operatorID = plant.Operators[0].ID
	}
	plannedMinutes := 480
	for _, l := range plant.Lines {
		if db.Deref(l.Status, "ACTIVE") == "ACTIVE" {
			if l.PlannedProductionTimeMinutes != nil {
				plannedMinutes = *l.PlannedProductionTimeMinutes
			}
			break
		}
	}

	var historyLines []shopfloor.HistoryLine
	for _, wo := range workOrders {
		// A parent work order is a SPLIT container: its children hold the
		// production, and `ck_prod_record_not_parent` refuses any record
		// written against it (E3).
		if wo.HasChildWorkOrder {
			continue
		}
		// A batch-managed work order takes its output through a batch, so
		// the history has to name one, resolved from the database rather
		// than assumed: the composite foreign key compares the record's mode
		// against the work order's.
		var batchID *string
		if wo.IsBatchManaged {
			batches, err := svc.Production.BatchesForWorkOrder(ctx, tenantID, wo.ID)
			if err != nil {
				return none, err
			}
			if len(batches) == 0 {
				return none, fmt.Errorf("work order %s is batch-managed but owns no batch; demo history cannot be seeded (ADR-35 E1)", wo.ID)
			}
			batchID = db.Ptr(batches[0].ID)
		}
		// Alpha is the good performer, Beta the average one, and Gamma (the
		// pilot validation line) the under-performer the drill-down finds.
		profile := "POOR"
		switch wo.LineID {
		case "line-01":
			profile = "GOOD"
		case "line-02":
			profile = "AVERAGE"
		}
		// Output is bounded by the product's rate on the machine, so
		// Performance stays below 100% the way it does on a real line.
		machineID := db.Deref(wo.MachineID, "")
		ideal := 120.0
		if cycle := plant.IdealCycleSeconds(wo.ProductID, machineID); cycle != nil {
			ideal = *cycle
		} else {
			for _, p := range plant.Products {
				if p.ID == wo.ProductID && p.IdealCycleTimeSeconds != nil {
					ideal = *p.IdealCycleTimeSeconds
					break
				}
			}
		}
		historyLines = append(historyLines, shopfloor.HistoryLine{
			LineID: wo.LineID, ProcessID: wo.ProcessID, BatchID: batchID, IsBatchManaged: wo.IsBatchManaged, MachineID: machineID,
			WorkOrderID: wo.ID, OperatorID: operatorID, Profile: profile, DailyTarget: wo.PlannedQuantity, IdealCycleSeconds: ideal,
		})
	}

	return shopfloor.HistoryInput{
		TenantID:                 tenantID,
		AnchorDate:               "2026-08-28",
		Days:                     60,
		ShiftID:                  "shift-1",
		PlannedProductionMinutes: plannedMinutes,
		Lines:                    historyLines,
		// The pilot tyre factory's downtime and reject taxonomy.
		DowntimeReasonIDs: []string{"dt-breakdown", "dt-material", "dt-setup", "dt-cleaning", "dt-qc-wait", "dt-operator"},
		RejectReasonIDs:   []string{"rej-dimension", "rej-blister", "rej-scratch", "rej-flash", "rej-distortion", "rej-other"},
	}, nil
}
