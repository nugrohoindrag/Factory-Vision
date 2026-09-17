package production

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/machinestate"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
)

// PlanningReactor is how production tells planning that a fact changed
// (MES-026-1). Customer Order status is derived from these facts, and the
// derivation rules live in planning; production only announces.
type PlanningReactor interface {
	// RefreshOrdersForPlanLine re-derives the orders a plan line serves.
	// Called detached, after the transition committed.
	RefreshOrdersForPlanLine(ctx context.Context, tenantID, planLineID string) (int, error)
	// PropagateProducedQuantity carries the last process's output to the
	// plan line and its orders, inside the completing transaction.
	PropagateProducedQuantity(ctx context.Context, tx pgx.Tx, tenantID, planLineID string, outputQuantity int) (int, error)
}

// Service is production orders, work orders and batches.
type Service struct {
	pool          *db.Pool
	workOrders    WorkOrderRepository
	orders        ProductionOrderRepository
	batches       BatchRepository
	machineStates machinestate.Repository
	outbox        outbox.Writer
	detached      *async.Runner
	log           *slog.Logger

	mu       sync.RWMutex
	planning PlanningReactor
	onChange []func(tenantID string)
}

// NewService wires the execution core.
func NewService(pool *db.Pool, ob outbox.Writer, detached *async.Runner, log *slog.Logger) *Service {
	if ob == nil {
		ob = outbox.Discard{}
	}
	return &Service{pool: pool, outbox: ob, detached: detached, log: log}
}

// AttachPlanning connects the planning reactor once planning exists.
func (s *Service) AttachPlanning(p PlanningReactor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.planning = p
}

// OnChange registers a callback for every committed change to a tenant's
// execution data — the read models that cache derived figures drop their
// entry there.
func (s *Service) OnChange(fn func(tenantID string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChange = append(s.onChange, fn)
}

// Changed announces a committed change. Exported so the shop floor, which
// writes the same work orders, can announce through the same hooks.
func (s *Service) Changed(tenantID string) {
	s.mu.RLock()
	hooks := append([]func(string){}, s.onChange...)
	s.mu.RUnlock()
	for _, fn := range hooks {
		fn(tenantID)
	}
}

func (s *Service) reactor() PlanningReactor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.planning
}

// notifyPlanning fires the derivation for whatever orders a work order
// serves, detached: the transition has already committed.
func (s *Service) notifyPlanning(tenantID string, w WorkOrder) {
	planning := s.reactor()
	if planning == nil || w.ProductionPlanLineID == nil || s.detached == nil {
		return
	}
	planLineID := *w.ProductionPlanLineID
	s.detached.Go("planning.refresh", func(ctx context.Context) error {
		_, err := planning.RefreshOrdersForPlanLine(ctx, tenantID, planLineID)
		if err != nil {
			return fmt.Errorf("[planning] gagal memperbarui status Customer Order: %w", err)
		}
		return nil
	})
}

// Pool exposes the tenant transaction for modules that compose with
// production inside one transaction (the shop floor).
func (s *Service) Pool() *db.Pool { return s.pool }

// --- Production orders ---------------------------------------------------

// ProductionOrders lists a tenant's orders.
func (s *Service) ProductionOrders(ctx context.Context, tenantID string) ([]ProductionOrder, error) {
	var out []ProductionOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orders.List(ctx, tx, tenantID, 0, 0)
		return err
	})
	return out, err
}

