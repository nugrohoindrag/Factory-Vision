package auth

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"golang.org/x/sync/singleflight"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// How long a resolved session may be answered from memory before the store
// is consulted again, and how often the idle window is written back. Ten
// seconds is the window in which a revocation made elsewhere is still
// honoured here; sixty seconds of write throttling keeps the shop floor's
// capture path free of a database write per request.
const (
	CacheTTL      = 10 * time.Second
	TouchInterval = 60 * time.Second
)

// StoredSession is a row of app_session as the resolver needs it.
type StoredSession struct {
	Principal  Principal
	LastSeenAt string
	IP         *string
	UserAgent  *string
}

// SessionStore is the durable half of authentication (app_session).
type SessionStore interface {
	FindByToken(ctx context.Context, token string) (*StoredSession, error)
	Touch(ctx context.Context, tenantID, sessionID, idleExpiresAt string) error
	Delete(ctx context.Context, tenantID, sessionID string) error
}

// Subject is what the resolver needs to know about the account behind a
// session, re-read on every resolve so a role change or a suspension takes
// effect on the next request rather than at the next login.
type Subject struct {
	ID         string
	Status     string
	Role       string
	ScopeLevel string
	ScopeID    *string
}

// SubjectSource reads users and operators.
type SubjectSource interface {
	UserByID(ctx context.Context, tenantID, userID string) (*Subject, error)
	OperatorByID(ctx context.Context, tenantID, operatorID string) (*Subject, error)
}

// RoleSource resolves what a role may do and how far it reaches.
type RoleSource interface {
	PermissionsFor(ctx context.Context, tenantID, role string) ([]string, error)
	ResolveScope(ctx context.Context, tenantID, level string, scopeID *string) (Scope, error)
}

// Resolver turns a bearer token into a live principal.
type Resolver struct {
	sessions SessionStore
	subjects SubjectSource
	roles    RoleSource
	cache    *ristretto.Cache[string, *entry]
	flight   singleflight.Group
	detached *async.Runner
	log      *slog.Logger
	now      func() time.Time
}

type entry struct {
	session   *StoredSession
	touchedAt atomic.Int64 // unix ms of the last write-back
}

// ErrNoSession is returned for anything expired, revoked or unknown; the
// caller decides whether that is a 401 or an anonymous request.
var ErrNoSession = errors.New("auth: no live session")

// NewResolver builds the resolver with its 10-second read-through cache.
func NewResolver(sessions SessionStore, subjects SubjectSource, roles RoleSource, detached *async.Runner, log *slog.Logger) (*Resolver, error) {
	cache, err := ristretto.NewCache(&ristretto.Config[string, *entry]{
		NumCounters: 100_000,
		MaxCost:     10_000,
		BufferItems: 64,
	})
	if err != nil {
		return nil, err
	}
	if log == nil {
		log = slog.Default()
	}
	return &Resolver{
		sessions: sessions, subjects: subjects, roles: roles,
		cache: cache, detached: detached, log: log, now: time.Now,
	}, nil
}

// Resolve reproduces AuthService.resolve: store is the authority, cache in
// front of it, role/permission/scope re-derived every call, idle window
// slid forward on a throttle.
func (r *Resolver) Resolve(ctx context.Context, token string) (*Principal, error) {
	key := HashToken(token)
	now := r.now()

	ent, found := r.cache.Get(key)
	if !found {
		loaded, err, _ := r.flight.Do(key, func() (any, error) {
			session, err := r.sessions.FindByToken(ctx, token)
			if err != nil {
				return nil, err
			}
			if session == nil {
				return nil, ErrNoSession
			}
			e := &entry{session: session}
			r.cache.SetWithTTL(key, e, 1, CacheTTL)
			return e, nil
		})
		if err != nil {
			if errors.Is(err, ErrNoSession) {
				r.cache.Del(key)
			}
			return nil, err
		}
		ent = loaded.(*entry)
	}

	// Copy: the cached principal is shared between concurrent requests and
	// the idle window below is per request.
	principal := ent.session.Principal
	expires, _ := db.ParseISO(principal.ExpiresAt)
	idle, _ := db.ParseISO(principal.IdleExpiresAt)
	if now.After(expires) || now.After(idle) {
		r.forget(ctx, principal.TenantID, principal.SessionID, key)
		return nil, ErrNoSession
	}

	if principal.Kind == KindApplication {
		subject, err := r.subjects.UserByID(ctx, principal.TenantID, principal.SubjectID)
		if err != nil {
			return nil, err
		}
		if subject == nil || subject.Status != "ACTIVE" {
			r.forget(ctx, principal.TenantID, principal.SessionID, key)
			return nil, ErrNoSession
		}
		principal.Role = subject.Role
		perms, err := r.roles.PermissionsFor(ctx, principal.TenantID, subject.Role)
		if err != nil {
			return nil, err
		}
		principal.Permissions = perms
		scope, err := r.roles.ResolveScope(ctx, principal.TenantID, subject.ScopeLevel, subject.ScopeID)
		if err != nil {
			return nil, err
		}
		principal.Scope = scope
	} else {
		operator, err := r.subjects.OperatorByID(ctx, principal.TenantID, principal.SubjectID)
		if err != nil {
			return nil, err
		}
		if operator == nil || operator.Status != "ACTIVE" {
			r.forget(ctx, principal.TenantID, principal.SessionID, key)
			return nil, ErrNoSession
		}
	}

	lifetime := Lifetimes[principal.Kind]
	idleExpiresAt := db.ISO(now.Add(lifetime.Idle))
	principal.IdleExpiresAt = idleExpiresAt

	// The idle window moves on a throttle. Writing it on every request would
	// turn a read-mostly table into a write on the shop floor's hot path for
	// a value measured in minutes.
	last := ent.touchedAt.Load()
	if now.UnixMilli()-last > TouchInterval.Milliseconds() && ent.touchedAt.CompareAndSwap(last, now.UnixMilli()) {
		tenantID, sessionID := principal.TenantID, principal.SessionID
		r.detached.Go("session-touch", func(ctx context.Context) error {
			return r.sessions.Touch(ctx, tenantID, sessionID, idleExpiresAt)
		})
	}

	return &principal, nil
}

// Prime puts a freshly issued session into the cache, so the first request
// after login does not pay a store read.
func (r *Resolver) Prime(token string, session *StoredSession) {
	e := &entry{session: session}
	e.touchedAt.Store(r.now().UnixMilli())
	r.cache.SetWithTTL(HashToken(token), e, 1, CacheTTL)
}

// Forget drops a session from the cache after a revocation elsewhere. The
// store delete is the caller's; this only stops the memory answering for it.
func (r *Resolver) Forget(token string) { r.cache.Del(HashToken(token)) }

// ForgetSession drops any cached entry for a session id. ristretto has no
// scan, so the cache is cleared wholesale: a revocation is rare and a
// ten-second cache refills itself.
func (r *Resolver) ForgetSession(sessionID string) { r.cache.Clear() }

func (r *Resolver) forget(ctx context.Context, tenantID, sessionID, key string) {
	r.cache.Del(key)
	if err := r.sessions.Delete(ctx, tenantID, sessionID); err != nil {
		r.log.Warn("auth: could not delete expired session", "sessionId", sessionID, "error", err)
	}
}

// Close releases the cache's goroutines.
func (r *Resolver) Close() { r.cache.Close() }
