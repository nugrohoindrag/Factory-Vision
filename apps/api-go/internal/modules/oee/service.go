package oee

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/cache"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

const defaultWindowDays = 30

// Service is the OEE read model over the execution records.
type Service struct {
	pool       *db.Pool
	master     *masterdata.Service
	production *production.Service
	shopfloor  *shopfloor.Service
	// rows is the machine-day grain per tenant: the three record scans it
	// is built from are the expensive part of every OEE call, so they are
	// loaded once per change rather than once per request.
	rows *cache.Tenant[[]MachineDayRow]
	now  func() time.Time
}

// NewService wires the read model.
func NewService(pool *db.Pool, master *masterdata.Service, prod *production.Service, sf *shopfloor.Service) (*Service, error) {
	rows, err := cache.New[[]MachineDayRow]("oee_rows", cache.Options{MaxEntries: 256, TTL: 10 * time.Second})
	if err != nil {
		return nil, err
	}
	s := &Service{pool: pool, master: master, production: prod, shopfloor: sf, rows: rows, now: time.Now}
	prod.OnChange(s.Invalidate)
	return s, nil
}

// Invalidate drops a tenant's cached grain after a change.
func (s *Service) Invalidate(tenantID string) { s.rows.Invalidate(tenantID) }

// --- Configuration (US-032–US-035) --------------------------------------

func scanConfig(row pgx.Row) (Config, error) {
	var (
		c         Config
		updatedAt *time.Time
		updatedBy *string
	)
	if err := row.Scan(&c.TenantID, &c.CalcVersion, &c.PptExcludesPlannedDowntime, &c.IdealCycleSource, &c.AllowIdealCycleFallback, &updatedAt, &updatedBy); err != nil {
		return c, err
	}
	if updatedAt != nil {
		c.UpdatedAt = db.ISO(*updatedAt)
	}
	c.UpdatedBy = db.StrOr(updatedBy, "system")
	return c, nil
}

const configColumns = `tenant_id, calc_version, ppt_excludes_planned_downtime, ideal_cycle_source, allow_ideal_cycle_fallback, updated_at, updated_by`

func (s *Service) configIn(ctx context.Context, tx pgx.Tx, tenantID string) (Config, error) {
	c, err := scanConfig(tx.QueryRow(ctx, `SELECT `+configColumns+` FROM oee_config WHERE tenant_id = $1`, tenantID))
	if err == nil {
		return c, nil
	}
	if !db.IsNoRows(err) {
		return c, err
	}
	// The baseline: planned downtime stays inside Planned Production Time
	// and lowers Availability — a stated choice the pilot is meant to
	// challenge.
	return scanConfig(tx.QueryRow(ctx,
		`INSERT INTO oee_config (tenant_id, calc_version, ppt_excludes_planned_downtime, ideal_cycle_source, allow_ideal_cycle_fallback, updated_at, updated_by)
		 VALUES ($1, 1, FALSE, 'PRODUCT_MACHINE', FALSE, CURRENT_TIMESTAMP, 'system')
		 ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
		 RETURNING `+configColumns, tenantID))
}

