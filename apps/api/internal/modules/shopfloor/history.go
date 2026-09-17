package shopfloor

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/jsnum"
)

// The deterministic shop-floor back-catalogue behind the executive
// dashboard's trend and previous-period figures. Seeded per (date, line) with
// the same PRNG the Node API used (mulberry32 over an FNV-1a hash), so the
// history it writes is the history the screenshots were taken from, and a
// second run adds nothing: every row carries a stable id and client event id.

// mulberry32 is the JavaScript generator, bit for bit: uint32 arithmetic and
// Math.imul's wrapping multiply.
func mulberry32(seed uint32) func() float64 {
	a := seed
	return func() float64 {
		a += 0x6d2b79f5
		t := (a ^ (a >> 15)) * (1 | a)
		t = (t + (t^(t>>7))*(61|t)) ^ t
		return float64((t^(t>>14))>>0) / 4294967296
	}
}

// hashSeed is the FNV-1a variant the Node generator used on UTF-16 code
// units; the seed strings are ASCII, so bytes are code units.
func hashSeed(text string) uint32 {
	h := uint32(2166136261)
	for i := 0; i < len(text); i++ {
		h ^= uint32(text[i])
		h *= 16777619
	}
	return h
}

func between(rand func() float64, min, max float64) float64 { return min + rand()*(max-min) }

type profileShape struct {
	events        [2]float64
	downtimeScale float64
	performance   [2]float64
	reject        [2]float64
}

var profiles = map[string]profileShape{
	"GOOD":    {[2]float64{1, 3}, 0.85, [2]float64{0.88, 0.95}, [2]float64{0.004, 0.014}},
	"AVERAGE": {[2]float64{1, 4}, 1.0, [2]float64{0.84, 0.93}, [2]float64{0.012, 0.028}},
	"POOR":    {[2]float64{2, 5}, 1.35, [2]float64{0.74, 0.86}, [2]float64{0.026, 0.052}},
}

// HistoryLine is one executable work order the history is written against.
type HistoryLine struct {
	LineID            string
	ProcessID         *string
	BatchID           *string
	IsBatchManaged    bool
	MachineID         string
	WorkOrderID       string
	OperatorID        string
	Profile           string
	DailyTarget       int
	IdealCycleSeconds float64
}

// HistoryInput shapes a generation.
type HistoryInput struct {
	TenantID                 string
	AnchorDate               string
	Days                     int
	ShiftID                  string
	PlannedProductionMinutes int
	Lines                    []HistoryLine
	DowntimeReasonIDs        []string
	RejectReasonIDs          []string
}

// weightedIndex draws with a falling weight (≈40/25/18/12/rest), so the
// Pareto endpoints get a genuine "vital few" shape.
func weightedIndex(rand func() float64, length int) int {
	roll := rand()
	cutoffs := []float64{0.4, 0.65, 0.83, 0.95}
	for i := 0; i < length-1 && i < len(cutoffs); i++ {
		if roll < cutoffs[i] {
			return i
		}
	}
	return length - 1
}

