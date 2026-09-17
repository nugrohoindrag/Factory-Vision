package planning

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// The master data planning reads, straight from PostgreSQL and inside the
// transaction it is already running: routing by product with the process's
// active flag, machines compatible with a product and the cycle time for
// that pair, shift minutes for a period.

// Product is what planning needs of a product.
type Product struct {
	ID, SKU, Name, Unit   string
	IdealCycleTimeSeconds float64
	Status                string
}

// RoutingStep is one product_routing row with its process.
type RoutingStep struct {
	RoutingID, ProductID, ProcessID, ProcessCode, ProcessName, ProcessStatus string
	Sequence                                                                 int
	WorkCenterID, MachineID                                                  *string
	StandardCycleTimeSeconds                                                 *float64
	Active                                                                   bool
}

// MachineRate is a machine with the cycle time for one product; nil when no
// product_machine_rate row exists for the pair.
type MachineRate struct {
	MachineID, MachineCode, MachineName, LineID, PlantID, MachineStatus string
	IdealCycleTimeSeconds                                               *float64
}

// Shift is what capacity needs of a shift.
type Shift struct {
	ID, PlantID, Name, StartTime, EndTime string
	BreakMinutes                          int
	CrossesMidnight, Active               bool
}

// Config is the planning policy (§13, §45.6).
type Config struct {
	TenantID               string  `json:"tenantId"`
	PlanningUtilizationPct float64 `json:"planningUtilizationPct"`
	StrictProcessSequence  bool    `json:"strictProcessSequence"`
}

// Reference reads master data for planning.
type Reference struct{}

// FindProduct reads one product; nil when absent.
func (Reference) FindProduct(ctx context.Context, tx pgx.Tx, tenantID, productID string) (*Product, error) {
	var p Product
	var unit *string
	var ideal *float64
	err := tx.QueryRow(ctx, `SELECT id, sku, name, unit, ideal_cycle_time_seconds::float8, status FROM product WHERE tenant_id = $1 AND id = $2`, tenantID, productID).
		Scan(&p.ID, &p.SKU, &p.Name, &unit, &ideal, &p.Status)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Unit = db.Deref(unit, "PCS")
	p.IdealCycleTimeSeconds = db.Deref(ideal, 0)
	return &p, nil
}

