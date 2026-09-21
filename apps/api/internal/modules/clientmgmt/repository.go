// Package clientmgmt is the vendor's own API under /api/internal/v1: the
// client portfolio, subscriptions, usage snapshots, time-boxed support
// access, the internal staff and their audit trail.
//
// A separate prefix from /api/v1 on purpose: the customer-facing
// authorization table never grants anything here, and nothing here is
// reachable with a customer's token. The vendor tables carry no tenant and
// no RLS; every read here runs WithoutTenant.
package clientmgmt

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Plan is the TypeScript SubscriptionPlan.
type Plan struct {
	ID                 string   `json:"id"`
	Code               string   `json:"code"`
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	MaxPlants          *int     `json:"maxPlants"`
	MaxProductionLines *int     `json:"maxProductionLines"`
	MaxMachines        *int     `json:"maxMachines"`
	MaxUsers           *int     `json:"maxUsers"`
	MaxOperators       *int     `json:"maxOperators"`
	MonthlyPriceIdr    *float64 `json:"monthlyPriceIdr"`
	Active             bool     `json:"active"`
}

// Client is the TypeScript ClientAccount.
type Client struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	LegalName       string  `json:"legalName"`
	DisplayName     string  `json:"displayName"`
	Industry        *string `json:"industry"`
	City            *string `json:"city"`
	Country         string  `json:"country"`
	ContactName     *string `json:"contactName"`
	ContactEmail    *string `json:"contactEmail"`
	ContactPhone    *string `json:"contactPhone"`
	AccountManager  *string `json:"accountManager"`
	LifecycleStatus string  `json:"lifecycleStatus"`
	DeploymentMode  string  `json:"deploymentMode"`
	OnboardedAt     *string `json:"onboardedAt"`
	Notes           *string `json:"notes"`
	// The referral code that admitted a trial; nil for accounts the vendor
	// created by hand.
	ReferralCode *string `json:"referralCode"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

// Subscription is the TypeScript ClientSubscription.
type Subscription struct {
	ID                         string  `json:"id"`
	ClientID                   string  `json:"clientId"`
	PlanID                     string  `json:"planId"`
	PlanCode                   string  `json:"planCode"`
	PlanName                   string  `json:"planName"`
	Status                     string  `json:"status"`
	StartedAt                  string  `json:"startedAt"`
	RenewsAt                   *string `json:"renewsAt"`
	EndedAt                    *string `json:"endedAt"`
	OverrideMaxPlants          *int    `json:"overrideMaxPlants"`
	OverrideMaxProductionLines *int    `json:"overrideMaxProductionLines"`
	OverrideMaxMachines        *int    `json:"overrideMaxMachines"`
	OverrideMaxUsers           *int    `json:"overrideMaxUsers"`
	OverrideMaxOperators       *int    `json:"overrideMaxOperators"`
}

// Usage is the TypeScript ClientUsageSnapshot.
type Usage struct {
	ClientID          string  `json:"clientId"`
	CapturedOn        string  `json:"capturedOn"`
	Plants            int     `json:"plants"`
	ProductionLines   int     `json:"productionLines"`
	Machines          int     `json:"machines"`
	Products          int     `json:"products"`
	Users             int     `json:"users"`
	Operators         int     `json:"operators"`
	ActiveUsers7d     int     `json:"activeUsers7d"`
	WorkOrdersCreated int     `json:"workOrdersCreated"`
	ProductionRecords int     `json:"productionRecords"`
	DowntimeRecords   int     `json:"downtimeRecords"`
	TerminalsOnline   int     `json:"terminalsOnline"`
	LastActivityAt    *string `json:"lastActivityAt"`
}

// Grant is the TypeScript SupportAccessGrant.
type Grant struct {
	ID          string  `json:"id"`
	ClientID    string  `json:"clientId"`
	GrantedTo   string  `json:"grantedTo"`
	GrantedBy   string  `json:"grantedBy"`
	Reason      string  `json:"reason"`
	AccessLevel string  `json:"accessLevel"`
	GrantedAt   string  `json:"grantedAt"`
	ExpiresAt   string  `json:"expiresAt"`
	RevokedAt   *string `json:"revokedAt"`
	RevokedBy   *string `json:"revokedBy"`
	LastUsedAt  *string `json:"lastUsedAt"`
	UseCount    int     `json:"useCount"`
	Active      bool    `json:"active"`
}

// Staff is the TypeScript InternalUser.
type Staff struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	Name        string  `json:"name"`
	Role        string  `json:"role"`
	Status      string  `json:"status"`
	LastLoginAt *string `json:"lastLoginAt"`
	CreatedAt   string  `json:"createdAt"`
}

// AuditEntry is the TypeScript InternalAuditEntry.
type AuditEntry struct {
	ID            int64   `json:"id"`
	ActorEmail    string  `json:"actorEmail"`
	Action        string  `json:"action"`
	EntityType    string  `json:"entityType"`
	EntityID      *string `json:"entityId"`
	ClientID      *string `json:"clientId"`
	PreviousValue any     `json:"previousValue"`
	NewValue      any     `json:"newValue"`
	IP            *string `json:"ip"`
	OccurredAt    string  `json:"occurredAt"`
}

func newID(prefix string) string { return prefix + "-" + uuid.NewString()[:18] }

func dayPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	return db.Ptr(db.Date(t.UTC()))
}

// Repository is the vendor tables.
type Repository struct{}

func scanPlan(row pgx.Row) (Plan, error) {
	var p Plan
	var description *string
	if err := row.Scan(&p.ID, &p.Code, &p.Name, &description, &p.MaxPlants, &p.MaxProductionLines, &p.MaxMachines, &p.MaxUsers, &p.MaxOperators, &p.MonthlyPriceIdr, &p.Active); err != nil {
		return Plan{}, err
	}
	p.Description = db.Deref(description, "")
	return p, nil
}

const planColumns = `id, code, name, description, max_plants, max_production_lines, max_machines, max_users, max_operators, monthly_price_idr::float8, active`

// Plans lists the active plans, cheapest first.
func (Repository) Plans(ctx context.Context, tx pgx.Tx) ([]Plan, error) {
	rows, err := tx.Query(ctx, `SELECT `+planColumns+` FROM subscription_plan WHERE active = TRUE ORDER BY COALESCE(monthly_price_idr, 0)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PlanByID reads one plan; nil when absent.
