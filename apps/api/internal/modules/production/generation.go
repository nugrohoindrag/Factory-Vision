package production

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// GenerateResult is what a generate returned (MES-041).
type GenerateResult struct {
	ProductionPlanID   string
	Created            []WorkOrder
	Existing           []WorkOrder
	SkippedPlanLineIDs []string
}

// Generator makes Work Orders from a Production Plan (MES-041, MES-042).
//
// Lives in production, not planning: it writes work_order rows, and
// planning may not depend on execution (MES-019). One Work Order per routing
// process — a plan line for 10.000 pcs across a four-process routing
// produces four work orders of 10.000, not one of 40.000 (§8 A2). The chain
// is explicit (predecessor_work_order_id), and regenerating produces no
// duplicates: uq_wo_plan_line_process enforces it and the generator reports
// what already existed.
type Generator struct {
	svc   *Service
	audit *audit.Service
}

// NewGenerator wires the generator.
func NewGenerator(svc *Service, auditor *audit.Service) *Generator {
	return &Generator{svc: svc, audit: auditor}
}

type planLineForGeneration struct {
	id, productID        string
	plannedQuantity      int
	requiredDeliveryDate *string
	priority             int
}

// GenerateForPlan is POST /production-plans/{id}/generate-work-orders: one
// transaction for the whole plan, so a routing that fails validation
// halfway leaves nothing behind (MES-042).
func (g *Generator) GenerateForPlan(ctx context.Context, tenantID, planID, actorID string) (GenerateResult, error) {
	out := GenerateResult{ProductionPlanID: planID, Created: []WorkOrder{}, Existing: []WorkOrder{}, SkippedPlanLineIDs: []string{}}
	err := g.svc.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var planNumber, status, periodStart, periodEnd string
		err := tx.QueryRow(ctx, `SELECT plan_number, status, to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD') FROM production_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, tenantID, planID).
			Scan(&planNumber, &status, &periodStart, &periodEnd)
		if db.IsNoRows(err) {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		if err != nil {
			return err
		}
		switch status {
		case "CONFIRMED", "IN_EXECUTION", "COMPLETED", "CANCELLED":
			return httpx.InvalidState(fmt.Sprintf("Production Plan berstatus %s; Work Order tidak dapat di-generate ulang.", status))
		}
		rows, err := tx.Query(ctx, `SELECT id, product_id, planned_quantity, to_char(required_delivery_date, 'YYYY-MM-DD'), priority
			FROM production_plan_line WHERE tenant_id = $1 AND production_plan_id = $2 AND status <> 'CANCELLED' ORDER BY priority, product_id`, tenantID, planID)
		if err != nil {
			return err
		}
		var lines []planLineForGeneration
		for rows.Next() {
			var l planLineForGeneration
			if err := rows.Scan(&l.id, &l.productID, &l.plannedQuantity, &l.requiredDeliveryDate, &l.priority); err != nil {
				rows.Close()
				return err
			}
			lines = append(lines, l)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(lines) == 0 {
			return httpx.InvalidState("Production Plan belum memiliki plan line.")
		}

		// Validate every routing before writing anything.
		routings := map[string][]RoutingStep{}
		var fields []httpx.FieldError
		for _, line := range lines {
			if line.plannedQuantity <= 0 {
				continue
			}
			if _, seen := routings[line.productID]; seen {
				continue
			}
			steps, err := g.readRouting(ctx, tx, tenantID, line.productID)
			if err != nil {
				return err
			}
			routings[line.productID] = steps
			if err := AssertRoutingValid(line.productID, steps); err != nil {
				var rerr *RoutingError
				if !errors.As(err, &rerr) {
					return err
				}
				for _, p := range rerr.Problems {
					fields = append(fields, httpx.FieldError{Field: "product:" + rerr.ProductID, Code: p.Code, Message: p.Message})
				}
			}
		}
		if len(fields) > 0 {
			return httpx.Validation("Generate Work Order dibatalkan karena routing tidak valid; tidak ada Work Order yang dibuat.", fields...)
		}

		var fallbackLine *string
		if err := tx.QueryRow(ctx, `SELECT id FROM production_line WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`, tenantID).Scan(&fallbackLine); err != nil && !db.IsNoRows(err) {
			return err
		}

		for _, line := range lines {
			if line.plannedQuantity <= 0 {
				out.SkippedPlanLineIDs = append(out.SkippedPlanLineIDs, line.id)
				continue
			}
			var steps []RoutingStep
			for _, s := range routings[line.productID] {
				if s.Active {
					steps = append(steps, s)
				}
			}
			var predecessor *string
			for _, step := range steps {
				existing, err := g.findExisting(ctx, tx, tenantID, line.id, step.ProcessID)
				if err != nil {
					return err
				}
				if existing != nil {
					// Idempotency (MES-041-4): a regenerate reports what is
					// already there.
					out.Existing = append(out.Existing, *existing)
					predecessor = db.Ptr(existing.ID)
					continue
				}
				lineID, err := g.resolveLineID(ctx, tx, tenantID, step, fallbackLine)
				if err != nil {
					return err
				}
				if lineID == "" {
					return httpx.InvalidState(fmt.Sprintf("Tidak ada production line aktif untuk process %s; tetapkan production line sebelum generate Work Order.", step.ProcessCode))
				}
				number, err := g.nextWoNumber(ctx, tx, tenantID, planNumber, step.ProcessCode)
				if err != nil {
					return err
				}
				now := db.Now()

				created, err := g.svc.workOrders.Create(ctx, tx, WorkOrder{ID: "wo-" + uuid.NewString(), TenantID: tenantID, ProductionPlanLineID: db.Ptr(line.id), PredecessorWorkOrderID: predecessor,
					WoNumber: number, ProductID: line.productID, ProcessID: db.Ptr(step.ProcessID), RoutingID: db.Ptr(step.RoutingID), Sequence: db.Ptr(step.Sequence),
					LineID: lineID, WorkCenterID: step.WorkCenterID, MachineID: step.MachineID,
					// Every process starts planned for the plan line's quantity;
					// what arrives at process 2 is decided by process 1's output (§10).
					PlannedQuantity: line.plannedQuantity, TargetQuantity: line.plannedQuantity, Unit: "PCS",
					PlannedStart: periodStart + "T00:00:00.000Z", PlannedEnd: db.Deref(line.requiredDeliveryDate, periodEnd) + "T23:59:59.000Z",
					Status: "DRAFT", Priority: line.priority, Version: 1, CreatedAt: now, UpdatedAt: now})
				if err != nil {
					return err
				}
				out.Created = append(out.Created, created)
				predecessor = db.Ptr(created.ID)
			}
		}
		createdIDs := make([]string, len(out.Created))
		for i, w := range out.Created {
			createdIDs[i] = w.ID
		}
		existingIDs := make([]string, len(out.Existing))
		for i, w := range out.Existing {
			existingIDs[i] = w.ID
		}
		_, err = g.audit.RecordIn(ctx, tx, audit.Entry{TenantID: tenantID, ActorType: "USER", ActorID: actorID, EntityType: "production_plan", EntityID: planID, Action: "GENERATE_WORK_ORDERS",
			NewValue: map[string]any{"planNumber": planNumber, "created": createdIDs, "existing": existingIDs, "skippedPlanLineIds": out.SkippedPlanLineIDs}})
		return err
	})
	if err != nil {
		return GenerateResult{}, err
	}
	g.svc.Changed(tenantID)
	return out, nil
}

// readRouting is the routing rows plus the count of machines that can run each.
func (g *Generator) readRouting(ctx context.Context, tx pgx.Tx, tenantID, productID string) ([]RoutingStep, error) {
	rows, err := tx.Query(ctx, `SELECT pr.id, pr.process_id, pp.code, pp.name, pp.status, pr.sequence, pr.work_center_id, pr.machine_id, pr.active,
			(SELECT count(*) FROM product_machine_rate pmr WHERE pmr.tenant_id = pr.tenant_id AND pmr.product_id = pr.product_id)
		FROM product_routing pr JOIN production_process pp ON pp.id = pr.process_id
		WHERE pr.tenant_id = $1 AND pr.product_id = $2 ORDER BY pr.sequence, pr.id`, tenantID, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RoutingStep
	for rows.Next() {
		var s RoutingStep
		var active *bool
		if err := rows.Scan(&s.RoutingID, &s.ProcessID, &s.ProcessCode, &s.ProcessName, &s.ProcessStatus, &s.Sequence, &s.WorkCenterID, &s.MachineID, &active, &s.EligibleMachineCount); err != nil {
			return nil, err
		}
		s.Active = active == nil || *active
		out = append(out, s)
	}
	return out, rows.Err()
}

// findExisting is the root Work Order for a (plan line, process) pair.
func (g *Generator) findExisting(ctx context.Context, tx pgx.Tx, tenantID, planLineID, processID string) (*WorkOrder, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM work_order WHERE tenant_id = $1 AND production_plan_line_id = $2 AND process_id = $3 AND parent_work_order_id IS NULL LIMIT 1`, tenantID, planLineID, processID).Scan(&id)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return g.svc.workOrders.FindByID(ctx, tx, tenantID, id)
}

