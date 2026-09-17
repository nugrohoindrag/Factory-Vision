// Package auth resolves a bearer token into the principal every guarded
// request runs as. Session issuance (login) lives in the auth module; this
// package is only the read side, which every other module depends on.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"
)

// Kind is the two front doors: a named person at a console, or a shared
// shop-floor terminal.
type Kind string

const (
	KindApplication Kind = "APPLICATION"
	KindOperator    Kind = "OPERATOR"
)

// Lifetime is a session's absolute and idle limits (US-002).
type Lifetime struct {
	Absolute time.Duration
	Idle     time.Duration
}

// Lifetimes: an operator terminal is shared hardware on a noisy shop floor,
// so its session is short-lived in absolute terms and drops quickly on
// inactivity. A console session belongs to one named person at a desk.
var Lifetimes = map[Kind]Lifetime{
	KindApplication: {Absolute: 12 * time.Hour, Idle: 60 * time.Minute},
	KindOperator:    {Absolute: 8 * time.Hour, Idle: 15 * time.Minute},
}

// Scope is the operational reach attached to a session, resolved at login
// and re-derived on every request.
type Scope struct {
	Level         string   `json:"level"` // TENANT | PLANT | LINE | WORK_CENTER
	ID            *string  `json:"id,omitempty"`
	PlantIDs      []string `json:"plantIds"`
	LineIDs       []string `json:"lineIds"`
	WorkCenterIDs []string `json:"workCenterIds"`
}

// Principal is the SessionPrincipal the console receives, field for field.
type Principal struct {
	SessionID     string   `json:"sessionId"`
	Kind          Kind     `json:"kind"`
	TenantID      string   `json:"tenantId"`
	SubjectID     string   `json:"subjectId"`
	Name          string   `json:"name"`
	Role          string   `json:"role"`
	Permissions   []string `json:"permissions"`
	Scope         Scope    `json:"scope"`
	IssuedAt      string   `json:"issuedAt"`
	ExpiresAt     string   `json:"expiresAt"`
	IdleExpiresAt string   `json:"idleExpiresAt"`
	LandingPath   string   `json:"landingPath"`
}

// Has reports whether the principal holds a permission.
func (p *Principal) Has(permission string) bool {
	for _, granted := range p.Permissions {
		if granted == permission {
			return true
		}
	}
	return false
}

// HasAny reports whether the principal holds at least one of several
// permissions, used where two roles both qualify.
func (p *Principal) HasAny(permissions ...string) bool {
	for _, permission := range permissions {
		if p.Has(permission) {
			return true
		}
	}
	return false
}

type principalKey struct{}

// WithPrincipal attaches the resolved principal to the context.
func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom reads the principal, nil for an anonymous request.
func PrincipalFrom(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey{}).(*Principal)
	return p
}

// HashToken is the SHA-256 hex the session store keys on. Only the hash is
// stored: a session that a database backup could hand to whoever reads the
// backup is not a session, it is a spare key taped to the door.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// TenantOfToken reads the `<tenantId>.<secret>` prefix. The prefix is not a
// secret and grants nothing on its own: row-level security keys on
// app.tenant_id, and a lookup by token has to know which tenant to declare
// before it can read anything.
func TenantOfToken(token string) string {
	i := strings.IndexByte(token, '.')
	if i <= 0 {
		return ""
	}
	return token[:i]
}

// NewToken mints a session token in the format the Node API issued, so a
// session created by either runtime resolves in the other.
func NewToken(tenantID string) string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return tenantID + "." + base64.RawURLEncoding.EncodeToString(b[:])
}

// NewSessionID mints `ses-<18 hex>`.
func NewSessionID() string {
	var b [9]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "ses-" + hex.EncodeToString(b[:])
}