func (Repository) PlanByID(ctx context.Context, tx pgx.Tx, id string) (*Plan, error) {
	p, err := scanPlan(tx.QueryRow(ctx, `SELECT `+planColumns+` FROM subscription_plan WHERE id = $1`, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

const clientColumns = `id, tenant_id, legal_name, display_name, industry, city, country, contact_name, contact_email, contact_phone, account_manager, lifecycle_status, deployment_mode, onboarded_at, notes, referral_code, created_at, updated_at`

func scanClient(row pgx.Row) (Client, error) {
	var c Client
	var onboarded *time.Time
	var created, updated time.Time
	if err := row.Scan(&c.ID, &c.TenantID, &c.LegalName, &c.DisplayName, &c.Industry, &c.City, &c.Country, &c.ContactName, &c.ContactEmail, &c.ContactPhone, &c.AccountManager,
		&c.LifecycleStatus, &c.DeploymentMode, &onboarded, &c.Notes, &c.ReferralCode, &created, &updated); err != nil {
		return Client{}, err
	}
	c.OnboardedAt, c.CreatedAt, c.UpdatedAt = db.ISOPtr(onboarded), db.ISO(created), db.ISO(updated)
	return c, nil
}

// Clients lists accounts by display name, optionally filtered.
func (Repository) Clients(ctx context.Context, tx pgx.Tx, status, search string) ([]Client, error) {
	var where []string
	var args []any
	if status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("lifecycle_status = $%d", len(args)))
	}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		where = append(where, fmt.Sprintf("(lower(display_name) LIKE $%d OR lower(legal_name) LIKE $%d)", len(args), len(args)))
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := tx.Query(ctx, `SELECT `+clientColumns+` FROM client_account`+clause+` ORDER BY display_name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func clientOrNil(c Client, err error) (*Client, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ClientByID reads one account; nil when absent.
func (Repository) ClientByID(ctx context.Context, tx pgx.Tx, id string) (*Client, error) {
	return clientOrNil(scanClient(tx.QueryRow(ctx, `SELECT `+clientColumns+` FROM client_account WHERE id = $1`, id)))
}

// ClientByTenant reads the account of a tenant.
func (Repository) ClientByTenant(ctx context.Context, tx pgx.Tx, tenantID string) (*Client, error) {
	return clientOrNil(scanClient(tx.QueryRow(ctx, `SELECT `+clientColumns+` FROM client_account WHERE tenant_id = $1`, tenantID)))
}

// CreateClientInput is a new account with its first subscription.
type CreateClientInput struct {
	TenantID                                                                                 *string
	LegalName, DisplayName, LifecycleStatus, DeploymentMode, PlanID, StartedAt               string
	Industry, City, ContactName, ContactEmail, ContactPhone, AccountManager, Notes, RenewsAt *string
	Timezone                                                                                 *string
}

func slug24(text string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(text) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash {
			b.WriteByte('-')
			dash = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if len(s) > 24 {
		s = s[:24]
	}
	return s
}

// CreateClient creates the tenant, the account and its first subscription
// together: neither may exist alone.
func (r Repository) CreateClient(ctx context.Context, tx pgx.Tx, in CreateClientInput) (Client, Subscription, error) {
	tenantID := db.Deref(in.TenantID, "")
	if tenantID == "" {
		tenantID = fmt.Sprintf("tenant-%s-%s", slug24(in.DisplayName), uuid.NewString()[:8])
	}
	clientID, subscriptionID := newID("client"), newID("sub")
	if _, err := tx.Exec(ctx, `INSERT INTO tenant (id, name, timezone, plan, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, tenantID, in.LegalName, db.Deref(in.Timezone, "Asia/Jakarta"), in.PlanID, "ACTIVE"); err != nil {
		return Client{}, Subscription{}, err
	}
	var onboarded *time.Time
	if in.LifecycleStatus == "ACTIVE" {
		now := time.Now()
		onboarded = &now
	}
	if _, err := tx.Exec(ctx, `INSERT INTO client_account (id, tenant_id, legal_name, display_name, industry, city, contact_name, contact_email, contact_phone, account_manager, lifecycle_status, deployment_mode, onboarded_at, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		clientID, tenantID, in.LegalName, in.DisplayName, in.Industry, in.City, in.ContactName, in.ContactEmail, in.ContactPhone, in.AccountManager, in.LifecycleStatus, in.DeploymentMode, onboarded, in.Notes); err != nil {
		return Client{}, Subscription{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO client_subscription (id, client_id, plan_id, status, started_at, renews_at) VALUES ($1,$2,$3,'ACTIVE',$4::date,$5::date)`, subscriptionID, clientID, in.PlanID, in.StartedAt, in.RenewsAt); err != nil {
		return Client{}, Subscription{}, err
	}
	client, err := r.ClientByID(ctx, tx, clientID)
	if err != nil {
		return Client{}, Subscription{}, err
	}
	sub, err := r.SubscriptionByID(ctx, tx, subscriptionID)
	if err != nil {
		return Client{}, Subscription{}, err
	}
	return *client, *sub, nil
}

// ClientPatch is what an update may change; nil leaves the column.
type ClientPatch struct {
	LegalName, DisplayName, Industry, City, ContactName, ContactEmail, ContactPhone, AccountManager, LifecycleStatus, Notes *string
}

// UpdateClient patches the mentioned columns; moving to ACTIVE stamps
// onboarded_at once.
func (r Repository) UpdateClient(ctx context.Context, tx pgx.Tx, id string, p ClientPatch) (*Client, error) {
	var sets []string
	var args []any
	push := func(column string, v *string) {
		if v == nil {
			return
		}
		args = append(args, *v)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	push("legal_name", p.LegalName)
	push("display_name", p.DisplayName)
	push("industry", p.Industry)
	push("city", p.City)
	push("contact_name", p.ContactName)
	push("contact_email", p.ContactEmail)
	push("contact_phone", p.ContactPhone)
	push("account_manager", p.AccountManager)
	push("lifecycle_status", p.LifecycleStatus)
	push("notes", p.Notes)
	if len(sets) == 0 {
		return r.ClientByID(ctx, tx, id)
	}
	if p.LifecycleStatus != nil && *p.LifecycleStatus == "ACTIVE" {
		sets = append(sets, "onboarded_at = COALESCE(onboarded_at, CURRENT_TIMESTAMP)")
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	return clientOrNil(scanClient(tx.QueryRow(ctx, `UPDATE client_account SET `+strings.Join(sets, ", ")+fmt.Sprintf(` WHERE id = $%d RETURNING `, len(args))+clientColumns, args...)))
}

const subscriptionSelect = `SELECT s.id, s.client_id, s.plan_id, p.code, p.name, s.status, s.started_at, s.renews_at, s.ended_at, s.override_max_plants, s.override_max_production_lines,
	s.override_max_machines, s.override_max_users, s.override_max_operators FROM client_subscription s JOIN subscription_plan p ON p.id = s.plan_id`

func scanSubscription(row pgx.Row) (Subscription, error) {
	var s Subscription
	var started time.Time
	var renews, ended *time.Time
	if err := row.Scan(&s.ID, &s.ClientID, &s.PlanID, &s.PlanCode, &s.PlanName, &s.Status, &started, &renews, &ended, &s.OverrideMaxPlants, &s.OverrideMaxProductionLines,
		&s.OverrideMaxMachines, &s.OverrideMaxUsers, &s.OverrideMaxOperators); err != nil {
		return Subscription{}, err
	}
	s.StartedAt, s.RenewsAt, s.EndedAt = db.Date(started.UTC()), dayPtr(renews), dayPtr(ended)
	return s, nil
}

func subscriptionOrNil(s Subscription, err error) (*Subscription, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// SubscriptionByID reads one subscription.
func (Repository) SubscriptionByID(ctx context.Context, tx pgx.Tx, id string) (*Subscription, error) {
	return subscriptionOrNil(scanSubscription(tx.QueryRow(ctx, subscriptionSelect+` WHERE s.id = $1`, id)))
}

// CurrentSubscription is the live subscription of a client.
func (Repository) CurrentSubscription(ctx context.Context, tx pgx.Tx, clientID string) (*Subscription, error) {
	return subscriptionOrNil(scanSubscription(tx.QueryRow(ctx, subscriptionSelect+` WHERE s.client_id = $1 AND s.status IN ('ACTIVE', 'PAST_DUE') ORDER BY s.started_at DESC LIMIT 1`, clientID)))
}

// Subscriptions is a client's whole history, newest first.
func (Repository) Subscriptions(ctx context.Context, tx pgx.Tx, clientID string) ([]Subscription, error) {
	rows, err := tx.Query(ctx, subscriptionSelect+` WHERE s.client_id = $1 ORDER BY s.started_at DESC`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Subscription{}
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ChangePlanInput ends the running subscription and starts a new one.
type ChangePlanInput struct {
	ClientID, PlanID, StartedAt                                        string
	RenewsAt                                                           *string
	MaxPlants, MaxProductionLines, MaxMachines, MaxUsers, MaxOperators *int
}

// ChangePlan ends the running subscription and starts a new one rather
// than editing in place: last quarter's entitlement is worth keeping.
func (r Repository) ChangePlan(ctx context.Context, tx pgx.Tx, in ChangePlanInput) (Subscription, error) {
	if _, err := tx.Exec(ctx, `UPDATE client_subscription SET status = 'ENDED', ended_at = $2::date, updated_at = CURRENT_TIMESTAMP WHERE client_id = $1 AND status IN ('ACTIVE', 'PAST_DUE')`, in.ClientID, in.StartedAt); err != nil {
		return Subscription{}, err
	}
	id := newID("sub")
	if _, err := tx.Exec(ctx, `INSERT INTO client_subscription (id, client_id, plan_id, status, started_at, renews_at, override_max_plants, override_max_production_lines, override_max_machines, override_max_users, override_max_operators)
		VALUES ($1,$2,$3,'ACTIVE',$4::date,$5::date,$6,$7,$8,$9,$10)`, id, in.ClientID, in.PlanID, in.StartedAt, in.RenewsAt, in.MaxPlants, in.MaxProductionLines, in.MaxMachines, in.MaxUsers, in.MaxOperators); err != nil {
		return Subscription{}, err
	}
	sub, err := r.SubscriptionByID(ctx, tx, id)
	if err != nil {
		return Subscription{}, err
	}
	return *sub, nil
}

// SetSubscriptionStatus changes the running subscription's status.
func (Repository) SetSubscriptionStatus(ctx context.Context, tx pgx.Tx, clientID, status string) error {
	_, err := tx.Exec(ctx, `UPDATE client_subscription SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE client_id = $1 AND status IN ('ACTIVE', 'PAST_DUE')`, clientID, status)
	return err
}

const usageColumns = `client_id, captured_on, plants, production_lines, machines, products, users, operators, active_users_7d, work_orders_created, production_records, downtime_records, terminals_online, last_activity_at`

func scanUsage(row pgx.Row) (Usage, error) {
	var u Usage
	var captured time.Time
	var last *time.Time
	if err := row.Scan(&u.ClientID, &captured, &u.Plants, &u.ProductionLines, &u.Machines, &u.Products, &u.Users, &u.Operators, &u.ActiveUsers7d, &u.WorkOrdersCreated, &u.ProductionRecords, &u.DowntimeRecords, &u.TerminalsOnline, &last); err != nil {
		return Usage{}, err
	}
	u.CapturedOn, u.LastActivityAt = db.Date(captured.UTC()), db.ISOPtr(last)
	return u, nil
}

func collectUsage(rows pgx.Rows, err error) ([]Usage, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Usage{}
	for rows.Next() {
		u, err := scanUsage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// LatestUsage is the newest snapshot of a client; nil when none.
func (Repository) LatestUsage(ctx context.Context, tx pgx.Tx, clientID string) (*Usage, error) {
	u, err := scanUsage(tx.QueryRow(ctx, `SELECT `+usageColumns+` FROM client_usage_snapshot WHERE client_id = $1 ORDER BY captured_on DESC LIMIT 1`, clientID))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// LatestUsageForAll is the newest snapshot per client.
func (Repository) LatestUsageForAll(ctx context.Context, tx pgx.Tx) (map[string]Usage, error) {
	list, err := collectUsage(tx.Query(ctx, `SELECT DISTINCT ON (client_id) `+usageColumns+` FROM client_usage_snapshot ORDER BY client_id, captured_on DESC`))
	if err != nil {
		return nil, err
	}
	out := map[string]Usage{}
	for _, u := range list {
		out[u.ClientID] = u
	}
	return out, nil
}

// UsageHistory is a client's snapshots over the last days.
func (Repository) UsageHistory(ctx context.Context, tx pgx.Tx, clientID string, days int) ([]Usage, error) {
	return collectUsage(tx.Query(ctx, `SELECT `+usageColumns+` FROM client_usage_snapshot WHERE client_id = $1 AND captured_on > CURRENT_DATE - $2::int ORDER BY captured_on`, clientID, days))
}

// RecordUsage upserts one sample per client per day.
func (Repository) RecordUsage(ctx context.Context, tx pgx.Tx, u Usage) error {
	_, err := tx.Exec(ctx, `INSERT INTO client_usage_snapshot (`+usageColumns+`) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz)
		ON CONFLICT (client_id, captured_on) DO UPDATE SET plants = EXCLUDED.plants, production_lines = EXCLUDED.production_lines, machines = EXCLUDED.machines, products = EXCLUDED.products,
			users = EXCLUDED.users, operators = EXCLUDED.operators, active_users_7d = EXCLUDED.active_users_7d, work_orders_created = EXCLUDED.work_orders_created,
			production_records = EXCLUDED.production_records, downtime_records = EXCLUDED.downtime_records, terminals_online = EXCLUDED.terminals_online, last_activity_at = EXCLUDED.last_activity_at`,
		u.ClientID, u.CapturedOn, u.Plants, u.ProductionLines, u.Machines, u.Products, u.Users, u.Operators, u.ActiveUsers7d, u.WorkOrdersCreated, u.ProductionRecords, u.DowntimeRecords, u.TerminalsOnline, u.LastActivityAt)
	return err
}

const grantColumns = `id, client_id, granted_to, granted_by, reason, access_level, granted_at, expires_at, revoked_at, revoked_by, last_used_at, use_count`

func scanGrant(row pgx.Row, now time.Time) (Grant, error) {
	var g Grant
	var granted, expires time.Time
	var revoked, lastUsed *time.Time
	if err := row.Scan(&g.ID, &g.ClientID, &g.GrantedTo, &g.GrantedBy, &g.Reason, &g.AccessLevel, &granted, &expires, &revoked, &g.RevokedBy, &lastUsed, &g.UseCount); err != nil {
		return Grant{}, err
	}
	g.GrantedAt, g.ExpiresAt, g.RevokedAt, g.LastUsedAt = db.ISO(granted), db.ISO(expires), db.ISOPtr(revoked), db.ISOPtr(lastUsed)
	g.Active = revoked == nil && expires.After(now)
	return g, nil
}

func collectGrants(rows pgx.Rows, err error, now time.Time) ([]Grant, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Grant{}
	for rows.Next() {
		g, err := scanGrant(rows, now)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// GrantsFor lists a client's grants, newest first.
func (Repository) GrantsFor(ctx context.Context, tx pgx.Tx, clientID string, now time.Time) ([]Grant, error) {
	rows, err := tx.Query(ctx, `SELECT `+grantColumns+` FROM support_access_grant WHERE client_id = $1 ORDER BY granted_at DESC`, clientID)
	return collectGrants(rows, err, now)
}

// ActiveGrants lists every live grant, soonest to expire first.
func (Repository) ActiveGrants(ctx context.Context, tx pgx.Tx, now time.Time) ([]Grant, error) {
	rows, err := tx.Query(ctx, `SELECT `+grantColumns+` FROM support_access_grant WHERE revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY expires_at`)
	return collectGrants(rows, err, now)
}

// Grant issues time-boxed access.
func (Repository) Grant(ctx context.Context, tx pgx.Tx, clientID, grantedTo, grantedBy, reason, accessLevel, expiresAt string, now time.Time) (Grant, error) {
	return scanGrant(tx.QueryRow(ctx, `INSERT INTO support_access_grant (id, client_id, granted_to, granted_by, reason, access_level, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz) RETURNING `+grantColumns,
		newID("grant"), clientID, grantedTo, grantedBy, reason, accessLevel, expiresAt), now)
}

// Revoke ends a live grant; nil when it was not live.
func (Repository) Revoke(ctx context.Context, tx pgx.Tx, grantID, revokedBy string, now time.Time) (*Grant, error) {
	g, err := scanGrant(tx.QueryRow(ctx, `UPDATE support_access_grant SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING `+grantColumns, grantID, revokedBy), now)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// MarkUsed records that a grant was exercised.
func (Repository) MarkUsed(ctx context.Context, tx pgx.Tx, grantID string) error {
	_, err := tx.Exec(ctx, `UPDATE support_access_grant SET last_used_at = CURRENT_TIMESTAMP, use_count = use_count + 1 WHERE id = $1`, grantID)
	return err
}

const staffColumns = `id, email, name, role, status, password_hash, last_login_at, created_at`

type storedStaff struct {
	Staff
	PasswordHash *string
}

func scanStaff(row pgx.Row) (storedStaff, error) {
	var s storedStaff
	var last *time.Time
	var created time.Time
	if err := row.Scan(&s.ID, &s.Email, &s.Name, &s.Role, &s.Status, &s.PasswordHash, &last, &created); err != nil {
		return storedStaff{}, err
	}
	s.LastLoginAt, s.CreatedAt = db.ISOPtr(last), db.ISO(created)
	return s, nil
}

// StaffList lists the vendor's staff.
func (Repository) StaffList(ctx context.Context, tx pgx.Tx) ([]Staff, error) {
	rows, err := tx.Query(ctx, `SELECT `+staffColumns+` FROM internal_user ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Staff{}
	for rows.Next() {
		s, err := scanStaff(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s.Staff)
	}
	return out, rows.Err()
}

// StaffByEmail reads one staff member with the hash; nil when absent.
func (Repository) StaffByEmail(ctx context.Context, tx pgx.Tx, email string) (*storedStaff, error) {
	s, err := scanStaff(tx.QueryRow(ctx, `SELECT `+staffColumns+` FROM internal_user WHERE lower(email) = lower($1)`, email))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// UpsertStaff creates or updates a staff member by email.
func (Repository) UpsertStaff(ctx context.Context, tx pgx.Tx, email, name, role string, passwordHash *string) (Staff, error) {
	s, err := scanStaff(tx.QueryRow(ctx, `INSERT INTO internal_user (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = COALESCE(EXCLUDED.password_hash, internal_user.password_hash) RETURNING `+staffColumns,
		newID("iu"), strings.ToLower(email), name, role, passwordHash))
	return s.Staff, err
}

// TouchLogin stamps last_login_at.
func (Repository) TouchLogin(ctx context.Context, tx pgx.Tx, email string) error {
	_, err := tx.Exec(ctx, `UPDATE internal_user SET last_login_at = CURRENT_TIMESTAMP WHERE lower(email) = lower($1)`, email)
	return err
}

// AuditInput is one vendor-side action.
type AuditInput struct {
	ActorEmail, Action, EntityType string
	EntityID, ClientID, IP         *string
	PreviousValue, NewValue        any
}

// RecordAudit appends to internal_audit_log (append-only by privilege).
func (Repository) RecordAudit(ctx context.Context, tx pgx.Tx, in AuditInput) error {
	var previous, next []byte
	var err error
	if in.PreviousValue != nil {
		if previous, err = json.Marshal(in.PreviousValue); err != nil {
			return err
		}
	}
	if in.NewValue != nil {
		if next, err = json.Marshal(in.NewValue); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO internal_audit_log (actor_email, action, entity_type, entity_id, client_id, previous_value, new_value, ip) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
		in.ActorEmail, in.Action, in.EntityType, in.EntityID, in.ClientID, previous, next, in.IP)
	return err
}

// AuditTrail lists entries newest first (limit ≤ 500).
func (Repository) AuditTrail(ctx context.Context, tx pgx.Tx, clientID string, limit int) ([]AuditEntry, error) {
	var args []any
	where := ""
	if clientID != "" {
		args = append(args, clientID)
		where = " WHERE client_id = $1"
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	args = append(args, limit)
	rows, err := tx.Query(ctx, `SELECT id, actor_email, action, entity_type, entity_id, client_id, previous_value, new_value, ip, occurred_at FROM internal_audit_log`+where+fmt.Sprintf(` ORDER BY occurred_at DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var previous, next []byte
		var occurred time.Time
		if err := rows.Scan(&e.ID, &e.ActorEmail, &e.Action, &e.EntityType, &e.EntityID, &e.ClientID, &previous, &next, &e.IP, &occurred); err != nil {
			return nil, err
		}
		e.PreviousValue, e.NewValue, e.OccurredAt = db.RawJSON(previous), db.RawJSON(next), db.ISO(occurred)
		out = append(out, e)
	}
	return out, rows.Err()
}
