package material

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/jsnum"
)

// Repository is the material tables.
type Repository struct{}

// --- warehouse -------------------------------------------------------------

// ListWarehouses reads a tenant's warehouses by code.
func (Repository) ListWarehouses(ctx context.Context, tx pgx.Tx, tenantID string) ([]Warehouse, error) {
	rows, err := tx.Query(ctx, `SELECT id, tenant_id, plant_id, code, name, warehouse_type, status FROM warehouse WHERE tenant_id = $1 ORDER BY code`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Warehouse{}
	for rows.Next() {
		var w Warehouse
		if err := rows.Scan(&w.ID, &w.TenantID, &w.PlantID, &w.Code, &w.Name, &w.WarehouseType, &w.Status); err != nil {
			return nil, err
		}
		w.PlantID = db.Str(w.PlantID)
		out = append(out, w)
	}
	return out, rows.Err()
}

// UpsertWarehouse writes a warehouse.
func (Repository) UpsertWarehouse(ctx context.Context, tx pgx.Tx, w Warehouse) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO warehouse (id, tenant_id, plant_id, code, name, warehouse_type, status) VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (id) DO UPDATE SET plant_id = EXCLUDED.plant_id, code = EXCLUDED.code, name = EXCLUDED.name,
		   warehouse_type = EXCLUDED.warehouse_type, status = EXCLUDED.status`,
		w.ID, w.TenantID, w.PlantID, w.Code, w.Name, w.WarehouseType, w.Status)
	return err
}

// DefaultWarehouse is the active raw-material warehouse, else the first.
func (r Repository) DefaultWarehouse(ctx context.Context, tx pgx.Tx, tenantID string) (*Warehouse, error) {
	list, err := r.ListWarehouses(ctx, tx, tenantID)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	for i := range list {
		if list[i].WarehouseType == "RAW_MATERIAL" && list[i].Status == "ACTIVE" {
			return &list[i], nil
		}
	}
	return &list[0], nil
}

// --- material_inventory ----------------------------------------------------

const inventorySelect = `
  SELECT i.id, i.tenant_id, i.material_id, p.sku, p.name, i.warehouse_id, w.name, i.uom,
         i.on_hand_quantity, i.reserved_quantity, i.incoming_quantity, i.available_quantity,
         i.reorder_point, i.safety_stock, i.state, i.updated_at
    FROM material_inventory i
    JOIN product p ON p.id = i.material_id
    JOIN warehouse w ON w.id = i.warehouse_id`

func scanInventory(rows pgx.Rows) (Inventory, error) {
	var (
		i         Inventory
		updatedAt time.Time
	)
	if err := rows.Scan(&i.ID, &i.TenantID, &i.MaterialID, &i.MaterialSKU, &i.MaterialName, &i.WarehouseID, &i.WarehouseName, &i.UOM,
		&i.OnHandQuantity, &i.ReservedQuantity, &i.IncomingQuantity, &i.AvailableQuantity, &i.ReorderPoint, &i.SafetyStock, &i.State, &updatedAt); err != nil {
		return i, err
	}
	i.UpdatedAt = db.ISO(updatedAt)
	return i, nil
}

func collectInventory(rows pgx.Rows, err error) ([]Inventory, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Inventory{}
	for rows.Next() {
		i, err := scanInventory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// ListInventory reads stock rows by SKU and warehouse code.
func (Repository) ListInventory(ctx context.Context, tx pgx.Tx, tenantID string, f InventoryFilter) ([]Inventory, error) {
	where := []string{"i.tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.MaterialID != "" {
		where = append(where, "i.material_id = "+arg(f.MaterialID))
	}
	if f.WarehouseID != "" {
		where = append(where, "i.warehouse_id = "+arg(f.WarehouseID))
	}
	if f.BelowReorder {
		where = append(where, "i.reorder_point IS NOT NULL AND i.available_quantity <= i.reorder_point")
	}
	if f.Search != "" {
		p := arg("%" + strings.ToLower(f.Search) + "%")
		where = append(where, "(lower(p.sku) LIKE "+p+" OR lower(p.name) LIKE "+p+")")
	}
	rows, err := tx.Query(ctx, inventorySelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY p.sku, w.code`, params...)
	return collectInventory(rows, err)
}

