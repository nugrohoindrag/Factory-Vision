package identity

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/roles"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
)

// ClientContext is where a login came from, recorded on the session so an
// administrator can recognise it when deciding whether to revoke it.
type ClientContext struct {
	IP        *string
	UserAgent *string
}

// LoginResponse is what a successful login returns.
type LoginResponse struct {
	Token                 string               `json:"token"`
	Principal             auth.Principal       `json:"principal"`
	User                  *masterdata.User     `json:"user,omitempty"`
	Operator              *masterdata.Operator `json:"operator,omitempty"`
	IdleTimeoutSeconds    int                  `json:"idleTimeoutSeconds"`
	MfaEnrollmentRequired *bool                `json:"mfaEnrollmentRequired,omitempty"`
}

// Service is authentication for both front doors and the session store
// behind them. Credentials live beside the account rather than on it: a
// user record travels to the console, and a password hash has no business
// being part of that payload.
type Service struct {
	cfg      *config.Config
	master   *masterdata.Service
	roles    *roles.Service
	audit    audit.Recorder
	sessions *SessionRepository
	resolver *auth.Resolver
	policy   security.Policy
	events   *security.Events
	MFA      *MFA
	log      *slog.Logger
}

// NewService wires the identity module.
func NewService(cfg *config.Config, master *masterdata.Service, rs *roles.Service, auditor audit.Recorder,
	sessions *SessionRepository, resolver *auth.Resolver, mfa *MFA, events *security.Events, log *slog.Logger) *Service {
	return &Service{
		cfg: cfg, master: master, roles: rs, audit: auditor, sessions: sessions, resolver: resolver,
		policy: security.NewPolicy(cfg.PasswordMinLength, cfg.PINMinLength), events: events, MFA: mfa, log: log,
	}
}

// Policy is the credential policy in force.
func (s *Service) Policy() security.Policy { return s.policy }

func (s *Service) auditLogin(ctx context.Context, tenantID, actorType, actorID, entityID, action string, value any, c ClientContext) error {
	_, err := s.audit.Record(ctx, audit.Entry{
		TenantID: tenantID, ActorType: actorType, ActorID: actorID, EntityType: "auth", EntityID: entityID,
		Action: action, NewValue: value, IP: c.IP, UserAgent: c.UserAgent,
	})
	return err
}

// TenantsForEmail is every tenant an application user with this email
// belongs to, for a login that named no tenant.
func (s *Service) TenantsForEmail(ctx context.Context, email string) ([]string, error) {
	return s.master.TenantsForEmail(ctx, config.PilotTenant, email)
}

// Login is US-001. A missing account and a wrong password are reported
// identically so the login form cannot be used to enumerate who works here.
func (s *Service) Login(ctx context.Context, tenantID, email, password string, c ClientContext) (any, error) {
	guardKey := tenantID + ":" + strings.ToLower(strings.TrimSpace(email))
	if err := security.LoginGuard.AssertAvailable(guardKey, "Terlalu banyak percobaan login yang gagal. Coba lagi dalam beberapa menit."); err != nil {
		return nil, err
	}
	stored, err := s.master.StoredUserByEmail(ctx, tenantID, email)
	if err != nil {
		return nil, err
	}
	if stored == nil || !security.VerifySecret(password, stored.PasswordHash) {
		locked := security.LoginGuard.RecordFailure(guardKey)
		action := "LOGIN_FAILED"
		if locked {
			action = "LOGIN_LOCKED"
		}
		if err := s.auditLogin(ctx, tenantID, "SYSTEM", email, email, action, map[string]any{"reason": "INVALID_CREDENTIALS", "locked": locked}, c); err != nil {
			return nil, err
		}
		if locked {
			s.events.Record(security.Event{
				Type: "LOGIN_LOCKED", Severity: security.SeverityWarning,
				Message:  "Akun " + email + " dikunci sementara setelah percobaan login berulang.",
				TenantID: tenantID, Actor: email, IP: db.StrOr(c.IP, ""),
			})
			return nil, httpx.RateLimited("Terlalu banyak percobaan login yang gagal. Coba lagi dalam beberapa menit.", 0)
		}
		return nil, httpx.Unauthenticated("Email atau kata sandi salah.")
	}
	user := stored.User
	if user.Status != "ACTIVE" {
		if err := s.auditLogin(ctx, tenantID, "SYSTEM", user.ID, user.ID, "LOGIN_BLOCKED", map[string]any{"status": user.Status}, c); err != nil {
			return nil, err
		}
		if user.Status == "SUSPENDED" {
			return nil, httpx.Forbidden("Akun Anda ditangguhkan. Hubungi administrator.")
		}
		return nil, httpx.Forbidden("Akun Anda tidak aktif. Hubungi administrator.")
	}
	security.LoginGuard.RecordSuccess(guardKey)

	// Second factor (§5). The password alone gets a challenge, never a
	// session: what comes back carries no permissions and expires in minutes.
	active, err := s.MFA.IsActiveFor(ctx, tenantID, user.ID)
	if err != nil {
		return nil, err
	}
	if active {
		challenge := s.MFA.IssueChallenge(tenantID, user.ID)
		if err := s.auditLogin(ctx, tenantID, "USER", user.ID, user.ID, "MFA_CHALLENGED", nil, c); err != nil {
			return nil, err
		}
		return challenge, nil
	}
	return s.completeLogin(ctx, tenantID, user, c, false, false)
}

