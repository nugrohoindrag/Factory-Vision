package clientmgmt

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/jsnum"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/security"
)

// A renewal inside this many days is worth surfacing before it lapses.
const renewalWarningDays = 30

// Silence for longer than this is the earliest visible sign of churn.
const inactivityWarningDays = 14

// A support grant lives at most this long, however long was asked for.
const maxSupportHours = 72

const (
	sessionHours = 8
	idleMinutes  = 30
)

// Limits is the TypeScript EffectiveLimits.
type Limits struct {
	MaxPlants          *int `json:"maxPlants"`
	MaxProductionLines *int `json:"maxProductionLines"`
	MaxMachines        *int `json:"maxMachines"`
	MaxUsers           *int `json:"maxUsers"`
	MaxOperators       *int `json:"maxOperators"`
}

// LimitUsage is one dimension's used/limit.
type LimitUsage struct {
	Used           int      `json:"used"`
	Limit          *int     `json:"limit"`
	UtilisationPct *float64 `json:"utilisationPct"`
	Exceeded       bool     `json:"exceeded"`
}

// LimitReport is the TypeScript ClientLimitReport.
type LimitReport struct {
	Plants          LimitUsage `json:"plants"`
	ProductionLines LimitUsage `json:"productionLines"`
	Machines        LimitUsage `json:"machines"`
	Users           LimitUsage `json:"users"`
	Operators       LimitUsage `json:"operators"`
}

// Attention is one thing an account manager should look at.
type Attention struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// Overview is the TypeScript ClientOverview.
type Overview struct {
	Client            Client        `json:"client"`
	Subscription      *Subscription `json:"subscription"`
	Limits            Limits        `json:"limits"`
	Usage             *Usage        `json:"usage"`
	LimitReport       *LimitReport  `json:"limitReport"`
	DaysToRenewal     *int          `json:"daysToRenewal"`
	DaysSinceActivity *int          `json:"daysSinceActivity"`
	Attention         []Attention   `json:"attention"`
}

// PortfolioSummary is the TypeScript ClientPortfolioSummary.
type PortfolioSummary struct {
	TotalClients                 int            `json:"totalClients"`
	ByStatus                     map[string]int `json:"byStatus"`
	MonthlyRecurringIdr          float64        `json:"monthlyRecurringIdr"`
	RenewalsDue30d               int            `json:"renewalsDue30d"`
	ClientsOverLimit             int            `json:"clientsOverLimit"`
	ClientsWithoutRecentActivity int            `json:"clientsWithoutRecentActivity"`
	OpenSupportGrants            int            `json:"openSupportGrants"`
}

