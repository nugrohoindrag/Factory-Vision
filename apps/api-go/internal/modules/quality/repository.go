package quality

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
)

// Repository is the quality tables.
type Repository struct{}

func arg(params *[]any, v any) string {
	*params = append(*params, v)
	return "$" + strconv.Itoa(len(*params))
}

func parseDate(s *string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", *s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// --- inspection_plan -------------------------------------------------------

const planSelect = `
  SELECT ip.id, ip.tenant_id, ip.plan_number, ip.name, ip.inspection_type, ip.product_id, p.name, ip.process_id, pr.name,
         ip.sampling_method, ip.sampling_quantity, ip.frequency, ip.mandatory, ip.status, ip.created_by, ip.created_at, ip.updated_at
    FROM inspection_plan ip
    LEFT JOIN product p ON p.id = ip.product_id
    LEFT JOIN production_process pr ON pr.id = ip.process_id`

func scanPlan(rows pgx.Rows) (Plan, error) {
	var (
		p                  Plan
		createdAt, updated time.Time
	)
	if err := rows.Scan(&p.ID, &p.TenantID, &p.PlanNumber, &p.Name, &p.InspectionType, &p.ProductID, &p.ProductName, &p.ProcessID, &p.ProcessName,
		&p.SamplingMethod, &p.SamplingQuantity, &p.Frequency, &p.Mandatory, &p.Status, &p.CreatedBy, &createdAt, &updated); err != nil {
		return p, err
	}
	p.CreatedAt, p.UpdatedAt = db.ISO(createdAt), db.ISO(updated)
	p.Characteristics = []Characteristic{}
	p.ProductID, p.ProductName, p.ProcessID, p.ProcessName = db.Str(p.ProductID), db.Str(p.ProductName), db.Str(p.ProcessID), db.Str(p.ProcessName)
	p.Frequency, p.CreatedBy = db.Str(p.Frequency), db.Str(p.CreatedBy)
	return p, nil
}

func collectPlans(rows pgx.Rows, err error) ([]Plan, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

const characteristicSelect = `SELECT id, inspection_plan_id, sequence, name, data_type, specification, lower_limit, upper_limit, target_value, uom, required FROM inspection_characteristic`

func collectCharacteristics(rows pgx.Rows, err error) (map[string][]Characteristic, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]Characteristic{}
	for rows.Next() {
		var c Characteristic
		if err := rows.Scan(&c.ID, &c.InspectionPlanID, &c.Sequence, &c.Name, &c.DataType, &c.Specification, &c.LowerLimit, &c.UpperLimit, &c.TargetValue, &c.UOM, &c.Required); err != nil {
			return nil, err
		}
		c.Specification, c.UOM = db.Str(c.Specification), db.Str(c.UOM)
		out[c.InspectionPlanID] = append(out[c.InspectionPlanID], c)
	}
	return out, rows.Err()
}

// ListPlans reads plans, newest first, with their characteristics.
func (Repository) ListPlans(ctx context.Context, tx pgx.Tx, tenantID string, f PlanFilter) ([]Plan, error) {
	where := []string{"ip.tenant_id = $1"}
	params := []any{tenantID}
	if f.ProductID != "" {
		where = append(where, "ip.product_id = "+arg(&params, f.ProductID))
	}
	if f.ProcessID != "" {
		where = append(where, "ip.process_id = "+arg(&params, f.ProcessID))
	}
	if f.Status != "" {
		where = append(where, "ip.status = "+arg(&params, f.Status))
	}
	rows, err := tx.Query(ctx, planSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY ip.created_at DESC`, params...)
	plans, err := collectPlans(rows, err)
	if err != nil || len(plans) == 0 {
		return plans, err
	}
	crows, err := tx.Query(ctx, characteristicSelect+` WHERE tenant_id = $1 ORDER BY sequence`, tenantID)
	byPlan, err := collectCharacteristics(crows, err)
	if err != nil {
		return nil, err
	}
	for i := range plans {
		if list, ok := byPlan[plans[i].ID]; ok {
			plans[i].Characteristics = list
		}
	}
	return plans, nil
}

// FindPlan reads one plan; nil when absent.
func (Repository) FindPlan(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Plan, error) {
	rows, err := tx.Query(ctx, planSelect+` WHERE ip.tenant_id = $1 AND ip.id = $2`, tenantID, id)
	plans, err := collectPlans(rows, err)
	if err != nil || len(plans) == 0 {
		return nil, err
	}
	crows, err := tx.Query(ctx, characteristicSelect+` WHERE inspection_plan_id = $1 ORDER BY sequence`, id)
	byPlan, err := collectCharacteristics(crows, err)
	if err != nil {
		return nil, err
	}
	plan := plans[0]
	if list, ok := byPlan[id]; ok {
		plan.Characteristics = list
	}
	return &plan, nil
}

// UpsertPlan writes a plan and replaces its characteristics.
func (Repository) UpsertPlan(ctx context.Context, tx pgx.Tx, p Plan) error {
	createdAt, err := db.ParseISO(p.CreatedAt)
	if err != nil {
		return err
	}
	updatedAt, err := db.ParseISO(p.UpdatedAt)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO inspection_plan (id, tenant_id, plan_number, name, inspection_type, product_id, process_id, sampling_method, sampling_quantity,
		   frequency, mandatory, status, created_by, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, inspection_type = EXCLUDED.inspection_type, product_id = EXCLUDED.product_id,
		   process_id = EXCLUDED.process_id, sampling_method = EXCLUDED.sampling_method, sampling_quantity = EXCLUDED.sampling_quantity,
		   frequency = EXCLUDED.frequency, mandatory = EXCLUDED.mandatory, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
		p.ID, p.TenantID, p.PlanNumber, p.Name, p.InspectionType, p.ProductID, p.ProcessID, p.SamplingMethod, p.SamplingQuantity,
		p.Frequency, p.Mandatory, p.Status, p.CreatedBy, createdAt, updatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM inspection_characteristic WHERE inspection_plan_id = $1`, p.ID); err != nil {
		return err
	}
	for _, c := range p.Characteristics {
		if _, err := tx.Exec(ctx,
			`INSERT INTO inspection_characteristic (id, tenant_id, inspection_plan_id, sequence, name, data_type, specification, lower_limit, upper_limit, target_value, uom, required)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			c.ID, p.TenantID, p.ID, c.Sequence, c.Name, c.DataType, c.Specification, c.LowerLimit, c.UpperLimit, c.TargetValue, c.UOM, c.Required); err != nil {
			return err
		}
	}
	return nil
}

// DeletePlan removes a plan.
func (Repository) DeletePlan(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM inspection_plan WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return err
}

// MandatoryPlans are the active mandatory plans for a product/process.
func (Repository) MandatoryPlans(ctx context.Context, tx pgx.Tx, tenantID string, productID, processID *string) ([]Plan, error) {
	rows, err := tx.Query(ctx, planSelect+`
		WHERE ip.tenant_id = $1 AND ip.mandatory = TRUE AND ip.status = 'ACTIVE'
		  AND (ip.product_id IS NULL OR ip.product_id = $2) AND (ip.process_id IS NULL OR ip.process_id = $3)`, tenantID, productID, processID)
	return collectPlans(rows, err)
}

// --- inspection ------------------------------------------------------------

const inspectionSelect = `
  SELECT i.id, i.tenant_id, i.inspection_number, i.inspection_plan_id, ip.name, i.inspection_type, i.work_order_id, w.wo_number, i.batch_id, b.batch_number,
         i.product_id, p.name, i.process_id, i.machine_id, i.inspected_quantity, i.passed_quantity, i.failed_quantity, i.uom, i.result,
         i.operator_id, o.name, i.inspector_id, i.inspector_name, i.inspected_at, i.disposition_id, i.idempotency_key, i.notes
    FROM inspection i
    LEFT JOIN inspection_plan ip ON ip.id = i.inspection_plan_id
    LEFT JOIN work_order w ON w.id = i.work_order_id
    LEFT JOIN production_batch b ON b.id = i.batch_id
    LEFT JOIN product p ON p.id = i.product_id
    LEFT JOIN operator o ON o.id = i.operator_id`

// InsertInspection writes an inspection and its lines.
func (Repository) InsertInspection(ctx context.Context, tx pgx.Tx, in Inspection) error {
	inspectedAt, err := db.ParseISO(in.InspectedAt)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO inspection (id, tenant_id, inspection_number, inspection_plan_id, inspection_type, work_order_id, batch_id, product_id, process_id, machine_id,
		   inspected_quantity, passed_quantity, failed_quantity, uom, result, operator_id, inspector_id, inspector_name, inspected_at, idempotency_key, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
		in.ID, in.TenantID, in.InspectionNumber, in.InspectionPlanID, in.InspectionType, in.WorkOrderID, in.BatchID, in.ProductID, in.ProcessID, in.MachineID,
		in.InspectedQuantity, in.PassedQuantity, in.FailedQuantity, in.UOM, in.Result, in.OperatorID, in.InspectorID, in.InspectorName, inspectedAt, in.IdempotencyKey, in.Notes); err != nil {
		return err
	}
	for _, l := range in.Lines {
		if _, err := tx.Exec(ctx,
			`INSERT INTO inspection_result_line (id, tenant_id, inspection_id, characteristic_id, characteristic_name, expected_value, actual_value, numeric_value, result, notes)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			l.ID, in.TenantID, in.ID, db.NullIf(l.CharacteristicID), l.CharacteristicName, l.ExpectedValue, l.ActualValue, l.NumericValue, l.Result, l.Notes); err != nil {
			return err
		}
	}
	return nil
}

// ListInspections reads inspections, newest first, with their lines.
func (Repository) ListInspections(ctx context.Context, tx pgx.Tx, tenantID string, f InspectionFilter) ([]Inspection, error) {
	where := []string{"i.tenant_id = $1"}
	params := []any{tenantID}
	if f.WorkOrderID != "" {
		where = append(where, "i.work_order_id = "+arg(&params, f.WorkOrderID))
	}
	if f.BatchID != "" {
		where = append(where, "i.batch_id = "+arg(&params, f.BatchID))
	}
	if f.ProductID != "" {
		where = append(where, "i.product_id = "+arg(&params, f.ProductID))
	}
	if f.Result != "" {
		where = append(where, "i.result = "+arg(&params, f.Result))
	}
	if f.IdempotencyKey != "" {
		where = append(where, "i.idempotency_key = "+arg(&params, f.IdempotencyKey))
	}
	if f.From != "" {
		where = append(where, "i.inspected_at >= "+arg(&params, f.From)+"::timestamptz")
	}
	if f.To != "" {
		where = append(where, "i.inspected_at <= "+arg(&params, f.To)+"::timestamptz")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := tx.Query(ctx, inspectionSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY i.inspected_at DESC LIMIT `+arg(&params, limit), params...)
	if err != nil {
		return nil, err
	}
	out := []Inspection{}
	for rows.Next() {
		var (
			i           Inspection
			inspector   *string
			inspectedAt time.Time
		)
		if err := rows.Scan(&i.ID, &i.TenantID, &i.InspectionNumber, &i.InspectionPlanID, &i.InspectionPlanName, &i.InspectionType, &i.WorkOrderID, &i.WorkOrderNumber, &i.BatchID, &i.BatchNumber,
			&i.ProductID, &i.ProductName, &i.ProcessID, &i.MachineID, &i.InspectedQuantity, &i.PassedQuantity, &i.FailedQuantity, &i.UOM, &i.Result,
			&i.OperatorID, &i.OperatorName, &i.InspectorID, &inspector, &inspectedAt, &i.DispositionID, &i.IdempotencyKey, &i.Notes); err != nil {
			rows.Close()
			return nil, err
		}
		i.InspectorName = db.StrOr(inspector, i.InspectorID)
		i.InspectedAt = db.ISO(inspectedAt)
		i.Lines = []ResultLine{}
		i.InspectionPlanID, i.InspectionPlanName, i.WorkOrderID, i.WorkOrderNumber = db.Str(i.InspectionPlanID), db.Str(i.InspectionPlanName), db.Str(i.WorkOrderID), db.Str(i.WorkOrderNumber)
		i.BatchID, i.BatchNumber, i.ProductID, i.ProductName, i.ProcessID, i.MachineID = db.Str(i.BatchID), db.Str(i.BatchNumber), db.Str(i.ProductID), db.Str(i.ProductName), db.Str(i.ProcessID), db.Str(i.MachineID)
		i.UOM, i.OperatorID, i.OperatorName, i.DispositionID, i.IdempotencyKey, i.Notes = db.Str(i.UOM), db.Str(i.OperatorID), db.Str(i.OperatorName), db.Str(i.DispositionID), db.Str(i.IdempotencyKey), db.Str(i.Notes)
		out = append(out, i)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(out) == 0 {
		return out, err
	}
	ids := make([]string, len(out))
	index := map[string]int{}
	for k, i := range out {
		ids[k] = i.ID
		index[i.ID] = k
	}
	lrows, err := tx.Query(ctx,
		`SELECT id, inspection_id, characteristic_id, characteristic_name, expected_value, actual_value, numeric_value, result, notes
		   FROM inspection_result_line WHERE inspection_id = ANY($1::varchar[])`, ids)
	if err != nil {
		return nil, err
	}
	defer lrows.Close()
	for lrows.Next() {
		var l ResultLine
		var characteristicID *string
		if err := lrows.Scan(&l.ID, &l.InspectionID, &characteristicID, &l.CharacteristicName, &l.ExpectedValue, &l.ActualValue, &l.NumericValue, &l.Result, &l.Notes); err != nil {
			return nil, err
		}
		l.CharacteristicID = db.StrOr(characteristicID, "")
		l.ExpectedValue, l.ActualValue, l.Notes = db.Str(l.ExpectedValue), db.Str(l.ActualValue), db.Str(l.Notes)
		if k, ok := index[l.InspectionID]; ok {
			out[k].Lines = append(out[k].Lines, l)
		}
	}
	return out, lrows.Err()
}

// SetInspectionDisposition links an inspection to its disposition.
func (Repository) SetInspectionDisposition(ctx context.Context, tx pgx.Tx, tenantID, inspectionID, dispositionID string) error {
	_, err := tx.Exec(ctx, `UPDATE inspection SET disposition_id = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, inspectionID, dispositionID)
	return err
}

// YieldTotals sums inspections over a window.
func (Repository) YieldTotals(ctx context.Context, tx pgx.Tx, tenantID, from, to string) (inspected, passed, failed float64, inspections, failures int, err error) {
	err = tx.QueryRow(ctx,
		`SELECT COALESCE(sum(inspected_quantity), 0), COALESCE(sum(passed_quantity), 0), COALESCE(sum(failed_quantity), 0), count(*), count(*) FILTER (WHERE result = 'FAIL')
		   FROM inspection WHERE tenant_id = $1 AND inspected_at >= $2::timestamptz AND inspected_at <= $3::timestamptz`, tenantID, from, to).
		Scan(&inspected, &passed, &failed, &inspections, &failures)
	return
}

// --- quality_hold ----------------------------------------------------------

// InsertHold writes a hold.
func (Repository) InsertHold(ctx context.Context, tx pgx.Tx, h Hold) error {
	heldAt, err := db.ParseISO(h.HeldAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO quality_hold (id, tenant_id, hold_number, work_order_id, batch_id, product_id, material_id, inspection_id, quantity, uom, reason, owner_id, owner_name, status, held_by, held_at, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		h.ID, h.TenantID, h.HoldNumber, h.WorkOrderID, h.BatchID, h.ProductID, h.MaterialID, h.InspectionID, h.Quantity, h.UOM, h.Reason, h.OwnerID, h.OwnerName, h.Status, h.HeldBy, heldAt, h.Notes)
	return err
}

// ListHolds reads holds, newest first.
func (Repository) ListHolds(ctx context.Context, tx pgx.Tx, tenantID string, f HoldFilter) ([]Hold, error) {
	where := []string{"h.tenant_id = $1"}
	params := []any{tenantID}
	if f.ID != "" {
		where = append(where, "h.id = "+arg(&params, f.ID))
	}
	if f.Status != "" {
		where = append(where, "h.status = "+arg(&params, f.Status))
	}
	if f.WorkOrderID != "" {
		where = append(where, "h.work_order_id = "+arg(&params, f.WorkOrderID))
	}
	if f.BatchID != "" {
		where = append(where, "h.batch_id = "+arg(&params, f.BatchID))
	}
	rows, err := tx.Query(ctx,
		`SELECT h.id, h.tenant_id, h.hold_number, h.work_order_id, w.wo_number, h.batch_id, b.batch_number, h.product_id, p.name, h.material_id, h.inspection_id,
		        h.quantity, h.uom, h.reason, h.owner_id, h.owner_name, h.status, h.held_by, h.held_at, h.released_by, h.released_at, h.disposition_id, h.notes
		   FROM quality_hold h LEFT JOIN work_order w ON w.id = h.work_order_id LEFT JOIN production_batch b ON b.id = h.batch_id LEFT JOIN product p ON p.id = h.product_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY h.held_at DESC`, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Hold{}
	for rows.Next() {
		var (
			h          Hold
			ownerName  *string
			heldAt     time.Time
			releasedAt *time.Time
		)
		if err := rows.Scan(&h.ID, &h.TenantID, &h.HoldNumber, &h.WorkOrderID, &h.WorkOrderNumber, &h.BatchID, &h.BatchNumber, &h.ProductID, &h.ProductName, &h.MaterialID, &h.InspectionID,
			&h.Quantity, &h.UOM, &h.Reason, &h.OwnerID, &ownerName, &h.Status, &h.HeldBy, &heldAt, &h.ReleasedBy, &releasedAt, &h.DispositionID, &h.Notes); err != nil {
			return nil, err
		}
		h.OwnerName = db.StrOr(ownerName, h.OwnerID)
		h.HeldAt, h.ReleasedAt = db.ISO(heldAt), db.ISOPtr(releasedAt)
		h.WorkOrderID, h.WorkOrderNumber, h.BatchID, h.BatchNumber = db.Str(h.WorkOrderID), db.Str(h.WorkOrderNumber), db.Str(h.BatchID), db.Str(h.BatchNumber)
		h.ProductID, h.ProductName, h.MaterialID, h.InspectionID = db.Str(h.ProductID), db.Str(h.ProductName), db.Str(h.MaterialID), db.Str(h.InspectionID)
		h.UOM, h.ReleasedBy, h.DispositionID, h.Notes = db.Str(h.UOM), db.Str(h.ReleasedBy), db.Str(h.DispositionID), db.Str(h.Notes)
		out = append(out, h)
	}
	return out, rows.Err()
}

// CloseHold releases or dispositions a hold.
func (Repository) CloseHold(ctx context.Context, tx pgx.Tx, tenantID, id, status, releasedBy string, dispositionID *string) error {
	_, err := tx.Exec(ctx,
		`UPDATE quality_hold SET status = $3, released_by = $4, released_at = CURRENT_TIMESTAMP, disposition_id = COALESCE($5, disposition_id)
		  WHERE tenant_id = $1 AND id = $2`, tenantID, id, status, releasedBy, dispositionID)
	return err
}

// OpenHoldQuantity is what is still held on a work order.
func (Repository) OpenHoldQuantity(ctx context.Context, tx pgx.Tx, tenantID, workOrderID string) (float64, error) {
	var total float64
	err := tx.QueryRow(ctx, `SELECT COALESCE(sum(quantity), 0) FROM quality_hold WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'OPEN'`, tenantID, workOrderID).Scan(&total)
	return total, err
}

// --- quality_disposition ---------------------------------------------------

// InsertDisposition writes a disposition.
func (Repository) InsertDisposition(ctx context.Context, tx pgx.Tx, d Disposition) error {
	decidedAt, err := db.ParseISO(d.DecidedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO quality_disposition (id, tenant_id, inspection_id, quality_hold_id, work_order_id, batch_id, product_id, decision, quantity, uom, reason, defect_code, ncr_id, decided_by, decided_by_name, decided_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		d.ID, d.TenantID, d.InspectionID, d.QualityHoldID, d.WorkOrderID, d.BatchID, d.ProductID, d.Decision, d.Quantity, d.UOM, d.Reason, d.DefectCode, d.NcrID, d.DecidedBy, d.DecidedByName, decidedAt)
	return err
}

// ListDispositions reads dispositions, newest first.
func (Repository) ListDispositions(ctx context.Context, tx pgx.Tx, tenantID string, f DispositionFilter) ([]Disposition, error) {
	where := []string{"d.tenant_id = $1"}
	params := []any{tenantID}
	if f.WorkOrderID != "" {
		where = append(where, "d.work_order_id = "+arg(&params, f.WorkOrderID))
	}
	if f.InspectionID != "" {
		where = append(where, "d.inspection_id = "+arg(&params, f.InspectionID))
	}
	if f.Decision != "" {
		where = append(where, "d.decision = "+arg(&params, f.Decision))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := tx.Query(ctx,
		`SELECT d.id, d.tenant_id, d.inspection_id, d.quality_hold_id, d.work_order_id, w.wo_number, d.batch_id, d.product_id, d.decision, d.quantity, d.uom, d.reason,
		        d.defect_code, d.ncr_id, d.decided_by, d.decided_by_name, d.decided_at
		   FROM quality_disposition d LEFT JOIN work_order w ON w.id = d.work_order_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY d.decided_at DESC LIMIT `+arg(&params, limit), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Disposition{}
	for rows.Next() {
		var d Disposition
		var decidedAt time.Time
		if err := rows.Scan(&d.ID, &d.TenantID, &d.InspectionID, &d.QualityHoldID, &d.WorkOrderID, &d.WorkOrderNumber, &d.BatchID, &d.ProductID, &d.Decision, &d.Quantity, &d.UOM, &d.Reason,
			&d.DefectCode, &d.NcrID, &d.DecidedBy, &d.DecidedByName, &decidedAt); err != nil {
			return nil, err
		}
		d.DecidedAt = db.ISO(decidedAt)
		d.InspectionID, d.QualityHoldID, d.WorkOrderID, d.WorkOrderNumber = db.Str(d.InspectionID), db.Str(d.QualityHoldID), db.Str(d.WorkOrderID), db.Str(d.WorkOrderNumber)
		d.BatchID, d.ProductID, d.UOM, d.DefectCode, d.NcrID, d.DecidedByName = db.Str(d.BatchID), db.Str(d.ProductID), db.Str(d.UOM), db.Str(d.DefectCode), db.Str(d.NcrID), db.Str(d.DecidedByName)
		out = append(out, d)
	}
	return out, rows.Err()
}

// --- non_conformance_record / corrective_action ----------------------------

// InsertNcr writes an NCR.
func (Repository) InsertNcr(ctx context.Context, tx pgx.Tx, n Ncr) error {
	raisedAt, err := db.ParseISO(n.RaisedAt)
	if err != nil {
		return err
	}
	dueDate, err := parseDate(n.DueDate)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO non_conformance_record (id, tenant_id, ncr_number, title, description, severity, status, product_id, batch_id, work_order_id, process_id, machine_id, operator_id,
		   defect_code, inspection_id, quantity, uom, root_cause, owner_id, owner_name, raised_by, raised_at, due_date)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
		n.ID, n.TenantID, n.NcrNumber, n.Title, n.Description, n.Severity, n.Status, n.ProductID, n.BatchID, n.WorkOrderID, n.ProcessID, n.MachineID, n.OperatorID,
		n.DefectCode, n.InspectionID, n.Quantity, n.UOM, n.RootCause, n.OwnerID, n.OwnerName, n.RaisedBy, raisedAt, dueDate)
	return err
}

// NcrPatch is what an NCR update may change.
type NcrPatch struct {
	Status, RootCause, OwnerID, OwnerName, DueDate, Severity *string
	ClosedBy                                                 *string
}

// UpdateNcr applies a patch; CLOSED stamps closed_by/closed_at.
func (Repository) UpdateNcr(ctx context.Context, tx pgx.Tx, tenantID, id string, p NcrPatch) error {
	var sets []string
	params := []any{tenantID, id}
	push := func(column string, v *string) {
		if v != nil {
			sets = append(sets, column+" = "+arg(&params, *v))
		}
	}
	push("status", p.Status)
	push("root_cause", p.RootCause)
	push("owner_id", p.OwnerID)
	push("owner_name", p.OwnerName)
	if p.DueDate != nil {
		sets = append(sets, "due_date = "+arg(&params, *p.DueDate)+"::date")
	}
	push("severity", p.Severity)
	if p.Status != nil && *p.Status == "CLOSED" {
		sets = append(sets, "closed_by = "+arg(&params, p.ClosedBy), "closed_at = CURRENT_TIMESTAMP")
	}
	if len(sets) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE non_conformance_record SET `+strings.Join(sets, ", ")+` WHERE tenant_id = $1 AND id = $2`, params...)
	return err
}

func scanAction(rows pgx.Rows) (Action, error) {
	var (
		a                   Action
		ownerName           *string
		dueDate             *string
		completed, verified *time.Time
	)
	if err := rows.Scan(&a.ID, &a.TenantID, &a.NcrID, &a.Sequence, &a.Action, &a.OwnerID, &ownerName, &dueDate, &a.Status, &completed, &a.CompletedBy, &verified, &a.VerifiedBy, &a.Evidence, &a.Notes); err != nil {
		return a, err
	}
	a.OwnerName = db.StrOr(ownerName, a.OwnerID)
	a.DueDate = db.Str(dueDate)
	a.CompletedAt, a.VerifiedAt = db.ISOPtr(completed), db.ISOPtr(verified)
	a.CompletedBy, a.VerifiedBy, a.Evidence, a.Notes = db.Str(a.CompletedBy), db.Str(a.VerifiedBy), db.Str(a.Evidence), db.Str(a.Notes)
	return a, nil
}

const actionSelect = `SELECT id, tenant_id, ncr_id, sequence, action, owner_id, owner_name, to_char(due_date, 'YYYY-MM-DD'), status, completed_at, completed_by, verified_at, verified_by, evidence, notes FROM corrective_action`

// ListNcrs reads NCRs, newest first, with their actions.
func (Repository) ListNcrs(ctx context.Context, tx pgx.Tx, tenantID string, f NcrFilter) ([]Ncr, error) {
	where := []string{"n.tenant_id = $1"}
	params := []any{tenantID}
	if f.ID != "" {
		where = append(where, "n.id = "+arg(&params, f.ID))
	}
	if f.Status != "" {
		where = append(where, "n.status = "+arg(&params, f.Status))
	}
	if f.WorkOrderID != "" {
		where = append(where, "n.work_order_id = "+arg(&params, f.WorkOrderID))
	}
	if f.Overdue {
		where = append(where, "n.due_date IS NOT NULL AND n.due_date < CURRENT_DATE AND n.status <> 'CLOSED'")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := tx.Query(ctx,
		`SELECT n.id, n.tenant_id, n.ncr_number, n.title, n.description, n.severity, n.status, n.product_id, p.name, n.batch_id, n.work_order_id, w.wo_number,
		        n.process_id, n.machine_id, n.operator_id, n.defect_code, n.inspection_id, n.quantity, n.uom, n.root_cause, n.owner_id, n.owner_name, n.raised_by, n.raised_at,
		        to_char(n.due_date, 'YYYY-MM-DD'), n.closed_by, n.closed_at
		   FROM non_conformance_record n LEFT JOIN product p ON p.id = n.product_id LEFT JOIN work_order w ON w.id = n.work_order_id
		  WHERE `+strings.Join(where, " AND ")+` ORDER BY n.raised_at DESC LIMIT `+arg(&params, limit), params...)
	if err != nil {
		return nil, err
	}
	out := []Ncr{}
	for rows.Next() {
		var (
			n         Ncr
			ownerName *string
			raisedAt  time.Time
			closedAt  *time.Time
		)
		if err := rows.Scan(&n.ID, &n.TenantID, &n.NcrNumber, &n.Title, &n.Description, &n.Severity, &n.Status, &n.ProductID, &n.ProductName, &n.BatchID, &n.WorkOrderID, &n.WorkOrderNumber,
			&n.ProcessID, &n.MachineID, &n.OperatorID, &n.DefectCode, &n.InspectionID, &n.Quantity, &n.UOM, &n.RootCause, &n.OwnerID, &ownerName, &n.RaisedBy, &raisedAt,
			&n.DueDate, &n.ClosedBy, &closedAt); err != nil {
			rows.Close()
			return nil, err
		}
		n.OwnerName = db.StrOr(ownerName, n.OwnerID)
		n.RaisedAt, n.ClosedAt = db.ISO(raisedAt), db.ISOPtr(closedAt)
		n.Actions = []Action{}
		n.ProductID, n.ProductName, n.BatchID, n.WorkOrderID, n.WorkOrderNumber = db.Str(n.ProductID), db.Str(n.ProductName), db.Str(n.BatchID), db.Str(n.WorkOrderID), db.Str(n.WorkOrderNumber)
		n.ProcessID, n.MachineID, n.OperatorID, n.DefectCode, n.InspectionID = db.Str(n.ProcessID), db.Str(n.MachineID), db.Str(n.OperatorID), db.Str(n.DefectCode), db.Str(n.InspectionID)
		n.UOM, n.RootCause, n.DueDate, n.ClosedBy = db.Str(n.UOM), db.Str(n.RootCause), db.Str(n.DueDate), db.Str(n.ClosedBy)
		out = append(out, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(out) == 0 {
		return out, err
	}
	ids := make([]string, len(out))
	index := map[string]int{}
	for k, n := range out {
		ids[k] = n.ID
		index[n.ID] = k
	}
	arows, err := tx.Query(ctx, actionSelect+` WHERE ncr_id = ANY($1::varchar[]) ORDER BY sequence`, ids)
	if err != nil {
		return nil, err
	}
	defer arows.Close()
	for arows.Next() {
		a, err := scanAction(arows)
		if err != nil {
			return nil, err
		}
		if k, ok := index[a.NcrID]; ok {
			out[k].Actions = append(out[k].Actions, a)
		}
	}
	return out, arows.Err()
}

// FindNcr reads one NCR; nil when absent.
func (r Repository) FindNcr(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Ncr, error) {
	list, err := r.ListNcrs(ctx, tx, tenantID, NcrFilter{ID: id})
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// InsertAction writes a corrective action.
func (Repository) InsertAction(ctx context.Context, tx pgx.Tx, a Action) error {
	dueDate, err := parseDate(a.DueDate)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO corrective_action (id, tenant_id, ncr_id, sequence, action, owner_id, owner_name, due_date, status, evidence, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		a.ID, a.TenantID, a.NcrID, a.Sequence, a.Action, a.OwnerID, a.OwnerName, dueDate, a.Status, a.Evidence, a.Notes)
	return err
}

// UpdateAction moves an action and records who completed or verified it.
func (Repository) UpdateAction(ctx context.Context, tx pgx.Tx, tenantID, id string, status, evidence *string, actorID string) error {
	var sets []string
	params := []any{tenantID, id}
	if status != nil && *status != "" {
		sets = append(sets, "status = "+arg(&params, *status))
		if *status == "COMPLETED" {
			sets = append(sets, "completed_by = "+arg(&params, actorID), "completed_at = CURRENT_TIMESTAMP")
		}
		if *status == "VERIFIED" {
			sets = append(sets, "verified_by = "+arg(&params, actorID), "verified_at = CURRENT_TIMESTAMP")
		}
	}
	if evidence != nil {
		sets = append(sets, "evidence = "+arg(&params, *evidence))
	}
	if len(sets) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE corrective_action SET `+strings.Join(sets, ", ")+` WHERE tenant_id = $1 AND id = $2`, params...)
	return err
}

// OpenActionCount is how many actions of an NCR are not yet verified.
func (Repository) OpenActionCount(ctx context.Context, tx pgx.Tx, tenantID, ncrID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM corrective_action WHERE tenant_id = $1 AND ncr_id = $2 AND status NOT IN ('VERIFIED', 'CANCELLED')`, tenantID, ncrID).Scan(&n)
	return n, err
}

// NextSequence is the next action number of an NCR.
func (Repository) NextSequence(ctx context.Context, tx pgx.Tx, tenantID, ncrID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT COALESCE(max(sequence), 0) FROM corrective_action WHERE tenant_id = $1 AND ncr_id = $2`, tenantID, ncrID).Scan(&n)
	return n + 1, err
}

// NextNumber is <prefix>-<year>-<count+1 padded to 4>.
func (Repository) NextNumber(ctx context.Context, tx pgx.Tx, tenantID, table, prefix string) (string, error) {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE tenant_id = $1`, tenantID).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%d-%04d", prefix, time.Now().Year(), n+1), nil
}