// ListRouting is the routing for a product in sequence order, including
// inactive rows and inactive processes: MES-042 has to report them.
func (Reference) ListRouting(ctx context.Context, tx pgx.Tx, tenantID, productID string) ([]RoutingStep, error) {
	rows, err := tx.Query(ctx, `SELECT pr.id, pr.product_id, pr.process_id, pp.code, pp.name, pp.status, pr.sequence, pr.work_center_id, pr.machine_id,
			pr.standard_cycle_time_seconds::float8, pr.active
		FROM product_routing pr JOIN production_process pp ON pp.id = pr.process_id
		WHERE pr.tenant_id = $1 AND pr.product_id = $2 ORDER BY pr.sequence, pr.id`, tenantID, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoutingStep{}
	for rows.Next() {
		var s RoutingStep
		if err := rows.Scan(&s.RoutingID, &s.ProductID, &s.ProcessID, &s.ProcessCode, &s.ProcessName, &s.ProcessStatus, &s.Sequence, &s.WorkCenterID, &s.MachineID, &s.StandardCycleTimeSeconds, &s.Active); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ListMachineRates is every machine on the scope with the product's cycle
// time, LEFT JOINed on product_machine_rate so a rate-less machine comes
// back with nil and can be reported as "kapasitas belum terhitung".
func (Reference) ListMachineRates(ctx context.Context, tx pgx.Tx, tenantID, productID, plantID, lineID string) ([]MachineRate, error) {
	args := []any{tenantID, productID}
	where := []string{"m.tenant_id = $1"}
	if lineID != "" {
		args = append(args, lineID)
		where = append(where, fmt.Sprintf("wc.production_line_id = $%d", len(args)))
	}
	if plantID != "" {
		args = append(args, plantID)
		where = append(where, fmt.Sprintf("pl.plant_id = $%d", len(args)))
	}
	rows, err := tx.Query(ctx, `SELECT m.id, m.code, m.name, pl.id, pl.plant_id, m.status, pmr.ideal_cycle_time_seconds::float8
		FROM machine m
		JOIN work_center wc ON wc.id = m.work_center_id
		JOIN production_line pl ON pl.id = wc.production_line_id
		LEFT JOIN product_machine_rate pmr ON pmr.machine_id = m.id AND pmr.product_id = $2 AND pmr.tenant_id = m.tenant_id
		WHERE `+strings.Join(where, " AND ")+` ORDER BY m.code`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MachineRate{}
	for rows.Next() {
		var m MachineRate
		if err := rows.Scan(&m.MachineID, &m.MachineCode, &m.MachineName, &m.LineID, &m.PlantID, &m.MachineStatus, &m.IdealCycleTimeSeconds); err != nil {
			return nil, err
		}
		if m.IdealCycleTimeSeconds != nil && *m.IdealCycleTimeSeconds <= 0 {
			m.IdealCycleTimeSeconds = nil
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListCompatibleMachines is the machines that hold a rate row for the
// product; when a tenant has declared none at all, every machine on the
// line is a candidate and each is reported as uncomputed.
func (r Reference) ListCompatibleMachines(ctx context.Context, tx pgx.Tx, tenantID, productID, plantID, lineID string) ([]MachineRate, error) {
	all, err := r.ListMachineRates(ctx, tx, tenantID, productID, plantID, lineID)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT machine_id FROM product_machine_rate WHERE tenant_id = $1 AND product_id = $2`, tenantID, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	declared := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		declared[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(declared) == 0 {
		return all, nil
	}
	out := []MachineRate{}
	for _, m := range all {
		if declared[m.MachineID] {
			out = append(out, m)
		}
	}
	return out, nil
}

// ListShifts is every shift, ordered by start time.
func (Reference) ListShifts(ctx context.Context, tx pgx.Tx, tenantID string) ([]Shift, error) {
	rows, err := tx.Query(ctx, `SELECT id, plant_id, name, start_time::text, end_time::text, break_minutes, crosses_midnight, active FROM shift WHERE tenant_id = $1 ORDER BY start_time`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Shift{}
	for rows.Next() {
		var s Shift
		var breakMinutes *int
		var crosses, active *bool
		if err := rows.Scan(&s.ID, &s.PlantID, &s.Name, &s.StartTime, &s.EndTime, &breakMinutes, &crosses, &active); err != nil {
			return nil, err
		}
		if len(s.StartTime) > 5 {
			s.StartTime = s.StartTime[:5]
		}
		if len(s.EndTime) > 5 {
			s.EndTime = s.EndTime[:5]
		}
		s.BreakMinutes = db.Deref(breakMinutes, 0)
		s.CrossesMidnight = db.Deref(crosses, false)
		s.Active = active == nil || *active
		out = append(out, s)
	}
	return out, rows.Err()
}

// FirstActiveLine is the default production line a plant runs.
func (Reference) FirstActiveLine(ctx context.Context, tx pgx.Tx, tenantID string) (lineID, plantID string, err error) {
	err = tx.QueryRow(ctx, `SELECT id, plant_id FROM production_line WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`, tenantID).Scan(&lineID, &plantID)
	if db.IsNoRows(err) {
		return "", "", nil
	}
	return lineID, plantID, err
}

// GetConfig reads the planning policy, with the documented defaults when
// the row is absent: 80% utilization (§45.6) and the soft predecessor guard.
func (Reference) GetConfig(ctx context.Context, tx pgx.Tx, tenantID string) (Config, error) {
	c := Config{TenantID: tenantID, PlanningUtilizationPct: 80}
	err := tx.QueryRow(ctx, `SELECT tenant_id, planning_utilization_pct::float8, strict_process_sequence FROM planning_config WHERE tenant_id = $1`, tenantID).
		Scan(&c.TenantID, &c.PlanningUtilizationPct, &c.StrictProcessSequence)
	if db.IsNoRows(err) {
		return c, nil
	}
	return c, err
}

// UpsertConfig patches the policy.
func (r Reference) UpsertConfig(ctx context.Context, tx pgx.Tx, tenantID string, utilization *float64, strict *bool) (Config, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO planning_config (tenant_id, planning_utilization_pct, strict_process_sequence)
		VALUES ($1, COALESCE($2, 80.0), COALESCE($3, FALSE))
		ON CONFLICT (tenant_id) DO UPDATE SET planning_utilization_pct = COALESCE($2, planning_config.planning_utilization_pct),
			strict_process_sequence = COALESCE($3, planning_config.strict_process_sequence), updated_at = CURRENT_TIMESTAMP`, tenantID, utilization, strict); err != nil {
		return Config{}, err
	}
	return r.GetConfig(ctx, tx, tenantID)
}