// Principal is a vendor staff session.
type Principal struct {
	SessionID     string `json:"sessionId"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Role          string `json:"role"`
	IssuedAt      string `json:"issuedAt"`
	ExpiresAt     string `json:"expiresAt"`
	IdleExpiresAt string `json:"idleExpiresAt"`
}

// Actor is who performed a vendor-side action.
type Actor struct {
	Email string
	IP    *string
}

// What each internal role may do. Support cannot change commercial terms.
var roleRights = map[string][]string{
	"OWNER":           {"client:view", "client:manage", "subscription:manage", "support:grant", "audit:view", "staff:manage", "cms:view", "cms:manage"},
	"ACCOUNT_MANAGER": {"client:view", "client:manage", "subscription:manage", "support:grant", "audit:view", "cms:view", "cms:manage"},
	"SUPPORT":         {"client:view", "support:grant", "audit:view", "cms:view"},
}

// Service is the vendor console: reads, writes and its own authentication.
// Deliberately a separate store and a separate session type from the
// customer identity service: a customer's administrator has full rights
// inside their own tenant, and if the two shared a table or a token
// namespace, a role edit there could become vendor-wide access here.
type Service struct {
	pool   *db.Pool
	repo   Repository
	events *security.Events
	policy security.Policy
	log    *slog.Logger
	now    func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, events *security.Events, policy security.Policy, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{pool: pool, events: events, policy: policy, log: log, now: time.Now}
}

func (s *Service) tx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return s.pool.WithoutTenant(ctx, fn)
}

// --- Authentication -------------------------------------------------------------

// Bootstrap creates the first vendor administrator from the environment;
// no internal account ships with a password.
func (s *Service) Bootstrap(ctx context.Context, email, password, name string) error {
	email = strings.TrimSpace(email)
	if email == "" || password == "" {
		s.log.Warn("[internal-auth] INTERNAL_ADMIN_EMAIL / INTERNAL_ADMIN_PASSWORD not set. The admin console has no way in.")
		return nil
	}
	if problem := s.policy.Describe(password); problem != "" {
		s.log.Warn("[internal-auth] INTERNAL_ADMIN_PASSWORD rejected: " + problem + " The admin console has no way in.")
		return nil
	}
	if strings.TrimSpace(name) == "" {
		name = "Internal Administrator"
	}
	hash := security.HashSecret(password)
	if err := s.tx(ctx, func(tx pgx.Tx) error {
		_, err := s.repo.UpsertStaff(ctx, tx, email, name, "OWNER", &hash)
		return err
	}); err != nil {
		return err
	}
	s.log.Info("[internal-auth] Internal administrator ready", "email", email)
	return nil
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Login issues a vendor session; a missing account and a wrong password
// fail identically, and the lock is stricter than a factory's own (§58).
func (s *Service) Login(ctx context.Context, email, password string, ip *string) (string, Principal, error) {
	guardKey := strings.ToLower(strings.TrimSpace(email))
	if err := security.InternalLoginGuard.AssertAvailable(guardKey, "Terlalu banyak percobaan login. Coba lagi dalam beberapa menit."); err != nil {
		return "", Principal{}, err
	}
	var user *storedStaff
	if err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		user, err = s.repo.StaffByEmail(ctx, tx, email)
		return err
	}); err != nil {
		return "", Principal{}, err
	}
	if user == nil || !security.VerifySecret(password, user.PasswordHash) {
		locked := security.InternalLoginGuard.RecordFailure(guardKey)
		action := "INTERNAL_LOGIN_FAILED"
		if locked {
			action = "INTERNAL_LOGIN_LOCKED"
		}
		if err := s.tx(ctx, func(tx pgx.Tx) error {
			return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: email, Action: action, EntityType: "internal_user", IP: ip})
		}); err != nil {
			return "", Principal{}, err
		}
		if locked {
			s.events.Record(security.Event{Type: "INTERNAL_LOGIN_LOCKED", Severity: security.SeverityCritical, Message: "Konsol internal: " + email + " dikunci setelah percobaan login berulang.", Actor: email, IP: db.Deref(ip, "")})
			return "", Principal{}, httpx.RateLimited("Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.", 0)
		}
		return "", Principal{}, httpx.Unauthenticated("Email atau kata sandi salah.")
	}
	if user.Status != "ACTIVE" {
		return "", Principal{}, httpx.Forbidden("Akun internal Anda tidak aktif.")
	}
	security.InternalLoginGuard.RecordSuccess(guardKey)

	now := s.now()
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", Principal{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	idRaw := make([]byte, 9)
	if _, err := rand.Read(idRaw); err != nil {
		return "", Principal{}, err
	}
	principal := Principal{SessionID: "ises-" + hex.EncodeToString(idRaw), Email: user.Email, Name: user.Name, Role: user.Role, IssuedAt: db.ISO(now),
		ExpiresAt: db.ISO(now.Add(sessionHours * time.Hour)), IdleExpiresAt: db.ISO(now.Add(idleMinutes * time.Minute))}
	if err := s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO internal_session (id, token_hash, email, name, role, issued_at, expires_at, idle_expires_at, ip)
			VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9)`,
			principal.SessionID, tokenHash(token), principal.Email, principal.Name, principal.Role, principal.IssuedAt, principal.ExpiresAt, principal.IdleExpiresAt, ip); err != nil {
			return err
		}
		if err := s.repo.TouchLogin(ctx, tx, user.Email); err != nil {
			return err
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: user.Email, Action: "INTERNAL_LOGIN", EntityType: "internal_user", EntityID: db.Ptr(user.ID), IP: ip})
	}); err != nil {
		return "", Principal{}, err
	}
	return token, principal, nil
}

