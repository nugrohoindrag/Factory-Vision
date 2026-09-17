package masterdata

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Credentials is what the user routes need from the identity module:
// setting an initial password and dropping sessions when access changes.
type Credentials interface {
	RegisterUserPassword(ctx context.Context, tenantID, userID, password string) error
	RevokeSessions(ctx context.Context, tenantID string, sessionID, subjectID *string, actorID string) (int, error)
}

// Handler mounts the /master routes.
type Handler struct {
	svc    *Service
	audit  audit.Recorder
	creds  Credentials
	events *security.Events
}

// NewHandler wires the routes' dependencies.
func NewHandler(svc *Service, auditor audit.Recorder, creds Credentials, events *security.Events) *Handler {
	return &Handler{svc: svc, audit: auditor, creds: creds, events: events}
}

type deleted struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func tenant(r *http.Request) string { return tenancy.TenantID(r.Context()) }

func param(r *http.Request, name string) string { return chi.URLParam(r, name) }

// record writes an audit entry for a change that has already committed.
func (h *Handler) record(r *http.Request, entityType, entityID, action string, previous, next any) {
	h.audit.RecordDetached(audit.FromRequest(r, entityType, entityID, action, previous, next))
}

// Mount registers every /master route under /api/v1.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/master/plants", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		plants, err := h.svc.Plants(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, plants)
	}))

	h.mountLines(r)
	h.mountWorkCenters(r)
	h.mountMachines(r)
	h.mountProducts(r)
	h.mountBom(r)
	h.mountOperators(r)
	h.mountReasons(r)
	h.mountUsers(r)
	h.mountDevices(r)
	h.mountProcesses(r)
	h.mountRoutings(r)
	h.mountRates(r)
	h.mountKpiTargets(r)

	r.Get("/master/shifts", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		shifts, err := h.svc.Shifts(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, shifts)
	}))
}

// crud wires the common list/create/update/delete shape for a reference
// entity, so the sixty routes read as a table rather than as sixty copies.
type crud[T any] struct {
	path       string
	entity     string // audit entity type
	message    string // delete confirmation
	list       func(r *http.Request) (any, error)
	create     func(ctx context.Context, tenantID string, body Patch) (T, error)
	update     func(ctx context.Context, tenantID, id string, body Patch) (T, error)
	remove     func(ctx context.Context, tenantID, id string) error
	idOf       func(T) string
	auditWrite bool
}

func mountCrud[T any](r chi.Router, h *Handler, c crud[T]) {
	r.Get(c.path, httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := c.list(r)
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))
	r.Post(c.path, httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		created, err := c.create(r.Context(), tenant(r), body)
		if err != nil {
			return err
		}
		if c.auditWrite {
			h.record(r, c.entity, c.idOf(created), "CREATE", nil, created)
		}
		return httpx.Created(w, created)
	}))
	r.Put(c.path+"/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		updated, err := c.update(r.Context(), tenant(r), param(r, "id"), body)
		if err != nil {
			return err
		}
		if c.auditWrite {
			h.record(r, c.entity, c.idOf(updated), "UPDATE", nil, updated)
		}
		return httpx.OK(w, updated)
	}))
	r.Delete(c.path+"/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := c.remove(r.Context(), tenant(r), param(r, "id")); err != nil {
			return err
		}
		if c.auditWrite {
			h.record(r, c.entity, param(r, "id"), "DELETE", nil, nil)
		}
		return httpx.OK(w, deleted{Success: true, Message: c.message})
	}))
}

func (h *Handler) mountLines(r chi.Router) {
	mountCrud(r, h, crud[Line]{
		path: "/master/lines", entity: "production_line", message: "Production line deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.Lines(r.Context(), tenant(r)) },
		create: h.svc.CreateLine, update: h.svc.UpdateLine, remove: h.svc.DeleteLine,
		idOf: func(l Line) string { return l.ID }, auditWrite: true,
	})
}

func (h *Handler) mountMachines(r chi.Router) {
	mountCrud(r, h, crud[Machine]{
		path: "/master/machines", entity: "machine", message: "Machine deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.Machines(r.Context(), tenant(r)) },
		create: h.svc.CreateMachine, update: h.svc.UpdateMachine, remove: h.svc.DeleteMachine,
		idOf: func(m Machine) string { return m.ID }, auditWrite: true,
	})
}

