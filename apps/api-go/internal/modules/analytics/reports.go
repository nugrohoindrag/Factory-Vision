package analytics

import (
	"context"
	"strconv"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

// Reports (US-038 … US-040). Each is a flat list the console renders and
// exports; the CSV is the same rows, quoted, CRLF-separated, with the JSON
// property names as the header.

// ProductionReport is one row per work order, optionally for one line.
func (s *Service) ProductionReport(ctx context.Context, tenantID, lineID string) ([]ProductionReportRow, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := []ProductionReportRow{}
	for _, wo := range snap.WorkOrders {
		if lineID != "" && wo.LineID != lineID {
			continue
		}
		row := ProductionReportRow{
			WorkOrderID: wo.ID, WoNumber: wo.WoNumber, ProductSKU: "N/A", ProductName: "N/A", LineID: wo.LineID, LineName: wo.LineID,
			TargetQuantity: wo.TargetQuantity, GoodQuantity: wo.GoodQuantity, RejectQuantity: wo.RejectQuantity,
			AchievementPct: roundPct(float64(wo.OutputQuantity), float64(wo.PlannedQuantity)),
			Variance:       wo.OutputQuantity - wo.PlannedQuantity, Status: wo.Status, PlannedStart: wo.PlannedStart,
			ActualStart: db.Deref(wo.ActualStart, "-"), ActualEnd: db.Deref(wo.ActualEnd, "-"),
		}
		if p := findProduct(ref, wo.ProductID); p != nil {
			row.ProductSKU, row.ProductName = p.SKU, p.Name
		}
		if l := findLine(ref, wo.LineID); l != nil {
			row.LineName = l.Name
		}
		out = append(out, row)
	}
	return out, nil
}

// DowntimeReport is one row per stoppage, optionally for one line.
func (s *Service) DowntimeReport(ctx context.Context, tenantID, lineID string, records []shopfloor.DowntimeRecord) ([]DowntimeReportRow, error) {
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := []DowntimeReportRow{}
	for _, r := range records {
		if lineID != "" && r.LineID != lineID {
			continue
		}
		row := DowntimeReportRow{
			ID: r.ID, ShiftDate: r.ShiftDate, ShiftID: r.ShiftID, LineID: r.LineID, LineName: r.LineID,
			MachineID: r.MachineID, MachineName: r.MachineID, ReasonCategory: "MACHINE", ReasonName: "Unspecified",
			IsPlanned: "Tidak (Unplanned)", StartTime: r.StartTime, EndTime: db.Deref(r.EndTime, "-"),
			Status: r.Status, Notes: db.Deref(r.Notes, "-"),
		}
		if r.IsPlanned {
			row.IsPlanned = "Ya (Planned)"
		}
		if r.DurationSeconds != nil && *r.DurationSeconds != 0 {
			row.DurationMinutes = jsnum.Round(float64(*r.DurationSeconds) / 60)
		}
		for _, rs := range ref.DowntimeReasons {
			if rs.ID == r.ReasonID {
				row.ReasonCategory, row.ReasonName = rs.Category, rs.Name
				break
			}
		}
		for _, m := range ref.Machines {
			if m.ID == r.MachineID {
				row.MachineName = m.Name
				break
			}
		}
		if l := findLine(ref, r.LineID); l != nil {
			row.LineName = l.Name
		}
		out = append(out, row)
	}
	return out, nil
}

// ShiftReport is one row per line for a shift date.
func (s *Service) ShiftReport(ctx context.Context, tenantID, shiftDate, shiftID string) ([]ShiftReportRow, error) {
	if shiftDate == "" {
		shiftDate = "2026-08-28"
	}
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	shifts, err := s.master.Shifts(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	shiftIDOut, shiftName := "-", "-"
	chosen := -1
	for i, sh := range shifts {
		if sh.ID == shiftID {
			chosen = i
			break
		}
	}
	if chosen < 0 {
		for i, sh := range shifts {
			if sh.Active {
				chosen = i
				break
			}
		}
	}
	if chosen < 0 && len(shifts) > 0 {
		chosen = 0
	}
	if chosen >= 0 {
		shiftIDOut, shiftName = shifts[chosen].ID, shifts[chosen].Name
	}
	out := []ShiftReportRow{}
	for _, line := range ref.Lines {
		var target, good, reject, count int
		for _, wo := range snap.WorkOrders {
			if wo.LineID != line.ID {
				continue
			}
			count++
			target += wo.PlannedQuantity
			good += wo.OutputQuantity
			reject += wo.RejectQuantity
		}
		downtime := 0.0
		for _, d := range snap.Downtimes {
			if d.ShiftDate == shiftDate && d.LineID == line.ID {
				downtime += jsnum.Round(float64(db.Deref(d.DurationSeconds, 0)) / 60)
			}
		}
		out = append(out, ShiftReportRow{
			LineID: line.ID, LineName: line.Name, ShiftID: shiftIDOut, ShiftName: shiftName, ShiftDate: shiftDate,
			TotalTarget: target, TotalGood: good, TotalReject: reject, TotalDowntimeMinutes: downtime,
			AchievementPct: roundPct(float64(good), float64(target)), ActiveWorkOrdersCount: count,
			Notes: "Operasional shift berjalan lancar sesuai rencana.",
		})
	}
	return out, nil
}

// CSV renders rows the way the Node exporter did: the property names as the
// header, every value quoted with inner quotes doubled, CRLF between rows,
// and an empty body for no rows.
func CSV(header []string, rows [][]string) string {
	if len(rows) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(strings.Join(header, ","))
	for _, row := range rows {
		b.WriteString("\r\n")
		for i, v := range row {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteByte('"')
			b.WriteString(strings.ReplaceAll(v, `"`, `""`))
			b.WriteByte('"')
		}
	}
	return b.String()
}

func fnum(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
func inum(i int) string     { return strconv.Itoa(i) }

var productionReportHeader = []string{"workOrderId", "woNumber", "productSku", "productName", "lineId", "lineName", "targetQuantity",
	"goodQuantity", "rejectQuantity", "achievementPct", "variance", "status", "plannedStart", "actualStart", "actualEnd"}

// ProductionReportCSV is the production report as CSV.
func ProductionReportCSV(rows []ProductionReportRow) string {
	out := make([][]string, len(rows))
	for i, r := range rows {
		out[i] = []string{r.WorkOrderID, r.WoNumber, r.ProductSKU, r.ProductName, r.LineID, r.LineName, inum(r.TargetQuantity),
			inum(r.GoodQuantity), inum(r.RejectQuantity), fnum(r.AchievementPct), inum(r.Variance), r.Status, r.PlannedStart, r.ActualStart, r.ActualEnd}
	}
	return CSV(productionReportHeader, out)
}

var downtimeReportHeader = []string{"id", "shiftDate", "shiftId", "lineId", "lineName", "machineId", "machineName", "reasonCategory",
	"reasonName", "isPlanned", "startTime", "endTime", "durationMinutes", "status", "notes"}

// DowntimeReportCSV is the downtime report as CSV.
func DowntimeReportCSV(rows []DowntimeReportRow) string {
	out := make([][]string, len(rows))
	for i, r := range rows {
		out[i] = []string{r.ID, r.ShiftDate, r.ShiftID, r.LineID, r.LineName, r.MachineID, r.MachineName, r.ReasonCategory,
			r.ReasonName, r.IsPlanned, r.StartTime, r.EndTime, fnum(r.DurationMinutes), r.Status, r.Notes}
	}
	return CSV(downtimeReportHeader, out)
}

var shiftReportHeader = []string{"lineId", "lineName", "shiftId", "shiftName", "shiftDate", "totalTarget", "totalGood", "totalReject",
	"totalDowntimeMinutes", "achievementPct", "activeWorkOrdersCount", "notes"}

// ShiftReportCSV is the shift report as CSV.
func ShiftReportCSV(rows []ShiftReportRow) string {
	out := make([][]string, len(rows))
	for i, r := range rows {
		out[i] = []string{r.LineID, r.LineName, r.ShiftID, r.ShiftName, r.ShiftDate, inum(r.TotalTarget), inum(r.TotalGood), inum(r.TotalReject),
			fnum(r.TotalDowntimeMinutes), fnum(r.AchievementPct), inum(r.ActiveWorkOrdersCount), r.Notes}
	}
	return CSV(shiftReportHeader, out)
}