// ProductionOrderByID reads one order; nil when absent.
func (s *Service) ProductionOrderByID(ctx context.Context, tenantID, id string) (*ProductionOrder, error) {
	var out *ProductionOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orders.FindByID(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// CreateProductionOrderInput is the create payload.
type CreateProductionOrderInput struct {
	OrderNumber string
	ProductID   string
	Quantity    int
	DueDate     string
	CreatedBy   string
}

// CreateProductionOrder stores a PLANNED order.
func (s *Service) CreateProductionOrder(ctx context.Context, tenantID string, in CreateProductionOrderInput) (ProductionOrder, error) {
	order := ProductionOrder{
		ID:          fmt.Sprintf("po-%d", time.Now().UnixMilli()),
		TenantID:    tenantID,
		OrderNumber: in.OrderNumber,
		ProductID:   in.ProductID,
		Quantity:    in.Quantity,
		DueDate:     in.DueDate,
		Status:      "PLANNED",
		CreatedBy:   in.CreatedBy,
		CreatedAt:   db.Now(),
	}
	var out ProductionOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orders.Create(ctx, tx, order)
		if err != nil {
			return err
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "production-order:created", AggregateType: "production_order", AggregateID: out.ID, Payload: out})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

// UpdateProductionOrder applies a patch.
func (s *Service) UpdateProductionOrder(ctx context.Context, tenantID, id string, p ProductionOrderPatch) (ProductionOrder, error) {
	var out *ProductionOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orders.Update(ctx, tx, tenantID, id, p)
		if err != nil {
			return err
		}
		if out == nil {
			return httpx.NotFound("Production order tidak ditemukan.")
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "production-order:updated", AggregateType: "production_order", AggregateID: out.ID, Payload: out})
	})
	if err != nil {
		return ProductionOrder{}, err
	}
	s.Changed(tenantID)
	return *out, nil
}

// DeleteProductionOrder removes an order.
func (s *Service) DeleteProductionOrder(ctx context.Context, tenantID, id string) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		removed, err := s.orders.Delete(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if !removed {
			return httpx.NotFound("Production order tidak ditemukan.")
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "production-order:deleted", AggregateType: "production_order", AggregateID: id, Payload: map[string]any{"id": id}})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return err
}

// RoutingForRelease is one active routing step, as release expands it.
type RoutingForRelease struct {
	ProductID    string
	ProcessID    string
	Sequence     int
	WorkCenterID *string
	MachineID    *string
	Active       bool
}

// ReleaseProductionOrder marks an order RELEASED and, the first time,
// expands its routing into work orders — all in one transaction.
func (s *Service) ReleaseProductionOrder(ctx context.Context, tenantID, id string, routings []RoutingForRelease) (ProductionOrder, error) {
	var out ProductionOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		order, err := s.orders.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Production order tidak ditemukan.")
		}
		released, err := s.orders.Update(ctx, tx, tenantID, id, ProductionOrderPatch{Status: db.Ptr("RELEASED")})
		if err != nil {
			return err
		}
		existing, err := s.workOrders.List(ctx, tx, tenantID, WorkOrderFilter{})
		if err != nil {
			return err
		}
		alreadyExpanded := false
		for _, w := range existing {
			if w.ProductionOrderID != nil && *w.ProductionOrderID == id {
				alreadyExpanded = true
				break
			}
		}
		if !alreadyExpanded {
			for _, route := range routings {
				if route.ProductID != order.ProductID || !route.Active {
					continue
				}
				now := time.Now()
				status := StatusScheduled
				if route.Sequence == 1 {
					status = StatusConfirmed
				}
				seq := route.Sequence
				if _, err := s.workOrders.Create(ctx, tx, WorkOrder{
					ID:                fmt.Sprintf("wo-%d-%d", now.UnixMilli(), route.Sequence),
					TenantID:          tenantID,
					ProductionOrderID: &order.ID,
					WoNumber:          fmt.Sprintf("%s-SEQ%d", order.OrderNumber, route.Sequence),
					ProductID:         order.ProductID,
					ProcessID:         db.NullIf(route.ProcessID),
					Sequence:          &seq,
					LineID:            "line-01",
					WorkCenterID:      route.WorkCenterID,
					MachineID:         route.MachineID,
					TargetQuantity:    order.Quantity,
					PlannedQuantity:   order.Quantity,
					Unit:              "PCS",
					PlannedStart:      db.ISO(now),
					PlannedEnd:        db.ISO(now.Add(8 * time.Hour)),
					Status:            status,
					Priority:          1,
					Version:           1,
					CreatedAt:         db.ISO(now),
					UpdatedAt:         db.ISO(now),
				}); err != nil {
					return err
				}
			}
		}
		if released != nil {
			out = *released
		} else {
			out = *order
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "production-order:updated", AggregateType: "production_order", AggregateID: out.ID, Payload: out})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

