package planning

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/queue"
)

// CapacityPlan is the TypeScript CapacityPlan plus the supersession pointer.
type CapacityPlan struct {
	ID                     string  `json:"id"`
	TenantID               string  `json:"tenantId"`
	PlanNumber             string  `json:"planNumber"`
	PeriodStart            string  `json:"periodStart"`
	PeriodEnd              string  `json:"periodEnd"`
	PlanningUtilizationPct float64 `json:"planningUtilizationPct"`
	Status                 string  `json:"status"`
	ComputedAt             *string `json:"computedAt,omitempty"`
	SupersededByID         *string `json:"supersededById,omitempty"`
}

// CapacityPlanLine is the TypeScript CapacityPlanLine plus the machines
// left out (§45.6) and the minutes that contributed.
type CapacityPlanLine struct {
	ID                  string              `json:"id"`
	TenantID            string              `json:"tenantId"`
	CapacityPlanID      string              `json:"capacityPlanId"`
	PlantID             string              `json:"plantId"`
	LineID              *string             `json:"lineId,omitempty"`
	ProductID           *string             `json:"productId,omitempty"`
	TotalCapacity       int                 `json:"totalCapacity"`
	PlanningCapacity    int                 `json:"planningCapacity"`
	CapacityBuffer      int                 `json:"capacityBuffer"`
	DemandQuantity      int                 `json:"demandQuantity"`
	PlannedQuantity     int                 `json:"plannedQuantity"`
	CapacityUtilization float64             `json:"capacityUtilization"`
	CapacityGap         int                 `json:"capacityGap"`
	CapacityStatus      string              `json:"capacityStatus"`
	UncomputedMachines  []UncomputedMachine `json:"uncomputedMachines"`
	AvailableMinutes    float64             `json:"availableMinutes"`
}

// CapacityPlanDetail is a plan with its lines.
type CapacityPlanDetail struct {
	CapacityPlan
	Lines []CapacityPlanLine `json:"lines"`
}

const capacityColumns = `id, tenant_id, plan_number, to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD'), planning_utilization_pct::float8, status, computed_at, superseded_by_id`
const capacityLineColumns = `id, tenant_id, capacity_plan_id, plant_id, line_id, product_id, total_capacity, planning_capacity, capacity_buffer, demand_quantity, planned_quantity,
	capacity_utilization::float8, capacity_gap, capacity_status, uncomputed_machines, available_minutes::float8`

func scanCapacityPlan(row pgx.Row) (CapacityPlan, error) {
	var p CapacityPlan
	var status *string
	var computed *time.Time
	if err := row.Scan(&p.ID, &p.TenantID, &p.PlanNumber, &p.PeriodStart, &p.PeriodEnd, &p.PlanningUtilizationPct, &status, &computed, &p.SupersededByID); err != nil {
		return CapacityPlan{}, err
	}
	p.Status, p.ComputedAt = db.Deref(status, "DRAFT"), db.ISOPtr(computed)
	return p, nil
}

func scanCapacityLine(row pgx.Row) (CapacityPlanLine, error) {
	var l CapacityPlanLine
	var status *string
	var uncomputed []byte
	if err := row.Scan(&l.ID, &l.TenantID, &l.CapacityPlanID, &l.PlantID, &l.LineID, &l.ProductID, &l.TotalCapacity, &l.PlanningCapacity, &l.CapacityBuffer, &l.DemandQuantity, &l.PlannedQuantity,
		&l.CapacityUtilization, &l.CapacityGap, &status, &uncomputed, &l.AvailableMinutes); err != nil {
		return CapacityPlanLine{}, err
	}
	l.CapacityStatus = db.Deref(status, "WITHIN_PLAN")
	l.UncomputedMachines = []UncomputedMachine{}
	if len(uncomputed) > 0 {
		_ = json.Unmarshal(uncomputed, &l.UncomputedMachines)
	}
	return l, nil
}

// CapacityRepository is capacity_plan and capacity_plan_line.
type CapacityRepository struct{}

// Insert stores a plan header.
func (CapacityRepository) Insert(ctx context.Context, tx pgx.Tx, p CapacityPlan) (CapacityPlan, error) {
	return scanCapacityPlan(tx.QueryRow(ctx, `INSERT INTO capacity_plan (id, tenant_id, plan_number, period_start, period_end, planning_utilization_pct, status)
		VALUES ($1,$2,$3,$4::date,$5::date,$6,$7) RETURNING `+capacityColumns, p.ID, p.TenantID, p.PlanNumber, p.PeriodStart, p.PeriodEnd, p.PlanningUtilizationPct, p.Status))
}