// completeLogin issues the session once every factor has been satisfied —
// the one place where a session comes into existence.
func (s *Service) completeLogin(ctx context.Context, tenantID string, user masterdata.User, c ClientContext, viaMfa, usedRecovery bool) (*LoginResponse, error) {
	principal, token, err := s.issue(ctx, auth.KindApplication, tenantID, user.ID, user.Name, user.Role, user.ScopeLevel, user.ScopeID)
	if err != nil {
		return nil, err
	}
	stored, err := s.persist(ctx, principal, token, c)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if err := s.master.TouchUserLogin(ctx, tenantID, user.ID, now); err != nil {
		s.log.Warn("identity: could not record last login", "error", err)
	}
	user.LastLoginAt = db.Ptr(db.ISO(now))

	mfa := "NONE"
	if viaMfa {
		mfa = "TOTP"
		if usedRecovery {
			mfa = "RECOVERY_CODE"
		}
	}
	if err := s.auditLogin(ctx, tenantID, "USER", user.ID, user.ID, "LOGIN",
		map[string]any{"role": user.Role, "sessionId": principal.SessionID, "mfa": mfa}, c); err != nil {
		return nil, err
	}
	_ = stored

	resp := &LoginResponse{
		Token: token, Principal: principal, User: &user,
		IdleTimeoutSeconds: int(auth.Lifetimes[auth.KindApplication].Idle.Seconds()),
	}
	// A role that must carry a second factor, on an account that has not
	// enrolled one, is not refused at the door — that would leave the
	// account no way to fix it. It is flagged, and the console sends them to
	// enrol.
	if !viaMfa && s.MFA.Available() && s.MFA.IsRequiredFor(user.Role) {
		resp.MfaEnrollmentRequired = db.Ptr(true)
	}
	return resp, nil
}