// --- Work orders ---------------------------------------------------------

// WorkOrders lists work orders; "ALL" filters are ignored, as the console
// sends them.
func (s *Service) WorkOrders(ctx context.Context, tenantID string, f WorkOrderFilter) ([]WorkOrder, error) {
	if f.LineID == "ALL" {
		f.LineID = ""
	}
	if f.Status == "ALL" {
		f.Status = ""
	}
	if f.ProcessID == "ALL" {
		f.ProcessID = ""
	}
	var out []WorkOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.workOrders.List(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// WorkOrderByID reads one work order; nil when absent.
func (s *Service) WorkOrderByID(ctx context.Context, tenantID, id string) (*WorkOrder, error) {
	var out *WorkOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.workOrders.FindByID(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// WorkOrderIn reads a work order inside a caller's transaction.
func (s *Service) WorkOrderIn(ctx context.Context, tx pgx.Tx, tenantID, id string) (*WorkOrder, error) {
	return s.workOrders.FindByID(ctx, tx, tenantID, id)
}

// WorkOrdersIn lists work orders inside a caller's transaction.
func (s *Service) WorkOrdersIn(ctx context.Context, tx pgx.Tx, tenantID string, f WorkOrderFilter) ([]WorkOrder, error) {
	return s.workOrders.List(ctx, tx, tenantID, f)
}

// BatchesForWorkOrderIn lists a work order's batches in a transaction.
func (s *Service) BatchesForWorkOrderIn(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) ([]Batch, error) {
	return s.batches.ListByWorkOrder(ctx, tx, tenantID, workOrderID)
}

// resolvePlanLineID is the plan line a work order belongs to (§8): named
// directly, or the one migration 010 created for a legacy production order.
func (s *Service) resolvePlanLineID(ctx context.Context, tx pgx.Tx, tenantID string, planLineID, productionOrderID *string) (string, error) {
	if planLineID != nil && *planLineID != "" {
		var id string
		err := tx.QueryRow(ctx, `SELECT id FROM production_plan_line WHERE tenant_id = $1 AND id = $2`, tenantID, *planLineID).Scan(&id)
		if db.IsNoRows(err) {
			return "", httpx.Validation("Production Plan Line tidak ditemukan.", httpx.FieldError{
				Field: "productionPlanLineId", Code: "NOT_FOUND",
				Message: fmt.Sprintf("Production Plan Line %s tidak ada.", *planLineID),
			})
		}
		return id, err
	}
	if productionOrderID != nil && *productionOrderID != "" {
		var id string
		err := tx.QueryRow(ctx, `SELECT id FROM production_plan_line WHERE tenant_id = $1 AND id = $2`, tenantID, "planline-mig-"+*productionOrderID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !db.IsNoRows(err) {
			return "", err
		}
	}
	return "", httpx.Validation("Work Order harus menempel pada Production Plan Line.", httpx.FieldError{
		Field: "productionPlanLineId", Code: "REQUIRED",
		Message: "Sertakan productionPlanLineId. Work Order pada v1.0 dihasilkan dari Production Plan " +
			"(POST /v1/production-plans/{id}/generate-work-orders); pembuatan manual tetap " +
			"memerlukan plan line sebagai pemilik demand-nya.",
	})
}

// CreateWorkOrderInput is the manual create payload.
type CreateWorkOrderInput struct {
	ProductionOrderID    *string
	ProductionPlanLineID *string
	ProductID            string
	LineID               string
	ProcessID            *string
	Sequence             *int
	WorkCenterID         *string
	MachineID            *string
	ShiftID              *string
	MoldID               *string
	TargetQuantity       int
	Unit                 *string
	Priority             *int
	PlannedStart         string
	PlannedEnd           string
}

// CreateWorkOrder stores a SCHEDULED work order numbered WO-YYYYMMDD-NNN.
func (s *Service) CreateWorkOrder(ctx context.Context, tenantID string, in CreateWorkOrderInput) (WorkOrder, error) {
	var out WorkOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		planLineID, err := s.resolvePlanLineID(ctx, tx, tenantID, in.ProductionPlanLineID, in.ProductionOrderID)
		if err != nil {
			return err
		}
		count, err := s.workOrders.Count(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		now := time.Now()
		iso := db.ISO(now)
		sequence := 1
		if in.Sequence != nil && *in.Sequence != 0 {
			sequence = *in.Sequence
		}
		priority := 1
		if in.Priority != nil && *in.Priority != 0 {
			priority = *in.Priority
		}
		unit := "PCS"
		if in.Unit != nil && *in.Unit != "" {
			unit = *in.Unit
		}
		out, err = s.workOrders.Create(ctx, tx, WorkOrder{
			ID:                   fmt.Sprintf("wo-%d", now.UnixMilli()),
			TenantID:             tenantID,
			ProductionPlanLineID: &planLineID,
			ProductionOrderID:    db.Str(in.ProductionOrderID),
			WoNumber:             fmt.Sprintf("WO-%s-%03d", strings.ReplaceAll(iso[:10], "-", ""), count+1),
			ProductID:            in.ProductID,
			ProcessID:            db.Str(in.ProcessID),
			Sequence:             &sequence,
			LineID:               in.LineID,
			WorkCenterID:         db.Str(in.WorkCenterID),
			MachineID:            db.Str(in.MachineID),
			ShiftID:              db.Str(in.ShiftID),
			MoldID:               db.Str(in.MoldID),
			TargetQuantity:       in.TargetQuantity,
			PlannedQuantity:      in.TargetQuantity,
			Unit:                 unit,
			PlannedStart:         in.PlannedStart,
			PlannedEnd:           in.PlannedEnd,
			Status:               StatusScheduled,
			Priority:             priority,
			Version:              1,
			CreatedAt:            iso,
			UpdatedAt:            iso,
		})
		if err != nil {
			return err
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "work-order:created", AggregateType: "work_order", AggregateID: out.ID, Payload: out})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

// CreateWorkOrderIn stores a fully specified work order in a caller's
// transaction (generation, the demo seed).
func (s *Service) CreateWorkOrderIn(ctx context.Context, tx pgx.Tx, w WorkOrder) (WorkOrder, error) {
	return s.workOrders.Create(ctx, tx, w)
}

// BatchesForWorkOrder lists the batches that subdivide one work order.
func (s *Service) BatchesForWorkOrder(ctx context.Context, tenantID, workOrderID string) ([]Batch, error) {
	var out []Batch
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.batches.ListByWorkOrder(ctx, tx, tenantID, workOrderID)
		return err
	})
	return out, err
}

// AssignBatchToWorkOrder points a batch at a work order and flips the work
// order into batch mode (ADR-29). Refused by the execution-path constraint
// once direct production records exist.
func (s *Service) AssignBatchToWorkOrder(ctx context.Context, tenantID, workOrderID, batchID string) (WorkOrder, error) {
	var out WorkOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		w, err := s.workOrders.FindByID(ctx, tx, tenantID, workOrderID)
		if err != nil {
			return err
		}
		if w == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		batch, err := s.batches.FindByID(ctx, tx, tenantID, batchID)
		if err != nil {
			return err
		}
		if batch == nil {
			return httpx.NotFound("Batch tidak ditemukan.")
		}
		if _, err := s.batches.Update(ctx, tx, tenantID, batchID, BatchPatch{WorkOrderID: &workOrderID}); err != nil {
			return executionPathConflict(err)
		}
		updated, err := s.workOrders.Update(ctx, tx, tenantID, workOrderID, Patch{IsBatchManaged: db.Ptr(true)})
		if err != nil {
			return executionPathConflict(err)
		}
		if updated == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		out = *updated
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "work-order:updated", AggregateType: "work_order", AggregateID: out.ID, Payload: out})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

func executionPathConflict(err error) error {
	if code, _ := db.SQLState(err); code == "23514" || code == "23503" {
		return httpx.InvalidState("Work order sudah memiliki production record tanpa batch, sehingga tidak dapat diubah menjadi batch-managed.")
	}
	return err
}

// UpdateWorkOrder is the planner's edit form: a patch, then an optional
// unguarded status change.
func (s *Service) UpdateWorkOrder(ctx context.Context, tenantID, id string, p Patch, status *string) (WorkOrder, error) {
	var out WorkOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		current, err := s.workOrders.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		updated, err := s.workOrders.Update(ctx, tx, tenantID, id, p)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		out = *updated
		if status != nil && *status != "" && *status != current.Status {
			moved, err := s.workOrders.UpdateStatus(ctx, tx, tenantID, id, *status, Stamps{})
			if err != nil {
				return err
			}
			if moved != nil {
				out = *moved
			}
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "work-order:updated", AggregateType: "work_order", AggregateID: out.ID, Payload: out})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

// DeleteWorkOrder removes a work order.
func (s *Service) DeleteWorkOrder(ctx context.Context, tenantID, id string) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		removed, err := s.workOrders.Delete(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if !removed {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "work-order:deleted", AggregateType: "work_order", AggregateID: id, Payload: map[string]any{"id": id}})
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return err
}

// transitionContext gathers the facts §11's guards judge, inside the
// caller's transaction alongside the status itself.
func (s *Service) transitionContext(ctx context.Context, tx pgx.Tx, tenantID string, w WorkOrder) (TransitionContext, error) {
	var (
		activeDowntime int
		moldCompat     int
		strict         bool
	)
	if err := tx.QueryRow(ctx,
		`SELECT
		   (SELECT count(*) FROM downtime_record WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'ACTIVE'),
		   (SELECT count(*) FROM product_mold_compatibility WHERE tenant_id = $1 AND product_id = $3 AND active = TRUE),
		   COALESCE((SELECT strict_process_sequence FROM planning_config WHERE tenant_id = $1), FALSE)`,
		tenantID, w.ID, w.ProductID).Scan(&activeDowntime, &moldCompat, &strict); err != nil {
		return TransitionContext{}, err
	}
	planned := w.PlannedQuantity
	c := TransitionContext{
		PlannedQuantity:       &planned,
		PlannedStart:          &w.PlannedStart,
		PlannedEnd:            &w.PlannedEnd,
		Sequence:              w.Sequence,
		MachineID:             w.MachineID,
		MoldID:                w.MoldID,
		MoldRequired:          moldCompat > 0,
		ShiftID:               w.ShiftID,
		ActiveDowntimeCount:   activeDowntime,
		StrictProcessSequence: strict,
	}
	if w.PredecessorWorkOrderID != nil {
		predecessor, err := s.workOrders.FindByID(ctx, tx, tenantID, *w.PredecessorWorkOrderID)
		if err != nil {
			return c, err
		}
		if predecessor != nil {
			c.Predecessor = &PredecessorState{
				WorkOrderID:       predecessor.WoNumber,
				Status:            predecessor.Status,
				AvailableQuantity: AvailableQuantity(predecessor.TransferredQuantity, w.InputQuantity),
			}
		}
	}
	return c, nil
}

// resourceConflict turns a resource-exclusivity unique violation (migration
// 021) into a 409 anyone can read; nil for anything else.
func resourceConflict(err error, w WorkOrder) error {
	code, constraint := db.SQLState(err)
	if code != "23505" {
		return nil
	}
	switch constraint {
	case "uq_work_order_machine_in_production":
		return httpx.Conflict(fmt.Sprintf("Mesin %s sudah menjalankan work order lain. ", db.Deref(w.MachineID, "")) +
			"Satu mesin hanya dapat menjalankan satu work order pada satu waktu, " +
			"selesaikan atau hentikan work order tersebut lebih dulu.")
	case "uq_work_order_mold_in_production":
		return httpx.Conflict(fmt.Sprintf("Mold %s sedang dipakai work order lain. ", db.Deref(w.MoldID, "")) +
			"Satu mold fisik tidak dapat terpasang di dua mesin sekaligus.")
	}
	return nil
}

type overrides struct {
	assignedOperatorIDs []string
	reason              *string
}

// transition applies a guarded state transition: read, judge, write, and
// the machine-state effect, the planning propagation and the split
// roll-up, all in one transaction.
func (s *Service) transition(ctx context.Context, tenantID, id, next string, stamps func(current WorkOrder) Stamps, o overrides) (WorkOrder, error) {
	var out WorkOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		current, err := s.workOrders.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		c, err := s.transitionContext(ctx, tx, tenantID, *current)
		if err != nil {
			return err
		}
		if o.assignedOperatorIDs != nil {
			c.AssignedOperatorIDs = o.assignedOperatorIDs
		}
		if o.reason != nil {
			c.Reason = o.reason
		}
		decision := Evaluate(current.Status, next, c)
		if !decision.Allowed {
			terr := &TransitionError{From: current.Status, To: next, Reasons: decision.Reasons}
			return httpx.InvalidState(terr.Error())
		}

		updated, err := s.workOrders.UpdateStatus(ctx, tx, tenantID, id, next, stamps(*current))
		if err != nil {
			if conflict := resourceConflict(err, *current); conflict != nil {
				return conflict
			}
			return err
		}
		if updated == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}

		if decision.Effects.MachineState != "" && updated.MachineID != nil {
			state := machinestate.Idle
			if decision.Effects.MachineState == MachineRunning {
				state = machinestate.Running
			}
			if _, err := s.machineStates.Transition(ctx, tx, machinestate.Entry{
				TenantID: tenantID, MachineID: *updated.MachineID, ProcessID: updated.ProcessID,
				State: state, StartedAt: db.Now(), WorkOrderID: &updated.ID,
			}); err != nil {
				return err
			}
		}

		// Completing the last process is what produces finished goods, so
		// that is the only point at which produced quantity reaches the
		// Customer Order (§8 A2).
		if next == StatusCompleted {
			var successors int
			if err := tx.QueryRow(ctx,
				`SELECT count(*) FROM work_order WHERE tenant_id = $1 AND predecessor_work_order_id = $2`,
				tenantID, id).Scan(&successors); err != nil {
				return err
			}
			if planning := s.reactor(); successors == 0 && updated.ProductionPlanLineID != nil && planning != nil {
				if _, err := planning.PropagateProducedQuantity(ctx, tx, tenantID, *updated.ProductionPlanLineID, updated.OutputQuantity); err != nil {
					return err
				}
			}
		}

		if updated.ParentWorkOrderID != nil {
			if _, err := s.rollUp(ctx, tx, tenantID, *updated.ParentWorkOrderID); err != nil {
				return err
			}
		}
		out = *updated
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "work-order:updated", AggregateType: "work_order", AggregateID: out.ID, Payload: out})
	})
	if err != nil {
		return WorkOrder{}, err
	}
	s.Changed(tenantID)
	s.notifyPlanning(tenantID, out)
	return out, nil
}

