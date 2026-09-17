package outbox

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Subscriber receives every relayed event. It must tolerate seeing one
// twice: delivery is at-least-once, because a crash between the subscriber
// running and the commit replays the event, and a lost
// ProductionPlanConfirmed is worse than a repeated one.
type Subscriber func(ctx context.Context, e Row) error

// MaxAttempts is how many deliveries an event gets before it stays FAILED.
const MaxAttempts = 5

// Relay is the outbox publisher. One transaction per tenant batch: rows are
// locked with SKIP LOCKED, delivered, and marked PUBLISHED before the lock is
// released — a relay that dies mid-batch simply rolls back and the rows are
// still PENDING for whoever polls next.
type Relay struct {
	pool        *db.Pool
	log         *slog.Logger
	subscribers []Subscriber
	mu          sync.Mutex
	polling     bool
	stop        chan struct{}
	done        chan struct{}
}

// NewRelay builds a relay over a pool.
func NewRelay(pool *db.Pool, log *slog.Logger) *Relay {
	if log == nil {
		log = slog.Default()
	}
	return &Relay{pool: pool, log: log}
}

// Subscribe registers a consumer; every subscriber sees every event.
func (r *Relay) Subscribe(s Subscriber) { r.subscribers = append(r.subscribers, s) }

// Result is what one relay pass delivered.
type Result struct {
	Delivered, Failed, Tenants int
}

type failure struct {
	id, message string
}

func scanRow(rows pgx.Rows) (Row, error) {
	var e Row
	var payload []byte
	var occurred time.Time
	if err := rows.Scan(&e.ID, &e.TenantID, &e.EventType, &e.AggregateType, &e.AggregateID, &payload, &occurred); err != nil {
		return Row{}, err
	}
	e.Payload = map[string]any{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &e.Payload)
	}
	e.OccurredAt = db.ISO(occurred)
	return e, nil
}

// RelayTenant delivers up to batchSize pending events for one tenant.
func (r *Relay) RelayTenant(ctx context.Context, tenantID string, batchSize int) (Result, error) {
	if batchSize <= 0 {
		batchSize = 50
	}
	var failures []failure
	delivered := 0
	err := r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, event_type, aggregate_type, aggregate_id, payload, occurred_at
			FROM outbox_event WHERE tenant_id = $1 AND status = 'PENDING' AND attempts < $3
			ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $2`, tenantID, batchSize, MaxAttempts)
		if err != nil {
			return err
		}
		var claimed []Row
		for rows.Next() {
			e, err := scanRow(rows)
			if err != nil {
				rows.Close()
				return err
			}
			claimed = append(claimed, e)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, e := range claimed {
			if err := r.deliver(ctx, e); err != nil {
				// One bad event must not cost the rest of the batch its
				// delivery; its failure is recorded outside this transaction.
				failures = append(failures, failure{e.ID, err.Error()})
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE outbox_event SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = NULL
				WHERE tenant_id = $1 AND id = $2`, tenantID, e.ID); err != nil {
				return err
			}
			delivered++
		}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	for _, f := range failures {
		message := f.message
		if len(message) > 2000 {
			message = message[:2000]
		}
		if err := r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `UPDATE outbox_event SET attempts = attempts + 1, last_error = $3,
				status = CASE WHEN attempts + 1 >= $4 THEN 'FAILED' ELSE 'PENDING' END
				WHERE tenant_id = $1 AND id = $2`, tenantID, f.id, message, MaxAttempts)
			return err
		}); err != nil {
			return Result{}, err
		}
	}
	return Result{Delivered: delivered, Failed: len(failures), Tenants: 1}, nil
}

func (r *Relay) deliver(ctx context.Context, e Row) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = &subscriberPanic{value: rec}
		}
	}()
	for _, s := range r.subscribers {
		if err := s(ctx, e); err != nil {
			return err
		}
	}
	return nil
}

type subscriberPanic struct{ value any }

func (p *subscriberPanic) Error() string { return "subscriber panic" }

// TenantsWithPending lists tenants with something waiting.
func (r *Relay) TenantsWithPending(ctx context.Context) ([]string, error) {
	var out []string
	err := r.pool.WithoutTenant(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT DISTINCT tenant_id FROM outbox_event WHERE status = 'PENDING' AND attempts < $1`, MaxAttempts)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			out = append(out, id)
		}
		return rows.Err()
	})
	return out, err
}

// RelayAll delivers for every tenant that has pending events.
func (r *Relay) RelayAll(ctx context.Context, batchSize int) (Result, error) {
	tenants, err := r.TenantsWithPending(ctx)
	if err != nil {
		return Result{}, err
	}
	total := Result{Tenants: len(tenants)}
	for _, tenantID := range tenants {
		res, err := r.RelayTenant(ctx, tenantID, batchSize)
		if err != nil {
			return total, err
		}
		total.Delivered += res.Delivered
		total.Failed += res.Failed
	}
	return total, nil
}

// Tick runs one pass unless one is already running.
func (r *Relay) Tick(ctx context.Context) {
	r.mu.Lock()
	if r.polling {
		r.mu.Unlock()
		return
	}
	r.polling = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.polling = false
		r.mu.Unlock()
	}()
	if _, err := r.RelayAll(ctx, 50); err != nil {
		r.log.Error("[outbox] relay error", "error", err)
	}
}

// Start polls until Stop or the context ends. A poll loop rather than
// LISTEN/NOTIFY: the event is already durable in a table, and a notification
// that can be missed would only be an optimisation on top of the poll that
// has to exist anyway.
func (r *Relay) Start(ctx context.Context, interval time.Duration) {
	r.mu.Lock()
	if r.stop != nil {
		r.mu.Unlock()
		return
	}
	r.stop, r.done = make(chan struct{}), make(chan struct{})
	stop, done := r.stop, r.done
	r.mu.Unlock()
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		r.Tick(ctx)
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.Tick(ctx)
			}
		}
	}()
}

// Stop ends the loop and waits for the current pass.
func (r *Relay) Stop() {
	r.mu.Lock()
	stop, done := r.stop, r.done
	r.stop, r.done = nil, nil
	r.mu.Unlock()
	if stop != nil {
		close(stop)
		<-done
	}
}
