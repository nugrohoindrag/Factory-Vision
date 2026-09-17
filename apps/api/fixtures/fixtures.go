// Package fixtures embeds the contract tables the API is checked against.
//
// They were exported from the TypeScript implementation this API replaced,
// and froze at the cutover as the contract snapshot: the permission
// catalogue, the system-role matrix, the landing paths, the route inventory,
// the documented endpoints, the industry templates and the demo plant. The
// catalogue, the baselines and the templates are data and are read from here
// directly, so a new permission is added to permission-catalog.json (and to
// the roles that hold it in system-role-permissions.json) and backfilled by
// a migration for existing tenants. The route → permission table is policy
// and is hand-written in rbac/table.go; route-permissions.golden.json is
// what its test checks it against, so a route that changes permission
// changes the golden row too.
package fixtures

import (
	"embed"
	"encoding/json"
	"fmt"
)

//go:embed *.json
var files embed.FS

// Permission is one catalogue entry, `module:action`.
type Permission struct {
	ID          string `json:"id"`
	Module      string `json:"module"`
	Action      string `json:"action"`
	Description string `json:"description"`
	Privileged  bool   `json:"privileged"`
}

// GoldenRoute is one row of the route → permission contract.
type GoldenRoute struct {
	Method       string  `json:"method"`
	Path         string  `json:"path"`
	ConcretePath string  `json:"concretePath"`
	Public       bool    `json:"public"`
	Permission   *string `json:"permission"`
}

// Endpoint is one documented endpoint for the OpenAPI contract.
type Endpoint struct {
	Method  string `json:"method"`
	Path    string `json:"path"`
	Summary string `json:"summary"`
}

func load[T any](name string) T {
	var v T
	data, err := files.ReadFile(name)
	if err != nil {
		panic(fmt.Sprintf("fixtures: %s missing: %v", name, err))
	}
	if err := json.Unmarshal(data, &v); err != nil {
		panic(fmt.Sprintf("fixtures: %s is not valid: %v", name, err))
	}
	return v
}

// PermissionCatalog is every permission the product knows.
func PermissionCatalog() []Permission { return load[[]Permission]("permission-catalog.json") }

// SystemRolePermissions maps each system role to its baseline permissions.
func SystemRolePermissions() map[string][]string {
	return load[map[string][]string]("system-role-permissions.json")
}

// RoleLandingPaths is where each role lands after login.
func RoleLandingPaths() map[string]string { return load[map[string]string]("role-landing-paths.json") }

// RoleDescriptions is the Indonesian description of each system role.
func RoleDescriptions() map[string]string { return load[map[string]string]("role-descriptions.json") }

// PublicAPIPaths are the paths the authorizer lets past before consulting
// the table.
func PublicAPIPaths() []string { return load[[]string]("public-api-paths.json") }

// GoldenRoutes is the exported route → permission contract.
func GoldenRoutes() []GoldenRoute { return load[[]GoldenRoute]("route-permissions.golden.json") }

// Endpoints is the documented endpoint inventory.
func Endpoints() []Endpoint { return load[[]Endpoint]("endpoints.json") }