// GetConfig reads (or initialises) the tenant's definitions.
func (s *Service) GetConfig(ctx context.Context, tenantID string) (Config, error) {
	var out Config
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.configIn(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// CalcVersion implements correction.CalcVersionSource.
func (s *Service) CalcVersion(ctx context.Context, tenantID string) (int, error) {
	c, err := s.GetConfig(ctx, tenantID)
	return c.CalcVersion, err
}

// UpdateConfig changes a definition and bumps calc_version when anything
// actually changed: the bump is the recompute, since every figure is
// derived from the event log on read.
func (s *Service) UpdateConfig(ctx context.Context, tenantID string, p ConfigPatch, actorID string) (before, after Config, err error) {
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		current, err := s.configIn(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		before = current
		changed := (p.PptExcludesPlannedDowntime != nil && *p.PptExcludesPlannedDowntime != current.PptExcludesPlannedDowntime) ||
			(p.IdealCycleSource != nil && *p.IdealCycleSource != current.IdealCycleSource) ||
			(p.AllowIdealCycleFallback != nil && *p.AllowIdealCycleFallback != current.AllowIdealCycleFallback)
		next := current
		if p.PptExcludesPlannedDowntime != nil {
			next.PptExcludesPlannedDowntime = *p.PptExcludesPlannedDowntime
		}
		if p.IdealCycleSource != nil {
			next.IdealCycleSource = *p.IdealCycleSource
		}
		if p.AllowIdealCycleFallback != nil {
			next.AllowIdealCycleFallback = *p.AllowIdealCycleFallback
		}
		if changed {
			next.CalcVersion++
		}
		after, err = scanConfig(tx.QueryRow(ctx,
			`UPDATE oee_config SET calc_version = $2, ppt_excludes_planned_downtime = $3, ideal_cycle_source = $4,
			        allow_ideal_cycle_fallback = $5, updated_at = CURRENT_TIMESTAMP, updated_by = $6
			  WHERE tenant_id = $1 RETURNING `+configColumns,
			tenantID, next.CalcVersion, next.PptExcludesPlannedDowntime, next.IdealCycleSource, next.AllowIdealCycleFallback, actorID))
		return err
	})
	if err == nil {
		s.Invalidate(tenantID)
	}
	return before, after, err
}

// Calculate is the one OEE computation. It returns its inputs alongside
// its outputs so somebody can re-derive the number by hand.
func Calculate(config Config, in CalculationInput, computedAt time.Time) CalculationResult {
	totalDowntime := in.PlannedDowntimeSeconds + in.UnplannedDowntimeSeconds
	plannedProduction := in.PlannedProductionSeconds
	subtracted := totalDowntime
	if config.PptExcludesPlannedDowntime {
		plannedProduction = max0(in.PlannedProductionSeconds - in.PlannedDowntimeSeconds)
		subtracted = in.UnplannedDowntimeSeconds
	}
	runTime := max0(plannedProduction - subtracted)
	totalCount := in.GoodCount + in.RejectCount

	availability := 0.0
	if plannedProduction > 0 {
		availability = jsnum.Clamp01(runTime / plannedProduction)
	}
	// US-034: a zero denominator is handled safely rather than producing NaN.
	quality := 1.0
	if totalCount > 0 {
		quality = jsnum.Clamp01(in.GoodCount / totalCount)
	}
	idealMissing := in.IdealCycleSeconds == nil || *in.IdealCycleSeconds <= 0
	// US-033: without a configured rate, Performance is not guessed.
	performance := 0.0
	if !idealMissing && runTime > 0 && totalCount > 0 {
		performance = jsnum.Clamp01((*in.IdealCycleSeconds * totalCount) / runTime)
	}
	oee := 0.0
	if !idealMissing {
		oee = jsnum.Round4(availability * performance * quality)
	}
	var ideal *float64
	if !idealMissing {
		ideal = in.IdealCycleSeconds
	}
	return CalculationResult{
		Availability: jsnum.Round4(availability),
		Performance:  jsnum.Round4(performance),
		Quality:      jsnum.Round4(quality),
		Oee:          oee,
		Inputs: CalculationInputs{
			PlannedProductionSeconds: plannedProduction,
			PlannedDowntimeSeconds:   in.PlannedDowntimeSeconds,
			UnplannedDowntimeSeconds: in.UnplannedDowntimeSeconds,
			RunTimeSeconds:           runTime,
			IdealCycleSeconds:        ideal,
			GoodCount:                in.GoodCount,
			RejectCount:              in.RejectCount,
			TotalCount:               totalCount,
		},
		CalcVersion:                config.CalcVersion,
		PptExcludesPlannedDowntime: config.PptExcludesPlannedDowntime,
		IdealCycleMissing:          idealMissing,
		ComputedAt:                 db.ISO(computedAt),
	}
}

func max0(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

// Calculate runs the computation under the tenant's definitions.
func (s *Service) Calculate(ctx context.Context, tenantID string, in CalculationInput) (CalculationResult, error) {
	config, err := s.GetConfig(ctx, tenantID)
	if err != nil {
		return CalculationResult{}, err
	}
	return Calculate(config, in, s.now()), nil
}

// --- The shared grain ----------------------------------------------------

type snapshot struct {
	config Config
	ref    *masterdata.Reference
	shifts []masterdata.Shift
}

func (s *Service) snapshot(ctx context.Context, tenantID string) (snapshot, error) {
	var snap snapshot
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		var err error
		snap.config, err = s.GetConfig(gctx, tenantID)
		return err
	})
	g.Go(func() error {
		var err error
		snap.ref, err = s.master.Reference(gctx, tenantID)
		return err
	})
	g.Go(func() error {
		var err error
		snap.shifts, err = s.master.Shifts(gctx, tenantID)
		return err
	})
	return snap, g.Wait()
}

// plannedSecondsForShift: the line's configured planned production time
// wins; shift duration minus breaks is the fallback; 8 hours the default.
func plannedSecondsForShift(snap snapshot, shiftID, lineID string) float64 {
	for _, l := range snap.ref.Lines {
		if l.ID == lineID && l.PlannedProductionTimeMinutes != 0 {
			return float64(l.PlannedProductionTimeMinutes * 60)
		}
	}
	for _, sh := range snap.shifts {
		if sh.ID != shiftID {
			continue
		}
		minutes := minutesOf(sh.EndTime) - minutesOf(sh.StartTime)
		if minutes <= 0 {
			minutes += 24 * 60
		}
		return max0(float64((minutes - sh.BreakMinutes) * 60))
	}
	return 480 * 60
}

func minutesOf(clock string) int {
	var h, m int
	fmt.Sscanf(clock, "%d:%d", &h, &m)
	return h*60 + m
}

