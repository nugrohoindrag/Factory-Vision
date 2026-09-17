// Package audit is the audit trail (US-054): append-only by construction
// and by privilege (migration 023). A correction is a new entry, never an
// edit to an old one, which is the whole point of keeping the trail.
package audit

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Log is one audit entry, field for field the TypeScript AuditLog.
type Log struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenantId"`
	ActorType     string  `json:"actorType"` // USER | OPERATOR | SYSTEM
	ActorID       string  `json:"actorId"`
	EntityType    string  `json:"entityType"`
	EntityID      string  `json:"entityId"`
	Action        string  `json:"action"`
	PreviousValue any     `json:"previousValue,omitempty"`
	NewValue      any     `json:"newValue,omitempty"`
	IP            *string `json:"ip,omitempty"`
	UserAgent     *string `json:"userAgent,omitempty"`
	OccurredAt    string  `json:"occurredAt"`
}

// Entry is what a caller supplies; id and timestamp are filled in.
type Entry struct {
	TenantID      string
	ActorType     string
	ActorID       string
	EntityType    string
	EntityID      string
	Action        string
	PreviousValue any
	NewValue      any
	IP            *string
	UserAgent     *string
}

// Filter narrows a listing.
type Filter struct {
	EntityType string
	Action     string
	Limit      *int
	Offset     *int
}

// Recorder is what other modules depend on.
type Recorder interface {
	Record(ctx context.Context, e Entry) (Log, error)
	RecordDetached(e Entry)
}

// Service writes and reads audit_log.
type Service struct {
	pool     *db.Pool
	detached *async.Runner
	events   *security.Events
}

// NewService wires the trail.
func NewService(pool *db.Pool, detached *async.Runner, events *security.Events) *Service {
	return &Service{pool: pool, detached: detached, events: events}
}

const columns = `id, tenant_id, actor_type, actor_id, entity_type, entity_id, action,
  previous_value, new_value, ip, user_agent, occurred_at`

func scan(rows pgx.Rows) (Log, error) {
	var (
		l          Log
		prev, next []byte
		occurredAt time.Time
	)
	if err := rows.Scan(&l.ID, &l.TenantID, &l.ActorType, &l.ActorID, &l.EntityType, &l.EntityID, &l.Action,
		&prev, &next, &l.IP, &l.UserAgent, &occurredAt); err != nil {
		return l, err
	}
	l.PreviousValue = db.RawJSON(prev)
	l.NewValue = db.RawJSON(next)
	l.IP, l.UserAgent = db.Str(l.IP), db.Str(l.UserAgent)
	l.OccurredAt = db.ISO(occurredAt)
	return l, nil
}

// Record writes the entry before returning. A failed write is itself a
// security event: an audit trail that quietly stops recording is worse than
// one that was never claimed (§43).
func (s *Service) Record(ctx context.Context, e Entry) (Log, error) {
	entry := Log{
		ID: db.NewID("audit", 5), TenantID: e.TenantID, ActorType: e.ActorType, ActorID: e.ActorID,
		EntityType: e.EntityType, EntityID: e.EntityID, Action: e.Action,
		PreviousValue: e.PreviousValue, NewValue: e.NewValue, IP: e.IP, UserAgent: e.UserAgent,
		OccurredAt: db.Now(),
	}
	var out Log
	err := s.pool.WithTenant(ctx, entry.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.insert(ctx, tx, entry)
		return err
	})
	if err != nil && s.events != nil {
		s.events.Record(security.Event{
			Type:     "AUDIT_WRITE_FAILED",
			Severity: security.SeverityCritical,
			Message:  "Gagal menulis audit log untuk " + entry.Action + " pada " + entry.EntityType + ".",
			TenantID: entry.TenantID,
			Actor:    entry.ActorID,
			Detail:   map[string]any{"action": entry.Action, "entityType": entry.EntityType, "entityId": entry.EntityID},
		})
	}
	return out, err
}