// InsertLine stores one line.
func (CapacityRepository) InsertLine(ctx context.Context, tx pgx.Tx, l CapacityPlanLine) (CapacityPlanLine, error) {
	uncomputed, err := json.Marshal(l.UncomputedMachines)
	if err != nil {
		return CapacityPlanLine{}, err
	}
	return scanCapacityLine(tx.QueryRow(ctx, `INSERT INTO capacity_plan_line (id, tenant_id, capacity_plan_id, plant_id, line_id, product_id, total_capacity, planning_capacity, capacity_buffer,
			demand_quantity, planned_quantity, capacity_utilization, capacity_gap, capacity_status, uncomputed_machines, available_minutes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16) RETURNING `+capacityLineColumns,
		l.ID, l.TenantID, l.CapacityPlanID, l.PlantID, l.LineID, l.ProductID, l.TotalCapacity, l.PlanningCapacity, l.CapacityBuffer, l.DemandQuantity, l.PlannedQuantity,
		l.CapacityUtilization, l.CapacityGap, l.CapacityStatus, uncomputed, l.AvailableMinutes))
}

// FindByID reads one plan; nil when absent.
func (CapacityRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*CapacityPlan, error) {
	p, err := scanCapacityPlan(tx.QueryRow(ctx, `SELECT `+capacityColumns+` FROM capacity_plan WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ListLines reads a plan's lines.
func (CapacityRepository) ListLines(ctx context.Context, tx pgx.Tx, tenantID, planID string) ([]CapacityPlanLine, error) {
	rows, err := tx.Query(ctx, `SELECT `+capacityLineColumns+` FROM capacity_plan_line WHERE tenant_id = $1 AND capacity_plan_id = $2 ORDER BY product_id NULLS LAST, id`, tenantID, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CapacityPlanLine{}
	for rows.Next() {
		l, err := scanCapacityLine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// List reads plans newest period first (limit ≤ 500).
func (CapacityRepository) List(ctx context.Context, tx pgx.Tx, tenantID, status, periodStart string, limit int) ([]CapacityPlan, error) {
	where, args := []string{"tenant_id = $1"}, []any{tenantID}
	if status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if periodStart != "" {
		args = append(args, periodStart)
		where = append(where, fmt.Sprintf("period_start = $%d::date", len(args)))
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	args = append(args, limit)
	rows, err := tx.Query(ctx, `SELECT `+capacityColumns+` FROM capacity_plan WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY period_start DESC, plan_number DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CapacityPlan{}
	for rows.Next() {
		p, err := scanCapacityPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// MarkSuperseded points a plan at its replacement; its lines stay.
func (CapacityRepository) MarkSuperseded(ctx context.Context, tx pgx.Tx, tenantID, id, byID string) error {
	_, err := tx.Exec(ctx, `UPDATE capacity_plan SET status = 'SUPERSEDED', superseded_by_id = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, id, byID)
	return err
}

// IsReferencedByPlan reports whether a Production Plan points at the snapshot.
func (CapacityRepository) IsReferencedByPlan(ctx context.Context, tx pgx.Tx, tenantID, id string) (bool, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM production_plan WHERE tenant_id = $1 AND capacity_plan_id = $2`, tenantID, id).Scan(&n)
	return n > 0, err
}

// productDemand is demand per product for a period, from Customer Orders —
// never from Work Orders (§8 A5).
type productDemand struct {
	ProductID                       string
	DemandQuantity, PlannedQuantity int
}

func (CapacityRepository) DemandByProduct(ctx context.Context, tx pgx.Tx, tenantID, periodStart, periodEnd string) ([]productDemand, error) {
	rows, err := tx.Query(ctx, `SELECT col.product_id, SUM(col.ordered_quantity)::int, SUM(col.planned_quantity)::int
		FROM customer_order_line col JOIN customer_order co ON co.id = col.customer_order_id
		WHERE col.tenant_id = $1 AND co.status <> 'CANCELLED' AND COALESCE(col.requested_delivery_date, co.requested_delivery_date) BETWEEN $2::date AND $3::date
		GROUP BY col.product_id ORDER BY col.product_id`, tenantID, periodStart, periodEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []productDemand{}
	for rows.Next() {
		var d productDemand
		if err := rows.Scan(&d.ProductID, &d.DemandQuantity, &d.PlannedQuantity); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// PlannedDowntimeMinutes is the planned downtime already on the calendar,
// per machine; §45.6 requires it to come off the top.
func (CapacityRepository) PlannedDowntimeMinutes(ctx context.Context, tx pgx.Tx, tenantID, periodStart, periodEnd string) (map[string]float64, error) {
	rows, err := tx.Query(ctx, `SELECT machine_id, (COALESCE(SUM(duration_seconds), 0) / 60.0)::float8 FROM downtime_record
		WHERE tenant_id = $1 AND is_planned = TRUE AND shift_date BETWEEN $2::date AND $3::date GROUP BY machine_id`, tenantID, periodStart, periodEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var id string
		var minutes float64
		if err := rows.Scan(&id, &minutes); err != nil {
			return nil, err
		}
		out[id] = minutes
	}
	return out, rows.Err()
}

// --- Service ------------------------------------------------------------------

// ComputeCapacityInput is what a snapshot is computed for.
type ComputeCapacityInput struct {
	PeriodStart, PeriodEnd string
	PlanningUtilizationPct *float64
	PlantID, LineID        string
	ProductIDs             []string
}

// CapacityPlans lists plan headers.
func (s *Service) CapacityPlans(ctx context.Context, tenantID, status string) ([]CapacityPlan, error) {
	var out []CapacityPlan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.capacity.List(ctx, tx, tenantID, status, "", 0)
		return err
	})
	return out, err
}

func (s *Service) capacityDetail(ctx context.Context, tx pgx.Tx, tenantID, id string) (CapacityPlanDetail, error) {
	plan, err := s.capacity.FindByID(ctx, tx, tenantID, id)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	if plan == nil {
		return CapacityPlanDetail{}, httpx.NotFound("Capacity plan tidak ditemukan.")
	}
	lines, err := s.capacity.ListLines(ctx, tx, tenantID, id)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	return CapacityPlanDetail{CapacityPlan: *plan, Lines: lines}, nil
}

// CapacityPlanByID reads one plan with lines.
func (s *Service) CapacityPlanByID(ctx context.Context, tenantID, id string) (CapacityPlanDetail, error) {
	var out CapacityPlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.capacityDetail(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// LatestCapacityForPeriod is the live snapshot for a period, if computed.
func (s *Service) LatestCapacityForPeriod(ctx context.Context, tenantID, periodStart string) (*CapacityPlanDetail, error) {
	var out *CapacityPlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plans, err := s.capacity.List(ctx, tx, tenantID, "COMPUTED", periodStart, 0)
		if err != nil || len(plans) == 0 {
			return err
		}
		lines, err := s.capacity.ListLines(ctx, tx, tenantID, plans[0].ID)
		if err != nil {
			return err
		}
		out = &CapacityPlanDetail{CapacityPlan: plans[0], Lines: lines}
		return nil
	})
	return out, err
}

func (s *Service) minutesPerMachine(ctx context.Context, tx pgx.Tx, tenantID, periodStart, periodEnd string) (float64, int, error) {
	shifts, err := s.reference.ListShifts(ctx, tx, tenantID)
	if err != nil {
		return 0, 0, err
	}
	days := DaysInPeriod(periodStart, periodEnd)
	perDay := 0
	for _, sh := range shifts {
		if sh.Active {
			perDay += ShiftMinutes(sh.StartTime, sh.EndTime, sh.BreakMinutes)
		}
	}
	// Rostered minutes per machine over the period: every active shift, every day.
	return float64(days * perDay), days, nil
}

func machineInputs(machines []MachineRate, minutes float64, downtime map[string]float64) []MachineCapacityInput {
	inputs := make([]MachineCapacityInput, len(machines))
	for i, m := range machines {
		inputs[i] = MachineCapacityInput{MachineID: m.MachineID, MachineCode: m.MachineCode, MachineName: m.MachineName, LineID: m.LineID, PlantID: m.PlantID, MachineStatus: m.MachineStatus,
			IdealCycleTimeSeconds: m.IdealCycleTimeSeconds, AvailableMinutes: minutes, PlannedDowntimeMinutes: downtime[m.MachineID]}
	}
	return inputs
}

// ComputeCapacity computes and stores a snapshot: one line per product with
// demand in the period.
func (s *Service) ComputeCapacity(ctx context.Context, tenantID string, in ComputeCapacityInput, actorID string) (CapacityPlanDetail, error) {
	if dateOf(in.PeriodEnd).Before(dateOf(in.PeriodStart)) {
		return CapacityPlanDetail{}, httpx.Validation("Periode capacity plan tidak valid.", httpx.FieldError{Field: "periodEnd", Code: "OUT_OF_RANGE", Message: "Period end harus setelah period start."})
	}
	var out CapacityPlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.computeCapacityIn(ctx, tx, tenantID, in, actorID, nil)
		return err
	})
	return out, err
}

func (s *Service) computeCapacityIn(ctx context.Context, tx pgx.Tx, tenantID string, in ComputeCapacityInput, actorID string, supersedes *CapacityPlan) (CapacityPlanDetail, error) {
	config, err := s.reference.GetConfig(ctx, tx, tenantID)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	utilization := db.Deref(in.PlanningUtilizationPct, config.PlanningUtilizationPct)
	minutes, days, err := s.minutesPerMachine(ctx, tx, tenantID, in.PeriodStart, in.PeriodEnd)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	downtime, err := s.capacity.PlannedDowntimeMinutes(ctx, tx, tenantID, in.PeriodStart, in.PeriodEnd)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	demandRows, err := s.capacity.DemandByProduct(ctx, tx, tenantID, in.PeriodStart, in.PeriodEnd)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	if len(in.ProductIDs) > 0 {
		wanted := map[string]bool{}
		for _, id := range in.ProductIDs {
			wanted[id] = true
		}
		filtered := demandRows[:0]
		for _, d := range demandRows {
			if wanted[d.ProductID] {
				filtered = append(filtered, d)
			}
		}
		demandRows = filtered
	}
	_, fallbackPlant, err := s.reference.FirstActiveLine(ctx, tx, tenantID)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	number, err := NextNumber(ctx, tx, tenantID, "capacity_plan", "plan_number", CapacityPlanPrefix(in.PeriodStart), 3)
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	plan, err := s.capacity.Insert(ctx, tx, CapacityPlan{ID: "cap-" + uuid.NewString(), TenantID: tenantID, PlanNumber: number, PeriodStart: in.PeriodStart, PeriodEnd: in.PeriodEnd, PlanningUtilizationPct: utilization, Status: "COMPUTED"})
	if err != nil {
		return CapacityPlanDetail{}, err
	}
	lines := []CapacityPlanLine{}
	type gap struct {
		productID  string
		assessment Assessment
	}
	var gaps []gap
	for _, demand := range demandRows {
		machines, err := s.reference.ListCompatibleMachines(ctx, tx, tenantID, demand.ProductID, in.PlantID, in.LineID)
		if err != nil {
			return CapacityPlanDetail{}, err
		}
		assessment := AssessCapacity(machineInputs(machines, minutes, downtime), utilization, demand.DemandQuantity)
		plantID := fallbackPlant
		var lineID *string
		if len(machines) > 0 {
			plantID = machines[0].PlantID
			lineID = db.Ptr(machines[0].LineID)
		}
		if in.LineID != "" {
			lineID = db.Ptr(in.LineID)
		}
		if plantID == "" {
			// capacity_plan_line.plant_id is NOT NULL, and a tenant with no
			// plant has nothing to plan against.
			return CapacityPlanDetail{}, httpx.InvalidState("Tenant belum memiliki plant atau production line aktif, sehingga kapasitas tidak dapat dihitung.")
		}
		productID := demand.ProductID
		line, err := s.capacity.InsertLine(ctx, tx, CapacityPlanLine{ID: "capl-" + uuid.NewString(), TenantID: tenantID, CapacityPlanID: plan.ID, PlantID: plantID, LineID: lineID, ProductID: &productID,
			TotalCapacity: assessment.TotalCapacity, PlanningCapacity: assessment.PlanningCapacity, CapacityBuffer: assessment.CapacityBuffer, DemandQuantity: assessment.DemandQuantity,
			PlannedQuantity: demand.PlannedQuantity, CapacityUtilization: assessment.CapacityUtilization, CapacityGap: assessment.CapacityGap, CapacityStatus: assessment.CapacityStatus,
			UncomputedMachines: assessment.UncomputedMachines, AvailableMinutes: assessment.AvailableMinutes})
		if err != nil {
			return CapacityPlanDetail{}, err
		}
		lines = append(lines, line)
		if assessment.CapacityStatus == "CAPACITY_UP_REQUIRED" {
			gaps = append(gaps, gap{demand.ProductID, assessment})
		}
	}
	action := "COMPUTE"
	var previous any
	if supersedes != nil {
		if err := s.capacity.MarkSuperseded(ctx, tx, tenantID, supersedes.ID, plan.ID); err != nil {
			return CapacityPlanDetail{}, err
		}
		action, previous = "RECALCULATE", map[string]any{"supersededPlanId": supersedes.ID}
	}
	if err := s.auditIn(ctx, tx, tenantID, actorID, "SYSTEM", "capacity_plan", plan.ID, action, previous,
		map[string]any{"planNumber": plan.PlanNumber, "planningUtilizationPct": utilization, "periodDays": days, "minutesPerMachine": minutes, "lineCount": len(lines)}); err != nil {
		return CapacityPlanDetail{}, err
	}
	// One event per product that cannot be met, so a consumer can raise the
	// Capacity Up conversation without polling the plan.
	for _, g := range gaps {
		if err := s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventCapacityGapDetected, AggregateType: "capacity_plan", AggregateID: plan.ID,
			Payload: map[string]any{"capacityPlanId": plan.ID, "productId": g.productID, "demandQuantity": g.assessment.DemandQuantity, "totalCapacity": g.assessment.TotalCapacity,
				"capacityGap": g.assessment.CapacityGap, "capacityStatus": g.assessment.CapacityStatus}}); err != nil {
			return CapacityPlanDetail{}, err
		}
	}
	return CapacityPlanDetail{CapacityPlan: plan, Lines: lines}, nil
}

// EnqueueRecalculate enqueues a recalculation job.
func (s *Service) EnqueueRecalculate(ctx context.Context, tenantID, planID, actorID string) (queue.Job, error) {
	var job queue.Job
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		plan, err := s.capacity.FindByID(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Capacity plan tidak ditemukan.")
		}
		job, err = s.jobs.EnqueueIn(ctx, tx, queue.Request{TenantID: tenantID, JobType: "CAPACITY_PLAN_RECALCULATE", Payload: map[string]any{"capacityPlanId": planID}, RequestedBy: &actorID})
		return err
	})
	return job, err
}