func (h *Handler) mountProducts(r chi.Router) {
	mountCrud(r, h, crud[Product]{
		path: "/master/products", entity: "product", message: "Product deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.Products(r.Context(), tenant(r)) },
		create: h.svc.CreateProduct, update: h.svc.UpdateProduct, remove: h.svc.DeleteProduct,
		idOf: func(p Product) string { return p.ID }, auditWrite: true,
	})
}

func (h *Handler) mountOperators(r chi.Router) {
	mountCrud(r, h, crud[Operator]{
		path: "/master/operators", entity: "operator", message: "Operator deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.Operators(r.Context(), tenant(r)) },
		create: h.svc.CreateOperator, update: h.svc.UpdateOperator, remove: h.svc.DeleteOperator,
		idOf: func(o Operator) string { return o.ID }, auditWrite: true,
	})
}

func (h *Handler) mountReasons(r chi.Router) {
	mountCrud(r, h, crud[DowntimeReason]{
		path: "/master/downtime-reasons", entity: "downtime_reason", message: "Downtime reason deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.DowntimeReasons(r.Context(), tenant(r)) },
		create: h.svc.CreateDowntimeReason, update: h.svc.UpdateDowntimeReason, remove: h.svc.DeleteDowntimeReason,
		idOf: func(d DowntimeReason) string { return d.ID }, auditWrite: true,
	})
	mountCrud(r, h, crud[RejectReason]{
		path: "/master/reject-reasons", entity: "reject_reason", message: "Reject reason deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.RejectReasons(r.Context(), tenant(r)) },
		create: h.svc.CreateRejectReason, update: h.svc.UpdateRejectReason, remove: h.svc.DeleteRejectReason,
		idOf: func(d RejectReason) string { return d.ID }, auditWrite: true,
	})
}

func (h *Handler) mountDevices(r chi.Router) {
	// Devices carry their own audit action names.
	r.Get("/master/devices", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		devices, err := h.svc.Devices(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, devices)
	}))
	r.Post("/master/devices", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		device, err := h.svc.CreateDevice(r.Context(), tenant(r), body)
		if err != nil {
			return err
		}
		h.record(r, "device_terminal", device.ID, "REGISTER_DEVICE", nil, device)
		return httpx.Created(w, device)
	}))
	r.Put("/master/devices/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		device, err := h.svc.UpdateDevice(r.Context(), tenant(r), param(r, "id"), body)
		if err != nil {
			return err
		}
		h.record(r, "device_terminal", device.ID, "UPDATE_DEVICE", nil, device)
		return httpx.OK(w, device)
	}))
	r.Delete("/master/devices/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.DeleteDevice(r.Context(), tenant(r), param(r, "id")); err != nil {
			return err
		}
		h.record(r, "device_terminal", param(r, "id"), "DELETE_DEVICE", nil, nil)
		return httpx.OK(w, deleted{Success: true, Message: "Device deleted successfully"})
	}))
}

func (h *Handler) mountProcesses(r chi.Router) {
	mountCrud(r, h, crud[Process]{
		path: "/master/processes", entity: "production_process", message: "Production process deleted successfully",
		list:   func(r *http.Request) (any, error) { return h.svc.Processes(r.Context(), tenant(r)) },
		create: h.svc.CreateProcess, update: h.svc.UpdateProcess, remove: h.svc.DeleteProcess,
		idOf: func(p Process) string { return p.ID },
	})
}

func (h *Handler) mountRoutings(r chi.Router) {
	mountCrud(r, h, crud[Routing]{
		path: "/master/routings", entity: "product_routing", message: "Product routing deleted successfully",
		list: func(r *http.Request) (any, error) {
			return h.svc.Routings(r.Context(), tenant(r), httpx.QueryStr(r, "productId"))
		},
		create: h.svc.CreateRouting, update: h.svc.UpdateRouting, remove: h.svc.DeleteRouting,
		idOf: func(rt Routing) string { return rt.ID },
	})
}

