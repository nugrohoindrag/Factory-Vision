// Package meta serves the health probe, the deployment descriptor, and the
// documented endpoint inventory (US-054, §16).
package meta

import (
	"html"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/fixtures"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// APIVersion is the contract version in every descriptor.
const APIVersion = "v1"

// DeploymentInfo is what the console reads on load.
type DeploymentInfo struct {
	Mode       string   `json:"mode"`
	Version    string   `json:"version"`
	APIVersion string   `json:"apiVersion"`
	TenantID   *string  `json:"tenantId"`
	Features   Features `json:"features"`
	ServerTime string   `json:"serverTime"`
}

// Features advertises what this deployment supports.
type Features struct {
	MultiTenant     bool `json:"multiTenant"`
	OfflineTerminal bool `json:"offlineTerminal"`
	Realtime        bool `json:"realtime"`
}

// MountHealth registers GET /health at the root: the same body the Node API
// answered, so the compose HEALTHCHECK and every QA script keep working.
func MountHealth(r chi.Router) {
	r.Get("/health", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		return httpx.OK(w, map[string]any{
			"status": "ok",
			"time":   db.Now(),
			"tenant": tenancy.TenantID(r.Context()),
		})
	}))
}

var paramPattern = regexp.MustCompile(`:([^/]+)`)

// Mount registers the /meta routes and /docs under /api/v1.
func Mount(r chi.Router, cfg *config.Config, table *rbac.Table) {
	r.Get("/meta/deployment", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var tenant *string
		if cfg.DeploymentMode == "ON_PREMISE_SINGLE_TENANT" {
			tenant = db.Ptr(cfg.DefaultTenant)
		}
		return httpx.OK(w, DeploymentInfo{
			Mode:       cfg.DeploymentMode,
			Version:    cfg.ProductVersion,
			APIVersion: APIVersion,
			TenantID:   tenant,
			Features: Features{
				MultiTenant:     cfg.DeploymentMode == "CLOUD_MULTI_TENANT",
				OfflineTerminal: true,
				Realtime:        true,
			},
			ServerTime: db.Now(),
		})
	}))

	// Machine-readable contract: endpoints, their guard, and the error
	// shape. Generated from the same route → permission table the middleware
	// enforces, so the documentation cannot drift from the policy.
	r.Get("/meta/openapi.json", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		return httpx.OK(w, openAPI(cfg, table))
	}))

	r.Get("/docs", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, err := w.Write([]byte(docsHTML(cfg, table)))
		return err
	}))
}

func permissionFor(table *rbac.Table, method, path string) *string {
	concrete := paramPattern.ReplaceAllString(path, "x")
	if rbac.PublicAPIPaths[path] {
		return nil
	}
	perm, _ := table.PermissionFor(method, concrete)
	return &perm
}