// load builds the machine-day grain from every work order, production
// record and downtime record, the three scans running concurrently.
func (s *Service) load(ctx context.Context, tenantID string, snap snapshot) ([]MachineDayRow, error) {
	var (
		workOrders []production.WorkOrder
		records    []shopfloor.ProductionRecord
		downtimes  []shopfloor.DowntimeRecord
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		var err error
		workOrders, err = s.production.WorkOrders(gctx, tenantID, production.WorkOrderFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		records, err = s.shopfloor.ProductionRecords(gctx, tenantID, shopfloor.ProductionRecordFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		downtimes, err = s.shopfloor.DowntimeRecords(gctx, tenantID, shopfloor.DowntimeFilter{})
		return err
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}

	byID := make(map[string]production.WorkOrder, len(workOrders))
	targetByMachine := map[string]float64{}
	for _, wo := range workOrders {
		byID[wo.ID] = wo
		key := "line:" + wo.LineID
		if wo.MachineID != nil {
			key = *wo.MachineID
		}
		targetByMachine[key] += float64(wo.PlannedQuantity)
	}

	buckets := map[string]*MachineDayRow{}
	order := []*MachineDayRow{}
	bucketFor := func(shiftDate, shiftID, machineID, lineID string, processID, productID *string) *MachineDayRow {
		key := shiftDate + "|" + shiftID + "|" + machineID + "|" + lineID
		b, ok := buckets[key]
		if !ok {
			target, found := targetByMachine[machineID]
			if !found {
				target = targetByMachine["line:"+lineID]
			}
			b = &MachineDayRow{
				ShiftDate: shiftDate, ShiftID: shiftID, MachineID: machineID, LineID: lineID,
				ProcessID: processID, ProductID: productID,
				PlannedSeconds:    plannedSecondsForShift(snap, shiftID, lineID),
				TargetQuantity:    target,
				IdealCycleSeconds: snap.ref.IdealCycleSeconds(db.Deref(productID, ""), machineID, snap.config.IdealCycleSource),
			}
			buckets[key] = b
			order = append(order, b)
		}
		if b.ProcessID == nil && processID != nil {
			b.ProcessID = processID
		}
		if b.ProductID == nil && productID != nil {
			b.ProductID = productID
		}
		return b
	}

	for _, r := range records {
		wo, ok := byID[r.WorkOrderID]
		if !ok {
			continue
		}
		machineID := r.MachineID
		if machineID == "" && wo.MachineID != nil {
			machineID = *wo.MachineID
		}
		if machineID == "" {
			continue
		}
		processID := r.ProcessID
		if processID == nil {
			processID = wo.ProcessID
		}
		b := bucketFor(r.ShiftDate, r.ShiftID, machineID, wo.LineID, processID, &wo.ProductID)
		b.GoodQuantity += float64(r.GoodQuantity)
		b.RejectQuantity += float64(r.RejectQuantity)
	}
	for _, d := range downtimes {
		if d.MachineID == "" {
			continue
		}
		var wo *production.WorkOrder
		if d.WorkOrderID != nil {
			if w, ok := byID[*d.WorkOrderID]; ok {
				wo = &w
			}
		}
		processID := d.ProcessID
		var productID *string
		if wo != nil {
			if processID == nil {
				processID = wo.ProcessID
			}
			productID = &wo.ProductID
		}
		b := bucketFor(d.ShiftDate, d.ShiftID, d.MachineID, d.LineID, processID, productID)
		seconds := float64(db.Deref(d.DurationSeconds, 0))
		if d.IsPlanned {
			b.PlannedDowntimeSeconds += seconds
		} else {
			b.UnplannedDowntimeSeconds += seconds
		}
	}
	// Late-resolve the ideal cycle: a bucket's product only becomes known
	// once its first record lands.
	for _, b := range order {
		if b.IdealCycleSeconds == nil {
			b.IdealCycleSeconds = snap.ref.IdealCycleSeconds(db.Deref(b.ProductID, ""), b.MachineID, snap.config.IdealCycleSource)
		}
	}
	out := make([]MachineDayRow, len(order))
	for i, b := range order {
		out[i] = *b
	}
	return out, nil
}

func (s *Service) machineDayRows(ctx context.Context, tenantID string, f Filter) ([]MachineDayRow, snapshot, error) {
	snap, err := s.snapshot(ctx, tenantID)
	if err != nil {
		return nil, snap, err
	}
	rows, err := s.rows.Get(ctx, tenantID, func(ctx context.Context) ([]MachineDayRow, error) {
		return s.load(ctx, tenantID, snap)
	})
	if err != nil {
		return nil, snap, err
	}
	return applyFilter(rows, f), snap, nil
}

func applyFilter(rows []MachineDayRow, f Filter) []MachineDayRow {
	var allowed map[string]bool
	if f.AllowedLineIDs != nil {
		allowed = map[string]bool{}
		for _, id := range f.AllowedLineIDs {
			allowed[id] = true
		}
	}
	result := make([]MachineDayRow, 0, len(rows))
	for _, r := range rows {
		if allowed != nil && !allowed[r.LineID] {
			continue
		}
		if f.LineID != "" && r.LineID != f.LineID {
			continue
		}
		if f.ProcessID != "" && (r.ProcessID == nil || *r.ProcessID != f.ProcessID) {
			continue
		}
		if f.MachineID != "" && r.MachineID != f.MachineID {
			continue
		}
		if f.ShiftID != "" && r.ShiftID != f.ShiftID {
			continue
		}
		if f.ProductID != "" && (r.ProductID == nil || *r.ProductID != f.ProductID) {
			continue
		}
		if f.From != "" && r.ShiftDate < f.From {
			continue
		}
		if f.To != "" && r.ShiftDate > f.To {
			continue
		}
		result = append(result, r)
	}
	if f.From == "" && f.To == "" {
		days := defaultWindowDays
		if f.Days != nil {
			days = *f.Days
		}
		dates := uniqueSortedDates(result)
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
		filtered := result[:0]
		for _, r := range result {
			if kept[r.ShiftDate] {
				filtered = append(filtered, r)
			}
		}
		result = filtered
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].ShiftDate < result[j].ShiftDate })
	return result
}

