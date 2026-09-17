package masterdata

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Shifts, operators, application users, terminals and KPI targets: read on
// almost every request and written rarely. A shift decides which shift_date
// a production record belongs to, an operator is resolved on every capture,
// and a user carries the permissions the API enforces.

// --- Shifts -----------------------------------------------------------

const shiftColumns = `id, tenant_id, plant_id, name, start_time, end_time, break_minutes, crosses_midnight, active`

func scanShift(r pgx.Rows) (Shift, error) {
	var s Shift
	var breakMinutes *int
	var crosses, active *bool
	if err := r.Scan(&s.ID, &s.TenantID, &s.PlantID, &s.Name, &s.StartTime, &s.EndTime, &breakMinutes, &crosses, &active); err != nil {
		return s, err
	}
	s.BreakMinutes = db.Deref(breakMinutes, 0)
	s.CrossesMidnight = crosses != nil && *crosses
	s.Active = active == nil || *active
	return s, nil
}

func (Repository) ListShifts(ctx context.Context, tx pgx.Tx, tenantID string) ([]Shift, error) {
	rows, err := tx.Query(ctx, `SELECT `+shiftColumns+` FROM shift WHERE tenant_id = $1 ORDER BY start_time ASC, id ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, scanShift)
}

func (Repository) UpsertShift(ctx context.Context, tx pgx.Tx, s Shift) (Shift, error) {
	rows, err := tx.Query(ctx,
		`INSERT INTO shift (id, tenant_id, plant_id, name, start_time, end_time, break_minutes, crosses_midnight, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO UPDATE SET
		   plant_id = EXCLUDED.plant_id, name = EXCLUDED.name, start_time = EXCLUDED.start_time,
		   end_time = EXCLUDED.end_time, break_minutes = EXCLUDED.break_minutes,
		   crosses_midnight = EXCLUDED.crosses_midnight, active = EXCLUDED.active
		 RETURNING `+shiftColumns,
		s.ID, s.TenantID, s.PlantID, s.Name, s.StartTime, s.EndTime, s.BreakMinutes, s.CrossesMidnight, s.Active)
	if err != nil {
		return s, err
	}
	out, err := collect(rows, scanShift)
	if err != nil || len(out) == 0 {
		return s, err
	}
	return out[0], nil
}

// --- Operators --------------------------------------------------------

const operatorColumns = `id, tenant_id, employee_number, name, pin_hash, default_line_id, status`

func scanOperator(r pgx.Rows) (Operator, error) {
	var o Operator
	var status *string
	if err := r.Scan(&o.ID, &o.TenantID, &o.EmployeeNumber, &o.Name, &o.PinHash, &o.DefaultLineID, &status); err != nil {
		return o, err
	}
	o.PinHash, o.DefaultLineID = db.Str(o.PinHash), db.Str(o.DefaultLineID)
	o.Status = db.StrOr(status, "ACTIVE")
	return o, nil
}

func (Repository) ListOperators(ctx context.Context, tx pgx.Tx, tenantID string) ([]Operator, error) {
	rows, err := tx.Query(ctx, `SELECT `+operatorColumns+` FROM operator WHERE tenant_id = $1 ORDER BY employee_number ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, scanOperator)
}

// UpsertOperator writes an operator. A nil pin hash means "unchanged", not
// "cleared": saving an operator's name must never revoke their PIN.
func (Repository) UpsertOperator(ctx context.Context, tx pgx.Tx, o Operator) (Operator, error) {
	rows, err := tx.Query(ctx,
		`INSERT INTO operator (id, tenant_id, employee_number, name, pin_hash, default_line_id, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (id) DO UPDATE SET
		   employee_number = EXCLUDED.employee_number, name = EXCLUDED.name,
		   pin_hash = COALESCE(EXCLUDED.pin_hash, operator.pin_hash),
		   default_line_id = EXCLUDED.default_line_id, status = EXCLUDED.status
		 RETURNING `+operatorColumns,
		o.ID, o.TenantID, o.EmployeeNumber, o.Name, o.PinHash, o.DefaultLineID, orDefault(o.Status, "ACTIVE"))
	if err != nil {
		return o, err
	}
	out, err := collect(rows, scanOperator)
	if err != nil || len(out) == 0 {
		return o, err
	}
	return out[0], nil
}

// SetOperatorPin stores a PIN hash in both places the schema keeps one:
// operator.pin_hash is what the record carries; operator_credential records
// when it was last set and by whom.
func (Repository) SetOperatorPin(ctx context.Context, tx pgx.Tx, tenantID, operatorID, pinHash string, updatedBy *string) error {
	if _, err := tx.Exec(ctx, `UPDATE operator SET pin_hash = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, operatorID, pinHash); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO operator_credential (operator_id, tenant_id, pin_hash, updated_at, updated_by)
		 VALUES ($1, $2, $3, now(), $4)
		 ON CONFLICT (operator_id) DO UPDATE SET
		   pin_hash = EXCLUDED.pin_hash, updated_at = now(), updated_by = EXCLUDED.updated_by`,
		operatorID, tenantID, pinHash, updatedBy)
	return err
}

// --- Users ------------------------------------------------------------

const userColumns = `id, tenant_id, email, password_hash, name, role, account_type, scope_level,
  scope_id, employee_number, status, last_login_at, created_at`

func scanUser(r pgx.Rows) (StoredUser, error) {
	var u User
	var hash, accountType, scopeLevel, status *string
	var lastLogin *time.Time
	var created time.Time
	if err := r.Scan(&u.ID, &u.TenantID, &u.Email, &hash, &u.Name, &u.Role, &accountType, &scopeLevel,
		&u.ScopeID, &u.EmployeeNumber, &status, &lastLogin, &created); err != nil {
		return StoredUser{}, err
	}
	u.AccountType = db.StrOr(accountType, "APPLICATION_USER")
	u.ScopeLevel = db.StrOr(scopeLevel, "TENANT")
	u.ScopeID, u.EmployeeNumber = db.Str(u.ScopeID), db.Str(u.EmployeeNumber)
	u.Status = db.StrOr(status, "ACTIVE")
	u.LastLoginAt = db.ISOPtr(lastLogin)
	u.CreatedAt = db.ISO(created)
	return StoredUser{User: u, PasswordHash: db.Str(hash)}, nil
}

func (Repository) ListUsers(ctx context.Context, tx pgx.Tx, tenantID string) ([]StoredUser, error) {
	rows, err := tx.Query(ctx, `SELECT `+userColumns+` FROM app_user WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, scanUser)
}

// UpsertUser writes a user. As with the operator PIN, a nil hash means
// "leave it alone".
func (Repository) UpsertUser(ctx context.Context, tx pgx.Tx, u User, passwordHash *string) (StoredUser, error) {
	var lastLogin *time.Time
	if u.LastLoginAt != nil {
		if t, err := db.ParseISO(*u.LastLoginAt); err == nil {
			lastLogin = &t
		}
	}
	created, err := db.ParseISO(u.CreatedAt)
	if err != nil {
		created = time.Now()
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO app_user (id, tenant_id, email, password_hash, name, role, account_type,
		                       scope_level, scope_id, employee_number, status, last_login_at, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		 ON CONFLICT (id) DO UPDATE SET
		   email = EXCLUDED.email,
		   password_hash = COALESCE(EXCLUDED.password_hash, app_user.password_hash),
		   name = EXCLUDED.name, role = EXCLUDED.role, account_type = EXCLUDED.account_type,
		   scope_level = EXCLUDED.scope_level, scope_id = EXCLUDED.scope_id,
		   employee_number = EXCLUDED.employee_number, status = EXCLUDED.status,
		   last_login_at = COALESCE(EXCLUDED.last_login_at, app_user.last_login_at)
		 RETURNING `+userColumns,
		u.ID, u.TenantID, u.Email, passwordHash, u.Name, u.Role, orDefault(u.AccountType, "APPLICATION_USER"),
		orDefault(u.ScopeLevel, "TENANT"), u.ScopeID, u.EmployeeNumber, orDefault(u.Status, "ACTIVE"), lastLogin, created)
	if err != nil {
		return StoredUser{}, err
	}
	out, err := collect(rows, scanUser)
	if err != nil || len(out) == 0 {
		return StoredUser{User: u}, err
	}
	return out[0], nil
}

func (Repository) SetPassword(ctx context.Context, tx pgx.Tx, tenantID, userID, hash string) error {
	_, err := tx.Exec(ctx, `UPDATE app_user SET password_hash = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, userID, hash)
	return err
}

func (Repository) TouchLogin(ctx context.Context, tx pgx.Tx, tenantID, userID string, at time.Time) error {
	_, err := tx.Exec(ctx, `UPDATE app_user SET last_login_at = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, userID, at)
	return err
}

// TenantsForEmail is every tenant an application user with this email
// belongs to. The console does not know its tenant before login, so the
// login route resolves it from the email. client_account and app_user are
// the two tables a process with no tenant may read across tenants for this
// purpose; the query runs without a tenant and relies on app_user being
// readable that way only through the owner-granted policy — which it is not,
// so it declares each known tenant in turn instead (see Service).
func (Repository) TenantsWithAccounts(ctx context.Context, tx pgx.Tx, pilot string) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT DISTINCT tenant_id FROM client_account WHERE tenant_id <> $1`, pilot)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (string, error) {
		var id string
		err := r.Scan(&id)
		return id, err
	})
}

// --- Devices ----------------------------------------------------------

const deviceColumns = `id, tenant_id, device_code, name, assigned_line_id, assigned_work_center_id, status, ip_address, last_heartbeat_at, registered_at`

func scanDevice(r pgx.Rows) (Device, error) {
	var d Device
	var status *string
	var heartbeat *time.Time
	var registered time.Time
	if err := r.Scan(&d.ID, &d.TenantID, &d.DeviceCode, &d.Name, &d.AssignedLineID, &d.AssignedWorkCenterID, &status, &d.IPAddress, &heartbeat, &registered); err != nil {
		return d, err
	}
	d.AssignedLineID, d.AssignedWorkCenterID, d.IPAddress = db.Str(d.AssignedLineID), db.Str(d.AssignedWorkCenterID), db.Str(d.IPAddress)
	d.Status = db.StrOr(status, "ONLINE")
	d.LastHeartbeatAt = db.ISOPtr(heartbeat)
	d.RegisteredAt = db.ISO(registered)
	return d, nil
}

func (Repository) ListDevices(ctx context.Context, tx pgx.Tx, tenantID string) ([]Device, error) {
	rows, err := tx.Query(ctx, `SELECT `+deviceColumns+` FROM device_terminal WHERE tenant_id = $1 ORDER BY registered_at ASC, id ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, scanDevice)
}

