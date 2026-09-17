package shopfloor

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// --- production_record ---------------------------------------------------

const recordColumns = `
  id, tenant_id, work_order_id, process_id, batch_id, machine_id, operator_id,
  shift_id, to_char(shift_date, 'YYYY-MM-DD'),
  good_quantity, reject_quantity, reject_reason_id, recorded_at, source,
  client_event_id, correction_of_id, notes,
  input_quantity, scrap_quantity, rework_quantity, is_batch_managed, has_child_work_order`

// ProductionRecordRepository is the production_record table.
type ProductionRecordRepository struct{}

func scanRecord(rows pgx.Rows) (ProductionRecord, error) {
	var (
		r                                  ProductionRecord
		good, reject, input, scrap, rework *int
		source                             *string
		isBatch, hasChild                  *bool
		recordedAt                         time.Time
	)
	if err := rows.Scan(&r.ID, &r.TenantID, &r.WorkOrderID, &r.ProcessID, &r.BatchID, &r.MachineID, &r.OperatorID,
		&r.ShiftID, &r.ShiftDate, &good, &reject, &r.RejectReasonID, &recordedAt, &source,
		&r.ClientEventID, &r.CorrectionOfID, &r.Notes, &input, &scrap, &rework, &isBatch, &hasChild); err != nil {
		return r, err
	}
	r.GoodQuantity, r.RejectQuantity = db.Deref(good, 0), db.Deref(reject, 0)
	r.InputQuantity, r.ScrapQuantity, r.ReworkQuantity = db.Deref(input, 0), db.Deref(scrap, 0), db.Deref(rework, 0)
	r.RecordedAt = db.ISO(recordedAt)
	r.Source = db.StrOr(source, "OPERATOR_MANUAL")
	r.IsBatchManaged, r.HasChildWorkOrder = db.Deref(isBatch, false), db.Deref(hasChild, false)
	r.ProcessID, r.BatchID = db.Str(r.ProcessID), db.Str(r.BatchID)
	r.RejectReasonID, r.CorrectionOfID, r.Notes = db.Str(r.RejectReasonID), db.Str(r.CorrectionOfID), db.Str(r.Notes)
	return r, nil
}