func uniqueSortedDates(rows []MachineDayRow) []string {
	seen := map[string]bool{}
	dates := []string{}
	for _, r := range rows {
		if !seen[r.ShiftDate] {
			seen[r.ShiftDate] = true
			dates = append(dates, r.ShiftDate)
		}
	}
	sort.Strings(dates)
	return dates
}

type rolled struct {
	CalculationResult
	targetQuantity float64
}

// roll aggregates rows into one OEE result. Mixed products mean no single
// cycle time applies, so the roll-up uses the ideal time each row earned
// and divides it back out.
func (s *Service) roll(snap snapshot, rows []MachineDayRow) rolled {
	var planned, plannedDown, unplannedDown, good, reject, target, idealSeconds float64
	anyRate := false
	for _, r := range rows {
		planned += r.PlannedSeconds
		plannedDown += r.PlannedDowntimeSeconds
		unplannedDown += r.UnplannedDowntimeSeconds
		good += r.GoodQuantity
		reject += r.RejectQuantity
		target += r.TargetQuantity
		if r.IdealCycleSeconds != nil {
			idealSeconds += *r.IdealCycleSeconds * (r.GoodQuantity + r.RejectQuantity)
			if *r.IdealCycleSeconds > 0 {
				anyRate = true
			}
		}
	}
	var weighted *float64
	if total := good + reject; anyRate && total > 0 {
		w := idealSeconds / total
		weighted = &w
	}
	result := Calculate(snap.config, CalculationInput{
		PlannedProductionSeconds: planned, PlannedDowntimeSeconds: plannedDown, UnplannedDowntimeSeconds: unplannedDown,
		GoodCount: good, RejectCount: reject, IdealCycleSeconds: weighted,
	}, s.now())
	return rolled{CalculationResult: result, targetQuantity: target}
}

func (s *Service) classify(ctx context.Context, tenantID string, oeePct, achievementPct float64) string {
	oeeTarget, achievementTarget := 85.0, 100.0
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
	worst := oeeAttainment
	if achievementAttainment < worst {
		worst = achievementAttainment
	}
	switch {
	case worst < 90:
		return "CRITICAL"
	case worst < 95:
		return "WATCH"
	}
	return "GOOD"
}

func minutes(seconds float64) int { return jsnum.RoundInt(seconds / 60) }

// --- US-027: Process → Machine drill-down --------------------------------

// MachinePerformance is machine-grain OEE for the window, worst first.
func (s *Service) MachinePerformance(ctx context.Context, tenantID string, f Filter) ([]MachinePerformanceRow, error) {
	rows, snap, err := s.machineDayRows(ctx, tenantID, f)
	if err != nil {
		return nil, err
	}
	groups, keys := groupBy(rows, func(r MachineDayRow) string { return r.MachineID })
	out := make([]MachinePerformanceRow, 0, len(keys))
	for _, machineID := range keys {
		machineRows := groups[machineID]
		rolled := s.roll(snap, machineRows)
		machine := findMachine(snap.ref, machineID)
		var workCenter *masterdata.WorkCenter
		if machine != nil {
			workCenter = findWorkCenter(snap.ref, machine.WorkCenterID)
		}
		lineID := machineRows[0].LineID
		line := findLine(snap.ref, lineID)
		var processID *string
		for _, r := range machineRows {
			if r.ProcessID != nil {
				processID = r.ProcessID
				break
			}
		}
		process := findProcess(snap.ref, processID)

		good, target := rolled.Inputs.GoodCount, rolled.targetQuantity
		achievementPct := 0.0
		if target > 0 {
			achievementPct = jsnum.Round1((good / target) * 100)
		}
		oeePct := jsnum.Round1(rolled.Oee * 100)
		row := MachinePerformanceRow{
			MachineID: machineID, MachineCode: machineID, MachineName: machineID, WorkCenterName: "-",
			ProcessID: processID, LineID: lineID, LineName: lineID,
			Oee: oeePct, Availability: jsnum.Round1(rolled.Availability * 100),
			Performance: jsnum.Round1(rolled.Performance * 100), Quality: jsnum.Round1(rolled.Quality * 100),
			GoodQuantity: good, RejectQuantity: rolled.Inputs.RejectCount, TargetQuantity: target, AchievementPct: achievementPct,
			PlannedMinutes: minutes(rolled.Inputs.PlannedProductionSeconds), RunMinutes: minutes(rolled.Inputs.RunTimeSeconds),
			DowntimeMinutes:   minutes(rolled.Inputs.PlannedDowntimeSeconds + rolled.Inputs.UnplannedDowntimeSeconds),
			IdealCycleSeconds: rolled.Inputs.IdealCycleSeconds, IdealCycleMissing: rolled.IdealCycleMissing,
			Status: s.classify(ctx, tenantID, oeePct, achievementPct),
		}
		if machine != nil {
			row.MachineCode, row.MachineName = machine.Code, machine.Name
		}
		if workCenter != nil {
			row.WorkCenterID, row.WorkCenterName = workCenter.ID, workCenter.Name
		}
		if line != nil {
			row.LineName = line.Name
		}
		if process != nil {
			row.ProcessName = &process.Name
		}
		out = append(out, row)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Oee < out[j].Oee })
	return out, nil
}