// RecordIn writes inside the caller's transaction, for paths where the
// audit row must commit with the change (planning, work-order generation).
func (s *Service) RecordIn(ctx context.Context, tx pgx.Tx, e Entry) (Log, error) {
	entry := Log{
		ID: db.NewID("audit", 5), TenantID: e.TenantID, ActorType: e.ActorType, ActorID: e.ActorID,
		EntityType: e.EntityType, EntityID: e.EntityID, Action: e.Action,
		PreviousValue: e.PreviousValue, NewValue: e.NewValue, IP: e.IP, UserAgent: e.UserAgent,
		OccurredAt: db.Now(),
	}
	return s.insert(ctx, tx, entry)
}

func (s *Service) insert(ctx context.Context, tx pgx.Tx, entry Log) (Log, error) {
	prev, err := db.JSONB(entry.PreviousValue)
	if err != nil {
		return entry, err
	}
	next, err := db.JSONB(entry.NewValue)
	if err != nil {
		return entry, err
	}
	occurredAt, _ := db.ParseISO(entry.OccurredAt)
	rows, err := tx.Query(ctx,
		`INSERT INTO audit_log (`+columns+`)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		 RETURNING `+columns,
		entry.ID, entry.TenantID, entry.ActorType, entry.ActorID, entry.EntityType, entry.EntityID,
		entry.Action, prev, next, entry.IP, entry.UserAgent, occurredAt,
	)
	if err != nil {
		return entry, err
	}
	defer rows.Close()
	if !rows.Next() {
		return entry, rows.Err()
	}
	return scan(rows)
}

// RecordDetached records without making the caller wait, and without
// letting a failure take the request down with it. Used only where the
// audited action has already been committed.
func (s *Service) RecordDetached(e Entry) {
	s.detached.Go("audit:"+e.Action, func(ctx context.Context) error {
		_, err := s.Record(ctx, e)
		return err
	})
}

// List reads the trail, newest first.
func (s *Service) List(ctx context.Context, tenantID string, f Filter) ([]Log, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.EntityType != "" {
		where = append(where, "entity_type = "+arg(f.EntityType))
	}
	if f.Action != "" {
		where = append(where, "action = "+arg(f.Action))
	}
	limit := 500
	if f.Limit != nil {
		limit = *f.Limit
	}
	if limit > 5000 {
		limit = 5000
	}
	offset := 0
	if f.Offset != nil {
		offset = *f.Offset
	}
	sql := `SELECT ` + columns + ` FROM audit_log WHERE ` + strings.Join(where, " AND ") +
		` ORDER BY occurred_at DESC, id DESC LIMIT ` + arg(limit) + ` OFFSET ` + arg(offset)

	out := make([]Log, 0, 64)
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, sql, params...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			l, err := scan(rows)
			if err != nil {
				return err
			}
			out = append(out, l)
		}
		return rows.Err()
	})
	return out, err
}

// Count is the tenant's entry count.
func (s *Service) Count(ctx context.Context, tenantID string) (int, error) {
	var n int
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*)::int FROM audit_log WHERE tenant_id = $1`, tenantID).Scan(&n)
	})
	return n, err
}

// Mount registers GET /audit-logs.
func Mount(r chi.Router, s *Service) {
	r.Get("/audit-logs", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		logs, err := s.List(r.Context(), tenancy.TenantID(r.Context()), Filter{
			EntityType: httpx.QueryStr(r, "entityType"),
			Action:     httpx.QueryStr(r, "action"),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, logs)
	}))
}

// FromRequest builds the actor part of an entry from the request: who is
// acting, from where, with what.
func FromRequest(r *http.Request, entityType, entityID, action string, previous, next any) Entry {
	ctx := r.Context()
	ip := httpx.ClientIP(r)
	return Entry{
		TenantID:      tenancy.TenantID(ctx),
		ActorType:     auth.ActorType(ctx),
		ActorID:       auth.ActorID(ctx),
		EntityType:    entityType,
		EntityID:      entityID,
		Action:        action,
		PreviousValue: previous,
		NewValue:      next,
		IP:            &ip,
		UserAgent:     httpx.UserAgent(r),
	}
}
