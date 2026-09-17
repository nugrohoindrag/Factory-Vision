// Package board is the Visual Production Board (Improvement PRD §9, §23).
//
// The board is a projection, not a store: every bar on it is a work order or
// a maintenance window that already exists elsewhere, arranged into lanes and
// annotated with what would stop it from running. Conflicts are computed on
// read for the same reason (§9.5): a stored conflict is a claim about a
// schedule that has since changed.
package board

import (
	"context"
	"fmt"
	"sort"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/maintenance"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/material"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/workforce"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

// Conflict is the TypeScript BoardConflict.
type Conflict struct {
	Type           string   `json:"type"`
	Blocking       bool     `json:"blocking"`
	Message        string   `json:"message"`
	RelatedItemIDs []string `json:"relatedItemIds"`
}

// Item is one bar on the timeline: a work order, or a maintenance window.
type Item struct {
	ID                  string     `json:"id"`
	Kind                string     `json:"kind"`
	Label               string     `json:"label"`
	WorkOrderID         *string    `json:"workOrderId,omitempty"`
	WorkOrderNumber     *string    `json:"workOrderNumber,omitempty"`
	MaintenanceRecordID *string    `json:"maintenanceRecordId,omitempty"`
	ProductID           *string    `json:"productId,omitempty"`
	ProductName         *string    `json:"productName,omitempty"`
	PlantID             *string    `json:"plantId,omitempty"`
	LineID              *string    `json:"lineId,omitempty"`
	LineName            *string    `json:"lineName,omitempty"`
	WorkCenterID        *string    `json:"workCenterId,omitempty"`
	MachineID           *string    `json:"machineId,omitempty"`
	MachineName         *string    `json:"machineName,omitempty"`
	ProcessID           *string    `json:"processId,omitempty"`
	ProcessName         *string    `json:"processName,omitempty"`
	MoldID              *string    `json:"moldId,omitempty"`
	ShiftID             *string    `json:"shiftId,omitempty"`
	OperatorIDs         []string   `json:"operatorIds"`
	OperatorNames       []string   `json:"operatorNames"`
	PlannedStart        string     `json:"plannedStart"`
	PlannedEnd          string     `json:"plannedEnd"`
	ActualStart         *string    `json:"actualStart,omitempty"`
	ActualEnd           *string    `json:"actualEnd,omitempty"`
	Quantity            int        `json:"quantity"`
	ProducedQuantity    int        `json:"producedQuantity"`
	ProgressPercentage  float64    `json:"progressPercentage"`
	Priority            int        `json:"priority"`
	Status              string     `json:"status"`
	MaterialStatus      *string    `json:"materialStatus,omitempty"`
	LaborStatus         *string    `json:"laborStatus,omitempty"`
	Conflicts           []Conflict `json:"conflicts"`
}

// Lane groups items by machine, line, process, shift or day.
type Lane struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Subtitle *string `json:"subtitle,omitempty"`
	Items    []*Item `json:"items"`
}

// Board is the TypeScript ProductionBoard.
type Board struct {
	ViewMode    string     `json:"viewMode"`
	WindowStart string     `json:"windowStart"`
	WindowEnd   string     `json:"windowEnd"`
	Lanes       []Lane     `json:"lanes"`
	Conflicts   []Conflict `json:"conflicts"`
	GeneratedAt string     `json:"generatedAt"`
}

// Query is the TypeScript ProductionBoardQuery.
type Query struct {
	ViewMode, Date                                                          string
	Days                                                                    *int
	PlantID, LineID, WorkCenterID, MachineID, ProcessID, ProductID, ShiftID string
	Status                                                                  string
	Priority                                                                *int
}

// DispatchAction is one §9.6 change.
type DispatchAction struct {
	Action, WorkOrderID string
	PlannedStart        *string
	PlannedEnd          *string
	MachineID           *string
	OperatorIDs         []string
	Sequence, Priority  *int
	Reason              *string
	HasOperatorIDs      bool
}

// Actor is who dispatched.
type Actor struct {
	ID   string
	Name *string
}

