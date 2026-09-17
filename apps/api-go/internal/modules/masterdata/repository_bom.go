package masterdata

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// bill_of_material and bill_of_material_item (migration 022). A component's
// SKU and name are joined from product rather than copied: the BOM is master
// data, and master data reads current names.

const bomSelect = `SELECT b.id, b.tenant_id, b.bom_number, b.product_id, p.sku, p.name,
         b.product_revision, b.bom_name, b.version, b.status, b.effective_date, b.end_date,
         b.description, b.created_by, b.created_at, b.updated_by, b.updated_at
    FROM bill_of_material b
    JOIN product p ON p.id = b.product_id`

const itemSelect = `SELECT i.id, i.bom_id, i.line_number, i.component_part_id, c.sku, c.name,
         i.component_type, i.quantity, i.uom, i.scrap_percentage, i.sequence, i.reference, i.notes,
         i.created_at, i.updated_at
    FROM bill_of_material_item i
    LEFT JOIN product c ON c.id = i.component_part_id`

func scanBom(r pgx.Rows) (Bom, error) {
	var b Bom
	var effective time.Time
	var end *time.Time
	var created, updated time.Time
	if err := r.Scan(&b.ID, &b.TenantID, &b.BomNumber, &b.ProductID, &b.ProductSKU, &b.ProductName,
		&b.ProductRevision, &b.BomName, &b.Version, &b.Status, &effective, &end,
		&b.Description, &b.CreatedBy, &created, &b.UpdatedBy, &updated); err != nil {
		return b, err
	}
	b.ProductRevision, b.Description = db.Str(b.ProductRevision), db.Str(b.Description)
	b.CreatedBy, b.UpdatedBy = db.Str(b.CreatedBy), db.Str(b.UpdatedBy)
	b.EffectiveDate = db.Date(effective)
	b.EndDate = db.DatePtr(end)
	b.CreatedAt, b.UpdatedAt = db.ISO(created), db.ISO(updated)
	b.Components = []BomItem{}
	return b, nil
}

func scanBomItem(r pgx.Rows) (BomItem, error) {
	var it BomItem
	var sku, name *string
	var scrap *float64
	var created, updated time.Time
	if err := r.Scan(&it.ID, &it.BomID, &it.LineNumber, &it.ComponentPartID, &sku, &name,
		&it.ComponentType, &it.Quantity, &it.UOM, &scrap, &it.Sequence, &it.Reference, &it.Notes,
		&created, &updated); err != nil {
		return it, err
	}
	it.ComponentPartSKU = db.StrOr(sku, it.ComponentPartID)
	it.ComponentPartName = db.StrOr(name, "Component Part")
	it.ScrapPercentage = db.Ptr(db.Deref(scrap, 0))
	if it.Sequence == nil {
		it.Sequence = db.Ptr(it.LineNumber)
	}
	it.Reference, it.Notes = db.Str(it.Reference), db.Str(it.Notes)
	it.CreatedAt, it.UpdatedAt = db.Ptr(db.ISO(created)), db.Ptr(db.ISO(updated))
	return it, nil
}

func (Repository) ListBoms(ctx context.Context, tx pgx.Tx, tenantID string) ([]Bom, error) {
	rows, err := tx.Query(ctx, bomSelect+` WHERE b.tenant_id = $1 ORDER BY b.created_at DESC`, tenantID)
	if err != nil {
		return nil, err
	}
	boms, err := collect(rows, scanBom)
	if err != nil || len(boms) == 0 {
		return boms, err
	}
	itemRows, err := tx.Query(ctx, itemSelect+` WHERE i.tenant_id = $1 ORDER BY i.line_number`, tenantID)
	if err != nil {
		return nil, err
	}
	items, err := collect(itemRows, scanBomItem)
	if err != nil {
		return nil, err
	}
	index := make(map[string]int, len(boms))
	for i, b := range boms {
		index[b.ID] = i
	}
	for _, it := range items {
		if i, ok := index[it.BomID]; ok {
			boms[i].Components = append(boms[i].Components, it)
		}
	}
	return boms, nil
}

