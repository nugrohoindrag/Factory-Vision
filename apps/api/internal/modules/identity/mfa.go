package identity

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/security"
)

// Multi-factor authentication (§5). Three rules shape this: enrolment is
// two steps (issue a secret, then prove it with a code) so nobody can lock
// themselves out by scanning a QR badly; a challenge issued at login is
// short-lived and single-use and grants nothing on its own; a recovery code
// is a credential, so it is hashed, shown once, and consumed when used.

const (
	challengeTTL = 5 * time.Minute
	issuer       = "Factory Vision"
)

type challenge struct {
	tenantID  string
	userID    string
	expiresAt time.Time
}

// MfaStatus is what the console shows on the security page.
type MfaStatus struct {
	Enrolled               bool    `json:"enrolled"`
	ConfirmedAt            *string `json:"confirmedAt,omitempty"`
	Required               bool    `json:"required"`
	RecoveryCodesRemaining int     `json:"recoveryCodesRemaining"`
}

type mfaRow struct {
	secretEncrypted string
	confirmedAt     *time.Time
	recoveryHashes  []string
}

// MFA manages user_mfa and the in-memory login challenges.
type MFA struct {
	pool          *db.Pool
	box           *security.SecretBox
	requiredRoles map[string]bool
	mu            sync.Mutex
	challenges    map[string]challenge
}

// NewMFA wires the second factor.
func NewMFA(pool *db.Pool, box *security.SecretBox, requiredRoles []string) *MFA {
	required := map[string]bool{}
	for _, r := range requiredRoles {
		required[strings.ToUpper(r)] = true
	}
	if len(required) == 0 {
		required["ADMIN"] = true
	}
	return &MFA{pool: pool, box: box, requiredRoles: required, challenges: map[string]challenge{}}
}

// Available reports whether enrolment can store a secret.
func (m *MFA) Available() bool { return m.box.Available() }

// RequiredRoles lists the roles that must carry a second factor.
func (m *MFA) RequiredRoles() []string {
	out := make([]string, 0, len(m.requiredRoles))
	for r := range m.requiredRoles {
		out = append(out, r)
	}
	return out
}

// IsRequiredFor reports whether a role must enrol.
func (m *MFA) IsRequiredFor(role string) bool { return m.requiredRoles[strings.ToUpper(role)] }

func (m *MFA) assertAvailable() error {
	if !m.box.Available() {
		return httpx.InvalidState("MFA belum dapat diaktifkan: MFA_ENCRYPTION_KEY belum diatur pada server.")
	}
	return nil
}

func (m *MFA) read(ctx context.Context, tenantID, userID string) (*mfaRow, error) {
	var row *mfaRow
	err := m.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var r mfaRow
		err := tx.QueryRow(ctx,
			`SELECT secret_encrypted, confirmed_at, recovery_code_hashes FROM user_mfa WHERE tenant_id = $1 AND user_id = $2`,
			tenantID, userID,
		).Scan(&r.secretEncrypted, &r.confirmedAt, &r.recoveryHashes)
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		row = &r
		return nil
	})
	return row, err
}

// Enrolment is what the authenticator app needs.
type Enrolment struct {
	Secret     string `json:"secret"`
	OTPAuthURI string `json:"otpauthUri"`
}