// Recorder is the event timeline.
type Recorder interface {
	RecordDetached(in event.Input)
}

// Service builds the board and applies dispatch actions.
type Service struct {
	master      *masterdata.Service
	production  *production.Service
	maintenance *maintenance.Service
	material    *material.Service
	workforce   *workforce.Service
	events      Recorder
	loc         *time.Location
	now         func() time.Time
}

// NewService wires the projection.
func NewService(master *masterdata.Service, prod *production.Service, mt *maintenance.Service, mat *material.Service, wf *workforce.Service, events Recorder, loc *time.Location) *Service {
	if loc == nil {
		loc = time.Local
	}
	return &Service{master: master, production: prod, maintenance: mt, material: mat, workforce: wf, events: events, loc: loc, now: time.Now}
}

type window struct{ start, end time.Time }

func overlaps(a, b window) bool { return a.start.Before(b.end) && b.start.Before(a.end) }

func parse(s string) time.Time {
	t, err := db.ParseISO(s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// statusOf is §9.4 — what a bar looks like at a glance. DELAYED and AT_RISK
// are the two the schedule itself decides.
func statusOf(wo production.WorkOrder, machineBlocked bool, now time.Time) string {
	switch {
	case wo.Status == "COMPLETED":
		return "COMPLETED"
	case wo.Status == "CANCELLED":
		return "BLOCKED"
	case machineBlocked:
		return "MAINTENANCE"
	}
	plannedEnd := parse(wo.PlannedEnd)
	if wo.Status == "IN_PRODUCTION" {
		if now.After(plannedEnd) {
			return "DELAYED"
		}
		progress := 0.0
		if wo.PlannedQuantity > 0 {
			progress = float64(wo.OutputQuantity) / float64(wo.PlannedQuantity)
		}
		plannedStart := parse(wo.PlannedStart)
		span := plannedEnd.Sub(plannedStart).Milliseconds()
		if span < 1 {
			span = 1
		}
		elapsed := float64(now.Sub(plannedStart).Milliseconds()) / float64(span)
		// Ten points behind the clock is the point at which a supervisor can
		// still do something about it; further behind and it is simply late.
		if elapsed-progress > 0.1 {
			return "AT_RISK"
		}
		return "RUNNING"
	}
	if now.After(plannedEnd) {
		return "DELAYED"
	}
	if wo.Status == "CONFIRMED" {
		return "CONFIRMED"
	}
	return "SCHEDULED"
}

// Build assembles the board for a window of days from an anchor date.
func (s *Service) Build(ctx context.Context, tenantID string, q Query) (Board, error) {
	viewMode := q.ViewMode
	if viewMode == "" {
		viewMode = "MACHINE"
	}
	days := db.Deref(q.Days, 1)
	if days < 1 {
		days = 1
	}
	if days > 31 {
		days = 31
	}
	now := s.now()
	anchor := now.In(s.loc)
	if q.Date != "" {
		if t, err := time.ParseInLocation("2006-01-02", q.Date, s.loc); err == nil {
			anchor = t
		}
	}
	windowStart := time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, s.loc)
	windowEnd := windowStart.Add(time.Duration(days) * 24 * time.Hour)
	win := window{windowStart, windowEnd}

	status := ""
	if q.Status == "RUNNING" {
		status = "IN_PRODUCTION"
	}
	workOrders, err := s.production.WorkOrders(ctx, tenantID, production.WorkOrderFilter{LineID: q.LineID, Status: status, ProcessID: q.ProcessID})
	if err != nil {
		return Board{}, err
	}
	var filtered []production.WorkOrder
	for _, wo := range workOrders {
		if !overlaps(window{parse(wo.PlannedStart), parse(wo.PlannedEnd)}, win) {
			continue
		}
		if q.MachineID != "" && db.Deref(wo.MachineID, "") != q.MachineID {
			continue
		}
		if q.WorkCenterID != "" && db.Deref(wo.WorkCenterID, "") != q.WorkCenterID {
			continue
		}
		if q.ProductID != "" && wo.ProductID != q.ProductID {
			continue
		}
		if q.ShiftID != "" && db.Deref(wo.ShiftID, "") != q.ShiftID {
			continue
		}
		if q.Priority != nil && wo.Priority != *q.Priority {
			continue
		}
		filtered = append(filtered, wo)
	}

	var blocked map[string]bool
	var assignments []workforce.Assignment
	var records []maintenance.Record
	var ref struct {
		machines  []masterdata.Machine
		products  []masterdata.Product
		lines     []masterdata.Line
		processes []masterdata.Process
		shifts    []masterdata.Shift
	}
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { blocked, err = s.maintenance.BlockedMachines(gctx, tenantID); return })
	g.Go(func() (err error) {
		assignments, err = s.workforce.Assignments(gctx, tenantID, workforce.AssignmentFilter{Active: true})
		return
	})
	g.Go(func() (err error) {
		records, err = s.maintenance.Records(gctx, tenantID, maintenance.RecordFilter{Limit: 500})
		return
	})
	g.Go(func() (err error) { ref.machines, err = s.master.Machines(gctx, tenantID); return })
	g.Go(func() (err error) { ref.products, err = s.master.Products(gctx, tenantID); return })
	g.Go(func() (err error) { ref.lines, err = s.master.Lines(gctx, tenantID); return })
	g.Go(func() (err error) { ref.processes, err = s.master.Processes(gctx, tenantID); return })
	g.Go(func() (err error) { ref.shifts, err = s.master.Shifts(gctx, tenantID); return })
	if err := g.Wait(); err != nil {
		return Board{}, err
	}
	machineName := func(id *string) *string {
		if id == nil {
			return nil
		}
		for _, m := range ref.machines {
			if m.ID == *id {
				return db.Ptr(m.Name)
			}
		}
		return nil
	}
	productName := func(id string) *string {
		for _, p := range ref.products {
			if p.ID == id {
				return db.Ptr(p.Name)
			}
		}
		return nil
	}
	lineName := func(id string) *string {
		for _, l := range ref.lines {
			if l.ID == id {
				return db.Ptr(l.Name)
			}
		}
		return nil
	}
	processName := func(id *string) *string {
		if id == nil {
			return nil
		}
		for _, p := range ref.processes {
			if p.ID == *id {
				return db.Ptr(p.Name)
			}
		}
		return nil
	}

	items := make([]*Item, 0, len(filtered))
	for _, wo := range filtered {
		wo := wo
		operatorIDs, operatorNames := []string{}, []string{}
		for _, a := range assignments {
			if a.WorkOrderID == wo.ID {
				operatorIDs = append(operatorIDs, a.OperatorID)
				operatorNames = append(operatorNames, a.OperatorName)
			}
		}
		progress := 0.0
		if wo.PlannedQuantity > 0 {
			progress = jsnum.Round1(float64(wo.OutputQuantity) / float64(wo.PlannedQuantity) * 100)
		}
		items = append(items, &Item{ID: wo.ID, Kind: "WORK_ORDER", Label: wo.WoNumber, WorkOrderID: db.Ptr(wo.ID), WorkOrderNumber: db.Ptr(wo.WoNumber),
			ProductID: db.Ptr(wo.ProductID), ProductName: productName(wo.ProductID), LineID: db.Ptr(wo.LineID), LineName: lineName(wo.LineID), WorkCenterID: wo.WorkCenterID,
			MachineID: wo.MachineID, MachineName: machineName(wo.MachineID), ProcessID: wo.ProcessID, ProcessName: processName(wo.ProcessID), MoldID: wo.MoldID, ShiftID: wo.ShiftID,
			OperatorIDs: operatorIDs, OperatorNames: operatorNames, PlannedStart: wo.PlannedStart, PlannedEnd: wo.PlannedEnd, ActualStart: wo.ActualStart, ActualEnd: wo.ActualEnd,
			Quantity: wo.PlannedQuantity, ProducedQuantity: wo.OutputQuantity, ProgressPercentage: progress, Priority: wo.Priority,
			Status: statusOf(wo, wo.MachineID != nil && blocked[*wo.MachineID], now), Conflicts: []Conflict{}})
	}

	// Maintenance windows share the machine lane, because a technician's two
	// hours and a work order's two hours are competing for the same machine.
	for _, rec := range records {
		start := rec.StartedAt
		if start == nil {
			start = rec.ScheduledFor
		}
		if start == nil {
			continue
		}
		end := rec.CompletedAt
		if end == nil {
			end = db.Ptr(db.ISO(parse(*start).Add(time.Duration(db.Deref(rec.DurationMinutes, 120)) * time.Minute)))
		}
		if !overlaps(window{parse(*start), parse(*end)}, win) {
			continue
		}
		if q.MachineID != "" && rec.MachineID != q.MachineID {
			continue
		}
		names := []string{}
		if rec.TechnicianName != nil {
			names = append(names, *rec.TechnicianName)
		}
		progress := 0.0
		if rec.Status == "COMPLETED" {
			progress = 100
		}
		items = append(items, &Item{ID: rec.ID, Kind: "MAINTENANCE", Label: rec.MaintenanceNumber + " · " + rec.MaintenanceType, MaintenanceRecordID: db.Ptr(rec.ID),
			MachineID: db.Ptr(rec.MachineID), MachineName: db.Ptr(rec.MachineName), OperatorIDs: []string{}, OperatorNames: names, PlannedStart: *start, PlannedEnd: *end,
			ActualStart: rec.StartedAt, ActualEnd: rec.CompletedAt, ProgressPercentage: progress, Status: "MAINTENANCE", Conflicts: []Conflict{}})
	}

	conflicts := detectConflicts(items)
	if err := s.annotateReadiness(ctx, tenantID, items); err != nil {
		return Board{}, err
	}
	return Board{ViewMode: viewMode, WindowStart: db.ISO(windowStart), WindowEnd: db.ISO(windowEnd), Lanes: s.buildLanes(viewMode, items, ref.shifts, ref.machines),
		Conflicts: conflicts, GeneratedAt: db.ISO(s.now())}, nil
}

