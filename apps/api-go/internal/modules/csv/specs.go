package csv

import (
	"context"
	"strconv"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
)

func statusOr(v string) string {
	if v == "" {
		return "ACTIVE"
	}
	return v
}

func boolOr(v string, fallback bool) bool {
	if v == "" {
		return fallback
	}
	return v == "true"
}

func statusError(row Row) []rowError {
	if row["status"] != "" && row["status"] != "ACTIVE" && row["status"] != "INACTIVE" {
		return []rowError{{column: "status", code: "INVALID_FORMAT", message: "status harus ACTIVE atau INACTIVE."}}
	}
	return nil
}

func unknown(column, message string) rowError {
	return rowError{column: column, code: "UNKNOWN_REFERENCE", message: message}
}

func (r *reference) plant(code string) *masterdata.Plant {
	for i := range r.Plants {
		if r.Plants[i].ID == code || r.Plants[i].Name == code {
			return &r.Plants[i]
		}
	}
	return nil
}

func (r *reference) line(code string) *masterdata.Line {
	for i := range r.Lines {
		if r.Lines[i].Code == code || r.Lines[i].ID == code {
			return &r.Lines[i]
		}
	}
	return nil
}

func (r *reference) workCenter(code string) *masterdata.WorkCenter {
	for i := range r.WorkCenters {
		if r.WorkCenters[i].Code == code || r.WorkCenters[i].ID == code {
			return &r.WorkCenters[i]
		}
	}
	return nil
}

func (r *reference) productBySKU(sku string) *masterdata.Product {
	for i := range r.Products {
		if r.Products[i].SKU == sku {
			return &r.Products[i]
		}
	}
	return nil
}

func (r *reference) machineByCode(code string) *masterdata.Machine {
	for i := range r.Machines {
		if r.Machines[i].Code == code {
			return &r.Machines[i]
		}
	}
	return nil
}

func (r *reference) processByCode(code string) *masterdata.Process {
	for i := range r.Processes {
		if r.Processes[i].Code == code {
			return &r.Processes[i]
		}
	}
	return nil
}