// VerifyMfaLogin answers a login challenge and issues the session (§5).
func (s *Service) VerifyMfaLogin(ctx context.Context, challengeToken, code string, c ClientContext) (*LoginResponse, error) {
	verified, err := s.MFA.VerifyChallenge(ctx, challengeToken, code)
	if err != nil {
		return nil, err
	}
	user, err := s.master.UserByID(ctx, verified.TenantID, verified.UserID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Status != "ACTIVE" {
		return nil, httpx.Forbidden("Akun Anda tidak aktif. Hubungi administrator.")
	}
	if verified.UsedRecoveryCode {
		if err := s.auditLogin(ctx, verified.TenantID, "USER", user.ID, user.ID, "MFA_RECOVERY_CODE_USED", nil, c); err != nil {
			return nil, err
		}
		s.events.Record(security.Event{
			Type: "MFA_RECOVERY_CODE_USED", Severity: security.SeverityWarning,
			Message:  user.Email + " masuk memakai recovery code, bukan aplikasi authenticator.",
			TenantID: verified.TenantID, Actor: user.ID, IP: db.StrOr(c.IP, ""),
		})
	}
	return s.completeLogin(ctx, verified.TenantID, *user, c, true, verified.UsedRecoveryCode)
}

// OperatorLogin is US-002. A PIN pad has ten keys, so this is the smallest
// keyspace in the product and the one that most needs a lock, keyed per
// employee number, not per address: the whole plant shares one.
func (s *Service) OperatorLogin(ctx context.Context, tenantID, employeeNumber, pin string, c ClientContext) (*LoginResponse, error) {
	guardKey := tenantID + ":" + strings.ToLower(strings.TrimSpace(employeeNumber))
	if err := security.PinGuard.AssertAvailable(guardKey, "PIN terkunci sementara karena terlalu banyak percobaan. Hubungi supervisor."); err != nil {
		return nil, err
	}
	operator, err := s.master.OperatorByEmployeeNumber(ctx, tenantID, employeeNumber)
	if err != nil {
		return nil, err
	}
	if operator == nil || !security.VerifySecret(pin, operator.PinHash) {
		locked := security.PinGuard.RecordFailure(guardKey)
		action := "OPERATOR_LOGIN_FAILED"
		if locked {
			action = "OPERATOR_LOGIN_LOCKED"
		}
		if err := s.auditLogin(ctx, tenantID, "SYSTEM", employeeNumber, employeeNumber, action, map[string]any{"reason": "INVALID_CREDENTIALS", "locked": locked}, c); err != nil {
			return nil, err
		}
		if locked {
			s.events.Record(security.Event{
				Type: "OPERATOR_LOGIN_LOCKED", Severity: security.SeverityWarning,
				Message:  "PIN operator " + employeeNumber + " dikunci sementara setelah percobaan berulang.",
				TenantID: tenantID, Actor: employeeNumber, IP: db.StrOr(c.IP, ""),
			})
			return nil, httpx.RateLimited("PIN terkunci sementara karena terlalu banyak percobaan. Hubungi supervisor.", 0)
		}
		return nil, httpx.Unauthenticated("Nomor karyawan atau PIN salah.")
	}
	security.PinGuard.RecordSuccess(guardKey)
	if operator.Status != "ACTIVE" {
		return nil, httpx.Forbidden("Operator tidak aktif. Hubungi supervisor.")
	}

	// An operator is scoped to the line they are rostered on, which is what
	// makes "only sees the assigned shop-floor context" true at the API
	// level rather than only in the terminal UI.
	scopeLevel := "TENANT"
	if operator.DefaultLineID != nil {
		scopeLevel = "LINE"
	}
	principal, token, err := s.issue(ctx, auth.KindOperator, tenantID, operator.ID, operator.Name, "OPERATOR", scopeLevel, operator.DefaultLineID)
	if err != nil {
		return nil, err
	}
	if _, err := s.persist(ctx, principal, token, c); err != nil {
		return nil, err
	}
	if err := s.auditLogin(ctx, tenantID, "OPERATOR", operator.ID, operator.ID, "OPERATOR_LOGIN",
		map[string]any{"employeeNumber": operator.EmployeeNumber, "sessionId": principal.SessionID}, c); err != nil {
		return nil, err
	}
	return &LoginResponse{
		Token: token, Principal: principal, Operator: operator,
		IdleTimeoutSeconds: int(auth.Lifetimes[auth.KindOperator].Idle.Seconds()),
	}, nil
}

func (s *Service) issue(ctx context.Context, kind auth.Kind, tenantID, subjectID, name, role, scopeLevel string, scopeID *string) (auth.Principal, string, error) {
	now := time.Now()
	lifetime := auth.Lifetimes[kind]
	permissions, err := s.roles.PermissionsFor(ctx, tenantID, role)
	if err != nil {
		return auth.Principal{}, "", err
	}
	scope, err := s.roles.ResolveScope(ctx, tenantID, scopeLevel, scopeID)
	if err != nil {
		return auth.Principal{}, "", err
	}
	landing := "/terminal"
	if kind != auth.KindOperator {
		if landing, err = s.roles.LandingPathFor(ctx, tenantID, role); err != nil {
			return auth.Principal{}, "", err
		}
	}
	principal := auth.Principal{
		SessionID:     auth.NewSessionID(),
		Kind:          kind,
		TenantID:      tenantID,
		SubjectID:     subjectID,
		Name:          name,
		Role:          role,
		Permissions:   permissions,
		Scope:         scope,
		IssuedAt:      db.ISO(now),
		ExpiresAt:     db.ISO(now.Add(lifetime.Absolute)),
		IdleExpiresAt: db.ISO(now.Add(lifetime.Idle)),
		LandingPath:   landing,
	}
	return principal, auth.NewToken(tenantID), nil
}

// persist writes the session to the store and primes the cache.
func (s *Service) persist(ctx context.Context, principal auth.Principal, token string, c ClientContext) (*auth.StoredSession, error) {
	if err := s.sessions.Insert(ctx, principal, token, c.IP, c.UserAgent); err != nil {
		return nil, err
	}
	stored := &auth.StoredSession{Principal: principal, LastSeenAt: principal.IssuedAt, IP: c.IP, UserAgent: c.UserAgent}
	s.resolver.Prime(token, stored)
	return stored, nil
}

// Logout drops the session and records it.
func (s *Service) Logout(ctx context.Context, p *auth.Principal) error {
	stored, err := s.sessions.FindBySessionID(ctx, p.TenantID, p.SessionID)
	if err != nil {
		return err
	}
	if err := s.sessions.Delete(ctx, p.TenantID, p.SessionID); err != nil {
		return err
	}
	s.resolver.ForgetSession(p.SessionID)
	actorType := "USER"
	if p.Kind == auth.KindOperator {
		actorType = "OPERATOR"
	}
	var ip, ua *string
	if stored != nil {
		ip, ua = stored.IP, stored.UserAgent
	}
	_, err = s.audit.Record(ctx, audit.Entry{
		TenantID: p.TenantID, ActorType: actorType, ActorID: p.SubjectID, EntityType: "auth", EntityID: p.SubjectID,
		Action: "LOGOUT", PreviousValue: map[string]any{"sessionId": p.SessionID}, IP: ip, UserAgent: ua,
	})
	return err
}

// ListSessions is US-005's live session list.
func (s *Service) ListSessions(ctx context.Context, tenantID string, subjectID *string) ([]SessionSummary, error) {
	return s.sessions.List(ctx, tenantID, subjectID)
}

// RevokeSessions drops one session, or every session of one account. The
// delete happens in the store, so the decision outlives this process.
func (s *Service) RevokeSessions(ctx context.Context, tenantID string, sessionID, subjectID *string, actorID string) (int, error) {
	victims, err := s.sessions.DeleteWhere(ctx, tenantID, sessionID, subjectID)
	if err != nil {
		return 0, err
	}
	for _, v := range victims {
		s.resolver.ForgetSession(v.SessionID)
		if _, err := s.audit.Record(ctx, audit.Entry{
			TenantID: tenantID, ActorType: "USER", ActorID: actorID, EntityType: "session", EntityID: v.SessionID,
			Action: "SESSION_REVOKED", PreviousValue: map[string]any{"subjectId": v.SubjectID, "issuedAt": v.IssuedAt},
		}); err != nil {
			return 0, err
		}
	}
	return len(victims), nil
}

// SetUserPassword resets a password and drops the account's sessions.
func (s *Service) SetUserPassword(ctx context.Context, tenantID, userID, password, actorID string) error {
	user, err := s.master.UserByID(ctx, tenantID, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return httpx.NotFound("Pengguna tidak ditemukan.")
	}
	if err := s.policy.AssertPassword(password, ""); err != nil {
		return err
	}
	if err := s.master.SaveUserPassword(ctx, tenantID, userID, security.HashSecret(password)); err != nil {
		return err
	}
	if _, err := s.RevokeSessions(ctx, tenantID, nil, &userID, actorID); err != nil {
		return err
	}
	_, err = s.audit.Record(ctx, audit.Entry{
		TenantID: tenantID, ActorType: "USER", ActorID: actorID, EntityType: "app_user", EntityID: userID,
		Action: "PASSWORD_RESET", NewValue: map[string]any{"by": actorID},
	})
	return err
}

// SetOperatorPin resets a PIN and drops the operator's sessions.
func (s *Service) SetOperatorPin(ctx context.Context, tenantID, operatorID, pin, actorID string) error {
	operator, err := s.master.OperatorByID(ctx, tenantID, operatorID)
	if err != nil {
		return err
	}
	if operator == nil {
		return httpx.NotFound("Operator tidak ditemukan.")
	}
	if err := s.policy.AssertPIN(pin, ""); err != nil {
		return err
	}
	if err := s.master.SaveOperatorPin(ctx, tenantID, operatorID, security.HashSecret(pin), &actorID); err != nil {
		return err
	}
	if _, err := s.RevokeSessions(ctx, tenantID, nil, &operatorID, actorID); err != nil {
		return err
	}
	_, err = s.audit.Record(ctx, audit.Entry{
		TenantID: tenantID, ActorType: "USER", ActorID: actorID, EntityType: "operator", EntityID: operatorID,
		Action: "PIN_RESET", NewValue: map[string]any{"by": actorID},
	})
	return err
}

// RegisterUserPassword sets the initial password of a user created through
// Settings so the account can log in straight away.
func (s *Service) RegisterUserPassword(ctx context.Context, tenantID, userID, password string) error {
	return s.master.SaveUserPassword(ctx, tenantID, userID, security.HashSecret(password))
}

// StartSessionSweeper purges expired rows on an interval. Expired rows are
// already ignored by every read; this only keeps the table from growing.
func (s *Service) StartSessionSweeper(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				removed, err := s.sessions.PurgeExpired(ctx)
				if err != nil {
					s.log.Warn("identity: session purge failed", "error", err)
				} else if removed > 0 {
					s.log.Info("identity: purged expired sessions", "count", removed)
				}
			}
		}
	}()
}