// detectConflicts is §9.5 — machine, operator, mould and maintenance clashes,
// recorded on both items involved. Blocking is reserved for what makes
// execution physically impossible; a delivery risk is a warning.
func detectConflicts(items []*Item) []Conflict {
	conflicts := []Conflict{}
	record := func(c Conflict) {
		conflicts = append(conflicts, c)
		for _, it := range items {
			for _, id := range c.RelatedItemIDs {
				if it.ID == id {
					it.Conflicts = append(it.Conflicts, c)
					break
				}
			}
		}
	}
	win := func(it *Item) window { return window{parse(it.PlannedStart), parse(it.PlannedEnd)} }
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			a, b := items[i], items[j]
			if !overlaps(win(a), win(b)) {
				continue
			}
			if a.MachineID != nil && b.MachineID != nil && *a.MachineID == *b.MachineID {
				machine := db.Deref(a.MachineName, *a.MachineID)
				if a.Kind == "MAINTENANCE" || b.Kind == "MAINTENANCE" {
					record(Conflict{Type: "MAINTENANCE_CONFLICT", Blocking: true, Message: machine + " dijadwalkan maintenance dan produksi pada waktu yang sama.", RelatedItemIDs: []string{a.ID, b.ID}})
				} else {
					record(Conflict{Type: "MACHINE_CONFLICT", Blocking: true, Message: fmt.Sprintf("%s dan %s dijadwalkan pada mesin %s secara bersamaan.", a.Label, b.Label, machine), RelatedItemIDs: []string{a.ID, b.ID}})
				}
			}
			if a.MoldID != nil && b.MoldID != nil && *a.MoldID == *b.MoldID {
				record(Conflict{Type: "MOLD_CONFLICT", Blocking: true, Message: fmt.Sprintf("%s dan %s membutuhkan mold yang sama pada waktu yang bertumpang tindih.", a.Label, b.Label), RelatedItemIDs: []string{a.ID, b.ID}})
			}
			shared := false
			for _, id := range a.OperatorIDs {
				for _, other := range b.OperatorIDs {
					if id == other {
						shared = true
					}
				}
			}
			if shared {
				record(Conflict{Type: "OPERATOR_CONFLICT", Blocking: true, Message: fmt.Sprintf("Operator yang sama ditugaskan pada %s dan %s di waktu yang bertumpang tindih.", a.Label, b.Label), RelatedItemIDs: []string{a.ID, b.ID}})
			}
		}
	}
	for _, it := range items {
		if it.Status == "DELAYED" && it.Kind == "WORK_ORDER" {
			record(Conflict{Type: "DELIVERY_RISK", Blocking: false, Message: it.Label + " melewati jadwal selesai dan belum selesai.", RelatedItemIDs: []string{it.ID}})
		}
	}
	return conflicts
}

