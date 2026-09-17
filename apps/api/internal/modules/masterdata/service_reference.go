package masterdata

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Patch is a decoded JSON body applied field by field to an existing
// record, the way Object.assign(entity, payload) did in the Node API — but
// only for the fields the entity actually has, so a client cannot rewrite
// an id or a tenant.
type Patch map[string]any

func (p Patch) str(key string, dst *string) {
	if v, ok := p[key].(string); ok {
		*dst = v
	}
}

func (p Patch) optStr(key string, dst **string) {
	v, present := p[key]
	if !present {
		return
	}
	if s, ok := v.(string); ok && s != "" {
		*dst = &s
		return
	}
	*dst = nil
}

func (p Patch) num(key string, dst *float64) {
	if v, ok := p[key].(float64); ok {
		*dst = v
	}
}

func (p Patch) optNum(key string, dst **float64) {
	v, present := p[key]
	if !present {
		return
	}
	if f, ok := v.(float64); ok {
		*dst = &f
		return
	}
	*dst = nil
}

func (p Patch) integer(key string, dst *int) {
	if v, ok := p[key].(float64); ok {
		*dst = int(v)
	}
}

func (p Patch) boolean(key string, dst *bool) {
	if v, ok := p[key].(bool); ok {
		*dst = v
	}
}

func (p Patch) has(key string) bool {
	_, ok := p[key]
	return ok
}

// requireStrings is the minimal shape check the Node service left to
// PostgreSQL: a missing NOT NULL column used to come back as a 500 quoting
// the column name. Here it is a 422 naming the field.
func requireStrings(body Patch, fields ...string) error {
	v := httpx.Validate(body)
	for _, f := range fields {
		v.String(f, httpx.Opt{})
	}
	return v.Done()
}

// --- Lines ------------------------------------------------------------

func (s *Service) CreateLine(ctx context.Context, tenantID string, body Patch) (Line, error) {
	if err := requireStrings(body, "plantId", "code", "name"); err != nil {
		return Line{}, err
	}
	l := Line{ID: newID("line"), TenantID: tenantID, Status: "ACTIVE", PlannedProductionTimeMinutes: 480}
	body.str("plantId", &l.PlantID)
	body.str("code", &l.Code)
	body.str("name", &l.Name)
	body.str("status", &l.Status)
	body.integer("plannedProductionTimeMinutes", &l.PlannedProductionTimeMinutes)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertLine(ctx, tx, l) })
	return l, err
}

func (s *Service) UpdateLine(ctx context.Context, tenantID, id string, body Patch) (Line, error) {
	existing, err := s.LineByID(ctx, tenantID, id)
	if err != nil {
		return Line{}, err
	}
	if existing == nil {
		return Line{}, notFound("Line")
	}
	l := *existing
	body.str("plantId", &l.PlantID)
	body.str("code", &l.Code)
	body.str("name", &l.Name)
	body.str("status", &l.Status)
	body.integer("plannedProductionTimeMinutes", &l.PlannedProductionTimeMinutes)
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertLine(ctx, tx, l) })
	return l, err
}

func (s *Service) DeleteLine(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "production_line", id, "Line")
}

// --- Work centers -----------------------------------------------------

func (s *Service) CreateWorkCenter(ctx context.Context, tenantID string, w WorkCenter) (WorkCenter, error) {
	w.ID = newID("wc")
	w.TenantID = tenantID
	if w.Sequence == 0 {
		w.Sequence = 1
	}
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertWorkCenter(ctx, tx, w) })
	return w, err
}

func (s *Service) UpdateWorkCenter(ctx context.Context, tenantID, id string, body Patch) (WorkCenter, error) {
	existing, err := s.WorkCenterByID(ctx, tenantID, id)
	if err != nil {
		return WorkCenter{}, err
	}
	if existing == nil {
		return WorkCenter{}, notFound("Work center")
	}
	w := *existing
	body.str("productionLineId", &w.ProductionLineID)
	body.str("code", &w.Code)
	body.str("name", &w.Name)
	body.integer("sequence", &w.Sequence)
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertWorkCenter(ctx, tx, w) })
	return w, err
}