// RunRecalculate recomputes a plan's period as a new snapshot; the original
// is superseded, never edited.
func (s *Service) RunRecalculate(ctx context.Context, tenantID, planID, actorID string) (CapacityPlanDetail, error) {
	var out CapacityPlanDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.capacity.FindByID(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		if existing == nil {
			return httpx.NotFound("Capacity plan tidak ditemukan.")
		}
		config, err := s.reference.GetConfig(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		// A plan already referenced keeps the utilization it was computed
		// with, so a later policy change cannot rewrite a decision.
		referenced, err := s.capacity.IsReferencedByPlan(ctx, tx, tenantID, planID)
		if err != nil {
			return err
		}
		utilization := config.PlanningUtilizationPct
		if referenced {
			utilization = existing.PlanningUtilizationPct
		}
		out, err = s.computeCapacityIn(ctx, tx, tenantID, ComputeCapacityInput{PeriodStart: existing.PeriodStart, PeriodEnd: existing.PeriodEnd, PlanningUtilizationPct: &utilization}, actorID, existing)
		return err
	})
	return out, err
}

// AssessProduct is capacity for one product and quantity, computed on the
// fly without writing a snapshot (the wizard's Step 2 asks on every change).
func (s *Service) AssessProduct(ctx context.Context, tenantID, productID, periodStart, periodEnd string, demand int) (Assessment, error) {
	var out Assessment
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.assessProductIn(ctx, tx, tenantID, productID, periodStart, periodEnd, demand)
		return err
	})
	return out, err
}

