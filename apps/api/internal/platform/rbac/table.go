package rbac

import (
	"net/http"
	"sort"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Rule maps one route pattern to the permission it requires. `:param`
// matches one segment, a trailing `*` matches the rest.
type Rule struct {
	Method     string // "*" for any
	Pattern    string
	Permission string
}

// Rules is the route → permission policy (US-003, US-054).
//
// Declaring authorization in one table rather than sprinkling a guard onto
// each of the API's ~300 handlers is what makes "API authorization applies
// the same rules as the UI" checkable: the console renders its navigation
// from the same permission ids, and a reviewer can read the whole policy on
// one screen. The table is a transcription of route-permissions.ts and is
// tested against the golden export of that file.
//
// Rules are matched most-specific first. An unmatched /api/v1 route falls
// back to dashboard:view, so a new endpoint is read-only-guarded by accident
// rather than wide open by accident.
var Rules = []Rule{
	// --- Master data ------------------------------------------------
	{"GET", "/api/v1/master/*", "master_data:view"},
	{"GET", "/api/v1/master/users*", "user:view"},
	{"POST", "/api/v1/master/users", "user:create"},
	{"PUT", "/api/v1/master/users/:id", "user:edit"},
	{"PATCH", "/api/v1/master/users/:id/status", "user:deactivate"},
	{"DELETE", "/api/v1/master/users/:id", "user:deactivate"},
	{"*", "/api/v1/master/kpi-targets*", "configuration:manage"},
	{"GET", "/api/v1/master/devices*", "device:view"},
	{"*", "/api/v1/master/devices*", "device:manage"},
	{"GET", "/api/v1/master/batches*", "batch:view"},
	{"POST", "/api/v1/master/batches", "batch:create"},
	{"PUT", "/api/v1/master/batches/:id", "batch:edit"},
	{"*", "/api/v1/master/*", "master_data:manage"},

	// --- Users, roles, sessions -------------------------------------
	{"GET", "/api/v1/users*", "user:view"},
	{"POST", "/api/v1/users", "user:create"},
	{"PUT", "/api/v1/users/:id", "user:edit"},
	{"PATCH", "/api/v1/users/:id/status", "user:deactivate"},
	{"POST", "/api/v1/users/:id/password", "user:edit"},
	{"DELETE", "/api/v1/users/:id", "user:deactivate"},
	{"GET", "/api/v1/roles*", "role:view"},
	{"POST", "/api/v1/roles", "role:create"},
	{"PUT", "/api/v1/roles/:id", "role:edit"},
	{"DELETE", "/api/v1/roles/:id", "role:edit"},
	{"GET", "/api/v1/permissions", "role:view"},
	{"GET", "/api/v1/security/summary", "configuration:manage"},
	{"GET", "/api/v1/sessions", "user:view"},
	{"DELETE", "/api/v1/sessions*", "user:deactivate"},
	{"POST", "/api/v1/operators/:id/pin", "user:edit"},

	// --- Demand & planning (MES Improvement v1.0) -------------------
	{"GET", "/api/v1/customers*", "customer:view"},
	{"*", "/api/v1/customers*", "customer:manage"},
	{"GET", "/api/v1/customer-orders*", "customer_order:view"},
	{"POST", "/api/v1/customer-orders/:id/cancel", "customer_order:cancel"},
	{"POST", "/api/v1/customer-orders", "customer_order:create"},
	{"*", "/api/v1/customer-orders*", "customer_order:edit"},
	{"POST", "/api/v1/demand-forecasts/generate", "demand_forecast:generate"},
	{"GET", "/api/v1/demand-forecasts*", "demand_forecast:view"},
	{"POST", "/api/v1/capacity-plans/:id/recalculate", "capacity_plan:manage"},
	{"GET", "/api/v1/capacity-plans*", "capacity_plan:view"},
	{"*", "/api/v1/capacity-plans*", "capacity_plan:manage"},
	{"POST", "/api/v1/production-plans/:id/confirm", "production_plan:confirm"},
	{"POST", "/api/v1/production-plans/:id/cancel", "production_plan:confirm"},
	{"POST", "/api/v1/production-plans/:id/generate-work-orders", "work_order:create"},
	{"GET", "/api/v1/production-plans*", "production_plan:view"},
	{"POST", "/api/v1/production-plans", "production_plan:create"},
	{"*", "/api/v1/production-plans*", "production_plan:edit"},
	{"GET", "/api/v1/planning/config", "production_plan:view"},
	{"PUT", "/api/v1/planning/config", "configuration:manage"},
	{"GET", "/api/v1/molds*", "master_data:view"},
	{"*", "/api/v1/molds*", "master_data:manage"},

	// --- Planning ---------------------------------------------------
	{"GET", "/api/v1/production-orders*", "production_order:view"},
	{"POST", "/api/v1/production-orders/:id/release", "production_order:release"},
	{"POST", "/api/v1/production-orders", "production_order:create"},
	{"PUT", "/api/v1/production-orders/:id", "production_order:edit"},
	{"DELETE", "/api/v1/production-orders/:id", "production_order:delete"},
	{"GET", "/api/v1/work-orders*", "work_order:view"},
	{"POST", "/api/v1/work-orders/:id/confirm", "work_order:confirm"},
	{"POST", "/api/v1/work-orders/:id/release", "work_order:confirm"},
	{"POST", "/api/v1/work-orders/:id/cancel", "work_order:cancel"},
	{"POST", "/api/v1/work-orders/:id/split", "work_order:create"},
	{"POST", "/api/v1/work-orders/:id/start", "shopfloor:execute"},
	{"POST", "/api/v1/work-orders/:id/pause", "shopfloor:execute"},
	{"POST", "/api/v1/work-orders/:id/resume", "shopfloor:execute"},
	{"POST", "/api/v1/work-orders/:id/complete", "shopfloor:execute"},
	{"POST", "/api/v1/work-orders/:id/batch", "batch:edit"},
	{"POST", "/api/v1/work-orders", "work_order:create"},
	{"PUT", "/api/v1/work-orders/:id", "work_order:edit"},
	{"DELETE", "/api/v1/work-orders/:id", "work_order:cancel"},

	// --- Shop floor -------------------------------------------------
	{"GET", "/api/v1/shop-floor/*", "work_order:view"},
	{"POST", "/api/v1/shop-floor/output", "production_record:create"},
	{"POST", "/api/v1/shop-floor/downtime/start", "downtime:create"},
	{"POST", "/api/v1/shop-floor/downtime/:id/resolve", "downtime:create"},
	{"POST", "/api/v1/shop-floor/sync-batch", "shopfloor:execute"},
	{"GET", "/api/v1/shop-floor/sync-exceptions*", "work_order:view"},
	{"PATCH", "/api/v1/shop-floor/sync-exceptions/:id", "production_record:correct"},

	// --- Shift ------------------------------------------------------
	{"GET", "/api/v1/shifts*", "shift:view"},
	{"*", "/api/v1/shifts/handover*", "shift:handover"},
	{"*", "/api/v1/shifts*", "shift:manage"},

	// --- Analytics, OEE, reports ------------------------------------
	{"GET", "/api/v1/analytics/*", "analytics:view"},
	{"GET", "/api/v1/oee/validation*", "analytics:view"},
	{"*", "/api/v1/oee/validation*", "configuration:manage"},
	{"GET", "/api/v1/oee/config", "analytics:view"},
	{"PUT", "/api/v1/oee/config", "configuration:manage"},
	{"GET", "/api/v1/oee/*", "analytics:view"},
	{"GET", "/api/v1/reports/*", "report:export"},

	// --- CSV --------------------------------------------------------
	{"GET", "/api/v1/csv/*", "master_data:view"},
	{"POST", "/api/v1/csv/*", "master_data:import"},

	// --- Governance -------------------------------------------------
	{"GET", "/api/v1/corrections*", "production_record:correct"},
	{"POST", "/api/v1/corrections/:id/approve", "correction:approve"},
	{"POST", "/api/v1/corrections/:id/reject", "correction:approve"},
	{"POST", "/api/v1/corrections", "production_record:correct"},
	{"GET", "/api/v1/audit-logs*", "audit:view"},

	// --- Self-service and tenant setup ------------------------------
	{"POST", "/api/v1/auth/mfa/enroll", "dashboard:view"},
	{"POST", "/api/v1/auth/mfa/confirm", "dashboard:view"},
	{"POST", "/api/v1/auth/mfa/disable", "dashboard:view"},
	{"PUT", "/api/v1/onboarding/step", "dashboard:view"},
	{"PUT", "/api/v1/onboarding/guidance", "dashboard:view"},
	{"POST", "/api/v1/onboarding/events", "dashboard:view"},
	{"POST", "/api/v1/onboarding/upgrade", "configuration:manage"},
	{"*", "/api/v1/onboarding/*", "master_data:manage"},

	// --- MES Improvement v2.0 (Improvement PRD §34) -----------------
	{"POST", "/api/v1/materials/inventory/adjust", "material:adjust"},
	{"POST", "/api/v1/materials/inventory/receive", "material:adjust"},
	{"POST", "/api/v1/materials/inventory/incoming", "material:adjust"},
	{"POST", "/api/v1/materials/reservations/work-order/:id", "material:reserve"},
	{"DELETE", "/api/v1/materials/reservations/:id", "material:reserve"},
	{"POST", "/api/v1/materials/consumption", "material:consume"},
	{"*", "/api/v1/materials/warehouses*", "master_data:manage"},
	{"GET", "/api/v1/materials/*", "material:view"},
	{"POST", "/api/v1/materials/availability*", "material:view"},
	{"POST", "/api/v1/mrp/run", "mrp:run"},
	{"GET", "/api/v1/mrp/*", "mrp:view"},
	{"POST", "/api/v1/quality/inspections", "quality:inspect"},
	{"POST", "/api/v1/quality/holds/:id/release", "quality:release"},
	{"POST", "/api/v1/quality/holds", "quality:hold"},
	{"POST", "/api/v1/quality/dispositions", "quality:disposition"},
	{"POST", "/api/v1/quality/ncr", "ncr:create"},
	{"*", "/api/v1/quality/ncr*", "ncr:manage"},
	{"*", "/api/v1/quality/inspection-plans*", "ncr:manage"},
	{"GET", "/api/v1/quality/*", "quality:view"},
	{"POST", "/api/v1/maintenance/records/:id/start", "maintenance:execute"},
	{"POST", "/api/v1/maintenance/records/:id/complete", "maintenance:complete"},
	{"POST", "/api/v1/maintenance/records/:id/assign", "maintenance:assign"},
	{"POST", "/api/v1/maintenance/requests/:id/accept", "maintenance:assign"},
	{"POST", "/api/v1/maintenance/requests/:id/reject", "maintenance:assign"},
	{"POST", "/api/v1/maintenance/requests", "maintenance:create"},
	{"POST", "/api/v1/maintenance/emergency", "maintenance:execute"},
	{"*", "/api/v1/maintenance/plans*", "maintenance:create"},
	{"GET", "/api/v1/maintenance/*", "maintenance:view"},
	{"*", "/api/v1/workforce/skills*", "workforce:manage"},
	{"*", "/api/v1/workforce/requirements*", "workforce:manage"},
	{"*", "/api/v1/workforce/qualifications*", "workforce:qualification"},
	{"*", "/api/v1/workforce/shift-assignments*", "workforce:assignment"},
	{"*", "/api/v1/workforce/assignments*", "workforce:assignment"},
	{"*", "/api/v1/workforce/availability*", "workforce:availability"},
	{"*", "/api/v1/workforce/labor-requirements*", "workforce:assignment"},
	{"*", "/api/v1/workforce/time-records*", "workforce:assignment"},
	{"GET", "/api/v1/workforce/*", "workforce:view"},
	{"POST", "/api/v1/wip/transfers/:id/receive", "wip:receive"},
	{"POST", "/api/v1/wip/transfers", "wip:transfer"},
	{"POST", "/api/v1/wip/records/:id/hold", "wip:hold"},
	{"POST", "/api/v1/wip/records/:id/release", "wip:release"},
	{"POST", "/api/v1/wip/records", "wip:create"},
	{"GET", "/api/v1/wip/*", "wip:view"},
	{"POST", "/api/v1/production-board/dispatch", "production_board:reschedule"},
	{"GET", "/api/v1/production-board*", "production_board:view"},
	{"GET", "/api/v1/events*", "event:view"},
}

// PublicAPIPaths are let past before the table is consulted: the login
// doors, the session probe, logout and the deployment descriptor.
var PublicAPIPaths = map[string]bool{
	"/health":                     true,
	"/api/v1/auth/login":          true,
	"/api/v1/auth/trial-register": true,
	"/api/v1/auth/operator-login": true,
	"/api/v1/auth/mfa/verify":     true,
	"/api/v1/auth/session":        true,
	"/api/v1/auth/logout":         true,
	"/api/v1/meta/deployment":     true,
}

// DocPaths stay reachable with any session; API_DOCS_PUBLIC opens them.
var DocPaths = map[string]bool{
	"/api/v1/meta/openapi.json": true,
	"/api/v1/docs":              true,
}

// FallbackPermission guards any /api/v1 route the table does not name.
const FallbackPermission = "dashboard:view"

// Table is the compiled policy.
type Table struct {
	ordered []Rule
}

// NewTable compiles Rules in the Node API's order: longer patterns first,
// a trailing wildcard slightly less specific than an exact pattern of the
// same depth, and a method-specific rule before a `*` one.
func NewTable(rules []Rule) *Table {
	ordered := make([]Rule, len(rules))
	copy(ordered, rules)
	specificity := func(r Rule) int {
		s := len(strings.Split(r.Pattern, "/")) * 10
		if strings.HasSuffix(r.Pattern, "*") {
			s -= 5
		}
		return s
	}
	// Equal specificity: the JavaScript comparator answered -1 for a pair
	// of method-specific rules and +1 for a pair of `*` rules, whatever
	// their order. Under V8's binary insertion and merge that means a later
	// method-specific rule lands before an earlier one (the narrower rule
	// in every block is declared after the wide one: GET /master/* then
	// GET /master/users*), while `*` rules keep their declaration order and
	// method-specific rules precede `*` ones. Reproduced here, because the
	// golden export is what the console was built against.
	type keyed struct {
		rule Rule
		pos  int
	}
	items := make([]keyed, len(rules))
	for i, r := range rules {
		items[i] = keyed{rule: r, pos: i}
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		sa, sb := specificity(a.rule), specificity(b.rule)
		if sa != sb {
			return sa > sb
		}
		aStar, bStar := a.rule.Method == "*", b.rule.Method == "*"
		if aStar != bStar {
			return !aStar
		}
		if aStar {
			return a.pos < b.pos
		}
		return a.pos > b.pos
	})
	for i, it := range items {
		ordered[i] = it.rule
	}
	return &Table{ordered: ordered}
}