// GenerateHistory produces the records, identical to the Node generator.
func GenerateHistory(in HistoryInput) ([]ProductionRecord, []DowntimeRecord) {
	var production []ProductionRecord
	var downtime []DowntimeRecord
	plannedSeconds := float64(in.PlannedProductionMinutes * 60)
	anchor, err := time.Parse("2006-01-02", in.AnchorDate)
	if err != nil {
		return nil, nil
	}
	for back := in.Days; back >= 1; back-- {
		day := anchor.AddDate(0, 0, -back)
		shiftDate := day.Format("2006-01-02")
		// Sunday is a non-production day for the pilot factory.
		if day.Weekday() == time.Sunday {
			continue
		}
		for _, line := range in.Lines {
			process := db.Deref(line.ProcessID, "")
			rand := mulberry32(hashSeed(shiftDate + ":" + line.LineID + ":" + process))
			profile, ok := profiles[line.Profile]
			if !ok {
				profile = profiles["AVERAGE"]
			}
			eventCount := int(math.Floor(between(rand, profile.events[0], profile.events[1])))
			dayDowntime := 0.0
			for e := 0; e < eventCount; e++ {
				reasonID := in.DowntimeReasonIDs[weightedIndex(rand, len(in.DowntimeReasonIDs))]
				isPlanned := strings.Contains(reasonID, "setup") || strings.Contains(reasonID, "cleaning")
				lo, hi := 480.0, 3000.0
				if isPlanned {
					lo, hi = 600, 2100
				}
				duration := jsnum.Round(between(rand, lo, hi) * profile.downtimeScale)
				startOffset := jsnum.Round(between(rand, 900, plannedSeconds-duration-900))
				start := time.Date(day.Year(), day.Month(), day.Day(), 7, 0, 0, 0, time.UTC).Add(time.Duration(startOffset) * time.Second)
				end := start.Add(time.Duration(duration) * time.Second)
				dayDowntime += duration
				suffix := fmt.Sprintf("%s-%s-%d", shiftDate, line.LineID, e+1)
				durationSeconds := int(duration)
				downtime = append(downtime, DowntimeRecord{ID: "dt-hist-" + suffix, TenantID: in.TenantID, WorkOrderID: db.Ptr(line.WorkOrderID), ProcessID: line.ProcessID, MachineID: line.MachineID,
					LineID: line.LineID, ShiftID: in.ShiftID, ShiftDate: shiftDate, ReasonID: reasonID, StartTime: db.ISO(start), EndTime: db.Ptr(db.ISO(end)), DurationSeconds: &durationSeconds,
					IsPlanned: isPlanned, Notes: db.Ptr("Catatan downtime historis"), ClientEventID: "evt-dt-hist-" + suffix, Status: "RESOLVED"})
			}
			runSeconds := math.Max(1, plannedSeconds-dayDowntime)
			capacity := runSeconds / line.IdealCycleSeconds
			performance := between(rand, profile.performance[0], profile.performance[1])
			total := math.Max(1, jsnum.Round(math.Min(capacity*performance, float64(line.DailyTarget)*1.02)))
			rejectRate := between(rand, profile.reject[0], profile.reject[1])
			reject := jsnum.Round(total * rejectRate)
			good := math.Max(0, total-reject)
			processKey := process
			if processKey == "" {
				processKey = "main"
			}
			suffix := shiftDate + "-" + line.LineID + "-" + processKey
			var rejectReason *string
			if reject > 0 {
				rejectReason = db.Ptr(in.RejectReasonIDs[weightedIndex(rand, len(in.RejectReasonIDs))])
			}
			production = append(production, ProductionRecord{ID: "pr-hist-" + suffix, TenantID: in.TenantID, WorkOrderID: line.WorkOrderID, ProcessID: line.ProcessID, BatchID: line.BatchID,
				IsBatchManaged: line.IsBatchManaged, MachineID: line.MachineID, OperatorID: line.OperatorID, ShiftID: in.ShiftID, ShiftDate: shiftDate, GoodQuantity: int(good), RejectQuantity: int(reject),
				RejectReasonID: rejectReason, RecordedAt: shiftDate + "T15:00:00.000Z", Source: "OPERATOR_MANUAL", ClientEventID: "evt-pr-hist-" + suffix, Notes: db.Ptr("Total output shift historis"),
				InputQuantity: int(good + reject)})
		}
	}
	return production, downtime
}