// --- US-037: bottleneck ranking -------------------------------------------

// Bottlenecks ranks constraints by the output they cost, with the dominant
// OEE factor named so a manager knows which lever to pull.
func (s *Service) Bottlenecks(ctx context.Context, tenantID string, f Filter, kind string) ([]BottleneckRow, error) {
	if kind != "PROCESS" {
		kind = "MACHINE"
	}
	rows, snap, err := s.machineDayRows(ctx, tenantID, f)
	if err != nil {
		return nil, err
	}
	groups, keys := groupBy(rows, func(r MachineDayRow) string {
		if kind == "PROCESS" {
			return db.Deref(r.ProcessID, "unassigned")
		}
		return r.MachineID
	})
	out := make([]BottleneckRow, 0, len(keys))
	for _, key := range keys {
		groupRows := groups[key]
		rolled := s.roll(snap, groupRows)
		good, target := rolled.Inputs.GoodCount, rolled.targetQuantity
		lostUnits := max0(target - good)

		losses := []struct {
			name string
			loss float64
		}{{"AVAILABILITY", 1 - rolled.Availability}, {"PERFORMANCE", 1 - rolled.Performance}, {"QUALITY", 1 - rolled.Quality}}
		sort.SliceStable(losses, func(i, j int) bool { return losses[i].loss > losses[j].loss })

		machine := findMachine(snap.ref, key)
		process := findProcess(snap.ref, &key)
		lineID := groupRows[0].LineID
		line := findLine(snap.ref, lineID)
		var ownProcessID *string
		for _, r := range groupRows {
			if r.ProcessID != nil {
				ownProcessID = r.ProcessID
				break
			}
		}
		ownProcess := findProcess(snap.ref, ownProcessID)

		lineName := lineID
		if line != nil {
			lineName = line.Name
		}
		entityName, contextLabel := key, lineName
		if kind == "PROCESS" {
			entityName = "Tanpa Proses"
			if process != nil {
				entityName = process.Name
			}
		} else {
			if machine != nil {
				entityName = machine.Name
			}
			if ownProcess != nil {
				contextLabel = ownProcess.Name
			}
		}
		lostPct := 0.0
		if target > 0 {
			lostPct = jsnum.Round1((lostUnits / target) * 100)
		}
		path := "/oee?machineId=" + url.QueryEscape(key)
		if kind == "PROCESS" {
			path = "/oee?processId=" + url.QueryEscape(key)
		}
		out = append(out, BottleneckRow{
			Kind: kind, EntityID: key, EntityName: entityName, ContextLabel: contextLabel,
			Oee: jsnum.Round1(rolled.Oee * 100), Availability: jsnum.Round1(rolled.Availability * 100),
			Performance: jsnum.Round1(rolled.Performance * 100), Quality: jsnum.Round1(rolled.Quality * 100),
			LostUnits: lostUnits, LostUnitsPct: lostPct,
			DowntimeMinutes: minutes(rolled.Inputs.PlannedDowntimeSeconds + rolled.Inputs.UnplannedDowntimeSeconds),
			RejectQuantity:  rolled.Inputs.RejectCount, DominantLoss: losses[0].name, DominantLossPct: jsnum.Round1(losses[0].loss * 100),
			DrillDownPath: strings.ReplaceAll(path, "+", "%20"),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].LostUnits != out[j].LostUnits {
			return out[i].LostUnits > out[j].LostUnits
		}
		return out[i].Oee < out[j].Oee
	})
	for i := range out {
		out[i].Rank = i + 1
	}
	return out, nil
}

// --- US-041: OEE report ---------------------------------------------------

