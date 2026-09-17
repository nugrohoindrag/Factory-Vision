// Package tenancy carries the request's tenant through the context.
//
// The tenant comes from one of two places. With authentication on, the
// session is the authority and a caller cannot widen its reach by sending a
// different X-Tenant-Id. With authentication off (a local demo), the header
// or the configured default tenant is trusted, along with the X-User-Id and
// X-User-Role headers the Node API accepted on that path.
package tenancy

import (
	"context"
	"net/http"
)

// Context is what every handler reads to know whose data it is touching.
type Context struct {
	TenantID string
	UserID   string
	UserRole string
}

type key struct{}

// FromHeaders is the middleware that resolves the tenant before any
// principal has been attached.
func FromHeaders(defaultTenant string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tenant := r.Header.Get("X-Tenant-Id")
			if tenant == "" {
				tenant = defaultTenant
			}
			ctx := Context{
				TenantID: tenant,
				UserID:   orDefault(r.Header.Get("X-User-Id"), "user-default"),
				UserRole: orDefault(r.Header.Get("X-User-Role"), "SUPERVISOR"),
			}
			next.ServeHTTP(w, r.WithContext(With(r.Context(), ctx)))
		})
	}
}

// With stores the tenant context.
func With(ctx context.Context, c Context) context.Context {
	return context.WithValue(ctx, key{}, c)
}

// From reads the tenant context; the zero value when none was set.
func From(ctx context.Context) Context {
	c, _ := ctx.Value(key{}).(Context)
	return c
}

// TenantID is the shortcut every handler uses.
func TenantID(ctx context.Context) string { return From(ctx).TenantID }

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
