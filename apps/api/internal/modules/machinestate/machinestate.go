// Package machinestate is machine_state_log (persistence fix §11): what
// each machine is doing right now and the history behind it, which is what
// Availability is derived from.
//
// The log is append-then-close: a state opens with started_at and is closed
// by stamping ended_at, so "what is this machine doing" is the row with no
// end yet. A repeat of the open state is a no-op, so a shift of steady
// production is one row rather than one per tap. Both the production
// module (start/complete drive RUNNING/IDLE) and the shop floor (output,
// downtime) write here, which is why it is its own package.
package machinestate

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// The five states the domain defines. Nothing else is ever written.
const (
	Running  = "RUNNING"
	Idle     = "IDLE"
	Downtime = "DOWNTIME"
	Setup    = "SETUP"
	Offline  = "OFFLINE"
)

// Log is one row, field for field the TypeScript MachineStateLog.
type Log struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	MachineID       string  `json:"machineId"`
	ProcessID       *string `json:"processId,omitempty"`
	State           string  `json:"state"`
	ReasonID        *string `json:"reasonId,omitempty"`
	StartedAt       string  `json:"startedAt"`
	EndedAt         *string `json:"endedAt,omitempty"`
	DurationSeconds *int    `json:"durationSeconds,omitempty"`
	WorkOrderID     *string `json:"workOrderId,omitempty"`
	ShiftDate       *string `json:"shiftDate,omitempty"`
}

// Entry is what a caller opens.
type Entry struct {
	ID          string // optional
	TenantID    string
	MachineID   string
	ProcessID   *string
	State       string
	ReasonID    *string
	StartedAt   string
	WorkOrderID *string
	ShiftDate   *string
}

// Repository is the table.
type Repository struct{}

const columns = `
  id, tenant_id, machine_id, process_id, state, reason_id, started_at, ended_at,
  duration_seconds, work_order_id, to_char(shift_date, 'YYYY-MM-DD')`

func scan(rows pgx.Rows) (Log, error) {
	var (
		l         Log
		startedAt time.Time
		endedAt   *time.Time
	)
	if err := rows.Scan(&l.ID, &l.TenantID, &l.MachineID, &l.ProcessID, &l.State, &l.ReasonID, &startedAt, &endedAt,
		&l.DurationSeconds, &l.WorkOrderID, &l.ShiftDate); err != nil {
		return l, err
	}
	l.StartedAt = db.ISO(startedAt)
	l.EndedAt = db.ISOPtr(endedAt)
	l.ProcessID, l.ReasonID = db.Str(l.ProcessID), db.Str(l.ReasonID)
	l.WorkOrderID, l.ShiftDate = db.Str(l.WorkOrderID), db.Str(l.ShiftDate)
	return l, nil
}

func collect(rows pgx.Rows, err error) ([]Log, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Log{}
	for rows.Next() {
		l, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func one(rows pgx.Rows, err error) (*Log, error) {
	list, err := collect(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// Transition closes whatever state the machine was in and opens the new
// one, in the caller's transaction. A repeat of the open state is a no-op.
func (r Repository) Transition(ctx context.Context, tx pgx.Tx, e Entry) (*Log, error) {
	open, err := r.FindOpen(ctx, tx, e.TenantID, e.MachineID)
	if err != nil {
		return nil, err
	}
	if open != nil && open.State == e.State {
		return open, nil
	}
	startedAt, err := db.ParseISO(e.StartedAt)
	if err != nil {
		return nil, err
	}
	if open != nil {
		if _, err := tx.Exec(ctx,
			`UPDATE machine_state_log
			    SET ended_at = $3,
			        duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($3::timestamptz - started_at))::int)
			  WHERE tenant_id = $1 AND id = $2`, e.TenantID, open.ID, startedAt); err != nil {
			return nil, err
		}
	}
	id := e.ID
	if id == "" {
		id = db.NewID("ms", 5)
	}
	var shiftDate *time.Time
	if e.ShiftDate != nil && *e.ShiftDate != "" {
		t, err := time.Parse("2006-01-02", *e.ShiftDate)
		if err != nil {
			return nil, err
		}
		shiftDate = &t
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO machine_state_log (id, tenant_id, machine_id, process_id, state, reason_id, started_at, work_order_id, shift_date)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date)
		 ON CONFLICT (id) DO NOTHING
		 RETURNING `+columns,
		id, e.TenantID, e.MachineID, e.ProcessID, e.State, e.ReasonID, startedAt, e.WorkOrderID, shiftDate)
	return one(rows, err)
}

// FindOpen is the state a machine is in right now.
func (Repository) FindOpen(ctx context.Context, tx pgx.Tx, tenantID, machineID string) (*Log, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+columns+` FROM machine_state_log
		  WHERE tenant_id = $1 AND machine_id = $2 AND ended_at IS NULL
		  ORDER BY started_at DESC LIMIT 1`, tenantID, machineID)
	return one(rows, err)
}

// ListOpen is every machine's current state.
func (Repository) ListOpen(ctx context.Context, tx pgx.Tx, tenantID string) ([]Log, error) {
	rows, err := tx.Query(ctx,
		`SELECT `+columns+` FROM machine_state_log WHERE tenant_id = $1 AND ended_at IS NULL ORDER BY started_at DESC`, tenantID)
	return collect(rows, err)
}

// List is the history, newest first.
func (Repository) List(ctx context.Context, tx pgx.Tx, tenantID, machineID string, limit int) ([]Log, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	if machineID != "" {
		params = append(params, machineID)
		where = append(where, "machine_id = $"+strconv.Itoa(len(params)))
	}
	if limit <= 0 {
		limit = 2000
	}
	if limit > 20000 {
		limit = 20000
	}
	params = append(params, limit)
	rows, err := tx.Query(ctx,
		`SELECT `+columns+` FROM machine_state_log WHERE `+strings.Join(where, " AND ")+
			` ORDER BY started_at DESC LIMIT $`+strconv.Itoa(len(params)), params...)
	return collect(rows, err)
}

// Count is the tenant's row count.
func (Repository) Count(ctx context.Context, tx pgx.Tx, tenantID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM machine_state_log WHERE tenant_id = $1`, tenantID).Scan(&n)
	return n, err
}
