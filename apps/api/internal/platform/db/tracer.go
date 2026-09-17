package db

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// QueryObserver receives the duration of every statement, for metrics.
type QueryObserver interface {
	ObserveQuery(d time.Duration, failed bool)
}

// tracer implements pgx.QueryTracer: it is the slow-query log and the
// statement histogram in one hook, so neither costs a wrapper around every
// repository call.
type tracer struct {
	slow     time.Duration
	observer QueryObserver
	log      *slog.Logger
}

type traceKey struct{}

type traceStart struct {
	sql string
	at  time.Time
}

func (t *tracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, traceKey{}, traceStart{sql: data.SQL, at: time.Now()})
}

func (t *tracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	start, ok := ctx.Value(traceKey{}).(traceStart)
	if !ok {
		return
	}
	elapsed := time.Since(start.at)
	if t.observer != nil {
		t.observer.ObserveQuery(elapsed, data.Err != nil)
	}
	if t.slow > 0 && elapsed >= t.slow {
		t.log.Warn("db: slow query", "ms", elapsed.Milliseconds(), "sql", compact(start.sql, 200))
	}
}

func compact(sql string, max int) string {
	out := make([]byte, 0, min(len(sql), max))
	space := false
	for i := 0; i < len(sql) && len(out) < max; i++ {
		c := sql[i]
		if c == ' ' || c == '\n' || c == '\t' || c == '\r' {
			if !space && len(out) > 0 {
				out = append(out, ' ')
			}
			space = true
			continue
		}
		space = false
		out = append(out, c)
	}
	return string(out)
}