func (h *Handler) mountRates(r chi.Router) {
	r.Get("/master/machine-rates", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rates, err := h.svc.Rates(r.Context(), tenant(r), httpx.QueryStr(r, "productId"), httpx.QueryStr(r, "machineId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, rates)
	}))
	r.Post("/master/machine-rates", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		rate, err := h.svc.UpsertRate(r.Context(), tenant(r), body)
		if err != nil {
			return err
		}
		return httpx.Created(w, rate)
	}))
	r.Delete("/master/machine-rates/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.DeleteRate(r.Context(), tenant(r), param(r, "id")); err != nil {
			return err
		}
		return httpx.OK(w, deleted{Success: true, Message: "Product machine rate deleted successfully"})
	}))
}

func (h *Handler) mountKpiTargets(r chi.Router) {
	r.Get("/master/kpi-targets", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		targets, err := h.svc.KpiTargets(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, targets)
	}))
	r.Put("/master/kpi-targets/{metric}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		target, err := h.svc.UpsertKpiTarget(r.Context(), tenant(r), param(r, "metric"), body)
		if err != nil {
			return err
		}
		return httpx.OK(w, target)
	}))
}

// mountWorkCenters is US-007: the work centre completes the plant
// hierarchy, and creating one is checked against the session's line scope.
func (h *Handler) mountWorkCenters(r chi.Router) {
	r.Get("/master/work-centers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		wcs, err := h.svc.WorkCenters(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, wcs)
	}))
	r.Post("/master/work-centers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		lineID := v.String("productionLineId", httpx.Opt{})
		code := v.String("code", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(40)})
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(80)})
		sequence := v.Int("sequence", httpx.Opt{Min: httpx.Min(1), Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		if err := auth.AssertLine(auth.PrincipalFrom(r.Context()), *lineID); err != nil {
			return err
		}
		wc := WorkCenter{ProductionLineID: *lineID, Code: *code, Name: *name, Sequence: 1}
		if sequence != nil {
			wc.Sequence = *sequence
		}
		created, err := h.svc.CreateWorkCenter(r.Context(), tenant(r), wc)
		if err != nil {
			return err
		}
		h.record(r, "work_center", created.ID, "CREATE", nil, created)
		return httpx.Created(w, created)
	}))
	r.Put("/master/work-centers/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		before, err := h.svc.WorkCenterByID(r.Context(), tenant(r), param(r, "id"))
		if err != nil {
			return err
		}
		updated, err := h.svc.UpdateWorkCenter(r.Context(), tenant(r), param(r, "id"), body)
		if err != nil {
			return err
		}
		h.record(r, "work_center", param(r, "id"), "UPDATE", before, updated)
		return httpx.OK(w, updated)
	}))
	r.Delete("/master/work-centers/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		before, err := h.svc.WorkCenterByID(r.Context(), tenant(r), param(r, "id"))
		if err != nil {
			return err
		}
		if err := h.svc.DeleteWorkCenter(r.Context(), tenant(r), param(r, "id")); err != nil {
			return err
		}
		h.record(r, "work_center", param(r, "id"), "DELETE", before, nil)
		return httpx.OK(w, deleted{Success: true, Message: "Work center dihapus."})
	}))
}

