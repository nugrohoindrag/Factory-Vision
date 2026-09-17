// Package db owns the PostgreSQL connection pool and the two ways a request is
// allowed to touch it: inside a tenant-scoped transaction, or - for the relay
// and the job runner only - without a tenant at all.
package db

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Options tunes the pool. Zero values fall back to what a single API process
// serving one plant needs; a large pool would take connections a shared
// PostgreSQL needs for other work.
type Options struct {
	MaxConns          int32
	MinConns          int32
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
	// SlowQuery, when > 0, logs any statement that takes longer.
	SlowQuery time.Duration
	// Observer receives every statement's duration; nil means metrics off.
	Observer QueryObserver
	Logger   *slog.Logger
}

// Pool wraps pgxpool with the tenant discipline every caller must follow.
type Pool struct {
	*pgxpool.Pool
	log *slog.Logger
}

// Open connects and verifies the connection.
func Open(ctx context.Context, url string, opts Options) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	if opts.MaxConns > 0 {
		cfg.MaxConns = opts.MaxConns
	}
	if opts.MinConns > 0 {
		cfg.MinConns = opts.MinConns
	}
	cfg.MaxConnLifetime = orDuration(opts.MaxConnLifetime, 30*time.Minute)
	cfg.MaxConnIdleTime = orDuration(opts.MaxConnIdleTime, 5*time.Minute)
	cfg.HealthCheckPeriod = orDuration(opts.HealthCheckPeriod, time.Minute)
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	// Prepared statements are cached per connection by pgx itself; a
	// statement the API runs on every request is parsed by PostgreSQL once
	// per connection rather than once per call.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement

	log := opts.Logger
	if log == nil {
		log = slog.Default()
	}
	cfg.ConnConfig.Tracer = &tracer{slow: opts.SlowQuery, observer: opts.Observer, log: log}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database unreachable: %w", err)
	}
	return &Pool{Pool: pool, log: log}, nil
}

// RoleStatus is what CheckRole learns about the connecting role.
type RoleStatus struct {
	Name      string
	Superuser bool
	BypassRLS bool
}

// Bypassed is true when tenant isolation policies do not apply to this role.
func (s RoleStatus) Bypassed() bool { return s.Superuser || s.BypassRLS }

// CheckRole reads the connecting role's attributes. Tenant isolation is only
// real if the role is subject to the policies; a superuser is exempt from all
// of them, so the tables would look protected while every tenant could read
// every other tenant's rows. Checked at startup because the failure is
// invisible in normal operation, right up to the moment it is a breach.
func (p *Pool) CheckRole(ctx context.Context) (RoleStatus, error) {
	var s RoleStatus
	err := p.QueryRow(ctx,
		`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
	).Scan(&s.Name, &s.Superuser, &s.BypassRLS)
	return s, err
}

// TableExists answers whether the schema has been migrated far enough to
// hold a given table.
func (p *Pool) TableExists(ctx context.Context, table string) (bool, error) {
	var n int
	err := p.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.tables WHERE table_name = $1`, table,
	).Scan(&n)
	return n > 0, err
}

// ErrTenantRequired is returned when a caller forgets the tenant: a query
// that runs without one either sees nothing (RLS) or, worse, would run
// with whatever the previous borrower of the connection declared.
var ErrTenantRequired = errors.New("db: WithTenant requires a tenant id")

// WithTenant runs fn inside a transaction with the tenant declared to
// PostgreSQL, so the tenant_isolation policies on every tenant-scoped table
// apply to its queries.
//
// The setting has to be transaction-local, hence the transaction: SET LOCAL
// outside one either errors or leaks the tenant onto the next borrower of that
// pooled connection, which is the worst possible failure mode for an isolation
// control. set_config is used so the tenant id can be a bind parameter.
//
// This is defence in depth, not a replacement for scoping queries in the
// application: it is what stops a query that forgot its WHERE tenant_id
// from returning another factory's production.
func (p *Pool) WithTenant(ctx context.Context, tenantID string, fn func(tx pgx.Tx) error) error {
	if tenantID == "" {
		return ErrTenantRequired
	}
	return p.transaction(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID); err != nil {
			return err
		}
		return fn(tx)
	})
}

// WithoutTenant runs fn in a transaction with no tenant declared. Only the
// outbox relay and the job queue may use it: planning_job and outbox_event
// carry a runner_without_tenant policy (migration 034) that admits exactly
// this case, and every other table shows such a transaction nothing.
func (p *Pool) WithoutTenant(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return p.transaction(ctx, fn)
}

func (p *Pool) transaction(ctx context.Context, fn func(tx pgx.Tx) error) (err error) {
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if r := recover(); r != nil {
			_ = tx.Rollback(ctx)
			panic(r)
		}
	}()
	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			p.log.Warn("db: rollback failed", "error", rbErr)
		}
		return err
	}
	return tx.Commit(ctx)
}

// Notify raises pg_notify inside the caller's transaction, so listeners
// only hear about a change once it has committed.
func Notify(ctx context.Context, tx pgx.Tx, channel, payload string) error {
	_, err := tx.Exec(ctx, `SELECT pg_notify($1, $2)`, channel, payload)
	return err
}

func orDuration(v, fallback time.Duration) time.Duration {
	if v > 0 {
		return v
	}
	return fallback
}