// annotateReadiness adds material and labour readiness to each work-order
// bar. A shortage is a non-blocking conflict: the plant may still choose to
// run a partial quantity, and it is not the board's place to refuse.
func (s *Service) annotateReadiness(ctx context.Context, tenantID string, items []*Item) error {
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(4)
	for _, it := range items {
		if it.Kind != "WORK_ORDER" || it.WorkOrderID == nil {
			continue
		}
		it := it
		g.Go(func() error {
			var extra []Conflict
			readiness, err := s.material.CheckWorkOrder(gctx, tenantID, *it.WorkOrderID)
			if err != nil {
				// A work order without a BOM has nothing to check; NOT_CHECKED says so.
				it.MaterialStatus = db.Ptr("NOT_CHECKED")
			} else {
				it.MaterialStatus = db.Ptr(readiness.Status)
				if readiness.Status == "SHORTAGE" || readiness.Status == "PARTIAL" {
					extra = append(extra, Conflict{Type: "MATERIAL_SHORTAGE", Blocking: false, Message: fmt.Sprintf("%d material belum mencukupi untuk %s.", readiness.ShortageRequirements, it.Label), RelatedItemIDs: []string{it.ID}})
				}
			}
			if labor, err := s.workforce.LaborStatus(gctx, tenantID, *it.WorkOrderID); err == nil {
				// Labour is optional configuration; its absence is not a conflict.
				it.LaborStatus = db.Ptr(labor.Status)
				if labor.Status == "SHORTAGE" {
					extra = append(extra, Conflict{Type: "LABOR_SHORTAGE", Blocking: false, Message: fmt.Sprintf("%s membutuhkan %d operator, %d ditugaskan.", it.Label, labor.RequiredOperators, labor.AssignedOperators), RelatedItemIDs: []string{it.ID}})
				}
			}
			it.Conflicts = append(it.Conflicts, extra...)
			return nil
		})
	}
	return g.Wait()
}