// resolveLineID prefers the routing's machine, then the work centre's
// line, then the tenant's first active line.
func (g *Generator) resolveLineID(ctx context.Context, tx pgx.Tx, tenantID string, step RoutingStep, fallback *string) (string, error) {
	if step.MachineID != nil {
		var lineID *string
		err := tx.QueryRow(ctx, `SELECT wc.production_line_id FROM machine m JOIN work_center wc ON wc.id = m.work_center_id WHERE m.tenant_id = $1 AND m.id = $2`, tenantID, *step.MachineID).Scan(&lineID)
		if err != nil && !db.IsNoRows(err) {
			return "", err
		}
		if lineID != nil && *lineID != "" {
			return *lineID, nil
		}
	}
	if step.WorkCenterID != nil {
		var lineID *string
		err := tx.QueryRow(ctx, `SELECT production_line_id FROM work_center WHERE tenant_id = $1 AND id = $2`, tenantID, *step.WorkCenterID).Scan(&lineID)
		if err != nil && !db.IsNoRows(err) {
			return "", err
		}
		if lineID != nil && *lineID != "" {
			return *lineID, nil
		}
	}
	return db.Deref(fallback, ""), nil
}

// nextWoNumber is WO-<PLAN>-<PROCESS>-NNN, unique per tenant.
func (g *Generator) nextWoNumber(ctx context.Context, tx pgx.Tx, tenantID, planNumber, processCode string) (string, error) {
	prefix := "WO-" + strings.TrimPrefix(planNumber, "PLAN-") + "-" + processCode
	var max *int
	if err := tx.QueryRow(ctx, `SELECT MAX(NULLIF(regexp_replace(wo_number, '^.*-', ''), '')::int) FROM work_order WHERE tenant_id = $1 AND wo_number LIKE $2`, tenantID, prefix+"-%").Scan(&max); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%03d", prefix, db.Deref(max, 0)+1), nil
}
