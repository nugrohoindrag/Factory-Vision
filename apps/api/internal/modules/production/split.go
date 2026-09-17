package production

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Dynamic Work Order Split (§25.7).
//
// A supervisor divides a running process across machines to finish it
// sooner. The rules that keep the result honest: the parts sum exactly to
// the parent, the parent holds no production of its own, and the machine
// and mould are released to the children. The parent's counters are then
// the sum of its children's, rolled up on every child change.

var splittable = []string{StatusScheduled, StatusConfirmed, StatusInProduction}

// suffixFor is A, B, … Z, AA, AB, …
func suffixFor(index int) string {
	n := index
	out := ""
	for {
		out = string(rune('A'+n%26)) + out
		n = n/26 - 1
		if n < 0 {
			break
		}
	}
	return out
}

func recordedQuantity(w WorkOrder) int {
	return w.OutputQuantity + w.RejectQuantity + w.ScrapQuantity + w.ReworkQuantity + w.TransferredQuantity + w.InputQuantity
}

// FlowValidation turns a quantity-flow violation into the HTTP contract,
// with the violated invariants as field errors on `field`.
func FlowValidation(err error, field string) error {
	var violation *FlowViolation
	if !errors.As(err, &violation) {
		return err
	}
	fields := make([]httpx.FieldError, len(violation.Violations))
	for i, v := range violation.Violations {
		fields[i] = httpx.FieldError{Field: field, Code: string(v.Invariant), Message: v.Message}
	}
	return httpx.Validation(violation.Error(), fields...)
}

// AssertSplittable is every rule a split checks before writing.
func AssertSplittable(parent WorkOrder, parts []SplitPart) error {
	if parent.HasChildWorkOrder {
		return httpx.InvalidState(fmt.Sprintf(
			"Work order %s sudah pernah di-split. Split salah satu child-nya jika perlu dibagi lagi.", parent.WoNumber))
	}
	ok := false
	for _, s := range splittable {
		if s == parent.Status {
			ok = true
		}
	}
	if !ok {
		return httpx.InvalidState(fmt.Sprintf(
			"Work order berstatus %s tidak dapat di-split. Status yang bisa: %s.", parent.Status, strings.Join(splittable, ", ")))
	}
	if len(parts) < 2 {
		return httpx.Validation("Split menghasilkan minimal 2 child work order.",
			httpx.FieldError{Field: "parts", Code: "TOO_FEW_PARTS", Message: "Minimal 2 bagian."})
	}
	for i, part := range parts {
		if math.IsNaN(part.PlannedQuantity) || math.IsInf(part.PlannedQuantity, 0) || part.PlannedQuantity <= 0 {
			return httpx.Validation(fmt.Sprintf("Bagian ke-%d: planned quantity harus lebih besar dari nol.", i+1),
				httpx.FieldError{Field: fmt.Sprintf("parts[%d].plannedQuantity", i), Code: "MUST_BE_POSITIVE", Message: "Harus lebih besar dari nol."})
		}
	}
	if recordedQuantity(parent) > 0 {
		return httpx.InvalidState(fmt.Sprintf(
			"Work order %s sudah mencatat produksi (output %d, reject %d, input %d). "+
				"Parent hasil split tidak boleh memiliki catatan produksi sendiri, karena hasil child "+
				"akan dijumlahkan ke parent dan angkanya akan terhitung dua kali.",
			parent.WoNumber, parent.OutputQuantity, parent.RejectQuantity, parent.InputQuantity))
	}
	total := 0.0
	for _, part := range parts {
		total += part.PlannedQuantity
	}
	if err := AssertSplitPlannedExact(parent.ID, parent.PlannedQuantity, int(total)); err != nil {
		return FlowValidation(err, "parts")
	}
	return nil
}