// BootstrapAdminCredential establishes the single bootstrap administrator
// from the environment. No account ships with a password: a deployment that
// reaches the public internet with a known built-in credential is
// compromised the moment anyone recognises the product, so the only way in
// is a password the operator of the install chose themselves.
func (s *Service) BootstrapAdminCredential(ctx context.Context) error {
	email, password := s.cfg.BootstrapAdminEmail, s.cfg.BootstrapAdminPassword
	if email == "" || password == "" {
		s.log.Warn("identity: no BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD set, no account can sign in. Set both and restart to create the first administrator.")
		return nil
	}
	if problem := s.policy.Describe(password, "password"); problem != "" {
		s.log.Warn("identity: BOOTSTRAP_ADMIN_PASSWORD rejected; no account can sign in until it is fixed", "problem", problem)
		return nil
	}
	tenantID := config.PilotTenant
	users, err := s.master.Users(ctx, tenantID)
	if err != nil {
		return err
	}
	var user *masterdata.User
	for i := range users {
		if strings.EqualFold(users[i].Email, email) {
			user = &users[i]
		}
	}
	if user == nil {
		created, err := s.master.CreateUser(ctx, tenantID, masterdata.User{
			Email: email, Name: s.cfg.BootstrapAdminName, Role: "ADMIN",
			AccountType: "APPLICATION_USER", ScopeLevel: "TENANT", Status: "ACTIVE",
		}, nil)
		if err != nil {
			return err
		}
		user = &created
	}
	if err := s.master.SaveUserPassword(ctx, tenantID, user.ID, security.HashSecret(password)); err != nil {
		return err
	}
	s.log.Info("identity: bootstrap administrator ready", "email", user.Email)

	// A shared starting PIN for the shop-floor terminals is offered only
	// when the installer asks for one. Applying it to every operator on every
	// boot would silently reset a PIN an administrator had issued, so only
	// operators with no PIN receive it.
	if pin := s.cfg.BootstrapOperatorPIN; pin != "" {
		if problem := s.policy.Describe(pin, "pin"); problem != "" {
			s.log.Warn("identity: BOOTSTRAP_OPERATOR_PIN rejected; no starting PIN was applied", "problem", problem)
			return nil
		}
		operators, err := s.master.Operators(ctx, tenantID)
		if err != nil {
			return err
		}
		seeded := 0
		for _, op := range operators {
			if op.PinHash != nil {
				continue
			}
			by := "bootstrap"
			if err := s.master.SaveOperatorPin(ctx, tenantID, op.ID, security.HashSecret(pin), &by); err != nil {
				return err
			}
			seeded++
		}
		if seeded > 0 {
			s.log.Info("identity: shop-floor terminals seeded with the configured starting PIN", "count", seeded)
		}
	}
	return nil
}