// buildLanes is §23's view modes, all of them the same items grouped differently.
func (s *Service) buildLanes(viewMode string, items []*Item, shifts []masterdata.Shift, machines []masterdata.Machine) []Lane {
	index := map[string]int{}
	lanes := []Lane{}
	laneOf := func(it *Item) (id, name string, subtitle *string) {
		switch viewMode {
		case "LINE":
			return db.Deref(it.LineID, "unassigned"), db.Deref(it.LineName, "Tanpa Line"), nil
		case "PROCESS":
			return db.Deref(it.ProcessID, "unassigned"), db.Deref(it.ProcessName, "Tanpa Proses"), nil
		case "SHIFT":
			name := "Tanpa Shift"
			if it.ShiftID != nil {
				for _, sh := range shifts {
					if sh.ID == *it.ShiftID {
						name, subtitle = sh.Name, db.Ptr(sh.StartTime+" – "+sh.EndTime)
					}
				}
			}
			return db.Deref(it.ShiftID, "unassigned"), name, subtitle
		case "CALENDAR":
			day := it.PlannedStart
			if len(day) > 10 {
				day = day[:10]
			}
			return day, day, nil
		case "TIMELINE":
			return "all", "Seluruh Jadwal", nil
		default:
			return db.Deref(it.MachineID, "unassigned"), db.Deref(it.MachineName, "Tanpa Mesin"), it.LineName
		}
	}
	for _, it := range items {
		id, name, subtitle := laneOf(it)
		i, ok := index[id]
		if !ok {
			i = len(lanes)
			index[id] = i
			lanes = append(lanes, Lane{ID: id, Name: name, Subtitle: subtitle, Items: []*Item{}})
		}
		lanes[i].Items = append(lanes[i].Items, it)
	}
	// Machine view lists every machine, including the idle ones: an empty lane
	// is the most useful thing on a dispatching board.
	if viewMode == "MACHINE" {
		for _, m := range machines {
			if _, ok := index[m.ID]; !ok {
				index[m.ID] = len(lanes)
				lanes = append(lanes, Lane{ID: m.ID, Name: m.Name, Items: []*Item{}})
			}
		}
	}
	for i := range lanes {
		sort.SliceStable(lanes[i].Items, func(a, b int) bool {
			return parse(lanes[i].Items[a].PlannedStart).Before(parse(lanes[i].Items[b].PlannedStart))
		})
	}
	sort.SliceStable(lanes, func(i, j int) bool { return jsnum.LocaleLess(lanes[i].Name, lanes[j].Name) })
	return lanes
}

