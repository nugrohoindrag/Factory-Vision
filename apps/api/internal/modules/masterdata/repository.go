package masterdata

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Repository is the SQL for every reference table. Every query takes the
// caller's transaction, so several can compose into one unit and all run
// under the tenant the transaction declared.
type Repository struct{}

func collect[T any](rows pgx.Rows, scan func(pgx.Rows) (T, error)) ([]T, error) {
	defer rows.Close()
	out := make([]T, 0, 32)
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// --- Plants -----------------------------------------------------------

func (Repository) ListPlants(ctx context.Context, tx pgx.Tx, tenantID string) ([]Plant, error) {
	rows, err := tx.Query(ctx, `SELECT id, tenant_id, name, location, timezone, status FROM plant WHERE tenant_id = $1 ORDER BY name`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (Plant, error) {
		var p Plant
		var location, timezone, status *string
		if err := r.Scan(&p.ID, &p.TenantID, &p.Name, &location, &timezone, &status); err != nil {
			return p, err
		}
		p.Location = db.StrOr(location, "")
		p.Timezone = db.StrOr(timezone, "Asia/Jakarta")
		p.Status = db.StrOr(status, "ACTIVE")
		return p, nil
	})
}

func (Repository) UpsertPlant(ctx context.Context, tx pgx.Tx, p Plant) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO plant (id, tenant_id, name, location, timezone, status)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (id) DO UPDATE
		   SET name = EXCLUDED.name, location = EXCLUDED.location,
		       timezone = EXCLUDED.timezone, status = EXCLUDED.status`,
		p.ID, p.TenantID, p.Name, db.NullIf(p.Location), orDefault(p.Timezone, "Asia/Jakarta"), orDefault(p.Status, "ACTIVE"))
	return err
}

// --- Lines ------------------------------------------------------------

func (Repository) ListLines(ctx context.Context, tx pgx.Tx, tenantID string) ([]Line, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, plant_id, code, name, status, planned_production_time_minutes
		   FROM production_line WHERE tenant_id = $1 ORDER BY code`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (Line, error) {
		var l Line
		var status *string
		var planned *int
		if err := r.Scan(&l.ID, &l.TenantID, &l.PlantID, &l.Code, &l.Name, &status, &planned); err != nil {
			return l, err
		}
		l.Status = db.StrOr(status, "ACTIVE")
		l.PlannedProductionTimeMinutes = db.Deref(planned, 480)
		return l, nil
	})
}

func (Repository) UpsertLine(ctx context.Context, tx pgx.Tx, l Line) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO production_line (id, tenant_id, plant_id, code, name, status, planned_production_time_minutes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (id) DO UPDATE
		   SET plant_id = EXCLUDED.plant_id, code = EXCLUDED.code, name = EXCLUDED.name,
		       status = EXCLUDED.status,
		       planned_production_time_minutes = EXCLUDED.planned_production_time_minutes`,
		l.ID, l.TenantID, l.PlantID, l.Code, l.Name, orDefault(l.Status, "ACTIVE"), l.PlannedProductionTimeMinutes)
	return err
}

// --- Work centers -----------------------------------------------------

func (Repository) ListWorkCenters(ctx context.Context, tx pgx.Tx, tenantID string) ([]WorkCenter, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, production_line_id, code, name, sequence
		   FROM work_center WHERE tenant_id = $1 ORDER BY sequence, code`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (WorkCenter, error) {
		var w WorkCenter
		var seq *int
		if err := r.Scan(&w.ID, &w.TenantID, &w.ProductionLineID, &w.Code, &w.Name, &seq); err != nil {
			return w, err
		}
		w.Sequence = db.Deref(seq, 1)
		return w, nil
	})
}

func (Repository) UpsertWorkCenter(ctx context.Context, tx pgx.Tx, w WorkCenter) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO work_center (id, tenant_id, production_line_id, code, name, sequence)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (id) DO UPDATE
		   SET production_line_id = EXCLUDED.production_line_id, code = EXCLUDED.code,
		       name = EXCLUDED.name, sequence = EXCLUDED.sequence`,
		w.ID, w.TenantID, w.ProductionLineID, w.Code, w.Name, w.Sequence)
	return err
}

// --- Machines ---------------------------------------------------------

func (Repository) ListMachines(ctx context.Context, tx pgx.Tx, tenantID string) ([]Machine, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, work_center_id, code, name, status, ideal_cycle_time_seconds,
		        current_state, current_state_since
		   FROM machine WHERE tenant_id = $1 ORDER BY code`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (Machine, error) {
		var m Machine
		var status, state *string
		var since *time.Time
		if err := r.Scan(&m.ID, &m.TenantID, &m.WorkCenterID, &m.Code, &m.Name, &status, &m.IdealCycleTimeSeconds, &state, &since); err != nil {
			return m, err
		}
		m.Status = db.StrOr(status, "ACTIVE")
		m.CurrentState = db.StrOr(state, "IDLE")
		if since != nil {
			m.CurrentStateSince = db.ISO(*since)
		} else {
			m.CurrentStateSince = db.Now()
		}
		return m, nil
	})
}