// Resolve turns a bearer token into a principal, sliding the idle window;
// nil when the token is unknown or expired.
func (s *Service) Resolve(ctx context.Context, token string) (*Principal, error) {
	if token == "" {
		return nil, nil
	}
	var out *Principal
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var p Principal
		var issued, expires, idle time.Time
		err := tx.QueryRow(ctx, `SELECT id, email, name, role, issued_at, expires_at, idle_expires_at FROM internal_session WHERE token_hash = $1`, tokenHash(token)).
			Scan(&p.SessionID, &p.Email, &p.Name, &p.Role, &issued, &expires, &idle)
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		now := s.now()
		if now.After(expires) || now.After(idle) {
			_, err := tx.Exec(ctx, `DELETE FROM internal_session WHERE id = $1`, p.SessionID)
			return err
		}
		newIdle := now.Add(idleMinutes * time.Minute)
		if _, err := tx.Exec(ctx, `UPDATE internal_session SET idle_expires_at = $2 WHERE id = $1`, p.SessionID, newIdle); err != nil {
			return err
		}
		p.IssuedAt, p.ExpiresAt, p.IdleExpiresAt = db.ISO(issued), db.ISO(expires), db.ISO(newIdle)
		out = &p
		return nil
	})
	return out, err
}

// Logout ends a session.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM internal_session WHERE id = $1`, sessionID)
		return err
	})
}

// Assert requires a principal with the right.
func Assert(p *Principal, right string) error {
	if p == nil {
		return httpx.Unauthenticated("")
	}
	for _, r := range roleRights[p.Role] {
		if r == right {
			return nil
		}
	}
	return httpx.Forbidden(fmt.Sprintf("Peran %s tidak memiliki izin %s.", p.Role, right))
}

// Staff lists the vendor's staff.
func (s *Service) Staff(ctx context.Context) ([]Staff, error) {
	var out []Staff
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.StaffList(ctx, tx)
		return err
	})
	return out, err
}

// --- Reads ----------------------------------------------------------------------

// Plans lists the active plans.
func (s *Service) Plans(ctx context.Context) ([]Plan, error) {
	var out []Plan
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.Plans(ctx, tx)
		return err
	})
	return out, err
}

func pick(override, planLimit *int) *int {
	if override != nil {
		return override
	}
	return planLimit
}

// effectiveLimits: a per-client override beats the plan's ceiling.
func effectiveLimits(plan *Plan, sub *Subscription) Limits {
	var l Limits
	var p Plan
	if plan != nil {
		p = *plan
	}
	var su Subscription
	if sub != nil {
		su = *sub
	}
	l.MaxPlants = pick(su.OverrideMaxPlants, p.MaxPlants)
	l.MaxProductionLines = pick(su.OverrideMaxProductionLines, p.MaxProductionLines)
	l.MaxMachines = pick(su.OverrideMaxMachines, p.MaxMachines)
	l.MaxUsers = pick(su.OverrideMaxUsers, p.MaxUsers)
	l.MaxOperators = pick(su.OverrideMaxOperators, p.MaxOperators)
	return l
}

func limitUsage(used int, limit *int) LimitUsage {
	u := LimitUsage{Used: used, Limit: limit}
	if limit != nil && *limit > 0 {
		u.UtilisationPct = db.Ptr(jsnum.Round1(float64(used) / float64(*limit) * 100))
	}
	u.Exceeded = limit != nil && used > *limit
	return u
}

func limitReport(u Usage, l Limits) *LimitReport {
	return &LimitReport{Plants: limitUsage(u.Plants, l.MaxPlants), ProductionLines: limitUsage(u.ProductionLines, l.MaxProductionLines), Machines: limitUsage(u.Machines, l.MaxMachines),
		Users: limitUsage(u.Users, l.MaxUsers), Operators: limitUsage(u.Operators, l.MaxOperators)}
}

func daysBetween(from, to time.Time) int {
	return int(math.Round(to.Sub(from).Hours() / 24))
}

