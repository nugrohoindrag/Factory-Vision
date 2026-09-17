package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/fixtures"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/correction"
	csvmod "github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/csv"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/identity"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/oee"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/roles"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shift"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
)

type noResolver struct{}

func (noResolver) Resolve(context.Context, string) (*auth.Principal, error) {
	return nil, auth.ErrNoSession
}

func testDeps(t *testing.T, mounts ...func(chi.Router)) Deps {
	t.Helper()
	loc, _ := time.LoadLocation("Asia/Jakarta")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return Deps{
		Config: &config.Config{
			Env: "test", Port: 0, AuthRequired: true, DeploymentMode: "ON_PREMISE_SINGLE_TENANT",
			DefaultTenant: config.PilotTenant, Location: loc, ProductVersion: "test",
		},
		Log:      log,
		Resolver: noResolver{},
		Table:    rbac.Default,
		Events:   security.NewEvents("", log),
		BootedAt: "2026-09-17T00:00:00.000Z",
		Mount:    mounts,
	}
}

// Every native mutating route must have an explicit permission rule. The
// fallback to dashboard:view is deliberate for reads — a new endpoint should
// be guarded by accident rather than open by accident — but for a write it
// would mean every signed-in role could call it.
func TestEveryMutatingRouteHasAnExplicitRule(t *testing.T) {
	// Every module main.go mounts, wired to services that are never called
	// during a walk: the router only has to be built, not served.
	master, err := masterdata.NewService(nil)
	if err != nil {
		t.Fatal(err)
	}
	roleSvc, err := roles.NewService(nil, master)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	events := security.NewEvents("", log)
	identitySvc := identity.NewService(&config.Config{}, master, roleSvc, nil, nil, nil, nil, events, log)
	masterHandler := masterdata.NewHandler(master, nil, identitySvc, events)
	productionSvc := production.NewService(nil, nil, nil, log)
	shopfloorSvc := shopfloor.NewService(nil, productionSvc, master, nil, nil, log)
	oeeSvc, err := oee.NewService(nil, master, productionSvc, shopfloorSvc)
	if err != nil {
		t.Fatal(err)
	}
	r := Handler(testDeps(t,
		func(api chi.Router) { identity.Mount(api, identitySvc, master) },
		func(api chi.Router) { roles.Mount(api, roleSvc, nil, events) },
		masterHandler.Mount,
		func(api chi.Router) { shift.Mount(api, master, nil) },
		func(api chi.Router) {
			shift.MountHandover(api, shift.NewHandoverService(nil, master, productionSvc, shopfloorSvc), master, nil)
		},
		func(api chi.Router) { csvmod.Mount(api, csvmod.NewService(master), nil, events, 5000) },
		production.NewHandler(productionSvc, master, nil).Mount,
		func(api chi.Router) { shopfloor.Mount(api, shopfloorSvc, nil) },
		func(api chi.Router) { correction.Mount(api, correction.NewService(nil, productionSvc, nil)) },
		func(api chi.Router) { oee.Mount(api, oeeSvc, nil) },
	)).(chi.Router)

	mutating := map[string]bool{"POST": true, "PUT": true, "PATCH": true, "DELETE": true}
	var missing []string
	walked := 0
	err = chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !mutating[method] || !strings.HasPrefix(route, "/api/v1") {
			return nil
		}
		walked++
		concrete := strings.ReplaceAll(chiToConcrete(route), "//", "/")
		if rbac.PublicAPIPaths[strings.TrimSuffix(concrete, "/")] {
			return nil
		}
		if _, explicit := rbac.Default.PermissionFor(method, strings.TrimSuffix(concrete, "/")); !explicit {
			missing = append(missing, method+" "+route)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) > 0 {
		t.Fatalf("mutating routes without an explicit permission rule:\n  %s", strings.Join(missing, "\n  "))
	}
}

// The golden inventory's mutating routes must all resolve explicitly too,
// so a module ported later cannot land on the fallback unnoticed.
func TestInventoryMutatingRoutesResolveExplicitly(t *testing.T) {
	for _, g := range fixtures.GoldenRoutes() {
		if g.Public || g.Method == "GET" {
			continue
		}
		if _, explicit := rbac.Default.PermissionFor(g.Method, g.ConcretePath); !explicit {
			t.Errorf("%s %s has no explicit rule", g.Method, g.Path)
		}
	}
}

func chiToConcrete(route string) string {
	// chi renders params as {id}; the permission matcher wants a segment.
	var b strings.Builder
	inParam := false
	for _, c := range route {
		switch {
		case c == '{':
			inParam = true
			b.WriteString("x")
		case c == '}':
			inParam = false
		case c == '*':
			b.WriteString("x")
		case !inParam:
			b.WriteRune(c)
		}
	}
	return b.String()
}

func TestUnknownRoutesAnswerWithTheEnvelope(t *testing.T) {
	h := Handler(testDeps(t))
	for _, c := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/api/v1/nope", 401}, // the policy runs before routing, as in Node
		{"GET", "/socket.io/?EIO=4&transport=polling", 404},
		{"POST", "/health", 405},
		{"GET", "/", 404},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		if rec.Code != c.status {
			t.Errorf("%s %s: %d want %d", c.method, c.path, rec.Code, c.status)
		}
		var body struct {
			Error struct {
				Code      string `json:"code"`
				RequestID string `json:"requestId"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error.Code == "" || body.Error.RequestID == "" {
			t.Errorf("%s %s: not an envelope: %s", c.method, c.path, rec.Body.String())
		}
	}
}

func TestProtectedRouteRefusesAnonymousAndHealthIsOpen(t *testing.T) {
	h := Handler(testDeps(t))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/events", nil))
	if rec.Code != 401 {
		t.Fatalf("anonymous must be 401, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/health", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("health: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Request-Id") == "" || rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("pipeline headers missing")
	}
}