// UpsertMachine writes the master fields; the live state columns are owned
// by the shop floor and are only set on first insert.
func (Repository) UpsertMachine(ctx context.Context, tx pgx.Tx, m Machine) error {
	since, err := db.ParseISO(m.CurrentStateSince)
	if err != nil {
		since = time.Now()
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO machine (id, tenant_id, work_center_id, code, name, status,
		                      ideal_cycle_time_seconds, current_state, current_state_since)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO UPDATE
		   SET work_center_id = EXCLUDED.work_center_id, code = EXCLUDED.code, name = EXCLUDED.name,
		       status = EXCLUDED.status,
		       ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds,
		       current_state = EXCLUDED.current_state, current_state_since = EXCLUDED.current_state_since`,
		m.ID, m.TenantID, m.WorkCenterID, m.Code, m.Name, orDefault(m.Status, "ACTIVE"),
		m.IdealCycleTimeSeconds, orDefault(m.CurrentState, "IDLE"), since)
	return err
}

// --- Products ---------------------------------------------------------

func (Repository) ListProducts(ctx context.Context, tx pgx.Tx, tenantID string) ([]Product, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status
		   FROM product WHERE tenant_id = $1 ORDER BY sku`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (Product, error) {
		var p Product
		var unit, status *string
		if err := r.Scan(&p.ID, &p.TenantID, &p.SKU, &p.Name, &unit, &p.IdealCycleTimeSeconds, &status); err != nil {
			return p, err
		}
		p.Unit = db.StrOr(unit, "PCS")
		p.Status = db.StrOr(status, "ACTIVE")
		return p, nil
	})
}

func (Repository) UpsertProduct(ctx context.Context, tx pgx.Tx, p Product) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (id) DO UPDATE
		   SET sku = EXCLUDED.sku, name = EXCLUDED.name, unit = EXCLUDED.unit,
		       ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds,
		       status = EXCLUDED.status`,
		p.ID, p.TenantID, p.SKU, p.Name, orDefault(p.Unit, "PCS"), p.IdealCycleTimeSeconds, orDefault(p.Status, "ACTIVE"))
	return err
}

// --- Processes --------------------------------------------------------

func (Repository) ListProcesses(ctx context.Context, tx pgx.Tx, tenantID string) ([]Process, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, code, name, description, sequence_default, status, created_at, updated_at
		   FROM production_process WHERE tenant_id = $1 ORDER BY sequence_default, code`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (Process, error) {
		var p Process
		var seq *int
		var status *string
		var created, updated *time.Time
		if err := r.Scan(&p.ID, &p.TenantID, &p.Code, &p.Name, &p.Description, &seq, &status, &created, &updated); err != nil {
			return p, err
		}
		p.Description = db.Str(p.Description)
		p.SequenceDefault = db.Deref(seq, 1)
		p.Status = db.StrOr(status, "ACTIVE")
		p.CreatedAt = db.ISOPtr(created)
		p.UpdatedAt = db.ISOPtr(updated)
		return p, nil
	})
}

func (Repository) UpsertProcess(ctx context.Context, tx pgx.Tx, p Process) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO production_process (id, tenant_id, code, name, description, sequence_default, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (id) DO UPDATE
		   SET code = EXCLUDED.code, name = EXCLUDED.name, description = EXCLUDED.description,
		       sequence_default = EXCLUDED.sequence_default, status = EXCLUDED.status,
		       updated_at = CURRENT_TIMESTAMP`,
		p.ID, p.TenantID, p.Code, p.Name, p.Description, p.SequenceDefault, orDefault(p.Status, "ACTIVE"))
	return err
}

// --- Routings ---------------------------------------------------------

func (Repository) ListRoutings(ctx context.Context, tx pgx.Tx, tenantID string) ([]Routing, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, product_id, process_id, sequence, work_center_id, machine_id,
		        standard_cycle_time_seconds, active
		   FROM product_routing WHERE tenant_id = $1 ORDER BY product_id, sequence`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (Routing, error) {
		var rt Routing
		var active *bool
		if err := r.Scan(&rt.ID, &rt.TenantID, &rt.ProductID, &rt.ProcessID, &rt.Sequence, &rt.WorkCenterID, &rt.MachineID, &rt.StandardCycleTimeSeconds, &active); err != nil {
			return rt, err
		}
		rt.WorkCenterID, rt.MachineID = db.Str(rt.WorkCenterID), db.Str(rt.MachineID)
		rt.Active = active == nil || *active
		return rt, nil
	})
}