// attentionFor lists what an account manager should look at, ordered by
// how much it costs to ignore.
func attentionFor(o Overview, openGrants int) []Attention {
	items := []Attention{}
	if o.Subscription != nil && o.DaysToRenewal != nil && *o.DaysToRenewal < 0 {
		items = append(items, Attention{"SUBSCRIPTION_LAPSED", "CRITICAL", fmt.Sprintf("Langganan lewat tanggal perpanjangan %d hari lalu.", -*o.DaysToRenewal)})
	} else if o.DaysToRenewal != nil && *o.DaysToRenewal <= renewalWarningDays {
		items = append(items, Attention{"RENEWAL_DUE", "WARNING", fmt.Sprintf("Perpanjangan jatuh tempo dalam %d hari.", *o.DaysToRenewal)})
	}
	if o.LimitReport != nil {
		var over []string
		for _, entry := range []struct {
			key string
			u   LimitUsage
		}{{"plants", o.LimitReport.Plants}, {"productionLines", o.LimitReport.ProductionLines}, {"machines", o.LimitReport.Machines}, {"users", o.LimitReport.Users}, {"operators", o.LimitReport.Operators}} {
			if entry.u.Exceeded {
				over = append(over, entry.key)
			}
		}
		if len(over) > 0 {
			items = append(items, Attention{"LIMIT_EXCEEDED", "WARNING", "Melebihi batas paket pada: " + strings.Join(over, ", ") + "."})
		}
	}
	if o.DaysSinceActivity != nil && *o.DaysSinceActivity >= inactivityWarningDays {
		severity := "INFORMATIONAL"
		if o.Client.LifecycleStatus == "ACTIVE" {
			severity = "WARNING"
		}
		items = append(items, Attention{"NO_RECENT_ACTIVITY", severity, fmt.Sprintf("Tidak ada aktivitas tercatat selama %d hari.", *o.DaysSinceActivity)})
	}
	if o.Client.LifecycleStatus == "TRIAL" && o.DaysToRenewal != nil && *o.DaysToRenewal <= 14 {
		items = append(items, Attention{"TRIAL_ENDING", "WARNING", fmt.Sprintf("Masa trial berakhir dalam %d hari.", *o.DaysToRenewal)})
	}
	if openGrants > 0 {
		items = append(items, Attention{"SUPPORT_ACCESS_OPEN", "INFORMATIONAL", fmt.Sprintf("%d akses dukungan masih aktif ke data klien ini.", openGrants)})
	}
	return items
}

func (s *Service) overview(ctx context.Context, tx pgx.Tx, client Client, plans map[string]Plan, usage *Usage, openGrants int) (Overview, error) {
	sub, err := s.repo.CurrentSubscription(ctx, tx, client.ID)
	if err != nil {
		return Overview{}, err
	}
	var plan *Plan
	if sub != nil {
		if p, ok := plans[sub.PlanID]; ok {
			plan = &p
		}
	}
	o := Overview{Client: client, Subscription: sub, Limits: effectiveLimits(plan, sub), Usage: usage}
	now := s.now()
	if sub != nil && sub.RenewsAt != nil {
		if renews, err := time.Parse("2006-01-02", *sub.RenewsAt); err == nil {
			o.DaysToRenewal = db.Ptr(daysBetween(now, renews))
		}
	}
	if usage != nil {
		o.LimitReport = limitReport(*usage, o.Limits)
		if usage.LastActivityAt != nil {
			if last, err := db.ParseISO(*usage.LastActivityAt); err == nil {
				o.DaysSinceActivity = db.Ptr(daysBetween(last, now))
			}
		}
	}
	o.Attention = attentionFor(o, openGrants)
	return o, nil
}

func planIndex(plans []Plan) map[string]Plan {
	out := map[string]Plan{}
	for _, p := range plans {
		out[p.ID] = p
	}
	return out
}

