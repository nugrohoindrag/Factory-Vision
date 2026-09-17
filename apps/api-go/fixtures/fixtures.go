// Package fixtures embeds the tables exported from the TypeScript API by
// apps/api/scripts/export-go-fixtures.mjs.
//
// The permission catalogue, the system-role matrix and the landing paths are
// data, not policy, so they are read from here directly. The route →
// permission table is policy and is hand-written in rbac/table.go; the
// golden file here is what its test checks it against. Regenerate with:
//
//	node --import tsx apps/api/scripts/export-go-fixtures.mjs
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
		panic(fmt.Sprintf("fixtures: %s missing; run export-go-fixtures.mjs: %v", name, err))
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
