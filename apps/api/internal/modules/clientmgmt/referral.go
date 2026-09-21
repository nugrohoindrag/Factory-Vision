package clientmgmt

import (
	"context"
	"crypto/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Referral codes gate the public trial form (migration 037). A code is
// issued here, by vendor staff, and spent by the onboarding module inside the
// transaction that creates the trial tenant.

// ReferralCode is the TypeScript ReferralCode.
type ReferralCode struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	Label      string  `json:"label"`
	CreatedBy  string  `json:"createdBy"`
	CreatedAt  string  `json:"createdAt"`
	ExpiresAt  *string `json:"expiresAt"`
	MaxUses    int     `json:"maxUses"`
	UseCount   int     `json:"useCount"`
	LastUsedAt *string `json:"lastUsedAt"`
	RevokedAt  *string `json:"revokedAt"`
	RevokedBy  *string `json:"revokedBy"`
	// Derived: not revoked, not expired, and with registrations left.
	Active bool `json:"active"`
}

const referralColumns = `id, code, label, created_by, created_at, expires_at, max_uses, use_count, last_used_at, revoked_at, revoked_by`

func scanReferral(row pgx.Row, now time.Time) (ReferralCode, error) {
	var c ReferralCode
	var created time.Time
	var expires, lastUsed, revoked *time.Time
	if err := row.Scan(&c.ID, &c.Code, &c.Label, &c.CreatedBy, &created, &expires, &c.MaxUses, &c.UseCount, &lastUsed, &revoked, &c.RevokedBy); err != nil {
		return ReferralCode{}, err
	}
	c.CreatedAt, c.ExpiresAt, c.LastUsedAt, c.RevokedAt = db.ISO(created), db.ISOPtr(expires), db.ISOPtr(lastUsed), db.ISOPtr(revoked)
	c.Active = revoked == nil && (expires == nil || expires.After(now)) && c.UseCount < c.MaxUses
	return c, nil
}

// ReferralCodes lists every code, newest first. Spent and revoked codes stay
// listed: the question "which code admitted this factory?" keeps its answer.
func (Repository) ReferralCodes(ctx context.Context, tx pgx.Tx, now time.Time) ([]ReferralCode, error) {
	rows, err := tx.Query(ctx, `SELECT `+referralColumns+` FROM referral_code ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReferralCode{}
	for rows.Next() {
		c, err := scanReferral(rows, now)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (Repository) InsertReferralCode(ctx context.Context, tx pgx.Tx, code, label, createdBy string, expiresAt *string, maxUses int, now time.Time) (ReferralCode, error) {
	return scanReferral(tx.QueryRow(ctx, `INSERT INTO referral_code (id, code, label, created_by, expires_at, max_uses) VALUES ($1,$2,$3,$4,$5::timestamptz,$6) RETURNING `+referralColumns,
		newID("ref"), code, label, createdBy, expiresAt, maxUses), now)
}

// RevokeReferralCode ends a code; nil when it was already revoked or unknown.
func (Repository) RevokeReferralCode(ctx context.Context, tx pgx.Tx, id, revokedBy string, now time.Time) (*ReferralCode, error) {
	c, err := scanReferral(tx.QueryRow(ctx, `UPDATE referral_code SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING `+referralColumns, id, revokedBy), now)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// The alphabet leaves out 0/O and 1/I: a code is read out over the phone
// and typed on a tablet, so nothing in it may be mistaken for anything else.
const referralAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// NewReferralCode makes a code of the form FV-XXXX-XXXX.
func NewReferralCode() string {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	var b strings.Builder
	b.WriteString("FV-")
	for i, r := range raw {
		if i == 4 {
			b.WriteByte('-')
		}
		b.WriteByte(referralAlphabet[int(r)%len(referralAlphabet)])
	}
	return b.String()
}

// NormalizeReferralCode is what the trial form's input becomes before it is
// looked up: trimmed, upper-cased, and tolerant of a missing or extra dash.
func NormalizeReferralCode(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "")
	compact := strings.ReplaceAll(s, "-", "")
	if len(compact) == 10 && strings.HasPrefix(compact, "FV") {
		return "FV-" + compact[2:6] + "-" + compact[6:]
	}
	return s
}

// ReferralInput is what the internal console sends to issue a code.
type ReferralInput struct {
	Label      string
	MaxUses    int
	ExpiryDays int // 0 never expires
}

const maxReferralUses = 100

// GenerateReferralCode issues a code and records who issued it and for whom.
func (s *Service) GenerateReferralCode(ctx context.Context, in ReferralInput, actor Actor) (ReferralCode, error) {
	label := strings.TrimSpace(in.Label)
	if len(label) < 3 {
		return ReferralCode{}, httpx.Validation("Sebutkan untuk siapa kode ini dibuat, minimal 3 karakter.", httpx.FieldError{Field: "label", Code: "TOO_SHORT", Message: "Tuliskan nama prospek, acara, atau mitra."})
	}
	maxUses := in.MaxUses
	if maxUses < 1 {
		maxUses = 1
	}
	if maxUses > maxReferralUses {
		maxUses = maxReferralUses
	}
	var expires *string
	if in.ExpiryDays > 0 {
		expires = db.Ptr(db.ISO(s.now().Add(time.Duration(in.ExpiryDays) * 24 * time.Hour)))
	}
	var out ReferralCode
	var err error
	// A collision on 32^8 codes is not expected; the retry is for the day it
	// happens anyway. Each attempt is its own transaction, because a unique
	// violation aborts the one it happened in.
	for attempt := 0; attempt < 3; attempt++ {
		err = s.tx(ctx, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.InsertReferralCode(ctx, tx, NewReferralCode(), label, actor.Email, expires, maxUses, s.now())
			if err != nil {
				return err
			}
			return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "REFERRAL_CODE_CREATED", EntityType: "referral_code", EntityID: &out.ID, IP: actor.IP,
				NewValue: map[string]any{"code": out.Code, "label": out.Label, "maxUses": out.MaxUses, "expiresAt": out.ExpiresAt}})
		})
		if err == nil || !db.IsUniqueViolation(err) {
			break
		}
	}
	return out, err
}

// ReferralCodes lists every code with its derived state.
func (s *Service) ReferralCodes(ctx context.Context) ([]ReferralCode, error) {
	var out []ReferralCode
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ReferralCodes(ctx, tx, s.now())
		return err
	})
	return out, err
}

// RevokeReferralCode stops a code from admitting anyone else.
func (s *Service) RevokeReferralCode(ctx context.Context, id string, actor Actor) (ReferralCode, error) {
	var out ReferralCode
	err := s.tx(ctx, func(tx pgx.Tx) error {
		c, err := s.repo.RevokeReferralCode(ctx, tx, id, actor.Email, s.now())
		if err != nil {
			return err
		}
		if c == nil {
			return httpx.NotFound("Kode referral tidak ditemukan atau sudah dicabut.")
		}
		out = *c
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "REFERRAL_CODE_REVOKED", EntityType: "referral_code", EntityID: &id, IP: actor.IP,
			PreviousValue: map[string]any{"code": c.Code, "label": c.Label, "useCount": c.UseCount}})
	})
	return out, err
}
