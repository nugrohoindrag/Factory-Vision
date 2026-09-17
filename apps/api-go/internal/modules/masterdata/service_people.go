package masterdata

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
)

// --- Shifts -----------------------------------------------------------

func (s *Service) Shifts(ctx context.Context, tenantID string) ([]Shift, error) {
	return s.shifts.Get(ctx, tenantID, func(ctx context.Context) ([]Shift, error) {
		var out []Shift
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.ListShifts(ctx, tx, tenantID)
			return err
		})
		return out, err
	})
}

func (s *Service) ShiftByID(ctx context.Context, tenantID, id string) (*Shift, error) {
	shifts, err := s.Shifts(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range shifts {
		if shifts[i].ID == id {
			sh := shifts[i]
			return &sh, nil
		}
	}
	return nil, nil
}

// crossesMidnight is derived rather than trusted from the client: a shift
// that ends at or before it starts runs through midnight, and shift_date
// accounting depends on the flag being right.
func crossesMidnight(start, end string) bool { return end <= start }

// CreateShift writes the database first: if the write fails the caller
// gets an error rather than a shift that exists until the next restart.
func (s *Service) CreateShift(ctx context.Context, tenantID string, sh Shift) (Shift, error) {
	sh.ID = newID("shift")
	sh.TenantID = tenantID
	sh.CrossesMidnight = crossesMidnight(sh.StartTime, sh.EndTime)
	var stored Shift
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.UpsertShift(ctx, tx, sh)
		return err
	})
	s.shifts.Invalidate(tenantID)
	return stored, err
}

func (s *Service) UpdateShift(ctx context.Context, tenantID, id string, body Patch) (Shift, error) {
	existing, err := s.ShiftByID(ctx, tenantID, id)
	if err != nil {
		return Shift{}, err
	}
	if existing == nil {
		return Shift{}, notFound("Shift")
	}
	sh := *existing
	body.str("plantId", &sh.PlantID)
	body.str("name", &sh.Name)
	body.str("startTime", &sh.StartTime)
	body.str("endTime", &sh.EndTime)
	body.integer("breakMinutes", &sh.BreakMinutes)
	body.boolean("active", &sh.Active)
	sh.CrossesMidnight = crossesMidnight(sh.StartTime, sh.EndTime)
	var stored Shift
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.UpsertShift(ctx, tx, sh)
		return err
	})
	s.shifts.Invalidate(tenantID)
	return stored, err
}

func (s *Service) DeleteShift(ctx context.Context, tenantID, id string) error {
	var deleted bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		deleted, err = s.repo.Remove(ctx, tx, "shift", tenantID, id)
		return err
	})
	s.shifts.Invalidate(tenantID)
	if err != nil {
		return err
	}
	if !deleted {
		return notFound("Shift")
	}
	return nil
}

// --- Operators --------------------------------------------------------

func (s *Service) Operators(ctx context.Context, tenantID string) ([]Operator, error) {
	return s.operators.Get(ctx, tenantID, func(ctx context.Context) ([]Operator, error) {
		var out []Operator
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.ListOperators(ctx, tx, tenantID)
			return err
		})
		return out, err
	})
}

func (s *Service) OperatorByID(ctx context.Context, tenantID, id string) (*Operator, error) {
	ops, err := s.Operators(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range ops {
		if ops[i].ID == id {
			o := ops[i]
			return &o, nil
		}
	}
	return nil, nil
}

// OperatorByEmployeeNumber is the operator-login lookup, case-insensitive.
func (s *Service) OperatorByEmployeeNumber(ctx context.Context, tenantID, employeeNumber string) (*Operator, error) {
	ops, err := s.Operators(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	wanted := lower(employeeNumber)
	for i := range ops {
		if lower(ops[i].EmployeeNumber) == wanted {
			o := ops[i]
			return &o, nil
		}
	}
	return nil, nil
}

func (s *Service) CreateOperator(ctx context.Context, tenantID string, body Patch) (Operator, error) {
	if err := requireStrings(body, "employeeNumber", "name"); err != nil {
		return Operator{}, err
	}
	o := Operator{ID: newID("op"), TenantID: tenantID, Status: "ACTIVE"}
	body.str("employeeNumber", &o.EmployeeNumber)
	body.str("name", &o.Name)
	body.optStr("defaultLineId", &o.DefaultLineID)
	body.str("status", &o.Status)
	var stored Operator
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.UpsertOperator(ctx, tx, o)
		return err
	})
	s.operators.Invalidate(tenantID)
	return stored, err
}