// BeginEnrolment issues a secret. Nothing is enforced until Confirm proves
// the app and the server agree.
func (m *MFA) BeginEnrolment(ctx context.Context, tenantID, userID, account string) (Enrolment, error) {
	if err := m.assertAvailable(); err != nil {
		return Enrolment{}, err
	}
	secret := security.GenerateTOTPSecret()
	sealed, err := m.box.Seal(secret)
	if err != nil {
		return Enrolment{}, err
	}
	err = m.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO user_mfa (tenant_id, user_id, secret_encrypted, confirmed_at, recovery_code_hashes)
			 VALUES ($1, $2, $3, NULL, '{}')
			 ON CONFLICT (tenant_id, user_id)
			 DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, confirmed_at = NULL, recovery_code_hashes = '{}'`,
			tenantID, userID, sealed)
		return err
	})
	if err != nil {
		return Enrolment{}, err
	}
	return Enrolment{Secret: secret, OTPAuthURI: security.OTPAuthURI(secret, account, issuer)}, nil
}

// ConfirmEnrolment proves the code and returns the recovery codes, shown
// exactly once.
func (m *MFA) ConfirmEnrolment(ctx context.Context, tenantID, userID, code string) ([]string, error) {
	if err := m.assertAvailable(); err != nil {
		return nil, err
	}
	row, err := m.read(ctx, tenantID, userID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.InvalidState("Belum ada proses pendaftaran MFA untuk akun ini.")
	}
	secret, err := m.box.Open(row.secretEncrypted)
	if err != nil {
		return nil, err
	}
	if !security.VerifyTOTP(secret, code, time.Now()) {
		return nil, httpx.Validation("Kode MFA tidak cocok. Periksa jam perangkat Anda lalu coba lagi.",
			httpx.FieldError{Field: "code", Code: "INVALID", Message: "Kode tidak cocok."})
	}
	codes := security.GenerateRecoveryCodes(8)
	hashes := make([]string, 0, len(codes))
	for _, c := range codes {
		hashes = append(hashes, security.HashSecret(c))
	}
	err = m.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE user_mfa SET confirmed_at = now(), recovery_code_hashes = $3 WHERE tenant_id = $1 AND user_id = $2`,
			tenantID, userID, hashes)
		return err
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// Disable removes the factor.
func (m *MFA) Disable(ctx context.Context, tenantID, userID string) error {
	return m.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM user_mfa WHERE tenant_id = $1 AND user_id = $2`, tenantID, userID)
		return err
	})
}

// Status reports where an account stands.
func (m *MFA) Status(ctx context.Context, tenantID, userID, role string) (MfaStatus, error) {
	row, err := m.read(ctx, tenantID, userID)
	if err != nil {
		return MfaStatus{}, err
	}
	status := MfaStatus{Required: m.IsRequiredFor(role)}
	if row != nil {
		status.Enrolled = row.confirmedAt != nil
		status.ConfirmedAt = db.ISOPtr(row.confirmedAt)
		status.RecoveryCodesRemaining = len(row.recoveryHashes)
	}
	return status, nil
}

// IsActiveFor is true when the account has finished enrolment and must be
// challenged.
func (m *MFA) IsActiveFor(ctx context.Context, tenantID, userID string) (bool, error) {
	row, err := m.read(ctx, tenantID, userID)
	if err != nil {
		return false, err
	}
	return row != nil && row.confirmedAt != nil, nil
}

// Challenge is the login's answer when a second factor is owed.
type Challenge struct {
	MfaRequired      bool   `json:"mfaRequired"`
	ChallengeToken   string `json:"challengeToken"`
	ExpiresInSeconds int    `json:"expiresInSeconds"`
}

// IssueChallenge mints a single-use token for one account.
func (m *MFA) IssueChallenge(tenantID, userID string) Challenge {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	token := "mfa-" + base64.RawURLEncoding.EncodeToString(b[:])
	m.mu.Lock()
	m.challenges[token] = challenge{tenantID: tenantID, userID: userID, expiresAt: time.Now().Add(challengeTTL)}
	now := time.Now()
	for t, c := range m.challenges {
		if c.expiresAt.Before(now) {
			delete(m.challenges, t)
		}
	}
	m.mu.Unlock()
	return Challenge{MfaRequired: true, ChallengeToken: token, ExpiresInSeconds: int(challengeTTL.Seconds())}
}

// Verified is what a consumed challenge yields.
type Verified struct {
	TenantID         string
	UserID           string
	UsedRecoveryCode bool
}

// VerifyChallenge consumes a challenge and the code that answers it.
// Single use in both directions: the challenge is deleted whether the code
// was right or wrong, so a stolen challenge token cannot be used to guess
// six digits at leisure.
func (m *MFA) VerifyChallenge(ctx context.Context, token, code string) (Verified, error) {
	m.mu.Lock()
	c, ok := m.challenges[token]
	delete(m.challenges, token)
	m.mu.Unlock()
	if !ok || c.expiresAt.Before(time.Now()) {
		return Verified{}, httpx.Unauthenticated("Sesi verifikasi MFA telah berakhir. Silakan login kembali.")
	}
	row, err := m.read(ctx, c.tenantID, c.userID)
	if err != nil {
		return Verified{}, err
	}
	if row == nil || row.confirmedAt == nil {
		return Verified{}, httpx.Unauthenticated("MFA tidak aktif untuk akun ini.")
	}
	secret, err := m.box.Open(row.secretEncrypted)
	if err != nil {
		return Verified{}, err
	}
	if security.VerifyTOTP(secret, code, time.Now()) {
		err := m.pool.WithTenant(ctx, c.tenantID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `UPDATE user_mfa SET last_used_at = now() WHERE tenant_id = $1 AND user_id = $2`, c.tenantID, c.userID)
			return err
		})
		if err != nil {
			return Verified{}, err
		}
		return Verified{TenantID: c.tenantID, UserID: c.userID}, nil
	}
	normalised := strings.ToUpper(strings.TrimSpace(code))
	remaining := make([]string, 0, len(row.recoveryHashes))
	for _, h := range row.recoveryHashes {
		hash := h
		if !security.VerifySecret(normalised, &hash) {
			remaining = append(remaining, h)
		}
	}
	if len(remaining) < len(row.recoveryHashes) {
		err := m.pool.WithTenant(ctx, c.tenantID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx,
				`UPDATE user_mfa SET recovery_code_hashes = $3, last_used_at = now() WHERE tenant_id = $1 AND user_id = $2`,
				c.tenantID, c.userID, remaining)
			return err
		})
		if err != nil {
			return Verified{}, err
		}
		return Verified{TenantID: c.tenantID, UserID: c.userID, UsedRecoveryCode: true}, nil
	}
	return Verified{}, httpx.Unauthenticated("Kode MFA salah.")
}
