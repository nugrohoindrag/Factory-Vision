// Package observability is how "which endpoint is slow" gets answered:
// Prometheus metrics per route, the pgx statement histogram, pprof on the
// admin listener, structured logs with the request id, and OpenTelemetry
// traces when an exporter is configured.
package observability

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/pprof"
	"os"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds the process's collectors.
type Metrics struct {
	registry *prometheus.Registry
	requests *prometheus.HistogramVec
	inflight prometheus.Gauge
	queries  *prometheus.HistogramVec
	security *prometheus.CounterVec
	cache    *prometheus.CounterVec
}

// NewMetrics registers the collectors on a private registry, so the admin
// endpoint exposes exactly what this process defines.
func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		registry: reg,
		requests: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "fv_http_request_duration_seconds",
			Help:    "Latency per route; p50/p95/p99 come from the buckets.",
			Buckets: []float64{.002, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
		}, []string{"method", "route", "status"}),
		inflight: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "fv_http_requests_in_flight",
			Help: "Requests currently being served.",
		}),
		queries: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "fv_db_query_duration_seconds",
			Help:    "PostgreSQL statement latency.",
			Buckets: []float64{.0005, .001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5},
		}, []string{"result"}),
		security: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "fv_security_events_total",
			Help: "Security events by type.",
		}, []string{"type"}),
		cache: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "fv_cache_events_total",
			Help: "Cache hits and misses by cache.",
		}, []string{"cache", "event"}),
	}
	reg.MustRegister(m.requests, m.inflight, m.queries, m.security, m.cache)
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	return m
}

// ObserveRequest implements middleware.Observer.
func (m *Metrics) ObserveRequest(method, route string, status int, d time.Duration) {
	m.requests.WithLabelValues(method, route, strconv.Itoa(status)).Observe(d.Seconds())
}

// ObserveQuery implements db.QueryObserver.
func (m *Metrics) ObserveQuery(d time.Duration, failed bool) {
	result := "ok"
	if failed {
		result = "error"
	}
	m.queries.WithLabelValues(result).Observe(d.Seconds())
}

// SecurityEvent counts one security event.
func (m *Metrics) SecurityEvent(eventType string) { m.security.WithLabelValues(eventType).Inc() }

// InFlight wraps a handler with the in-flight gauge.
func (m *Metrics) InFlight(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.inflight.Inc()
		defer m.inflight.Dec()
		next.ServeHTTP(w, r)
	})
}

// Handler serves the scrape endpoint.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// AdminServer serves metrics and pprof on a listener that is never
// published: a heap profile is a copy of the tenant's data.
func AdminServer(addr string, metrics *Metrics, ready func() bool) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		if ready != nil && !ready() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	return &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
}

// Logger builds the process logger: JSON in production (what a log shipper
// or docker logs picks up), text otherwise.
func Logger(production bool) *slog.Logger {
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if production {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}

// WithRequestID returns a logger carrying the request id, for handlers
// that log mid-request.
func WithRequestID(log *slog.Logger, ctx context.Context, id string) *slog.Logger {
	if id == "" {
		return log
	}
	return log.With("requestId", id)
}