func (s *Service) UpdateOperator(ctx context.Context, tenantID, id string, body Patch) (Operator, error) {
	existing, err := s.OperatorByID(ctx, tenantID, id)
	if err != nil {
		return Operator{}, err
	}
	if existing == nil {
		return Operator{}, notFound("Operator")
	}
	o := *existing
	body.str("employeeNumber", &o.EmployeeNumber)
	body.str("name", &o.Name)
	body.optStr("defaultLineId", &o.DefaultLineID)
	body.str("status", &o.Status)
	// The PIN is never set through this path: nil leaves the stored hash.
	o.PinHash = nil
	var stored Operator
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.UpsertOperator(ctx, tx, o)
		return err
	})
	s.operators.Invalidate(tenantID)
	return stored, err
}

func (s *Service) DeleteOperator(ctx context.Context, tenantID, id string) error {
	var deleted bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		deleted, err = s.repo.Remove(ctx, tx, "operator", tenantID, id)
		return err
	})
	s.operators.Invalidate(tenantID)
	if err != nil {
		return err
	}
	if !deleted {
		return notFound("Operator")
	}
	return nil
}

// SaveOperatorPin stores an operator's PIN hash, the shop floor's only
// credential.
func (s *Service) SaveOperatorPin(ctx context.Context, tenantID, operatorID, pinHash string, updatedBy *string) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.SetOperatorPin(ctx, tx, tenantID, operatorID, pinHash, updatedBy)
	})
	s.operators.Invalidate(tenantID)
	return err
}

// --- Users ------------------------------------------------------------

func (s *Service) storedUsers(ctx context.Context, tenantID string) ([]StoredUser, error) {
	return s.users.Get(ctx, tenantID, func(ctx context.Context) ([]StoredUser, error) {
		var out []StoredUser
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.ListUsers(ctx, tx, tenantID)
			return err
		})
		return out, err
	})
}

// Users lists the tenant's accounts without their credentials.
func (s *Service) Users(ctx context.Context, tenantID string) ([]User, error) {
	stored, err := s.storedUsers(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]User, 0, len(stored))
	for _, su := range stored {
		out = append(out, su.User)
	}
	return out, nil
}

func (s *Service) UserByID(ctx context.Context, tenantID, id string) (*User, error) {
	su, err := s.StoredUserByID(ctx, tenantID, id)
	if err != nil || su == nil {
		return nil, err
	}
	u := su.User
	return &u, nil
}

// StoredUserByID includes the password hash, for the login path only.
func (s *Service) StoredUserByID(ctx context.Context, tenantID, id string) (*StoredUser, error) {
	stored, err := s.storedUsers(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range stored {
		if stored[i].User.ID == id {
			su := stored[i]
			return &su, nil
		}
	}
	return nil, nil
}

// StoredUserByEmail is the login lookup: application users only,
// case-insensitive.
func (s *Service) StoredUserByEmail(ctx context.Context, tenantID, email string) (*StoredUser, error) {
	stored, err := s.storedUsers(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	wanted := lower(email)
	for i := range stored {
		if lower(stored[i].User.Email) == wanted && stored[i].User.AccountType == "APPLICATION_USER" {
			su := stored[i]
			return &su, nil
		}
	}
	return nil, nil
}

// EmailExists reports whether any account in the tenant uses the email.
func (s *Service) EmailExists(ctx context.Context, tenantID, email string) (bool, error) {
	stored, err := s.storedUsers(ctx, tenantID)
	if err != nil {
		return false, err
	}
	wanted := lower(email)
	for i := range stored {
		if lower(stored[i].User.Email) == wanted {
			return true, nil
		}
	}
	return false, nil
}

// CreateUser writes an account; the hash, if any, is stored beside it.
func (s *Service) CreateUser(ctx context.Context, tenantID string, u User, passwordHash *string) (User, error) {
	u.ID = newID("usr")
	u.TenantID = tenantID
	u.CreatedAt = db.Now()
	if u.AccountType == "" {
		u.AccountType = "APPLICATION_USER"
	}
	if u.ScopeLevel == "" {
		u.ScopeLevel = "TENANT"
	}
	if u.Status == "" {
		u.Status = "ACTIVE"
	}
	var stored StoredUser
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.UpsertUser(ctx, tx, u, passwordHash)
		return err
	})
	s.users.Invalidate(tenantID)
	return stored.User, err
}