func (h *Handler) mountBom(r chi.Router) {
	actor := func(r *http.Request) string {
		if t := tenancy.From(r.Context()); t.UserID != "" {
			return t.UserID
		}
		return "Admin"
	}
	r.Get("/master/bom", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		boms, err := h.svc.FilterBoms(r.Context(), tenant(r), BomFilter{
			ProductID: httpx.QueryStr(r, "productId"), Status: httpx.QueryStr(r, "status"), Search: httpx.QueryStr(r, "search"),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, boms)
	}))
	r.Get("/master/bom/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		bom, err := h.svc.BomByID(r.Context(), tenant(r), param(r, "id"))
		if err != nil {
			return err
		}
		if bom == nil {
			return httpx.NotFound("Bill of Material not found")
		}
		return httpx.OK(w, bom)
	}))
	r.Post("/master/bom", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in CreateBomInput
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		bom, err := h.svc.CreateBom(r.Context(), tenant(r), in, actor(r))
		if err != nil {
			return err
		}
		h.record(r, "bill_of_material", bom.ID, "CREATE", nil, bom)
		return httpx.Created(w, bom)
	}))
	r.Put("/master/bom/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in UpdateBomInput
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		bom, err := h.svc.UpdateBom(r.Context(), tenant(r), param(r, "id"), in, actor(r))
		if err != nil {
			return err
		}
		h.record(r, "bill_of_material", bom.ID, "UPDATE", nil, bom)
		return httpx.OK(w, bom)
	}))
	r.Patch("/master/bom/{id}/status", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		status, _ := body["status"].(string)
		if status == "" {
			return httpx.Validation("Status is required", httpx.FieldError{Field: "status", Code: "REQUIRED", Message: "Status is required"})
		}
		bom, err := h.svc.SetBomStatus(r.Context(), tenant(r), param(r, "id"), status, actor(r))
		if err != nil {
			return err
		}
		h.record(r, "bill_of_material", bom.ID, "STATUS_CHANGE", nil, map[string]any{"status": status})
		return httpx.OK(w, bom)
	}))
	r.Delete("/master/bom/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.DeleteBom(r.Context(), tenant(r), param(r, "id")); err != nil {
			return err
		}
		h.record(r, "bill_of_material", param(r, "id"), "DELETE", nil, nil)
		return httpx.OK(w, deleted{Success: true, Message: "Bill of Material deleted successfully"})
	}))
}

