package workforce

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Repository is the workforce tables (migration 030).
type Repository struct{}

type where struct {
	clauses []string
	args    []any
}

func (w *where) add(clause string, arg any) {
	w.args = append(w.args, arg)
	w.clauses = append(w.clauses, fmt.Sprintf(clause, len(w.args)))
}

func (w *where) sql() string { return strings.Join(w.clauses, " AND ") }

// --- Skills ----------------------------------------------------------------

// ListSkills orders by category then code.
func (r Repository) ListSkills(ctx context.Context, tx pgx.Tx, tenantID string) ([]Skill, error) {
	rows, err := tx.Query(ctx, `SELECT id, tenant_id, code, name, category, description, max_level, created_at
		FROM skill WHERE tenant_id = $1 ORDER BY category NULLS LAST, code`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Skill{}
	for rows.Next() {
		var s Skill
		var created time.Time
		if err := rows.Scan(&s.ID, &s.TenantID, &s.Code, &s.Name, &s.Category, &s.Description, &s.MaxLevel, &created); err != nil {
			return nil, err
		}
		s.CreatedAt = db.ISO(created)
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r Repository) findSkill(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Skill, error) {
	skills, err := r.ListSkills(ctx, tx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range skills {
		if skills[i].ID == id {
			return &skills[i], nil
		}
	}
	return nil, nil
}

// UpsertSkill inserts or rewrites a skill by id.
func (r Repository) UpsertSkill(ctx context.Context, tx pgx.Tx, s Skill) error {
	_, err := tx.Exec(ctx, `INSERT INTO skill (id, tenant_id, code, name, category, description, max_level, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
		ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category,
		  description = EXCLUDED.description, max_level = EXCLUDED.max_level`,
		s.ID, s.TenantID, s.Code, s.Name, s.Category, s.Description, s.MaxLevel, s.CreatedAt)
	return err
}

// DeleteSkill removes a skill.
func (r Repository) DeleteSkill(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM skill WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return err
}

// --- Qualifications --------------------------------------------------------

// ListQualifications derives `status` on read: a SUSPENDED decision is stored,
// expiry is compared against CURRENT_DATE (BR-W02).
func (r Repository) ListQualifications(ctx context.Context, tx pgx.Tx, tenantID string, f QualificationFilter) ([]Qualification, error) {
	w := where{}
	w.add("q.tenant_id = $%d", tenantID)
	if f.ID != "" {
		w.add("q.id = $%d", f.ID)
	}
	if f.OperatorID != "" {
		w.add("q.operator_id = $%d", f.OperatorID)
	}
	if f.SkillID != "" {
		w.add("q.skill_id = $%d", f.SkillID)
	}
	if f.ExpiringWithinDays != nil {
		w.args = append(w.args, *f.ExpiringWithinDays)
		w.clauses = append(w.clauses, fmt.Sprintf("q.expiry_date IS NOT NULL AND q.expiry_date <= CURRENT_DATE + make_interval(days => $%d)", len(w.args)))
	}
	rows, err := tx.Query(ctx, `SELECT q.id, q.tenant_id, q.operator_id, o.name, q.skill_id, s.code, s.name, q.level, q.certified_date, q.expiry_date,
			q.issuer, q.certificate_number,
			CASE WHEN q.status = 'SUSPENDED' THEN 'SUSPENDED'
			     WHEN q.expiry_date IS NOT NULL AND q.expiry_date < CURRENT_DATE THEN 'EXPIRED'
			     ELSE 'ACTIVE' END,
			q.suspended_reason, q.created_by, q.created_at, q.updated_at
		FROM operator_qualification q
		JOIN operator o ON o.id = q.operator_id
		JOIN skill s ON s.id = q.skill_id
		WHERE `+w.sql()+` ORDER BY o.name, s.code`, w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Qualification{}
	for rows.Next() {
		var q Qualification
		var certified time.Time
		var expiry *time.Time
		var created, updated time.Time
		if err := rows.Scan(&q.ID, &q.TenantID, &q.OperatorID, &q.OperatorName, &q.SkillID, &q.SkillCode, &q.SkillName, &q.Level, &certified, &expiry,
			&q.Issuer, &q.CertificateNumber, &q.Status, &q.SuspendedReason, &q.CreatedBy, &created, &updated); err != nil {
			return nil, err
		}
		q.CertifiedDate = db.Date(certified)
		q.ExpiryDate = db.DatePtr(expiry)
		q.CreatedAt, q.UpdatedAt = db.ISO(created), db.ISO(updated)
		out = append(out, q)
	}
	return out, rows.Err()
}

// UpsertQualification stores the manual decision only; expiry is derived on read.
func (r Repository) UpsertQualification(ctx context.Context, tx pgx.Tx, q Qualification) error {
	status := "ACTIVE"
	if q.Status == "SUSPENDED" {
		status = "SUSPENDED"
	}
	_, err := tx.Exec(ctx, `INSERT INTO operator_qualification (id, tenant_id, operator_id, skill_id, level, certified_date, expiry_date, issuer,
			certificate_number, status, suspended_reason, created_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz)
		ON CONFLICT (tenant_id, operator_id, skill_id) DO UPDATE SET
			level = EXCLUDED.level, certified_date = EXCLUDED.certified_date, expiry_date = EXCLUDED.expiry_date, issuer = EXCLUDED.issuer,
			certificate_number = EXCLUDED.certificate_number, status = EXCLUDED.status, suspended_reason = EXCLUDED.suspended_reason,
			updated_at = EXCLUDED.updated_at`,
		q.ID, q.TenantID, q.OperatorID, q.SkillID, q.Level, q.CertifiedDate, q.ExpiryDate, q.Issuer, q.CertificateNumber, status, q.SuspendedReason,
		q.CreatedBy, q.CreatedAt, q.UpdatedAt)
	return err
}

// DeleteQualification removes a qualification.
func (r Repository) DeleteQualification(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM operator_qualification WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return err
}

// --- Requirements ----------------------------------------------------------

// ListRequirements lists requirements, optionally for one target.
func (r Repository) ListRequirements(ctx context.Context, tx pgx.Tx, tenantID, targetType, targetID string) ([]Requirement, error) {
	w := where{}
	w.add("r.tenant_id = $%d", tenantID)
	if targetType != "" {
		w.add("r.target_type = $%d", targetType)
	}
	if targetID != "" {
		w.add("r.target_id = $%d", targetID)
	}
	rows, err := tx.Query(ctx, `SELECT r.id, r.tenant_id, r.target_type, r.target_id, COALESCE(m.name, p.name) AS target_name,
			r.skill_id, s.code, s.name, r.minimum_level, r.mandatory, r.created_at
		FROM qualification_requirement r
		JOIN skill s ON s.id = r.skill_id
		LEFT JOIN machine m ON m.id = r.target_id AND r.target_type = 'MACHINE'
		LEFT JOIN production_process p ON p.id = r.target_id AND r.target_type = 'PROCESS'
		WHERE `+w.sql()+` ORDER BY r.target_type, target_name NULLS LAST, s.code`, w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Requirement{}
	for rows.Next() {
		var q Requirement
		var name *string
		var created time.Time
		if err := rows.Scan(&q.ID, &q.TenantID, &q.TargetType, &q.TargetID, &name, &q.SkillID, &q.SkillCode, &q.SkillName, &q.MinimumLevel, &q.Mandatory, &created); err != nil {
			return nil, err
		}
		q.TargetName = db.Deref(name, q.TargetID)
		q.CreatedAt = db.ISO(created)
		out = append(out, q)
	}
	return out, rows.Err()
}

// UpsertRequirement inserts or rewrites a requirement.
func (r Repository) UpsertRequirement(ctx context.Context, tx pgx.Tx, q Requirement) error {
	_, err := tx.Exec(ctx, `INSERT INTO qualification_requirement (id, tenant_id, target_type, target_id, skill_id, minimum_level, mandatory, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
		ON CONFLICT (tenant_id, target_type, target_id, skill_id) DO UPDATE SET minimum_level = EXCLUDED.minimum_level, mandatory = EXCLUDED.mandatory`,
		q.ID, q.TenantID, q.TargetType, q.TargetID, q.SkillID, q.MinimumLevel, q.Mandatory, q.CreatedAt)
	return err
}

// DeleteRequirement removes a requirement.
func (r Repository) DeleteRequirement(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM qualification_requirement WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return err
}

// --- Shift assignments -----------------------------------------------------

// ListShiftAssignments lists assignments, optionally those in force on a date.
func (r Repository) ListShiftAssignments(ctx context.Context, tx pgx.Tx, tenantID, operatorID, shiftID, onDate string) ([]ShiftAssignment, error) {
	w := where{}
	w.add("a.tenant_id = $%d", tenantID)
	if operatorID != "" {
		w.add("a.operator_id = $%d", operatorID)
	}
	if shiftID != "" {
		w.add("a.shift_id = $%d", shiftID)
	}
	if onDate != "" {
		w.args = append(w.args, onDate)
		n := len(w.args)
		w.clauses = append(w.clauses, fmt.Sprintf("a.effective_from <= $%d::date AND (a.effective_to IS NULL OR a.effective_to >= $%d::date)", n, n))
	}
	rows, err := tx.Query(ctx, `SELECT a.id, a.tenant_id, a.operator_id, o.name, a.shift_id, s.name, a.effective_from, a.effective_to, a.is_default, a.created_by, a.created_at
		FROM operator_shift_assignment a
		JOIN operator o ON o.id = a.operator_id
		JOIN shift s ON s.id = a.shift_id
		WHERE `+w.sql()+` ORDER BY o.name, a.effective_from DESC`, w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ShiftAssignment{}
	for rows.Next() {
		var a ShiftAssignment
		var from time.Time
		var to *time.Time
		var created time.Time
		if err := rows.Scan(&a.ID, &a.TenantID, &a.OperatorID, &a.OperatorName, &a.ShiftID, &a.ShiftName, &from, &to, &a.IsDefault, &a.CreatedBy, &created); err != nil {
			return nil, err
		}
		a.EffectiveFrom, a.EffectiveTo, a.CreatedAt = db.Date(from), db.DatePtr(to), db.ISO(created)
		out = append(out, a)
	}
	return out, rows.Err()
}

// InsertShiftAssignment stores an assignment.
func (r Repository) InsertShiftAssignment(ctx context.Context, tx pgx.Tx, a ShiftAssignment) error {
	_, err := tx.Exec(ctx, `INSERT INTO operator_shift_assignment (id, tenant_id, operator_id, shift_id, effective_from, effective_to, is_default, created_by, created_at)
		VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9::timestamptz)`,
		a.ID, a.TenantID, a.OperatorID, a.ShiftID, a.EffectiveFrom, a.EffectiveTo, a.IsDefault, a.CreatedBy, a.CreatedAt)
	return err
}

// DeleteShiftAssignment removes an assignment.
func (r Repository) DeleteShiftAssignment(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM operator_shift_assignment WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return err
}

// --- Availability ----------------------------------------------------------

// CurrentAvailability is the latest window containing now for every active
// operator (or one); an operator without any row is AVAILABLE.
func (r Repository) CurrentAvailability(ctx context.Context, tx pgx.Tx, tenantID, operatorID string, now time.Time) ([]Availability, error) {
	args := []any{tenantID}
	clause := ""
	if operatorID != "" {
		args = append(args, operatorID)
		clause = " AND o.id = $2"
	}
	rows, err := tx.Query(ctx, `SELECT a.id, o.id, o.name, a.state, a.shift_id, s.name, a.effective_from, a.effective_to, a.reason, a.updated_by, a.updated_at
		FROM operator o
		LEFT JOIN LATERAL (
			SELECT * FROM operator_availability av
			WHERE av.tenant_id = o.tenant_id AND av.operator_id = o.id
			  AND av.effective_from <= CURRENT_TIMESTAMP AND (av.effective_to IS NULL OR av.effective_to >= CURRENT_TIMESTAMP)
			ORDER BY av.effective_from DESC LIMIT 1
		) a ON TRUE
		LEFT JOIN shift s ON s.id = a.shift_id
		WHERE o.tenant_id = $1 AND o.status = 'ACTIVE'`+clause+` ORDER BY o.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Availability{}
	for rows.Next() {
		var a Availability
		var id, state *string
		var from, to, updated *time.Time
		if err := rows.Scan(&id, &a.OperatorID, &a.OperatorName, &state, &a.ShiftID, &a.ShiftName, &from, &to, &a.Reason, &a.UpdatedBy, &updated); err != nil {
			return nil, err
		}
		a.ID = db.Deref(id, "avail-default-"+a.OperatorID)
		a.TenantID = tenantID
		a.State = db.Deref(state, "AVAILABLE")
		a.EffectiveFrom = db.ISO(now)
		if from != nil {
			a.EffectiveFrom = db.ISO(*from)
		}
		a.EffectiveTo = db.ISOPtr(to)
		a.UpdatedAt = db.ISO(now)
		if updated != nil {
			a.UpdatedAt = db.ISO(*updated)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetAvailability closes the open window and opens a new one.
func (r Repository) SetAvailability(ctx context.Context, tx pgx.Tx, a Availability) error {
	if _, err := tx.Exec(ctx, `UPDATE operator_availability SET effective_to = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND operator_id = $2 AND effective_to IS NULL`, a.TenantID, a.OperatorID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO operator_availability (id, tenant_id, operator_id, state, shift_id, effective_from, effective_to, reason, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9, CURRENT_TIMESTAMP)`,
		a.ID, a.TenantID, a.OperatorID, a.State, a.ShiftID, a.EffectiveFrom, a.EffectiveTo, a.Reason, a.UpdatedBy)
	return err
}

// --- Labour requirement & assignment ---------------------------------------

type storedRequirement struct {
	RequiredOperators int
	ProcessID         *string
	MachineID         *string
	ShiftID           *string
	Notes             *string
	UpdatedAt         string
}

// UpsertLaborRequirement stores the crew size a work order needs.
func (r Repository) UpsertLaborRequirement(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string, required int, processID, machineID, shiftID, notes *string) error {
	_, err := tx.Exec(ctx, `INSERT INTO labor_requirement (id, tenant_id, work_order_id, process_id, machine_id, required_operators, shift_id, notes, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CURRENT_TIMESTAMP)
		ON CONFLICT (tenant_id, work_order_id) DO UPDATE SET process_id = EXCLUDED.process_id, machine_id = EXCLUDED.machine_id,
			required_operators = EXCLUDED.required_operators, shift_id = EXCLUDED.shift_id, notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP`,
		"lreq-"+workOrderID, tenantID, workOrderID, processID, machineID, required, shiftID, notes)
	return err
}

// FindLaborRequirement reads the stored requirement, if any.
func (r Repository) FindLaborRequirement(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) (*storedRequirement, error) {
	var s storedRequirement
	var updated time.Time
	err := tx.QueryRow(ctx, `SELECT required_operators, process_id, machine_id, shift_id, notes, updated_at FROM labor_requirement WHERE tenant_id = $1 AND work_order_id = $2`,
		tenantID, workOrderID).Scan(&s.RequiredOperators, &s.ProcessID, &s.MachineID, &s.ShiftID, &s.Notes, &updated)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.UpdatedAt = db.ISO(updated)
	return &s, nil
}

// InsertAssignment stores an assignment with its eligibility snapshot.
func (r Repository) InsertAssignment(ctx context.Context, tx pgx.Tx, a Assignment) error {
	var check []byte
	if a.QualificationCheck != nil {
		var err error
		if check, err = db.JSONB(a.QualificationCheck); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `INSERT INTO labor_assignment (id, tenant_id, work_order_id, operator_id, role, shift_id, assigned_by, assigned_at, status, qualification_check)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10)`,
		a.ID, a.TenantID, a.WorkOrderID, a.OperatorID, a.Role, a.ShiftID, a.AssignedBy, a.AssignedAt, a.Status, check)
	return err
}

// ListAssignments lists assignments newest first.
func (r Repository) ListAssignments(ctx context.Context, tx pgx.Tx, tenantID string, f AssignmentFilter) ([]Assignment, error) {
	w := where{}
	w.add("a.tenant_id = $%d", tenantID)
	if f.ID != "" {
		w.add("a.id = $%d", f.ID)
	}
	if f.WorkOrderID != "" {
		w.add("a.work_order_id = $%d", f.WorkOrderID)
	}
	if f.OperatorID != "" {
		w.add("a.operator_id = $%d", f.OperatorID)
	}
	if f.Status != "" {
		w.add("a.status = $%d", f.Status)
	}
	if f.Active {
		w.clauses = append(w.clauses, "a.status IN ('ASSIGNED', 'ACTIVE')")
	}
	rows, err := tx.Query(ctx, `SELECT a.id, a.tenant_id, a.work_order_id, w.wo_number, a.operator_id, o.name, a.role, a.shift_id, a.assigned_by, a.assigned_at,
			a.unassigned_at, a.status, a.qualification_check
		FROM labor_assignment a
		JOIN work_order w ON w.id = a.work_order_id
		JOIN operator o ON o.id = a.operator_id
		WHERE `+w.sql()+` ORDER BY a.assigned_at DESC`, w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		var a Assignment
		var assigned time.Time
		var unassigned *time.Time
		var check *QualificationCheck
		if err := rows.Scan(&a.ID, &a.TenantID, &a.WorkOrderID, &a.WorkOrderNumber, &a.OperatorID, &a.OperatorName, &a.Role, &a.ShiftID, &a.AssignedBy, &assigned,
			&unassigned, &a.Status, &check); err != nil {
			return nil, err
		}
		a.AssignedAt, a.UnassignedAt, a.QualificationCheck = db.ISO(assigned), db.ISOPtr(unassigned), check
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetAssignmentStatus changes status, stamping unassigned_at on completion or cancellation.
func (r Repository) SetAssignmentStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string) error {
	_, err := tx.Exec(ctx, `UPDATE labor_assignment SET status = $3,
			unassigned_at = CASE WHEN $3 IN ('COMPLETED', 'CANCELLED') THEN CURRENT_TIMESTAMP ELSE unassigned_at END
		WHERE tenant_id = $1 AND id = $2`, tenantID, id, status)
	return err
}

// WindowAssignment is an active assignment overlapping a window (for the
// board's operator conflicts).
type WindowAssignment struct {
	WorkOrderID  string
	OperatorID   string
	OperatorName string
}

// AssignmentsInWindow lists active assignments whose work order overlaps [from, to].
func (r Repository) AssignmentsInWindow(ctx context.Context, tx pgx.Tx, tenantID, from, to string) ([]WindowAssignment, error) {
	rows, err := tx.Query(ctx, `SELECT a.work_order_id, a.operator_id, o.name
		FROM labor_assignment a
		JOIN work_order w ON w.id = a.work_order_id
		JOIN operator o ON o.id = a.operator_id
		WHERE a.tenant_id = $1 AND a.status IN ('ASSIGNED', 'ACTIVE') AND w.planned_start <= $3::timestamptz AND w.planned_end >= $2::timestamptz`, tenantID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WindowAssignment{}
	for rows.Next() {
		var a WindowAssignment
		if err := rows.Scan(&a.WorkOrderID, &a.OperatorID, &a.OperatorName); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// --- Labour time -----------------------------------------------------------

// InsertTimeRecord stores a time record.
func (r Repository) InsertTimeRecord(ctx context.Context, tx pgx.Tx, t TimeRecord) error {
	_, err := tx.Exec(ctx, `INSERT INTO labor_time_record (id, tenant_id, operator_id, work_order_id, shift_id, shift_date, started_at, ended_at,
			productive_minutes, available_minutes, category, recorded_by)
		VALUES ($1,$2,$3,$4,$5,$6::date,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12)`,
		t.ID, t.TenantID, t.OperatorID, t.WorkOrderID, t.ShiftID, t.ShiftDate, t.StartedAt, t.EndedAt, t.ProductiveMinutes, t.AvailableMinutes, t.Category, t.RecordedBy)
	return err
}

// ListTimeRecords lists time records newest first (limit ≤ 5000).
func (r Repository) ListTimeRecords(ctx context.Context, tx pgx.Tx, tenantID string, f TimeFilter) ([]TimeRecord, error) {
	w := where{}
	w.add("t.tenant_id = $%d", tenantID)
	if f.OperatorID != "" {
		w.add("t.operator_id = $%d", f.OperatorID)
	}
	if f.WorkOrderID != "" {
		w.add("t.work_order_id = $%d", f.WorkOrderID)
	}
	if f.From != "" {
		w.add("t.shift_date >= $%d::date", f.From)
	}
	if f.To != "" {
		w.add("t.shift_date <= $%d::date", f.To)
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}
	w.args = append(w.args, limit)
	rows, err := tx.Query(ctx, `SELECT t.id, t.tenant_id, t.operator_id, o.name, t.work_order_id, w.wo_number, t.shift_id, t.shift_date, t.started_at, t.ended_at,
			t.productive_minutes::float8, t.available_minutes::float8, t.category, t.recorded_by
		FROM labor_time_record t
		JOIN operator o ON o.id = t.operator_id
		LEFT JOIN work_order w ON w.id = t.work_order_id
		WHERE `+w.sql()+fmt.Sprintf(` ORDER BY t.shift_date DESC, t.started_at DESC LIMIT $%d`, len(w.args)), w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TimeRecord{}
	for rows.Next() {
		var t TimeRecord
		var shiftDate, started time.Time
		var ended *time.Time
		if err := rows.Scan(&t.ID, &t.TenantID, &t.OperatorID, &t.OperatorName, &t.WorkOrderID, &t.WorkOrderNumber, &t.ShiftID, &shiftDate, &started, &ended,
			&t.ProductiveMinutes, &t.AvailableMinutes, &t.Category, &t.RecordedBy); err != nil {
			return nil, err
		}
		t.ShiftDate, t.StartedAt, t.EndedAt = db.Date(shiftDate), db.ISO(started), db.ISOPtr(ended)
		out = append(out, t)
	}
	return out, rows.Err()
}
