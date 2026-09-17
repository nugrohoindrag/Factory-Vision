package event

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Recorder is what other modules depend on, so they never import the
// service's concrete type or the pool.
type Recorder interface {
	Record(ctx context.Context, in Input) (OperationalEvent, error)
	RecordDetached(in Input)
	RecordAll(ctx context.Context, tenantID string, inputs []Input) ([]OperationalEvent, error)
}

// Service is the Recorder over PostgreSQL.
type Service struct {
	pool     *db.Pool
	repo     Repository
	detached *async.Runner
}

// NewService wires the recorder.
func NewService(pool *db.Pool, detached *async.Runner) *Service {
	return &Service{pool: pool, detached: detached}
}

func stamp(in Input, index int) OperationalEvent {
	id := db.NewID("evt", 6)
	if index >= 0 {
		id = fmt.Sprintf("evt-%d-%d-%s", time.Now().UnixMilli(), index, db.RandomBase36(4))
	}
	occurredAt := in.OccurredAt
	if occurredAt == "" {
		occurredAt = db.Now()
	}
	return OperationalEvent{
		ID: id, TenantID: in.TenantID, EventType: in.EventType, EntityType: in.EntityType,
		EntityID: in.EntityID, ActorType: in.ActorType, ActorID: in.ActorID, ActorName: in.ActorName,
		OccurredAt: occurredAt, PlantID: in.PlantID, LineID: in.LineID, MachineID: in.MachineID,
		ProcessID: in.ProcessID, WorkOrderID: in.WorkOrderID, BatchID: in.BatchID,
		Summary: in.Summary, BeforeValue: in.BeforeValue, AfterValue: in.AfterValue, Metadata: in.Metadata,
	}
}

// Record writes one event and returns it.
func (s *Service) Record(ctx context.Context, in Input) (OperationalEvent, error) {
	e := stamp(in, -1)
	var out OperationalEvent
	err := s.pool.WithTenant(ctx, e.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.Insert(ctx, tx, e)
		return err
	})
	return out, err
}

// RecordDetached records without making the caller wait.
//
// An event history that fails to write is a gap in a timeline, not a
// corrupted transaction: the production record it describes is already
// committed, so a database hiccup must not turn a successful output entry
// into a 500 on the operator's terminal. The write goes through the bounded
// runner, not a bare goroutine, so a burst of captures cannot fan out into
// an unbounded number of waiting connections.
func (s *Service) RecordDetached(in Input) {
	s.detached.Go("event:"+in.EventType, func(ctx context.Context) error {
		_, err := s.Record(ctx, in)
		return err
	})
}

// RecordAll writes several events as one transaction, so a lifecycle step
// is whole.
func (s *Service) RecordAll(ctx context.Context, tenantID string, inputs []Input) ([]OperationalEvent, error) {
	if len(inputs) == 0 {
		return []OperationalEvent{}, nil
	}
	stamped := make([]OperationalEvent, 0, len(inputs))
	for i, in := range inputs {
		stamped = append(stamped, stamp(in, i))
	}
	written := make([]OperationalEvent, 0, len(stamped))
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		for _, e := range stamped {
			out, err := s.repo.Insert(ctx, tx, e)
			if err != nil {
				return err
			}
			written = append(written, out)
		}
		return nil
	})
	return written, err
}

// List runs a timeline query.
func (s *Service) List(ctx context.Context, tenantID string, q Query) ([]OperationalEvent, error) {
	var out []OperationalEvent
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.List(ctx, tx, tenantID, q)
		return err
	})
	return out, err
}

// Timeline is one entity's history, oldest first — the order §10.3 shows.
func (s *Service) Timeline(ctx context.Context, tenantID, entityType, entityID string, limit int) ([]OperationalEvent, error) {
	events, err := s.List(ctx, tenantID, Query{EntityType: entityType, EntityID: entityID, Limit: &limit})
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}
	return events, nil
}

// Summary counts events per type over the last `sinceDays`.
func (s *Service) Summary(ctx context.Context, tenantID string, sinceDays int) ([]Summary, error) {
	from := time.Now().Add(-time.Duration(sinceDays) * 24 * time.Hour)
	var out []Summary
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.CountByType(ctx, tx, tenantID, from)
		return err
	})
	return out, err
}
