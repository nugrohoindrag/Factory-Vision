package wip

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Repository is wip_record, wip_status_history, wip_transfer and wip_receipt
// (migration 031).
type Repository struct{}

type where struct {
	clauses []string
	args    []any
}

func (w *where) add(column string, value string) {
	if value == "" {
		return
	}
	w.args = append(w.args, value)
	w.clauses = append(w.clauses, fmt.Sprintf("%s = $%d", column, len(w.args)))
}

func (w *where) sql() string { return strings.Join(w.clauses, " AND ") }

const wipSelect = `SELECT w.id, w.tenant_id, w.wip_number, w.product_id, p.sku, p.name, w.work_order_id, o.wo_number, o.line_id, w.batch_id, b.batch_number,
		w.source_process_id, sp.name, w.destination_process_id, dp.name, w.quantity::float8, w.uom, w.status, w.location_id, w.location_name, w.quality_status,
		w.created_by, w.created_at, w.updated_at, w.notes
	FROM wip_record w
	JOIN product p ON p.id = w.product_id
	JOIN work_order o ON o.id = w.work_order_id
	LEFT JOIN production_batch b ON b.id = w.batch_id
	LEFT JOIN production_process sp ON sp.id = w.source_process_id
	LEFT JOIN production_process dp ON dp.id = w.destination_process_id`

func scanWip(rows pgx.Rows) (Record, error) {
	var r Record
	var created, updated time.Time
	err := rows.Scan(&r.ID, &r.TenantID, &r.WipNumber, &r.ProductID, &r.ProductSku, &r.ProductName, &r.WorkOrderID, &r.WorkOrderNumber, &r.LineID, &r.BatchID, &r.BatchNumber,
		&r.SourceProcessID, &r.SourceProcessName, &r.DestinationProcessID, &r.DestinationProcessName, &r.Quantity, &r.Uom, &r.Status, &r.LocationID, &r.LocationName, &r.QualityStatus,
		&r.CreatedBy, &created, &updated, &r.Notes)
	r.CreatedAt, r.UpdatedAt = db.ISO(created), db.ISO(updated)
	return r, err
}

// InsertWip stores a WIP record.
func (Repository) InsertWip(ctx context.Context, tx pgx.Tx, w Record) error {
	_, err := tx.Exec(ctx, `INSERT INTO wip_record (id, tenant_id, wip_number, product_id, work_order_id, batch_id, source_process_id, destination_process_id, quantity, uom,
			status, location_id, location_name, quality_status, created_by, created_at, updated_at, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17::timestamptz,$18)`,
		w.ID, w.TenantID, w.WipNumber, w.ProductID, w.WorkOrderID, w.BatchID, w.SourceProcessID, w.DestinationProcessID, w.Quantity, w.Uom,
		w.Status, w.LocationID, w.LocationName, w.QualityStatus, w.CreatedBy, w.CreatedAt, w.UpdatedAt, w.Notes)
	return err
}

