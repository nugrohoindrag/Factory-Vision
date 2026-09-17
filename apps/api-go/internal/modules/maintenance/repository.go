package maintenance

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Repository is the maintenance tables.
type Repository struct{}

// PlanFilter narrows plans.
type PlanFilter struct{ ID, MachineID, Status string }

// RequestFilter narrows requests.
type RequestFilter struct {
	ID, Status, MachineID string
	Limit                 int
}

// RecordFilter narrows records.
type RecordFilter struct {
	ID, MachineID, Status, MaintenanceType, From, To string
	Limit                                            int
}

// RecordPatch is what an update may change; nil keeps the column.
type RecordPatch struct {
	Status, TechnicianID, TechnicianName, ScheduledFor, StartedAt, CompletedAt *string
	DurationMinutes                                                            *int
	Problem, RootCause, ActionTaken, Result, DowntimeID, Notes                 *string
	CostReference                                                              *float64
}

// ReliabilityTotals are the failure figures behind the KPIs.
type ReliabilityTotals struct {
	Failures, Emergencies, Preventive int
	RepairMinutes                     float64
}

func arg(params *[]any, v any) string {
	*params = append(*params, v)
	return "$" + strconv.Itoa(len(*params))
}

func parseTS(s *string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := db.ParseISO(*s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

const planSelect = `
  SELECT mp.id, mp.tenant_id, mp.plan_number, mp.name, mp.machine_id, m.name, mp.trigger_type, mp.interval_value, mp.interval_unit, mp.tasks,
         mp.estimated_duration_minutes, mp.last_performed_at, mp.last_performed_meter, mp.next_due_at, mp.next_due_meter, mp.warning_threshold, mp.status,
         mp.created_by, mp.created_at, mp.updated_at
    FROM maintenance_plan mp JOIN machine m ON m.id = mp.machine_id`

// ListPlans reads plans, soonest due first.
func (Repository) ListPlans(ctx context.Context, tx pgx.Tx, tenantID string, f PlanFilter) ([]Plan, error) {
	where := []string{"mp.tenant_id = $1"}
	params := []any{tenantID}
	if f.ID != "" {
		where = append(where, "mp.id = "+arg(&params, f.ID))
	}
	if f.MachineID != "" {
		where = append(where, "mp.machine_id = "+arg(&params, f.MachineID))
	}
	if f.Status != "" {
		where = append(where, "mp.status = "+arg(&params, f.Status))
	}
	rows, err := tx.Query(ctx, planSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY mp.next_due_at NULLS LAST, mp.plan_number`, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		var (
			p                    Plan
			tasks                []byte
			lastAt, nextAt       *time.Time
			createdAt, updatedAt time.Time
		)
		if err := rows.Scan(&p.ID, &p.TenantID, &p.PlanNumber, &p.Name, &p.MachineID, &p.MachineName, &p.TriggerType, &p.IntervalValue, &p.IntervalUnit, &tasks,
			&p.EstimatedDurationMinutes, &lastAt, &p.LastPerformedMeter, &nextAt, &p.NextDueMeter, &p.WarningThreshold, &p.Status, &p.CreatedBy, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		p.Tasks = []string{}
		if list, ok := db.RawJSON(tasks).([]any); ok {
			for _, t := range list {
				if s, ok := t.(string); ok {
					p.Tasks = append(p.Tasks, s)
				}
			}
		}
		p.LastPerformedAt, p.NextDueAt = db.ISOPtr(lastAt), db.ISOPtr(nextAt)
		p.CreatedAt, p.UpdatedAt = db.ISO(createdAt), db.ISO(updatedAt)
		p.CreatedBy = db.Str(p.CreatedBy)
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpsertPlan writes a plan.
func (Repository) UpsertPlan(ctx context.Context, tx pgx.Tx, p Plan) error {
	tasks, err := db.JSONB(p.Tasks)
	if err != nil {
		return err
	}
	if tasks == nil {
		tasks = []byte("[]")
	}
	lastAt, err := parseTS(p.LastPerformedAt)
	if err != nil {
		return err
	}
	nextAt, err := parseTS(p.NextDueAt)
	if err != nil {
		return err
	}
	createdAt, err := db.ParseISO(p.CreatedAt)
	if err != nil {
		return err
	}
	updatedAt, err := db.ParseISO(p.UpdatedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO maintenance_plan (id, tenant_id, plan_number, name, machine_id, trigger_type, interval_value, interval_unit, tasks, estimated_duration_minutes,
		   last_performed_at, last_performed_meter, next_due_at, next_due_meter, warning_threshold, status, created_by, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, machine_id = EXCLUDED.machine_id, trigger_type = EXCLUDED.trigger_type, interval_value = EXCLUDED.interval_value,
		   interval_unit = EXCLUDED.interval_unit, tasks = EXCLUDED.tasks, estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
		   last_performed_at = EXCLUDED.last_performed_at, last_performed_meter = EXCLUDED.last_performed_meter, next_due_at = EXCLUDED.next_due_at,
		   next_due_meter = EXCLUDED.next_due_meter, warning_threshold = EXCLUDED.warning_threshold, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
		p.ID, p.TenantID, p.PlanNumber, p.Name, p.MachineID, p.TriggerType, p.IntervalValue, p.IntervalUnit, tasks, p.EstimatedDurationMinutes,
		lastAt, p.LastPerformedMeter, nextAt, p.NextDueMeter, p.WarningThreshold, p.Status, p.CreatedBy, createdAt, updatedAt)
	return err
}

// DeletePlan removes a plan.
func (Repository) DeletePlan(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM maintenance_plan WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return err
}

// InsertRequest writes a request.
func (Repository) InsertRequest(ctx context.Context, tx pgx.Tx, r Request) error {
	requestedAt, err := db.ParseISO(r.RequestedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO maintenance_request (id, tenant_id, request_number, machine_id, maintenance_type, priority, problem_description, reported_symptom, work_order_id, downtime_id,
		   requested_by, requested_by_name, requested_at, status, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		r.ID, r.TenantID, r.RequestNumber, r.MachineID, r.MaintenanceType, r.Priority, r.ProblemDescription, r.ReportedSymptom, r.WorkOrderID, r.DowntimeID,
		r.RequestedBy, r.RequestedByName, requestedAt, r.Status, r.Notes)
	return err
}

// ListRequests reads requests, newest first.
func (Repository) ListRequests(ctx context.Context, tx pgx.Tx, tenantID string, f RequestFilter) ([]Request, error) {
	where := []string{"mq.tenant_id = $1"}
	params := []any{tenantID}
	if f.ID != "" {
		where = append(where, "mq.id = "+arg(&params, f.ID))
	}
	if f.Status != "" {
		where = append(where, "mq.status = "+arg(&params, f.Status))
	}
	if f.MachineID != "" {
		where = append(where, "mq.machine_id = "+arg(&params, f.MachineID))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := tx.Query(ctx,
		`SELECT mq.id, mq.tenant_id, mq.request_number, mq.machine_id, m.name, mq.maintenance_type, mq.priority, mq.problem_description, mq.reported_symptom, mq.work_order_id,
		        mq.downtime_id, mq.requested_by, mq.requested_by_name, mq.requested_at, mq.status, mq.maintenance_record_id, mq.notes
		   FROM maintenance_request mq JOIN machine m ON m.id = mq.machine_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY mq.requested_at DESC LIMIT `+arg(&params, limit), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		var r Request
		var requestedAt time.Time
		if err := rows.Scan(&r.ID, &r.TenantID, &r.RequestNumber, &r.MachineID, &r.MachineName, &r.MaintenanceType, &r.Priority, &r.ProblemDescription, &r.ReportedSymptom, &r.WorkOrderID,
			&r.DowntimeID, &r.RequestedBy, &r.RequestedByName, &requestedAt, &r.Status, &r.MaintenanceRecordID, &r.Notes); err != nil {
			return nil, err
		}
		r.RequestedAt = db.ISO(requestedAt)
		r.ReportedSymptom, r.WorkOrderID, r.DowntimeID, r.RequestedByName, r.MaintenanceRecordID, r.Notes = db.Str(r.ReportedSymptom), db.Str(r.WorkOrderID), db.Str(r.DowntimeID), db.Str(r.RequestedByName), db.Str(r.MaintenanceRecordID), db.Str(r.Notes)
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetRequestStatus moves a request.
func (Repository) SetRequestStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string, recordID *string) error {
	_, err := tx.Exec(ctx, `UPDATE maintenance_request SET status = $3, maintenance_record_id = COALESCE($4, maintenance_record_id) WHERE tenant_id = $1 AND id = $2`, tenantID, id, status, recordID)
	return err
}

// InsertRecord writes a record.
func (Repository) InsertRecord(ctx context.Context, tx pgx.Tx, r Record) error {
	scheduledFor, err := parseTS(r.ScheduledFor)
	if err != nil {
		return err
	}
	startedAt, err := parseTS(r.StartedAt)
	if err != nil {
		return err
	}
	completedAt, err := parseTS(r.CompletedAt)
	if err != nil {
		return err
	}
	createdAt, err := db.ParseISO(r.CreatedAt)
	if err != nil {
		return err
	}
	updatedAt, err := db.ParseISO(r.UpdatedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO maintenance_record (id, tenant_id, maintenance_number, machine_id, maintenance_type, maintenance_plan_id, maintenance_request_id, downtime_id, status, problem,
		   root_cause, action_taken, requester_id, requester_name, technician_id, technician_name, scheduled_for, started_at, completed_at, duration_minutes, result, cost_reference, notes, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
		r.ID, r.TenantID, r.MaintenanceNumber, r.MachineID, r.MaintenanceType, r.MaintenancePlanID, r.MaintenanceRequestID, r.DowntimeID, r.Status, r.Problem,
		r.RootCause, r.ActionTaken, r.RequesterID, r.RequesterName, r.TechnicianID, r.TechnicianName, scheduledFor, startedAt, completedAt, r.DurationMinutes, r.Result, r.CostReference, r.Notes, createdAt, updatedAt)
	return err
}

// UpdateRecord applies a patch.
func (Repository) UpdateRecord(ctx context.Context, tx pgx.Tx, tenantID, id string, p RecordPatch) error {
	var sets []string
	params := []any{tenantID, id}
	str := func(column string, v *string) {
		if v != nil {
			sets = append(sets, column+" = "+arg(&params, *v))
		}
	}
	ts := func(column string, v *string) error {
		if v == nil {
			return nil
		}
		t, err := db.ParseISO(*v)
		if err != nil {
			return fmt.Errorf("%s: %w", column, err)
		}
		sets = append(sets, column+" = "+arg(&params, t))
		return nil
	}
	str("status", p.Status)
	str("technician_id", p.TechnicianID)
	str("technician_name", p.TechnicianName)
	for _, c := range []struct {
		column string
		value  *string
	}{{"scheduled_for", p.ScheduledFor}, {"started_at", p.StartedAt}, {"completed_at", p.CompletedAt}} {
		if err := ts(c.column, c.value); err != nil {
			return err
		}
	}
	if p.DurationMinutes != nil {
		sets = append(sets, "duration_minutes = "+arg(&params, *p.DurationMinutes))
	}
	str("problem", p.Problem)
	str("root_cause", p.RootCause)
	str("action_taken", p.ActionTaken)
	str("result", p.Result)
	if p.CostReference != nil {
		sets = append(sets, "cost_reference = "+arg(&params, *p.CostReference))
	}
	str("downtime_id", p.DowntimeID)
	str("notes", p.Notes)
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	_, err := tx.Exec(ctx, `UPDATE maintenance_record SET `+strings.Join(sets, ", ")+` WHERE tenant_id = $1 AND id = $2`, params...)
	return err
}

const recordSelect = `
  SELECT mr.id, mr.tenant_id, mr.maintenance_number, mr.machine_id, m.name, mr.maintenance_type, mr.maintenance_plan_id, mr.maintenance_request_id, mr.downtime_id,
         mr.status, mr.problem, mr.root_cause, mr.action_taken, mr.requester_id, mr.requester_name, mr.technician_id, mr.technician_name, mr.scheduled_for, mr.started_at,
         mr.completed_at, mr.duration_minutes, mr.result, mr.cost_reference, mr.notes, mr.created_at, mr.updated_at
    FROM maintenance_record mr JOIN machine m ON m.id = mr.machine_id`

// ListRecords reads records, most recent activity first, with parts.
func (Repository) ListRecords(ctx context.Context, tx pgx.Tx, tenantID string, f RecordFilter) ([]Record, error) {
	where := []string{"mr.tenant_id = $1"}
	params := []any{tenantID}
	if f.ID != "" {
		where = append(where, "mr.id = "+arg(&params, f.ID))
	}
	if f.MachineID != "" {
		where = append(where, "mr.machine_id = "+arg(&params, f.MachineID))
	}
	if f.Status != "" {
		where = append(where, "mr.status = "+arg(&params, f.Status))
	}
	if f.MaintenanceType != "" {
		where = append(where, "mr.maintenance_type = "+arg(&params, f.MaintenanceType))
	}
	if f.From != "" {
		where = append(where, "COALESCE(mr.started_at, mr.created_at) >= "+arg(&params, f.From)+"::timestamptz")
	}
	if f.To != "" {
		where = append(where, "COALESCE(mr.started_at, mr.created_at) <= "+arg(&params, f.To)+"::timestamptz")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := tx.Query(ctx, recordSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY COALESCE(mr.started_at, mr.created_at) DESC LIMIT `+arg(&params, limit), params...)
	if err != nil {
		return nil, err
	}
	out := []Record{}
	for rows.Next() {
		var (
			r                                    Record
			scheduledFor, startedAt, completedAt *time.Time
			createdAt, updatedAt                 time.Time
		)
		if err := rows.Scan(&r.ID, &r.TenantID, &r.MaintenanceNumber, &r.MachineID, &r.MachineName, &r.MaintenanceType, &r.MaintenancePlanID, &r.MaintenanceRequestID, &r.DowntimeID,
			&r.Status, &r.Problem, &r.RootCause, &r.ActionTaken, &r.RequesterID, &r.RequesterName, &r.TechnicianID, &r.TechnicianName, &scheduledFor, &startedAt,
			&completedAt, &r.DurationMinutes, &r.Result, &r.CostReference, &r.Notes, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		r.ScheduledFor, r.StartedAt, r.CompletedAt = db.ISOPtr(scheduledFor), db.ISOPtr(startedAt), db.ISOPtr(completedAt)
		r.CreatedAt, r.UpdatedAt = db.ISO(createdAt), db.ISO(updatedAt)
		r.Parts = []PartUsage{}
		r.MaintenancePlanID, r.MaintenanceRequestID, r.DowntimeID = db.Str(r.MaintenancePlanID), db.Str(r.MaintenanceRequestID), db.Str(r.DowntimeID)
		r.Problem, r.RootCause, r.ActionTaken, r.RequesterID, r.RequesterName = db.Str(r.Problem), db.Str(r.RootCause), db.Str(r.ActionTaken), db.Str(r.RequesterID), db.Str(r.RequesterName)
		r.TechnicianID, r.TechnicianName, r.Result, r.Notes = db.Str(r.TechnicianID), db.Str(r.TechnicianName), db.Str(r.Result), db.Str(r.Notes)
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(out) == 0 {
		return out, err
	}
	ids := make([]string, len(out))
	index := map[string]int{}
	for k, r := range out {
		ids[k] = r.ID
		index[r.ID] = k
	}
	prows, err := tx.Query(ctx, `SELECT id, maintenance_record_id, part_id, part_name, quantity, uom, cost_reference FROM maintenance_part_usage WHERE maintenance_record_id = ANY($1::varchar[])`, ids)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var p PartUsage
		if err := prows.Scan(&p.ID, &p.MaintenanceRecordID, &p.PartID, &p.PartName, &p.Quantity, &p.UOM, &p.CostReference); err != nil {
			return nil, err
		}
		p.PartID = db.Str(p.PartID)
		if k, ok := index[p.MaintenanceRecordID]; ok {
			out[k].Parts = append(out[k].Parts, p)
		}
	}
	return out, prows.Err()
}

// InsertPart writes a part usage.
func (Repository) InsertPart(ctx context.Context, tx pgx.Tx, tenantID string, p PartUsage) error {
	_, err := tx.Exec(ctx, `INSERT INTO maintenance_part_usage (id, tenant_id, maintenance_record_id, part_id, part_name, quantity, uom, cost_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		p.ID, tenantID, p.MaintenanceRecordID, p.PartID, p.PartName, p.Quantity, p.UOM, p.CostReference)
	return err
}

// MachineUnderMaintenance reports an open record on a machine.
func (Repository) MachineUnderMaintenance(ctx context.Context, tx pgx.Tx, tenantID, machineID string) (bool, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM maintenance_record WHERE tenant_id = $1 AND machine_id = $2 AND status IN ('IN_PROGRESS', 'WAITING_PART', 'TESTING')`, tenantID, machineID).Scan(&n)
	return n > 0, err
}

// ReliabilityTotals sums failures and repair time over a window.
func (Repository) ReliabilityTotals(ctx context.Context, tx pgx.Tx, tenantID, from, to, machineID string) (ReliabilityTotals, error) {
	params := []any{tenantID, from, to}
	machineClause := ""
	if machineID != "" {
		machineClause = " AND machine_id = " + arg(&params, machineID)
	}
	var t ReliabilityTotals
	err := tx.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE maintenance_type IN ('CORRECTIVE', 'EMERGENCY')),
		        COALESCE(sum(duration_minutes) FILTER (WHERE maintenance_type IN ('CORRECTIVE', 'EMERGENCY')), 0),
		        count(*) FILTER (WHERE maintenance_type = 'EMERGENCY'),
		        count(*) FILTER (WHERE maintenance_type = 'PREVENTIVE' AND status = 'COMPLETED')
		   FROM maintenance_record
		  WHERE tenant_id = $1 AND COALESCE(started_at, created_at) >= $2::timestamptz AND COALESCE(started_at, created_at) <= $3::timestamptz`+machineClause, params...).
		Scan(&t.Failures, &t.RepairMinutes, &t.Emergencies, &t.Preventive)
	return t, err
}

// NextNumber is <prefix>-<year>-<count+1 padded to 4>.
func (Repository) NextNumber(ctx context.Context, tx pgx.Tx, tenantID, table, prefix string) (string, error) {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE tenant_id = $1`, tenantID).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%d-%04d", prefix, time.Now().Year(), n+1), nil
}
