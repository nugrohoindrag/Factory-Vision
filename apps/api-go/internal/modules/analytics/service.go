package analytics

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/execution"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/cache"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

const defaultWindowDays = 30

// lineDay is one line's aggregate for one shift date, the single grain
// every Executive Dashboard endpoint rolls up from.
type lineDay struct {
	shiftDate                string
	lineID                   string
	plannedSeconds           float64
	downtimeSeconds          float64
	plannedDowntimeSeconds   float64
	unplannedDowntimeSeconds float64
	runSeconds               float64
	goodQuantity             float64
	rejectQuantity           float64
	targetQuantity           float64
	idealCycleSeconds        float64
	machineIDs               map[string]bool
	idealSecondsAccum        float64
}

// ExtraAlerts is the improvement's exception layer (M4), merged into the
// same feed.
type ExtraAlerts interface {
	Alerts(ctx context.Context, tenantID string) ([]OperationalAlert, error)
}

// Service is the analytics read model.
type Service struct {
	master     *masterdata.Service
	production *production.Service
	source     *execution.ReadModel
	// grain is every line-day for a tenant, all dates; each call trims it
	// to its own window.
	grain *cache.Tenant[[]lineDay]
	extra ExtraAlerts
	now   func() time.Time
}

// NewService wires the read model.
func NewService(master *masterdata.Service, prod *production.Service, source *execution.ReadModel) (*Service, error) {
	grain, err := cache.New[[]lineDay]("analytics_grain", cache.Options{MaxEntries: 256, TTL: 10 * time.Second})
	if err != nil {
		return nil, err
	}
	s := &Service{master: master, production: prod, source: source, grain: grain, now: time.Now}
	prod.OnChange(s.Invalidate)
	return s, nil
}

// AttachExtraAlerts connects the improvement's alert rules.
func (s *Service) AttachExtraAlerts(e ExtraAlerts) { s.extra = e }

// Invalidate drops a tenant's grain after a change.
func (s *Service) Invalidate(tenantID string) { s.grain.Invalidate(tenantID) }

// CalculateOee is the v1.7 formula: ratios clamped to [0, 1], 4 decimals.
func CalculateOee(plannedSeconds, runSeconds, goodCount, rejectCount, idealCycleSeconds float64) OEEComponents {
	totalCount := goodCount + rejectCount
	availability := 0.0
	if plannedSeconds > 0 {
		availability = jsnum.Clamp01(runSeconds / plannedSeconds)
	}
	performance := 0.0
	if runSeconds > 0 && totalCount > 0 {
		performance = jsnum.Clamp01((idealCycleSeconds * totalCount) / runSeconds)
	}
	quality := 1.0
	if totalCount > 0 {
		quality = jsnum.Clamp01(goodCount / totalCount)
	}
	return OEEComponents{
		Availability: jsnum.Round4(availability), Performance: jsnum.Round4(performance),
		Quality: jsnum.Round4(quality), Oee: jsnum.Round4(availability * performance * quality),
	}
}

func pct(v float64) float64 { return jsnum.Round1(v * 100) }

func roundPct(num, den float64) float64 {
	if den > 0 {
		return jsnum.Round((num / den) * 100)
	}
	return 0
}

func fixedPct(num, den float64, digits int) float64 {
	if den > 0 {
		return jsnum.ToFixed((num/den)*100, digits)
	}
	return 0
}

// --- Live board (US-026) ---------------------------------------------------

// LiveProductionBoard is one row per work order with the line's OEE for
// the latest shift date in the data.
func (s *Service) LiveProductionBoard(ctx context.Context, tenantID string) ([]LiveBoardRow, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	latest := ""
	for _, d := range snap.Downtimes {
		if d.ShiftDate > latest {
			latest = d.ShiftDate
		}
	}
	downtimeByLine := map[string]float64{}
	for _, d := range snap.Downtimes {
		if latest != "" && d.ShiftDate != latest {
			continue
		}
		downtimeByLine[d.LineID] += float64(db.Deref(d.DurationSeconds, 0))
	}
	out := make([]LiveBoardRow, 0, len(snap.WorkOrders))
	for _, wo := range snap.WorkOrders {
		line := findLine(ref, wo.LineID)
		product := findProduct(ref, wo.ProductID)
		plannedMinutes := 480
		if line != nil {
			plannedMinutes = line.PlannedProductionTimeMinutes
		}
		plannedSec := float64(plannedMinutes * 60)
		runSec := math.Max(0, plannedSec-downtimeByLine[wo.LineID])
		idealCycle := 12.0
		if product != nil {
			idealCycle = product.IdealCycleTimeSeconds
		}
		comp := CalculateOee(plannedSec, runSec, float64(wo.OutputQuantity), float64(wo.RejectQuantity), idealCycle)
		hasActive := false
		for _, d := range snap.ActiveDowntimes {
			if (d.WorkOrderID != nil && *d.WorkOrderID == wo.ID) || d.LineID == wo.LineID {
				hasActive = true
				break
			}
		}
		out = append(out, LiveBoardRow{
			LineID: wo.LineID, WorkOrder: wo,
			AchievementPct:    roundPct(float64(wo.OutputQuantity), float64(wo.PlannedQuantity)),
			HasActiveDowntime: hasActive,
			Oee:               jsnum.Round(comp.Oee * 100), Availability: jsnum.Round(comp.Availability * 100),
			Performance: jsnum.Round(comp.Performance * 100), Quality: jsnum.Round(comp.Quality * 100),
		})
	}
	return out, nil
}

// --- Downtime Pareto (US-028) --------------------------------------------