// Report is one row per machine-shift-day, newest first.
func (s *Service) Report(ctx context.Context, tenantID string, f Filter) ([]ReportItem, error) {
	rows, snap, err := s.machineDayRows(ctx, tenantID, f)
	if err != nil {
		return nil, err
	}
	out := make([]ReportItem, 0, len(rows))
	for _, r := range rows {
		rolled := s.roll(snap, []MachineDayRow{r})
		item := ReportItem{
			ShiftDate: r.ShiftDate, ShiftID: r.ShiftID, ShiftName: r.ShiftID, LineID: r.LineID, LineName: r.LineID,
			MachineID: r.MachineID, MachineName: r.MachineID, ProcessID: r.ProcessID, ProductID: r.ProductID,
			Availability: jsnum.Round1(rolled.Availability * 100), Performance: jsnum.Round1(rolled.Performance * 100),
			Quality: jsnum.Round1(rolled.Quality * 100), Oee: jsnum.Round1(rolled.Oee * 100),
			PlannedMinutes: minutes(rolled.Inputs.PlannedProductionSeconds), RunMinutes: minutes(rolled.Inputs.RunTimeSeconds),
			DowntimeMinutes: minutes(rolled.Inputs.PlannedDowntimeSeconds + rolled.Inputs.UnplannedDowntimeSeconds),
			GoodQuantity:    rolled.Inputs.GoodCount, RejectQuantity: rolled.Inputs.RejectCount, TotalQuantity: rolled.Inputs.TotalCount,
			IdealCycleMissing: rolled.IdealCycleMissing, CalcVersion: rolled.CalcVersion,
		}
		if m := findMachine(snap.ref, r.MachineID); m != nil {
			item.MachineName = m.Name
		}
		if l := findLine(snap.ref, r.LineID); l != nil {
			item.LineName = l.Name
		}
		if p := findProcess(snap.ref, r.ProcessID); p != nil {
			item.ProcessName = &p.Name
		}
		if p := findProduct(snap.ref, r.ProductID); p != nil {
			item.ProductName = &p.Name
		}
		for _, sh := range snap.shifts {
			if sh.ID == r.ShiftID {
				item.ShiftName = sh.Name
				break
			}
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].ShiftDate != out[j].ShiftDate {
			return out[i].ShiftDate > out[j].ShiftDate
		}
		return localeLess(out[i].MachineName, out[j].MachineName)
	})
	return out, nil
}

// --- US-025: Target vs Actual --------------------------------------------

// TargetVsActual groups the window by one dimension with a straight-line
// forecast of how it ends if the run rate holds.
func (s *Service) TargetVsActual(ctx context.Context, tenantID, dimension string, f Filter) (TargetVsActualSummary, error) {
	rows, snap, err := s.machineDayRows(ctx, tenantID, f)
	if err != nil {
		return TargetVsActualSummary{}, err
	}
	keyOf := func(r MachineDayRow) string {
		switch dimension {
		case "LINE":
			return r.LineID
		case "PROCESS":
			return db.Deref(r.ProcessID, "unassigned")
		case "PRODUCT":
			return db.Deref(r.ProductID, "unassigned")
		case "SHIFT":
			return r.ShiftID
		}
		return r.ShiftDate
	}
	labelOf := func(key string) string {
		switch dimension {
		case "LINE":
			if l := findLine(snap.ref, key); l != nil {
				return l.Name
			}
			return key
		case "PROCESS":
			if p := findProcess(snap.ref, &key); p != nil {
				return p.Name
			}
			return "Tanpa Proses"
		case "PRODUCT":
			if p := findProduct(snap.ref, &key); p != nil {
				return p.Name
			}
			return "Tanpa Produk"
		case "SHIFT":
			for _, sh := range snap.shifts {
				if sh.ID == key {
					return sh.Name
				}
			}
			return key
		}
		return key
	}
	groups, keys := groupBy(rows, keyOf)
	elapsedDays := len(uniqueSortedDates(rows))
	windowDays := elapsedDays
	if f.Days != nil {
		windowDays = *f.Days
	}
	resultRows := make([]TargetVsActualRow, 0, len(keys))
	for _, key := range keys {
		var actual, reject, target float64
		for _, r := range groups[key] {
			actual += r.GoodQuantity
			reject += r.RejectQuantity
			target += r.TargetQuantity
		}
		achievementPct := 0.0
		if target > 0 {
			achievementPct = jsnum.Round1((actual / target) * 100)
		}
		var forecast, forecastPct *float64
		if elapsedDays > 0 && windowDays > elapsedDays {
			v := jsnum.Round((actual / float64(elapsedDays)) * float64(windowDays))
			forecast = &v
			if target > 0 {
				p := jsnum.Round1((v / target) * 100)
				forecastPct = &p
			}
		}
		resultRows = append(resultRows, TargetVsActualRow{
			Dimension: dimension, Key: key, Label: labelOf(key), TargetQuantity: target, ActualQuantity: actual,
			RejectQuantity: reject, Variance: actual - target, AchievementPct: achievementPct,
			Status: s.classify(ctx, tenantID, achievementPct, achievementPct), ForecastQuantity: forecast, ForecastAchievementPct: forecastPct,
		})
	}
	sort.SliceStable(resultRows, func(i, j int) bool { return resultRows[i].AchievementPct < resultRows[j].AchievementPct })

	var totalTarget, totalActual float64
	for _, r := range resultRows {
		totalTarget += r.TargetQuantity
		totalActual += r.ActualQuantity
	}
	achievementPct := 0.0
	if totalTarget > 0 {
		achievementPct = jsnum.Round1((totalActual / totalTarget) * 100)
	}
	return TargetVsActualSummary{
		Dimension: dimension, TotalTarget: totalTarget, TotalActual: totalActual, TotalVariance: totalActual - totalTarget,
		AchievementPct: achievementPct, Status: s.classify(ctx, tenantID, achievementPct, achievementPct), Rows: resultRows,
	}, nil
}

