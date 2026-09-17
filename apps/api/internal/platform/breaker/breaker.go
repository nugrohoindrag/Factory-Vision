// Package breaker wraps the outbound dependencies — the object store and
// the security alert webhook — in a circuit breaker, so a dependency that
// has started timing out is failed fast rather than tying up a goroutine and
// a socket for every request until it recovers. Everything else the API
// talks to is PostgreSQL, whose pool is its own bulkhead.
package breaker

import (
	"errors"
	"log/slog"
	"time"

	"github.com/sony/gobreaker/v2"
)

// ErrOpen is returned while the breaker is open or half-open and full.
var ErrOpen = errors.New("dependensi eksternal sedang tidak tersedia")

// Tripped reports whether an error came from the breaker itself rather than
// from the dependency.
func Tripped(err error) bool {
	return errors.Is(err, ErrOpen) || errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests)
}

// Options tune one breaker; zero values take the defaults documented on New.
type Options struct {
	// ConsecutiveFailures opens the breaker (default 5).
	ConsecutiveFailures uint32
	// Cooldown is how long it stays open before one trial request is let
	// through (default 30 s).
	Cooldown time.Duration
	// IsSuccessful decides whether an error counts against the dependency;
	// nil means every error does. A 404 from the object store is a fact
	// about the key, not the store, so callers classify.
	IsSuccessful func(error) bool
}

// New builds a breaker for one dependency. It opens after five consecutive
// failures, stays open for the cooldown, then admits a single request whose
// outcome closes it again or re-opens it. State changes are logged under
// the dependency's name, which is the operator's first clue that a store or
// a webhook is down.
func New[T any](name string, log *slog.Logger, opt Options) *gobreaker.CircuitBreaker[T] {
	failures := opt.ConsecutiveFailures
	if failures == 0 {
		failures = 5
	}
	cooldown := opt.Cooldown
	if cooldown == 0 {
		cooldown = 30 * time.Second
	}
	return gobreaker.NewCircuitBreaker[T](gobreaker.Settings{
		Name:        name,
		MaxRequests: 1,
		Timeout:     cooldown,
		ReadyToTrip: func(c gobreaker.Counts) bool { return c.ConsecutiveFailures >= failures },
		OnStateChange: func(name string, from, to gobreaker.State) {
			if log != nil {
				log.Warn("[breaker] "+name, "from", from.String(), "to", to.String())
			}
		},
		IsSuccessful: opt.IsSuccessful,
	})
}

// Execute runs fn through the breaker, translating its own refusals to
// ErrOpen so callers can tell "the store is down" from "the store said no".
func Execute[T any](cb *gobreaker.CircuitBreaker[T], fn func() (T, error)) (T, error) {
	out, err := cb.Execute(fn)
	if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
		var zero T
		return zero, ErrOpen
	}
	return out, err
}