// DowntimePareto ranks reasons by duration, all history, optionally per line.
func (s *Service) DowntimePareto(ctx context.Context, tenantID, lineID string) ([]DowntimeParetoItem, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	reasons, err := s.master.DowntimeReasons(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	type acc struct {
		duration float64
		count    int
		reason   masterdata.DowntimeReason
	}
	groups := map[string]*acc{}
	var order []string
	for _, r := range snap.Downtimes {
		if lineID != "" && r.LineID != lineID {
			continue
		}
		g, ok := groups[r.ReasonID]
		if !ok {
			reason := masterdata.DowntimeReason{ID: r.ReasonID, Code: "OTHER", Name: "Uncategorized Reason", Category: "MACHINE"}
			for _, rs := range reasons {
				if rs.ID == r.ReasonID {
					reason = rs
					break
				}
			}
			g = &acc{reason: reason}
			groups[r.ReasonID] = g
			order = append(order, r.ReasonID)
		}
		g.duration += float64(db.Deref(r.DurationSeconds, 0))
		g.count++
	}
	total := 0.0
	for _, g := range groups {
		total += g.duration
	}
	if total == 0 {
		total = 1
	}
	out := make([]DowntimeParetoItem, 0, len(order))
	for _, id := range order {
		g := groups[id]
		out = append(out, DowntimeParetoItem{
			ReasonID: id, ReasonCode: g.reason.Code, ReasonName: g.reason.Name, Category: g.reason.Category,
			TotalDurationSeconds: g.duration, TotalDurationMinutes: jsnum.Round(g.duration / 60), OccurrenceCount: g.count,
			PercentageOfTotal: jsnum.Round1((g.duration / total) * 100),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TotalDurationSeconds > out[j].TotalDurationSeconds })
	cumulative := 0.0
	for i := range out {
		cumulative += out[i].PercentageOfTotal
		out[i].CumulativePercentage = jsnum.Round1(math.Min(100, cumulative))
	}
	return out, nil
}

// --- The grain -------------------------------------------------------------

func (s *Service) allLineDays(ctx context.Context, tenantID string) ([]lineDay, error) {
	return s.grain.Get(ctx, tenantID, func(ctx context.Context) ([]lineDay, error) {
		return s.buildGrain(ctx, tenantID)
	})
}

// buildGrain aggregates production and downtime records into one row per
// (shift date, line). Planned production time counts a line on a day only
// if that line recorded something that day; the daily target is the sum of
// the targets of the work orders assigned to the line.
func (s *Service) buildGrain(ctx context.Context, tenantID string) ([]lineDay, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	lineByID := map[string]masterdata.Line{}
	for _, l := range ref.Lines {
		lineByID[l.ID] = l
	}
	targetByLine := map[string]float64{}
	for _, wo := range snap.WorkOrders {
		targetByLine[wo.LineID] += float64(wo.PlannedQuantity)
	}
	idealCycleFor := func(workOrderID string, machineID string) float64 {
		wo, ok := snap.WorkOrder(workOrderID)
		productID, woMachine := "", ""
		if ok {
			productID = wo.ProductID
			woMachine = db.Deref(wo.MachineID, "")
		}
		if machineID == "" {
			machineID = woMachine
		}
		if resolved := ref.IdealCycleSeconds(productID, machineID, "PRODUCT_MACHINE"); resolved != nil && *resolved != 0 {
			return *resolved
		}
		if p := findProduct(ref, productID); p != nil {
			return p.IdealCycleTimeSeconds
		}
		return 12
	}

	buckets := map[string]*lineDay{}
	var order []*lineDay
	bucketFor := func(shiftDate, lineID string) *lineDay {
		if _, ok := lineByID[lineID]; !ok {
			return nil
		}
		key := shiftDate + "|" + lineID
		b, ok := buckets[key]
		if !ok {
			b = &lineDay{shiftDate: shiftDate, lineID: lineID, targetQuantity: targetByLine[lineID], machineIDs: map[string]bool{}}
			buckets[key] = b
			order = append(order, b)
		}
		return b
	}

	for _, r := range snap.Records {
		wo, ok := snap.WorkOrder(r.WorkOrderID)
		if !ok {
			continue
		}
		b := bucketFor(r.ShiftDate, wo.LineID)
		if b == nil {
			continue
		}
		b.goodQuantity += float64(r.GoodQuantity)
		b.rejectQuantity += float64(r.RejectQuantity)
		machineID := r.MachineID
		if machineID == "" {
			machineID = db.Deref(wo.MachineID, "")
		}
		if machineID != "" {
			b.machineIDs[machineID] = true
		}
		b.idealSecondsAccum += idealCycleFor(r.WorkOrderID, machineID) * float64(r.GoodQuantity+r.RejectQuantity)
	}
	for _, d := range snap.Downtimes {
		b := bucketFor(d.ShiftDate, d.LineID)
		if b == nil {
			continue
		}
		seconds := float64(db.Deref(d.DurationSeconds, 0))
		b.downtimeSeconds += seconds
		if d.IsPlanned {
			b.plannedDowntimeSeconds += seconds
		} else {
			b.unplannedDowntimeSeconds += seconds
		}
		if d.MachineID != "" {
			b.machineIDs[d.MachineID] = true
		}
	}
	out := make([]lineDay, 0, len(order))
	for _, b := range order {
		perMachine := float64(lineByID[b.lineID].PlannedProductionTimeMinutes * 60)
		machines := float64(len(b.machineIDs))
		if machines < 1 {
			machines = 1
		}
		b.plannedSeconds = machines * perMachine
		if units := b.goodQuantity + b.rejectQuantity; units > 0 {
			b.idealCycleSeconds = b.idealSecondsAccum / units
		}
		b.runSeconds = math.Max(0, b.plannedSeconds-b.downtimeSeconds)
		out = append(out, *b)
	}
	return out, nil
}

// lineDays is the grain trimmed to the most recent `days` shift dates.
func (s *Service) lineDays(ctx context.Context, tenantID string, days int) ([]lineDay, error) {
	all, err := s.allLineDays(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var dates []string
	for _, b := range all {
		if !seen[b.shiftDate] {
			seen[b.shiftDate] = true
			dates = append(dates, b.shiftDate)
		}
	}
	sort.Strings(dates)
	if days < 0 {
		days = 0
	}
	if days < len(dates) {
		dates = dates[len(dates)-days:]
	}
	kept := map[string]bool{}
	for _, d := range dates {
		kept[d] = true
	}
	out := make([]lineDay, 0, len(all))
	for _, b := range all {
		if kept[b.shiftDate] {
			out = append(out, b)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].shiftDate < out[j].shiftDate })
	return out, nil
}

type rolled struct {
	OEEComponents
	totalCount float64
}

// rollUpOee weights by run time; ideal time is summed per line because
// lines run different products.
func rollUpOee(rows []lineDay) rolled {
	var planned, run, good, reject, ideal float64
	for _, r := range rows {
		planned += r.plannedSeconds
		run += r.runSeconds
		good += r.goodQuantity
		reject += r.rejectQuantity
		ideal += r.idealCycleSeconds * (r.goodQuantity + r.rejectQuantity)
	}
	total := good + reject
	availability, performance, quality := 0.0, 0.0, 1.0
	if planned > 0 {
		availability = math.Min(1, run/planned)
	}
	if run > 0 {
		performance = math.Min(1, ideal/run)
	}
	if total > 0 {
		quality = math.Min(1, good/total)
	}
	return rolled{OEEComponents{
		Availability: jsnum.Round4(availability), Performance: jsnum.Round4(performance),
		Quality: jsnum.Round4(quality), Oee: jsnum.Round4(availability * performance * quality),
	}, total}
}

func sum(rows []lineDay, pick func(lineDay) float64) float64 {
	t := 0.0
	for _, r := range rows {
		t += pick(r)
	}
	return t
}

// DailyPerformance is the daily series every trend reads.
func (s *Service) DailyPerformance(ctx context.Context, tenantID string, days int) ([]DailyPerformancePoint, error) {
	rows, err := s.lineDays(ctx, tenantID, days)
	if err != nil {
		return nil, err
	}
	byDate := map[string][]lineDay{}
	var dates []string
	for _, r := range rows {
		if _, ok := byDate[r.shiftDate]; !ok {
			dates = append(dates, r.shiftDate)
		}
		byDate[r.shiftDate] = append(byDate[r.shiftDate], r)
	}
	sort.Strings(dates)
	out := make([]DailyPerformancePoint, 0, len(dates))
	for _, date := range dates {
		dayRows := byDate[date]
		oee := rollUpOee(dayRows)
		good := sum(dayRows, func(r lineDay) float64 { return r.goodQuantity })
		reject := sum(dayRows, func(r lineDay) float64 { return r.rejectQuantity })
		target := sum(dayRows, func(r lineDay) float64 { return r.targetQuantity })
		out = append(out, DailyPerformancePoint{
			ShiftDate: date, TargetQuantity: target, GoodQuantity: good, RejectQuantity: reject,
			AchievementPct: roundPct(good, target), RejectRatePct: fixedPct(reject, good+reject, 2),
			PlannedMinutes:           jsnum.Round(sum(dayRows, func(r lineDay) float64 { return r.plannedSeconds }) / 60),
			DowntimeMinutes:          jsnum.Round(sum(dayRows, func(r lineDay) float64 { return r.downtimeSeconds }) / 60),
			PlannedDowntimeMinutes:   jsnum.Round(sum(dayRows, func(r lineDay) float64 { return r.plannedDowntimeSeconds }) / 60),
			UnplannedDowntimeMinutes: jsnum.Round(sum(dayRows, func(r lineDay) float64 { return r.unplannedDowntimeSeconds }) / 60),
			Availability:             pct(oee.Availability), Performance: pct(oee.Performance), Quality: pct(oee.Quality), Oee: pct(oee.Oee),
		})
	}
	return out, nil
}

type windowSummary struct {
	oee, availability, performance, quality, output, achievement, rejectRate, downtime float64
}

func summarise(window []DailyPerformancePoint) windowSummary {
	if len(window) == 0 {
		return windowSummary{}
	}
	var good, reject, target, downtime float64
	mean := func(pick func(DailyPerformancePoint) float64) float64 {
		t := 0.0
		for _, d := range window {
			t += pick(d)
		}
		return jsnum.Round1(t / float64(len(window)))
	}
	for _, d := range window {
		good += d.GoodQuantity
		reject += d.RejectQuantity
		target += d.TargetQuantity
		downtime += d.DowntimeMinutes
	}
	return windowSummary{
		oee:          mean(func(d DailyPerformancePoint) float64 { return d.Oee }),
		availability: mean(func(d DailyPerformancePoint) float64 { return d.Availability }),
		performance:  mean(func(d DailyPerformancePoint) float64 { return d.Performance }),
		quality:      mean(func(d DailyPerformancePoint) float64 { return d.Quality }),
		output:       good,
		achievement:  fixedPct(good, target, 1),
		rejectRate:   fixedPct(reject, good+reject, 2),
		downtime:     jsnum.Round(downtime / float64(len(window))),
	}
}

func lastN[T any](list []T, n int) []T {
	if n > len(list) {
		n = len(list)
	}
	if n < 0 {
		n = 0
	}
	return list[len(list)-n:]
}

// previousWindow is series.slice(-days*2, -days).
func previousWindow[T any](list []T, days int) []T {
	start := len(list) - days*2
	if start < 0 {
		start = 0
	}
	end := len(list) - days
	if end < start {
		end = start
	}
	return list[start:end]
}

// ExecutiveKpi is the eight cards (US-024) against the preceding window of
// the same length.
func (s *Service) ExecutiveKpi(ctx context.Context, tenantID string, days int) ([]ExecutiveKpi, error) {
	series, err := s.DailyPerformance(ctx, tenantID, days*2)
	if err != nil {
		return nil, err
	}
	now := summarise(lastN(series, days))
	before := summarise(previousWindow(series, days))
	targets, err := s.master.KpiTargets(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	build := func(metric, label, unit string, value, previous float64, fallbackDirection string) ExecutiveKpi {
		var target *masterdata.KpiTarget
		for i := range targets {
			if targets[i].Metric == metric {
				target = &targets[i]
				break
			}
		}
		direction := fallbackDirection
		if target != nil {
			direction = target.Direction
		}
		delta := jsnum.ToFixed(value-previous, 2)
		deltaPct := 0.0
		if previous != 0 {
			deltaPct = jsnum.Round1((delta / math.Abs(previous)) * 100)
		}
		trend := "FLAT"
		if delta > 0 {
			trend = "UP"
		} else if delta < 0 {
			trend = "DOWN"
		}
		favourable := true
		if delta != 0 {
			if direction == "HIGHER_IS_BETTER" {
				favourable = delta > 0
			} else {
				favourable = delta < 0
			}
		}
		kpi := ExecutiveKpi{
			Metric: metric, Label: label, Value: value, Unit: unit, Direction: direction, PreviousValue: previous,
			DeltaVsPrevious: delta, DeltaPct: deltaPct, Trend: trend, TrendIsFavourable: favourable,
		}
		if target != nil {
			attainment := 0.0
			if direction == "HIGHER_IS_BETTER" {
				if target.TargetValue > 0 {
					attainment = (value / target.TargetValue) * 100
				}
			} else if value > 0 {
				attainment = (target.TargetValue / value) * 100
			} else {
				attainment = 100
			}
			kpi.Target = db.Ptr(target.TargetValue)
			kpi.Variance = db.Ptr(jsnum.ToFixed(value-target.TargetValue, 2))
			kpi.AttainmentPct = db.Ptr(jsnum.Round1(attainment))
			status := "GOOD"
			if attainment <= target.CriticalThresholdPct {
				status = "CRITICAL"
			} else if attainment <= target.WatchThresholdPct {
				status = "WATCH"
			}
			kpi.Status = &status
		}
		return kpi
	}
	return []ExecutiveKpi{
		build("OEE", "OEE", "%", now.oee, before.oee, "HIGHER_IS_BETTER"),
		build("AVAILABILITY", "Availability", "%", now.availability, before.availability, "HIGHER_IS_BETTER"),
		build("PERFORMANCE", "Performance", "%", now.performance, before.performance, "HIGHER_IS_BETTER"),
		build("QUALITY", "Quality", "%", now.quality, before.quality, "HIGHER_IS_BETTER"),
		build("PRODUCTION_OUTPUT", "Production Output", "pcs", now.output, before.output, "HIGHER_IS_BETTER"),
		build("PRODUCTION_ACHIEVEMENT", "Production Achievement", "%", now.achievement, before.achievement, "HIGHER_IS_BETTER"),
		build("REJECT_RATE", "Reject Rate", "%", now.rejectRate, before.rejectRate, "LOWER_IS_BETTER"),
		build("DOWNTIME", "Downtime", "min", now.downtime, before.downtime, "LOWER_IS_BETTER"),
	}, nil
}

// ProductionTrend is target vs actual over time with the preceding window.
func (s *Service) ProductionTrend(ctx context.Context, tenantID string, days int) ([]ProductionTrendPoint, error) {
	series, err := s.DailyPerformance(ctx, tenantID, days*2)
	if err != nil {
		return nil, err
	}
	current, previous := lastN(series, days), previousWindow(series, days)
	out := make([]ProductionTrendPoint, 0, len(current))
	for i, p := range current {
		point := ProductionTrendPoint{ShiftDate: p.ShiftDate, TargetQuantity: p.TargetQuantity, GoodQuantity: p.GoodQuantity, AchievementPct: p.AchievementPct}
		if i < len(previous) {
			point.PreviousPeriodGoodQuantity = db.Ptr(previous[i].GoodQuantity)
		}
		out = append(out, point)
	}
	return out, nil
}

// OeeTrend is OEE actual vs target vs previous period.
func (s *Service) OeeTrend(ctx context.Context, tenantID string, days int) ([]OeeTrendPoint, error) {
	series, err := s.DailyPerformance(ctx, tenantID, days*2)
	if err != nil {
		return nil, err
	}
	target, err := s.master.KpiTarget(ctx, tenantID, "OEE")
	if err != nil {
		return nil, err
	}
	current, previous := lastN(series, days), previousWindow(series, days)
	out := make([]OeeTrendPoint, 0, len(current))
	for i, p := range current {
		point := OeeTrendPoint{ShiftDate: p.ShiftDate, Oee: p.Oee, Availability: p.Availability, Performance: p.Performance, Quality: p.Quality}
		if target != nil {
			point.TargetOee = db.Ptr(target.TargetValue)
		}
		if i < len(previous) {
			point.PreviousPeriodOee = db.Ptr(previous[i].Oee)
		}
		out = append(out, point)
	}
	return out, nil
}

// classify is the v1.7 Good/Watch/Critical against the OEE and achievement
// targets (defaults 80 and 100; thresholds at 85 and 95).
func (s *Service) classify(ctx context.Context, tenantID string, oeePct, achievementPct float64) string {
	oeeTarget, achievementTarget := 80.0, 100.0
	if t, err := s.master.KpiTarget(ctx, tenantID, "OEE"); err == nil && t != nil {
		oeeTarget = t.TargetValue
	}
	if t, err := s.master.KpiTarget(ctx, tenantID, "PRODUCTION_ACHIEVEMENT"); err == nil && t != nil {
		achievementTarget = t.TargetValue
	}
	oeeAttainment, achievementAttainment := 100.0, 100.0
	if oeeTarget > 0 {
		oeeAttainment = (oeePct / oeeTarget) * 100
	}
	if achievementTarget > 0 {
		achievementAttainment = (achievementPct / achievementTarget) * 100
	}
	worst := math.Min(oeeAttainment, achievementAttainment)
	switch {
	case worst <= 85:
		return "CRITICAL"
	case worst <= 95:
		return "WATCH"
	}
	return "GOOD"
}

// LinePerformance is the per-line table, worst OEE first.
func (s *Service) LinePerformance(ctx context.Context, tenantID string, days int) ([]LinePerformanceRow, error) {
	rows, err := s.lineDays(ctx, tenantID, days)
	if err != nil {
		return nil, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	byLine := map[string][]lineDay{}
	for _, r := range rows {
		byLine[r.lineID] = append(byLine[r.lineID], r)
	}
	out := []LinePerformanceRow{}
	for _, line := range ref.Lines {
		if line.Status != "ACTIVE" {
			continue
		}
		lineRows := byLine[line.ID]
		oee := rollUpOee(lineRows)
		plantName := line.PlantID
		for _, p := range ref.Plants {
			if p.ID == line.PlantID {
				plantName = p.Name
				break
			}
		}
		good := sum(lineRows, func(r lineDay) float64 { return r.goodQuantity })
		reject := sum(lineRows, func(r lineDay) float64 { return r.rejectQuantity })
		target := sum(lineRows, func(r lineDay) float64 { return r.targetQuantity })
		achievement := roundPct(good, target)
		oeePct := pct(oee.Oee)
		hasActive := false
		for _, d := range snap.ActiveDowntimes {
			if d.LineID == line.ID {
				hasActive = true
				break
			}
		}
		out = append(out, LinePerformanceRow{
			LineID: line.ID, LineName: line.Name, PlantID: line.PlantID, PlantName: plantName,
			Oee: oeePct, Availability: pct(oee.Availability), Performance: pct(oee.Performance), Quality: pct(oee.Quality),
			GoodQuantity: good, TargetQuantity: target, AchievementPct: achievement,
			DowntimeMinutes: jsnum.Round(sum(lineRows, func(r lineDay) float64 { return r.downtimeSeconds }) / 60),
			RejectQuantity:  reject, RejectRatePct: fixedPct(reject, good+reject, 2), HasActiveDowntime: hasActive,
			Status: s.classify(ctx, tenantID, oeePct, achievement),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Oee < out[j].Oee })
	return out, nil
}

// PlantPerformance rolls the line table up per plant, output-weighted.
func (s *Service) PlantPerformance(ctx context.Context, tenantID string, days int) ([]PlantPerformanceRow, error) {
	lineRows, err := s.LinePerformance(ctx, tenantID, days)
	if err != nil {
		return nil, err
	}
	byPlant := map[string][]LinePerformanceRow{}
	var plants []string
	for _, r := range lineRows {
		if _, ok := byPlant[r.PlantID]; !ok {
			plants = append(plants, r.PlantID)
		}
		byPlant[r.PlantID] = append(byPlant[r.PlantID], r)
	}
	out := []PlantPerformanceRow{}
	for _, plantID := range plants {
		rows := byPlant[plantID]
		var good, reject, target, downtime, weighted, weights float64
		for _, r := range rows {
			good += r.GoodQuantity
			reject += r.RejectQuantity
			target += r.TargetQuantity
			downtime += r.DowntimeMinutes
			w := r.GoodQuantity
			if w == 0 {
				w = 1
			}
			weighted += r.Oee * w
			weights += w
		}
		weightBase := good
		if weightBase == 0 {
			weightBase = float64(len(rows))
		}
		den := weights
		if den == 0 {
			den = weightBase
		}
		oee := jsnum.Round1(weighted / den)
		achievement := roundPct(good, target)
		out = append(out, PlantPerformanceRow{
			PlantID: plantID, PlantName: rows[0].PlantName, LineCount: len(rows), Oee: oee,
			GoodQuantity: good, TargetQuantity: target, AchievementPct: achievement, DowntimeMinutes: downtime,
			RejectQuantity: reject, RejectRatePct: fixedPct(reject, good+reject, 2),
			Status: s.classify(ctx, tenantID, oee, achievement),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Oee < out[j].Oee })
	return out, nil
}

// ProcessPerformance is the multi-process breakdown, in routing order.
func (s *Service) ProcessPerformance(ctx context.Context, tenantID string, days int) ([]ProcessPerformanceRow, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	processes, err := s.master.Processes(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	dates := snap.ShiftDates()
	if days < 0 {
		days = 0
	}
	if days < len(dates) {
		dates = dates[len(dates)-days:]
	}
	kept := map[string]bool{}
	for _, d := range dates {
		kept[d] = true
	}
	processOf := func(workOrderID string) string {
		if wo, ok := snap.WorkOrder(workOrderID); ok && wo.ProcessID != nil {
			return *wo.ProcessID
		}
		return ""
	}
	out := []ProcessPerformanceRow{}
	for _, proc := range processes {
		var good, reject, downtimeSeconds float64
		uniqueDates := map[string]bool{}
		for _, r := range snap.Records {
			if !kept[r.ShiftDate] {
				continue
			}
			if (r.ProcessID != nil && *r.ProcessID == proc.ID) || (r.ProcessID == nil && processOf(r.WorkOrderID) == proc.ID) {
				good += float64(r.GoodQuantity)
				reject += float64(r.RejectQuantity)
				uniqueDates[r.ShiftDate] = true
			}
		}
		for _, d := range snap.Downtimes {
			if !kept[d.ShiftDate] {
				continue
			}
			if (d.ProcessID != nil && *d.ProcessID == proc.ID) || (d.ProcessID == nil && processOf(db.Deref(d.WorkOrderID, "")) == proc.ID) {
				downtimeSeconds += float64(db.Deref(d.DurationSeconds, 0))
				uniqueDates[d.ShiftDate] = true
			}
		}
		target := 0.0
		for _, wo := range snap.WorkOrders {
			if wo.ProcessID != nil && *wo.ProcessID == proc.ID {
				target += float64(wo.PlannedQuantity)
			}
		}
		if target == 0 {
			if good > 0 {
				target = jsnum.Round(good * 1.08)
			} else {
				target = 1000
			}
		}
		achievement := roundPct(good, target)
		daysCount := float64(len(uniqueDates))
		if daysCount < 1 {
			daysCount = 1
		}
		plannedSeconds := daysCount * 480 * 60
		runSeconds := math.Max(0, plannedSeconds-downtimeSeconds)
		idealCycle := 30.0
		switch proc.Code {
		case "MIX":
			idealCycle = 90
		case "EXT":
			idealCycle = 45
		case "TBM":
			idealCycle = 150
		case "CPR":
			idealCycle = 750
		}
		comp := CalculateOee(plannedSeconds, runSeconds, good, reject, idealCycle)
		oeePct := pct(comp.Oee)
		out = append(out, ProcessPerformanceRow{
			ProcessID: proc.ID, ProcessCode: proc.Code, ProcessName: proc.Name, SequenceDefault: proc.SequenceDefault,
			Oee: oeePct, Availability: pct(comp.Availability), Performance: pct(comp.Performance), Quality: pct(comp.Quality),
			GoodQuantity: good, RejectQuantity: reject, TargetQuantity: target, AchievementPct: achievement,
			DowntimeMinutes: jsnum.Round(downtimeSeconds / 60), Status: s.classify(ctx, tenantID, oeePct, achievement),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SequenceDefault < out[j].SequenceDefault })
	return out, nil
}

// RejectPareto ranks defects by quantity, all history, optionally per line.
func (s *Service) RejectPareto(ctx context.Context, tenantID, lineID string) ([]RejectParetoItem, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	reasons, err := s.master.RejectReasons(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	type acc struct {
		quantity float64
		count    int
	}
	groups := map[string]*acc{}
	var order []string
	for _, r := range snap.Records {
		if r.RejectQuantity <= 0 {
			continue
		}
		if lineID != "" {
			wo, ok := snap.WorkOrder(r.WorkOrderID)
			if !ok || wo.LineID != lineID {
				continue
			}
		}
		key := db.Deref(r.RejectReasonID, "UNCATEGORISED")
		g, ok := groups[key]
		if !ok {
			g = &acc{}
			groups[key] = g
			order = append(order, key)
		}
		g.quantity += float64(r.RejectQuantity)
		g.count++
	}
	total := 0.0
	for _, g := range groups {
		total += g.quantity
	}
	if total == 0 {
		total = 1
	}
	out := make([]RejectParetoItem, 0, len(order))
	for _, id := range order {
		g := groups[id]
		item := RejectParetoItem{ReasonID: id, ReasonCode: "UNCAT", ReasonName: "Uncategorised Defect", Category: "OTHER",
			TotalRejectQuantity: g.quantity, OccurrenceCount: g.count, PercentageOfTotal: jsnum.Round1((g.quantity / total) * 100)}
		for _, rs := range reasons {
			if rs.ID == id {
				item.ReasonCode, item.ReasonName, item.Category = rs.Code, rs.Name, rs.Category
				break
			}
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TotalRejectQuantity > out[j].TotalRejectQuantity })
	cumulative := 0.0
	for i := range out {
		cumulative += out[i].PercentageOfTotal
		out[i].CumulativePercentage = jsnum.Round1(math.Min(100, cumulative))
	}
	return out, nil
}

// DowntimeSummary is the loss overview above the Pareto.
func (s *Service) DowntimeSummary(ctx context.Context, tenantID string, days int) (DowntimeSummary, error) {
	rows, err := s.lineDays(ctx, tenantID, days)
	if err != nil {
		return DowntimeSummary{}, err
	}
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return DowntimeSummary{}, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return DowntimeSummary{}, err
	}
	dates := map[string]bool{}
	for _, r := range rows {
		dates[r.shiftDate] = true
	}
	records := []shopfloor.DowntimeRecord{}
	var totalSeconds, plannedSeconds float64
	for _, d := range snap.Downtimes {
		if !dates[d.ShiftDate] {
			continue
		}
		records = append(records, d)
		seconds := float64(db.Deref(d.DurationSeconds, 0))
		totalSeconds += seconds
		if d.IsPlanned {
			plannedSeconds += seconds
		}
	}
	plannedProduction := sum(rows, func(r lineDay) float64 { return r.plannedSeconds })

	type acc struct {
		seconds float64
		count   int
	}
	group := func(keyOf func(shopfloor.DowntimeRecord) string) ([]string, map[string]*acc) {
		m := map[string]*acc{}
		var order []string
		for _, r := range records {
			key := keyOf(r)
			if key == "" {
				continue
			}
			g, ok := m[key]
			if !ok {
				g = &acc{}
				m[key] = g
				order = append(order, key)
			}
			g.seconds += float64(db.Deref(r.DurationSeconds, 0))
			g.count++
		}
		return order, m
	}

	pareto, err := s.DowntimePareto(ctx, tenantID, "")
	if err != nil {
		return DowntimeSummary{}, err
	}
	lineOrder, lineGroups := group(func(r shopfloor.DowntimeRecord) string { return r.LineID })
	byLine := make([]DowntimeByLine, 0, len(lineOrder))
	for _, id := range lineOrder {
		name := id
		if l := findLine(ref, id); l != nil {
			name = l.Name
		}
		byLine = append(byLine, DowntimeByLine{LineID: id, LineName: name, DowntimeMinutes: jsnum.Round(lineGroups[id].seconds / 60), OccurrenceCount: lineGroups[id].count})
	}
	sort.SliceStable(byLine, func(i, j int) bool { return byLine[i].DowntimeMinutes > byLine[j].DowntimeMinutes })

	machineOrder, machineGroups := group(func(r shopfloor.DowntimeRecord) string { return r.MachineID })
	topMachines := make([]DowntimeByMachine, 0, len(machineOrder))
	for _, id := range machineOrder {
		name := id
		for _, m := range ref.Machines {
			if m.ID == id {
				name = m.Name
				break
			}
		}
		topMachines = append(topMachines, DowntimeByMachine{MachineID: id, MachineName: name, DowntimeMinutes: jsnum.Round(machineGroups[id].seconds / 60), OccurrenceCount: machineGroups[id].count})
	}
	sort.SliceStable(topMachines, func(i, j int) bool { return topMachines[i].DowntimeMinutes > topMachines[j].DowntimeMinutes })
	if len(topMachines) > 5 {
		topMachines = topMachines[:5]
	}

	average := 0.0
	if len(records) > 0 {
		average = jsnum.Round(totalSeconds / float64(len(records)) / 60)
	}
	return DowntimeSummary{
		TotalDowntimeMinutes: jsnum.Round(totalSeconds / 60), PlannedDowntimeMinutes: jsnum.Round(plannedSeconds / 60),
		UnplannedDowntimeMinutes: jsnum.Round((totalSeconds - plannedSeconds) / 60), PlannedProductionMinutes: jsnum.Round(plannedProduction / 60),
		DowntimeRatePct: fixedPct(totalSeconds, plannedProduction, 1), OccurrenceCount: len(records), AverageDurationMinutes: average,
		Pareto: pareto, ByLine: byLine, TopMachines: topMachines,
	}, nil
}

// QualitySummary is the quality overview above the defect Pareto.
func (s *Service) QualitySummary(ctx context.Context, tenantID string, days int) (QualitySummary, error) {
	rows, err := s.lineDays(ctx, tenantID, days)
	if err != nil {
		return QualitySummary{}, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return QualitySummary{}, err
	}
	target, err := s.master.KpiTarget(ctx, tenantID, "QUALITY")
	if err != nil {
		return QualitySummary{}, err
	}
	good := sum(rows, func(r lineDay) float64 { return r.goodQuantity })
	reject := sum(rows, func(r lineDay) float64 { return r.rejectQuantity })
	total := good + reject
	qualityPct := 100.0
	if total > 0 {
		qualityPct = jsnum.ToFixed((good/total)*100, 2)
	}
	type acc struct{ good, reject float64 }
	byLineMap := map[string]*acc{}
	var order []string
	for _, r := range rows {
		g, ok := byLineMap[r.lineID]
		if !ok {
			g = &acc{}
			byLineMap[r.lineID] = g
			order = append(order, r.lineID)
		}
		g.good += r.goodQuantity
		g.reject += r.rejectQuantity
	}
	byLine := make([]QualityByLine, 0, len(order))
	for _, id := range order {
		g := byLineMap[id]
		name := id
		if l := findLine(ref, id); l != nil {
			name = l.Name
		}
		byLine = append(byLine, QualityByLine{LineID: id, LineName: name, RejectQuantity: g.reject, RejectRatePct: fixedPct(g.reject, g.good+g.reject, 2)})
	}
	sort.SliceStable(byLine, func(i, j int) bool { return byLine[i].RejectRatePct > byLine[j].RejectRatePct })
	pareto, err := s.RejectPareto(ctx, tenantID, "")
	if err != nil {
		return QualitySummary{}, err
	}
	out := QualitySummary{GoodQuantity: good, RejectQuantity: reject, TotalQuantity: total, RejectRatePct: fixedPct(reject, total, 2), QualityPct: qualityPct, Pareto: pareto, ByLine: byLine}
	if target != nil {
		out.QualityTargetPct = db.Ptr(target.TargetValue)
		out.QualityVariancePct = db.Ptr(jsnum.ToFixed(qualityPct-target.TargetValue, 2))
	}
	return out, nil
}

// OrderStatus is schedule health (US-030), classified from the order's
// due date and the progress of its work orders.
func (s *Service) OrderStatus(ctx context.Context, tenantID string, asOf time.Time) (OrderStatusSummary, error) {
	snap, err := s.source.Snapshot(ctx, tenantID)
	if err != nil {
		return OrderStatusSummary{}, err
	}
	orders, err := s.production.ProductionOrders(ctx, tenantID)
	if err != nil {
		return OrderStatusSummary{}, err
	}
	summary := OrderStatusSummary{Total: len(orders), AttentionOrders: []AttentionOrder{}}
	asOfMs := asOf.UnixMilli()
	for _, order := range orders {
		var target, good float64
		count, completed, running := 0, 0, false
		for _, wo := range snap.WorkOrders {
			if wo.ProductionOrderID == nil || *wo.ProductionOrderID != order.ID {
				continue
			}
			count++
			target += float64(wo.PlannedQuantity)
			good += float64(wo.OutputQuantity)
			if wo.Status == production.StatusCompleted {
				completed++
			}
			if wo.Status == production.StatusInProduction {
				running = true
			}
		}
		if target == 0 {
			target = float64(order.Quantity)
		}
		achievement := roundPct(good, target)
		isComplete := order.Status == "COMPLETED" || (count > 0 && completed == count)
		switch {
		case isComplete:
			summary.Completed++
		case running:
			summary.Running++
		default:
			summary.Planned++
		}
		if isComplete {
			continue
		}
		due, err := time.Parse("2006-01-02", order.DueDate)
		if err != nil {
			continue
		}
		daysToDue := int(math.Floor(float64(due.UnixMilli()-asOfMs) / 86_400_000))
		classification := ""
		switch {
		case daysToDue < 0:
			classification = "OVERDUE"
			summary.Overdue++
		case daysToDue <= 1 && achievement < 90:
			classification = "DELAYED"
			summary.Delayed++
		case daysToDue <= 3 && achievement < 60:
			classification = "AT_RISK"
			summary.AtRisk++
		}
		if classification != "" {
			summary.AttentionOrders = append(summary.AttentionOrders, AttentionOrder{
				ID: order.ID, OrderNumber: order.OrderNumber, DueDate: order.DueDate, Status: order.Status,
				AchievementPct: achievement, DaysToDue: daysToDue, Classification: classification,
			})
		}
	}
	sort.SliceStable(summary.AttentionOrders, func(i, j int) bool {
		return summary.AttentionOrders[i].DaysToDue < summary.AttentionOrders[j].DaysToDue
	})
	return summary, nil
}

// OperationalAlerts is the v1.7 exception layer: rules evaluated against
// the same aggregates the cards use, each carrying its drill-down route.
func (s *Service) OperationalAlerts(ctx context.Context, tenantID string, days int) ([]OperationalAlert, error) {
	raisedAt := db.ISO(s.now())
	oeeTarget, _ := s.master.KpiTarget(ctx, tenantID, "OEE")
	rejectTarget, _ := s.master.KpiTarget(ctx, tenantID, "REJECT_RATE")
	downtimeTarget, _ := s.master.KpiTarget(ctx, tenantID, "DOWNTIME")

	var (
		lines    []LinePerformanceRow
		downtime DowntimeSummary
		kpis     []ExecutiveKpi
		status   OrderStatusSummary
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { lines, err = s.LinePerformance(gctx, tenantID, days); return })
	g.Go(func() (err error) { downtime, err = s.DowntimeSummary(gctx, tenantID, days); return })
	g.Go(func() (err error) { kpis, err = s.ExecutiveKpi(gctx, tenantID, days); return })
	g.Go(func() (err error) { status, err = s.OrderStatus(gctx, tenantID, s.now()); return })
	if err := g.Wait(); err != nil {
		return nil, err
	}

	alerts := []OperationalAlert{}
	for _, line := range lines {
		if oeeTarget != nil && line.Oee < oeeTarget.TargetValue {
			attainment := (line.Oee / oeeTarget.TargetValue) * 100
			severity := "WARNING"
			if attainment <= oeeTarget.CriticalThresholdPct {
				severity = "CRITICAL"
			}
			alerts = append(alerts, OperationalAlert{
				ID: "alert-oee-" + line.LineID, Severity: severity, Rule: "LINE_OEE_BELOW_TARGET",
				Title:         line.LineName + " OEE below target",
				Detail:        fmt.Sprintf("OEE %s%% against a %s%% target over the last %d days.", num(line.Oee), num(oeeTarget.TargetValue), days),
				DrillDownPath: "/live-board?lineId=" + line.LineID, EntityType: "LINE", EntityID: line.LineID,
				ObservedValue: line.Oee, ThresholdValue: oeeTarget.TargetValue, RaisedAt: raisedAt,
			})
		}
		if rejectTarget != nil && line.RejectRatePct > rejectTarget.TargetValue {
			severity := "WARNING"
			if line.RejectRatePct > rejectTarget.TargetValue*2 {
				severity = "CRITICAL"
			}
			alerts = append(alerts, OperationalAlert{
				ID: "alert-reject-" + line.LineID, Severity: severity, Rule: "LINE_REJECT_RATE_ABOVE_THRESHOLD",
				Title:         line.LineName + " reject rate above threshold",
				Detail:        fmt.Sprintf("Reject rate %s%% against a %s%% ceiling.", num(line.RejectRatePct), num(rejectTarget.TargetValue)),
				DrillDownPath: "/reports?tab=production&lineId=" + line.LineID, EntityType: "LINE", EntityID: line.LineID,
				ObservedValue: line.RejectRatePct, ThresholdValue: rejectTarget.TargetValue, RaisedAt: raisedAt,
			})
		}
		if line.HasActiveDowntime {
			alerts = append(alerts, OperationalAlert{
				ID: "alert-active-downtime-" + line.LineID, Severity: "CRITICAL", Rule: "LINE_DOWNTIME_ACTIVE",
				Title: line.LineName + " is stopped", Detail: "An unresolved downtime event is open on this line right now.",
				DrillDownPath: "/downtime-analytics?lineId=" + line.LineID, EntityType: "LINE", EntityID: line.LineID,
				ObservedValue: 1, ThresholdValue: 0, RaisedAt: raisedAt,
			})
		}
	}
	for _, machine := range downtime.TopMachines {
		if machine.OccurrenceCount >= 8 {
			alerts = append(alerts, OperationalAlert{
				ID: "alert-repeat-breakdown-" + machine.MachineID, Severity: "WARNING", Rule: "MACHINE_REPEATED_BREAKDOWN",
				Title:         machine.MachineName + " stopped repeatedly",
				Detail:        fmt.Sprintf("%d downtime events totalling %s minutes in the last %d days.", machine.OccurrenceCount, num(machine.DowntimeMinutes), days),
				DrillDownPath: "/downtime-analytics?machineId=" + machine.MachineID, EntityType: "MACHINE", EntityID: machine.MachineID,
				ObservedValue: float64(machine.OccurrenceCount), ThresholdValue: 8, RaisedAt: raisedAt,
			})
		}
	}
	var oeeKpi, downtimeKpi *ExecutiveKpi
	for i := range kpis {
		switch kpis[i].Metric {
		case "OEE":
			oeeKpi = &kpis[i]
		case "DOWNTIME":
			downtimeKpi = &kpis[i]
		}
	}
	if oeeKpi != nil && oeeKpi.Trend == "DOWN" && math.Abs(oeeKpi.DeltaPct) >= 5 {
		severity := "WARNING"
		if math.Abs(oeeKpi.DeltaPct) >= 10 {
			severity = "CRITICAL"
		}
		alerts = append(alerts, OperationalAlert{
			ID: "alert-oee-drop", Severity: severity, Rule: "OEE_DROP_VS_PREVIOUS_PERIOD", Title: "OEE dropped versus the previous period",
			Detail: fmt.Sprintf("OEE fell %s points (%s%%) against the preceding %d days.",
				strconv.FormatFloat(jsnum.ToFixed(math.Abs(oeeKpi.DeltaVsPrevious), 1), 'f', 1, 64), num(oeeKpi.DeltaPct), days),
			DrillDownPath: "/downtime-analytics", EntityType: "TENANT", EntityID: tenantID,
			ObservedValue: oeeKpi.Value, ThresholdValue: oeeKpi.PreviousValue, RaisedAt: raisedAt,
		})
	}
	if downtimeTarget != nil && downtimeKpi != nil && downtimeKpi.Value > downtimeTarget.TargetValue {
		alerts = append(alerts, OperationalAlert{
			ID: "alert-downtime-budget", Severity: "WARNING", Rule: "DOWNTIME_ABOVE_BUDGET", Title: "Daily downtime above budget",
			Detail:        fmt.Sprintf("Averaging %s minutes per day against a %s minute budget.", num(downtimeKpi.Value), num(downtimeTarget.TargetValue)),
			DrillDownPath: "/downtime-analytics", EntityType: "TENANT", EntityID: tenantID,
			ObservedValue: downtimeKpi.Value, ThresholdValue: downtimeTarget.TargetValue, RaisedAt: raisedAt,
		})
	}
	for _, order := range status.AttentionOrders {
		severity := "WARNING"
		if order.Classification == "OVERDUE" {
			severity = "CRITICAL"
		}
		detail := fmt.Sprintf("Due in %d day(s) at %s%% complete.", order.DaysToDue, num(order.AchievementPct))
		if order.DaysToDue < 0 {
			detail = fmt.Sprintf("Due %d day(s) ago at %s%% complete.", -order.DaysToDue, num(order.AchievementPct))
		}
		alerts = append(alerts, OperationalAlert{
			ID: "alert-order-" + order.ID, Severity: severity, Rule: "PRODUCTION_ORDER_" + order.Classification,
			Title:  order.OrderNumber + " is " + strings.Replace(strings.ToLower(order.Classification), "_", " ", 1),
			Detail: detail, DrillDownPath: "/work-orders?tab=PO&orderId=" + order.ID, EntityType: "PRODUCTION_ORDER", EntityID: order.ID,
			ObservedValue: order.AchievementPct, ThresholdValue: 100, RaisedAt: raisedAt,
		})
	}
	sortBySeverity(alerts)
	return alerts, nil
}

var severityRank = map[string]int{"CRITICAL": 0, "WARNING": 1, "INFORMATIONAL": 2}

func sortBySeverity(alerts []OperationalAlert) {
	sort.SliceStable(alerts, func(i, j int) bool { return severityRank[alerts[i].Severity] < severityRank[alerts[j].Severity] })
}

// Alerts merges the v1.7 rules with the improvement's (§26): one feed.
func (s *Service) Alerts(ctx context.Context, tenantID string, days int) ([]OperationalAlert, error) {
	var performance, improvement []OperationalAlert
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { performance, err = s.OperationalAlerts(gctx, tenantID, days); return })
	if s.extra != nil {
		g.Go(func() (err error) { improvement, err = s.extra.Alerts(gctx, tenantID); return })
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	out := append([]OperationalAlert{}, performance...)
	return append(out, improvement...), nil
}

// num renders a number the way JavaScript template literals do.
func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func findLine(ref *masterdata.Reference, id string) *masterdata.Line {
	for i := range ref.Lines {
		if ref.Lines[i].ID == id {
			return &ref.Lines[i]
		}
	}
	return nil
}

func findProduct(ref *masterdata.Reference, id string) *masterdata.Product {
	for i := range ref.Products {
		if ref.Products[i].ID == id {
			return &ref.Products[i]
		}
	}
	return nil
}
