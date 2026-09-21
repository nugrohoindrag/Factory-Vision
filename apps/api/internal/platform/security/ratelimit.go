// Package security holds the controls that answer to the security
// requirement rather than to a product feature: rate limits, credential
// lockouts, the security event stream, and the secret primitives.
package security

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Two different jobs live here because they answer two different questions:
//
//	RequestLimiter    how often may this caller ask at all
//	CredentialGuard   how many times may this identity be wrong
//
// Both are keyed on more than the client address. A plant reaches the API
// through one egress IP, so an IP-only limit either locks the whole shop
// floor out or protects nothing at all. State is in-process, which is honest
// for a single API container; a second replica means two independent
// counters.

type attempt struct {
	hits        []time.Time
	lockedUntil time.Time
}

func (a *attempt) prune(window time.Duration, now time.Time) {
	cutoff := now.Add(-window)
	kept := a.hits[:0]
	for _, h := range a.hits {
		if h.After(cutoff) {
			kept = append(kept, h)
		}
	}
	a.hits = kept
}

// RequestLimiter is a sliding-window counter per key.
type RequestLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	sweepAt  int
	attempts map[string]*attempt
	now      func() time.Time
}

// NewRequestLimiter allows `limit` calls per `window` per key.
func NewRequestLimiter(limit int, window time.Duration) *RequestLimiter {
	return &RequestLimiter{limit: limit, window: window, sweepAt: 5000, attempts: map[string]*attempt{}, now: time.Now}
}

// Consume records a call and returns the seconds to wait, or 0 when the call
// is allowed.
func (l *RequestLimiter) Consume(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	a := l.attempts[key]
	if a == nil {
		a = &attempt{}
		l.attempts[key] = a
	}
	a.prune(l.window, now)
	if len(a.hits) >= l.limit {
		oldest := a.hits[0]
		wait := int(oldest.Add(l.window).Sub(now).Seconds() + 0.999)
		if wait < 1 {
			wait = 1
		}
		return wait
	}
	a.hits = append(a.hits, now)
	if len(l.attempts) > l.sweepAt {
		for k, v := range l.attempts {
			v.prune(l.window, now)
			if len(v.hits) == 0 {
				delete(l.attempts, k)
			}
		}
	}
	return 0
}

// Reset forgets one key, or everything.
func (l *RequestLimiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if key == "" {
		l.attempts = map[string]*attempt{}
		return
	}
	delete(l.attempts, key)
}

// CredentialGuard is the failed-credential counter with a temporary lock.
// The lock is temporary by design: a permanent lock keyed on something an
// attacker controls is a denial-of-service tool pointed at the factory that
// has to make product tonight.
type CredentialGuard struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	lock     time.Duration
	attempts map[string]*attempt
	now      func() time.Time
}

// NewCredentialGuard locks a key for `lock` after `limit` failures in `window`.
func NewCredentialGuard(limit int, window, lock time.Duration) *CredentialGuard {
	return &CredentialGuard{limit: limit, window: window, lock: lock, attempts: map[string]*attempt{}, now: time.Now}
}

// SecondsLocked is the remaining lock, or 0 when the identity may try.
func (g *CredentialGuard) SecondsLocked(key string) int {
	g.mu.Lock()
	defer g.mu.Unlock()
	a := g.attempts[key]
	if a == nil || a.lockedUntil.IsZero() {
		return 0
	}
	now := g.now()
	if !a.lockedUntil.After(now) {
		a.lockedUntil = time.Time{}
		a.hits = nil
		return 0
	}
	wait := int(a.lockedUntil.Sub(now).Seconds() + 0.999)
	if wait < 1 {
		wait = 1
	}
	return wait
}

// AssertAvailable returns a 429 while the identity is locked.
func (g *CredentialGuard) AssertAvailable(key, message string) error {
	if s := g.SecondsLocked(key); s > 0 {
		return httpx.RateLimited(message, s)
	}
	return nil
}

// RecordFailure records one failure and reports whether it caused the lock.
func (g *CredentialGuard) RecordFailure(key string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	a := g.attempts[key]
	if a == nil {
		a = &attempt{}
		g.attempts[key] = a
	}
	a.prune(g.window, now)
	a.hits = append(a.hits, now)
	if len(a.hits) >= g.limit {
		a.lockedUntil = now.Add(g.lock)
		a.hits = nil
		return true
	}
	return false
}

// RecordSuccess clears the counter.
func (g *CredentialGuard) RecordSuccess(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.attempts, key)
}

// The shared guards. The login guard is keyed per account, and the operator
// login prefixes its key, so a locked office account never blocks a
// shop-floor terminal, and the other way round.
var (
	LoginGuard         = NewCredentialGuard(8, 15*time.Minute, 15*time.Minute)
	InternalLoginGuard = NewCredentialGuard(5, 15*time.Minute, 30*time.Minute)
)

// KeyFunc derives the limiter key from a request. It returns the request
// too, because a key read from the body leaves the parsed body on the
// request for the handler. The routes package supplies the client key that
// prefers the session, then the forwarded address.
type KeyFunc func(r *http.Request) (string, *http.Request)

// LimitOptions configures one RateLimit middleware.
type LimitOptions struct {
	Limit   int
	Window  time.Duration
	Message string
	Key     KeyFunc
}

// RateLimit is the middleware form. A refusal is a security event and a 429
// with Retry-After.
func RateLimit(opts LimitOptions, events *Events) func(http.Handler) http.Handler {
	limiter := NewRequestLimiter(opts.Limit, opts.Window)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key, r := opts.Key(r)
			if wait := limiter.Consume(key); wait > 0 {
				if events != nil {
					events.Refusal("RATE_LIMIT_HIT", "Rate limit reached on "+r.Method+" "+r.URL.Path, EventContext{
						IP:     httpx.ClientIP(r),
						Detail: map[string]any{"key": key, "retryAfter": wait},
					})
				}
				httpx.WriteError(w, r, httpx.RateLimited(opts.Message, wait))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// BodyKey reads a lower-cased identity from the body, the first of the
// named fields that is a non-empty string, else "unknown". The body is
// parsed once and left on the request for the handler.
func BodyKey(r *http.Request, fields ...string) (string, *http.Request) {
	body, err := httpx.Body(r)
	if err != nil || body == nil {
		return "unknown", r
	}
	r = httpx.WithBody(r, body)
	for _, field := range fields {
		if v, ok := body[field].(string); ok && strings.TrimSpace(v) != "" {
			return strings.ToLower(strings.TrimSpace(v)), r
		}
	}
	return "unknown", r
}