func (s *Service) assessProductIn(ctx context.Context, tx pgx.Tx, tenantID, productID, periodStart, periodEnd string, demand int) (Assessment, error) {
	config, err := s.reference.GetConfig(ctx, tx, tenantID)
	if err != nil {
		return Assessment{}, err
	}
	minutes, _, err := s.minutesPerMachine(ctx, tx, tenantID, periodStart, periodEnd)
	if err != nil {
		return Assessment{}, err
	}
	downtime, err := s.capacity.PlannedDowntimeMinutes(ctx, tx, tenantID, periodStart, periodEnd)
	if err != nil {
		return Assessment{}, err
	}
	machines, err := s.reference.ListCompatibleMachines(ctx, tx, tenantID, productID, "", "")
	if err != nil {
		return Assessment{}, err
	}
	return AssessCapacity(machineInputs(machines, minutes, downtime), config.PlanningUtilizationPct, demand), nil
}

// --- Routes -------------------------------------------------------------------

var capacityStatuses = []string{"DRAFT", "COMPUTED", "SUPERSEDED"}

func (h *handler) mountCapacity(r chi.Router) {
	r.Get("/capacity-plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		status := r.URL.Query().Get("status")
		if indexOf(capacityStatuses, status) < 0 {
			status = ""
		}
		list, err := h.svc.CapacityPlans(r.Context(), h.tenant(r), status)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	// The live snapshot for a period; what the Capacity Planning screen
	// opens on. A period nobody has computed yet is an empty state.
	r.Get("/capacity-plans/current", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		periodStart := r.URL.Query().Get("periodStart")
		if periodStart == "" {
			periodStart = db.ISO(h.svc.now())[:8] + "01"
		}
		plan, err := h.svc.LatestCapacityForPeriod(r.Context(), h.tenant(r), periodStart)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.OK(w, map[string]any{"periodStart": periodStart, "plan": nil, "lines": []CapacityPlanLine{}})
		}
		return httpx.OK(w, map[string]any{"periodStart": periodStart, "plan": plan, "lines": plan.Lines})
	}))

	r.Post("/capacity-plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		periodStart := v.ISODate("periodStart", httpx.Opt{})
		periodEnd := v.ISODate("periodEnd", httpx.Opt{})
		in := ComputeCapacityInput{PlanningUtilizationPct: v.Number("planningUtilizationPct", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(100)}),
			PlantID: db.Deref(v.OptStr("plantId"), ""), LineID: db.Deref(v.OptStr("lineId"), "")}
		if err := v.Done(); err != nil {
			return err
		}
		in.PeriodStart, in.PeriodEnd = *dateOnly(periodStart), *dateOnly(periodEnd)
		plan, err := h.svc.ComputeCapacity(r.Context(), h.tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, plan)
	}))

	r.Post("/capacity-plans/{id}/recalculate", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		job, err := h.svc.EnqueueRecalculate(r.Context(), h.tenant(r), chi.URLParam(r, "id"), actorOf(r))
		if err != nil {
			return err
		}
		if h.runner != nil {
			h.runner.Nudge()
		}
		return httpx.JSON(w, http.StatusAccepted, map[string]any{"jobId": job.ID, "status": job.Status,
			"message": "Rekalkulasi dijalankan sebagai job dan menghasilkan snapshot baru; snapshot lama ditandai SUPERSEDED dan angkanya tidak diubah."})
	}))

	r.Get("/capacity-plans/assess", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		productID, periodStart, periodEnd := q.Get("productId"), q.Get("periodStart"), q.Get("periodEnd")
		v := httpx.Validate(map[string]any{"productId": productID, "periodStart": periodStart, "periodEnd": periodEnd})
		v.String("productId", httpx.Opt{})
		v.ISODate("periodStart", httpx.Opt{})
		v.ISODate("periodEnd", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		demand := 0
		if f, err := strconv.ParseFloat(q.Get("demandQuantity"), 64); err == nil {
			demand = int(f)
		}
		a, err := h.svc.AssessProduct(r.Context(), h.tenant(r), productID, *dateOnly(&periodStart), *dateOnly(&periodEnd), demand)
		if err != nil {
			return err
		}
		// §18.3: a calculated metric travels with the numbers that formed it.
		return httpx.OK(w, map[string]any{"metric": "capacity_utilization", "value": a.CapacityUtilization,
			"inputs": map[string]any{"demandQuantity": a.DemandQuantity, "totalCapacity": a.TotalCapacity, "planningCapacity": a.PlanningCapacity, "capacityBuffer": a.CapacityBuffer,
				"planningUtilizationPct": a.PlanningUtilizationPct, "availableMinutes": a.AvailableMinutes},
			"capacityStatus": a.CapacityStatus, "capacityGap": a.CapacityGap, "uncomputedMachines": a.UncomputedMachines, "contributions": a.Contributions})
	}))

	r.Get("/capacity-plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		plan, err := h.svc.CapacityPlanByID(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))
}
