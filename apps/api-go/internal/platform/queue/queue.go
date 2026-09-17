// Package queue is the self-hosted job queue: `planning_job` in PostgreSQL
// (Architecture §22.5, ADR-09).
//
// `FOR UPDATE SKIP LOCKED` is what makes a table a queue. Each claim takes a
// row no other transaction holds, so the API's in-process runner and any
// number of `fv worker` containers share the work instead of racing for it.
// The claim runs outside a tenant context on purpose — a runner cannot know
// whose job is next — and the tenant travels on the row, which the handler
// declares before doing anything (§22.4).
package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Job is the TypeScript Job.
type Job struct {
	ID          string         `json:"id"`
	TenantID    string         `json:"tenantId"`
	JobType     string         `json:"jobType"`
	Payload     map[string]any `json:"payload"`
	Status      string         `json:"status"`
	Result      map[string]any `json:"result,omitempty"`
	LastError   *string        `json:"lastError,omitempty"`
	Attempts    int            `json:"attempts"`
	MaxAttempts int            `json:"maxAttempts"`
	RequestedBy *string        `json:"requestedBy,omitempty"`
	EnqueuedAt  *string        `json:"enqueuedAt,omitempty"`
	StartedAt   *string        `json:"startedAt,omitempty"`
	FinishedAt  *string        `json:"finishedAt,omitempty"`
}

// Request is what a caller enqueues.
type Request struct {
	TenantID    string
	JobType     string
	Payload     map[string]any
	RequestedBy *string
	MaxAttempts int
}

// Handler runs one job and returns what a reader may see in `result`.
type Handler func(ctx context.Context, job Job) (map[string]any, error)

const columns = `id, tenant_id, job_type, payload, status, result, last_error, attempts, max_attempts, requested_by, enqueued_at, started_at, finished_at`

func scan(row pgx.Row) (Job, error) {
	var j Job
	var payload, result []byte
	var enqueued, started, finished *time.Time
	if err := row.Scan(&j.ID, &j.TenantID, &j.JobType, &payload, &j.Status, &result, &j.LastError, &j.Attempts, &j.MaxAttempts, &j.RequestedBy, &enqueued, &started, &finished); err != nil {
		return Job{}, err
	}
	j.Payload = map[string]any{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &j.Payload)
	}
	if len(result) > 0 {
		_ = json.Unmarshal(result, &j.Result)
	}
	j.EnqueuedAt, j.StartedAt, j.FinishedAt = db.ISOPtr(enqueued), db.ISOPtr(started), db.ISOPtr(finished)
	return j, nil
}

// Queue is the planning_job table.
type Queue struct {
	pool *db.Pool
}

// New wires the queue to a pool.
func New(pool *db.Pool) *Queue { return &Queue{pool: pool} }

// EnqueueIn adds a job on the caller's transaction, so the job row and the
// change that justified it commit or roll back together.
func (q *Queue) EnqueueIn(ctx context.Context, tx pgx.Tx, r Request) (Job, error) {
	payload, err := json.Marshal(r.Payload)
	if err != nil {
		return Job{}, fmt.Errorf("job payload: %w", err)
	}
	if r.Payload == nil {
		payload = []byte("{}")
	}
	max := r.MaxAttempts
	if max <= 0 {
		max = 3
	}
	return scan(tx.QueryRow(ctx, `INSERT INTO planning_job (id, tenant_id, job_type, payload, requested_by, max_attempts)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING `+columns, "job-"+uuid.NewString(), r.TenantID, r.JobType, payload, r.RequestedBy, max))
}

// Enqueue adds a job in its own tenant transaction.
func (q *Queue) Enqueue(ctx context.Context, r Request) (Job, error) {
	var job Job
	err := q.pool.WithTenant(ctx, r.TenantID, func(tx pgx.Tx) error {
		var err error
		job, err = q.EnqueueIn(ctx, tx, r)
		return err
	})
	return job, err
}

// Claim takes the oldest eligible job and marks it RUNNING, atomically. Jobs
// past max_attempts are skipped so one that fails deterministically stops
// consuming a runner and stays visible as FAILED.
func (q *Queue) Claim(ctx context.Context) (*Job, error) {
	var out *Job
	err := q.pool.WithoutTenant(ctx, func(tx pgx.Tx) error {
		job, err := scan(tx.QueryRow(ctx, `UPDATE planning_job SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1
			WHERE id = (SELECT id FROM planning_job WHERE status = 'PENDING' AND attempts < max_attempts ORDER BY enqueued_at FOR UPDATE SKIP LOCKED LIMIT 1)
			RETURNING `+columns))
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		out = &job
		return nil
	})
	return out, err
}

// Succeed records a job's result.
func (q *Queue) Succeed(ctx context.Context, jobID string, result map[string]any) error {
	payload, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if result == nil {
		payload = []byte("{}")
	}
	return q.pool.WithoutTenant(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE planning_job SET status = 'SUCCEEDED', result = $2::jsonb, finished_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $1`, jobID, payload)
		return err
	})
}

// Fail records a failure; the job returns to PENDING while retries remain.
func (q *Queue) Fail(ctx context.Context, jobID string, message string) error {
	if len(message) > 2000 {
		message = message[:2000]
	}
	return q.pool.WithoutTenant(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE planning_job
			SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END, last_error = $2,
			    finished_at = CASE WHEN attempts >= max_attempts THEN CURRENT_TIMESTAMP ELSE NULL END
			WHERE id = $1`, jobID, message)
		return err
	})
}