// UpdateUser applies the editable fields, the same set the Node API took.
func (s *Service) UpdateUser(ctx context.Context, tenantID, id string, body Patch) (User, error) {
	existing, err := s.UserByID(ctx, tenantID, id)
	if err != nil {
		return User{}, err
	}
	if existing == nil {
		return User{}, httpx.NotFound("Pengguna tidak ditemukan.")
	}
	u := *existing
	body.str("name", &u.Name)
	body.str("email", &u.Email)
	body.str("role", &u.Role)
	body.str("accountType", &u.AccountType)
	body.str("scopeLevel", &u.ScopeLevel)
	body.optStr("scopeId", &u.ScopeID)
	body.str("status", &u.Status)
	return s.persistUser(ctx, u)
}

func (s *Service) persistUser(ctx context.Context, u User) (User, error) {
	var stored StoredUser
	err := s.pool.WithTenant(ctx, u.TenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.UpsertUser(ctx, tx, u, nil)
		return err
	})
	s.users.Invalidate(u.TenantID)
	return stored.User, err
}

// UpdateUserStatus is the US-005 status change.
func (s *Service) UpdateUserStatus(ctx context.Context, tenantID, id, status string) (User, error) {
	return s.UpdateUser(ctx, tenantID, id, Patch{"status": status})
}

func (s *Service) DeleteUser(ctx context.Context, tenantID, id string) error {
	var deleted bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		deleted, err = s.repo.Remove(ctx, tx, "app_user", tenantID, id)
		return err
	})
	s.users.Invalidate(tenantID)
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.NotFound("Pengguna tidak ditemukan.")
	}
	return nil
}

// SaveUserPassword stores a new hash.
func (s *Service) SaveUserPassword(ctx context.Context, tenantID, userID, hash string) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.SetPassword(ctx, tx, tenantID, userID, hash)
	})
	s.users.Invalidate(tenantID)
	return err
}

// TouchUserLogin records a successful login.
func (s *Service) TouchUserLogin(ctx context.Context, tenantID, userID string, at time.Time) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.TouchLogin(ctx, tx, tenantID, userID, at)
	})
	s.users.Invalidate(tenantID)
	return err
}

// TenantsForEmail is every tenant an application user with this email
// belongs to: the pilot tenant plus every client_account tenant, each
// declared in turn because app_user is tenant-isolated.
func (s *Service) TenantsForEmail(ctx context.Context, pilot, email string) ([]string, error) {
	var others []string
	err := s.pool.WithoutTenant(ctx, func(tx pgx.Tx) error {
		var err error
		others, err = s.repo.TenantsWithAccounts(ctx, tx, pilot)
		return err
	})
	if err != nil {
		return nil, err
	}
	candidates := append([]string{pilot}, others...)
	var out []string
	for _, tenantID := range candidates {
		su, err := s.StoredUserByEmail(ctx, tenantID, email)
		if err != nil {
			return nil, err
		}
		if su != nil {
			out = append(out, tenantID)
		}
	}
	return out, nil
}

// --- Devices ----------------------------------------------------------

func (s *Service) Devices(ctx context.Context, tenantID string) ([]Device, error) {
	return s.devices.Get(ctx, tenantID, func(ctx context.Context) ([]Device, error) {
		var out []Device
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.ListDevices(ctx, tx, tenantID)
			return err
		})
		return out, err
	})
}

func (s *Service) DeviceByID(ctx context.Context, tenantID, id string) (*Device, error) {
	devices, err := s.Devices(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range devices {
		if devices[i].ID == id {
			d := devices[i]
			return &d, nil
		}
	}
	return nil, nil
}

func applyDevice(d *Device, body Patch) {
	body.str("deviceCode", &d.DeviceCode)
	body.str("name", &d.Name)
	body.optStr("assignedLineId", &d.AssignedLineID)
	body.optStr("assignedWorkCenterId", &d.AssignedWorkCenterID)
	body.str("status", &d.Status)
	body.optStr("ipAddress", &d.IPAddress)
	body.optStr("lastHeartbeatAt", &d.LastHeartbeatAt)
}

func (s *Service) CreateDevice(ctx context.Context, tenantID string, body Patch) (Device, error) {
	if err := requireStrings(body, "deviceCode", "name"); err != nil {
		return Device{}, err
	}
	d := Device{ID: newID("dev"), TenantID: tenantID, Status: "ONLINE", RegisteredAt: db.Now()}
	applyDevice(&d, body)
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertDevice(ctx, tx, d) })
	s.devices.Invalidate(tenantID)
	return d, err
}