func (s *Service) DeleteWorkCenter(ctx context.Context, tenantID, id string) error {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return err
	}
	found := false
	for _, w := range r.WorkCenters {
		if w.ID == id {
			found = true
		}
	}
	if !found {
		return notFound("Work center")
	}
	for _, m := range r.Machines {
		if m.WorkCenterID == id {
			return httpx.Conflict("Cannot delete a work center that still has machines assigned")
		}
	}
	return s.remove(ctx, tenantID, "work_center", id, "Work center")
}

// --- Machines ---------------------------------------------------------

func (s *Service) CreateMachine(ctx context.Context, tenantID string, body Patch) (Machine, error) {
	if err := requireStrings(body, "workCenterId", "code", "name"); err != nil {
		return Machine{}, err
	}
	m := Machine{ID: newID("mc"), TenantID: tenantID, Status: "ACTIVE", CurrentState: "IDLE", CurrentStateSince: db.Now()}
	body.str("workCenterId", &m.WorkCenterID)
	body.str("code", &m.Code)
	body.str("name", &m.Name)
	body.str("status", &m.Status)
	body.num("idealCycleTimeSeconds", &m.IdealCycleTimeSeconds)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertMachine(ctx, tx, m) })
	return m, err
}

func (s *Service) UpdateMachine(ctx context.Context, tenantID, id string, body Patch) (Machine, error) {
	existing, err := s.MachineByID(ctx, tenantID, id)
	if err != nil {
		return Machine{}, err
	}
	if existing == nil {
		return Machine{}, notFound("Machine")
	}
	m := *existing
	body.str("workCenterId", &m.WorkCenterID)
	body.str("code", &m.Code)
	body.str("name", &m.Name)
	body.str("status", &m.Status)
	body.num("idealCycleTimeSeconds", &m.IdealCycleTimeSeconds)
	// Maintenance drives the machine's current state (OFFLINE while under
	// repair, IDLE after); the stamp moves only when the state does.
	if state := m.CurrentState; body.has("currentState") {
		body.str("currentState", &m.CurrentState)
		if m.CurrentState != state {
			m.CurrentStateSince = db.Now()
		}
	}
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertMachine(ctx, tx, m) })
	return m, err
}

func (s *Service) DeleteMachine(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "machine", id, "Machine")
}

// --- Products ---------------------------------------------------------

func (s *Service) CreateProduct(ctx context.Context, tenantID string, body Patch) (Product, error) {
	if err := requireStrings(body, "sku", "name"); err != nil {
		return Product{}, err
	}
	p := Product{ID: newID("prod"), TenantID: tenantID, Unit: "PCS", Status: "ACTIVE"}
	body.str("sku", &p.SKU)
	body.str("name", &p.Name)
	body.str("unit", &p.Unit)
	body.str("status", &p.Status)
	body.num("idealCycleTimeSeconds", &p.IdealCycleTimeSeconds)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertProduct(ctx, tx, p) })
	return p, err
}

func (s *Service) UpdateProduct(ctx context.Context, tenantID, id string, body Patch) (Product, error) {
	existing, err := s.ProductByID(ctx, tenantID, id)
	if err != nil {
		return Product{}, err
	}
	if existing == nil {
		return Product{}, notFound("Product")
	}
	p := *existing
	body.str("sku", &p.SKU)
	body.str("name", &p.Name)
	body.str("unit", &p.Unit)
	body.str("status", &p.Status)
	body.num("idealCycleTimeSeconds", &p.IdealCycleTimeSeconds)
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertProduct(ctx, tx, p) })
	return p, err
}

func (s *Service) DeleteProduct(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "product", id, "Product")
}

// --- Processes --------------------------------------------------------