func buildSpecs() map[string]spec {
	specs := map[string]spec{}

	specs["products"] = spec{
		label: "Produk / SKU",
		columns: []Column{
			col("sku", true, "Kode produk unik", "TIRE-185-65-R15"),
			col("name", true, "Nama produk", "Passenger Tire 185/65 R15"),
			col("unit", false, "Satuan (default PCS)", "PCS"),
			col("idealCycleTimeSeconds", true, "Ideal cycle time default (detik)", "750"),
			col("status", false, "ACTIVE atau INACTIVE", "ACTIVE"),
		},
		keyOf: func(row Row) string { return row["sku"] },
		validate: func(_ context.Context, _ string, row Row, _ *reference) []rowError {
			var errs []rowError
			if !isPositiveNumber(row["idealCycleTimeSeconds"]) {
				errs = append(errs, numberError("idealCycleTimeSeconds"))
			}
			return append(errs, statusError(row)...)
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			payload := masterdata.Patch{
				"sku": row["sku"], "name": row["name"], "unit": orDefault(row["unit"], "PCS"),
				"idealCycleTimeSeconds": num(row["idealCycleTimeSeconds"]), "status": statusOr(row["status"]),
			}
			if existing := ref.productBySKU(row["sku"]); existing != nil {
				_, err := ref.master.UpdateProduct(ctx, tenantID, existing.ID, payload)
				return "updated", err
			}
			_, err := ref.master.CreateProduct(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.Products))
			for _, p := range ref.Products {
				rows = append(rows, Row{"sku": p.SKU, "name": p.Name, "unit": p.Unit,
					"idealCycleTimeSeconds": fmtNum(p.IdealCycleTimeSeconds), "status": p.Status})
			}
			return rows, nil
		},
	}

	specs["machines"] = spec{
		label: "Mesin",
		columns: []Column{
			col("code", true, "Kode mesin unik", "CPR-003"),
			col("name", true, "Nama mesin", "Dual Cavity Curing Press 03"),
			col("workCenterCode", true, "Kode work center", "WC-CURING"),
			col("idealCycleTimeSeconds", true, "Ideal cycle time mesin (detik)", "750"),
			col("status", false, "ACTIVE atau INACTIVE", "ACTIVE"),
		},
		keyOf: func(row Row) string { return row["code"] },
		validate: func(_ context.Context, _ string, row Row, ref *reference) []rowError {
			var errs []rowError
			if ref.workCenter(row["workCenterCode"]) == nil {
				errs = append(errs, unknown("workCenterCode", "Work center "+row["workCenterCode"]+" tidak ditemukan."))
			}
			if !isPositiveNumber(row["idealCycleTimeSeconds"]) {
				errs = append(errs, numberError("idealCycleTimeSeconds"))
			}
			return errs
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			wc := ref.workCenter(row["workCenterCode"])
			payload := masterdata.Patch{
				"workCenterId": wc.ID, "code": row["code"], "name": row["name"],
				"idealCycleTimeSeconds": num(row["idealCycleTimeSeconds"]), "status": statusOr(row["status"]),
			}
			if existing := ref.machineByCode(row["code"]); existing != nil {
				_, err := ref.master.UpdateMachine(ctx, tenantID, existing.ID, payload)
				return "updated", err
			}
			_, err := ref.master.CreateMachine(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.Machines))
			for _, m := range ref.Machines {
				code := m.WorkCenterID
				for _, w := range ref.WorkCenters {
					if w.ID == m.WorkCenterID {
						code = w.Code
					}
				}
				rows = append(rows, Row{"code": m.Code, "name": m.Name, "workCenterCode": code,
					"idealCycleTimeSeconds": fmtNum(m.IdealCycleTimeSeconds), "status": m.Status})
			}
			return rows, nil
		},
	}

	specs["lines"] = spec{
		label: "Production Line",
		columns: []Column{
			col("code", true, "Kode line unik", "LINE-04"),
			col("name", true, "Nama line", "Curing Line 04"),
			col("plantCode", true, "Kode/ID plant", "plant-cikarang-01"),
			col("plannedProductionTimeMinutes", true, "Planned production time per shift (menit)", "480"),
			col("status", false, "ACTIVE atau INACTIVE", "ACTIVE"),
		},
		keyOf: func(row Row) string { return row["code"] },
		validate: func(_ context.Context, _ string, row Row, ref *reference) []rowError {
			var errs []rowError
			if ref.plant(row["plantCode"]) == nil {
				errs = append(errs, unknown("plantCode", "Plant "+row["plantCode"]+" tidak ditemukan."))
			}
			if !isPositiveNumber(row["plannedProductionTimeMinutes"]) {
				errs = append(errs, numberError("plannedProductionTimeMinutes"))
			}
			return errs
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			plant := ref.plant(row["plantCode"])
			payload := masterdata.Patch{
				"plantId": plant.ID, "code": row["code"], "name": row["name"],
				"plannedProductionTimeMinutes": num(row["plannedProductionTimeMinutes"]), "status": statusOr(row["status"]),
			}
			for _, l := range ref.Lines {
				if l.Code == row["code"] {
					_, err := ref.master.UpdateLine(ctx, tenantID, l.ID, payload)
					return "updated", err
				}
			}
			_, err := ref.master.CreateLine(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, allowed []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.Lines))
			for _, l := range ref.Lines {
				if allowed != nil && !contains(allowed, l.ID) {
					continue
				}
				rows = append(rows, Row{"code": l.Code, "name": l.Name, "plantCode": l.PlantID,
					"plannedProductionTimeMinutes": strconv.Itoa(l.PlannedProductionTimeMinutes), "status": l.Status})
			}
			return rows, nil
		},
	}

	specs["operators"] = spec{
		label: "Operator",
		columns: []Column{
			col("employeeNumber", true, "Nomor karyawan unik", "OP-1004"),
			col("name", true, "Nama operator", "Dedi Kurniawan"),
			colRef("defaultLineCode", false, "Kode line default", "LINE-01", "lines"),
			col("status", false, "ACTIVE atau INACTIVE", "ACTIVE"),
		},
		keyOf: func(row Row) string { return row["employeeNumber"] },
		validate: func(_ context.Context, _ string, row Row, ref *reference) []rowError {
			if row["defaultLineCode"] != "" && ref.line(row["defaultLineCode"]) == nil {
				return []rowError{unknown("defaultLineCode", "Line "+row["defaultLineCode"]+" tidak ditemukan.")}
			}
			return nil
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			payload := masterdata.Patch{"employeeNumber": row["employeeNumber"], "name": row["name"], "status": statusOr(row["status"])}
			if row["defaultLineCode"] != "" {
				payload["defaultLineId"] = ref.line(row["defaultLineCode"]).ID
			} else {
				payload["defaultLineId"] = nil
			}
			for _, o := range ref.operators {
				if o.EmployeeNumber == row["employeeNumber"] {
					_, err := ref.master.UpdateOperator(ctx, tenantID, o.ID, payload)
					return "updated", err
				}
			}
			_, err := ref.master.CreateOperator(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.operators))
			for _, o := range ref.operators {
				code := ""
				if o.DefaultLineID != nil {
					for _, l := range ref.Lines {
						if l.ID == *o.DefaultLineID {
							code = l.Code
						}
					}
				}
				rows = append(rows, Row{"employeeNumber": o.EmployeeNumber, "name": o.Name, "defaultLineCode": code, "status": o.Status})
			}
			return rows, nil
		},
	}

	specs["processes"] = spec{
		label: "Production Process",
		columns: []Column{
			col("code", true, "Kode proses unik", "FIN"),
			col("name", true, "Nama proses", "Finishing"),
			col("sequenceDefault", true, "Urutan default", "8"),
			col("description", false, "Deskripsi operasi", "Trimming dan buffing"),
			col("status", false, "ACTIVE atau INACTIVE", "ACTIVE"),
		},
		keyOf: func(row Row) string { return row["code"] },
		validate: func(_ context.Context, _ string, row Row, _ *reference) []rowError {
			if !isPositiveNumber(row["sequenceDefault"]) {
				return []rowError{numberError("sequenceDefault")}
			}
			return nil
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			payload := masterdata.Patch{"code": row["code"], "name": row["name"], "description": row["description"],
				"sequenceDefault": num(row["sequenceDefault"]), "status": statusOr(row["status"])}
			if existing := ref.processByCode(row["code"]); existing != nil {
				_, err := ref.master.UpdateProcess(ctx, tenantID, existing.ID, payload)
				return "updated", err
			}
			_, err := ref.master.CreateProcess(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.Processes))
			for _, p := range ref.Processes {
				desc := ""
				if p.Description != nil {
					desc = *p.Description
				}
				rows = append(rows, Row{"code": p.Code, "name": p.Name, "sequenceDefault": strconv.Itoa(p.SequenceDefault),
					"description": desc, "status": p.Status})
			}
			return rows, nil
		},
	}

	specs["routings"] = spec{
		label: "Product Routing",
		columns: []Column{
			colRef("productSku", true, "SKU produk", "TIRE-185-65-R15", "products"),
			colRef("processCode", true, "Kode proses", "CUR", "processes"),
			col("sequence", true, "Urutan langkah", "4"),
			colRef("machineCode", false, "Kode mesin", "CPR-001", "machines"),
			col("standardCycleTimeSeconds", false, "Cycle time standar (detik)", "750"),
			col("active", false, "true atau false", "true"),
		},
		keyOf: func(row Row) string { return row["productSku"] + "|" + row["processCode"] + "|" + row["sequence"] },
		validate: func(_ context.Context, _ string, row Row, ref *reference) []rowError {
			var errs []rowError
			if ref.productBySKU(row["productSku"]) == nil {
				errs = append(errs, unknown("productSku", "Produk "+row["productSku"]+" tidak ditemukan."))
			}
			if ref.processByCode(row["processCode"]) == nil {
				errs = append(errs, unknown("processCode", "Proses "+row["processCode"]+" tidak ditemukan."))
			}
			if row["machineCode"] != "" && ref.machineByCode(row["machineCode"]) == nil {
				errs = append(errs, unknown("machineCode", "Mesin "+row["machineCode"]+" tidak ditemukan."))
			}
			if !isPositiveNumber(row["sequence"]) {
				errs = append(errs, numberError("sequence"))
			}
			return errs
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			product := ref.productBySKU(row["productSku"])
			process := ref.processByCode(row["processCode"])
			payload := masterdata.Patch{
				"productId": product.ID, "processId": process.ID, "sequence": num(row["sequence"]),
				"active": boolOr(row["active"], true),
			}
			if m := ref.machineByCode(row["machineCode"]); row["machineCode"] != "" && m != nil {
				payload["machineId"] = m.ID
				payload["workCenterId"] = m.WorkCenterID
			} else {
				payload["machineId"] = nil
				payload["workCenterId"] = nil
			}
			if row["standardCycleTimeSeconds"] != "" {
				payload["standardCycleTimeSeconds"] = num(row["standardCycleTimeSeconds"])
			} else {
				payload["standardCycleTimeSeconds"] = nil
			}
			seq := int(num(row["sequence"]))
			for _, rt := range ref.Routings {
				if rt.ProductID == product.ID && rt.ProcessID == process.ID && rt.Sequence == seq {
					_, err := ref.master.UpdateRouting(ctx, tenantID, rt.ID, payload)
					return "updated", err
				}
			}
			_, err := ref.master.CreateRouting(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.Routings))
			for _, rt := range ref.Routings {
				sku, code, machine := rt.ProductID, rt.ProcessID, ""
				for _, p := range ref.Products {
					if p.ID == rt.ProductID {
						sku = p.SKU
					}
				}
				for _, p := range ref.Processes {
					if p.ID == rt.ProcessID {
						code = p.Code
					}
				}
				if rt.MachineID != nil {
					for _, m := range ref.Machines {
						if m.ID == *rt.MachineID {
							machine = m.Code
						}
					}
				}
				std := ""
				if rt.StandardCycleTimeSeconds != nil && *rt.StandardCycleTimeSeconds != 0 {
					std = fmtNum(*rt.StandardCycleTimeSeconds)
				}
				rows = append(rows, Row{"productSku": sku, "processCode": code, "sequence": strconv.Itoa(rt.Sequence),
					"machineCode": machine, "standardCycleTimeSeconds": std, "active": strconv.FormatBool(rt.Active)})
			}
			return rows, nil
		},
	}

	specs["machine-rates"] = spec{
		label: "Ideal Cycle Time (Product × Machine)",
		columns: []Column{
			colRef("productSku", true, "SKU produk", "TIRE-185-65-R15", "products"),
			colRef("machineCode", true, "Kode mesin", "CPR-001", "machines"),
			col("idealCycleTimeSeconds", true, "Ideal cycle time (detik)", "750"),
		},
		keyOf: func(row Row) string { return row["productSku"] + "|" + row["machineCode"] },
		validate: func(_ context.Context, _ string, row Row, ref *reference) []rowError {
			var errs []rowError
			if ref.productBySKU(row["productSku"]) == nil {
				errs = append(errs, unknown("productSku", "Produk "+row["productSku"]+" tidak ditemukan."))
			}
			if ref.machineByCode(row["machineCode"]) == nil {
				errs = append(errs, unknown("machineCode", "Mesin "+row["machineCode"]+" tidak ditemukan."))
			}
			if !isPositiveNumber(row["idealCycleTimeSeconds"]) {
				errs = append(errs, numberError("idealCycleTimeSeconds"))
			}
			return errs
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			product := ref.productBySKU(row["productSku"])
			machine := ref.machineByCode(row["machineCode"])
			before := 0
			for _, rate := range ref.Rates {
				if rate.ProductID == product.ID && rate.MachineID == machine.ID {
					before++
				}
			}
			_, err := ref.master.UpsertRate(ctx, tenantID, masterdata.Patch{
				"productId": product.ID, "machineId": machine.ID, "idealCycleTimeSeconds": num(row["idealCycleTimeSeconds"]),
			})
			if before > 0 {
				return "updated", err
			}
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.Rates))
			for _, rate := range ref.Rates {
				sku, code := rate.ProductID, rate.MachineID
				for _, p := range ref.Products {
					if p.ID == rate.ProductID {
						sku = p.SKU
					}
				}
				for _, m := range ref.Machines {
					if m.ID == rate.MachineID {
						code = m.Code
					}
				}
				rows = append(rows, Row{"productSku": sku, "machineCode": code, "idealCycleTimeSeconds": fmtNum(rate.IdealCycleTimeSeconds)})
			}
			return rows, nil
		},
	}

	specs["shifts"] = spec{
		label: "Shift",
		columns: []Column{
			col("name", true, "Nama shift", "Shift 1 (Pagi)"),
			col("plantCode", true, "Kode/ID plant", "plant-cikarang-01"),
			col("startTime", true, "Jam mulai HH:mm", "06:00"),
			col("endTime", true, "Jam selesai HH:mm", "14:00"),
			col("breakMinutes", false, "Total istirahat (menit)", "60"),
			col("active", false, "true atau false", "true"),
		},
		keyOf: func(row Row) string { return row["plantCode"] + "|" + row["name"] },
		validate: func(_ context.Context, _ string, row Row, ref *reference) []rowError {
			var errs []rowError
			if ref.plant(row["plantCode"]) == nil {
				errs = append(errs, unknown("plantCode", "Plant "+row["plantCode"]+" tidak ditemukan."))
			}
			for _, column := range []string{"startTime", "endTime"} {
				if !clockPattern.MatchString(row[column]) {
					errs = append(errs, rowError{column: column, code: "INVALID_FORMAT", message: column + " harus dalam format HH:mm."})
				}
			}
			return errs
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			plant := ref.plant(row["plantCode"])
			breakMinutes := 0
			if row["breakMinutes"] != "" {
				breakMinutes = int(num(row["breakMinutes"]))
			}
			for _, s := range ref.shifts {
				if s.Name == row["name"] && s.PlantID == plant.ID {
					_, err := ref.master.UpdateShift(ctx, tenantID, s.ID, masterdata.Patch{
						"plantId": plant.ID, "name": row["name"], "startTime": row["startTime"], "endTime": row["endTime"],
						"breakMinutes": float64(breakMinutes), "active": boolOr(row["active"], true),
					})
					return "updated", err
				}
			}
			_, err := ref.master.CreateShift(ctx, tenantID, masterdata.Shift{
				PlantID: plant.ID, Name: row["name"], StartTime: row["startTime"], EndTime: row["endTime"],
				BreakMinutes: breakMinutes, Active: boolOr(row["active"], true),
			})
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.shifts))
			for _, s := range ref.shifts {
				rows = append(rows, Row{"name": s.Name, "plantCode": s.PlantID, "startTime": s.StartTime, "endTime": s.EndTime,
					"breakMinutes": strconv.Itoa(s.BreakMinutes), "active": strconv.FormatBool(s.Active)})
			}
			return rows, nil
		},
	}

	specs["downtime-reasons"] = spec{
		label: "Downtime Reason",
		columns: []Column{
			col("code", true, "Kode alasan unik", "MC-BRK"),
			col("name", true, "Nama alasan", "Kerusakan Mekanikal"),
			col("category", true, "Kategori: "+strings.Join(downtimeCategories, "/"), "MACHINE"),
			col("isPlanned", true, "true bila planned downtime", "false"),
			col("sortOrder", false, "Urutan tampil", "1"),
			col("active", false, "true atau false", "true"),
		},
		keyOf: func(row Row) string { return row["code"] },
		validate: func(_ context.Context, _ string, row Row, _ *reference) []rowError {
			var errs []rowError
			if !contains(downtimeCategories, row["category"]) {
				errs = append(errs, rowError{column: "category", code: "INVALID_FORMAT",
					message: "category harus salah satu dari " + strings.Join(downtimeCategories, ", ") + "."})
			}
			if row["isPlanned"] != "true" && row["isPlanned"] != "false" {
				errs = append(errs, rowError{column: "isPlanned", code: "INVALID_FORMAT", message: "isPlanned harus true atau false."})
			}
			return errs
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			sortOrder := 99.0
			if row["sortOrder"] != "" {
				sortOrder = num(row["sortOrder"])
			}
			payload := masterdata.Patch{"code": row["code"], "name": row["name"], "category": row["category"],
				"isPlanned": row["isPlanned"] == "true", "sortOrder": sortOrder, "active": boolOr(row["active"], true),
				"description": row["description"]}
			for _, d := range ref.DowntimeReasons {
				if d.Code == row["code"] {
					_, err := ref.master.UpdateDowntimeReason(ctx, tenantID, d.ID, payload)
					return "updated", err
				}
			}
			_, err := ref.master.CreateDowntimeReason(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.DowntimeReasons))
			for _, d := range ref.DowntimeReasons {
				rows = append(rows, Row{"code": d.Code, "name": d.Name, "category": d.Category, "isPlanned": strconv.FormatBool(d.IsPlanned),
					"sortOrder": strconv.Itoa(d.SortOrder), "active": strconv.FormatBool(d.Active)})
			}
			return rows, nil
		},
	}

	specs["reject-reasons"] = spec{
		label: "Reject Reason",
		columns: []Column{
			col("code", true, "Kode defect unik", "DIM-OOS"),
			col("name", true, "Nama defect", "Dimensi di luar toleransi"),
			col("category", true, "Kategori: "+strings.Join(rejectCategories, "/"), "DIMENSION"),
			col("sortOrder", false, "Urutan tampil", "1"),
			col("active", false, "true atau false", "true"),
		},
		keyOf: func(row Row) string { return row["code"] },
		validate: func(_ context.Context, _ string, row Row, _ *reference) []rowError {
			if !contains(rejectCategories, row["category"]) {
				return []rowError{{column: "category", code: "INVALID_FORMAT",
					message: "category harus salah satu dari " + strings.Join(rejectCategories, ", ") + "."}}
			}
			return nil
		},
		apply: func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error) {
			sortOrder := 99.0
			if row["sortOrder"] != "" {
				sortOrder = num(row["sortOrder"])
			}
			payload := masterdata.Patch{"code": row["code"], "name": row["name"], "category": row["category"],
				"sortOrder": sortOrder, "active": boolOr(row["active"], true), "description": row["description"]}
			for _, d := range ref.RejectReasons {
				if d.Code == row["code"] {
					_, err := ref.master.UpdateRejectReason(ctx, tenantID, d.ID, payload)
					return "updated", err
				}
			}
			_, err := ref.master.CreateRejectReason(ctx, tenantID, payload)
			return "created", err
		},
		export: func(_ context.Context, _ string, ref *reference, _ []string) ([]Row, error) {
			rows := make([]Row, 0, len(ref.RejectReasons))
			for _, d := range ref.RejectReasons {
				rows = append(rows, Row{"code": d.Code, "name": d.Name, "category": d.Category,
					"sortOrder": strconv.Itoa(d.SortOrder), "active": strconv.FormatBool(d.Active)})
			}
			return rows, nil
		},
	}

	return specs
}

var clockPattern = mustClock()

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// fmtNum renders a number the way String(n) does in JavaScript: no
// trailing zeros, no exponent for ordinary magnitudes.
func fmtNum(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}
