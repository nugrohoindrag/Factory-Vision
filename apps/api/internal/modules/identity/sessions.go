// Package identity is authentication for both front doors (US-001, US-002)
// and the session store behind them: login, operator login, MFA, sessions,
// and credential administration.
package identity

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// SessionSummary is a live session shown to an admin so it can be revoked
// (US-005).
type SessionSummary struct {
	SessionID  string  `json:"sessionId"`
	Kind       string  `json:"kind"`
	SubjectID  string  `json:"subjectId"`
	Name       string  `json:"name"`
	Role       string  `json:"role"`
	IssuedAt   string  `json:"issuedAt"`
	LastSeenAt string  `json:"lastSeenAt"`
	ExpiresAt  string  `json:"expiresAt"`
	IP         *string `json:"ip,omitempty"`
	UserAgent  *string `json:"userAgent,omitempty"`
}

// SessionRepository is app_session, the durable half of authentication
// (§6). A session token carries its tenant as a prefix so a lookup by token
// can declare the tenant before row-level security will show it anything;
// the row is found by the SHA-256 of the whole token.
type SessionRepository struct {
	pool *db.Pool
}

// NewSessionRepository binds the store to the pool.
func NewSessionRepository(pool *db.Pool) *SessionRepository {
	return &SessionRepository{pool: pool}
}

const sessionColumns = `id, tenant_id, kind, subject_id, principal,
  issued_at, expires_at, idle_expires_at, last_seen_at, ip, user_agent`

func scanSession(rows pgx.Rows) (*auth.StoredSession, error) {
	var (
		id, tenantID, kind, subjectID      string
		principalJSON                      []byte
		issuedAt, expiresAt, idleExpiresAt time.Time
		lastSeenAt                         time.Time
		ip, userAgent                      *string
	)
	if err := rows.Scan(&id, &tenantID, &kind, &subjectID, &principalJSON,
		&issuedAt, &expiresAt, &idleExpiresAt, &lastSeenAt, &ip, &userAgent); err != nil {
		return nil, err
	}
	var principal auth.Principal
	if err := json.Unmarshal(principalJSON, &principal); err != nil {
		return nil, err
	}
	// The row's own columns are the authority on lifetime: the JSON
	// snapshot was written when the session was issued and does not move.
	principal.ExpiresAt = db.ISO(expiresAt)
	principal.IdleExpiresAt = db.ISO(idleExpiresAt)
	return &auth.StoredSession{
		Principal:  principal,
		LastSeenAt: db.ISO(lastSeenAt),
		IP:         db.Str(ip),
		UserAgent:  db.Str(userAgent),
	}, nil
}

// Insert writes a freshly issued session.
func (r *SessionRepository) Insert(ctx context.Context, principal auth.Principal, token string, ip, userAgent *string) error {
	snapshot, err := json.Marshal(principal)
	if err != nil {
		return err
	}
	issuedAt, _ := db.ParseISO(principal.IssuedAt)
	expiresAt, _ := db.ParseISO(principal.ExpiresAt)
	idleExpiresAt, _ := db.ParseISO(principal.IdleExpiresAt)
	return r.pool.WithTenant(ctx, principal.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO app_session
			   (id, tenant_id, kind, subject_id, token_hash, principal,
			    issued_at, expires_at, idle_expires_at, last_seen_at, ip, user_agent)
			 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $7, $10, $11)
			 ON CONFLICT (id) DO NOTHING`,
			principal.SessionID, principal.TenantID, string(principal.Kind), principal.SubjectID,
			auth.HashToken(token), snapshot, issuedAt, expiresAt, idleExpiresAt, ip, userAgent,
		)
		return err
	})
}

// FindByToken reads a live session by token. Expired rows are treated as
// absent.
func (r *SessionRepository) FindByToken(ctx context.Context, token string) (*auth.StoredSession, error) {
	tenantID := auth.TenantOfToken(token)
	if tenantID == "" {
		return nil, nil
	}
	var found *auth.StoredSession
	err := r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+sessionColumns+`
			   FROM app_session
			  WHERE token_hash = $1
			    AND expires_at > now()
			    AND idle_expires_at > now()`,
			auth.HashToken(token),
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		if rows.Next() {
			found, err = scanSession(rows)
			return err
		}
		return rows.Err()
	})
	return found, err
}

// Touch extends the idle window. Called on a throttle, not on every request.
func (r *SessionRepository) Touch(ctx context.Context, tenantID, sessionID, idleExpiresAt string) error {
	at, err := db.ParseISO(idleExpiresAt)
	if err != nil {
		return err
	}
	return r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE app_session SET last_seen_at = now(), idle_expires_at = $2 WHERE id = $1`, sessionID, at)
		return err
	})
}

