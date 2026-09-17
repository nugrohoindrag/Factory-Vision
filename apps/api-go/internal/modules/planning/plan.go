package planning

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
)

// ProductionPlan is the TypeScript ProductionPlan plus the wizard state and
// the utilization in force when it was created.
type ProductionPlan struct {
	ID                     string         `json:"id"`
	TenantID               string         `json:"tenantId"`
	PlanNumber             string         `json:"planNumber"`
	PeriodStart            string         `json:"periodStart"`
	PeriodEnd              string         `json:"periodEnd"`
	DemandForecastID       *string        `json:"demandForecastId,omitempty"`
	CapacityPlanID         *string        `json:"capacityPlanId,omitempty"`
	Status                 string         `json:"status"`
	WizardStep             int            `json:"wizardStep"`
	WizardState            map[string]any `json:"wizardState"`
	PlanningUtilizationPct float64        `json:"planningUtilizationPct"`
	ConfirmedBy            *string        `json:"confirmedBy,omitempty"`
	ConfirmedAt            *string        `json:"confirmedAt,omitempty"`
	Version                int            `json:"version"`
	CreatedBy              *string        `json:"createdBy,omitempty"`
	CreatedAt              *string        `json:"createdAt,omitempty"`
	UpdatedAt              *string        `json:"updatedAt,omitempty"`
}

// PlanLine is the TypeScript ProductionPlanLine.
type PlanLine struct {
	ID                   string  `json:"id"`
	TenantID             string  `json:"tenantId"`
	ProductionPlanID     string  `json:"productionPlanId"`
	ProductID            string  `json:"productId"`
	DemandQuantity       int     `json:"demandQuantity"`
	ForecastQuantity     int     `json:"forecastQuantity"`
	PlannedQuantity      int     `json:"plannedQuantity"`
	RequiredDeliveryDate *string `json:"requiredDeliveryDate,omitempty"`
	Priority             int     `json:"priority"`
	CapacityStatus       string  `json:"capacityStatus"`
	Status               string  `json:"status"`
	DemandForecastLineID *string `json:"demandForecastLineId,omitempty"`
	CreatedAt            *string `json:"createdAt,omitempty"`
	UpdatedAt            *string `json:"updatedAt,omitempty"`
}

// PlanDemand is the TypeScript ProductionPlanDemand: the only owner of
// which Customer Order Line a plan line is producing for (ADR-22).
type PlanDemand struct {
	ID                   string `json:"id"`
	TenantID             string `json:"tenantId"`
	ProductionPlanLineID string `json:"productionPlanLineId"`
	CustomerOrderID      string `json:"customerOrderId"`
	CustomerOrderLineID  string `json:"customerOrderLineId"`
	DemandQuantity       int    `json:"demandQuantity"`
}

// PlanDetail is a plan with its lines and demand rows.
type PlanDetail struct {
	ProductionPlan
	Lines   []PlanLine   `json:"lines"`
	Demands []PlanDemand `json:"demands"`
}

const planColumns = `id, tenant_id, plan_number, to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD'), demand_forecast_id, capacity_plan_id, status, wizard_step, wizard_state,
	planning_utilization_pct::float8, confirmed_by, confirmed_at, version, created_by, created_at, updated_at`
const planLineColumns = `id, tenant_id, production_plan_id, product_id, demand_quantity, forecast_quantity, planned_quantity, to_char(required_delivery_date, 'YYYY-MM-DD'), priority,
	capacity_status, status, demand_forecast_line_id, created_at, updated_at`
const planDemandColumns = `id, tenant_id, production_plan_line_id, customer_order_id, customer_order_line_id, demand_quantity`

func scanPlan(row pgx.Row) (ProductionPlan, error) {
	var p ProductionPlan
	var status *string
	var state []byte
	var confirmed, created, updated *time.Time
	if err := row.Scan(&p.ID, &p.TenantID, &p.PlanNumber, &p.PeriodStart, &p.PeriodEnd, &p.DemandForecastID, &p.CapacityPlanID, &status, &p.WizardStep, &state,
		&p.PlanningUtilizationPct, &p.ConfirmedBy, &confirmed, &p.Version, &p.CreatedBy, &created, &updated); err != nil {
		return ProductionPlan{}, err
	}
	p.Status = db.Deref(status, "DRAFT")
	p.WizardState = map[string]any{}
	if len(state) > 0 {
		_ = json.Unmarshal(state, &p.WizardState)
	}
	p.ConfirmedAt, p.CreatedAt, p.UpdatedAt = db.ISOPtr(confirmed), db.ISOPtr(created), db.ISOPtr(updated)
	return p, nil
}

func scanPlanLine(row pgx.Row) (PlanLine, error) {
	var l PlanLine
	var capacity, status *string
	var created, updated *time.Time
	if err := row.Scan(&l.ID, &l.TenantID, &l.ProductionPlanID, &l.ProductID, &l.DemandQuantity, &l.ForecastQuantity, &l.PlannedQuantity, &l.RequiredDeliveryDate, &l.Priority,
		&capacity, &status, &l.DemandForecastLineID, &created, &updated); err != nil {
		return PlanLine{}, err
	}
	l.CapacityStatus, l.Status = db.Deref(capacity, "WITHIN_PLAN"), db.Deref(status, "DRAFT")
	l.CreatedAt, l.UpdatedAt = db.ISOPtr(created), db.ISOPtr(updated)
	return l, nil
}

func scanPlanDemand(row pgx.Row) (PlanDemand, error) {
	var d PlanDemand
	err := row.Scan(&d.ID, &d.TenantID, &d.ProductionPlanLineID, &d.CustomerOrderID, &d.CustomerOrderLineID, &d.DemandQuantity)
	return d, err
}

// PlanRepository is production_plan, production_plan_line and
// production_plan_demand.
type PlanRepository struct{}