func (h *Handler) mountUsers(r chi.Router) {
	r.Get("/master/users", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		users, err := h.svc.Users(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, users)
	}))
	r.Get("/master/users/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, err := h.svc.UserByID(r.Context(), tenant(r), param(r, "id"))
		if err != nil {
			return err
		}
		if user == nil {
			return httpx.NotFound("User not found")
		}
		return httpx.OK(w, user)
	}))

	// US-004: an initial password may be supplied so the account can be used
	// immediately; it is hashed by the identity module and never stored on
	// the user record, which the console reads freely.
	r.Post("/master/users", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		email := v.Email("email", httpx.Opt{})
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(120)})
		role := v.OneOf("role", rbac.SystemRoles, httpx.Opt{})
		scopeLevel := v.OneOf("scopeLevel", []string{"TENANT", "PLANT", "LINE", "WORK_CENTER"}, httpx.Opt{Optional: true})
		scopeID := v.String("scopeId", httpx.Opt{Optional: true})
		password := v.String("password", httpx.Opt{Optional: true, Min: httpx.Min(8)})
		if err := v.Done(); err != nil {
			return err
		}
		exists, err := h.svc.EmailExists(r.Context(), tenantID, *email)
		if err != nil {
			return err
		}
		if exists {
			return httpx.Conflict("Email tersebut sudah terdaftar.")
		}
		if scopeLevel != nil && *scopeLevel != "TENANT" && scopeID == nil {
			return httpx.Validation("Scope ID wajib diisi untuk scope selain TENANT.", httpx.FieldError{
				Field: "scopeId", Code: "REQUIRED", Message: "Pilih plant, line, atau work center.",
			})
		}
		// Built field by field rather than spreading the request: spreading
		// would carry the password onto the stored record and straight back
		// out in the response.
		user := User{
			Email: *email, Name: *name, Role: *role,
			AccountType: "APPLICATION_USER", ScopeLevel: "TENANT", ScopeID: scopeID, Status: "INVITED",
		}
		if body["accountType"] == "OPERATOR" {
			user.AccountType = "OPERATOR"
		}
		if scopeLevel != nil {
			user.ScopeLevel = *scopeLevel
		}
		if en, ok := body["employeeNumber"].(string); ok && en != "" {
			user.EmployeeNumber = &en
		}
		if body["status"] == "ACTIVE" {
			user.Status = "ACTIVE"
		}
		created, err := h.svc.CreateUser(r.Context(), tenantID, user, nil)
		if err != nil {
			return err
		}
		if password != nil {
			if err := h.creds.RegisterUserPassword(r.Context(), tenantID, created.ID, *password); err != nil {
				return err
			}
		}
		h.record(r, "app_user", created.ID, "CREATE_USER", nil, map[string]any{
			"email": created.Email, "role": created.Role, "scopeLevel": created.ScopeLevel,
			"scopeId": created.ScopeID, "status": created.Status,
		})
		return httpx.Created(w, created)
	}))

	r.Put("/master/users/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		before, err := h.svc.UserByID(r.Context(), tenantID, param(r, "id"))
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Pengguna tidak ditemukan.")
		}
		previous := map[string]any{"role": before.Role, "scopeLevel": before.ScopeLevel, "scopeId": before.ScopeID, "status": before.Status}
		user, err := h.svc.UpdateUser(r.Context(), tenantID, param(r, "id"), body)
		if err != nil {
			return err
		}
		// A role change and a scope change are recorded as different
		// actions; the specific action is what makes the audit trail
		// answerable later.
		roleChanged := before.Role != user.Role
		scopeChanged := before.ScopeLevel != user.ScopeLevel || !equalPtr(before.ScopeID, user.ScopeID)
		action := "UPDATE_USER"
		if roleChanged {
			action = "ROLE_CHANGED"
		} else if scopeChanged {
			action = "SCOPE_CHANGED"
		}
		h.record(r, "app_user", user.ID, action, previous, map[string]any{
			"role": user.Role, "scopeLevel": user.ScopeLevel, "scopeId": user.ScopeID, "status": user.Status,
		})
		// §43: handing out administrator is the change most worth noticing
		// on the day it happens, not at the next audit.
		if roleChanged && strings.ToUpper(user.Role) == "ADMIN" {
			h.events.Record(security.Event{
				Type: "ADMIN_ROLE_ASSIGNED", Severity: security.SeverityCritical,
				Message:  user.Email + " sekarang berperan ADMIN (sebelumnya " + before.Role + ").",
				TenantID: tenantID, Actor: auth.ActorID(r.Context()), IP: httpx.ClientIP(r),
				Detail: map[string]any{"userId": user.ID, "previousRole": before.Role},
			})
		}
		// A narrowed scope or a different role must take effect now, not at
		// the user's next login.
		if roleChanged || scopeChanged {
			if _, err := h.creds.RevokeSessions(r.Context(), tenantID, nil, &user.ID, auth.ActorID(r.Context())); err != nil {
				return err
			}
		}
		return httpx.OK(w, user)
	}))

	r.Delete("/master/users/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		before, err := h.svc.UserByID(r.Context(), tenantID, param(r, "id"))
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Pengguna tidak ditemukan.")
		}
		if err := h.svc.DeleteUser(r.Context(), tenantID, param(r, "id")); err != nil {
			return err
		}
		id := param(r, "id")
		if _, err := h.creds.RevokeSessions(r.Context(), tenantID, nil, &id, auth.ActorID(r.Context())); err != nil {
			return err
		}
		h.record(r, "app_user", id, "DELETE_USER", map[string]any{"email": before.Email, "role": before.Role}, nil)
		return httpx.OK(w, deleted{Success: true, Message: "Pengguna dihapus."})
	}))

	// US-005: activate, suspend or deactivate, then drop live sessions.
	r.Patch("/master/users/{id}/status", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		status := v.OneOf("status", []string{"INVITED", "ACTIVE", "SUSPENDED", "INACTIVE"}, httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		before, err := h.svc.UserByID(r.Context(), tenantID, param(r, "id"))
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Pengguna tidak ditemukan.")
		}
		user, err := h.svc.UpdateUserStatus(r.Context(), tenantID, param(r, "id"), *status)
		if err != nil {
			return err
		}
		action := "USER_DEACTIVATED"
		switch *status {
		case "ACTIVE":
			action = "USER_ACTIVATED"
		case "SUSPENDED":
			action = "USER_SUSPENDED"
		}
		h.record(r, "app_user", user.ID, action, map[string]any{"status": before.Status}, map[string]any{"status": user.Status})
		// Changing status only stops the next login; the session already
		// issued has to be revoked for access to actually end.
		revoked := 0
		if *status != "ACTIVE" {
			if revoked, err = h.creds.RevokeSessions(r.Context(), tenantID, nil, &user.ID, auth.ActorID(r.Context())); err != nil {
				return err
			}
		}
		return httpx.OK(w, userWithRevoked{User: user, RevokedSessions: revoked})
	}))
}

type userWithRevoked struct {
	User
	RevokedSessions int `json:"revokedSessions"`
}

func equalPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