// FindByID reads one job in its tenant.
func (q *Queue) FindByID(ctx context.Context, tenantID, jobID string) (*Job, error) {
	var out *Job
	err := q.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		job, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM planning_job WHERE tenant_id = $1 AND id = $2`, tenantID, jobID))
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		out = &job
		return nil
	})
	return out, err
}

// List reads a tenant's jobs newest first (limit ≤ 200).
func (q *Queue) List(ctx context.Context, tenantID, jobType string, limit int) ([]Job, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	out := []Job{}
	err := q.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		where, args := "tenant_id = $1", []any{tenantID}
		if jobType != "" {
			args = append(args, jobType)
			where += " AND job_type = $2"
		}
		args = append(args, limit)
		rows, err := tx.Query(ctx, `SELECT `+columns+` FROM planning_job WHERE `+where+fmt.Sprintf(` ORDER BY enqueued_at DESC LIMIT $%d`, len(args)), args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			job, err := scan(rows)
			if err != nil {
				return err
			}
			out = append(out, job)
		}
		return rows.Err()
	})
	return out, err
}

// Runner drains the queue by handing each claimed job to its handler. It
// owns no domain knowledge, so the same loop serves the API process and
// `fv worker`; the loop never panics out — a failing job is recorded against
// its row and retried until max_attempts.
type Runner struct {
	queue     *Queue
	handlers  map[string]Handler
	label     string
	batchSize int
	log       *slog.Logger

	mu       sync.Mutex
	draining bool
	stop     chan struct{}
	done     chan struct{}
}

// NewRunner builds a runner over the handler map.
func NewRunner(q *Queue, handlers map[string]Handler, label string, log *slog.Logger) *Runner {
	if log == nil {
		log = slog.Default()
	}
	return &Runner{queue: q, handlers: handlers, label: label, batchSize: 20, log: log}
}

// RunOnce processes one job; nil when the queue was empty.
func (r *Runner) RunOnce(ctx context.Context) (*Job, error) {
	job, err := r.queue.Claim(ctx)
	if err != nil || job == nil {
		return nil, err
	}
	handler, ok := r.handlers[job.JobType]
	if !ok {
		// A job nobody can run must not sit RUNNING for ever, and must not be
		// retried by a runner that will never have the handler either.
		message := fmt.Sprintf("Tidak ada handler untuk job type %s pada %s. Job ditandai gagal agar tidak menggantung.", job.JobType, r.label)
		if err := r.queue.Fail(ctx, job.ID, message); err != nil {
			return nil, err
		}
		r.log.Error("["+r.label+"] "+message, "job", job.ID)
		job.Status, job.LastError = "FAILED", &message
		return job, nil
	}
	result, err := handler(ctx, *job)
	if err != nil {
		message := err.Error()
		if ferr := r.queue.Fail(ctx, job.ID, message); ferr != nil {
			return nil, ferr
		}
		r.log.Error(fmt.Sprintf("[%s] %s %s gagal: %s", r.label, job.JobType, job.ID, message))
		job.Status, job.LastError = "FAILED", &message
		return job, nil
	}
	if err := r.queue.Succeed(ctx, job.ID, result); err != nil {
		return nil, err
	}
	job.Status, job.Result = "SUCCEEDED", result
	return job, nil
}

// Drain processes up to batchSize jobs, so one busy tenant cannot monopolise
// a tick; a burst is not spread across one poll interval each.
func (r *Runner) Drain(ctx context.Context) int {
	r.mu.Lock()
	if r.draining {
		r.mu.Unlock()
		return 0
	}
	r.draining = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.draining = false
		r.mu.Unlock()
	}()
	processed := 0
	for i := 0; i < r.batchSize; i++ {
		job, err := r.RunOnce(ctx)
		if err != nil {
			r.log.Error("["+r.label+"] runner error", "error", err)
			break
		}
		if job == nil {
			break
		}
		processed++
	}
	return processed
}

// Nudge drains in the background so an interactive request does not wait
// for the next poll tick; the job is still executed by the runner.
func (r *Runner) Nudge() {
	go r.Drain(context.Background())
}

// Start polls until Stop or the context ends.
func (r *Runner) Start(ctx context.Context, interval time.Duration) {
	r.mu.Lock()
	if r.stop != nil {
		r.mu.Unlock()
		return
	}
	r.stop, r.done = make(chan struct{}), make(chan struct{})
	stop, done := r.stop, r.done
	r.mu.Unlock()
	r.log.Info(fmt.Sprintf("[%s] aktif, interval %d ms", r.label, interval.Milliseconds()))
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		r.Drain(ctx)
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.Drain(ctx)
			}
		}
	}()
}

// Stop ends the poll loop and waits for the current drain.
func (r *Runner) Stop() {
	r.mu.Lock()
	stop, done := r.stop, r.done
	r.stop, r.done = nil, nil
	r.mu.Unlock()
	if stop != nil {
		close(stop)
		<-done
	}
}