// ConfirmWorkOrder moves SCHEDULED → CONFIRMED.
func (s *Service) ConfirmWorkOrder(ctx context.Context, tenantID, id string, confirmedBy *string) (WorkOrder, error) {
	return s.transition(ctx, tenantID, id, StatusConfirmed, func(WorkOrder) Stamps {
		return Stamps{ConfirmedBy: confirmedBy, ConfirmedAt: db.Ptr(db.Now())}
	}, overrides{})
}

// StartWorkOrder moves CONFIRMED → IN_PRODUCTION; the operator issuing the
// start is the assignment for this transition.
func (s *Service) StartWorkOrder(ctx context.Context, tenantID, id, operatorID string, occurredAt *string) (WorkOrder, error) {
	assigned := []string{}
	if operatorID != "" {
		assigned = []string{operatorID}
	}
	return s.transition(ctx, tenantID, id, StatusInProduction, func(current WorkOrder) Stamps {
		start := db.Now()
		if current.ActualStart != nil {
			start = *current.ActualStart
		} else if occurredAt != nil && *occurredAt != "" {
			start = *occurredAt
		}
		return Stamps{ActualStart: &start}
	}, overrides{assignedOperatorIDs: assigned})
}

// CompleteWorkOrder moves IN_PRODUCTION → COMPLETED.
func (s *Service) CompleteWorkOrder(ctx context.Context, tenantID, id string, occurredAt *string) (WorkOrder, error) {
	return s.transition(ctx, tenantID, id, StatusCompleted, func(WorkOrder) Stamps {
		end := db.Now()
		if occurredAt != nil && *occurredAt != "" {
			end = *occurredAt
		}
		return Stamps{ActualEnd: &end}
	}, overrides{})
}