// Split writes the children and flags the parent, in the caller's
// transaction.
func (s *Service) split(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string, parts []SplitPart, actor *string) (SplitResult, error) {
	parent, err := s.workOrders.FindByID(ctx, tx, tenantID, workOrderID)
	if err != nil {
		return SplitResult{}, err
	}
	if parent == nil {
		return SplitResult{}, httpx.NotFound("Work order tidak ditemukan.")
	}
	if err := AssertSplittable(*parent, parts); err != nil {
		return SplitResult{}, err
	}

	now := db.Now()
	children := make([]WorkOrder, 0, len(parts))
	for i, part := range parts {
		child := WorkOrder{
			ID:                     uuid.NewString(),
			TenantID:               parent.TenantID,
			WoNumber:               parent.WoNumber + "-" + suffixFor(i),
			ParentWorkOrderID:      &parent.ID,
			PredecessorWorkOrderID: parent.PredecessorWorkOrderID,
			ProductionPlanLineID:   parent.ProductionPlanLineID,
			ProductionOrderID:      parent.ProductionOrderID,
			ProductID:              parent.ProductID,
			ProcessID:              parent.ProcessID,
			RoutingID:              parent.RoutingID,
			Sequence:               parent.Sequence,
			LineID:                 parent.LineID,
			Unit:                   parent.Unit,
			Priority:               parent.Priority,
			IsBatchManaged:         parent.IsBatchManaged,
			HasChildWorkOrder:      false,
			PlannedQuantity:        int(part.PlannedQuantity),
			MachineID:              part.MachineID,
			WorkCenterID:           firstOf(part.WorkCenterID, parent.WorkCenterID),
			MoldID:                 part.MoldID,
			ShiftID:                firstOf(part.ShiftID, parent.ShiftID),
			PlannedStart:           db.Deref(part.PlannedStart, parent.PlannedStart),
			PlannedEnd:             db.Deref(part.PlannedEnd, parent.PlannedEnd),
			Status:                 StatusConfirmed,
			Version:                1,
			CreatedAt:              now,
			UpdatedAt:              now,
		}
		if parent.Status == StatusScheduled {
			child.Status = StatusScheduled
		} else {
			child.ConfirmedBy = firstOf(actor, parent.ConfirmedBy)
			child.ConfirmedAt = &now
		}
		created, err := s.workOrders.Create(ctx, tx, child)
		if err != nil {
			return SplitResult{}, err
		}
		children = append(children, created)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE work_order SET has_child_work_order = TRUE, machine_id = NULL, mold_id = NULL, updated_at = now()
		  WHERE tenant_id = $1 AND id = $2`, tenantID, parent.ID); err != nil {
		return SplitResult{}, err
	}
	updated, err := s.workOrders.FindByID(ctx, tx, tenantID, parent.ID)
	if err != nil {
		return SplitResult{}, err
	}
	if updated == nil {
		updated = parent
	}
	return SplitResult{Parent: *updated, Children: children}, nil
}

func firstOf(values ...*string) *string {
	for _, v := range values {
		if v != nil && *v != "" {
			return v
		}
	}
	return nil
}

// rollUp keeps a split parent's totals equal to the sum of its children:
// it completes when the last active child does and starts when the first
// one does. Idempotent, so it runs on every child change.
func (s *Service) rollUp(ctx context.Context, tx pgx.Tx, tenantID, parentID string) (*WorkOrder, error) {
	parent, err := s.workOrders.FindByID(ctx, tx, tenantID, parentID)
	if err != nil || parent == nil || !parent.HasChildWorkOrder {
		return parent, err
	}
	var (
		children, completed, cancelled, started        int
		input, output, reject, scrap, rework, transfer int
		lastEnd, firstStart                            *time.Time
	)
	err = tx.QueryRow(ctx,
		`SELECT COUNT(*),
		        COUNT(*) FILTER (WHERE status = 'COMPLETED'),
		        COUNT(*) FILTER (WHERE status = 'CANCELLED'),
		        COUNT(*) FILTER (WHERE status = 'IN_PRODUCTION'),
		        COALESCE(SUM(input_quantity), 0), COALESCE(SUM(output_quantity), 0),
		        COALESCE(SUM(reject_quantity), 0), COALESCE(SUM(scrap_quantity), 0),
		        COALESCE(SUM(rework_quantity), 0), COALESCE(SUM(transferred_quantity), 0),
		        MAX(actual_end), MIN(actual_start)
		   FROM work_order WHERE tenant_id = $1 AND parent_work_order_id = $2`,
		tenantID, parentID).Scan(&children, &completed, &cancelled, &started,
		&input, &output, &reject, &scrap, &rework, &transfer, &lastEnd, &firstStart)
	if err != nil {
		return nil, err
	}
	if children == 0 {
		return parent, nil
	}
	active := children - cancelled
	allDone := active > 0 && completed == active
	anyStarted := started > 0 || completed > 0
	startParent := !allDone && anyStarted && parent.Status == StatusConfirmed

	if _, err := tx.Exec(ctx,
		`UPDATE work_order
		    SET input_quantity = $3, output_quantity = $4, reject_quantity = $5, scrap_quantity = $6,
		        rework_quantity = $7, transferred_quantity = $8,
		        actual_start = COALESCE(actual_start, $9),
		        actual_end = CASE WHEN $10 THEN $11 ELSE actual_end END,
		        status = CASE WHEN $10 THEN 'COMPLETED' WHEN $12 THEN 'IN_PRODUCTION' ELSE status END,
		        updated_at = now()
		  WHERE tenant_id = $1 AND id = $2`,
		tenantID, parentID, input, output, reject, scrap, rework, transfer, firstStart, allDone, lastEnd, startParent); err != nil {
		return nil, err
	}
	return s.workOrders.FindByID(ctx, tx, tenantID, parentID)
}

// rollUpIfChild rolls a change on a child up to its parent.
func (s *Service) rollUpIfChild(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) error {
	w, err := s.workOrders.FindByID(ctx, tx, tenantID, workOrderID)
	if err != nil || w == nil || w.ParentWorkOrderID == nil {
		return err
	}
	_, err = s.rollUp(ctx, tx, tenantID, *w.ParentWorkOrderID)
	return err
}