// --- §9.6 Dispatch ---------------------------------------------------------

// Dispatch applies one change and records it. Rescheduling and machine
// reassignment are checked against the same conflicts the board draws, and
// BR-MT04 is enforced: a machine under maintenance takes no new work.
func (s *Service) Dispatch(ctx context.Context, tenantID string, a DispatchAction, actor Actor) (production.WorkOrder, error) {
	wo, err := s.production.WorkOrderByID(ctx, tenantID, a.WorkOrderID)
	if err != nil {
		return production.WorkOrder{}, err
	}
	if wo == nil {
		return production.WorkOrder{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	before := map[string]any{"plannedStart": wo.PlannedStart, "plannedEnd": wo.PlannedEnd, "machineId": wo.MachineID, "priority": wo.Priority, "sequence": wo.Sequence}

	var updated production.WorkOrder
	switch a.Action {
	case "RESCHEDULE":
		if a.PlannedStart == nil || a.PlannedEnd == nil || *a.PlannedStart == "" || *a.PlannedEnd == "" {
			return production.WorkOrder{}, httpx.Validation("Jadwal baru memerlukan plannedStart dan plannedEnd.")
		}
		if !parse(*a.PlannedEnd).After(parse(*a.PlannedStart)) {
			return production.WorkOrder{}, httpx.Validation("plannedEnd harus setelah plannedStart.")
		}
		if err := s.assertNoMachineClash(ctx, tenantID, *wo, wo.MachineID, *a.PlannedStart, *a.PlannedEnd); err != nil {
			return production.WorkOrder{}, err
		}
		updated, err = s.production.UpdateWorkOrder(ctx, tenantID, a.WorkOrderID, production.Patch{PlannedStart: a.PlannedStart, PlannedEnd: a.PlannedEnd}, nil)
	case "REASSIGN_MACHINE":
		if a.MachineID == nil || *a.MachineID == "" {
			return production.WorkOrder{}, httpx.Validation("machineId wajib diisi.")
		}
		blocked, err := s.maintenance.IsMachineBlocked(ctx, tenantID, *a.MachineID)
		if err != nil {
			return production.WorkOrder{}, err
		}
		if blocked {
			return production.WorkOrder{}, httpx.Conflict("Mesin sedang dalam maintenance dan tidak dapat menerima work order baru (BR-MT04).")
		}
		if err := s.assertNoMachineClash(ctx, tenantID, *wo, a.MachineID, db.Deref(a.PlannedStart, wo.PlannedStart), db.Deref(a.PlannedEnd, wo.PlannedEnd)); err != nil {
			return production.WorkOrder{}, err
		}
		updated, err = s.production.UpdateWorkOrder(ctx, tenantID, a.WorkOrderID, production.Patch{MachineID: a.MachineID}, nil)
		if err != nil {
			return production.WorkOrder{}, err
		}
	case "REASSIGN_OPERATOR":
		wanted := a.OperatorIDs
		current, err := s.workforce.Assignments(ctx, tenantID, workforce.AssignmentFilter{WorkOrderID: a.WorkOrderID, Active: true})
		if err != nil {
			return production.WorkOrder{}, err
		}
		wfActor := workforce.Actor{ID: actor.ID, Name: actor.Name}
		for _, asg := range current {
			if !contains(wanted, asg.OperatorID) {
				if err := s.workforce.UnassignOperator(ctx, tenantID, asg.ID, wfActor); err != nil {
					return production.WorkOrder{}, err
				}
			}
		}
		for _, operatorID := range wanted {
			already := false
			for _, asg := range current {
				if asg.OperatorID == operatorID {
					already = true
				}
			}
			if already {
				continue
			}
			if _, err := s.workforce.AssignOperator(ctx, tenantID, a.WorkOrderID, operatorID, nil, nil, false, wfActor); err != nil {
				return production.WorkOrder{}, err
			}
		}
		fresh, err := s.production.WorkOrderByID(ctx, tenantID, a.WorkOrderID)
		if err != nil {
			return production.WorkOrder{}, err
		}
		updated = *fresh
	case "RESEQUENCE":
		if a.Sequence == nil {
			return production.WorkOrder{}, httpx.Validation("sequence wajib diisi.")
		}
		updated, err = s.production.UpdateWorkOrder(ctx, tenantID, a.WorkOrderID, production.Patch{Sequence: a.Sequence}, nil)
	case "REPRIORITISE":
		if a.Priority == nil {
			return production.WorkOrder{}, httpx.Validation("priority wajib diisi.")
		}
		updated, err = s.production.UpdateWorkOrder(ctx, tenantID, a.WorkOrderID, production.Patch{Priority: a.Priority}, nil)
	case "CONFIRM":
		updated, err = s.production.ConfirmWorkOrder(ctx, tenantID, a.WorkOrderID, &actor.ID)
	case "CANCEL":
		if a.Reason == nil || *a.Reason == "" {
			return production.WorkOrder{}, httpx.Validation("Pembatalan memerlukan alasan.")
		}
		updated, err = s.production.CancelWorkOrder(ctx, tenantID, a.WorkOrderID, a.Reason)
	default:
		return production.WorkOrder{}, httpx.Validation("Aksi dispatch tidak dikenal.")
	}
	if err != nil {
		return production.WorkOrder{}, err
	}

	eventType := "SCHEDULE_CHANGED"
	if a.Action == "CANCEL" {
		eventType = "WO_CANCELLED"
	}
	summary := updated.WoNumber + ": " + a.Action
	if a.Reason != nil && *a.Reason != "" {
		summary += " — " + *a.Reason
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: eventType, EntityType: "WORK_ORDER", EntityID: a.WorkOrderID, ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: &a.WorkOrderID, MachineID: updated.MachineID, LineID: &updated.LineID, Summary: summary, BeforeValue: before,
		AfterValue: map[string]any{"plannedStart": updated.PlannedStart, "plannedEnd": updated.PlannedEnd, "machineId": updated.MachineID, "priority": updated.Priority, "sequence": updated.Sequence}})
	return updated, nil
}

// assertNoMachineClash refuses a change that would double-book a machine.
func (s *Service) assertNoMachineClash(ctx context.Context, tenantID string, wo production.WorkOrder, machineID *string, start, end string) error {
	if machineID == nil || *machineID == "" {
		return nil
	}
	others, err := s.production.WorkOrders(ctx, tenantID, production.WorkOrderFilter{})
	if err != nil {
		return err
	}
	target := window{parse(start), parse(end)}
	for _, c := range others {
		if c.ID == wo.ID || c.MachineID == nil || *c.MachineID != *machineID || c.Status == "CANCELLED" || c.Status == "COMPLETED" {
			continue
		}
		if overlaps(target, window{parse(c.PlannedStart), parse(c.PlannedEnd)}) {
			return httpx.Conflict(fmt.Sprintf("Jadwal bentrok dengan %s pada mesin yang sama (%s – %s).", c.WoNumber, c.PlannedStart, c.PlannedEnd))
		}
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