// CancelWorkOrder moves any live status → CANCELLED; the reason is
// mandatory and stored on the row.
func (s *Service) CancelWorkOrder(ctx context.Context, tenantID, id string, reason *string) (WorkOrder, error) {
	return s.transition(ctx, tenantID, id, StatusCancelled, func(WorkOrder) Stamps {
		return Stamps{StatusReason: reason}
	}, overrides{reason: reason})
}

// IncrementQuantities adds to a work order's counters in its own
// transaction (corrections).
func (s *Service) IncrementQuantities(ctx context.Context, tenantID, id string, inc Increment) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.IncrementQuantitiesIn(ctx, tx, tenantID, id, inc)
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return err
}

// IncrementQuantitiesIn adds to a work order's counters in the caller's
// transaction (a production record and its totals commit together).
func (s *Service) IncrementQuantitiesIn(ctx context.Context, tx pgx.Tx, tenantID, id string, inc Increment) error {
	if _, err := s.workOrders.IncrementQuantities(ctx, tx, tenantID, id, inc); err != nil {
		return err
	}
	return s.rollUpIfChild(ctx, tx, tenantID, id)
}

// SplitWorkOrder is the supervisor-facing dynamic split.
func (s *Service) SplitWorkOrder(ctx context.Context, tenantID, id string, parts []SplitPart, actor *string) (SplitResult, error) {
	var out SplitResult
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.split(ctx, tx, tenantID, id, parts, actor)
		if err != nil {
			return err
		}
		events := []outbox.Event{{Type: "work-order:updated", AggregateType: "work_order", AggregateID: out.Parent.ID, Payload: out.Parent}}
		for _, child := range out.Children {
			events = append(events, outbox.Event{Type: "work-order:updated", AggregateType: "work_order", AggregateID: child.ID, Payload: child})
		}
		for _, e := range events {
			if err := s.outbox.Publish(ctx, tx, tenantID, e); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

// Counts is the boot log's row counts.
func (s *Service) Counts(ctx context.Context, tenantID string) (orders, workOrders int, err error) {
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		if orders, err = s.orders.Count(ctx, tx, tenantID); err != nil {
			return err
		}
		workOrders, err = s.workOrders.Count(ctx, tx, tenantID)
		return err
	})
	return
}