func (s *Service) CreateProcess(ctx context.Context, tenantID string, body Patch) (Process, error) {
	if err := requireStrings(body, "code", "name"); err != nil {
		return Process{}, err
	}
	now := db.Now()
	p := Process{ID: newID("proc"), TenantID: tenantID, SequenceDefault: 1, Status: "ACTIVE", CreatedAt: &now, UpdatedAt: &now}
	body.str("code", &p.Code)
	body.str("name", &p.Name)
	body.optStr("description", &p.Description)
	body.integer("sequenceDefault", &p.SequenceDefault)
	body.str("status", &p.Status)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertProcess(ctx, tx, p) })
	return p, err
}

func (s *Service) UpdateProcess(ctx context.Context, tenantID, id string, body Patch) (Process, error) {
	existing, err := s.ProcessByID(ctx, tenantID, id)
	if err != nil {
		return Process{}, err
	}
	if existing == nil {
		return Process{}, notFound("Production process")
	}
	p := *existing
	body.str("code", &p.Code)
	body.str("name", &p.Name)
	body.optStr("description", &p.Description)
	body.integer("sequenceDefault", &p.SequenceDefault)
	body.str("status", &p.Status)
	p.UpdatedAt = db.Ptr(db.Now())
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertProcess(ctx, tx, p) })
	return p, err
}

func (s *Service) DeleteProcess(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "production_process", id, "Production process")
}

// --- Routings ---------------------------------------------------------

func (s *Service) CreateRouting(ctx context.Context, tenantID string, body Patch) (Routing, error) {
	if err := requireStrings(body, "productId", "processId"); err != nil {
		return Routing{}, err
	}
	rt := Routing{ID: newID("rt"), TenantID: tenantID, Sequence: 1, Active: true}
	body.str("productId", &rt.ProductID)
	body.str("processId", &rt.ProcessID)
	body.integer("sequence", &rt.Sequence)
	body.optStr("workCenterId", &rt.WorkCenterID)
	body.optStr("machineId", &rt.MachineID)
	body.optNum("standardCycleTimeSeconds", &rt.StandardCycleTimeSeconds)
	body.boolean("active", &rt.Active)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertRouting(ctx, tx, rt) })
	return rt, err
}

func (s *Service) UpdateRouting(ctx context.Context, tenantID, id string, body Patch) (Routing, error) {
	existing, err := s.RoutingByID(ctx, tenantID, id)
	if err != nil {
		return Routing{}, err
	}
	if existing == nil {
		return Routing{}, notFound("Product routing")
	}
	rt := *existing
	body.str("productId", &rt.ProductID)
	body.str("processId", &rt.ProcessID)
	body.integer("sequence", &rt.Sequence)
	body.optStr("workCenterId", &rt.WorkCenterID)
	body.optStr("machineId", &rt.MachineID)
	body.optNum("standardCycleTimeSeconds", &rt.StandardCycleTimeSeconds)
	body.boolean("active", &rt.Active)
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertRouting(ctx, tx, rt) })
	return rt, err
}

func (s *Service) DeleteRouting(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "product_routing", id, "Product routing")
}

// --- Rates ------------------------------------------------------------

// UpsertRate creates or updates the rate for a Product x Machine pair.
func (s *Service) UpsertRate(ctx context.Context, tenantID string, body Patch) (MachineRate, error) {
	if err := requireStrings(body, "productId", "machineId"); err != nil {
		return MachineRate{}, err
	}
	var in MachineRate
	body.str("productId", &in.ProductID)
	body.str("machineId", &in.MachineID)
	body.num("idealCycleTimeSeconds", &in.IdealCycleTimeSeconds)
	existing, err := s.Rates(ctx, tenantID, in.ProductID, in.MachineID)
	if err != nil {
		return MachineRate{}, err
	}
	rate := MachineRate{ID: newID("pmr"), TenantID: tenantID, ProductID: in.ProductID, MachineID: in.MachineID, IdealCycleTimeSeconds: in.IdealCycleTimeSeconds}
	if len(existing) > 0 {
		rate = existing[0]
		rate.IdealCycleTimeSeconds = in.IdealCycleTimeSeconds
	}
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertRate(ctx, tx, rate) })
	return rate, err
}

func (s *Service) DeleteRate(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "product_machine_rate", id, "Product machine rate")
}

