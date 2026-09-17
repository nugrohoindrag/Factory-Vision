package planning

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/queue"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/storage"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// Service is the planning module: customers, orders, forecasts, capacity
// and production plans over one pool, one transactional audit, one outbox.
type Service struct {
	pool      *db.Pool
	audit     *audit.Service
	outbox    outbox.Writer
	jobs      *queue.Queue
	store     storage.Store
	customers CustomerRepository
	orders    OrderRepository
	forecasts ForecastRepository
	capacity  CapacityRepository
	plans     PlanRepository
	reference Reference
	now       func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, auditor *audit.Service, ob outbox.Writer, jobs *queue.Queue, store storage.Store) *Service {
	if ob == nil {
		ob = outbox.Discard{}
	}
	return &Service{pool: pool, audit: auditor, outbox: ob, jobs: jobs, store: store, now: time.Now}
}

// JobHandlers is the handler map for planning work, for the API's in-process
// runner and for `fv worker`.
func (s *Service) JobHandlers() map[string]queue.Handler {
	return map[string]queue.Handler{
		"DEMAND_FORECAST_GENERATE": func(ctx context.Context, job queue.Job) (map[string]any, error) {
			var in GenerateForecastInput
			raw, err := json.Marshal(job.Payload)
			if err != nil {
				return nil, err
			}
			if err := json.Unmarshal(raw, &in); err != nil {
				return nil, err
			}
			detail, err := s.RunForecast(ctx, job.TenantID, in, db.Deref(job.RequestedBy, "system"))
			if err != nil {
				return nil, err
			}
			insufficient := 0
			for _, l := range detail.Lines {
				if l.InsufficientHistory {
					insufficient++
				}
			}
			return map[string]any{"demandForecastId": detail.ID, "forecastNumber": detail.ForecastNumber, "lineCount": len(detail.Lines), "insufficientHistoryCount": insufficient}, nil
		},
		"CAPACITY_PLAN_RECALCULATE": func(ctx context.Context, job queue.Job) (map[string]any, error) {
			planID, _ := job.Payload["capacityPlanId"].(string)
			if planID == "" {
				return nil, errNoCapacityPlan
			}
			detail, err := s.RunRecalculate(ctx, job.TenantID, planID, db.Deref(job.RequestedBy, "system"))
			if err != nil {
				return nil, err
			}
			return map[string]any{"capacityPlanId": detail.ID, "planNumber": detail.PlanNumber, "lineCount": len(detail.Lines)}, nil
		},
	}
}

type constError string

func (e constError) Error() string { return string(e) }

const errNoCapacityPlan = constError("Job CAPACITY_PLAN_RECALCULATE tanpa capacityPlanId.")

// GetConfig reads the planning policy.
func (s *Service) GetConfig(ctx context.Context, tenantID string) (Config, error) {
	var out Config
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.reference.GetConfig(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// UpdateConfig patches the planning policy.
func (s *Service) UpdateConfig(ctx context.Context, tenantID string, utilization *float64, strict *bool) (Config, error) {
	var out Config
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.reference.UpsertConfig(ctx, tx, tenantID, utilization, strict)
		return err
	})
	return out, err
}

// --- Facade (MES-019-2): everything another module may ask planning ----------

// PlanLineDemandView is the demand behind a plan line, with each
// contributing Customer Order.
type PlanLineDemandView struct {
	ProductionPlanLineID string           `json:"productionPlanLineId"`
	ProductID            string           `json:"productId"`
	PlannedQuantity      int              `json:"plannedQuantity"`
	DemandQuantity       int              `json:"demandQuantity"`
	Demands              []PlanLineDemand `json:"demands"`
}

// PlanLineDemand is one Customer Order a plan line produces for.
type PlanLineDemand struct {
	CustomerOrderID       string  `json:"customerOrderId"`
	CustomerOrderNumber   string  `json:"customerOrderNumber"`
	CustomerOrderLineID   string  `json:"customerOrderLineId"`
	CustomerID            string  `json:"customerId"`
	CustomerName          string  `json:"customerName"`
	DemandQuantity        int     `json:"demandQuantity"`
	RequestedDeliveryDate *string `json:"requestedDeliveryDate,omitempty"`
}

// WorkOrderDemandView is the read-only customer view of a Work Order, which
// stores no customer itself (ADR-22, §25.5).
type WorkOrderDemandView struct {
	WorkOrderID string `json:"workOrderId"`
	PlanLineDemandView
}

// PlanDemandLine is what a plan line asks the factory to make, in the
// terms material planning needs (Improvement PRD §3.1, §3.2).
type PlanDemandLine struct {
	ProductionPlanID     string `json:"productionPlanId"`
	PlanNumber           string `json:"planNumber"`
	ProductionPlanLineID string `json:"productionPlanLineId"`
	ProductID            string `json:"productId"`
	PlannedQuantity      int    `json:"plannedQuantity"`
	RequiredDate         string `json:"requiredDate"`
	Status               string `json:"status"`
}

