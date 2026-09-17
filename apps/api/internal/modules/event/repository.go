package event

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Repository is operational_event, append-only (BR-E01, BR-E02). There is
// no update and no delete here, and the application role does not hold
// either privilege on the table, so the two agree (migration 026).
type Repository struct{}

const columns = `
  id, tenant_id, event_type, entity_type, entity_id,
  actor_type, actor_id, actor_name, occurred_at,
  plant_id, line_id, machine_id, process_id, work_order_id, batch_id,
  summary, before_value, after_value, metadata`

func scan(rows pgx.Rows) (OperationalEvent, error) {
	var (
		e          OperationalEvent
		occurredAt time.Time
		before     []byte
		after      []byte
		metadata   []byte
	)
	err := rows.Scan(
		&e.ID, &e.TenantID, &e.EventType, &e.EntityType, &e.EntityID,
		&e.ActorType, &e.ActorID, &e.ActorName, &occurredAt,
		&e.PlantID, &e.LineID, &e.MachineID, &e.ProcessID, &e.WorkOrderID, &e.BatchID,
		&e.Summary, &before, &after, &metadata,
	)
	if err != nil {
		return e, err
	}
	e.OccurredAt = db.ISO(occurredAt)
	e.ActorID, e.ActorName = db.Str(e.ActorID), db.Str(e.ActorName)
	e.PlantID, e.LineID, e.MachineID = db.Str(e.PlantID), db.Str(e.LineID), db.Str(e.MachineID)
	e.ProcessID, e.WorkOrderID, e.BatchID = db.Str(e.ProcessID), db.Str(e.WorkOrderID), db.Str(e.BatchID)
	e.BeforeValue = db.RawJSON(before)
	e.AfterValue = db.RawJSON(after)
	if m, ok := db.RawJSON(metadata).(map[string]any); ok {
		e.Metadata = m
	}
	return e, nil
}

// Insert appends one event and returns it as stored.
func (Repository) Insert(ctx context.Context, tx pgx.Tx, e OperationalEvent) (OperationalEvent, error) {
	before, err := db.JSONB(e.BeforeValue)
	if err != nil {
		return e, err
	}
	after, err := db.JSONB(e.AfterValue)
	if err != nil {
		return e, err
	}
	var metadata []byte
	if e.Metadata != nil {
		if metadata, err = db.JSONB(e.Metadata); err != nil {
			return e, err
		}
	}
	occurredAt, err := db.ParseISO(e.OccurredAt)
	if err != nil {
		return e, err
	}
	rows, err := tx.Query(ctx,
		`INSERT INTO operational_event (`+columns+`)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		 RETURNING `+columns,
		e.ID, e.TenantID, e.EventType, e.EntityType, e.EntityID,
		e.ActorType, e.ActorID, e.ActorName, occurredAt,
		e.PlantID, e.LineID, e.MachineID, e.ProcessID, e.WorkOrderID, e.BatchID,
		e.Summary, before, after, metadata,
	)
	if err != nil {
		return e, err
	}
	defer rows.Close()
	if !rows.Next() {
		return e, rows.Err()
	}
	return scan(rows)
}

// contextColumn is which denormalised column also carries an entity of this
// type: an entity's history is not only the events whose subject it is. A
// downtime on a machine belongs in that machine's timeline, and so does the
// maintenance that followed (BR-E04).
var contextColumn = map[string]string{
	"WORK_ORDER": "work_order_id",
	"MACHINE":    "machine_id",
	"BATCH":      "batch_id",
}

// List is the timeline, newest first.
func (Repository) List(ctx context.Context, tx pgx.Tx, tenantID string, q Query) ([]OperationalEvent, error) {
	where := []string{"tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}

	if q.EntityType != "" && q.EntityID != "" {
		typeParam := arg(q.EntityType)
		idParam := arg(q.EntityID)
		clauses := []string{"(entity_type = " + typeParam + " AND entity_id = " + idParam + ")"}
		if col, ok := contextColumn[q.EntityType]; ok {
			clauses = append(clauses, col+" = "+idParam)
		}
		where = append(where, "("+strings.Join(clauses, " OR ")+")")
	} else if q.EntityType != "" {
		where = append(where, "entity_type = "+arg(q.EntityType))
	}
	if q.EventType != "" {
		where = append(where, "event_type = "+arg(q.EventType))
	}
	if q.WorkOrderID != "" {
		where = append(where, "work_order_id = "+arg(q.WorkOrderID))
	}
	if q.MachineID != "" {
		where = append(where, "machine_id = "+arg(q.MachineID))
	}
	if q.BatchID != "" {
		where = append(where, "batch_id = "+arg(q.BatchID))
	}
	if q.From != "" {
		t, err := db.ParseISO(q.From)
		if err != nil {
			return nil, fmt.Errorf("from: %w", err)
		}
		where = append(where, "occurred_at >= "+arg(t))
	}
	if q.To != "" {
		t, err := db.ParseISO(q.To)
		if err != nil {
			return nil, fmt.Errorf("to: %w", err)
		}
		where = append(where, "occurred_at <= "+arg(t))
	}

	// Keyset pagination (additive): the cursor names the last row seen and
	// the query continues strictly after it in the sort order, which an index
	// on (tenant_id, occurred_at, id) answers without counting past rows.
	if q.Cursor != "" {
		at, id, ok := strings.Cut(q.Cursor, "|")
		t, err := db.ParseISO(at)
		if !ok || err != nil {
			return nil, fmt.Errorf("cursor: invalid")
		}
		where = append(where, "(occurred_at, id) < ("+arg(t)+", "+arg(id)+")")
	}

	limit := 200
	if q.Limit != nil {
		limit = *q.Limit
	}
	if limit > 2000 {
		limit = 2000
	}
	offset := 0
	if q.Offset != nil && q.Cursor == "" {
		offset = *q.Offset
	}

	sql := `SELECT ` + columns + ` FROM operational_event
	        WHERE ` + strings.Join(where, " AND ") + `
	        ORDER BY occurred_at DESC, id DESC
	        LIMIT ` + arg(limit) + ` OFFSET ` + arg(offset)

	rows, err := tx.Query(ctx, sql, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]OperationalEvent, 0, limit)
	for rows.Next() {
		e, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CountByType groups events since an instant.
func (Repository) CountByType(ctx context.Context, tx pgx.Tx, tenantID string, from time.Time) ([]Summary, error) {
	rows, err := tx.Query(ctx,
		`SELECT event_type, count(*)::int AS n
		   FROM operational_event
		  WHERE tenant_id = $1 AND occurred_at >= $2
		  GROUP BY event_type
		  ORDER BY count(*) DESC`,
		tenantID, from,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Summary{}
	for rows.Next() {
		var s Summary
		if err := rows.Scan(&s.EventType, &s.Count); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