// ListWip lists records newest first (limit ≤ 5000).
func (Repository) ListWip(ctx context.Context, tx pgx.Tx, tenantID string, f RecordFilter) ([]Record, error) {
	w := where{}
	w.add("w.tenant_id", tenantID)
	w.add("w.id", f.ID)
	w.add("w.work_order_id", f.WorkOrderID)
	w.add("w.status", f.Status)
	if f.OpenOnly {
		// Everything that is still WIP: finished and scrapped quantity has left.
		w.clauses = append(w.clauses, "w.status NOT IN ('COMPLETED', 'SCRAPPED', 'RECEIVED')")
	}
	w.add("w.destination_process_id", f.DestinationProcessID)
	w.add("w.product_id", f.ProductID)
	limit := f.Limit
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}
	w.args = append(w.args, limit)
	rows, err := tx.Query(ctx, wipSelect+" WHERE "+w.sql()+fmt.Sprintf(" ORDER BY w.created_at DESC LIMIT $%d", len(w.args)), w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		r, err := scanWip(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// StatusChange is one setWipStatus call.
type StatusChange struct {
	Status        string
	QualityStatus *string
	Quantity      *float64
	ChangedBy     string
	Reason        *string
	FromStatus    *string
}

// SetWipStatus updates the record and appends the history row.
func (Repository) SetWipStatus(ctx context.Context, tx pgx.Tx, tenantID, id string, c StatusChange) error {
	if _, err := tx.Exec(ctx, `UPDATE wip_record SET status = $3, quality_status = COALESCE($4, quality_status), quantity = COALESCE($5, quantity), updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND id = $2`, tenantID, id, c.Status, c.QualityStatus, c.Quantity); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO wip_status_history (id, tenant_id, wip_id, from_status, to_status, changed_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		fmt.Sprintf("wsh-%d-%s", time.Now().UnixMilli(), db.RandomBase36(4)), tenantID, id, c.FromStatus, c.Status, c.ChangedBy, c.Reason)
	return err
}

// StatusHistory lists a record's status changes oldest first.
func (Repository) StatusHistory(ctx context.Context, tx pgx.Tx, tenantID, wipID string) ([]StatusHistory, error) {
	rows, err := tx.Query(ctx, `SELECT id, wip_id, from_status, to_status, changed_by, changed_at, reason FROM wip_status_history WHERE tenant_id = $1 AND wip_id = $2 ORDER BY changed_at`,
		tenantID, wipID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StatusHistory{}
	for rows.Next() {
		var h StatusHistory
		var changed time.Time
		if err := rows.Scan(&h.ID, &h.WipID, &h.FromStatus, &h.ToStatus, &h.ChangedBy, &changed, &h.Reason); err != nil {
			return nil, err
		}
		h.ChangedAt = db.ISO(changed)
		out = append(out, h)
	}
	return out, rows.Err()
}

// --- Transfers -------------------------------------------------------------

// InsertTransfer stores a transfer.
func (Repository) InsertTransfer(ctx context.Context, tx pgx.Tx, t Transfer) error {
	_, err := tx.Exec(ctx, `INSERT INTO wip_transfer (id, tenant_id, transfer_number, wip_id, product_id, batch_id, source_work_order_id, source_process_id,
			destination_work_order_id, destination_process_id, quantity, uom, status, created_by, created_by_name, transferred_at, idempotency_key, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17,$18)`,
		t.ID, t.TenantID, t.TransferNumber, t.WipID, t.ProductID, t.BatchID, t.SourceWorkOrderID, t.SourceProcessID,
		t.DestinationWorkOrderID, t.DestinationProcessID, t.Quantity, t.Uom, t.Status, t.CreatedBy, t.CreatedByName, t.TransferredAt, t.IdempotencyKey, t.Notes)
	return err
}

// ListTransfers lists transfers newest first (limit ≤ 2000).
func (Repository) ListTransfers(ctx context.Context, tx pgx.Tx, tenantID string, f TransferFilter) ([]Transfer, error) {
	w := where{}
	w.add("t.tenant_id", tenantID)
	w.add("t.id", f.ID)
	w.add("t.wip_id", f.WipID)
	w.add("t.source_work_order_id", f.SourceWorkOrderID)
	w.add("t.destination_work_order_id", f.DestinationWorkOrderID)
	w.add("t.status", f.Status)
	w.add("t.idempotency_key", f.IdempotencyKey)
	limit := f.Limit
	if limit <= 0 {
		limit = 300
	}
	if limit > 2000 {
		limit = 2000
	}
	w.args = append(w.args, limit)
	rows, err := tx.Query(ctx, `SELECT t.id, t.tenant_id, t.transfer_number, t.wip_id, t.product_id, p.name, t.batch_id, t.source_work_order_id, sw.wo_number,
			t.source_process_id, sp.name, t.destination_work_order_id, dw.wo_number, t.destination_process_id, dp.name,
			t.quantity::float8, t.uom, t.status, t.created_by, t.created_by_name, t.transferred_at, t.receipt_id, t.idempotency_key, t.notes
		FROM wip_transfer t
		JOIN product p ON p.id = t.product_id
		JOIN work_order sw ON sw.id = t.source_work_order_id
		LEFT JOIN work_order dw ON dw.id = t.destination_work_order_id
		LEFT JOIN production_process sp ON sp.id = t.source_process_id
		LEFT JOIN production_process dp ON dp.id = t.destination_process_id
		WHERE `+w.sql()+fmt.Sprintf(" ORDER BY t.transferred_at DESC LIMIT $%d", len(w.args)), w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transfer{}
	for rows.Next() {
		var t Transfer
		var transferred time.Time
		if err := rows.Scan(&t.ID, &t.TenantID, &t.TransferNumber, &t.WipID, &t.ProductID, &t.ProductName, &t.BatchID, &t.SourceWorkOrderID, &t.SourceWorkOrderNumber,
			&t.SourceProcessID, &t.SourceProcessName, &t.DestinationWorkOrderID, &t.DestinationWorkOrderNumber, &t.DestinationProcessID, &t.DestinationProcessName,
			&t.Quantity, &t.Uom, &t.Status, &t.CreatedBy, &t.CreatedByName, &transferred, &t.ReceiptID, &t.IdempotencyKey, &t.Notes); err != nil {
			return nil, err
		}
		t.TransferredAt = db.ISO(transferred)
		out = append(out, t)
	}
	return out, rows.Err()
}

// SetTransferStatus updates a transfer's status and, when given, its receipt.
func (Repository) SetTransferStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string, receiptID *string) error {
	_, err := tx.Exec(ctx, `UPDATE wip_transfer SET status = $3, receipt_id = COALESCE($4, receipt_id) WHERE tenant_id = $1 AND id = $2`, tenantID, id, status, receiptID)
	return err
}

// --- Receipts --------------------------------------------------------------

// InsertReceipt stores a receipt.
func (Repository) InsertReceipt(ctx context.Context, tx pgx.Tx, r Receipt) error {
	_, err := tx.Exec(ctx, `INSERT INTO wip_receipt (id, tenant_id, wip_transfer_id, received_quantity, transferred_quantity, variance_quantity, variance_reason, result, uom,
			received_by, received_by_name, received_at, idempotency_key, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13,$14)`,
		r.ID, r.TenantID, r.WipTransferID, r.ReceivedQuantity, r.TransferredQuantity, r.VarianceQuantity, r.VarianceReason, r.Result, r.Uom,
		r.ReceivedBy, r.ReceivedByName, r.ReceivedAt, r.IdempotencyKey, r.Notes)
	return err
}

// ListReceipts lists receipts newest first (limit ≤ 2000).
func (Repository) ListReceipts(ctx context.Context, tx pgx.Tx, tenantID string, f ReceiptFilter) ([]Receipt, error) {
	w := where{}
	w.add("r.tenant_id", tenantID)
	w.add("r.wip_transfer_id", f.WipTransferID)
	w.add("r.idempotency_key", f.IdempotencyKey)
	limit := f.Limit
	if limit <= 0 {
		limit = 300
	}
	if limit > 2000 {
		limit = 2000
	}
	w.args = append(w.args, limit)
	rows, err := tx.Query(ctx, `SELECT r.id, r.tenant_id, r.wip_transfer_id, t.transfer_number, r.received_quantity::float8, r.transferred_quantity::float8, r.variance_quantity::float8,
			r.variance_reason, r.result, r.uom, r.received_by, r.received_by_name, r.received_at, r.idempotency_key, r.notes
		FROM wip_receipt r
		JOIN wip_transfer t ON t.id = r.wip_transfer_id
		WHERE `+w.sql()+fmt.Sprintf(" ORDER BY r.received_at DESC LIMIT $%d", len(w.args)), w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Receipt{}
	for rows.Next() {
		var r Receipt
		var received time.Time
		if err := rows.Scan(&r.ID, &r.TenantID, &r.WipTransferID, &r.TransferNumber, &r.ReceivedQuantity, &r.TransferredQuantity, &r.VarianceQuantity,
			&r.VarianceReason, &r.Result, &r.Uom, &r.ReceivedBy, &r.ReceivedByName, &received, &r.IdempotencyKey, &r.Notes); err != nil {
			return nil, err
		}
		r.ReceivedAt = db.ISO(received)
		out = append(out, r)
	}
	return out, rows.Err()
}

// NextNumber is <prefix>-<year>-<count+1 padded to 5>.
func (Repository) NextNumber(ctx context.Context, tx pgx.Tx, tenantID, table, prefix string) (string, error) {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE tenant_id = $1`, tenantID).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%d-%05d", prefix, time.Now().Year(), n+1), nil
}