// RefreshOrdersForPlanLine recomputes every order a plan line serves; used
// after a Work Order transition.
func (s *Service) RefreshOrdersForPlanLine(ctx context.Context, tenantID, planLineID string) (int, error) {
	n := 0
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT DISTINCT customer_order_id FROM production_plan_demand WHERE tenant_id = $1 AND production_plan_line_id = $2`, tenantID, planLineID)
		if err != nil {
			return err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := s.RefreshStatusIn(ctx, tx, tenantID, id, ""); err != nil {
				return err
			}
		}
		n = len(ids)
		return nil
	})
	return n, err
}

// PropagateProducedQuantity records finished goods against the Customer
// Order lines a plan line serves (§8 A4), pro-rata by demand and capped at
// what each line still needs; the rounding remainder goes to the earliest
// requested delivery date. Runs inside the caller's transaction.
func (s *Service) PropagateProducedQuantity(ctx context.Context, tx pgx.Tx, tenantID, planLineID string, output int) (int, error) {
	if output <= 0 {
		return 0, nil
	}
	rows, err := tx.Query(ctx, `SELECT ppd.customer_order_id, ppd.customer_order_line_id, ppd.demand_quantity, col.ordered_quantity, col.produced_quantity,
			to_char(COALESCE(col.requested_delivery_date, co.requested_delivery_date), 'YYYY-MM-DD')
		FROM production_plan_demand ppd
		JOIN customer_order_line col ON col.id = ppd.customer_order_line_id
		JOIN customer_order co ON co.id = ppd.customer_order_id
		WHERE ppd.tenant_id = $1 AND ppd.production_plan_line_id = $2
		ORDER BY 6, ppd.customer_order_line_id FOR UPDATE OF col`, tenantID, planLineID)
	if err != nil {
		return 0, err
	}
	type share struct {
		orderID, lineID string
		demand, share   int
		remaining       int
	}
	var shares []share
	totalDemand := 0
	for rows.Next() {
		var sh share
		var ordered, produced int
		var date string
		if err := rows.Scan(&sh.orderID, &sh.lineID, &sh.demand, &ordered, &produced, &date); err != nil {
			rows.Close()
			return 0, err
		}
		sh.remaining = ordered - produced
		if sh.remaining < 0 {
			sh.remaining = 0
		}
		totalDemand += sh.demand
		shares = append(shares, sh)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(shares) == 0 || totalDemand <= 0 {
		return 0, nil
	}
	distributed := 0
	for i := range shares {
		sh := output * shares[i].demand / totalDemand
		if sh > shares[i].remaining {
			sh = shares[i].remaining
		}
		shares[i].share = sh
		distributed += sh
	}
	leftover := output
	if totalDemand < leftover {
		leftover = totalDemand
	}
	leftover -= distributed
	for i := range shares {
		if leftover <= 0 {
			break
		}
		room := shares[i].remaining - shares[i].share
		extra := room
		if leftover < extra {
			extra = leftover
		}
		shares[i].share += extra
		leftover -= extra
	}
	touched := map[string]bool{}
	var order []string
	for _, sh := range shares {
		if sh.share <= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE customer_order_line SET produced_quantity = produced_quantity + $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2`, tenantID, sh.lineID, sh.share); err != nil {
			return 0, err
		}
		if !touched[sh.orderID] {
			touched[sh.orderID] = true
			order = append(order, sh.orderID)
		}
	}
	for _, id := range order {
		if _, err := s.RefreshStatusIn(ctx, tx, tenantID, id, ""); err != nil {
			return 0, err
		}
	}
	return len(order), nil
}

// PlanDemandLines is the demand a material check or an MRP run should
// explode; empty planIDs means every plan whose period overlaps the horizon.
func (s *Service) PlanDemandLines(ctx context.Context, tenantID string, planIDs []string, horizonStart, horizonEnd string) ([]PlanDemandLine, error) {
	out := []PlanDemandLine{}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		where, args := []string{"p.tenant_id = $1", "p.status <> 'CANCELLED'"}, []any{tenantID}
		if len(planIDs) > 0 {
			args = append(args, planIDs)
			where = append(where, "p.id = ANY($2::varchar[])")
		}
		if horizonStart != "" {
			args = append(args, horizonStart)
			where = append(where, "p.period_end >= $"+strconv.Itoa(len(args)))
		}
		if horizonEnd != "" {
			args = append(args, horizonEnd)
			where = append(where, "p.period_start <= $"+strconv.Itoa(len(args)))
		}
		rows, err := tx.Query(ctx, `SELECT l.production_plan_id, p.plan_number, l.id, l.product_id, l.planned_quantity, to_char(COALESCE(l.required_delivery_date, p.period_end), 'YYYY-MM-DD'), l.status
			FROM production_plan_line l JOIN production_plan p ON p.id = l.production_plan_id
			WHERE `+strings.Join(where, " AND ")+` ORDER BY 6, p.plan_number, l.priority`, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l PlanDemandLine
			if err := rows.Scan(&l.ProductionPlanID, &l.PlanNumber, &l.ProductionPlanLineID, &l.ProductID, &l.PlannedQuantity, &l.RequiredDate, &l.Status); err != nil {
				return err
			}
			out = append(out, l)
		}
		return rows.Err()
	})
	return out, err
}

