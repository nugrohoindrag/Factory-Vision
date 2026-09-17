package production

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Repositories are thin: they know the columns and the idempotent insert
// shape (`ON CONFLICT (id) DO NOTHING` then read back), and nothing about
// the rules. Every method runs on the caller's tenant transaction.

const woColumns = `
  id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
  line_id, work_center_id, machine_id, target_quantity, planned_quantity, unit,
  planned_start, planned_end, actual_start, actual_end,
  reject_quantity, input_quantity, output_quantity, scrap_quantity, rework_quantity, transferred_quantity,
  status, priority, version, created_at, updated_at,
  production_plan_line_id, parent_work_order_id, predecessor_work_order_id, routing_id,
  is_batch_managed, has_child_work_order, mold_id, shift_id, confirmed_by, confirmed_at,
  status_reason`

// WorkOrderRepository is the work_order table.
type WorkOrderRepository struct{}

func scanWorkOrder(rows pgx.Rows) (WorkOrder, error) {
	var (
		w                                             WorkOrder
		target, planned, input, output, scrap, rework *int
		transferred, priority, version                *int
		reject                                        int
		unit, status                                  *string
		isBatch, hasChild                             *bool
		plannedStart, plannedEnd, createdAt, updated  time.Time
		actualStart, actualEnd, confirmedAt           *time.Time
	)
	err := rows.Scan(
		&w.ID, &w.TenantID, &w.ProductionOrderID, &w.WoNumber, &w.ProductID, &w.ProcessID, &w.Sequence,
		&w.LineID, &w.WorkCenterID, &w.MachineID, &target, &planned, &unit,
		&plannedStart, &plannedEnd, &actualStart, &actualEnd,
		&reject, &input, &output, &scrap, &rework, &transferred,
		&status, &priority, &version, &createdAt, &updated,
		&w.ProductionPlanLineID, &w.ParentWorkOrderID, &w.PredecessorWorkOrderID, &w.RoutingID,
		&isBatch, &hasChild, &w.MoldID, &w.ShiftID, &w.ConfirmedBy, &confirmedAt,
		&w.StatusReason,
	)
	if err != nil {
		return w, err
	}
	plannedQty := 0
	if planned != nil {
		plannedQty = *planned
	} else if target != nil {
		plannedQty = *target
	}
	w.PlannedQuantity, w.TargetQuantity = plannedQty, plannedQty
	w.InputQuantity = db.Deref(input, 0)
	w.OutputQuantity = db.Deref(output, 0)
	w.GoodQuantity = w.OutputQuantity
	w.RejectQuantity = reject
	w.ScrapQuantity = db.Deref(scrap, 0)
	w.ReworkQuantity = db.Deref(rework, 0)
	w.TransferredQuantity = db.Deref(transferred, 0)
	w.Unit = db.StrOr(unit, "PCS")
	w.PlannedStart, w.PlannedEnd = db.ISO(plannedStart), db.ISO(plannedEnd)
	w.ActualStart, w.ActualEnd = db.ISOPtr(actualStart), db.ISOPtr(actualEnd)
	w.Status = db.StrOr(status, StatusDraft)
	w.Priority = db.Deref(priority, 1)
	w.Version = db.Deref(version, 1)
	w.CreatedAt, w.UpdatedAt = db.ISO(createdAt), db.ISO(updated)
	w.IsBatchManaged = db.Deref(isBatch, false)
	w.HasChildWorkOrder = db.Deref(hasChild, false)
	w.ConfirmedAt = db.ISOPtr(confirmedAt)
	w.ProductionOrderID = db.Str(w.ProductionOrderID)
	w.ProductionPlanLineID = db.Str(w.ProductionPlanLineID)
	w.ParentWorkOrderID = db.Str(w.ParentWorkOrderID)
	w.PredecessorWorkOrderID = db.Str(w.PredecessorWorkOrderID)
	w.ProcessID, w.RoutingID = db.Str(w.ProcessID), db.Str(w.RoutingID)
	w.WorkCenterID, w.MachineID = db.Str(w.WorkCenterID), db.Str(w.MachineID)
	w.MoldID, w.ShiftID = db.Str(w.MoldID), db.Str(w.ShiftID)
	w.ConfirmedBy, w.StatusReason = db.Str(w.ConfirmedBy), db.Str(w.StatusReason)
	return w, nil
}

