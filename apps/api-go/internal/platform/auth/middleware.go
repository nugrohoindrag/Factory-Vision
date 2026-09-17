package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// TokenResolver is what the middleware needs from the resolver.
type TokenResolver interface {
	Resolve(ctx context.Context, token string) (*Principal, error)
}

// AttachPrincipal resolves the bearer token into a principal (US-001,
// US-002). Attaching is separate from requiring so a public endpoint can
// still see who is calling, and so the tenant context is corrected from the
// session rather than trusting the X-Tenant-Id header.
func AttachPrincipal(resolver TokenResolver, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := BearerToken(r)
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}
			principal, err := resolver.Resolve(r.Context(), token)
			if err != nil {
				// A failure here must not become a 500 on a protected route:
				// no principal is attached, and the guard answers 401.
				if !errors.Is(err, ErrNoSession) {
					log.Warn("auth: session lookup failed", "error", err)
				}
				next.ServeHTTP(w, r)
				return
			}
			ctx := WithPrincipal(r.Context(), principal)
			// The session is the authority on tenancy. A caller cannot widen
			// its reach by sending a different X-Tenant-Id.
			ctx = tenancy.With(ctx, tenancy.Context{
				TenantID: principal.TenantID,
				UserID:   principal.SubjectID,
				UserRole: principal.Role,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// BearerToken reads the Authorization header, empty when absent.
func BearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}

// RequirePermission guards a route with one permission. When authentication
// is switched off (AUTH_REQUIRED=false on a demo install) the guard steps
// aside rather than pretending everyone is an admin.
func RequirePermission(permission string, enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !enabled {
				next.ServeHTTP(w, r)
				return
			}
			p := PrincipalFrom(r.Context())
			if p == nil {
				httpx.WriteError(w, r, httpx.Unauthenticated(""))
				return
			}
			if !p.Has(permission) {
				httpx.WriteError(w, r, httpx.Forbidden("Peran "+p.Role+" tidak memiliki izin "+permission+"."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyPermission requires any one of several permissions.
func RequireAnyPermission(permissions []string, enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !enabled {
				next.ServeHTTP(w, r)
				return
			}
			p := PrincipalFrom(r.Context())
			if p == nil {
				httpx.WriteError(w, r, httpx.Unauthenticated(""))
				return
			}
			if !p.HasAny(permissions...) {
				httpx.WriteError(w, r, httpx.Forbidden("Peran "+p.Role+" tidak memiliki izin yang diperlukan."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ActorID is who a mutation is recorded against: the principal when there
// is one, else the demo-mode header, else "system".
func ActorID(ctx context.Context) string {
	if p := PrincipalFrom(ctx); p != nil {
		return p.SubjectID
	}
	if t := tenancy.From(ctx); t.UserID != "" {
		return t.UserID
	}
	return "system"
}

// ActorType is USER or OPERATOR for the audit trail.
func ActorType(ctx context.Context) string {
	if p := PrincipalFrom(ctx); p != nil && p.Kind == KindOperator {
		return "OPERATOR"
	}
	return "USER"
}