// --- Reason codes -----------------------------------------------------

func (s *Service) CreateDowntimeReason(ctx context.Context, tenantID string, body Patch) (DowntimeReason, error) {
	if err := requireStrings(body, "category", "code", "name"); err != nil {
		return DowntimeReason{}, err
	}
	d := DowntimeReason{ID: newID("dt"), TenantID: tenantID, Active: true}
	applyDowntimeReason(&d, body)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertDowntimeReason(ctx, tx, d) })
	return d, err
}

func applyDowntimeReason(d *DowntimeReason, body Patch) {
	body.optStr("parentId", &d.ParentID)
	body.str("category", &d.Category)
	body.str("code", &d.Code)
	body.str("name", &d.Name)
	body.optStr("description", &d.Description)
	body.boolean("isPlanned", &d.IsPlanned)
	body.boolean("active", &d.Active)
	body.integer("sortOrder", &d.SortOrder)
}

func (s *Service) UpdateDowntimeReason(ctx context.Context, tenantID, id string, body Patch) (DowntimeReason, error) {
	reasons, err := s.DowntimeReasons(ctx, tenantID)
	if err != nil {
		return DowntimeReason{}, err
	}
	var d *DowntimeReason
	for i := range reasons {
		if reasons[i].ID == id {
			d = &reasons[i]
		}
	}
	if d == nil {
		return DowntimeReason{}, notFound("Downtime reason")
	}
	next := *d
	applyDowntimeReason(&next, body)
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertDowntimeReason(ctx, tx, next) })
	return next, err
}

func (s *Service) DeleteDowntimeReason(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "downtime_reason", id, "Downtime reason")
}

func (s *Service) CreateRejectReason(ctx context.Context, tenantID string, body Patch) (RejectReason, error) {
	if err := requireStrings(body, "category", "code", "name"); err != nil {
		return RejectReason{}, err
	}
	d := RejectReason{ID: newID("rej"), TenantID: tenantID, Active: true}
	applyRejectReason(&d, body)
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertRejectReason(ctx, tx, d) })
	return d, err
}

func applyRejectReason(d *RejectReason, body Patch) {
	body.optStr("parentId", &d.ParentID)
	body.str("category", &d.Category)
	body.str("code", &d.Code)
	body.str("name", &d.Name)
	body.optStr("description", &d.Description)
	body.boolean("active", &d.Active)
	body.integer("sortOrder", &d.SortOrder)
}

func (s *Service) UpdateRejectReason(ctx context.Context, tenantID, id string, body Patch) (RejectReason, error) {
	reasons, err := s.RejectReasons(ctx, tenantID)
	if err != nil {
		return RejectReason{}, err
	}
	var d *RejectReason
	for i := range reasons {
		if reasons[i].ID == id {
			d = &reasons[i]
		}
	}
	if d == nil {
		return RejectReason{}, notFound("Reject reason")
	}
	next := *d
	applyRejectReason(&next, body)
	err = s.write(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertRejectReason(ctx, tx, next) })
	return next, err
}

func (s *Service) DeleteRejectReason(ctx context.Context, tenantID, id string) error {
	return s.remove(ctx, tenantID, "reject_reason", id, "Reject reason")
}

// remove deletes a reference row and reports "not found" when nothing
// matched, in the Node API's English wording, since the console shows it.
func (s *Service) remove(ctx context.Context, tenantID, table, id, what string) error {
	var deleted bool
	err := s.write(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		deleted, err = s.repo.Remove(ctx, tx, table, tenantID, id)
		return err
	})
	if err != nil {
		return err
	}
	if !deleted {
		return notFound(what)
	}
	return nil
}

// UpsertReference writes rows from a bulk source (CSV import, onboarding
// template) in one transaction, then invalidates once.
func (s *Service) UpsertReference(ctx context.Context, tenantID string, fn func(ctx context.Context, tx pgx.Tx, repo Repository) error) error {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return fn(ctx, tx, s.repo) })
	s.Invalidate(tenantID)
	return err
}

func lower(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
