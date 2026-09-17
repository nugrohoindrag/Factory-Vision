package production

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// The process chain (§13, MES-018-3): predecessor and successors are
// explicit foreign keys written at generation, never inferred from sequence
// numbers later. A split parent is replaced by its children when it is the
// predecessor, because the children are what actually hand over.

func toNode(w WorkOrder) ChainNode {
	return ChainNode{
		WorkOrderID:         w.ID,
		WoNumber:            w.WoNumber,
		ProcessID:           w.ProcessID,
		Sequence:            w.Sequence,
		Status:              w.Status,
		PlannedQuantity:     w.PlannedQuantity,
		InputQuantity:       w.InputQuantity,
		OutputQuantity:      w.OutputQuantity,
		TransferredQuantity: w.TransferredQuantity,
		ParentWorkOrderID:   w.ParentWorkOrderID,
		IsSplitParent:       w.HasChildWorkOrder,
	}
}

func (s *Service) predecessorOf(ctx context.Context, tx pgx.Tx, tenantID string, w WorkOrder) (*WorkOrder, error) {
	if w.PredecessorWorkOrderID == nil {
		return nil, nil
	}
	return s.workOrders.FindByID(ctx, tx, tenantID, *w.PredecessorWorkOrderID)
}

func (s *Service) successorsOf(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) ([]WorkOrder, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+woColumns+` FROM work_order
		  WHERE tenant_id = $1 AND predecessor_work_order_id = $2
		  ORDER BY sequence NULLS LAST, wo_number`, tenantID, workOrderID)
	return collectWorkOrders(rows, err)
}

// effectivePredecessors is the direct predecessor, or its children when it
// was split.
func (s *Service) effectivePredecessors(ctx context.Context, tx pgx.Tx, tenantID string, w WorkOrder) ([]WorkOrder, error) {
	direct, err := s.predecessorOf(ctx, tx, tenantID, w)
	if err != nil || direct == nil {
		return nil, err
	}
	if !direct.HasChildWorkOrder {
		return []WorkOrder{*direct}, nil
	}
	rows, err := tx.Query(ctx,
		`SELECT `+woColumns+` FROM work_order WHERE tenant_id = $1 AND parent_work_order_id = $2 ORDER BY wo_number`,
		tenantID, direct.ID)
	children, err := collectWorkOrders(rows, err)
	if err != nil {
		return nil, err
	}
	if len(children) == 0 {
		return []WorkOrder{*direct}, nil
	}
	return children, nil
}

// availableQuantity is what the predecessor(s) transferred minus what this
// work order has already taken in (ADR-25).
func (s *Service) availableQuantity(ctx context.Context, tx pgx.Tx, tenantID string, w WorkOrder) (int, error) {
	predecessors, err := s.effectivePredecessors(ctx, tx, tenantID, w)
	if err != nil || len(predecessors) == 0 {
		return 0, err
	}
	transferred := 0
	for _, p := range predecessors {
		transferred += p.TransferredQuantity
	}
	return AvailableQuantity(transferred, w.InputQuantity), nil
}

// chainOf assembles the chain inside the caller's transaction.
func (s *Service) chainOf(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) (Chain, error) {
	w, err := s.workOrders.FindByID(ctx, tx, tenantID, workOrderID)
	if err != nil {
		return Chain{}, err
	}
	if w == nil {
		return Chain{}, httpx.NotFound("Work order tidak ditemukan.")
	}

	var predecessors []WorkOrder
	seen := map[string]bool{w.ID: true}
	cursor := w
	for cursor != nil && cursor.PredecessorWorkOrderID != nil {
		id := *cursor.PredecessorWorkOrderID
		if seen[id] {
			break
		}
		seen[id] = true
		previous, err := s.workOrders.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return Chain{}, err
		}
		if previous == nil {
			break
		}
		predecessors = append([]WorkOrder{*previous}, predecessors...)
		cursor = previous
	}

	successors, err := s.successorsOf(ctx, tx, tenantID, w.ID)
	if err != nil {
		return Chain{}, err
	}
	available, err := s.availableQuantity(ctx, tx, tenantID, *w)
	if err != nil {
		return Chain{}, err
	}

	chain := Chain{
		WorkOrder:         toNode(*w),
		Predecessors:      make([]ChainNode, 0, len(predecessors)),
		Successors:        make([]ChainNode, 0, len(successors)),
		IsFirstProcess:    w.PredecessorWorkOrderID == nil,
		IsLastProcess:     len(successors) == 0,
		AvailableQuantity: available,
	}
	for _, p := range predecessors {
		chain.Predecessors = append(chain.Predecessors, toNode(p))
	}
	if n := len(predecessors); n > 0 {
		immediate := toNode(predecessors[n-1])
		chain.Predecessor = &immediate
	}
	for _, p := range successors {
		chain.Successors = append(chain.Successors, toNode(p))
	}
	return chain, nil
}

// Chain is the process chain around one work order.
func (s *Service) Chain(ctx context.Context, tenantID, workOrderID string) (Chain, error) {
	var chain Chain
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		chain, err = s.chainOf(ctx, tx, tenantID, workOrderID)
		return err
	})
	return chain, err
}

// AvailableQuantityIn is the available figure for callers already in a
// transaction (the sync-batch variance report).
func (s *Service) AvailableQuantityIn(ctx context.Context, tx pgx.Tx, tenantID string, w WorkOrder) (int, error) {
	return s.availableQuantity(ctx, tx, tenantID, w)
}
