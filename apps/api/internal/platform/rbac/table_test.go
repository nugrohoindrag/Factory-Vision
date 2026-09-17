package rbac

import (
	"testing"

	"github.com/nugrohoindrag/factory-vision/apps/api/fixtures"
)

// The hand-written table must agree, route for route, with what the Node
// API enforces. The golden file is exported from route-permissions.ts by
// apps/api/scripts/export-go-fixtures.mjs.
func TestTableMatchesGoldenExport(t *testing.T) {
	golden := fixtures.GoldenRoutes()
	if len(golden) < 300 {
		t.Fatalf("golden export looks truncated: %d routes", len(golden))
	}
	for _, g := range golden {
		if g.Public {
			if !PublicAPIPaths[g.Path] {
				t.Errorf("%s %s is public in Node but not here", g.Method, g.Path)
			}
			continue
		}
		got, explicit := Default.PermissionFor(g.Method, g.ConcretePath)
		if g.Permission == nil {
			if explicit {
				t.Errorf("%s %s: Node falls back to dashboard:view, Go names %s", g.Method, g.Path, got)
			}
			continue
		}
		if !explicit || got != *g.Permission {
			t.Errorf("%s %s: got %s (explicit=%v) want %s", g.Method, g.Path, got, explicit, *g.Permission)
		}
	}
}

func TestPublicPathsMatchExport(t *testing.T) {
	exported := fixtures.PublicAPIPaths()
	if len(exported) != len(PublicAPIPaths) {
		t.Fatalf("public path count %d, export %d", len(PublicAPIPaths), len(exported))
	}
	for _, p := range exported {
		if !PublicAPIPaths[p] {
			t.Errorf("%s exported as public but missing here", p)
		}
	}
}

func TestSpecificityOrder(t *testing.T) {
	// A wildcard fallback must never override the specific rule of the same
	// prefix, and a method rule must beat a `*` rule at equal depth.
	cases := []struct{ method, path, want string }{
		{"POST", "/api/v1/master/users", "user:create"},
		{"GET", "/api/v1/master/users", "user:view"},
		{"GET", "/api/v1/master/plants", "master_data:view"},
		{"PUT", "/api/v1/master/lines/line-01", "master_data:manage"},
		{"POST", "/api/v1/work-orders/wo-1/confirm", "work_order:confirm"},
		{"POST", "/api/v1/work-orders", "work_order:create"},
		{"GET", "/api/v1/shifts/handover/context", "shift:handover"},
		{"POST", "/api/v1/shifts/handover", "shift:handover"},
		{"POST", "/api/v1/shifts", "shift:manage"},
		{"POST", "/api/v1/quality/ncr", "ncr:create"},
		{"PUT", "/api/v1/quality/ncr/ncr-1", "ncr:manage"},
		{"GET", "/api/v1/events/summary", "event:view"},
	}
	for _, c := range cases {
		got, _ := Default.PermissionFor(c.method, c.path)
		if got != c.want {
			t.Errorf("%s %s: got %s want %s", c.method, c.path, got, c.want)
		}
	}
	if got, explicit := Default.PermissionFor("GET", "/api/v1/nothing-here"); explicit || got != FallbackPermission {
		t.Errorf("unknown route must fall back to %s, got %s", FallbackPermission, got)
	}
}

func TestBaselineFromFixtures(t *testing.T) {
	if !HasPermission(BaselinePermissions("ADMIN"), "role:edit") {
		t.Fatal("ADMIN must hold role:edit")
	}
	if HasPermission(BaselinePermissions("SALES"), "work_order:view") {
		t.Fatal("SALES must not see work orders")
	}
	if BaselineLandingPath("OPERATOR") != "/terminal" || BaselineLandingPath("UNKNOWN") != "/" {
		t.Fatal("landing paths")
	}
	if !IsPrivileged("user:create") || IsPrivileged("dashboard:view") {
		t.Fatal("privileged flags")
	}
	if HumanizeRole("PRODUCTION_MANAGER") != "Production Manager" {
		t.Fatal("humanize")
	}
}