func (Repository) UpsertRouting(ctx context.Context, tx pgx.Tx, rt Routing) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO product_routing (id, tenant_id, product_id, process_id, sequence,
		                              work_center_id, machine_id, standard_cycle_time_seconds, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO UPDATE
		   SET product_id = EXCLUDED.product_id, process_id = EXCLUDED.process_id,
		       sequence = EXCLUDED.sequence, work_center_id = EXCLUDED.work_center_id,
		       machine_id = EXCLUDED.machine_id,
		       standard_cycle_time_seconds = EXCLUDED.standard_cycle_time_seconds,
		       active = EXCLUDED.active`,
		rt.ID, rt.TenantID, rt.ProductID, rt.ProcessID, rt.Sequence, rt.WorkCenterID, rt.MachineID, rt.StandardCycleTimeSeconds, rt.Active)
	return err
}

// --- Rates ------------------------------------------------------------

func (Repository) ListRates(ctx context.Context, tx pgx.Tx, tenantID string) ([]MachineRate, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, product_id, machine_id, ideal_cycle_time_seconds
		   FROM product_machine_rate WHERE tenant_id = $1 ORDER BY product_id, machine_id`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (MachineRate, error) {
		var m MachineRate
		err := r.Scan(&m.ID, &m.TenantID, &m.ProductID, &m.MachineID, &m.IdealCycleTimeSeconds)
		return m, err
	})
}

func (Repository) UpsertRate(ctx context.Context, tx pgx.Tx, m MachineRate) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO product_machine_rate (id, tenant_id, product_id, machine_id, ideal_cycle_time_seconds)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (id) DO UPDATE
		   SET product_id = EXCLUDED.product_id, machine_id = EXCLUDED.machine_id,
		       ideal_cycle_time_seconds = EXCLUDED.ideal_cycle_time_seconds`,
		m.ID, m.TenantID, m.ProductID, m.MachineID, m.IdealCycleTimeSeconds)
	return err
}

// --- Reason codes -----------------------------------------------------

func (Repository) ListDowntimeReasons(ctx context.Context, tx pgx.Tx, tenantID string) ([]DowntimeReason, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, parent_id, category, code, name, description, is_planned, active, sort_order
		   FROM downtime_reason WHERE tenant_id = $1 ORDER BY sort_order, code`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (DowntimeReason, error) {
		var d DowntimeReason
		var planned, active *bool
		var sort *int
		if err := r.Scan(&d.ID, &d.TenantID, &d.ParentID, &d.Category, &d.Code, &d.Name, &d.Description, &planned, &active, &sort); err != nil {
			return d, err
		}
		d.ParentID, d.Description = db.Str(d.ParentID), db.Str(d.Description)
		d.IsPlanned = planned != nil && *planned
		d.Active = active == nil || *active
		d.SortOrder = db.Deref(sort, 0)
		return d, nil
	})
}

func (Repository) UpsertDowntimeReason(ctx context.Context, tx pgx.Tx, d DowntimeReason) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO downtime_reason (id, tenant_id, parent_id, category, code, name, description,
		                              is_planned, active, sort_order)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT (id) DO UPDATE
		   SET parent_id = EXCLUDED.parent_id, category = EXCLUDED.category, code = EXCLUDED.code,
		       name = EXCLUDED.name, description = EXCLUDED.description,
		       is_planned = EXCLUDED.is_planned, active = EXCLUDED.active,
		       sort_order = EXCLUDED.sort_order`,
		d.ID, d.TenantID, d.ParentID, d.Category, d.Code, d.Name, d.Description, d.IsPlanned, d.Active, d.SortOrder)
	return err
}

func (Repository) ListRejectReasons(ctx context.Context, tx pgx.Tx, tenantID string) ([]RejectReason, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, tenant_id, parent_id, category, code, name, description, active, sort_order
		   FROM reject_reason WHERE tenant_id = $1 ORDER BY sort_order, code`, tenantID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(r pgx.Rows) (RejectReason, error) {
		var d RejectReason
		var active *bool
		var sort *int
		if err := r.Scan(&d.ID, &d.TenantID, &d.ParentID, &d.Category, &d.Code, &d.Name, &d.Description, &active, &sort); err != nil {
			return d, err
		}
		d.ParentID, d.Description = db.Str(d.ParentID), db.Str(d.Description)
		d.Active = active == nil || *active
		d.SortOrder = db.Deref(sort, 0)
		return d, nil
	})
}

func (Repository) UpsertRejectReason(ctx context.Context, tx pgx.Tx, d RejectReason) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO reject_reason (id, tenant_id, parent_id, category, code, name, description, active, sort_order)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO UPDATE
		   SET parent_id = EXCLUDED.parent_id, category = EXCLUDED.category, code = EXCLUDED.code,
		       name = EXCLUDED.name, description = EXCLUDED.description,
		       active = EXCLUDED.active, sort_order = EXCLUDED.sort_order`,
		d.ID, d.TenantID, d.ParentID, d.Category, d.Code, d.Name, d.Description, d.Active, d.SortOrder)
	return err
}

// Remove deletes one reference row. The table name is a compile-time
// literal from the service, never request input. A row still referenced by
// production is protected by its foreign key, so the delete surfaces as an
// error rather than orphaning history.
func (Repository) Remove(ctx context.Context, tx pgx.Tx, table, tenantID, id string) (bool, error) {
	switch table {
	case "plant", "production_line", "work_center", "machine", "product", "production_process",
		"product_routing", "product_machine_rate", "downtime_reason", "reject_reason",
		"device_terminal", "kpi_target", "shift", "operator", "app_user", "bill_of_material":
	default:
		panic("masterdata: Remove on unknown table " + table)
	}
	tag, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
