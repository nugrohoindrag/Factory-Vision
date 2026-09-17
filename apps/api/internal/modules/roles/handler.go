package roles

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// Mount registers /permissions and /roles (US-006). Every mutation is
// audited: a permission grant is exactly the kind of change that needs an
// actor's name attached forever.
func Mount(r chi.Router, s *Service, auditor audit.Recorder, events *security.Events) {
	grantedBy := func(r *http.Request) []string {
		if p := auth.PrincipalFrom(r.Context()); p != nil {
			return p.Permissions
		}
		// Authentication off: the demo caller may grant anything.
		return rbac.PermissionIDs()
	}

	r.Get("/permissions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		return httpx.OK(w, rbac.Catalog())
	}))

	r.Get("/roles", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		roles, err := s.Roles(r.Context(), tenancy.TenantID(r.Context()))
		if err != nil {
			return err
		}
		return httpx.OK(w, roles)
	}))

	r.Get("/roles/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		role, err := s.Role(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, role)
	}))

	r.Post("/roles", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		key := v.String("key", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(40)})
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(60)})
		description := v.String("description", httpx.Opt{Optional: true, Max: httpx.Max(240)})
		permissions := v.StringArray("permissions", httpx.Opt{})
		landingPath := v.String("landingPath", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		tenantID := tenancy.TenantID(r.Context())
		role, err := s.Create(r.Context(), tenantID, CreateInput{
			Key: *key, Name: *name, Description: description, Permissions: permissions, LandingPath: landingPath,
		}, grantedBy(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "role", role.ID, "ROLE_CREATED", nil,
			map[string]any{"key": role.Key, "permissions": role.Permissions})); err != nil {
			return err
		}
		return httpx.Created(w, role)
	}))

	r.Put("/roles/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenancy.TenantID(r.Context())
		before, err := s.Role(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		previous := map[string]any{"name": before.Name, "permissions": append([]string(nil), before.Permissions...)}

		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		name := v.String("name", httpx.Opt{Optional: true, Min: httpx.Min(2), Max: httpx.Max(60)})
		description := v.String("description", httpx.Opt{Optional: true, Max: httpx.Max(240)})
		permissions := v.StringArray("permissions", httpx.Opt{Optional: true})
		landingPath := v.String("landingPath", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		role, err := s.Update(r.Context(), tenantID, chi.URLParam(r, "id"), UpdateInput{
			Name: name, Description: description, Permissions: permissions, LandingPath: landingPath,
		}, grantedBy(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "role", role.ID, "PERMISSION_CHANGED", previous,
			map[string]any{"name": role.Name, "permissions": role.Permissions})); err != nil {
			return err
		}
		// §43: what a role may do is the definition of who can do what, so a
		// change to it is alertable, not merely recorded.
		added, removed := diff(before.Permissions, role.Permissions)
		if len(added) > 0 || len(removed) > 0 {
			events.Record(security.Event{
				Type: "PERMISSION_CHANGED", Severity: security.SeverityWarning,
				Message:  fmt.Sprintf("Peran %s: %d izin ditambahkan, %d dicabut.", role.Name, len(added), len(removed)),
				TenantID: tenantID, Actor: auth.ActorID(r.Context()), IP: httpx.ClientIP(r),
				Detail: map[string]any{"roleId": role.ID, "added": added, "removed": removed},
			})
		}
		return httpx.OK(w, role)
	}))

	r.Delete("/roles/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenancy.TenantID(r.Context())
		role, err := s.Role(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		result, err := s.Delete(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "role", role.ID, "ROLE_DELETED",
			map[string]any{"key": role.Key, "permissions": role.Permissions}, nil)); err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))
}

func diff(before, after []string) (added, removed []string) {
	added, removed = []string{}, []string{}
	was := map[string]bool{}
	for _, p := range before {
		was[p] = true
	}
	is := map[string]bool{}
	for _, p := range after {
		is[p] = true
		if !was[p] {
			added = append(added, p)
		}
	}
	for _, p := range before {
		if !is[p] {
			removed = append(removed, p)
		}
	}
	return added, removed
}