// Default is the compiled policy for Rules.
var Default = NewTable(Rules)

func matches(pattern, path string) bool {
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(path, pattern[:len(pattern)-1])
	}
	patternParts := strings.Split(pattern, "/")
	pathParts := strings.Split(path, "/")
	if len(patternParts) != len(pathParts) {
		return false
	}
	for i, part := range patternParts {
		if strings.HasPrefix(part, ":") {
			continue
		}
		if part != pathParts[i] {
			return false
		}
	}
	return true
}

// PermissionFor resolves the permission a route requires; explicit reports
// whether a rule named it or the fallback applies.
func (t *Table) PermissionFor(method, path string) (permission string, explicit bool) {
	for _, rule := range t.ordered {
		if (rule.Method == "*" || rule.Method == method) && matches(rule.Pattern, path) {
			return rule.Permission, true
		}
	}
	return FallbackPermission, false
}

// Authorize enforces the table on every request. Placed once, after the
// principal is attached, so no handler can be added later that forgets its
// guard.
func (t *Table) Authorize(enabled, docsPublic bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if !enabled || !strings.HasPrefix(path, "/api/v1") || PublicAPIPaths[path] || (DocPaths[path] && docsPublic) {
				next.ServeHTTP(w, r)
				return
			}
			p := auth.PrincipalFrom(r.Context())
			if p == nil {
				httpx.WriteError(w, r, httpx.Unauthenticated(""))
				return
			}
			required, _ := t.PermissionFor(r.Method, path)
			if !p.Has(required) {
				httpx.WriteError(w, r, httpx.Forbidden(
					"Peran "+p.Role+" tidak memiliki izin "+required+" untuk "+r.Method+" "+path+".",
				))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