// Insert stores a plan header.
func (PlanRepository) Insert(ctx context.Context, tx pgx.Tx, p ProductionPlan) (ProductionPlan, error) {
	return scanPlan(tx.QueryRow(ctx, `INSERT INTO production_plan (id, tenant_id, plan_number, period_start, period_end, demand_forecast_id, capacity_plan_id, status, wizard_step, planning_utilization_pct, created_by)
		VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11) RETURNING `+planColumns,
		p.ID, p.TenantID, p.PlanNumber, p.PeriodStart, p.PeriodEnd, p.DemandForecastID, p.CapacityPlanID, p.Status, p.WizardStep, p.PlanningUtilizationPct, p.CreatedBy))
}

func planOrNil(p ProductionPlan, err error) (*ProductionPlan, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// FindByID reads one plan; nil when absent.
func (PlanRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*ProductionPlan, error) {
	return planOrNil(scanPlan(tx.QueryRow(ctx, `SELECT `+planColumns+` FROM production_plan WHERE tenant_id = $1 AND id = $2`, tenantID, id)))
}

// FindByIDForUpdate locks the plan row.
func (PlanRepository) FindByIDForUpdate(ctx context.Context, tx pgx.Tx, tenantID, id string) (*ProductionPlan, error) {
	return planOrNil(scanPlan(tx.QueryRow(ctx, `SELECT `+planColumns+` FROM production_plan WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, tenantID, id)))
}

// PlanFilter narrows the plan list.
type PlanFilter struct {
	Statuses               []string
	PeriodStart, PeriodEnd string
	Limit                  int
}

// List reads plans newest period first (limit ≤ 1000).
func (PlanRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, f PlanFilter) ([]ProductionPlan, error) {
	where, args := []string{"tenant_id = $1"}, []any{tenantID}
	if len(f.Statuses) > 0 {
		args = append(args, f.Statuses)
		where = append(where, fmt.Sprintf("status = ANY($%d)", len(args)))
	}
	if f.PeriodStart != "" {
		args = append(args, f.PeriodStart)
		where = append(where, fmt.Sprintf("period_end >= $%d::date", len(args)))
	}
	if f.PeriodEnd != "" {
		args = append(args, f.PeriodEnd)
		where = append(where, fmt.Sprintf("period_start <= $%d::date", len(args)))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	args = append(args, limit)
	rows, err := tx.Query(ctx, `SELECT `+planColumns+` FROM production_plan WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY period_start DESC, plan_number DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProductionPlan{}
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PlanPatch is what an update may change.
type PlanPatch struct {
	PeriodStart, PeriodEnd, DemandForecastID, CapacityPlanID, Status, ConfirmedBy, ConfirmedAt *string
	WizardStep                                                                                 *int
	WizardState                                                                                map[string]any
	HasWizardState                                                                             bool
	PlanningUtilizationPct                                                                     *float64
}

// Update patches a plan under optimistic locking: WHERE version = expected
// is what makes the lock real rather than decorative (MES-035-3).
func (PlanRepository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, expectedVersion int, p PlanPatch) (*ProductionPlan, error) {
	var state []byte
	if p.HasWizardState {
		b, err := json.Marshal(p.WizardState)
		if err != nil {
			return nil, err
		}
		state = b
	}
	return planOrNil(scanPlan(tx.QueryRow(ctx, `UPDATE production_plan SET period_start = COALESCE($4::date, period_start), period_end = COALESCE($5::date, period_end),
		demand_forecast_id = COALESCE($6, demand_forecast_id), capacity_plan_id = COALESCE($7, capacity_plan_id), status = COALESCE($8, status), wizard_step = COALESCE($9, wizard_step),
		wizard_state = COALESCE($10::jsonb, wizard_state), planning_utilization_pct = COALESCE($11, planning_utilization_pct), confirmed_by = COALESCE($12, confirmed_by),
		confirmed_at = COALESCE($13::timestamptz, confirmed_at), version = version + 1, updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND id = $2 AND version = $3 RETURNING `+planColumns,
		tenantID, id, expectedVersion, p.PeriodStart, p.PeriodEnd, p.DemandForecastID, p.CapacityPlanID, p.Status, p.WizardStep, state, p.PlanningUtilizationPct, p.ConfirmedBy, p.ConfirmedAt)))
}

func collectPlanLines(rows pgx.Rows, err error) ([]PlanLine, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlanLine{}
	for rows.Next() {
		l, err := scanPlanLine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListLines reads a plan's lines by priority.
func (PlanRepository) ListLines(ctx context.Context, tx pgx.Tx, tenantID, planID string) ([]PlanLine, error) {
	return collectPlanLines(tx.Query(ctx, `SELECT `+planLineColumns+` FROM production_plan_line WHERE tenant_id = $1 AND production_plan_id = $2 ORDER BY priority, product_id`, tenantID, planID))
}

func planLineOrNil(l PlanLine, err error) (*PlanLine, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// FindLineByID reads one line; nil when absent.
func (PlanRepository) FindLineByID(ctx context.Context, tx pgx.Tx, tenantID, lineID string) (*PlanLine, error) {
	return planLineOrNil(scanPlanLine(tx.QueryRow(ctx, `SELECT `+planLineColumns+` FROM production_plan_line WHERE tenant_id = $1 AND id = $2`, tenantID, lineID)))
}

// FindLineByProduct locks the plan line for a product within a plan.
func (PlanRepository) FindLineByProduct(ctx context.Context, tx pgx.Tx, tenantID, planID, productID string) (*PlanLine, error) {
	return planLineOrNil(scanPlanLine(tx.QueryRow(ctx, `SELECT `+planLineColumns+` FROM production_plan_line WHERE tenant_id = $1 AND production_plan_id = $2 AND product_id = $3 FOR UPDATE`, tenantID, planID, productID)))
}

// InsertLine stores a line.
func (PlanRepository) InsertLine(ctx context.Context, tx pgx.Tx, l PlanLine) (PlanLine, error) {
	return scanPlanLine(tx.QueryRow(ctx, `INSERT INTO production_plan_line (id, tenant_id, production_plan_id, product_id, demand_quantity, forecast_quantity, planned_quantity, required_delivery_date, priority,
			capacity_status, status, demand_forecast_line_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12) RETURNING `+planLineColumns,
		l.ID, l.TenantID, l.ProductionPlanID, l.ProductID, l.DemandQuantity, l.ForecastQuantity, l.PlannedQuantity, l.RequiredDeliveryDate, l.Priority, l.CapacityStatus, l.Status, l.DemandForecastLineID))
}

// PlanLinePatch is what a line update may change.
type PlanLinePatch struct {
	DemandQuantity, ForecastQuantity, PlannedQuantity, Priority *int
	RequiredDeliveryDate, CapacityStatus, Status                *string
}

// UpdateLine patches a line.
func (PlanRepository) UpdateLine(ctx context.Context, tx pgx.Tx, tenantID, lineID string, p PlanLinePatch) (*PlanLine, error) {
	return planLineOrNil(scanPlanLine(tx.QueryRow(ctx, `UPDATE production_plan_line SET demand_quantity = COALESCE($3, demand_quantity), forecast_quantity = COALESCE($4, forecast_quantity),
		planned_quantity = COALESCE($5, planned_quantity), required_delivery_date = COALESCE($6::date, required_delivery_date), priority = COALESCE($7, priority),
		capacity_status = COALESCE($8, capacity_status), status = COALESCE($9, status), updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND id = $2 RETURNING `+planLineColumns,
		tenantID, lineID, p.DemandQuantity, p.ForecastQuantity, p.PlannedQuantity, p.RequiredDeliveryDate, p.Priority, p.CapacityStatus, p.Status)))
}

// DeleteLine removes a line.
func (PlanRepository) DeleteLine(ctx context.Context, tx pgx.Tx, tenantID, lineID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM production_plan_line WHERE tenant_id = $1 AND id = $2`, tenantID, lineID)
	return err
}

func collectDemand(rows pgx.Rows, err error) ([]PlanDemand, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlanDemand{}
	for rows.Next() {
		d, err := scanPlanDemand(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListDemand reads a plan line's demand rows.
func (PlanRepository) ListDemand(ctx context.Context, tx pgx.Tx, tenantID, lineID string) ([]PlanDemand, error) {
	return collectDemand(tx.Query(ctx, `SELECT `+planDemandColumns+` FROM production_plan_demand WHERE tenant_id = $1 AND production_plan_line_id = $2 ORDER BY customer_order_id, customer_order_line_id`, tenantID, lineID))
}

// ListDemandForPlan reads every demand row of a plan.
func (PlanRepository) ListDemandForPlan(ctx context.Context, tx pgx.Tx, tenantID, planID string) ([]PlanDemand, error) {
	return collectDemand(tx.Query(ctx, `SELECT ppd.id, ppd.tenant_id, ppd.production_plan_line_id, ppd.customer_order_id, ppd.customer_order_line_id, ppd.demand_quantity
		FROM production_plan_demand ppd JOIN production_plan_line ppl ON ppl.id = ppd.production_plan_line_id
		WHERE ppd.tenant_id = $1 AND ppl.production_plan_id = $2 ORDER BY ppd.production_plan_line_id, ppd.customer_order_id`, tenantID, planID))
}

// InsertDemand stores a demand row.
func (PlanRepository) InsertDemand(ctx context.Context, tx pgx.Tx, d PlanDemand) (PlanDemand, error) {
	return scanPlanDemand(tx.QueryRow(ctx, `INSERT INTO production_plan_demand (id, tenant_id, production_plan_line_id, customer_order_id, customer_order_line_id, demand_quantity)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+planDemandColumns, d.ID, d.TenantID, d.ProductionPlanLineID, d.CustomerOrderID, d.CustomerOrderLineID, d.DemandQuantity))
}

// DeleteDemand removes a demand row and returns it.
func (PlanRepository) DeleteDemand(ctx context.Context, tx pgx.Tx, tenantID, demandID string) (*PlanDemand, error) {
	d, err := scanPlanDemand(tx.QueryRow(ctx, `DELETE FROM production_plan_demand WHERE tenant_id = $1 AND id = $2 RETURNING `+planDemandColumns, tenantID, demandID))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// WorkOrderStatusCounts is the Work Orders generated for a plan, by status.
func (PlanRepository) WorkOrderStatusCounts(ctx context.Context, tx pgx.Tx, tenantID, planID string) (map[string]int, error) {
	rows, err := tx.Query(ctx, `SELECT wo.status, count(*) FROM work_order wo JOIN production_plan_line ppl ON ppl.id = wo.production_plan_line_id
		WHERE wo.tenant_id = $1 AND ppl.production_plan_id = $2 GROUP BY wo.status`, tenantID, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return nil, err
		}
		out[status] = n
	}
	return out, rows.Err()
}

// --- Service ------------------------------------------------------------------

// CreatePlanInput is a new plan.
type CreatePlanInput struct {
	PeriodStart, PeriodEnd           string
	DemandForecastID, CapacityPlanID *string
}

func assertEditable(p *ProductionPlan) error {
	switch p.Status {
	case "CONFIRMED", "IN_EXECUTION", "COMPLETED", "CANCELLED":
		return httpx.InvalidState(fmt.Sprintf("Production Plan berstatus %s tidak dapat diubah. Plan yang sudah dikonfirmasi adalah komitmen produksi.", p.Status))
	}
	return nil
}

func (s *Service) planDetail(ctx context.Context, tx pgx.Tx, tenantID, id string) (PlanDetail, error) {
	plan, err := s.plans.FindByID(ctx, tx, tenantID, id)
	if err != nil {
		return PlanDetail{}, err
	}
	if plan == nil {
		return PlanDetail{}, httpx.NotFound("Production Plan tidak ditemukan.")
	}
	lines, err := s.plans.ListLines(ctx, tx, tenantID, id)
	if err != nil {
		return PlanDetail{}, err
	}
	demands, err := s.plans.ListDemandForPlan(ctx, tx, tenantID, id)
	if err != nil {
		return PlanDetail{}, err
	}
	return PlanDetail{ProductionPlan: *plan, Lines: lines, Demands: demands}, nil
}

// Plans lists plan headers.
func (s *Service) Plans(ctx context.Context, tenantID string, f PlanFilter) ([]ProductionPlan, error) {
	var out []ProductionPlan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.plans.List(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// Plan reads one plan with lines and demand.
func (s *Service) Plan(ctx context.Context, tenantID, id string) (PlanDetail, error) {
	var out PlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.planDetail(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// CreatePlan opens a DRAFT plan at wizard step 1.
func (s *Service) CreatePlan(ctx context.Context, tenantID string, in CreatePlanInput, actorID string) (PlanDetail, error) {
	if dateOf(in.PeriodEnd).Before(dateOf(in.PeriodStart)) {
		return PlanDetail{}, httpx.Validation("Periode plan tidak valid.", httpx.FieldError{Field: "periodEnd", Code: "OUT_OF_RANGE", Message: "Period end harus setelah period start."})
	}
	var out PlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		config, err := s.reference.GetConfig(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		number, err := NextNumber(ctx, tx, tenantID, "production_plan", "plan_number", ProductionPlanPrefix(in.PeriodStart), 3)
		if err != nil {
			return err
		}
		// The utilization in force when the plan was created travels with it
		// (§45.6): a later policy change must not restate a decision taken.
		plan, err := s.plans.Insert(ctx, tx, ProductionPlan{ID: "plan-" + uuid.NewString(), TenantID: tenantID, PlanNumber: number, PeriodStart: in.PeriodStart, PeriodEnd: in.PeriodEnd,
			DemandForecastID: in.DemandForecastID, CapacityPlanID: in.CapacityPlanID, Status: "DRAFT", WizardStep: 1, PlanningUtilizationPct: config.PlanningUtilizationPct, CreatedBy: &actorID})
		if err != nil {
			return err
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan", plan.ID, "CREATE", nil, plan); err != nil {
			return err
		}
		out = PlanDetail{ProductionPlan: plan, Lines: []PlanLine{}, Demands: []PlanDemand{}}
		return nil
	})
	return out, err
}

// UpdatePlan patches a plan under optimistic locking (MES-039-3).
func (s *Service) UpdatePlan(ctx context.Context, tenantID, id string, expectedVersion int, p PlanPatch, actorID string) (PlanDetail, error) {
	var out PlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		before, err := s.plans.FindByIDForUpdate(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		if err := assertEditable(before); err != nil {
			return err
		}
		if p.WizardStep != nil {
			readiness, err := s.wizardReadiness(ctx, tx, tenantID, *before)
			if err != nil {
				return err
			}
			if err := AssertStepReachable(*p.WizardStep, readiness); err != nil {
				return err
			}
		}
		updated, err := s.plans.Update(ctx, tx, tenantID, id, expectedVersion, p)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.Conflict(fmt.Sprintf("Production Plan sudah diubah orang lain (versi %d, Anda mengirim %d). Muat ulang plan lalu ulangi perubahan Anda.", before.Version, expectedVersion))
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan", id, "UPDATE", before, updated); err != nil {
			return err
		}
		out, err = s.planDetail(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// PlanLines lists a plan's lines.
func (s *Service) PlanLines(ctx context.Context, tenantID, planID string) ([]PlanLine, error) {
	var out []PlanLine
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.plans.ListLines(ctx, tx, tenantID, planID)
		return err
	})
	return out, err
}

// AddDemandResult is the plan line and the demand row an addition produced.
type AddDemandResult struct {
	Line   PlanLine   `json:"line"`
	Demand PlanDemand `json:"demand"`
}

// AddDemand adds a Customer Order Line's demand to the plan (MES-036).
// Demand for the same product aggregates into one plan line; every
// contributing order line gets its own production_plan_demand row, and
// customer_order_line.planned_quantity is raised in the same transaction.
func (s *Service) AddDemand(ctx context.Context, tenantID, planID, orderLineID string, demandQuantity *int, actorID string) (AddDemandResult, error) {
	var out AddDemandResult
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plan, err := s.plans.FindByIDForUpdate(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		if err := assertEditable(plan); err != nil {
			return err
		}
		orderLine, err := s.orders.FindLineByID(ctx, tx, tenantID, orderLineID)
		if err != nil {
			return err
		}
		if orderLine == nil {
			return httpx.NotFound("Customer Order Line tidak ditemukan.")
		}
		order, err := s.orders.FindByID(ctx, tx, tenantID, orderLine.CustomerOrderID)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		if order.Status == "CANCELLED" {
			return httpx.InvalidState("Customer Order yang dibatalkan tidak dapat masuk Production Plan.")
		}
		outstanding := orderLine.OrderedQuantity - orderLine.PlannedQuantity
		quantity := db.Deref(demandQuantity, outstanding)
		if quantity <= 0 {
			// The headline says which of the two situations this is.
			if outstanding <= 0 {
				return httpx.Validation(fmt.Sprintf("Order line ini sudah seluruhnya masuk Production Plan (%d dari %d).", orderLine.PlannedQuantity, orderLine.OrderedQuantity),
					httpx.FieldError{Field: "demandQuantity", Code: "ALREADY_PLANNED", Message: fmt.Sprintf("Sisa order line %s adalah %d; tidak ada yang dapat direncanakan lagi.", orderLine.ID, outstanding)})
			}
			return httpx.Validation("Demand quantity harus lebih dari nol.", httpx.FieldError{Field: "demandQuantity", Code: "OUT_OF_RANGE", Message: fmt.Sprintf("Demand quantity %d tidak valid.", quantity)})
		}
		if quantity > outstanding {
			return httpx.Validation("Demand melebihi sisa order line.", httpx.FieldError{Field: "demandQuantity", Code: "OUT_OF_RANGE",
				Message: fmt.Sprintf("Demand %d melebihi sisa %d pada order line (ordered %d, sudah direncanakan %d).", quantity, outstanding, orderLine.OrderedQuantity, orderLine.PlannedQuantity)})
		}
		existing, err := s.plans.ListDemandForPlan(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		for _, d := range existing {
			if d.CustomerOrderLineID == orderLine.ID {
				return httpx.Conflict(fmt.Sprintf("Order line ini sudah masuk plan pada plan line %s.", d.ProductionPlanLineID))
			}
		}
		lineDelivery := orderLine.RequestedDeliveryDate
		if lineDelivery == nil {
			lineDelivery = db.Ptr(order.RequestedDeliveryDate)
		}
		// One plan line per product: the aggregation §45.7 asks for.
		line, err := s.plans.FindLineByProduct(ctx, tx, tenantID, planID, orderLine.ProductID)
		if err != nil {
			return err
		}
		if line == nil {
			lines, err := s.plans.ListLines(ctx, tx, tenantID, planID)
			if err != nil {
				return err
			}
			created, err := s.plans.InsertLine(ctx, tx, PlanLine{ID: "planline-" + uuid.NewString(), TenantID: tenantID, ProductionPlanID: planID, ProductID: orderLine.ProductID,
				RequiredDeliveryDate: lineDelivery, Priority: len(lines) + 1, CapacityStatus: "WITHIN_PLAN", Status: "DRAFT"})
			if err != nil {
				return err
			}
			line = &created
		}
		demand, err := s.plans.InsertDemand(ctx, tx, PlanDemand{ID: "plandem-" + uuid.NewString(), TenantID: tenantID, ProductionPlanLineID: line.ID, CustomerOrderID: order.ID, CustomerOrderLineID: orderLine.ID, DemandQuantity: quantity})
		if err != nil {
			return err
		}
		aggregated := line.DemandQuantity + quantity
		// The earliest date any contributing order needs: a plan line is only
		// as late as its most urgent customer.
		required := line.RequiredDeliveryDate
		if required == nil || (lineDelivery != nil && *lineDelivery < *required) {
			required = lineDelivery
		}
		patch := PlanLinePatch{DemandQuantity: &aggregated, RequiredDeliveryDate: required}
		// Planned follows demand until a planner overrides it in Step 2.
		if line.PlannedQuantity == line.DemandQuantity {
			patch.PlannedQuantity = &aggregated
		}
		updated, err := s.plans.UpdateLine(ctx, tx, tenantID, line.ID, patch)
		if err != nil {
			return err
		}
		if err := s.orders.AddPlannedQuantity(ctx, tx, tenantID, orderLine.ID, quantity); err != nil {
			return err
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan_demand", demand.ID, "CREATE", nil,
			map[string]any{"id": demand.ID, "tenantId": tenantID, "productionPlanLineId": demand.ProductionPlanLineID, "customerOrderId": demand.CustomerOrderID, "customerOrderLineId": demand.CustomerOrderLineID,
				"demandQuantity": demand.DemandQuantity, "productId": orderLine.ProductID, "customerOrderNumber": order.OrderNumber}); err != nil {
			return err
		}
		// The order may now be fully planned, which moves it to Planned.
		if _, err := s.RefreshStatusIn(ctx, tx, tenantID, order.ID, actorID); err != nil {
			return err
		}
		out = AddDemandResult{Line: *line, Demand: demand}
		if updated != nil {
			out.Line = *updated
		}
		return nil
	})
	return out, err
}

// RemoveDemand drops one demand link, returning the quantity to the order line.
func (s *Service) RemoveDemand(ctx context.Context, tenantID, planID, demandID, actorID string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plan, err := s.plans.FindByIDForUpdate(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		if err := assertEditable(plan); err != nil {
			return err
		}
		removed, err := s.plans.DeleteDemand(ctx, tx, tenantID, demandID)
		if err != nil {
			return err
		}
		if removed == nil {
			return httpx.NotFound("Production Plan Demand tidak ditemukan.")
		}
		line, err := s.plans.FindLineByID(ctx, tx, tenantID, removed.ProductionPlanLineID)
		if err != nil {
			return err
		}
		if line != nil {
			remaining, err := s.plans.ListDemand(ctx, tx, tenantID, line.ID)
			if err != nil {
				return err
			}
			if len(remaining) == 0 {
				// A plan line with no demand behind it is not a decision any more.
				if err := s.plans.DeleteLine(ctx, tx, tenantID, line.ID); err != nil {
					return err
				}
			} else {
				aggregated := 0
				for _, d := range remaining {
					aggregated += d.DemandQuantity
				}
				planned := line.PlannedQuantity
				if aggregated < planned {
					planned = aggregated
				}
				if _, err := s.plans.UpdateLine(ctx, tx, tenantID, line.ID, PlanLinePatch{DemandQuantity: &aggregated, PlannedQuantity: &planned}); err != nil {
					return err
				}
			}
		}
		if err := s.orders.AddPlannedQuantity(ctx, tx, tenantID, removed.CustomerOrderLineID, -removed.DemandQuantity); err != nil {
			return err
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan_demand", demandID, "DELETE", removed, nil); err != nil {
			return err
		}
		_, err = s.RefreshStatusIn(ctx, tx, tenantID, removed.CustomerOrderID, actorID)
		return err
	})
}

// UpdatePlanLine is Step 2's decision: how much to actually produce, at
// what priority. The capacity status is recomputed, never accepted.
func (s *Service) UpdatePlanLine(ctx context.Context, tenantID, planID, lineID string, plannedQuantity, priority *int, requiredDeliveryDate *string, actorID string) (PlanLine, error) {
	plan, err := s.Plan(ctx, tenantID, planID)
	if err != nil {
		return PlanLine{}, err
	}
	if err := assertEditable(&plan.ProductionPlan); err != nil {
		return PlanLine{}, err
	}
	var before *PlanLine
	for i := range plan.Lines {
		if plan.Lines[i].ID == lineID {
			before = &plan.Lines[i]
		}
	}
	if before == nil {
		return PlanLine{}, httpx.NotFound("Production Plan Line tidak ditemukan.")
	}
	if plannedQuantity != nil && *plannedQuantity < 0 {
		return PlanLine{}, httpx.Validation("Planned quantity tidak boleh negatif.", httpx.FieldError{Field: "plannedQuantity", Code: "OUT_OF_RANGE", Message: "Planned quantity minimal 0."})
	}
	assessment, err := s.AssessProduct(ctx, tenantID, before.ProductID, plan.PeriodStart, plan.PeriodEnd, db.Deref(plannedQuantity, before.PlannedQuantity))
	if err != nil {
		return PlanLine{}, err
	}
	var out PlanLine
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		updated, err := s.plans.UpdateLine(ctx, tx, tenantID, lineID, PlanLinePatch{PlannedQuantity: plannedQuantity, Priority: priority, RequiredDeliveryDate: requiredDeliveryDate, CapacityStatus: &assessment.CapacityStatus})
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Production Plan Line tidak ditemukan.")
		}
		out = *updated
		next := map[string]any{"id": updated.ID, "tenantId": updated.TenantID, "productionPlanId": updated.ProductionPlanID, "productId": updated.ProductID, "demandQuantity": updated.DemandQuantity,
			"forecastQuantity": updated.ForecastQuantity, "plannedQuantity": updated.PlannedQuantity, "requiredDeliveryDate": updated.RequiredDeliveryDate, "priority": updated.Priority,
			"capacityStatus": updated.CapacityStatus, "status": updated.Status, "demandForecastLineId": updated.DemandForecastLineID, "createdAt": updated.CreatedAt, "updatedAt": updated.UpdatedAt,
			"capacityAssessment": assessment}
		return s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan_line", lineID, "UPDATE", before, next)
	})
	return out, err
}

// DemandSource is one Customer Order behind a plan line.
type DemandSource struct {
	CustomerOrderID       string  `json:"customerOrderId"`
	OrderNumber           string  `json:"orderNumber"`
	CustomerID            string  `json:"customerId"`
	CustomerName          string  `json:"customerName"`
	CustomerOrderLineID   string  `json:"customerOrderLineId"`
	DemandQuantity        int     `json:"demandQuantity"`
	RequestedDeliveryDate *string `json:"requestedDeliveryDate,omitempty"`
}

// DemandBreakdownRow is one plan line with its sources (MES-036-4).
type DemandBreakdownRow struct {
	ProductionPlanLineID string         `json:"productionPlanLineId"`
	ProductID            string         `json:"productId"`
	DemandQuantity       int            `json:"demandQuantity"`
	PlannedQuantity      int            `json:"plannedQuantity"`
	Sources              []DemandSource `json:"sources"`
}

// DemandBreakdown is GET /production-plans/{id}/demand.
func (s *Service) DemandBreakdown(ctx context.Context, tenantID, planID string) ([]DemandBreakdownRow, error) {
	out := []DemandBreakdownRow{}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		lines, err := s.plans.ListLines(ctx, tx, tenantID, planID)
		if err != nil || len(lines) == 0 {
			return err
		}
		ids := make([]string, len(lines))
		for i, l := range lines {
			ids[i] = l.ID
		}
		rows, err := tx.Query(ctx, `SELECT ppd.production_plan_line_id, ppd.customer_order_id, co.order_number, co.customer_id, c.name, ppd.customer_order_line_id, ppd.demand_quantity,
				to_char(COALESCE(col.requested_delivery_date, co.requested_delivery_date), 'YYYY-MM-DD')
			FROM production_plan_demand ppd
			JOIN customer_order co ON co.id = ppd.customer_order_id
			JOIN customer c ON c.id = co.customer_id
			JOIN customer_order_line col ON col.id = ppd.customer_order_line_id
			WHERE ppd.tenant_id = $1 AND ppd.production_plan_line_id = ANY($2) ORDER BY ppd.production_plan_line_id, co.order_number`, tenantID, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		byLine := map[string][]DemandSource{}
		for rows.Next() {
			var lineID string
			var src DemandSource
			if err := rows.Scan(&lineID, &src.CustomerOrderID, &src.OrderNumber, &src.CustomerID, &src.CustomerName, &src.CustomerOrderLineID, &src.DemandQuantity, &src.RequestedDeliveryDate); err != nil {
				return err
			}
			byLine[lineID] = append(byLine[lineID], src)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		for _, l := range lines {
			sources := byLine[l.ID]
			if sources == nil {
				sources = []DemandSource{}
			}
			out = append(out, DemandBreakdownRow{ProductionPlanLineID: l.ID, ProductID: l.ProductID, DemandQuantity: l.DemandQuantity, PlannedQuantity: l.PlannedQuantity, Sources: sources})
		}
		return nil
	})
	return out, err
}

// Readiness is which wizard steps are reachable, read from the plan's own data.
func (s *Service) Readiness(ctx context.Context, tenantID, planID string) (WizardReadiness, error) {
	var out WizardReadiness
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plan, err := s.plans.FindByID(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		out, err = s.wizardReadiness(ctx, tx, tenantID, *plan)
		return err
	})
	return out, err
}

func (s *Service) wizardReadiness(ctx context.Context, tx pgx.Tx, tenantID string, plan ProductionPlan) (WizardReadiness, error) {
	lines, err := s.plans.ListLines(ctx, tx, tenantID, plan.ID)
	if err != nil {
		return WizardReadiness{}, err
	}
	demands, err := s.plans.ListDemandForPlan(ctx, tx, tenantID, plan.ID)
	if err != nil {
		return WizardReadiness{}, err
	}
	r := WizardReadiness{PlanID: plan.ID, CurrentStep: plan.WizardStep, DemandCount: len(demands), LineCount: len(lines)}
	for _, l := range lines {
		if l.PlannedQuantity > 0 {
			r.LinesWithPlannedQuantity++
		}
		if l.CapacityStatus == "CAPACITY_UP_REQUIRED" {
			r.CapacityUpRequiredLines++
		}
	}
	err = tx.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE wo.status <> 'DRAFT'), count(*) FILTER (WHERE wo.machine_id IS NOT NULL AND wo.mold_id IS NOT NULL),
			count(*) FILTER (WHERE wo.status IN ('CONFIRMED', 'IN_PRODUCTION', 'COMPLETED'))
		FROM work_order wo JOIN production_plan_line ppl ON ppl.id = wo.production_plan_line_id
		WHERE wo.tenant_id = $1 AND ppl.production_plan_id = $2 AND wo.parent_work_order_id IS NULL`, tenantID, plan.ID).
		Scan(&r.WorkOrderCount, &r.ScheduledWorkOrders, &r.ResourcedWorkOrders, &r.ConfirmedWorkOrders)
	return r, err
}

// ConfirmPlan turns the plan from an intention into a commitment (MES-040):
// no line may still be CAPACITY_UP_REQUIRED, and every generated Work Order
// must be confirmed.
func (s *Service) ConfirmPlan(ctx context.Context, tenantID, planID, actorID string) (PlanDetail, error) {
	var out PlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plan, err := s.plans.FindByIDForUpdate(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		if plan.Status == "CONFIRMED" {
			return httpx.InvalidState("Production Plan sudah dikonfirmasi.")
		}
		if plan.Status == "CANCELLED" || plan.Status == "COMPLETED" {
			return httpx.InvalidState(fmt.Sprintf("Production Plan berstatus %s tidak dapat dikonfirmasi.", plan.Status))
		}
		lines, err := s.plans.ListLines(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return httpx.InvalidState("Production Plan tanpa plan line tidak dapat dikonfirmasi.")
		}
		var blocked []string
		total := 0
		for _, l := range lines {
			if l.CapacityStatus == "CAPACITY_UP_REQUIRED" {
				blocked = append(blocked, l.ProductID)
			}
			total += l.PlannedQuantity
		}
		if len(blocked) > 0 {
			return httpx.InvalidState(fmt.Sprintf("%d plan line berstatus CAPACITY_UP_REQUIRED belum ditangani: %s. Ajukan Capacity Up atau turunkan planned quantity sebelum konfirmasi.", len(blocked), strings.Join(blocked, ", ")))
		}
		counts, err := s.plans.WorkOrderStatusCounts(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		all, unconfirmed := 0, 0
		for status, n := range counts {
			all += n
			if status != "CONFIRMED" && status != "IN_PRODUCTION" && status != "COMPLETED" && status != "CANCELLED" {
				unconfirmed += n
			}
		}
		if all == 0 {
			return httpx.InvalidState("Belum ada Work Order yang di-generate untuk plan ini. Jalankan generate-work-orders lebih dahulu.")
		}
		if unconfirmed > 0 {
			return httpx.InvalidState(fmt.Sprintf("%d Work Order belum dikonfirmasi. Konfirmasi seluruh Work Order sebelum plan dikonfirmasi.", unconfirmed))
		}
		confirmedAt := db.ISO(s.now())
		updated, err := s.plans.Update(ctx, tx, tenantID, planID, plan.Version, PlanPatch{Status: db.Ptr("CONFIRMED"), ConfirmedBy: &actorID, ConfirmedAt: &confirmedAt, WizardStep: db.Ptr(6)})
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.Conflict("Production Plan berubah saat konfirmasi berlangsung. Muat ulang lalu ulangi.")
		}
		for _, l := range lines {
			if _, err := s.plans.UpdateLine(ctx, tx, tenantID, l.ID, PlanLinePatch{Status: db.Ptr("RELEASED")}); err != nil {
				return err
			}
		}
		// Confirming the plan is what moves the orders it serves to Planned.
		demands, err := s.plans.ListDemandForPlan(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		orderIDs := uniqueOrderIDs(demands)
		for _, id := range orderIDs {
			if _, err := s.RefreshStatusIn(ctx, tx, tenantID, id, actorID); err != nil {
				return err
			}
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan", planID, "CONFIRM", map[string]any{"status": plan.Status}, map[string]any{"status": "CONFIRMED", "confirmedBy": actorID, "confirmedAt": confirmedAt}); err != nil {
			return err
		}
		if err := s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventProductionPlanConfirmed, AggregateType: "production_plan", AggregateID: planID,
			Payload: map[string]any{"planNumber": plan.PlanNumber, "periodStart": plan.PeriodStart, "periodEnd": plan.PeriodEnd, "confirmedBy": actorID, "customerOrderIds": orderIDs, "plannedQuantityTotal": total}}); err != nil {
			return err
		}
		out, err = s.planDetail(ctx, tx, tenantID, planID)
		return err
	})
	return out, err
}

func uniqueOrderIDs(demands []PlanDemand) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, d := range demands {
		if !seen[d.CustomerOrderID] {
			seen[d.CustomerOrderID] = true
			out = append(out, d.CustomerOrderID)
		}
	}
	return out
}

// CancelPlan releases the demand back to the customer order lines.
func (s *Service) CancelPlan(ctx context.Context, tenantID, planID, reason, actorID string) (PlanDetail, error) {
	if strings.TrimSpace(reason) == "" {
		return PlanDetail{}, httpx.Validation("Alasan pembatalan wajib diisi.", httpx.FieldError{Field: "reason", Code: "REQUIRED", Message: "Alasan pembatalan wajib diisi."})
	}
	var out PlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plan, err := s.plans.FindByIDForUpdate(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Production Plan tidak ditemukan.")
		}
		if plan.Status == "CANCELLED" {
			return httpx.InvalidState("Production Plan sudah dibatalkan.")
		}
		counts, err := s.plans.WorkOrderStatusCounts(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if running := counts["IN_PRODUCTION"] + counts["COMPLETED"]; running > 0 {
			return httpx.InvalidState(fmt.Sprintf("Production Plan tidak dapat dibatalkan: %d Work Order sudah masuk produksi.", running))
		}
		updated, err := s.plans.Update(ctx, tx, tenantID, planID, plan.Version, PlanPatch{Status: db.Ptr("CANCELLED")})
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.Conflict("Production Plan berubah saat pembatalan berlangsung.")
		}
		demands, err := s.plans.ListDemandForPlan(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		for _, d := range demands {
			if err := s.orders.AddPlannedQuantity(ctx, tx, tenantID, d.CustomerOrderLineID, -d.DemandQuantity); err != nil {
				return err
			}
		}
		for _, id := range uniqueOrderIDs(demands) {
			if _, err := s.RefreshStatusIn(ctx, tx, tenantID, id, actorID); err != nil {
				return err
			}
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "production_plan", planID, "CANCEL", map[string]any{"status": plan.Status}, map[string]any{"status": "CANCELLED", "reason": reason}); err != nil {
			return err
		}
		if err := s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventProductionPlanCancelled, AggregateType: "production_plan", AggregateID: planID, Payload: map[string]any{"planNumber": plan.PlanNumber, "reason": reason}}); err != nil {
			return err
		}
		out, err = s.planDetail(ctx, tx, tenantID, planID)
		return err
	})
	return out, err
}

// --- Routes -------------------------------------------------------------------

var planStatuses = []string{"DRAFT", "PLANNING", "READY", "CONFIRMED", "IN_EXECUTION", "COMPLETED", "CANCELLED"}

func (h *handler) mountPlans(r chi.Router) {
	r.Get("/production-plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		f := PlanFilter{PeriodStart: q.Get("periodStart"), PeriodEnd: q.Get("periodEnd")}
		if raw := q.Get("status"); raw != "" {
			f.Statuses = []string{}
			for _, s := range strings.Split(raw, ",") {
				if indexOf(planStatuses, s) >= 0 {
					f.Statuses = append(f.Statuses, s)
				}
			}
		}
		list, err := h.svc.Plans(r.Context(), h.tenant(r), f)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/production-plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		periodStart := v.ISODate("periodStart", httpx.Opt{})
		periodEnd := v.ISODate("periodEnd", httpx.Opt{})
		in := CreatePlanInput{DemandForecastID: v.OptStr("demandForecastId"), CapacityPlanID: v.OptStr("capacityPlanId")}
		if err := v.Done(); err != nil {
			return err
		}
		in.PeriodStart, in.PeriodEnd = *dateOnly(periodStart), *dateOnly(periodEnd)
		plan, err := h.svc.CreatePlan(r.Context(), h.tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, plan)
	}))

	r.Get("/production-plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		plan, err := h.svc.Plan(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))

	// version is required, not optional (MES-039-3): a wizard two planners
	// can open is a wizard where last-write-wins loses work.
	r.Patch("/production-plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		version := v.Int("version", httpx.Opt{Min: httpx.Min(1)})
		p := PlanPatch{PeriodStart: dateOnly(v.ISODate("periodStart", httpx.Opt{Optional: true})), PeriodEnd: dateOnly(v.ISODate("periodEnd", httpx.Opt{Optional: true})),
			DemandForecastID: v.OptStr("demandForecastId"), CapacityPlanID: v.OptStr("capacityPlanId"), WizardStep: v.Int("wizardStep", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(6)})}
		if raw, ok := body["wizardState"]; ok && raw != nil {
			state, isObject := raw.(map[string]any)
			if !isObject {
				v.Reject("wizardState", "INVALID_TYPE", "wizardState harus berupa objek.")
			}
			p.WizardState, p.HasWizardState = state, true
		}
		if err := v.Done(); err != nil {
			return err
		}
		plan, err := h.svc.UpdatePlan(r.Context(), h.tenant(r), chi.URLParam(r, "id"), *version, p, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))

	r.Get("/production-plans/{id}/wizard", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		readiness, err := h.svc.Readiness(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		// The resume point: the step the data actually supports (MES-039-2).
		resume := FurthestReachableStep(readiness)
		if readiness.CurrentStep < resume {
			resume = readiness.CurrentStep
		}
		return httpx.OK(w, struct {
			WizardReadiness
			ResumeStep int                `json:"resumeStep"`
			Steps      []StepAvailability `json:"steps"`
		}{readiness, resume, StepsAvailability(readiness)})
	}))

	r.Get("/production-plans/{id}/lines", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		lines, err := h.svc.PlanLines(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, lines)
	}))

	r.Patch("/production-plans/{id}/lines/{lineId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		planned := v.Int("plannedQuantity", httpx.Opt{Optional: true, Min: httpx.Min(0)})
		priority := v.Int("priority", httpx.Opt{Optional: true, Min: httpx.Min(1)})
		required := dateOnly(v.ISODate("requiredDeliveryDate", httpx.Opt{Optional: true}))
		if err := v.Done(); err != nil {
			return err
		}
		line, err := h.svc.UpdatePlanLine(r.Context(), h.tenant(r), chi.URLParam(r, "id"), chi.URLParam(r, "lineId"), planned, priority, required, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, line)
	}))

	r.Get("/production-plans/{id}/demand", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := h.svc.DemandBreakdown(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))

	r.Post("/production-plans/{id}/demand", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		orderLineID := v.String("customerOrderLineId", httpx.Opt{})
		quantity := v.Int("demandQuantity", httpx.Opt{Optional: true, Min: httpx.Min(1)})
		if err := v.Done(); err != nil {
			return err
		}
		result, err := h.svc.AddDemand(r.Context(), h.tenant(r), chi.URLParam(r, "id"), *orderLineID, quantity, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, result)
	}))

	r.Delete("/production-plans/{id}/demand/{demandId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.RemoveDemand(r.Context(), h.tenant(r), chi.URLParam(r, "id"), chi.URLParam(r, "demandId"), actorOf(r)); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Demand dilepas dari Production Plan."})
	}))

	r.Post("/production-plans/{id}/generate-work-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if h.generator == nil {
			return httpx.Internal("Work Order generator belum terpasang pada API.")
		}
		result, err := h.generator.GenerateForPlan(r.Context(), h.tenant(r), chi.URLParam(r, "id"), actorOf(r))
		if err != nil {
			return err
		}
		message := fmt.Sprintf("%d Work Order dibuat.", len(result.Created))
		if len(result.Created) == 0 && len(result.Existing) > 0 {
			message = "Seluruh Work Order sudah ada; generate ulang tidak membuat duplikat."
		}
		return httpx.Created(w, map[string]any{"productionPlanId": result.ProductionPlanID, "created": result.Created, "existing": result.Existing, "skippedPlanLineIds": result.SkippedPlanLineIDs,
			"createdCount": len(result.Created), "existingCount": len(result.Existing), "message": message})
	}))

	r.Post("/production-plans/{id}/confirm", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		plan, err := h.svc.ConfirmPlan(r.Context(), h.tenant(r), chi.URLParam(r, "id"), actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))

	r.Post("/production-plans/{id}/cancel", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		reason := v.String("reason", httpx.Opt{Min: httpx.Min(3)})
		if err := v.Done(); err != nil {
			return err
		}
		plan, err := h.svc.CancelPlan(r.Context(), h.tenant(r), chi.URLParam(r, "id"), *reason, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))
}