// Clients lists overviews, anything needing action first.
func (s *Service) Clients(ctx context.Context, status, search string) ([]Overview, error) {
	var out []Overview
	err := s.tx(ctx, func(tx pgx.Tx) error {
		accounts, err := s.repo.Clients(ctx, tx, status, search)
		if err != nil {
			return err
		}
		plans, err := s.repo.Plans(ctx, tx)
		if err != nil {
			return err
		}
		latest, err := s.repo.LatestUsageForAll(ctx, tx)
		if err != nil {
			return err
		}
		active, err := s.repo.ActiveGrants(ctx, tx, s.now())
		if err != nil {
			return err
		}
		grants := map[string]int{}
		for _, g := range active {
			grants[g.ClientID]++
		}
		index := planIndex(plans)
		out = []Overview{}
		for _, c := range accounts {
			var usage *Usage
			if u, ok := latest[c.ID]; ok {
				usage = &u
			}
			o, err := s.overview(ctx, tx, c, index, usage, grants[c.ID])
			if err != nil {
				return err
			}
			out = append(out, o)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	weight := func(o Overview) int {
		for _, a := range o.Attention {
			if a.Severity == "CRITICAL" {
				return 0
			}
		}
		if len(o.Attention) > 0 {
			return 1
		}
		return 2
	}
	sort.SliceStable(out, func(i, j int) bool {
		wi, wj := weight(out[i]), weight(out[j])
		if wi != wj {
			return wi < wj
		}
		return jsnum.LocaleLess(out[i].Client.DisplayName, out[j].Client.DisplayName)
	})
	return out, nil
}

// ClientByID is one overview.
func (s *Service) ClientByID(ctx context.Context, id string) (Overview, error) {
	var out Overview
	err := s.tx(ctx, func(tx pgx.Tx) error {
		client, err := s.repo.ClientByID(ctx, tx, id)
		if err != nil {
			return err
		}
		if client == nil {
			return httpx.NotFound("Klien tidak ditemukan.")
		}
		plans, err := s.repo.Plans(ctx, tx)
		if err != nil {
			return err
		}
		usage, err := s.repo.LatestUsage(ctx, tx, id)
		if err != nil {
			return err
		}
		grants, err := s.repo.GrantsFor(ctx, tx, id, s.now())
		if err != nil {
			return err
		}
		open := 0
		for _, g := range grants {
			if g.Active {
				open++
			}
		}
		out, err = s.overview(ctx, tx, *client, planIndex(plans), usage, open)
		return err
	})
	return out, err
}

// Portfolio is the summary the vendor console opens on.
func (s *Service) Portfolio(ctx context.Context) (PortfolioSummary, error) {
	overviews, err := s.Clients(ctx, "", "")
	if err != nil {
		return PortfolioSummary{}, err
	}
	summary := PortfolioSummary{ByStatus: map[string]int{"PROSPECT": 0, "TRIAL": 0, "ACTIVE": 0, "SUSPENDED": 0, "CHURNED": 0}, TotalClients: len(overviews)}
	err = s.tx(ctx, func(tx pgx.Tx) error {
		plans, err := s.repo.Plans(ctx, tx)
		if err != nil {
			return err
		}
		index := planIndex(plans)
		for _, o := range overviews {
			summary.ByStatus[o.Client.LifecycleStatus]++
			// Only a live subscription is revenue; a trial or a lapsed one is not.
			if o.Subscription != nil && o.Subscription.Status == "ACTIVE" && o.Client.LifecycleStatus == "ACTIVE" {
				if p, ok := index[o.Subscription.PlanID]; ok && p.MonthlyPriceIdr != nil {
					summary.MonthlyRecurringIdr += *p.MonthlyPriceIdr
				}
			}
			if o.DaysToRenewal != nil && *o.DaysToRenewal >= 0 && *o.DaysToRenewal <= renewalWarningDays {
				summary.RenewalsDue30d++
			}
			for _, a := range o.Attention {
				if a.Kind == "LIMIT_EXCEEDED" {
					summary.ClientsOverLimit++
				}
				if a.Kind == "NO_RECENT_ACTIVITY" {
					summary.ClientsWithoutRecentActivity++
				}
			}
		}
		active, err := s.repo.ActiveGrants(ctx, tx, s.now())
		if err != nil {
			return err
		}
		summary.OpenSupportGrants = len(active)
		return nil
	})
	return summary, err
}

// CaptureUsage samples what each client's tenant holds, one snapshot per
// client per day, counted from the tenant's rows under its own RLS context.
func (s *Service) CaptureUsage(ctx context.Context, actorEmail string) ([]Usage, error) {
	if actorEmail == "" {
		actorEmail = "system"
	}
	var accounts []Client
	if err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		accounts, err = s.repo.Clients(ctx, tx, "", "")
		return err
	}); err != nil {
		return nil, err
	}
	capturedOn := db.ISO(s.now())[:10]
	captured := []Usage{}
	for _, c := range accounts {
		u := Usage{ClientID: c.ID, CapturedOn: capturedOn}
		var last *time.Time
		if err := s.pool.WithTenant(ctx, c.TenantID, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT
				(SELECT count(*) FROM plant WHERE tenant_id = $1), (SELECT count(*) FROM production_line WHERE tenant_id = $1), (SELECT count(*) FROM machine WHERE tenant_id = $1),
				(SELECT count(*) FROM product WHERE tenant_id = $1), (SELECT count(*) FROM app_user WHERE tenant_id = $1), (SELECT count(*) FROM operator WHERE tenant_id = $1),
				(SELECT count(*) FROM app_user WHERE tenant_id = $1 AND last_login_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'),
				(SELECT count(*) FROM work_order WHERE tenant_id = $1), (SELECT count(*) FROM production_record WHERE tenant_id = $1), (SELECT count(*) FROM downtime_record WHERE tenant_id = $1),
				(SELECT count(*) FROM device_terminal WHERE tenant_id = $1 AND status = 'ONLINE'),
				GREATEST((SELECT max(recorded_at) FROM production_record WHERE tenant_id = $1), (SELECT max(start_time) FROM downtime_record WHERE tenant_id = $1), (SELECT max(last_login_at) FROM app_user WHERE tenant_id = $1))`, c.TenantID).
				Scan(&u.Plants, &u.ProductionLines, &u.Machines, &u.Products, &u.Users, &u.Operators, &u.ActiveUsers7d, &u.WorkOrdersCreated, &u.ProductionRecords, &u.DowntimeRecords, &u.TerminalsOnline, &last)
		}); err != nil {
			return nil, err
		}
		u.LastActivityAt = db.ISOPtr(last)
		if err := s.tx(ctx, func(tx pgx.Tx) error { return s.repo.RecordUsage(ctx, tx, u) }); err != nil {
			return nil, err
		}
		captured = append(captured, u)
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actorEmail, Action: "USAGE_CAPTURED", EntityType: "client_usage_snapshot", NewValue: map[string]any{"clients": len(captured), "capturedOn": capturedOn}})
	})
	return captured, err
}

// UsageHistory is a client's snapshots.
func (s *Service) UsageHistory(ctx context.Context, clientID string, days int) ([]Usage, error) {
	var out []Usage
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.UsageHistory(ctx, tx, clientID, days)
		return err
	})
	return out, err
}

// --- Writes: every method changes a commercial fact and writes an audit row ----

// CreateClient creates the tenant, the account and its first subscription.
func (s *Service) CreateClient(ctx context.Context, in CreateClientInput, actor Actor) (Client, Subscription, error) {
	var client Client
	var sub Subscription
	err := s.tx(ctx, func(tx pgx.Tx) error {
		plan, err := s.repo.PlanByID(ctx, tx, in.PlanID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.Validation("Paket langganan tidak dikenal.")
		}
		client, sub, err = s.repo.CreateClient(ctx, tx, in)
		if err != nil {
			return err
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "CLIENT_CREATED", EntityType: "client_account", EntityID: &client.ID, ClientID: &client.ID, IP: actor.IP,
			NewValue: map[string]any{"displayName": client.DisplayName, "tenantId": client.TenantID, "plan": plan.Code, "lifecycleStatus": client.LifecycleStatus}})
	})
	return client, sub, err
}

// UpdateClient patches an account.
func (s *Service) UpdateClient(ctx context.Context, id string, p ClientPatch, actor Actor) (Client, error) {
	var out Client
	err := s.tx(ctx, func(tx pgx.Tx) error {
		before, err := s.repo.ClientByID(ctx, tx, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Klien tidak ditemukan.")
		}
		after, err := s.repo.UpdateClient(ctx, tx, id, p)
		if err != nil {
			return err
		}
		if after == nil {
			return httpx.NotFound("Klien tidak ditemukan.")
		}
		out = *after
		action := "CLIENT_UPDATED"
		if before.LifecycleStatus != after.LifecycleStatus {
			action = "CLIENT_STATUS_CHANGED"
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: action, EntityType: "client_account", EntityID: &id, ClientID: &id, PreviousValue: before, NewValue: after, IP: actor.IP})
	})
	return out, err
}

// SetLifecycleStatus changes status; suspending stops the subscription too,
// so a suspended account is not counted as revenue.
func (s *Service) SetLifecycleStatus(ctx context.Context, id, status string, actor Actor) (Client, error) {
	updated, err := s.UpdateClient(ctx, id, ClientPatch{LifecycleStatus: &status}, actor)
	if err != nil {
		return Client{}, err
	}
	next := ""
	switch status {
	case "SUSPENDED":
		next = "PAST_DUE"
	case "CHURNED":
		next = "CANCELLED"
	}
	if next != "" {
		if err := s.tx(ctx, func(tx pgx.Tx) error { return s.repo.SetSubscriptionStatus(ctx, tx, id, next) }); err != nil {
			return Client{}, err
		}
	}
	return updated, nil
}

// ChangePlan ends the running subscription and starts a new one.
func (s *Service) ChangePlan(ctx context.Context, in ChangePlanInput, actor Actor) (Subscription, error) {
	var out Subscription
	err := s.tx(ctx, func(tx pgx.Tx) error {
		client, err := s.repo.ClientByID(ctx, tx, in.ClientID)
		if err != nil {
			return err
		}
		if client == nil {
			return httpx.NotFound("Klien tidak ditemukan.")
		}
		plan, err := s.repo.PlanByID(ctx, tx, in.PlanID)
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.Validation("Paket langganan tidak dikenal.")
		}
		previous, err := s.repo.CurrentSubscription(ctx, tx, in.ClientID)
		if err != nil {
			return err
		}
		out, err = s.repo.ChangePlan(ctx, tx, in)
		if err != nil {
			return err
		}
		var prev any
		if previous != nil {
			prev = previous
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "SUBSCRIPTION_CHANGED", EntityType: "client_subscription", EntityID: &out.ID, ClientID: &in.ClientID, PreviousValue: prev, NewValue: out, IP: actor.IP})
	})
	return out, err
}

// SubscriptionHistory is a client's subscriptions.
func (s *Service) SubscriptionHistory(ctx context.Context, clientID string) ([]Subscription, error) {
	var out []Subscription
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.Subscriptions(ctx, tx, clientID)
		return err
	})
	return out, err
}

// GrantInput is a support access request.
type GrantInput struct {
	ClientID, GrantedTo, Reason, AccessLevel string
	Hours                                    int
}

// GrantSupportAccess issues time-boxed access; the ceiling is enforced here
// rather than trusted from the request.
func (s *Service) GrantSupportAccess(ctx context.Context, in GrantInput, actor Actor) (Grant, error) {
	if len(strings.TrimSpace(in.Reason)) < 10 {
		return Grant{}, httpx.Validation("Alasan akses harus dijelaskan, minimal 10 karakter.", httpx.FieldError{Field: "reason", Code: "TOO_SHORT", Message: "Tuliskan alasan akses yang dapat diaudit."})
	}
	hours := in.Hours
	if hours < 1 {
		hours = 1
	}
	if hours > maxSupportHours {
		hours = maxSupportHours
	}
	var out Grant
	err := s.tx(ctx, func(tx pgx.Tx) error {
		client, err := s.repo.ClientByID(ctx, tx, in.ClientID)
		if err != nil {
			return err
		}
		if client == nil {
			return httpx.NotFound("Klien tidak ditemukan.")
		}
		now := s.now()
		out, err = s.repo.Grant(ctx, tx, in.ClientID, in.GrantedTo, actor.Email, strings.TrimSpace(in.Reason), in.AccessLevel, db.ISO(now.Add(time.Duration(hours)*time.Hour)), now)
		if err != nil {
			return err
		}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "SUPPORT_ACCESS_GRANTED", EntityType: "support_access_grant", EntityID: &out.ID, ClientID: &in.ClientID, IP: actor.IP,
			NewValue: map[string]any{"grantedTo": out.GrantedTo, "accessLevel": out.AccessLevel, "expiresAt": out.ExpiresAt, "reason": out.Reason}})
	})
	return out, err
}

// RevokeSupportAccess ends a live grant.
func (s *Service) RevokeSupportAccess(ctx context.Context, grantID string, actor Actor) (Grant, error) {
	var out Grant
	err := s.tx(ctx, func(tx pgx.Tx) error {
		g, err := s.repo.Revoke(ctx, tx, grantID, actor.Email, s.now())
		if err != nil {
			return err
		}
		if g == nil {
			return httpx.NotFound("Akses dukungan tidak ditemukan atau sudah dicabut.")
		}
		out = *g
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "SUPPORT_ACCESS_REVOKED", EntityType: "support_access_grant", EntityID: &grantID, ClientID: &g.ClientID, IP: actor.IP,
			PreviousValue: map[string]any{"expiresAt": g.ExpiresAt, "grantedTo": g.GrantedTo}})
	})
	return out, err
}

// SupportAccessFor lists a client's grants.
func (s *Service) SupportAccessFor(ctx context.Context, clientID string) ([]Grant, error) {
	var out []Grant
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.GrantsFor(ctx, tx, clientID, s.now())
		return err
	})
	return out, err
}

// ActiveSupportAccess lists every live grant.
func (s *Service) ActiveSupportAccess(ctx context.Context) ([]Grant, error) {
	var out []Grant
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ActiveGrants(ctx, tx, s.now())
		return err
	})
	return out, err
}

// UseSupportAccess exchanges a live grant for the tenant it opens — the only
// path from the vendor console into customer data, and it records the use.
func (s *Service) UseSupportAccess(ctx context.Context, grantID string, actor Actor) (map[string]any, error) {
	var out map[string]any
	err := s.tx(ctx, func(tx pgx.Tx) error {
		active, err := s.repo.ActiveGrants(ctx, tx, s.now())
		if err != nil {
			return err
		}
		var grant *Grant
		for i := range active {
			if active[i].ID == grantID {
				grant = &active[i]
			}
		}
		if grant == nil {
			return httpx.Forbidden("Akses dukungan tidak aktif atau sudah kedaluwarsa.")
		}
		if !strings.EqualFold(grant.GrantedTo, actor.Email) {
			return httpx.Forbidden("Akses dukungan ini diberikan kepada orang lain.")
		}
		client, err := s.repo.ClientByID(ctx, tx, grant.ClientID)
		if err != nil {
			return err
		}
		if client == nil {
			return httpx.NotFound("Klien tidak ditemukan.")
		}
		if err := s.repo.MarkUsed(ctx, tx, grantID); err != nil {
			return err
		}
		out = map[string]any{"tenantId": client.TenantID, "accessLevel": grant.AccessLevel, "expiresAt": grant.ExpiresAt}
		return s.repo.RecordAudit(ctx, tx, AuditInput{ActorEmail: actor.Email, Action: "SUPPORT_ACCESS_USED", EntityType: "support_access_grant", EntityID: &grantID, ClientID: &grant.ClientID, IP: actor.IP,
			NewValue: map[string]any{"tenantId": client.TenantID, "accessLevel": grant.AccessLevel}})
	})
	return out, err
}

// AuditTrail lists vendor-side actions.
func (s *Service) AuditTrail(ctx context.Context, clientID string, limit int) ([]AuditEntry, error) {
	var out []AuditEntry
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.AuditTrail(ctx, tx, clientID, limit)
		return err
	})
	return out, err
}
