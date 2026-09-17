// Package middleware holds the request pipeline the Node API applied to every
// request, in the same order: security headers, CORS, request id, tenant,
// principal, rate limits, authorization. Only the first three and the
// generic plumbing (recover, access log, gzip, timeout) live here; the
// tenant, principal and permission steps belong to their own packages.
package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/klauspost/compress/gzhttp"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
)

const docsPath = "/api/v1/docs"

const (
	apiCSP  = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
	docsCSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)

// SecurityHeaders is the restrictive policy an API that answers JSON should
// carry: deny everything and name the one exception, the docs page.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		if r.URL.Path == docsPath {
			h.Set("Content-Security-Policy", docsCSP)
		} else {
			h.Set("Content-Security-Policy", apiCSP)
		}
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("X-Permitted-Cross-Domain-Policies", "none")
		// Browsers ignore HSTS over plain HTTP, so a plant LAN on http:// is
		// unaffected while a public deployment behind TLS gets the guarantee.
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		// The API's answers are per-session data. A shared cache holding one
		// operator's work orders and handing them to the next tablet is a
		// data leak that never touches the application code.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// CORSOptions is the cross-origin policy.
type CORSOptions struct {
	// AllowedOrigins is the exact allowlist; an empty list means same-origin
	// only. A request without an Origin header is always allowed - it is a
	// same-origin request, a server-to-server call, or the operator
	// terminal's own fetch.
	AllowedOrigins []string
}

var (
	corsMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
	corsHeaders = "Content-Type,Authorization,X-Tenant-Id,X-Request-Id"
)

// CORS reproduces the cors package's behaviour for the options the Node API
// set: a refused origin gets no CORS headers at all rather than an error, so
// the browser refuses the response and the API never learns anything.
func CORS(opts CORSOptions) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(opts.AllowedOrigins))
	for _, o := range opts.AllowedOrigins {
		allowed[strings.TrimSuffix(o, "/")] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			// Vary regardless, so a cache never serves one origin's answer to
			// another.
			w.Header().Add("Vary", "Origin")
			if origin != "" && allowed[strings.TrimSuffix(origin, "/")] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id")
				if r.Method == http.MethodOptions {
					w.Header().Set("Access-Control-Allow-Methods", corsMethods)
					w.Header().Set("Access-Control-Allow-Headers", corsHeaders)
					w.Header().Set("Access-Control-Max-Age", "600")
					w.Header().Add("Vary", "Access-Control-Request-Headers")
					w.WriteHeader(http.StatusNoContent)
					return
				}
			} else if r.Method == http.MethodOptions && origin != "" {
				// A preflight from a refused origin: answer without the
				// allow headers, exactly as the cors package did.
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Recover turns a panic into a 500 envelope with the request id, and logs
// the stack where an engineer can find it.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					log.Error("panic", "requestId", httpx.RequestID(r.Context()), "panic", rec, "stack", string(debug.Stack()))
					httpx.WriteError(w, r, httpx.Internal(""))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// Gzip compresses responses above one kilobyte; below that the framing costs
// more than it saves, and the encoder streams so a large export is never
// buffered whole.
func Gzip(skip func(*http.Request) bool) func(http.Handler) http.Handler {
	wrapper, err := gzhttp.NewWrapper(gzhttp.MinSize(1024), gzhttp.CompressionLevel(5))
	if err != nil {
		panic(err)
	}
	return func(next http.Handler) http.Handler {
		compressed := wrapper(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skip != nil && skip(r) {
				next.ServeHTTP(w, r)
				return
			}
			compressed.ServeHTTP(w, r)
		})
	}
}

// Timeout bounds a request's context. Handlers pass that context to every
// query, so a client that gave up, or a query that hung, stops costing a
// goroutine and a connection when the deadline passes. A streaming route
// (the SSE feed) is exempt through skip: its lifetime is the client's.
func Timeout(d time.Duration, skip func(*http.Request) bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skip != nil && skip(r) {
				next.ServeHTTP(w, r)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// StatusRecorder captures the status for the access log and metrics.
type StatusRecorder struct {
	http.ResponseWriter
	Status int
	Bytes  int
}

func (s *StatusRecorder) WriteHeader(code int) {
	if s.Status == 0 {
		s.Status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *StatusRecorder) Write(b []byte) (int, error) {
	if s.Status == 0 {
		s.Status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.Bytes += n
	return n, err
}

// Flush keeps streaming responses (CSV export, SSE) working through the
// recorder.
func (s *StatusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *StatusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Observer receives every finished request, for metrics.
type Observer interface {
	ObserveRequest(method, route string, status int, d time.Duration)
}

// RouteName resolves the registered pattern for a request (chi's route
// pattern), so metrics group by route rather than by concrete id.
type RouteName func(r *http.Request) string

// AccessLog writes one structured line per request and feeds the observer.
// Health checks are skipped: a line every ten seconds from the container
// runtime is noise, not evidence.
func AccessLog(log *slog.Logger, obs Observer, routeName RouteName) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &StatusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)
			elapsed := time.Since(start)
			status := rec.Status
			if status == 0 {
				status = http.StatusOK
			}
			route := r.URL.Path
			if routeName != nil {
				if name := routeName(r); name != "" {
					route = name
				}
			}
			if obs != nil {
				obs.ObserveRequest(r.Method, route, status, elapsed)
			}
			if r.URL.Path == "/health" {
				return
			}
			log.Info("http",
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"ms", elapsed.Milliseconds(),
				"bytes", rec.Bytes,
				"requestId", httpx.RequestID(r.Context()),
				"ip", httpx.ClientIP(r),
			)
		})
	}
}