// SeedHistory writes the generated records in bulk: COPY into temporary
// tables, then INSERT … ON CONFLICT DO NOTHING in generation order, so a
// second run adds nothing, a row the shop floor has since corrected is never
// touched, and where two work orders on one line generate the same downtime
// id the first one wins, as it did when the rows were inserted one by one.
func (s *Service) SeedHistory(ctx context.Context, in HistoryInput) (productionCount, downtimeCount int, err error) {
	production, downtime := GenerateHistory(in)
	err = s.pool.WithTenant(ctx, in.TenantID, func(tx pgx.Tx) error {
		for _, t := range [][2]string{{"seed_production_record", "production_record"}, {"seed_downtime_record", "downtime_record"}} {
			if _, err := tx.Exec(ctx, `CREATE TEMP TABLE `+t[0]+` (LIKE `+t[1]+` INCLUDING DEFAULTS) ON COMMIT DROP`); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `ALTER TABLE `+t[0]+` ADD COLUMN seed_seq integer`); err != nil {
				return err
			}
		}
		prodRows := make([][]any, len(production))
		for i, r := range production {
			shiftDate, _ := time.Parse("2006-01-02", r.ShiftDate)
			recorded, _ := db.ParseISO(r.RecordedAt)
			prodRows[i] = []any{i, r.ID, r.TenantID, r.WorkOrderID, r.ProcessID, r.BatchID, r.MachineID, r.OperatorID, r.ShiftID, shiftDate, r.GoodQuantity, r.RejectQuantity, r.RejectReasonID,
				recorded, r.Source, r.ClientEventID, r.Notes, r.InputQuantity, r.ScrapQuantity, r.ReworkQuantity, r.IsBatchManaged, r.HasChildWorkOrder}
		}
		prodCols := []string{"id", "tenant_id", "work_order_id", "process_id", "batch_id", "machine_id", "operator_id", "shift_id", "shift_date", "good_quantity", "reject_quantity", "reject_reason_id",
			"recorded_at", "source", "client_event_id", "notes", "input_quantity", "scrap_quantity", "rework_quantity", "is_batch_managed", "has_child_work_order"}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"seed_production_record"}, append([]string{"seed_seq"}, prodCols...), pgx.CopyFromRows(prodRows)); err != nil {
			return fmt.Errorf("copy production history: %w", err)
		}
		dtRows := make([][]any, len(downtime))
		for i, d := range downtime {
			shiftDate, _ := time.Parse("2006-01-02", d.ShiftDate)
			start, _ := db.ParseISO(d.StartTime)
			var end *time.Time
			if d.EndTime != nil {
				if t, err := db.ParseISO(*d.EndTime); err == nil {
					end = &t
				}
			}
			dtRows[i] = []any{i, d.ID, d.TenantID, d.WorkOrderID, d.ProcessID, d.MachineID, d.LineID, d.OperatorID, d.ShiftID, shiftDate, d.ReasonID, start, end, d.DurationSeconds, d.IsPlanned, d.Notes, d.ClientEventID, d.Status}
		}
		dtCols := []string{"id", "tenant_id", "work_order_id", "process_id", "machine_id", "line_id", "operator_id", "shift_id", "shift_date", "reason_id", "start_time", "end_time", "duration_seconds", "is_planned", "notes", "client_event_id", "status"}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"seed_downtime_record"}, append([]string{"seed_seq"}, dtCols...), pgx.CopyFromRows(dtRows)); err != nil {
			return fmt.Errorf("copy downtime history: %w", err)
		}
		tag, err := tx.Exec(ctx, `INSERT INTO production_record (`+strings.Join(prodCols, ", ")+`) SELECT `+strings.Join(prodCols, ", ")+` FROM seed_production_record ORDER BY seed_seq ON CONFLICT DO NOTHING`)
		if err != nil {
			return err
		}
		productionCount = int(tag.RowsAffected())
		tag, err = tx.Exec(ctx, `INSERT INTO downtime_record (`+strings.Join(dtCols, ", ")+`) SELECT `+strings.Join(dtCols, ", ")+` FROM seed_downtime_record ORDER BY seed_seq ON CONFLICT DO NOTHING`)
		if err != nil {
			return err
		}
		downtimeCount = int(tag.RowsAffected())
		return nil
	})
	if err == nil && (productionCount > 0 || downtimeCount > 0) {
		s.production.Changed(in.TenantID)
	}
	return productionCount, downtimeCount, err
}