// FindActiveBomForProduct is the BOM a requirement should be exploded from:
// ACTIVE, and in date (BR-M01).
func (Repository) FindActiveBomForProduct(ctx context.Context, tx pgx.Tx, tenantID, productID string) (*Bom, error) {
	rows, err := tx.Query(ctx, bomSelect+`
		WHERE b.tenant_id = $1 AND b.product_id = $2 AND b.status = 'ACTIVE'
		  AND b.effective_date <= CURRENT_DATE
		  AND (b.end_date IS NULL OR b.end_date >= CURRENT_DATE)
		ORDER BY b.effective_date DESC
		LIMIT 1`, tenantID, productID)
	if err != nil {
		return nil, err
	}
	boms, err := collect(rows, scanBom)
	if err != nil || len(boms) == 0 {
		return nil, err
	}
	b := boms[0]
	itemRows, err := tx.Query(ctx, itemSelect+` WHERE i.bom_id = $1 ORDER BY i.line_number`, b.ID)
	if err != nil {
		return nil, err
	}
	items, err := collect(itemRows, scanBomItem)
	if err != nil {
		return nil, err
	}
	b.Components = items
	return &b, nil
}

// UpsertBom writes the header and replaces the component list. Replace
// rather than merge: a BOM's lines are renumbered on every edit, so matching
// old rows to new ones would be guesswork. The delete and the inserts share
// the transaction, so a BOM is never briefly empty.
func (Repository) UpsertBom(ctx context.Context, tx pgx.Tx, b Bom) error {
	effective, err := db.ParseISO(b.EffectiveDate)
	if err != nil {
		return err
	}
	var end *time.Time
	if b.EndDate != nil {
		t, err := db.ParseISO(*b.EndDate)
		if err != nil {
			return err
		}
		end = &t
	}
	created, _ := db.ParseISO(b.CreatedAt)
	updated, _ := db.ParseISO(b.UpdatedAt)
	_, err = tx.Exec(ctx,
		`INSERT INTO bill_of_material (
		   id, tenant_id, bom_number, product_id, product_revision, bom_name, version, status,
		   effective_date, end_date, description, created_by, created_at, updated_by, updated_at
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		 ON CONFLICT (id) DO UPDATE SET
		   bom_number = EXCLUDED.bom_number, product_id = EXCLUDED.product_id,
		   product_revision = EXCLUDED.product_revision, bom_name = EXCLUDED.bom_name,
		   version = EXCLUDED.version, status = EXCLUDED.status,
		   effective_date = EXCLUDED.effective_date, end_date = EXCLUDED.end_date,
		   description = EXCLUDED.description, updated_by = EXCLUDED.updated_by,
		   updated_at = EXCLUDED.updated_at`,
		b.ID, b.TenantID, b.BomNumber, b.ProductID, b.ProductRevision, b.BomName, b.Version, b.Status,
		effective, end, b.Description, b.CreatedBy, created, b.UpdatedBy, updated)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM bill_of_material_item WHERE bom_id = $1`, b.ID); err != nil {
		return err
	}
	// One round-trip for every component rather than one per line.
	batch := &pgx.Batch{}
	for _, it := range b.Components {
		itemCreated := created
		if it.CreatedAt != nil {
			if t, err := db.ParseISO(*it.CreatedAt); err == nil {
				itemCreated = t
			}
		}
		itemUpdated := updated
		if it.UpdatedAt != nil {
			if t, err := db.ParseISO(*it.UpdatedAt); err == nil {
				itemUpdated = t
			}
		}
		batch.Queue(
			`INSERT INTO bill_of_material_item (
			   id, bom_id, tenant_id, line_number, component_part_id, component_type,
			   quantity, uom, scrap_percentage, sequence, reference, notes, created_at, updated_at
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			it.ID, b.ID, b.TenantID, it.LineNumber, it.ComponentPartID, it.ComponentType,
			it.Quantity, it.UOM, db.Deref(it.ScrapPercentage, 0), db.Deref(it.Sequence, it.LineNumber),
			it.Reference, it.Notes, itemCreated, itemUpdated)
	}
	if batch.Len() == 0 {
		return nil
	}
	results := tx.SendBatch(ctx, batch)
	for range b.Components {
		if _, err := results.Exec(); err != nil {
			results.Close()
			return err
		}
	}
	return results.Close()
}

func (Repository) SetBomStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string) error {
	_, err := tx.Exec(ctx, `UPDATE bill_of_material SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2`, tenantID, id, status)
	return err
}

// DeactivateOtherBoms supersedes whatever else was ACTIVE for the product,
// so exactly one is.
func (Repository) DeactivateOtherBoms(ctx context.Context, tx pgx.Tx, tenantID, productID, keepID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE bill_of_material SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP
		  WHERE tenant_id = $1 AND product_id = $2 AND id <> $3 AND status = 'ACTIVE'`,
		tenantID, productID, keepID)
	return err
}

func (Repository) CountBoms(ctx context.Context, tx pgx.Tx, tenantID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*)::int FROM bill_of_material WHERE tenant_id = $1`, tenantID).Scan(&n)
	return n, err
}