func (s *Service) UpdateDevice(ctx context.Context, tenantID, id string, body Patch) (Device, error) {
	existing, err := s.DeviceByID(ctx, tenantID, id)
	if err != nil {
		return Device{}, err
	}
	if existing == nil {
		return Device{}, notFound("Device")
	}
	d := *existing
	applyDevice(&d, body)
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertDevice(ctx, tx, d) })
	s.devices.Invalidate(tenantID)
	return d, err
}

func (s *Service) DeleteDevice(ctx context.Context, tenantID, id string) error {
	var deleted bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		deleted, err = s.repo.Remove(ctx, tx, "device_terminal", tenantID, id)
		return err
	})
	s.devices.Invalidate(tenantID)
	if err != nil {
		return err
	}
	if !deleted {
		return notFound("Device")
	}
	return nil
}

// --- KPI targets ------------------------------------------------------

func (s *Service) KpiTargets(ctx context.Context, tenantID string) ([]KpiTarget, error) {
	return s.kpi.Get(ctx, tenantID, func(ctx context.Context) ([]KpiTarget, error) {
		var out []KpiTarget
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.ListKpiTargets(ctx, tx, tenantID)
			return err
		})
		return out, err
	})
}

func (s *Service) KpiTarget(ctx context.Context, tenantID, metric string) (*KpiTarget, error) {
	targets, err := s.KpiTargets(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range targets {
		if targets[i].Metric == metric {
			t := targets[i]
			return &t, nil
		}
	}
	return nil, nil
}

// UpsertKpiTarget creates the metric's target with the Node API's defaults
// or updates the fields sent.
func (s *Service) UpsertKpiTarget(ctx context.Context, tenantID, metric string, body Patch) (KpiTarget, error) {
	existing, err := s.KpiTarget(ctx, tenantID, metric)
	if err != nil {
		return KpiTarget{}, err
	}
	t := KpiTarget{ID: newID("tgt"), TenantID: tenantID, Metric: metric, TargetValue: 85, Unit: "%", Direction: "HIGHER_IS_BETTER", WatchThresholdPct: 95, CriticalThresholdPct: 90}
	if existing != nil {
		t = *existing
	}
	body.num("targetValue", &t.TargetValue)
	body.str("unit", &t.Unit)
	body.str("direction", &t.Direction)
	body.num("watchThresholdPct", &t.WatchThresholdPct)
	body.num("criticalThresholdPct", &t.CriticalThresholdPct)
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertKpiTarget(ctx, tx, t) })
	s.kpi.Invalidate(tenantID)
	return t, err
}

// --- BOM --------------------------------------------------------------

func (s *Service) Boms(ctx context.Context, tenantID string) ([]Bom, error) {
	return s.boms.Get(ctx, tenantID, func(ctx context.Context) ([]Bom, error) {
		var out []Bom
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			out, err = s.repo.ListBoms(ctx, tx, tenantID)
			return err
		})
		return out, err
	})
}

// BomFilter narrows the listing.
type BomFilter struct {
	ProductID string
	Status    string
	Search    string
}

// FilterBoms applies the listing filters, newest first.
func (s *Service) FilterBoms(ctx context.Context, tenantID string, f BomFilter) ([]Bom, error) {
	boms, err := s.Boms(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]Bom, 0, len(boms))
	q := strings.ToLower(f.Search)
	for _, b := range boms {
		if f.ProductID != "" && b.ProductID != f.ProductID {
			continue
		}
		if f.Status != "" && b.Status != f.Status {
			continue
		}
		if q != "" && !(strings.Contains(strings.ToLower(b.BomNumber), q) ||
			strings.Contains(strings.ToLower(b.BomName), q) ||
			strings.Contains(strings.ToLower(b.ProductSKU), q) ||
			strings.Contains(strings.ToLower(b.ProductName), q)) {
			continue
		}
		out = append(out, b)
	}
	return out, nil
}

func (s *Service) BomByID(ctx context.Context, tenantID, id string) (*Bom, error) {
	boms, err := s.Boms(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range boms {
		if boms[i].ID == id {
			b := boms[i]
			return &b, nil
		}
	}
	return nil, nil
}

// ActiveBomForProduct reads straight from PostgreSQL rather than the cache,
// so a requirement is always computed against the stored master (BR-M01).
func (s *Service) ActiveBomForProduct(ctx context.Context, tenantID, productID string) (*Bom, error) {
	var out *Bom
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.FindActiveBomForProduct(ctx, tx, tenantID, productID)
		return err
	})
	return out, err
}