// StrictProcessSequence is §13's strict_process_sequence.
func (s *Service) StrictProcessSequence(ctx context.Context, tenantID string) (bool, error) {
	c, err := s.GetConfig(ctx, tenantID)
	return c.StrictProcessSequence, err
}

func (s *Service) planLineDemand(ctx context.Context, tx pgx.Tx, tenantID, planLineID string) (*PlanLineDemandView, error) {
	var view PlanLineDemandView
	err := tx.QueryRow(ctx, `SELECT id, product_id, planned_quantity, demand_quantity FROM production_plan_line WHERE tenant_id = $1 AND id = $2`, tenantID, planLineID).
		Scan(&view.ProductionPlanLineID, &view.ProductID, &view.PlannedQuantity, &view.DemandQuantity)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT ppd.customer_order_id, co.order_number, ppd.customer_order_line_id, co.customer_id, c.name, ppd.demand_quantity,
			to_char(COALESCE(col.requested_delivery_date, co.requested_delivery_date), 'YYYY-MM-DD')
		FROM production_plan_demand ppd
		JOIN customer_order co ON co.id = ppd.customer_order_id
		JOIN customer c ON c.id = co.customer_id
		JOIN customer_order_line col ON col.id = ppd.customer_order_line_id
		WHERE ppd.tenant_id = $1 AND ppd.production_plan_line_id = $2 ORDER BY co.order_number, col.line_no`, tenantID, planLineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	view.Demands = []PlanLineDemand{}
	for rows.Next() {
		var d PlanLineDemand
		if err := rows.Scan(&d.CustomerOrderID, &d.CustomerOrderNumber, &d.CustomerOrderLineID, &d.CustomerID, &d.CustomerName, &d.DemandQuantity, &d.RequestedDeliveryDate); err != nil {
			return nil, err
		}
		view.Demands = append(view.Demands, d)
	}
	return &view, rows.Err()
}

// WorkOrderDemand is GET /work-orders/{id}/demand — derived, read-only.
func (s *Service) WorkOrderDemand(ctx context.Context, tenantID, workOrderID string) (any, error) {
	var out *WorkOrderDemandView
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var planLineID *string
		err := tx.QueryRow(ctx, `SELECT production_plan_line_id FROM work_order WHERE tenant_id = $1 AND id = $2`, tenantID, workOrderID).Scan(&planLineID)
		if db.IsNoRows(err) || (err == nil && planLineID == nil) {
			return nil
		}
		if err != nil {
			return err
		}
		view, err := s.planLineDemand(ctx, tx, tenantID, *planLineID)
		if err != nil || view == nil {
			return err
		}
		out = &WorkOrderDemandView{WorkOrderID: workOrderID, PlanLineDemandView: *view}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, nil
	}
	return out, nil
}

// --- Routes -------------------------------------------------------------------

// WorkOrderGenerator generates Work Orders from a Production Plan; supplied
// by the composition root because the generator writes work_order rows and
// so belongs to production (MES-019).
type WorkOrderGenerator interface {
	GenerateForPlan(ctx context.Context, tenantID, planID, actorID string) (GenerateResult, error)
}

// GenerateResult is what a generate returned.
type GenerateResult struct {
	ProductionPlanID   string
	Created            []any
	Existing           []any
	SkippedPlanLineIDs []string
}

type handler struct {
	svc       *Service
	runner    *queue.Runner
	generator WorkOrderGenerator
}

func (h *handler) tenant(r *http.Request) string { return tenancy.TenantID(r.Context()) }

// Mount registers every planning route.
func Mount(r chi.Router, svc *Service, runner *queue.Runner, generator WorkOrderGenerator) {
	h := &handler{svc: svc, runner: runner, generator: generator}
	h.mountCustomers(r)
	h.mountOrders(r)
	h.mountForecasts(r)
	h.mountCapacity(r)
	h.mountPlans(r)

	// Planning policy: the utilization the capacity engine applies (§45.6)
	// and the process-sequence strictness the WO guard reads (§13).
	r.Get("/planning/config", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		c, err := svc.GetConfig(r.Context(), h.tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, c)
	}))
	r.Put("/planning/config", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		utilization := v.Number("planningUtilizationPct", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(100)})
		strict := v.Boolean("strictProcessSequence", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		c, err := svc.UpdateConfig(r.Context(), h.tenant(r), utilization, strict)
		if err != nil {
			return err
		}
		return httpx.OK(w, c)
	}))
}