// --- US-036: pilot validation log -----------------------------------------

var validationTitles = []struct{ item, title string }{
	{"V1", "Definisi Planned Production Time disepakati dengan pabrik"},
	{"V2", "Definisi Run Time dan perlakuan downtime terverifikasi"},
	{"V3", "Ideal Cycle Time per Product × Machine tervalidasi"},
	{"V4", "Total Count dan Good Count sesuai perhitungan pabrik"},
	{"V5", "Perlakuan is_planned pada setup/cleaning disepakati"},
	{"V6", "Hasil OEE MES vs perhitungan pabrik berada dalam toleransi"},
}

const validationColumns = `id, tenant_id, item, title, scope_label, shift_date, mes_value, factory_value, gap, gap_class, status,
  resolution, resolved_by_config_change, calc_version, notes, recorded_by, recorded_at, updated_at`

func scanValidation(rows pgx.Rows) (ValidationEntry, error) {
	var (
		e                            ValidationEntry
		scope, resolution, notes, by *string
		shiftDate                    *time.Time
		recordedAt, updatedAt        *time.Time
	)
	if err := rows.Scan(&e.ID, &e.TenantID, &e.Item, &e.Title, &scope, &shiftDate, &e.MesValue, &e.FactoryValue, &e.Gap,
		&e.GapClass, &e.Status, &resolution, &e.ResolvedByConfigChange, &e.CalcVersion, &notes, &by, &recordedAt, &updatedAt); err != nil {
		return e, err
	}
	e.ScopeLabel, e.Resolution, e.Notes, e.RecordedBy = db.StrOr(scope, ""), db.StrOr(resolution, ""), db.StrOr(notes, ""), db.StrOr(by, "system")
	if shiftDate != nil {
		e.ShiftDate = db.Date(*shiftDate)
	}
	if recordedAt != nil {
		e.RecordedAt = db.ISO(*recordedAt)
	}
	if updatedAt != nil {
		e.UpdatedAt = db.ISO(*updatedAt)
	}
	return e, nil
}