func collectRecords(rows pgx.Rows, err error) ([]ProductionRecord, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProductionRecord{}
	for rows.Next() {
		r, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func oneRecord(rows pgx.Rows, err error) (*ProductionRecord, error) {
	list, err := collectRecords(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func parseDate(s string) (time.Time, error) { return time.Parse("2006-01-02", s) }

// Create inserts a record, or returns the one this client event already
// produced. Idempotency is uq_prod_record_client_event, not an in-process
// set, so it holds across restarts and replicas.
func (ProductionRecordRepository) Create(ctx context.Context, tx pgx.Tx, r ProductionRecord) (ProductionRecord, bool, error) {
	shiftDate, err := parseDate(r.ShiftDate)
	if err != nil {
		return r, false, fmt.Errorf("shiftDate: %w", err)
	}
	recordedAt, err := db.ParseISO(r.RecordedAt)
	if err != nil {
		return r, false, fmt.Errorf("recordedAt: %w", err)
	}
	source := r.Source
	if source == "" {
		source = "OPERATOR_MANUAL"
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO production_record (
		   id, tenant_id, work_order_id, process_id, batch_id, machine_id, operator_id,
		   shift_id, shift_date, good_quantity, reject_quantity, reject_reason_id,
		   recorded_at, source, client_event_id, correction_of_id, notes,
		   input_quantity, scrap_quantity, rework_quantity, is_batch_managed, has_child_work_order
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
		 ON CONFLICT (tenant_id, client_event_id) DO NOTHING
		 RETURNING `+recordColumns,
		r.ID, r.TenantID, r.WorkOrderID, r.ProcessID, r.BatchID, r.MachineID, r.OperatorID,
		r.ShiftID, shiftDate, r.GoodQuantity, r.RejectQuantity, r.RejectReasonID,
		recordedAt, source, r.ClientEventID, r.CorrectionOfID, r.Notes,
		r.InputQuantity, r.ScrapQuantity, r.ReworkQuantity, r.IsBatchManaged, r.HasChildWorkOrder)
	created, err := oneRecord(rows, err)
	if err != nil {
		return r, false, err
	}
	if created != nil {
		return *created, true, nil
	}
	existing, err := (ProductionRecordRepository{}).FindByClientEventID(ctx, tx, r.TenantID, r.ClientEventID)
	if err != nil {
		return r, false, err
	}
	if existing == nil {
		return r, false, fmt.Errorf("production_record %s conflicted but could not be read back", r.ClientEventID)
	}
	return *existing, false, nil
}

// FindByClientEventID reads the record a client event produced.
func (ProductionRecordRepository) FindByClientEventID(ctx context.Context, tx pgx.Tx, tenantID, clientEventID string) (*ProductionRecord, error) {
	rows, err := tx.Query(ctx, `SELECT `+recordColumns+` FROM production_record WHERE tenant_id = $1 AND client_event_id = $2`, tenantID, clientEventID)
	return oneRecord(rows, err)
}

// FindByID reads one record.
func (ProductionRecordRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*ProductionRecord, error) {
	rows, err := tx.Query(ctx, `SELECT `+recordColumns+` FROM production_record WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return oneRecord(rows, err)
}

// List reads records, oldest first, bounded.
func (ProductionRecordRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, f ProductionRecordFilter) ([]ProductionRecord, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.WorkOrderID != "" {
		where = append(where, "work_order_id = "+arg(f.WorkOrderID))
	}
	if f.FromShiftDate != "" {
		where = append(where, "shift_date >= "+arg(f.FromShiftDate)+"::date")
	}
	if f.ToShiftDate != "" {
		where = append(where, "shift_date <= "+arg(f.ToShiftDate)+"::date")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 5000
	}
	if limit > 20000 {
		limit = 20000
	}
	rows, err := tx.Query(ctx,
		`SELECT `+recordColumns+` FROM production_record WHERE `+strings.Join(where, " AND ")+
			` ORDER BY recorded_at ASC, id ASC LIMIT `+arg(limit)+` OFFSET `+arg(f.Offset), params...)
	return collectRecords(rows, err)
}

// Count is the tenant's record count.
func (ProductionRecordRepository) Count(ctx context.Context, tx pgx.Tx, tenantID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM production_record WHERE tenant_id = $1`, tenantID).Scan(&n)
	return n, err
}

// --- downtime_record -----------------------------------------------------

const downtimeColumns = `
  id, tenant_id, work_order_id, process_id, machine_id, line_id, operator_id,
  shift_id, to_char(shift_date, 'YYYY-MM-DD'), reason_id,
  start_time, end_time, duration_seconds, is_planned, notes, client_event_id, status`

// DowntimeRepository is the downtime_record table.
type DowntimeRepository struct{}

func scanDowntime(rows pgx.Rows) (DowntimeRecord, error) {
	var (
		d         DowntimeRecord
		startTime time.Time
		endTime   *time.Time
		isPlanned *bool
		status    *string
	)
	if err := rows.Scan(&d.ID, &d.TenantID, &d.WorkOrderID, &d.ProcessID, &d.MachineID, &d.LineID, &d.OperatorID,
		&d.ShiftID, &d.ShiftDate, &d.ReasonID, &startTime, &endTime, &d.DurationSeconds, &isPlanned, &d.Notes,
		&d.ClientEventID, &status); err != nil {
		return d, err
	}
	d.StartTime = db.ISO(startTime)
	d.EndTime = db.ISOPtr(endTime)
	d.IsPlanned = db.Deref(isPlanned, false)
	d.Status = db.StrOr(status, "ACTIVE")
	d.WorkOrderID, d.ProcessID, d.OperatorID, d.Notes = db.Str(d.WorkOrderID), db.Str(d.ProcessID), db.Str(d.OperatorID), db.Str(d.Notes)
	return d, nil
}

func collectDowntimes(rows pgx.Rows, err error) ([]DowntimeRecord, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DowntimeRecord{}
	for rows.Next() {
		d, err := scanDowntime(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func oneDowntime(rows pgx.Rows, err error) (*DowntimeRecord, error) {
	list, err := collectDowntimes(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// Create inserts, or returns the record this client event already produced.
func (DowntimeRepository) Create(ctx context.Context, tx pgx.Tx, d DowntimeRecord) (DowntimeRecord, bool, error) {
	shiftDate, err := parseDate(d.ShiftDate)
	if err != nil {
		return d, false, fmt.Errorf("shiftDate: %w", err)
	}
	startTime, err := db.ParseISO(d.StartTime)
	if err != nil {
		return d, false, fmt.Errorf("startTime: %w", err)
	}
	var endTime *time.Time
	if d.EndTime != nil {
		t, err := db.ParseISO(*d.EndTime)
		if err != nil {
			return d, false, fmt.Errorf("endTime: %w", err)
		}
		endTime = &t
	}
	status := d.Status
	if status == "" {
		status = "ACTIVE"
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO downtime_record (
		   id, tenant_id, work_order_id, process_id, machine_id, line_id, operator_id,
		   shift_id, shift_date, reason_id, start_time, end_time, duration_seconds,
		   is_planned, notes, client_event_id, status
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15,$16,$17)
		 ON CONFLICT (tenant_id, client_event_id) DO NOTHING
		 RETURNING `+downtimeColumns,
		d.ID, d.TenantID, d.WorkOrderID, d.ProcessID, d.MachineID, d.LineID, d.OperatorID,
		d.ShiftID, shiftDate, d.ReasonID, startTime, endTime, d.DurationSeconds,
		d.IsPlanned, d.Notes, d.ClientEventID, status)
	created, err := oneDowntime(rows, err)
	if err != nil {
		return d, false, err
	}
	if created != nil {
		return *created, true, nil
	}
	existing, err := (DowntimeRepository{}).FindByClientEventID(ctx, tx, d.TenantID, d.ClientEventID)
	if err != nil {
		return d, false, err
	}
	if existing == nil {
		return d, false, fmt.Errorf("downtime_record %s conflicted but could not be read back", d.ClientEventID)
	}
	return *existing, false, nil
}

// Resolve closes an open downtime. The status guard makes a replayed
// resolve a no-op, so the original duration stands.
func (r DowntimeRepository) Resolve(ctx context.Context, tx pgx.Tx, tenantID, id, endTime string, durationSeconds int) (*DowntimeRecord, error) {
	end, err := db.ParseISO(endTime)
	if err != nil {
		return nil, fmt.Errorf("occurredAt: %w", err)
	}
	rows, err := tx.Query(ctx,
		`UPDATE downtime_record SET end_time = $3, duration_seconds = $4, status = 'RESOLVED'
		  WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'
		  RETURNING `+downtimeColumns, tenantID, id, end, durationSeconds)
	resolved, err := oneDowntime(rows, err)
	if err != nil || resolved != nil {
		return resolved, err
	}
	return r.FindByID(ctx, tx, tenantID, id)
}

// FindByID reads one downtime.
func (DowntimeRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*DowntimeRecord, error) {
	rows, err := tx.Query(ctx, `SELECT `+downtimeColumns+` FROM downtime_record WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return oneDowntime(rows, err)
}

// FindByClientEventID reads the downtime a client event produced.
func (DowntimeRepository) FindByClientEventID(ctx context.Context, tx pgx.Tx, tenantID, clientEventID string) (*DowntimeRecord, error) {
	rows, err := tx.Query(ctx, `SELECT `+downtimeColumns+` FROM downtime_record WHERE tenant_id = $1 AND client_event_id = $2`, tenantID, clientEventID)
	return oneDowntime(rows, err)
}

// FindActiveForMachine is the open downtime on a machine, if any.
func (DowntimeRepository) FindActiveForMachine(ctx context.Context, tx pgx.Tx, tenantID, machineID string) (*DowntimeRecord, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+downtimeColumns+` FROM downtime_record
		  WHERE tenant_id = $1 AND machine_id = $2 AND status = 'ACTIVE' ORDER BY start_time DESC LIMIT 1`, tenantID, machineID)
	return oneDowntime(rows, err)
}

// FindActiveForWorkOrder is the open downtime on a work order, if any.
func (DowntimeRepository) FindActiveForWorkOrder(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) (*DowntimeRecord, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+downtimeColumns+` FROM downtime_record
		  WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'ACTIVE' ORDER BY start_time DESC LIMIT 1`, tenantID, workOrderID)
	return oneDowntime(rows, err)
}

// ListActive is every open downtime, newest first.
func (DowntimeRepository) ListActive(ctx context.Context, tx pgx.Tx, tenantID string) ([]DowntimeRecord, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+downtimeColumns+` FROM downtime_record WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY start_time DESC`, tenantID)
	return collectDowntimes(rows, err)
}

// List reads downtimes, oldest first, bounded.
func (DowntimeRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, f DowntimeFilter) ([]DowntimeRecord, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.LineID != "" {
		where = append(where, "line_id = "+arg(f.LineID))
	}
	if f.FromShiftDate != "" {
		where = append(where, "shift_date >= "+arg(f.FromShiftDate)+"::date")
	}
	if f.ToShiftDate != "" {
		where = append(where, "shift_date <= "+arg(f.ToShiftDate)+"::date")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 5000
	}
	if limit > 20000 {
		limit = 20000
	}
	rows, err := tx.Query(ctx,
		`SELECT `+downtimeColumns+` FROM downtime_record WHERE `+strings.Join(where, " AND ")+
			` ORDER BY start_time ASC, id ASC LIMIT `+arg(limit)+` OFFSET `+arg(f.Offset), params...)
	return collectDowntimes(rows, err)
}

// Count is the tenant's downtime count.
func (DowntimeRepository) Count(ctx context.Context, tx pgx.Tx, tenantID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM downtime_record WHERE tenant_id = $1`, tenantID).Scan(&n)
	return n, err
}

// --- sync_event ----------------------------------------------------------

// SyncEventRepository is the durable idempotency ledger for offline replay
// (US-046): the only protection for commands that write no row of their
// own (the work order transitions), and a second record for the rest.
type SyncEventRepository struct{}

// Claim records a client event as applied; false when it already was. The
// insert itself is the check, so two concurrent replays cannot both pass.
func (SyncEventRepository) Claim(ctx context.Context, tx pgx.Tx, tenantID, clientEventID, commandType string, workOrderID, entityID *string) (bool, error) {
	tag, err := tx.Exec(ctx,
		`INSERT INTO sync_event (tenant_id, client_event_id, command_type, work_order_id, entity_id)
		 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, client_event_id) DO NOTHING`,
		tenantID, clientEventID, commandType, workOrderID, entityID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Processed reports which of the given client events were already applied,
// in one round trip.
func (SyncEventRepository) Processed(ctx context.Context, tx pgx.Tx, tenantID string, clientEventIDs []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(clientEventIDs) == 0 {
		return out, nil
	}
	rows, err := tx.Query(ctx,
		`SELECT client_event_id FROM sync_event WHERE tenant_id = $1 AND client_event_id = ANY($2)`, tenantID, clientEventIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// Has reports whether one client event was already applied.
func (SyncEventRepository) Has(ctx context.Context, tx pgx.Tx, tenantID, clientEventID string) (bool, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM sync_event WHERE tenant_id = $1 AND client_event_id = $2`, tenantID, clientEventID).Scan(&n)
	return n > 0, err
}

// --- sync_exception ------------------------------------------------------

// SyncExceptionRepository is the record of what the shop floor captured and
// the server refused (MES-082). Writes are upserts on client_event_id: a
// retry updates its exception rather than filing a second one.
type SyncExceptionRepository struct{}

const exceptionColumns = `
  e.id, e.tenant_id, e.client_event_id, e.command_type, e.work_order_id, e.operator_id,
  e.payload, e.occurred_at, e.error_code, e.reason, e.retryable, e.line_id, to_char(e.shift_date, 'YYYY-MM-DD'),
  e.status, e.resolved_by, e.resolved_at, e.resolution_note, e.created_at`

func scanException(rows pgx.Rows, joined bool) (SyncException, error) {
	var (
		e                               SyncException
		payload                         []byte
		occurredAt, resolvedAt, created *time.Time
	)
	dest := []any{&e.ID, &e.TenantID, &e.ClientEventID, &e.CommandType, &e.WorkOrderID, &e.OperatorID,
		&payload, &occurredAt, &e.ErrorCode, &e.Reason, &e.Retryable, &e.LineID, &e.ShiftDate,
		&e.Status, &e.ResolvedBy, &resolvedAt, &e.ResolutionNote, &created}
	if joined {
		dest = append(dest, &e.WorkOrderNumber, &e.LineName)
	}
	if err := rows.Scan(dest...); err != nil {
		return e, err
	}
	e.Payload = map[string]any{}
	if m, ok := db.RawJSON(payload).(map[string]any); ok {
		e.Payload = m
	}
	e.OccurredAt, e.ResolvedAt, e.CreatedAt = db.ISOPtr(occurredAt), db.ISOPtr(resolvedAt), db.ISOPtr(created)
	e.WorkOrderID, e.OperatorID, e.LineID, e.ShiftDate = db.Str(e.WorkOrderID), db.Str(e.OperatorID), db.Str(e.LineID), db.Str(e.ShiftDate)
	e.ResolvedBy, e.ResolutionNote = db.Str(e.ResolvedBy), db.Str(e.ResolutionNote)
	e.WorkOrderNumber, e.LineName = db.Str(e.WorkOrderNumber), db.Str(e.LineName)
	return e, nil
}

func collectExceptions(rows pgx.Rows, err error, joined bool) ([]SyncException, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SyncException{}
	for rows.Next() {
		e, err := scanException(rows, joined)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ExceptionInput is what a rejection files.
type ExceptionInput struct {
	TenantID      string
	ClientEventID string
	CommandType   string
	WorkOrderID   *string
	OperatorID    *string
	Payload       map[string]any
	OccurredAt    *string
	ErrorCode     string
	Reason        string
	Retryable     bool
	LineID        *string
	ShiftDate     *string
}

// Record files or refreshes an exception. A retry of something already
// resolved reopens it: the problem is evidently still happening.
func (SyncExceptionRepository) Record(ctx context.Context, tx pgx.Tx, in ExceptionInput) (SyncException, error) {
	payload := in.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	body, err := db.JSONB(payload)
	if err != nil {
		return SyncException{}, err
	}
	var occurredAt *time.Time
	if in.OccurredAt != nil && *in.OccurredAt != "" {
		if t, err := db.ParseISO(*in.OccurredAt); err == nil {
			occurredAt = &t
		}
	}
	var shiftDate *time.Time
	if in.ShiftDate != nil && *in.ShiftDate != "" {
		if t, err := parseDate(*in.ShiftDate); err == nil {
			shiftDate = &t
		}
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO sync_exception (
		   id, tenant_id, client_event_id, command_type, work_order_id, operator_id,
		   payload, occurred_at, error_code, reason, retryable, line_id, shift_date
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::date)
		 ON CONFLICT (tenant_id, client_event_id) DO UPDATE SET
		   error_code = EXCLUDED.error_code,
		   reason = EXCLUDED.reason,
		   retryable = EXCLUDED.retryable,
		   payload = EXCLUDED.payload,
		   status = 'OPEN',
		   resolved_by = NULL,
		   resolved_at = NULL
		 RETURNING `+strings.ReplaceAll(exceptionColumns, "e.", ""),
		"syncex-"+uuid.NewString(), in.TenantID, in.ClientEventID, in.CommandType, in.WorkOrderID, in.OperatorID,
		body, occurredAt, in.ErrorCode, in.Reason, in.Retryable, in.LineID, shiftDate)
	list, err := collectExceptions(rows, err, false)
	if err != nil {
		return SyncException{}, err
	}
	if len(list) == 0 {
		return SyncException{}, fmt.Errorf("sync_exception %s could not be written", in.ClientEventID)
	}
	return list[0], nil
}

// ResolveByEvent clears an exception once the same command finally lands.
func (SyncExceptionRepository) ResolveByEvent(ctx context.Context, tx pgx.Tx, tenantID, clientEventID, note string) error {
	_, err := tx.Exec(ctx,
		`UPDATE sync_exception
		    SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = 'system', resolution_note = $3
		  WHERE tenant_id = $1 AND client_event_id = $2 AND status = 'OPEN'`, tenantID, clientEventID, note)
	return err
}

// List reads exceptions for the supervisor's screen, newest first.
func (SyncExceptionRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, f ExceptionFilter) ([]SyncException, error) {
	where := []string{"e.tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.LineID != "" {
		where = append(where, "e.line_id = "+arg(f.LineID))
	}
	if f.ShiftDate != "" {
		where = append(where, "e.shift_date = "+arg(f.ShiftDate)+"::date")
	}
	if f.Status != "" {
		where = append(where, "e.status = "+arg(f.Status))
	}
	if f.WorkOrderID != "" {
		where = append(where, "e.work_order_id = "+arg(f.WorkOrderID))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := tx.Query(ctx,
		`SELECT `+exceptionColumns+`, wo.wo_number, pl.name
		   FROM sync_exception e
		   LEFT JOIN work_order wo ON wo.id = e.work_order_id AND wo.tenant_id = e.tenant_id
		   LEFT JOIN production_line pl ON pl.id = e.line_id AND pl.tenant_id = e.tenant_id
		  WHERE `+strings.Join(where, " AND ")+`
		  ORDER BY e.created_at DESC LIMIT `+arg(limit), params...)
	return collectExceptions(rows, err, true)
}

// FindByID reads one exception.
func (SyncExceptionRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*SyncException, error) {
	rows, err := tx.Query(ctx, `SELECT `+exceptionColumns+` FROM sync_exception e WHERE e.tenant_id = $1 AND e.id = $2`, tenantID, id)
	list, err := collectExceptions(rows, err, false)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// SetStatus resolves, ignores or reopens an exception.
func (SyncExceptionRepository) SetStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status, actorID string, note *string) (*SyncException, error) {
	rows, err := tx.Query(ctx,
		`UPDATE sync_exception
		    SET status = $3::varchar,
		        resolved_by = CASE WHEN $3::varchar = 'OPEN' THEN NULL ELSE $4::varchar END,
		        resolved_at = CASE WHEN $3::varchar = 'OPEN' THEN NULL ELSE CURRENT_TIMESTAMP END,
		        resolution_note = $5::text
		  WHERE tenant_id = $1 AND id = $2
		  RETURNING `+strings.ReplaceAll(exceptionColumns, "e.", ""), tenantID, id, status, actorID, note)
	list, err := collectExceptions(rows, err, false)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// OpenSummary is the open count per line.
func (SyncExceptionRepository) OpenSummary(ctx context.Context, tx pgx.Tx, tenantID string) ([]ExceptionSummaryRow, error) {
	rows, err := tx.Query(ctx,
		`SELECT e.line_id, pl.name, count(*)
		   FROM sync_exception e
		   LEFT JOIN production_line pl ON pl.id = e.line_id AND pl.tenant_id = e.tenant_id
		  WHERE e.tenant_id = $1 AND e.status = 'OPEN'
		  GROUP BY e.line_id, pl.name ORDER BY count(*) DESC`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExceptionSummaryRow{}
	for rows.Next() {
		var row ExceptionSummaryRow
		if err := rows.Scan(&row.LineID, &row.LineName, &row.Count); err != nil {
			return nil, err
		}
		row.LineID, row.LineName = db.Str(row.LineID), db.Str(row.LineName)
		out = append(out, row)
	}
	return out, rows.Err()
}