// Delete removes one session.
func (r *SessionRepository) Delete(ctx context.Context, tenantID, sessionID string) error {
	return r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM app_session WHERE id = $1`, sessionID)
		return err
	})
}

// DeleteWhere is revocation: by session id, by subject, or both. Returns
// the sessions removed, for the audit trail.
func (r *SessionRepository) DeleteWhere(ctx context.Context, tenantID string, sessionID, subjectID *string) ([]SessionSummary, error) {
	var out []SessionSummary
	err := r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`DELETE FROM app_session
			  WHERE ($1::text IS NULL OR id = $1)
			    AND ($2::text IS NULL OR subject_id = $2)
			  RETURNING `+sessionColumns,
			sessionID, subjectID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			s, err := scanSession(rows)
			if err != nil {
				return err
			}
			out = append(out, Summarise(s))
		}
		return rows.Err()
	})
	if out == nil {
		out = []SessionSummary{}
	}
	return out, err
}

// List is the tenant's live sessions, most recently seen first.
func (r *SessionRepository) List(ctx context.Context, tenantID string, subjectID *string) ([]SessionSummary, error) {
	out := []SessionSummary{}
	err := r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+sessionColumns+`
			   FROM app_session
			  WHERE expires_at > now()
			    AND idle_expires_at > now()
			    AND ($1::text IS NULL OR subject_id = $1)
			  ORDER BY last_seen_at DESC`,
			subjectID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			s, err := scanSession(rows)
			if err != nil {
				return err
			}
			out = append(out, Summarise(s))
		}
		return rows.Err()
	})
	return out, err
}

// FindBySessionID reads a session by id, for logout.
func (r *SessionRepository) FindBySessionID(ctx context.Context, tenantID, sessionID string) (*auth.StoredSession, error) {
	var found *auth.StoredSession
	err := r.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+sessionColumns+` FROM app_session WHERE id = $1`, sessionID)
		if err != nil {
			return err
		}
		defer rows.Close()
		if rows.Next() {
			found, err = scanSession(rows)
			return err
		}
		return rows.Err()
	})
	return found, err
}

// PurgeExpired removes what has already expired. Expired rows are never
// honoured — every read filters on the timestamps — so this is housekeeping,
// and it runs without a tenant because it deletes across all of them under
// the expired_cleanup policy (migration 024).
func (r *SessionRepository) PurgeExpired(ctx context.Context) (int64, error) {
	var removed int64
	err := r.pool.WithoutTenant(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM app_session WHERE expires_at <= now() OR idle_expires_at <= now()`)
		removed = tag.RowsAffected()
		return err
	})
	return removed, err
}

// Summarise projects a stored session for the admin list.
func Summarise(s *auth.StoredSession) SessionSummary {
	return SessionSummary{
		SessionID:  s.Principal.SessionID,
		Kind:       string(s.Principal.Kind),
		SubjectID:  s.Principal.SubjectID,
		Name:       s.Principal.Name,
		Role:       s.Principal.Role,
		IssuedAt:   s.Principal.IssuedAt,
		LastSeenAt: s.LastSeenAt,
		ExpiresAt:  s.Principal.ExpiresAt,
		IP:         s.IP,
		UserAgent:  s.UserAgent,
	}
}
