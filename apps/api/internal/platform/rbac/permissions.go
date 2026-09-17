// Package rbac is the permission model: the catalogue, the system roles'
// baselines, and the route → permission policy the authorizer enforces.
package rbac

import (
	"strings"
	"sync"

	"github.com/nugrohoindrag/factory-vision/apps/api/fixtures"
)

// UserRole values, in the order the TypeScript enum declares them. The order
// matters where system roles are materialised for a tenant.
var SystemRoles = []string{
	"EXECUTIVE",
	"PRODUCTION_MANAGER",
	"SUPERVISOR",
	"OPERATOR",
	"PPIC",
	"QUALITY",
	"SALES",
	"MAINTENANCE",
	"WAREHOUSE",
	"WORKFORCE_ADMIN",
	"ADMIN",
}

// IsSystemRole reports whether key names one of the baseline roles.
func IsSystemRole(key string) bool {
	for _, r := range SystemRoles {
		if r == key {
			return true
		}
	}
	return false
}

var (
	once        sync.Once
	catalog     []fixtures.Permission
	catalogByID map[string]fixtures.Permission
	baseline    map[string][]string
	landing     map[string]string
	description map[string]string
)

func load() {
	once.Do(func() {
		catalog = fixtures.PermissionCatalog()
		catalogByID = make(map[string]fixtures.Permission, len(catalog))
		for _, p := range catalog {
			catalogByID[p.ID] = p
		}
		baseline = fixtures.SystemRolePermissions()
		landing = fixtures.RoleLandingPaths()
		description = fixtures.RoleDescriptions()
	})
}

// Catalog is every permission, in catalogue order.
func Catalog() []fixtures.Permission {
	load()
	return catalog
}

// PermissionIDs is the catalogue's ids, in order.
func PermissionIDs() []string {
	load()
	ids := make([]string, 0, len(catalog))
	for _, p := range catalog {
		ids = append(ids, p.ID)
	}
	return ids
}

// Known reports whether a permission id is in the catalogue.
func Known(id string) bool {
	load()
	_, ok := catalogByID[id]
	return ok
}

// IsPrivileged reports whether a permission may only be granted by a user
// who already holds it.
func IsPrivileged(id string) bool {
	load()
	return catalogByID[id].Privileged
}

// BaselinePermissions is the system role's transcribed baseline. Unknown
// roles get nothing.
func BaselinePermissions(role string) []string {
	load()
	perms := baseline[role]
	out := make([]string, len(perms))
	copy(out, perms)
	return out
}

// BaselineLandingPath is where a system role lands after login.
func BaselineLandingPath(role string) string {
	load()
	if p, ok := landing[role]; ok {
		return p
	}
	return "/"
}

// RoleDescription is the Indonesian description of a system role.
func RoleDescription(role string) string {
	load()
	return description[role]
}

// HumanizeRole turns PRODUCTION_MANAGER into "Production Manager".
func HumanizeRole(role string) string {
	parts := strings.Split(role, "_")
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = part[:1] + strings.ToLower(part[1:])
	}
	return strings.Join(parts, " ")
}

// HasPermission is the membership test the authorizer runs.
func HasPermission(granted []string, required string) bool {
	for _, p := range granted {
		if p == required {
			return true
		}
	}
	return false
}