func openAPI(cfg *config.Config, table *rbac.Table) map[string]any {
	errorRef := map[string]any{
		"content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/ApiError"}}},
	}
	paths := map[string]map[string]any{}
	for _, e := range fixtures.Endpoints() {
		openPath := paramPattern.ReplaceAllString(e.Path, "{$1}")
		if paths[openPath] == nil {
			paths[openPath] = map[string]any{}
		}
		var perm any
		if p := permissionFor(table, e.Method, e.Path); p != nil {
			perm = *p
		}
		paths[openPath][strings.ToLower(e.Method)] = map[string]any{
			"summary":      e.Summary,
			"x-permission": perm,
			"responses": map[string]any{
				"200": map[string]any{"description": "OK"},
				"401": withDescription(errorRef, "Unauthenticated"),
				"403": withDescription(errorRef, "Forbidden / out of scope"),
				"422": withDescription(errorRef, "Validation error"),
			},
		}
	}
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":   "Factory Vision MES API",
			"version": cfg.ProductVersion,
			"description": "MES untuk manufaktur mid-market Indonesia. Semua endpoint berada di bawah /api/v1 " +
				"dan menggunakan struktur error yang seragam.",
		},
		"servers": []map[string]any{{"url": "/", "description": "Current deployment"}},
		"components": map[string]any{
			"securitySchemes": map[string]any{"bearerAuth": map[string]any{"type": "http", "scheme": "bearer"}},
			"schemas": map[string]any{
				"ApiError": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"error": map[string]any{
							"type":     "object",
							"required": []string{"code", "message", "requestId"},
							"properties": map[string]any{
								"code": map[string]any{"type": "string", "enum": []string{
									"VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "OUT_OF_SCOPE", "NOT_FOUND",
									"CONFLICT", "INVALID_STATE", "RATE_LIMITED", "INTERNAL_ERROR",
								}},
								"message":   map[string]any{"type": "string"},
								"requestId": map[string]any{"type": "string"},
								"fields": map[string]any{"type": "array", "items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"field": map[string]any{"type": "string"}, "code": map[string]any{"type": "string"}, "message": map[string]any{"type": "string"},
									},
								}},
							},
						},
					},
				},
				"Pagination": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"data": map[string]any{"type": "array", "items": map[string]any{}},
						"page": map[string]any{"type": "object", "properties": map[string]any{
							"number": map[string]any{"type": "integer"}, "size": map[string]any{"type": "integer"},
							"totalItems": map[string]any{"type": "integer"}, "totalPages": map[string]any{"type": "integer"},
						}},
					},
				},
			},
			"parameters": map[string]any{
				"page":     map[string]any{"name": "page", "in": "query", "schema": map[string]any{"type": "integer", "minimum": 1}},
				"pageSize": map[string]any{"name": "pageSize", "in": "query", "schema": map[string]any{"type": "integer", "minimum": 1, "maximum": 500}},
				"sort":     map[string]any{"name": "sort", "in": "query", "schema": map[string]any{"type": "string"}},
				"order":    map[string]any{"name": "order", "in": "query", "schema": map[string]any{"type": "string", "enum": []string{"asc", "desc"}}},
			},
		},
		"security":      []map[string]any{{"bearerAuth": []string{}}},
		"paths":         paths,
		"x-permissions": rbac.Catalog(),
	}
}

func withDescription(ref map[string]any, description string) map[string]any {
	out := map[string]any{"description": description}
	for k, v := range ref {
		out[k] = v
	}
	return out
}

func docsHTML(cfg *config.Config, table *rbac.Table) string {
	var rows strings.Builder
	for _, e := range fixtures.Endpoints() {
		perm := "-"
		if p := permissionFor(table, e.Method, e.Path); p != nil {
			perm = *p
		}
		rows.WriteString("<tr><td>" + e.Method + "</td><td><code>" + html.EscapeString(e.Path) + "</code></td><td>" +
			html.EscapeString(e.Summary) + "</td><td><code>" + perm + "</code></td></tr>\n")
	}
	return `<!doctype html><meta charset="utf-8"><title>Factory Vision MES API ` + APIVersion + `</title>` +
		`<style>body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.5}` +
		`table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.4rem.6rem;text-align:left;font-size:14px}` +
		`th{background:#f3f4f6}code{font-family:ui-monospace,monospace}</style>` +
		`<h1>Factory Vision MES API</h1><p>Versi ` + cfg.ProductVersion + `, kontrak mesin: <a href="/api/v1/meta/openapi.json">openapi.json</a></p>` +
		`<p>Semua endpoint memerlukan header <code>Authorization: Bearer &lt;token&gt;</code> kecuali endpoint login. ` +
		`Kesalahan selalu memakai struktur <code>{ "error": { "code", "message", "fields?", "requestId" } }</code>. ` +
		`Endpoint list yang mendukung paginasi menerima <code>page</code>, <code>pageSize</code>, <code>sort</code>, <code>order</code>.</p>` +
		`<table><thead><tr><th>Method</th><th>Path</th><th>Ringkasan</th><th>Permission</th></tr></thead><tbody>` + rows.String() + `</tbody></table>`
}
