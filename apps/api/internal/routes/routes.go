// Package routes assembles the request pipeline and mounts every module.
//
// The order is the Node API's: security headers, CORS, request id, tenant
// from headers, principal from the bearer token, the per-path rate limits,
// then the route → permission policy in one place, so no handler can be
// added later that forgets its guard.
package routes

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/meta"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx/middleware"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/observability"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// Deps is everything the routes need; cmd/fv builds it. Modules that have
// not been ported yet are simply absent, and their routes 404 with the
// envelope until they land.
type Deps struct {
	Config   *config.Config
	Log      *slog.Logger
	Metrics  *observability.Metrics
	Tracing  *observability.Tracing
	Resolver auth.TokenResolver
	Table    *rbac.Table
	Events   *security.Events
	BootedAt string

	EventService *event.Service
	AuditService *audit.Service

	// Extra lets later modules mount under /api/v1 without this file
	// growing a field per module.
	Mount []func(r chi.Router)
	// Root lets modules mount outside /api/v1 (the internal admin API).
	Root []func(r chi.Router)
	// MFAAvailable and MFARequiredRoles feed the security summary until the
	// auth module owns them.
	MFAAvailable     bool
	MFARequiredRoles []string
}

// RequestTimeout bounds every request; CSV exports and sync batches are the
// slowest legitimate calls and finish well inside it.
const RequestTimeout = 60 * time.Second

// StreamPath is the Server-Sent Events feed, which is neither compressed
// nor bounded by the request timeout: its lifetime is the client's.
const StreamPath = "/api/v1/events/stream"

func isStream(r *http.Request) bool { return r.URL.Path == StreamPath }

// readModelPrefixes are the routes that answer with a weak ETag: the
// projections the console polls — analytics, reports, the board, OEE — whose
// answers mostly repeat between polls. Transaction routes are not tagged: a
// list of work orders is written to between reads, and a validator there
// buys nothing.
var readModelPrefixes = []string{"/api/v1/analytics/", "/api/v1/reports/", "/api/v1/production-board", "/api/v1/oee/"}

func isReadModel(r *http.Request) bool {
	for _, p := range readModelPrefixes {
		if strings.HasPrefix(r.URL.Path, p) {
			return true
		}
	}
	return false
}

// Handler builds the root handler.
func Handler(d Deps) http.Handler {
	r := chi.NewRouter()

	// Express was trailing-slash tolerant and answered HEAD for every GET.
	r.Use(chimw.StripSlashes)
	r.Use(chimw.GetHead)

	if d.Metrics != nil {
		r.Use(d.Metrics.InFlight)
	}
	r.Use(middleware.Recover(d.Log))
	r.Use(httpx.WithRequestID)
	r.Use(middleware.AccessLog(d.Log, observerOrNil(d.Metrics), routeName))
	if d.Tracing != nil {
		r.Use(d.Tracing.Middleware)
	}
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.CORS(middleware.CORSOptions{AllowedOrigins: d.Config.AllowedOrigins()}))
	r.Use(middleware.Gzip(isStream))
	r.Use(middleware.ETag(isReadModel))
	r.Use(middleware.Timeout(RequestTimeout, isStream))
	r.Use(tenancy.FromHeaders(d.Config.DefaultTenant))
	r.Use(auth.AttachPrincipal(d.Resolver, d.Log))
	r.Use(pathLimits(d.Events))
	r.Use(d.Table.Authorize(d.Config.AuthRequired, d.Config.APIDocsPublic))

	r.NotFound(httpx.NotFoundHandler())
	r.MethodNotAllowed(httpx.MethodNotAllowedHandler())

	meta.MountHealth(r)

	r.Route("/api/v1", func(api chi.Router) {
		meta.Mount(api, d.Config, d.Table)
		if d.EventService != nil {
			event.Mount(api, d.EventService)
		}
		if d.AuditService != nil {
			audit.Mount(api, d.AuditService)
		}
		api.Get("/security/summary", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			return httpx.OK(w, map[string]any{
				"since":    d.BootedAt,
				"counters": d.Events.Counters(),
				"posture": map[string]any{
					"authRequired":     d.Config.AuthRequired,
					"corsPolicy":       d.Config.DescribeCORS(),
					"mfaAvailable":     d.MFAAvailable,
					"mfaRequiredRoles": d.MFARequiredRoles,
					"tenantId":         tenancy.TenantID(r.Context()),
				},
			})
		}))
		for _, mount := range d.Mount {
			mount(api)
		}
	})
	for _, mount := range d.Root {
		mount(r)
	}

	// socket.io is not served: no client uses it (the Live Board polls), and
	// the security posture check only asserts that no session-less handshake
	// is ever issued a sid. An envelope 404 satisfies that.
	r.HandleFunc("/socket.io", httpx.NotFoundHandler())
	r.HandleFunc("/socket.io/*", httpx.NotFoundHandler())

	return r
}

// routeName is the registered chi pattern for a request, so metrics group
// by route rather than by concrete id.
func routeName(r *http.Request) string {
	if rctx := chi.RouteContext(r.Context()); rctx != nil {
		if p := rctx.RoutePattern(); p != "" {
			return p
		}
	}
	return ""
}