// FindInventory reads one stock row.
func (Repository) FindInventory(ctx context.Context, tx pgx.Tx, tenantID, materialID, warehouseID string) (*Inventory, error) {
	rows, err := tx.Query(ctx, inventorySelect+` WHERE i.tenant_id = $1 AND i.material_id = $2 AND i.warehouse_id = $3`, tenantID, materialID, warehouseID)
	list, err := collectInventory(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// TotalsByMaterial sums stock over warehouses for the given materials.
func (Repository) TotalsByMaterial(ctx context.Context, tx pgx.Tx, tenantID string, materialIDs []string) (map[string]StockTotal, error) {
	out := map[string]StockTotal{}
	if len(materialIDs) == 0 {
		return out, nil
	}
	rows, err := tx.Query(ctx,
		`SELECT material_id, sum(on_hand_quantity), sum(reserved_quantity), sum(incoming_quantity), sum(available_quantity), min(uom)
		   FROM material_inventory WHERE tenant_id = $1 AND material_id = ANY($2::varchar[]) GROUP BY material_id`, tenantID, materialIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var t StockTotal
		if err := rows.Scan(&id, &t.OnHand, &t.Reserved, &t.Incoming, &t.Available, &t.UOM); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

// UpsertInput sets a stock row outright.
type UpsertInput struct {
	TenantID, MaterialID, WarehouseID, UOM string
	OnHandQuantity                         float64
	ReservedQuantity, IncomingQuantity     float64
	ReorderPoint, SafetyStock              *float64
	State                                  string
}

// UpsertInventory writes a stock row with the available figure derived.
func (Repository) UpsertInventory(ctx context.Context, tx pgx.Tx, in UpsertInput) error {
	state := in.State
	if state == "" {
		state = "AVAILABLE"
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO material_inventory (id, tenant_id, material_id, warehouse_id, uom, on_hand_quantity, reserved_quantity, incoming_quantity,
		   available_quantity, reorder_point, safety_stock, state, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CURRENT_TIMESTAMP)
		 ON CONFLICT (tenant_id, material_id, warehouse_id) DO UPDATE SET
		   uom = EXCLUDED.uom, on_hand_quantity = EXCLUDED.on_hand_quantity, reserved_quantity = EXCLUDED.reserved_quantity,
		   incoming_quantity = EXCLUDED.incoming_quantity, available_quantity = EXCLUDED.available_quantity,
		   reorder_point = EXCLUDED.reorder_point, safety_stock = EXCLUDED.safety_stock, state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP`,
		"minv-"+in.MaterialID+"-"+in.WarehouseID, in.TenantID, in.MaterialID, in.WarehouseID, in.UOM,
		in.OnHandQuantity, in.ReservedQuantity, in.IncomingQuantity, in.OnHandQuantity-in.ReservedQuantity+in.IncomingQuantity,
		in.ReorderPoint, in.SafetyStock, state)
	return err
}

// ApplyMovement moves stock and writes the ledger row, returning it.
func (Repository) ApplyMovement(ctx context.Context, tx pgx.Tx, m Movement) (Transaction, error) {
	var onHand, available float64
	if err := tx.QueryRow(ctx,
		`INSERT INTO material_inventory (id, tenant_id, material_id, warehouse_id, uom, on_hand_quantity, reserved_quantity, incoming_quantity, available_quantity, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_TIMESTAMP)
		 ON CONFLICT (tenant_id, material_id, warehouse_id) DO UPDATE SET
		   on_hand_quantity = material_inventory.on_hand_quantity + $6,
		   reserved_quantity = material_inventory.reserved_quantity + $7,
		   incoming_quantity = material_inventory.incoming_quantity + $8,
		   available_quantity = (material_inventory.on_hand_quantity + $6) - (material_inventory.reserved_quantity + $7) + (material_inventory.incoming_quantity + $8),
		   updated_at = CURRENT_TIMESTAMP
		 RETURNING on_hand_quantity, available_quantity`,
		"minv-"+m.MaterialID+"-"+m.WarehouseID, m.TenantID, m.MaterialID, m.WarehouseID, m.UOM,
		m.OnHandDelta, m.ReservedDelta, m.IncomingDelta, m.OnHandDelta-m.ReservedDelta+m.IncomingDelta).Scan(&onHand, &available); err != nil {
		return Transaction{}, err
	}
	quantity := m.OnHandDelta
	if quantity == 0 {
		quantity = m.ReservedDelta
		if quantity == 0 {
			quantity = m.IncomingDelta
		}
	}
	id := fmt.Sprintf("mtx-%d-%s", time.Now().UnixMilli(), db.RandomBase36(6))
	if _, err := tx.Exec(ctx,
		`INSERT INTO material_transaction (id, tenant_id, material_id, warehouse_id, transaction_type, quantity, uom, balance_after,
		   reference_type, reference_id, reason, actor_id, actor_name)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, m.TenantID, m.MaterialID, m.WarehouseID, m.TransactionType, quantity, m.UOM, onHand,
		m.ReferenceType, m.ReferenceID, m.Reason, m.ActorID, m.ActorName); err != nil {
		return Transaction{}, err
	}
	return Transaction{
		ID: id, TenantID: m.TenantID, MaterialID: m.MaterialID, WarehouseID: &m.WarehouseID, TransactionType: m.TransactionType,
		Quantity: quantity, UOM: m.UOM, BalanceAfter: onHand, ReferenceType: m.ReferenceType, ReferenceID: m.ReferenceID,
		Reason: m.Reason, ActorID: m.ActorID, ActorName: m.ActorName, OccurredAt: db.Now(),
	}, nil
}

// ListTransactions reads the ledger, newest first.
func (Repository) ListTransactions(ctx context.Context, tx pgx.Tx, tenantID string, f TransactionFilter) ([]Transaction, error) {
	where := []string{"t.tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.MaterialID != "" {
		where = append(where, "t.material_id = "+arg(f.MaterialID))
	}
	if f.ReferenceID != "" {
		where = append(where, "t.reference_id = "+arg(f.ReferenceID))
	}
	if f.From != "" {
		where = append(where, "t.occurred_at >= "+arg(f.From)+"::timestamptz")
	}
	if f.To != "" {
		where = append(where, "t.occurred_at <= "+arg(f.To)+"::timestamptz")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 300
	}
	if limit > 2000 {
		limit = 2000
	}
	rows, err := tx.Query(ctx,
		`SELECT t.id, t.tenant_id, t.material_id, p.sku, p.name, t.warehouse_id, t.transaction_type, t.quantity, t.uom, t.balance_after,
		        t.reference_type, t.reference_id, t.reason, t.actor_id, t.actor_name, t.occurred_at
		   FROM material_transaction t JOIN product p ON p.id = t.material_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY t.occurred_at DESC, t.id DESC LIMIT `+arg(limit), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transaction{}
	for rows.Next() {
		var t Transaction
		var occurred time.Time
		if err := rows.Scan(&t.ID, &t.TenantID, &t.MaterialID, &t.MaterialSKU, &t.MaterialName, &t.WarehouseID, &t.TransactionType, &t.Quantity, &t.UOM, &t.BalanceAfter,
			&t.ReferenceType, &t.ReferenceID, &t.Reason, &t.ActorID, &t.ActorName, &occurred); err != nil {
			return nil, err
		}
		t.OccurredAt = db.ISO(occurred)
		t.WarehouseID, t.ReferenceType, t.ReferenceID, t.Reason, t.ActorName = db.Str(t.WarehouseID), db.Str(t.ReferenceType), db.Str(t.ReferenceID), db.Str(t.Reason), db.Str(t.ActorName)
		out = append(out, t)
	}
	return out, rows.Err()
}

// --- material_reservation --------------------------------------------------

// ListReservations reads reservations, newest first.
func (Repository) ListReservations(ctx context.Context, tx pgx.Tx, tenantID string, f ReservationFilter) ([]Reservation, error) {
	where := []string{"r.tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.WorkOrderID != "" {
		where = append(where, "r.work_order_id = "+arg(f.WorkOrderID))
	}
	if f.MaterialID != "" {
		where = append(where, "r.material_id = "+arg(f.MaterialID))
	}
	if f.Status != "" {
		where = append(where, "r.status = "+arg(f.Status))
	}
	rows, err := tx.Query(ctx,
		`SELECT r.id, r.tenant_id, r.material_id, p.sku, p.name, r.warehouse_id, r.work_order_id, w.wo_number, r.production_plan_id,
		        r.quantity, r.uom, r.status, r.reserved_by, r.reserved_at, r.released_at, r.notes
		   FROM material_reservation r JOIN product p ON p.id = r.material_id LEFT JOIN work_order w ON w.id = r.work_order_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY r.reserved_at DESC`, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Reservation{}
	for rows.Next() {
		var r Reservation
		var reservedAt time.Time
		var releasedAt *time.Time
		if err := rows.Scan(&r.ID, &r.TenantID, &r.MaterialID, &r.MaterialSKU, &r.MaterialName, &r.WarehouseID, &r.WorkOrderID, &r.WorkOrderNumber, &r.ProductionPlanID,
			&r.Quantity, &r.UOM, &r.Status, &r.ReservedBy, &reservedAt, &releasedAt, &r.Notes); err != nil {
			return nil, err
		}
		r.ReservedAt, r.ReleasedAt = db.ISO(reservedAt), db.ISOPtr(releasedAt)
		r.WarehouseID, r.WorkOrderID, r.WorkOrderNumber, r.ProductionPlanID, r.Notes = db.Str(r.WarehouseID), db.Str(r.WorkOrderID), db.Str(r.WorkOrderNumber), db.Str(r.ProductionPlanID), db.Str(r.Notes)
		out = append(out, r)
	}
	return out, rows.Err()
}

// InsertReservation writes a reservation.
func (Repository) InsertReservation(ctx context.Context, tx pgx.Tx, r Reservation) error {
	reservedAt, err := db.ParseISO(r.ReservedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO material_reservation (id, tenant_id, material_id, warehouse_id, work_order_id, production_plan_id, quantity, uom, status, reserved_by, reserved_at, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		r.ID, r.TenantID, r.MaterialID, r.WarehouseID, r.WorkOrderID, r.ProductionPlanID, r.Quantity, r.UOM, r.Status, r.ReservedBy, reservedAt, r.Notes)
	return err
}

// SetReservationStatus moves a reservation.
func (Repository) SetReservationStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string) error {
	_, err := tx.Exec(ctx,
		`UPDATE material_reservation SET status = $3,
		   released_at = CASE WHEN $3 IN ('RELEASED', 'CONSUMED') THEN CURRENT_TIMESTAMP ELSE released_at END
		 WHERE tenant_id = $1 AND id = $2`, tenantID, id, status)
	return err
}

// --- material_requirement --------------------------------------------------

// ReplaceRequirements rewrites the requirements of one source.
func (Repository) ReplaceRequirements(ctx context.Context, tx pgx.Tx, tenantID, sourceType, sourceID string, reqs []Requirement) error {
	if _, err := tx.Exec(ctx, `DELETE FROM material_requirement WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3`, tenantID, sourceType, sourceID); err != nil {
		return err
	}
	if len(reqs) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, r := range reqs {
		createdAt, err := db.ParseISO(r.CreatedAt)
		if err != nil {
			return err
		}
		var date *time.Time
		if r.RequirementDate != "" {
			t, err := time.Parse("2006-01-02", r.RequirementDate)
			if err != nil {
				return err
			}
			date = &t
		}
		batch.Queue(
			`INSERT INTO material_requirement (id, tenant_id, source_type, source_id, source_label, material_id, bom_id, level,
			   required_quantity, on_hand_quantity, reserved_quantity, incoming_quantity, available_quantity, shortage_quantity, uom,
			   requirement_date, status, warehouse_id, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17,$18,$19)`,
			r.ID, r.TenantID, r.SourceType, r.SourceID, r.SourceLabel, r.MaterialID, r.BomID, r.Level,
			r.RequiredQuantity, r.OnHandQuantity, r.ReservedQuantity, r.IncomingQuantity, r.AvailableQuantity, r.ShortageQuantity, r.UOM,
			date, r.Status, r.WarehouseID, createdAt)
	}
	results := tx.SendBatch(ctx, batch)
	defer results.Close()
	for range reqs {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}
	return nil
}

// ListRequirements reads stored requirements by level and SKU.
func (Repository) ListRequirements(ctx context.Context, tx pgx.Tx, tenantID string, f RequirementFilter) ([]Requirement, error) {
	where := []string{"r.tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.SourceType != "" {
		where = append(where, "r.source_type = "+arg(f.SourceType))
	}
	if f.SourceID != "" {
		where = append(where, "r.source_id = "+arg(f.SourceID))
	}
	if f.Status != "" {
		where = append(where, "r.status = "+arg(f.Status))
	}
	rows, err := tx.Query(ctx,
		`SELECT r.id, r.tenant_id, r.source_type, r.source_id, r.source_label, r.material_id, p.sku, p.name, r.bom_id, b.bom_number, r.level,
		        r.required_quantity, r.on_hand_quantity, r.reserved_quantity, r.incoming_quantity, r.available_quantity, r.shortage_quantity, r.uom,
		        to_char(r.requirement_date, 'YYYY-MM-DD'), r.status, r.warehouse_id, r.created_at
		   FROM material_requirement r JOIN product p ON p.id = r.material_id LEFT JOIN bill_of_material b ON b.id = r.bom_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY r.level, p.sku`, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Requirement{}
	for rows.Next() {
		var r Requirement
		var label, date *string
		var createdAt time.Time
		if err := rows.Scan(&r.ID, &r.TenantID, &r.SourceType, &r.SourceID, &label, &r.MaterialID, &r.MaterialSKU, &r.MaterialName, &r.BomID, &r.BomNumber, &r.Level,
			&r.RequiredQuantity, &r.OnHandQuantity, &r.ReservedQuantity, &r.IncomingQuantity, &r.AvailableQuantity, &r.ShortageQuantity, &r.UOM,
			&date, &r.Status, &r.WarehouseID, &createdAt); err != nil {
			return nil, err
		}
		r.SourceLabel = db.StrOr(label, r.SourceID)
		r.RequirementDate = db.StrOr(date, "")
		r.CreatedAt = db.ISO(createdAt)
		r.BomID, r.BomNumber, r.WarehouseID = db.Str(r.BomID), db.Str(r.BomNumber), db.Str(r.WarehouseID)
		out = append(out, r)
	}
	return out, rows.Err()
}

// --- material_consumption --------------------------------------------------

// InsertConsumption writes a consumption record.
func (Repository) InsertConsumption(ctx context.Context, tx pgx.Tx, c Consumption) error {
	consumedAt, err := db.ParseISO(c.ConsumedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO material_consumption (id, tenant_id, work_order_id, batch_id, process_id, machine_id, material_id, warehouse_id,
		   planned_quantity, actual_quantity, variance_quantity, uom, consumption_type, status, operator_id, recorded_by, consumed_at, idempotency_key, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		c.ID, c.TenantID, c.WorkOrderID, c.BatchID, c.ProcessID, c.MachineID, c.MaterialID, c.WarehouseID,
		c.PlannedQuantity, c.ActualQuantity, c.VarianceQuantity, c.UOM, c.ConsumptionType, c.Status, c.OperatorID, c.RecordedBy, consumedAt, c.IdempotencyKey, c.Notes)
	return err
}

// ListConsumption reads consumption, newest first.
func (Repository) ListConsumption(ctx context.Context, tx pgx.Tx, tenantID string, f ConsumptionFilter) ([]Consumption, error) {
	where := []string{"c.tenant_id = $1"}
	params := []any{tenantID}
	arg := func(v any) string {
		params = append(params, v)
		return "$" + strconv.Itoa(len(params))
	}
	if f.WorkOrderID != "" {
		where = append(where, "c.work_order_id = "+arg(f.WorkOrderID))
	}
	if f.MaterialID != "" {
		where = append(where, "c.material_id = "+arg(f.MaterialID))
	}
	if f.Status != "" {
		where = append(where, "c.status = "+arg(f.Status))
	}
	if f.IdempotencyKey != "" {
		where = append(where, "c.idempotency_key = "+arg(f.IdempotencyKey))
	}
	if f.From != "" {
		where = append(where, "c.consumed_at >= "+arg(f.From)+"::timestamptz")
	}
	if f.To != "" {
		where = append(where, "c.consumed_at <= "+arg(f.To)+"::timestamptz")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 300
	}
	if limit > 2000 {
		limit = 2000
	}
	rows, err := tx.Query(ctx,
		`SELECT c.id, c.tenant_id, c.work_order_id, w.wo_number, c.batch_id, c.process_id, c.machine_id, c.material_id, p.sku, p.name, c.warehouse_id,
		        c.planned_quantity, c.actual_quantity, c.variance_quantity, c.uom, c.consumption_type, c.status, c.operator_id, o.name, c.recorded_by, c.consumed_at,
		        c.idempotency_key, c.notes
		   FROM material_consumption c JOIN product p ON p.id = c.material_id
		   LEFT JOIN work_order w ON w.id = c.work_order_id LEFT JOIN operator o ON o.id = c.operator_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY c.consumed_at DESC LIMIT `+arg(limit), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Consumption{}
	for rows.Next() {
		var c Consumption
		var woNumber *string
		var consumedAt time.Time
		if err := rows.Scan(&c.ID, &c.TenantID, &c.WorkOrderID, &woNumber, &c.BatchID, &c.ProcessID, &c.MachineID, &c.MaterialID, &c.MaterialSKU, &c.MaterialName, &c.WarehouseID,
			&c.PlannedQuantity, &c.ActualQuantity, &c.VarianceQuantity, &c.UOM, &c.ConsumptionType, &c.Status, &c.OperatorID, &c.OperatorName, &c.RecordedBy, &consumedAt,
			&c.IdempotencyKey, &c.Notes); err != nil {
			return nil, err
		}
		c.WorkOrderNumber = db.StrOr(woNumber, c.WorkOrderID)
		c.ConsumedAt = db.ISO(consumedAt)
		if c.PlannedQuantity > 0 {
			c.VariancePercentage = jsnum.ToFixed((c.VarianceQuantity/c.PlannedQuantity)*100, 2)
		}
		c.BatchID, c.ProcessID, c.MachineID, c.WarehouseID = db.Str(c.BatchID), db.Str(c.ProcessID), db.Str(c.MachineID), db.Str(c.WarehouseID)
		c.OperatorID, c.OperatorName, c.IdempotencyKey, c.Notes = db.Str(c.OperatorID), db.Str(c.OperatorName), db.Str(c.IdempotencyKey), db.Str(c.Notes)
		out = append(out, c)
	}
	return out, rows.Err()
}

// ConsumedByMaterial is net consumption per material for a work order.
func (Repository) ConsumedByMaterial(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) (map[string]float64, []string, error) {
	rows, err := tx.Query(ctx,
		`SELECT material_id, sum(CASE WHEN consumption_type = 'RETURN' THEN -actual_quantity ELSE actual_quantity END)
		   FROM material_consumption WHERE tenant_id = $1 AND work_order_id = $2 GROUP BY material_id`, tenantID, workOrderID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	var order []string
	for rows.Next() {
		var id string
		var total float64
		if err := rows.Scan(&id, &total); err != nil {
			return nil, nil, err
		}
		out[id] = total
		order = append(order, id)
	}
	return out, order, rows.Err()
}

// --- mrp_run / mrp_result --------------------------------------------------

const runColumns = `id, tenant_id, run_number, to_char(horizon_start, 'YYYY-MM-DD'), to_char(horizon_end, 'YYYY-MM-DD'), status, demand_source, plan_ids,
  total_materials, shortage_materials, run_by, started_at, completed_at, error_message, notes`

func scanRun(rows pgx.Rows) (MrpRun, error) {
	var (
		r         MrpRun
		planIDs   []byte
		startedAt time.Time
		completed *time.Time
	)
	if err := rows.Scan(&r.ID, &r.TenantID, &r.RunNumber, &r.HorizonStart, &r.HorizonEnd, &r.Status, &r.DemandSource, &planIDs,
		&r.TotalMaterials, &r.ShortageMaterials, &r.RunBy, &startedAt, &completed, &r.ErrorMessage, &r.Notes); err != nil {
		return r, err
	}
	r.PlanIDs = []string{}
	if list, ok := db.RawJSON(planIDs).([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok {
				r.PlanIDs = append(r.PlanIDs, s)
			}
		}
	}
	r.StartedAt, r.CompletedAt = db.ISO(startedAt), db.ISOPtr(completed)
	r.ErrorMessage, r.Notes = db.Str(r.ErrorMessage), db.Str(r.Notes)
	return r, nil
}

// ListRuns reads runs, newest first.
func (Repository) ListRuns(ctx context.Context, tx pgx.Tx, tenantID string, limit int) ([]MrpRun, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := tx.Query(ctx, `SELECT `+runColumns+` FROM mrp_run WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MrpRun{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// FindRun reads one run with its results.
func (Repository) FindRun(ctx context.Context, tx pgx.Tx, tenantID, id string) (*MrpOutcome, error) {
	rows, err := tx.Query(ctx, `SELECT `+runColumns+` FROM mrp_run WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return nil, err
	}
	var run *MrpRun
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		run = &r
	}
	rows.Close()
	if run == nil {
		return nil, nil
	}
	results, err := tx.Query(ctx,
		`SELECT r.id, r.tenant_id, r.mrp_run_id, r.material_id, p.sku, p.name, r.level, r.gross_requirement, r.on_hand_quantity, r.reserved_quantity,
		        r.incoming_quantity, r.available_quantity, r.net_requirement, r.uom, to_char(r.requirement_date, 'YYYY-MM-DD'), r.requirement_source, r.status, r.recommendation
		   FROM mrp_result r JOIN product p ON p.id = r.material_id WHERE r.mrp_run_id = $1 ORDER BY r.net_requirement DESC, p.sku`, id)
	if err != nil {
		return nil, err
	}
	defer results.Close()
	out := &MrpOutcome{Run: *run, Results: []MrpResult{}}
	for results.Next() {
		var m MrpResult
		var date, source *string
		if err := results.Scan(&m.ID, &m.TenantID, &m.MrpRunID, &m.MaterialID, &m.MaterialSKU, &m.MaterialName, &m.Level, &m.GrossRequirement, &m.OnHandQuantity, &m.ReservedQuantity,
			&m.IncomingQuantity, &m.AvailableQuantity, &m.NetRequirement, &m.UOM, &date, &source, &m.Status, &m.Recommendation); err != nil {
			return nil, err
		}
		m.RequirementDate, m.RequirementSource = db.StrOr(date, ""), db.StrOr(source, "")
		m.Recommendation = db.Str(m.Recommendation)
		out.Results = append(out.Results, m)
	}
	return out, results.Err()
}

// InsertRun writes a run and its results.
func (Repository) InsertRun(ctx context.Context, tx pgx.Tx, run MrpRun, results []MrpResult) error {
	planIDs, err := db.JSONB(run.PlanIDs)
	if err != nil {
		return err
	}
	startedAt, err := db.ParseISO(run.StartedAt)
	if err != nil {
		return err
	}
	var completedAt *time.Time
	if run.CompletedAt != nil {
		t, err := db.ParseISO(*run.CompletedAt)
		if err != nil {
			return err
		}
		completedAt = &t
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO mrp_run (id, tenant_id, run_number, horizon_start, horizon_end, status, demand_source, plan_ids, total_materials, shortage_materials,
		   run_by, started_at, completed_at, error_message, notes)
		 VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)`,
		run.ID, run.TenantID, run.RunNumber, run.HorizonStart, run.HorizonEnd, run.Status, run.DemandSource, planIDs, run.TotalMaterials, run.ShortageMaterials,
		run.RunBy, startedAt, completedAt, run.ErrorMessage, run.Notes); err != nil {
		return err
	}
	if len(results) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, m := range results {
		batch.Queue(
			`INSERT INTO mrp_result (id, tenant_id, mrp_run_id, material_id, level, gross_requirement, on_hand_quantity, reserved_quantity, incoming_quantity,
			   available_quantity, net_requirement, uom, requirement_date, requirement_source, status, recommendation)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULLIF($13,'')::date,$14,$15,$16)`,
			m.ID, m.TenantID, m.MrpRunID, m.MaterialID, m.Level, m.GrossRequirement, m.OnHandQuantity, m.ReservedQuantity, m.IncomingQuantity,
			m.AvailableQuantity, m.NetRequirement, m.UOM, m.RequirementDate, m.RequirementSource, m.Status, m.Recommendation)
	}
	br := tx.SendBatch(ctx, batch)
	defer br.Close()
	for range results {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}