// --- Batches (master/batches, ADR-29) -------------------------------------

// Batches lists a tenant's batches.
func (s *Service) Batches(ctx context.Context, tenantID, productID, status string) ([]Batch, error) {
	var out []Batch
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.batches.List(ctx, tx, tenantID, productID, status)
		return err
	})
	return out, err
}

// BatchByID reads one batch; nil when absent.
func (s *Service) BatchByID(ctx context.Context, tenantID, id string) (*Batch, error) {
	var out *Batch
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.batches.FindByID(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// CreateBatchInput is the master/batches create payload.
type CreateBatchInput struct {
	BatchNumber          string
	ProductID            string
	WorkOrderID          string
	ProductionDate       string
	ProductionOrderID    *string
	Status               *string
	PlannedQuantity      *int
	MaterialLotReference *string
	MachineID            *string
	MoldID               *string
	OperatorID           *string
	ShiftID              *string
	ExpiryDate           *string
}

// CreateBatch stores a batch under its work order. The work order is never
// guessed (ADR-29), and the sequence is the next one for that work order.
func (s *Service) CreateBatch(ctx context.Context, tenantID string, in CreateBatchInput) (Batch, error) {
	var out Batch
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if in.WorkOrderID == "" {
			return httpx.Validation("Batch harus melekat pada satu work order (ADR-29).", httpx.FieldError{
				Field: "workOrderId", Code: "REQUIRED", Message: "Pilih work order yang batch ini bagi.",
			})
		}
		owner, err := s.workOrders.FindByID(ctx, tx, tenantID, in.WorkOrderID)
		if err != nil {
			return err
		}
		if owner == nil {
			return httpx.Validation("Work order tidak ditemukan.", httpx.FieldError{
				Field: "workOrderId", Code: "NOT_FOUND", Message: "Work order tidak ditemukan.",
			})
		}
		sequence, err := s.batches.NextSequence(ctx, tx, tenantID, in.WorkOrderID)
		if err != nil {
			return err
		}
		status := "OPEN"
		if in.Status != nil && *in.Status != "" {
			status = *in.Status
		}
		now := db.Now()
		out, err = s.batches.Create(ctx, tx, Batch{
			ID:                   fmt.Sprintf("batch-%d", time.Now().UnixMilli()),
			TenantID:             tenantID,
			BatchNumber:          in.BatchNumber,
			WorkOrderID:          in.WorkOrderID,
			ProductID:            in.ProductID,
			ProcessID:            owner.ProcessID,
			Sequence:             sequence,
			PlannedQuantity:      db.Deref(in.PlannedQuantity, 0),
			Status:               status,
			MaterialLotReference: db.Str(in.MaterialLotReference),
			MachineID:            db.Str(in.MachineID),
			MoldID:               db.Str(in.MoldID),
			OperatorID:           db.Str(in.OperatorID),
			ShiftID:              db.Str(in.ShiftID),
			ProductionDate:       in.ProductionDate,
			ExpiryDate:           db.Str(in.ExpiryDate),
			ProductionOrderID:    db.Str(in.ProductionOrderID),
			Version:              1,
			CreatedAt:            now,
			UpdatedAt:            now,
		})
		return err
	})
	if err == nil {
		s.Changed(tenantID)
	}
	return out, err
}

// UpdateBatch applies a patch to a batch.
func (s *Service) UpdateBatch(ctx context.Context, tenantID, id string, p BatchPatch) (Batch, error) {
	var out *Batch
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.batches.Update(ctx, tx, tenantID, id, p)
		if err != nil {
			return err
		}
		if out == nil {
			return httpx.NotFound("Production batch not found")
		}
		return nil
	})
	if err != nil {
		return Batch{}, err
	}
	s.Changed(tenantID)
	return *out, nil
}

// IsTransitionError reports whether an error is a refused transition.
func IsTransitionError(err error) bool {
	var t *TransitionError
	return errors.As(err, &t)
}