func (Repository) UpsertDevice(ctx context.Context, tx pgx.Tx, d Device) error {
	var heartbeat *time.Time
	if d.LastHeartbeatAt != nil {
		if t, err := db.ParseISO(*d.LastHeartbeatAt); err == nil {
			heartbeat = &t
		}
	}
	registered, err := db.ParseISO(d.RegisteredAt)
	if err != nil {
		registered = time.Now()
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO device_terminal (id, tenant_id, device_code, name, assigned_line_id, assigned_work_center_id,
		                              status, ip_address, last_heartbeat_at, registered_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT (id) DO UPDATE SET
		   device_code = EXCLUDED.device_code, name = EXCLUDED.name,
		   assigned_line_id = EXCLUDED.assigned_line_id, assigned_work_center_id = EXCLUDED.assigned_work_center_id,
		   status = EXCLUDED.status, ip_address = EXCLUDED.ip_address, last_heartbeat_at = EXCLUDED.last_heartbeat_at`,
		d.ID, d.TenantID, d.DeviceCode, d.Name, d.AssignedLineID, d.AssignedWorkCenterID, orDefault(d.Status, "ONLINE"), d.IPAddress, heartbeat, registered)
	return err
}

// --- KPI targets ------------------------------------------------------

func (Repository) ListKpiTargets(ctx context.Context, tx pgx.Tx, tenantID string) ([]KpiTarget, error) {
	rows, err := tx.Query(ctx,
		// Dashboard order: the card order the console shows, which is also the
		// order the seed and the Node API kept. Unknown metrics follow, by name.
		`SELECT id, tenant_id, metric, target_value, unit, direction, watch_threshold_pct, critical_threshold_pct
		   FROM kpi_target WHERE tenant_id = $1
		  ORDER BY array_position(ARRAY['OEE','AVAILABILITY','PERFORMANCE','QUALITY','PRODUCTION_ACHIEVEMENT','REJECT_RATE','DOWNTIME']::text[], metric) NULLS LAST, metric`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (KpiTarget, error) {
		var k KpiTarget
		var direction *string
		var watch, critical *float64
		if err := r.Scan(&k.ID, &k.TenantID, &k.Metric, &k.TargetValue, &k.Unit, &direction, &watch, &critical); err != nil {
			return k, err
		}
		k.Direction = db.StrOr(direction, "HIGHER_IS_BETTER")
		k.WatchThresholdPct = db.Deref(watch, 95)
		k.CriticalThresholdPct = db.Deref(critical, 90)
		return k, nil
	})
}

func (Repository) UpsertKpiTarget(ctx context.Context, tx pgx.Tx, k KpiTarget) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO kpi_target (id, tenant_id, metric, target_value, unit, direction, watch_threshold_pct, critical_threshold_pct)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 ON CONFLICT (id) DO UPDATE SET
		   metric = EXCLUDED.metric, target_value = EXCLUDED.target_value, unit = EXCLUDED.unit,
		   direction = EXCLUDED.direction, watch_threshold_pct = EXCLUDED.watch_threshold_pct,
		   critical_threshold_pct = EXCLUDED.critical_threshold_pct`,
		k.ID, k.TenantID, k.Metric, k.TargetValue, k.Unit, k.Direction, k.WatchThresholdPct, k.CriticalThresholdPct)
	return err
}
