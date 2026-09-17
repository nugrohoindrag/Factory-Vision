// Package cache is the in-process, per-tenant read cache.
//
// The Node API kept master data, roles and credentials in arrays it read
// synchronously on the hot path; the arrays were a projection of PostgreSQL
// rebuilt at boot. This is the same idea with the failure modes removed: an
// entry expires, so a restart is not the only way to refresh it; a write
// invalidates, so a change is visible on the next request; and concurrent
// misses collapse into one query (singleflight) rather than a stampede.
package cache

import (
	"context"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"golang.org/x/sync/singleflight"
)

// Loader fetches the value for a tenant when the cache has none.
type Loader[T any] func(ctx context.Context) (T, error)

// Tenant caches one kind of value per tenant.
type Tenant[T any] struct {
	name   string
	ttl    time.Duration
	cache  *ristretto.Cache[string, T]
	flight singleflight.Group
}

// Options sizes a cache. MaxEntries is a soft ceiling, not a guarantee:
// ristretto admits by frequency, so a value that is rarely read may be
// dropped early and simply reloaded.
type Options struct {
	MaxEntries int64
	TTL        time.Duration
}

// New builds a cache for one value kind; name is the metric label.
func New[T any](name string, opts Options) (*Tenant[T], error) {
	if opts.MaxEntries <= 0 {
		opts.MaxEntries = 1000
	}
	c, err := ristretto.NewCache(&ristretto.Config[string, T]{
		NumCounters: opts.MaxEntries * 10,
		MaxCost:     opts.MaxEntries,
		BufferItems: 64,
	})
	if err != nil {
		return nil, err
	}
	return &Tenant[T]{name: name, ttl: opts.TTL, cache: c}, nil
}

// Get returns the tenant's value, loading it once on a miss.
func (t *Tenant[T]) Get(ctx context.Context, tenantID string, load Loader[T]) (T, error) {
	if v, ok := t.cache.Get(tenantID); ok {
		return v, nil
	}
	v, err, _ := t.flight.Do(tenantID, func() (any, error) {
		if v, ok := t.cache.Get(tenantID); ok {
			return v, nil
		}
		loaded, err := load(ctx)
		if err != nil {
			return nil, err
		}
		if t.ttl > 0 {
			t.cache.SetWithTTL(tenantID, loaded, 1, t.ttl)
		} else {
			t.cache.Set(tenantID, loaded, 1)
		}
		return loaded, nil
	})
	if err != nil {
		var zero T
		return zero, err
	}
	return v.(T), nil
}

// Invalidate drops the tenant's value after a write.
func (t *Tenant[T]) Invalidate(tenantID string) { t.cache.Del(tenantID) }

// Clear drops everything.
func (t *Tenant[T]) Clear() { t.cache.Clear() }

// Close releases the cache's goroutines.
func (t *Tenant[T]) Close() { t.cache.Close() }