func observerOrNil(m *observability.Metrics) middleware.Observer {
	if m == nil {
		return nil
	}
	return m
}

// clientKey is the identity for limiting, in the order it can be trusted:
// an authenticated session first, then the forwarded address, then the
// socket.
func clientKey(r *http.Request) string {
	if p := auth.PrincipalFrom(r.Context()); p != nil {
		return "session:" + p.SessionID
	}
	return "ip:" + httpx.ClientIP(r)
}

type pathLimit struct {
	match   func(path string) bool
	limiter *security.RequestLimiter
	message string
	key     security.KeyFunc
}

func prefix(p string) func(string) bool {
	return func(path string) bool { return path == p || strings.HasPrefix(path, p+"/") }
}

func pattern(re string) func(string) bool {
	compiled := regexp.MustCompile(re)
	return func(path string) bool { return compiled.MatchString(path) }
}

// pathLimits reproduces the Express app.use(path, rateLimit(...)) stack:
// every limit whose path matches is consumed, in order, and the first
// refusal answers. Keyed on the identity being attacked as well as the
// address: one factory leaves through one IP, so limiting only by address
// would lock a whole shift out the first time somebody fat-fingers a PIN.
func pathLimits(events *security.Events) func(http.Handler) http.Handler {
	bodyKeyed := func(prefixKey string, fields ...string) security.KeyFunc {
		return func(r *http.Request) (string, *http.Request) {
			id, r := security.BodyKey(r, fields...)
			return prefixKey + ":" + id + ":" + clientKey(r), r
		}
	}
	bodyOnly := func(prefixKey string, fields ...string) security.KeyFunc {
		return func(r *http.Request) (string, *http.Request) {
			id, r := security.BodyKey(r, fields...)
			return prefixKey + ":" + id, r
		}
	}
	byClient := func(r *http.Request) (string, *http.Request) { return clientKey(r), r }

	limits := []pathLimit{
		// A coarse backstop only: the per-account lockout in the auth
		// service is what actually stops a guessing run, and this ceiling
		// has to stay above what a busy shift change or an automated test
		// suite legitimately produces.
		{prefix("/api/v1/auth/login"), security.NewRequestLimiter(40, 15*time.Minute),
			"Terlalu banyak percobaan login. Coba lagi beberapa saat.", bodyKeyed("login", "email")},
		{prefix("/api/v1/auth/operator-login"), security.NewRequestLimiter(40, 10*time.Minute),
			"Terlalu banyak percobaan PIN. Coba lagi beberapa saat.", bodyOnly("pin", "employeeNumber")},
		// A six-digit code is guessable in a hundred thousand tries; the
		// challenge is single-use, and this keeps attempts per challenge in
		// single figures.
		{prefix("/api/v1/auth/mfa/verify"), security.NewRequestLimiter(8, 10*time.Minute),
			"Terlalu banyak percobaan kode MFA. Silakan login ulang.", bodyOnly("mfa", "challengeToken")},
		// Two limits, because one number cannot serve both cases: a few
		// retries per address, and a ceiling per source that a sales floor
		// will not reach but a script will.
		{prefix("/api/v1/auth/trial-register"), security.NewRequestLimiter(5, time.Hour),
			"Terlalu banyak pendaftaran untuk email ini. Coba lagi nanti.", bodyKeyed("trial", "email")},
		{prefix("/api/v1/auth/trial-register"), security.NewRequestLimiter(30, time.Hour),
			"Terlalu banyak pendaftaran dari alamat ini. Coba lagi nanti.", byClient},
		{prefix("/api/internal/v1/auth/login"), security.NewRequestLimiter(8, 15*time.Minute),
			"Terlalu banyak percobaan login internal.", bodyKeyed("internal", "email")},
	}
	// Credential-setting and bulk-data endpoints: cheap for the caller,
	// expensive or sensitive for everyone else. One limiter is shared by the
	// two credential paths, as in the Node API.
	credential := security.NewRequestLimiter(20, 15*time.Minute)
	limits = append(limits,
		pathLimit{pattern(`^/api/v1/(users|master/users)/[^/]+/password$`), credential,
			"Terlalu banyak perubahan kredensial. Coba lagi beberapa saat.", byClient},
		pathLimit{pattern(`^/api/v1/operators/[^/]+/pin$`), credential,
			"Terlalu banyak perubahan kredensial. Coba lagi beberapa saat.", byClient},
		pathLimit{pattern(`^/api/v1/csv/[^/]+/(export|import)$`), security.NewRequestLimiter(30, 15*time.Minute),
			"Terlalu banyak permintaan export/import. Coba lagi beberapa saat.", byClient},
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, l := range limits {
				if !l.match(r.URL.Path) {
					continue
				}
				var key string
				key, r = l.key(r)
				if wait := l.limiter.Consume(key); wait > 0 {
					if events != nil {
						events.Refusal("RATE_LIMIT_HIT", "Rate limit reached on "+r.Method+" "+r.URL.Path, security.EventContext{
							IP: httpx.ClientIP(r), Detail: map[string]any{"key": key, "retryAfter": wait},
						})
					}
					httpx.WriteError(w, r, httpx.RateLimited(l.message, wait))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