func collectWorkOrders(rows pgx.Rows, err error) ([]WorkOrder, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WorkOrder{}
	for rows.Next() {
		w, err := scanWorkOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func oneWorkOrder(rows pgx.Rows, err error) (*WorkOrder, error) {
	list, err := collectWorkOrders(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func parseOptionalTime(s *string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := db.ParseISO(*s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func parseTimeOr(s string, fallback time.Time) (time.Time, error) {
	if s == "" {
		return fallback, nil
	}
	return db.ParseISO(s)
}

// Create inserts a work order, or returns the one already stored under
// that id.
func (WorkOrderRepository) Create(ctx context.Context, tx pgx.Tx, w WorkOrder) (WorkOrder, error) {
	now := time.Now()
	plannedStart, err := db.ParseISO(w.PlannedStart)
	if err != nil {
		return w, fmt.Errorf("plannedStart: %w", err)
	}
	plannedEnd, err := db.ParseISO(w.PlannedEnd)
	if err != nil {
		return w, fmt.Errorf("plannedEnd: %w", err)
	}
	actualStart, err := parseOptionalTime(w.ActualStart)
	if err != nil {
		return w, err
	}
	actualEnd, err := parseOptionalTime(w.ActualEnd)
	if err != nil {
		return w, err
	}
	confirmedAt, err := parseOptionalTime(w.ConfirmedAt)
	if err != nil {
		return w, err
	}
	createdAt, err := parseTimeOr(w.CreatedAt, now)
	if err != nil {
		return w, err
	}
	updatedAt, err := parseTimeOr(w.UpdatedAt, now)
	if err != nil {
		return w, err
	}
	sequence := 1
	if w.Sequence != nil {
		sequence = *w.Sequence
	}
	unit := w.Unit
	if unit == "" {
		unit = "PCS"
	}
	priority := w.Priority
	if priority == 0 {
		priority = 1
	}
	version := w.Version
	if version == 0 {
		version = 1
	}
	planned := w.PlannedQuantity
	if planned == 0 {
		planned = w.TargetQuantity
	}
	output := w.OutputQuantity
	if output == 0 {
		output = w.GoodQuantity
	}

	rows, err := tx.Query(ctx,
		`INSERT INTO work_order (
		   id, tenant_id, production_order_id, wo_number, product_id, process_id, sequence,
		   line_id, work_center_id, machine_id, target_quantity, planned_quantity, unit,
		   planned_start, planned_end, actual_start, actual_end,
		   reject_quantity, input_quantity, output_quantity, scrap_quantity, rework_quantity, transferred_quantity,
		   status, priority, version, created_at, updated_at,
		   production_plan_line_id, parent_work_order_id, predecessor_work_order_id, routing_id,
		   is_batch_managed, has_child_work_order, mold_id, shift_id, confirmed_by, confirmed_at
		 ) VALUES (
		   $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38
		 )
		 ON CONFLICT (id) DO NOTHING
		 RETURNING `+woColumns,
		w.ID, w.TenantID, w.ProductionOrderID, w.WoNumber, w.ProductID, w.ProcessID, sequence,
		w.LineID, w.WorkCenterID, w.MachineID, planned, planned, unit,
		plannedStart, plannedEnd, actualStart, actualEnd,
		w.RejectQuantity, w.InputQuantity, output, w.ScrapQuantity, w.ReworkQuantity, w.TransferredQuantity,
		w.Status, priority, version, createdAt, updatedAt,
		w.ProductionPlanLineID, w.ParentWorkOrderID, w.PredecessorWorkOrderID, w.RoutingID,
		w.IsBatchManaged, w.HasChildWorkOrder, w.MoldID, w.ShiftID, w.ConfirmedBy, confirmedAt,
	)
	created, err := oneWorkOrder(rows, err)
	if err != nil {
		return w, err
	}
	if created != nil {
		return *created, nil
	}
	existing, err := (WorkOrderRepository{}).FindByID(ctx, tx, w.TenantID, w.ID)
	if err != nil {
		return w, err
	}
	if existing == nil {
		return w, fmt.Errorf("work_order %s could not be created or read back", w.ID)
	}
	return *existing, nil
}

// FindByID reads one work order; nil when absent.
func (WorkOrderRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*WorkOrder, error) {
	rows, err := tx.Query(ctx, `SELECT `+woColumns+` FROM work_order WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return oneWorkOrder(rows, err)
}

// FindByIDs reads several work orders in one round trip, keyed by id.
func (WorkOrderRepository) FindByIDs(ctx context.Context, tx pgx.Tx, tenantID string, ids []string) (map[string]WorkOrder, error) {
	out := map[string]WorkOrder{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := tx.Query(ctx, `SELECT `+woColumns+` FROM work_order WHERE tenant_id = $1 AND id = ANY($2)`, tenantID, ids)
	list, err := collectWorkOrders(rows, err)
	if err != nil {
		return nil, err
	}
	for _, w := range list {
		out[w.ID] = w
	}
	return out, nil
}

// List reads a tenant's work orders in board order.
func (WorkOrderRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, f WorkOrderFilter) ([]WorkOrder, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.LineID != "" {
		where = append(where, "line_id = "+arg(f.LineID))
	}
	if f.Status != "" {
		where = append(where, "status = "+arg(f.Status))
	}
	if f.ProcessID != "" {
		where = append(where, "process_id = "+arg(f.ProcessID))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 2000
	}
	if limit > 20000 {
		limit = 20000
	}
	rows, err := tx.Query(ctx,
		`SELECT `+woColumns+` FROM work_order WHERE `+strings.Join(where, " AND ")+
			` ORDER BY priority ASC, planned_start ASC, id ASC LIMIT `+arg(limit)+` OFFSET `+arg(f.Offset),
		params...)
	return collectWorkOrders(rows, err)
}

// IncrementQuantities adds a record's quantities to the running totals.
func (WorkOrderRepository) IncrementQuantities(ctx context.Context, tx pgx.Tx, tenantID, id string, inc Increment) (*WorkOrder, error) {
	output := inc.Good
	if inc.Output != nil {
		output = *inc.Output
	}
	rows, err := tx.Query(ctx,
		`UPDATE work_order
		    SET output_quantity = output_quantity + $3,
		        reject_quantity = reject_quantity + $4,
		        scrap_quantity = scrap_quantity + $5,
		        rework_quantity = rework_quantity + $6,
		        input_quantity = input_quantity + $7,
		        transferred_quantity = transferred_quantity + $8,
		        version = version + 1,
		        updated_at = now()
		  WHERE tenant_id = $1 AND id = $2
		  RETURNING `+woColumns,
		tenantID, id, output, inc.Reject, inc.Scrap, inc.Rework, inc.Input, inc.Transferred)
	return oneWorkOrder(rows, err)
}

// UpdateStatus moves a work order and stamps whatever the transition sets.
// COALESCE keeps the first start and the first confirmation.
func (WorkOrderRepository) UpdateStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string, s Stamps) (*WorkOrder, error) {
	actualStart, err := parseOptionalTime(s.ActualStart)
	if err != nil {
		return nil, err
	}
	actualEnd, err := parseOptionalTime(s.ActualEnd)
	if err != nil {
		return nil, err
	}
	confirmedAt, err := parseOptionalTime(s.ConfirmedAt)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx,
		`UPDATE work_order
		    SET status = $3,
		        actual_start = COALESCE($4, actual_start),
		        actual_end = COALESCE($5, actual_end),
		        confirmed_by = COALESCE($6, confirmed_by),
		        confirmed_at = COALESCE($7, confirmed_at),
		        status_reason = COALESCE($8, status_reason),
		        version = version + 1,
		        updated_at = now()
		  WHERE tenant_id = $1 AND id = $2
		  RETURNING `+woColumns,
		tenantID, id, status, actualStart, actualEnd, s.ConfirmedBy, confirmedAt, s.StatusReason)
	return oneWorkOrder(rows, err)
}

// Update applies the planner's patch; a nil field keeps the column.
func (WorkOrderRepository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, p Patch) (*WorkOrder, error) {
	plannedStart, err := parseOptionalTime(p.PlannedStart)
	if err != nil {
		return nil, err
	}
	plannedEnd, err := parseOptionalTime(p.PlannedEnd)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx,
		`UPDATE work_order
		    SET target_quantity           = COALESCE($3, target_quantity),
		        planned_quantity          = COALESCE($3, planned_quantity),
		        planned_start             = COALESCE($4, planned_start),
		        planned_end               = COALESCE($5, planned_end),
		        priority                  = COALESCE($6, priority),
		        machine_id                = COALESCE($7, machine_id),
		        process_id                = COALESCE($8, process_id),
		        line_id                   = COALESCE($9, line_id),
		        work_center_id            = COALESCE($10, work_center_id),
		        product_id                = COALESCE($11, product_id),
		        sequence                  = COALESCE($12, sequence),
		        unit                      = COALESCE($13, unit),
		        mold_id                   = COALESCE($14, mold_id),
		        shift_id                  = COALESCE($15, shift_id),
		        routing_id                = COALESCE($16, routing_id),
		        is_batch_managed          = COALESCE($17, is_batch_managed),
		        has_child_work_order      = COALESCE($18, has_child_work_order),
		        production_plan_line_id   = COALESCE($19, production_plan_line_id),
		        parent_work_order_id      = COALESCE($20, parent_work_order_id),
		        predecessor_work_order_id = COALESCE($21, predecessor_work_order_id),
		        version = version + 1,
		        updated_at = now()
		  WHERE tenant_id = $1 AND id = $2
		  RETURNING `+woColumns,
		tenantID, id, p.PlannedQuantity, plannedStart, plannedEnd, p.Priority, p.MachineID, p.ProcessID,
		p.LineID, p.WorkCenterID, p.ProductID, p.Sequence, p.Unit, p.MoldID, p.ShiftID, p.RoutingID,
		p.IsBatchManaged, p.HasChildWorkOrder, p.ProductionPlanLineID, p.ParentWorkOrderID, p.PredecessorWorkOrderID)
	return oneWorkOrder(rows, err)
}

// Delete removes a work order; false when it did not exist.
func (WorkOrderRepository) Delete(ctx context.Context, tx pgx.Tx, tenantID, id string) (bool, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM work_order WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Count is the tenant's work order count.
func (WorkOrderRepository) Count(ctx context.Context, tx pgx.Tx, tenantID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM work_order WHERE tenant_id = $1`, tenantID).Scan(&n)
	return n, err
}

// --- production_order --------------------------------------------------

const poColumns = `id, tenant_id, order_number, product_id, quantity, to_char(due_date, 'YYYY-MM-DD'), status, created_by, created_at`

// ProductionOrderRepository is the production_order table.
type ProductionOrderRepository struct{}

func scanProductionOrder(rows pgx.Rows) (ProductionOrder, error) {
	var (
		o                 ProductionOrder
		quantity          *int
		status, createdBy *string
		createdAt         time.Time
	)
	if err := rows.Scan(&o.ID, &o.TenantID, &o.OrderNumber, &o.ProductID, &quantity, &o.DueDate, &status, &createdBy, &createdAt); err != nil {
		return o, err
	}
	o.Quantity = db.Deref(quantity, 0)
	o.Status = db.StrOr(status, "DRAFT")
	o.CreatedBy = db.StrOr(createdBy, "")
	o.CreatedAt = db.ISO(createdAt)
	return o, nil
}

func collectProductionOrders(rows pgx.Rows, err error) ([]ProductionOrder, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProductionOrder{}
	for rows.Next() {
		o, err := scanProductionOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func oneProductionOrder(rows pgx.Rows, err error) (*ProductionOrder, error) {
	list, err := collectProductionOrders(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// Create inserts, or returns the order already stored under that id.
func (ProductionOrderRepository) Create(ctx context.Context, tx pgx.Tx, o ProductionOrder) (ProductionOrder, error) {
	createdAt, err := parseTimeOr(o.CreatedAt, time.Now())
	if err != nil {
		return o, err
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date, status, created_by, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9)
		 ON CONFLICT (id) DO NOTHING
		 RETURNING `+poColumns,
		o.ID, o.TenantID, o.OrderNumber, o.ProductID, o.Quantity, o.DueDate, o.Status, o.CreatedBy, createdAt)
	created, err := oneProductionOrder(rows, err)
	if err != nil {
		return o, err
	}
	if created != nil {
		return *created, nil
	}
	existing, err := (ProductionOrderRepository{}).FindByID(ctx, tx, o.TenantID, o.ID)
	if err != nil {
		return o, err
	}
	if existing == nil {
		return o, fmt.Errorf("production_order %s could not be created or read back", o.ID)
	}
	return *existing, nil
}

// FindByID reads one order; nil when absent.
func (ProductionOrderRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*ProductionOrder, error) {
	rows, err := tx.Query(ctx, `SELECT `+poColumns+` FROM production_order WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return oneProductionOrder(rows, err)
}

// List reads a tenant's orders by due date.
func (ProductionOrderRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, limit, offset int) ([]ProductionOrder, error) {
	if limit <= 0 {
		limit = 2000
	}
	if limit > 20000 {
		limit = 20000
	}
	rows, err := tx.Query(ctx,
		`SELECT `+poColumns+` FROM production_order WHERE tenant_id = $1 ORDER BY due_date ASC, id ASC LIMIT $2 OFFSET $3`,
		tenantID, limit, offset)
	return collectProductionOrders(rows, err)
}

// ProductionOrderPatch is what an update may change.
type ProductionOrderPatch struct {
	OrderNumber *string
	ProductID   *string
	Quantity    *int
	DueDate     *string
	Status      *string
}

// Update applies a patch; nil keeps the column.
func (ProductionOrderRepository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, p ProductionOrderPatch) (*ProductionOrder, error) {
	rows, err := tx.Query(ctx,
		`UPDATE production_order
		    SET order_number = COALESCE($3, order_number),
		        product_id   = COALESCE($4, product_id),
		        quantity     = COALESCE($5, quantity),
		        due_date     = COALESCE($6::date, due_date),
		        status       = COALESCE($7, status)
		  WHERE tenant_id = $1 AND id = $2
		  RETURNING `+poColumns,
		tenantID, id, p.OrderNumber, p.ProductID, p.Quantity, p.DueDate, p.Status)
	return oneProductionOrder(rows, err)
}

// Delete removes an order; false when absent.
func (ProductionOrderRepository) Delete(ctx context.Context, tx pgx.Tx, tenantID, id string) (bool, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM production_order WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Count is the tenant's order count.
func (ProductionOrderRepository) Count(ctx context.Context, tx pgx.Tx, tenantID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM production_order WHERE tenant_id = $1`, tenantID).Scan(&n)
	return n, err
}

// --- production_batch --------------------------------------------------

const batchColumns = `
  id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
  planned_quantity, input_quantity, output_quantity, reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
  status, status_reason, material_lot_reference, machine_id, mold_id, operator_id, shift_id,
  to_char(production_date, 'YYYY-MM-DD'), to_char(expiry_date, 'YYYY-MM-DD'), actual_start, actual_end, version, created_at, updated_at,
  production_order_id`

// BatchRepository is the production_batch table.
type BatchRepository struct{}

func scanBatch(rows pgx.Rows) (Batch, error) {
	var (
		b                                               Batch
		workOrderID, status                             *string
		sequence, planned, input, output, reject, scrap *int
		rework, transferred, version                    *int
		actualStart, actualEnd                          *time.Time
		createdAt, updatedAt                            *time.Time
	)
	err := rows.Scan(
		&b.ID, &b.TenantID, &b.BatchNumber, &workOrderID, &b.ProductID, &b.ProcessID, &sequence,
		&planned, &input, &output, &reject, &scrap, &rework, &transferred,
		&status, &b.StatusReason, &b.MaterialLotReference, &b.MachineID, &b.MoldID, &b.OperatorID, &b.ShiftID,
		&b.ProductionDate, &b.ExpiryDate, &actualStart, &actualEnd, &version, &createdAt, &updatedAt,
		&b.ProductionOrderID,
	)
	if err != nil {
		return b, err
	}
	b.WorkOrderID = db.StrOr(workOrderID, "")
	b.Sequence = db.Deref(sequence, 1)
	b.PlannedQuantity = db.Deref(planned, 0)
	b.InputQuantity = db.Deref(input, 0)
	b.OutputQuantity = db.Deref(output, 0)
	b.RejectQuantity = db.Deref(reject, 0)
	b.ScrapQuantity = db.Deref(scrap, 0)
	b.ReworkQuantity = db.Deref(rework, 0)
	b.TransferredQuantity = db.Deref(transferred, 0)
	b.Status = db.StrOr(status, BatchPlanned)
	b.ActualStart, b.ActualEnd = db.ISOPtr(actualStart), db.ISOPtr(actualEnd)
	b.Version = db.Deref(version, 1)
	if createdAt != nil {
		b.CreatedAt = db.ISO(*createdAt)
	}
	if updatedAt != nil {
		b.UpdatedAt = db.ISO(*updatedAt)
	}
	b.ProcessID, b.StatusReason = db.Str(b.ProcessID), db.Str(b.StatusReason)
	b.MaterialLotReference, b.MachineID = db.Str(b.MaterialLotReference), db.Str(b.MachineID)
	b.MoldID, b.OperatorID, b.ShiftID = db.Str(b.MoldID), db.Str(b.OperatorID), db.Str(b.ShiftID)
	b.ExpiryDate, b.ProductionOrderID = db.Str(b.ExpiryDate), db.Str(b.ProductionOrderID)
	return b, nil
}

func collectBatches(rows pgx.Rows, err error) ([]Batch, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Batch{}
	for rows.Next() {
		b, err := scanBatch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func oneBatch(rows pgx.Rows, err error) (*Batch, error) {
	list, err := collectBatches(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// Create inserts a batch, or returns the one already stored under that id.
func (BatchRepository) Create(ctx context.Context, tx pgx.Tx, b Batch) (Batch, error) {
	now := time.Now()
	actualStart, err := parseOptionalTime(b.ActualStart)
	if err != nil {
		return b, err
	}
	actualEnd, err := parseOptionalTime(b.ActualEnd)
	if err != nil {
		return b, err
	}
	createdAt, err := parseTimeOr(b.CreatedAt, now)
	if err != nil {
		return b, err
	}
	updatedAt, err := parseTimeOr(b.UpdatedAt, now)
	if err != nil {
		return b, err
	}
	sequence := b.Sequence
	if sequence == 0 {
		sequence = 1
	}
	status := b.Status
	if status == "" {
		status = BatchPlanned
	}
	version := b.Version
	if version == 0 {
		version = 1
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO production_batch (
		   id, tenant_id, batch_number, work_order_id, product_id, process_id, sequence,
		   planned_quantity, input_quantity, output_quantity, reject_quantity, scrap_quantity, rework_quantity, transferred_quantity,
		   status, status_reason, material_lot_reference, machine_id, mold_id, operator_id, shift_id,
		   production_date, expiry_date, actual_start, actual_end, version, created_at, updated_at, production_order_id
		 ) VALUES (
		   $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::date,$23::date,$24,$25,$26,$27,$28,$29
		 )
		 ON CONFLICT (id) DO NOTHING
		 RETURNING `+batchColumns,
		b.ID, b.TenantID, b.BatchNumber, db.NullIf(b.WorkOrderID), b.ProductID, b.ProcessID, sequence,
		b.PlannedQuantity, b.InputQuantity, b.OutputQuantity, b.RejectQuantity, b.ScrapQuantity, b.ReworkQuantity, b.TransferredQuantity,
		status, b.StatusReason, b.MaterialLotReference, b.MachineID, b.MoldID, b.OperatorID, b.ShiftID,
		b.ProductionDate, b.ExpiryDate, actualStart, actualEnd, version, createdAt, updatedAt, b.ProductionOrderID,
	)
	created, err := oneBatch(rows, err)
	if err != nil {
		return b, err
	}
	if created != nil {
		return *created, nil
	}
	existing, err := (BatchRepository{}).FindByID(ctx, tx, b.TenantID, b.ID)
	if err != nil {
		return b, err
	}
	if existing == nil {
		return b, fmt.Errorf("production_batch %s could not be created or read back", b.ID)
	}
	return *existing, nil
}

// FindByID reads one batch; nil when absent.
func (BatchRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Batch, error) {
	rows, err := tx.Query(ctx, `SELECT `+batchColumns+` FROM production_batch WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return oneBatch(rows, err)
}

// FindByNumber reads a batch by its number; nil when absent.
func (BatchRepository) FindByNumber(ctx context.Context, tx pgx.Tx, tenantID, number string) (*Batch, error) {
	rows, err := tx.Query(ctx, `SELECT `+batchColumns+` FROM production_batch WHERE tenant_id = $1 AND batch_number = $2`, tenantID, number)
	return oneBatch(rows, err)
}

// ListByWorkOrder reads the batches that subdivide one work order.
func (BatchRepository) ListByWorkOrder(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) ([]Batch, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+batchColumns+` FROM production_batch WHERE tenant_id = $1 AND work_order_id = $2 ORDER BY sequence, id`,
		tenantID, workOrderID)
	return collectBatches(rows, err)
}

// List reads a tenant's batches, optionally by product and status.
func (BatchRepository) List(ctx context.Context, tx pgx.Tx, tenantID, productID, status string) ([]Batch, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	if productID != "" {
		params = append(params, productID)
		where = append(where, "product_id = $"+strconv.Itoa(len(params)))
	}
	if status != "" {
		params = append(params, status)
		where = append(where, "status = $"+strconv.Itoa(len(params)))
	}
	rows, err := tx.Query(ctx,
		`SELECT `+batchColumns+` FROM production_batch WHERE `+strings.Join(where, " AND ")+` ORDER BY created_at ASC, id ASC LIMIT 5000`,
		params...)
	return collectBatches(rows, err)
}

// NextSequence is the sequence a new batch of a work order takes.
func (BatchRepository) NextSequence(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) (int, error) {
	var next int
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(sequence), 0) + 1 FROM production_batch WHERE tenant_id = $1 AND work_order_id = $2`,
		tenantID, workOrderID).Scan(&next)
	return next, err
}

// BatchPatch is what an update may change; nil keeps the column.
type BatchPatch struct {
	BatchNumber          *string
	WorkOrderID          *string
	PlannedQuantity      *int
	Status               *string
	StatusReason         *string
	MaterialLotReference *string
	MachineID            *string
	MoldID               *string
	OperatorID           *string
	ShiftID              *string
	ProductionDate       *string
	ExpiryDate           *string
	ActualStart          *string
	ActualEnd            *string
	ProductionOrderID    *string
}

// Update applies a patch.
func (BatchRepository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, p BatchPatch) (*Batch, error) {
	actualStart, err := parseOptionalTime(p.ActualStart)
	if err != nil {
		return nil, err
	}
	actualEnd, err := parseOptionalTime(p.ActualEnd)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx,
		`UPDATE production_batch
		    SET batch_number           = COALESCE($3, batch_number),
		        work_order_id          = COALESCE($4, work_order_id),
		        planned_quantity       = COALESCE($5, planned_quantity),
		        status                 = COALESCE($6, status),
		        status_reason          = COALESCE($7, status_reason),
		        material_lot_reference = COALESCE($8, material_lot_reference),
		        machine_id             = COALESCE($9, machine_id),
		        mold_id                = COALESCE($10, mold_id),
		        operator_id            = COALESCE($11, operator_id),
		        shift_id               = COALESCE($12, shift_id),
		        production_date        = COALESCE($13::date, production_date),
		        expiry_date            = COALESCE($14::date, expiry_date),
		        actual_start           = COALESCE($15, actual_start),
		        actual_end             = COALESCE($16, actual_end),
		        production_order_id    = COALESCE($17, production_order_id),
		        version = version + 1,
		        updated_at = now()
		  WHERE tenant_id = $1 AND id = $2
		  RETURNING `+batchColumns,
		tenantID, id, p.BatchNumber, p.WorkOrderID, p.PlannedQuantity, p.Status, p.StatusReason, p.MaterialLotReference,
		p.MachineID, p.MoldID, p.OperatorID, p.ShiftID, p.ProductionDate, p.ExpiryDate, actualStart, actualEnd, p.ProductionOrderID)
	return oneBatch(rows, err)
}

// Delete removes a batch; false when absent.
func (BatchRepository) Delete(ctx context.Context, tx pgx.Tx, tenantID, id string) (bool, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM production_batch WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ErrNotFound is the sentinel repositories never return: callers translate
// a nil result themselves, so a 404 message stays a domain decision.
var ErrNotFound = errors.New("not found")