func collectValidations(rows pgx.Rows, err error) ([]ValidationEntry, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ValidationEntry{}
	for rows.Next() {
		e, err := scanValidation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ensureChecklist seeds the six items the pilot gate requires, once per
// tenant. The ids the Node API used (oeeval-v1 …) are kept for the first
// tenant to claim them; a second tenant gets tenant-suffixed ids.
func (s *Service) ensureChecklist(ctx context.Context, tx pgx.Tx, tenantID string, calcVersion int) error {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM oee_validation_entry WHERE tenant_id = $1`, tenantID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	for _, v := range validationTitles {
		for _, id := range []string{"oeeval-" + strings.ToLower(v.item), "oeeval-" + strings.ToLower(v.item) + "-" + tenantID} {
			tag, err := tx.Exec(ctx,
				`INSERT INTO oee_validation_entry (id, tenant_id, item, title, scope_label, shift_date, gap_class, status, resolution,
				   resolved_by_config_change, calc_version, notes, recorded_by)
				 VALUES ($1, $2, $3, $4, 'Pilot area, Curing Press (CPR-001/002)', NULL, 'NONE', 'OPEN', '', FALSE, $5, '', 'system')
				 ON CONFLICT (id) DO NOTHING`, id, tenantID, v.item, v.title, calcVersion)
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				break
			}
		}
	}
	return nil
}

// ValidationEntries is the checklist, V1 first.
func (s *Service) ValidationEntries(ctx context.Context, tenantID string) ([]ValidationEntry, error) {
	var out []ValidationEntry
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		config, err := s.configIn(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		if err := s.ensureChecklist(ctx, tx, tenantID, config.CalcVersion); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+validationColumns+` FROM oee_validation_entry WHERE tenant_id = $1 ORDER BY item`, tenantID)
		out, err = collectValidations(rows, err)
		return err
	})
	return out, err
}

// GateStatus is true when every V1–V6 item is resolved.
func GateStatusOf(entries []ValidationEntry) GateStatus {
	open := []string{}
	for _, e := range entries {
		if e.Status != "RESOLVED" {
			open = append(open, e.Item)
		}
	}
	return GateStatus{Passed: len(open) == 0, Open: open}
}

// UpsertValidationEntry records a comparison against the factory's own
// figure. A definition gap is closed by a configuration change plus
// recompute, never an ad-hoc patch.
func (s *Service) UpsertValidationEntry(ctx context.Context, tenantID, item string, p ValidationPatch, actorID string) (ValidationEntry, error) {
	var out ValidationEntry
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		config, err := s.configIn(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		if err := s.ensureChecklist(ctx, tx, tenantID, config.CalcVersion); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+validationColumns+` FROM oee_validation_entry WHERE tenant_id = $1 AND item = $2`, tenantID, item)
		list, err := collectValidations(rows, err)
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return httpx.NotFound(fmt.Sprintf("Item validasi %s tidak ditemukan.", item))
		}
		e := list[0]
		if p.ScopeLabel != nil {
			e.ScopeLabel = *p.ScopeLabel
		}
		if p.ShiftDate != nil {
			e.ShiftDate = *p.ShiftDate
		}
		if p.MesValue != nil {
			e.MesValue = p.MesValue
		}
		if p.FactoryValue != nil {
			e.FactoryValue = p.FactoryValue
		}
		if p.GapClass != nil {
			e.GapClass = *p.GapClass
		}
		if p.Status != nil {
			e.Status = *p.Status
		}
		if p.Resolution != nil {
			e.Resolution = *p.Resolution
		}
		if p.ResolvedByConfigChange != nil {
			e.ResolvedByConfigChange = *p.ResolvedByConfigChange
		}
		if p.Notes != nil {
			e.Notes = *p.Notes
		}
		e.Gap = nil
		if e.MesValue != nil && e.FactoryValue != nil {
			gap := jsnum.Round1(*e.MesValue - *e.FactoryValue)
			e.Gap = &gap
		}
		if e.Status == "RESOLVED" && e.GapClass == "DEFINITION" && !e.ResolvedByConfigChange {
			return httpx.Validation("Definition gap harus diselesaikan melalui perubahan konfigurasi + recompute, bukan patch ad-hoc.",
				httpx.FieldError{Field: "resolvedByConfigChange", Code: "REQUIRED", Message: "Tandai penyelesaian melalui perubahan konfigurasi OEE."})
		}
		var shiftDate *time.Time
		if e.ShiftDate != "" {
			t, err := time.Parse("2006-01-02", e.ShiftDate)
			if err != nil {
				return httpx.Validation("shiftDate harus berformat YYYY-MM-DD.",
					httpx.FieldError{Field: "shiftDate", Code: "INVALID_FORMAT", Message: "Gunakan format YYYY-MM-DD."})
			}
			shiftDate = &t
		}
		updated, err := tx.Query(ctx,
			`UPDATE oee_validation_entry
			    SET scope_label = $3, shift_date = $4, mes_value = $5, factory_value = $6, gap = $7, gap_class = $8, status = $9,
			        resolution = $10, resolved_by_config_change = $11, calc_version = $12, notes = $13, recorded_by = $14,
			        updated_at = CURRENT_TIMESTAMP
			  WHERE tenant_id = $1 AND id = $2 RETURNING `+validationColumns,
			tenantID, e.ID, e.ScopeLabel, shiftDate, e.MesValue, e.FactoryValue, e.Gap, e.GapClass, e.Status,
			e.Resolution, e.ResolvedByConfigChange, config.CalcVersion, e.Notes, actorID)
		list, err = collectValidations(updated, err)
		if err != nil {
			return err
		}
		out = list[0]
		return nil
	})
	return out, err
}

// --- helpers --------------------------------------------------------------

func groupBy(rows []MachineDayRow, key func(MachineDayRow) string) (map[string][]MachineDayRow, []string) {
	groups := map[string][]MachineDayRow{}
	var keys []string
	for _, r := range rows {
		k := key(r)
		if _, ok := groups[k]; !ok {
			keys = append(keys, k)
		}
		groups[k] = append(groups[k], r)
	}
	return groups, keys
}

func findMachine(ref *masterdata.Reference, id string) *masterdata.Machine {
	for i := range ref.Machines {
		if ref.Machines[i].ID == id {
			return &ref.Machines[i]
		}
	}
	return nil
}

func findWorkCenter(ref *masterdata.Reference, id string) *masterdata.WorkCenter {
	for i := range ref.WorkCenters {
		if ref.WorkCenters[i].ID == id {
			return &ref.WorkCenters[i]
		}
	}
	return nil
}

func findLine(ref *masterdata.Reference, id string) *masterdata.Line {
	for i := range ref.Lines {
		if ref.Lines[i].ID == id {
			return &ref.Lines[i]
		}
	}
	return nil
}

func findProcess(ref *masterdata.Reference, id *string) *masterdata.Process {
	if id == nil {
		return nil
	}
	for i := range ref.Processes {
		if ref.Processes[i].ID == *id {
			return &ref.Processes[i]
		}
	}
	return nil
}

func findProduct(ref *masterdata.Reference, id *string) *masterdata.Product {
	if id == nil {
		return nil
	}
	for i := range ref.Products {
		if ref.Products[i].ID == *id {
			return &ref.Products[i]
		}
	}
	return nil
}

// localeLess approximates String.prototype.localeCompare for the names the
// plant uses: case-insensitive first, lowercase before uppercase on a tie.
func localeLess(a, b string) bool {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	if la != lb {
		return la < lb
	}
	return a > b
}
