// Package async runs work the request must not wait for.
//
// The Node API fired these as un-awaited promises: an audit row after the
// audited change had committed, an operational event after the record it
// describes, the idle-window touch on a session. A goroutine per call would
// reproduce that, and under a burst it would also reproduce the failure mode
// the pattern list warns about — unbounded goroutines all waiting on the same
// pool. So the work goes through one bounded runner: a semaphore caps how
// many run at once, the rest queue, and a failure is logged with what it was
// rather than lost.
package async

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"golang.org/x/sync/semaphore"
)

// Runner executes detached work with a concurrency cap.
type Runner struct {
	sem     *semaphore.Weighted
	timeout time.Duration
	log     *slog.Logger
	wg      sync.WaitGroup
	closed  chan struct{}
	once    sync.Once
}

// NewRunner caps concurrent detached work at `limit`; each unit gets
// `timeout` before its context is cancelled.
func NewRunner(limit int64, timeout time.Duration, log *slog.Logger) *Runner {
	if limit <= 0 {
		limit = 32
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	if log == nil {
		log = slog.Default()
	}
	return &Runner{sem: semaphore.NewWeighted(limit), timeout: timeout, log: log, closed: make(chan struct{})}
}

// Go schedules fn. It never blocks the caller: acquiring a slot happens on
// the new goroutine, so a burst queues rather than stalls the request.
func (r *Runner) Go(name string, fn func(ctx context.Context) error) {
	select {
	case <-r.closed:
		r.log.Warn("async: dropped after shutdown", "task", name)
		return
	default:
	}
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), r.timeout)
		defer cancel()
		if err := r.sem.Acquire(ctx, 1); err != nil {
			r.log.Error("async: queue timeout", "task", name, "error", err)
			return
		}
		defer r.sem.Release(1)
		defer func() {
			if rec := recover(); rec != nil {
				r.log.Error("async: panic", "task", name, "panic", rec)
			}
		}()
		if err := fn(ctx); err != nil {
			r.log.Error("async: task failed", "task", name, "error", err)
		}
	}()
}

// Drain stops accepting work and waits up to `grace` for what is running:
// an audit row that was queued must still be written before the process
// exits on a deploy.
func (r *Runner) Drain(grace time.Duration) {
	r.once.Do(func() { close(r.closed) })
	done := make(chan struct{})
	go func() {
		r.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(grace):
		r.log.Warn("async: drain timed out; some detached work was abandoned")
	}
}
