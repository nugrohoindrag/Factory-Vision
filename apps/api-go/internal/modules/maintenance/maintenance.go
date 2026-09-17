// Package maintenance is the maintenance lifecycle (Improvement PRD
// §19–§22): preventive plans with calendar or meter triggers, requests
// from the floor, records from planned through in-progress to completed,
// the emergency path that opens a downtime and takes the machine OFFLINE,
// and the reliability KPIs.
package maintenance

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/machinestate"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

// Plan is the TypeScript MaintenancePlan.
type Plan struct {
	ID                       string   `json:"id"`
	TenantID                 string   `json:"tenantId"`
	PlanNumber               string   `json:"planNumber"`
	Name                     string   `json:"name"`
	MachineID                string   `json:"machineId"`
	MachineName              string   `json:"machineName"`
	TriggerType              string   `json:"triggerType"`
	IntervalValue            float64  `json:"intervalValue"`
	IntervalUnit             string   `json:"intervalUnit"`
	Tasks                    []string `json:"tasks"`
	EstimatedDurationMinutes *int     `json:"estimatedDurationMinutes,omitempty"`
	LastPerformedAt          *string  `json:"lastPerformedAt,omitempty"`
	LastPerformedMeter       *float64 `json:"lastPerformedMeter,omitempty"`
	NextDueAt                *string  `json:"nextDueAt,omitempty"`
	NextDueMeter             *float64 `json:"nextDueMeter,omitempty"`
	WarningThreshold         *float64 `json:"warningThreshold,omitempty"`
	Status                   string   `json:"status"`
	DueStatus                *string  `json:"dueStatus,omitempty"`
	CreatedBy                *string  `json:"createdBy,omitempty"`
	CreatedAt                string   `json:"createdAt"`
	UpdatedAt                string   `json:"updatedAt"`
}

// Request is the TypeScript MaintenanceRequest.
type Request struct {
	ID                  string  `json:"id"`
	TenantID            string  `json:"tenantId"`
	RequestNumber       string  `json:"requestNumber"`
	MachineID           string  `json:"machineId"`
	MachineName         string  `json:"machineName"`
	MaintenanceType     string  `json:"maintenanceType"`
	Priority            string  `json:"priority"`
	ProblemDescription  string  `json:"problemDescription"`
	ReportedSymptom     *string `json:"reportedSymptom,omitempty"`
	WorkOrderID         *string `json:"workOrderId,omitempty"`
	DowntimeID          *string `json:"downtimeId,omitempty"`
	RequestedBy         string  `json:"requestedBy"`
	RequestedByName     *string `json:"requestedByName,omitempty"`
	RequestedAt         string  `json:"requestedAt"`
	Status              string  `json:"status"`
	MaintenanceRecordID *string `json:"maintenanceRecordId,omitempty"`
	Notes               *string `json:"notes,omitempty"`
}

// PartUsage is one part consumed by a record.
type PartUsage struct {
	ID                  string   `json:"id"`
	MaintenanceRecordID string   `json:"maintenanceRecordId"`
	PartID              *string  `json:"partId,omitempty"`
	PartName            string   `json:"partName"`
	Quantity            float64  `json:"quantity"`
	UOM                 string   `json:"uom"`
	CostReference       *float64 `json:"costReference,omitempty"`
}

// Record is the TypeScript MaintenanceRecord.
type Record struct {
	ID                   string      `json:"id"`
	TenantID             string      `json:"tenantId"`
	MaintenanceNumber    string      `json:"maintenanceNumber"`
	MachineID            string      `json:"machineId"`
	MachineName          string      `json:"machineName"`
	MaintenanceType      string      `json:"maintenanceType"`
	MaintenancePlanID    *string     `json:"maintenancePlanId,omitempty"`
	MaintenanceRequestID *string     `json:"maintenanceRequestId,omitempty"`
	DowntimeID           *string     `json:"downtimeId,omitempty"`
	Status               string      `json:"status"`
	Problem              *string     `json:"problem,omitempty"`
	RootCause            *string     `json:"rootCause,omitempty"`
	ActionTaken          *string     `json:"actionTaken,omitempty"`
	RequesterID          *string     `json:"requesterId,omitempty"`
	RequesterName        *string     `json:"requesterName,omitempty"`
	TechnicianID         *string     `json:"technicianId,omitempty"`
	TechnicianName       *string     `json:"technicianName,omitempty"`
	ScheduledFor         *string     `json:"scheduledFor,omitempty"`
	StartedAt            *string     `json:"startedAt,omitempty"`
	CompletedAt          *string     `json:"completedAt,omitempty"`
	DurationMinutes      *int        `json:"durationMinutes,omitempty"`
	Result               *string     `json:"result,omitempty"`
	CostReference        *float64    `json:"costReference,omitempty"`
	Parts                []PartUsage `json:"parts"`
	Notes                *string     `json:"notes,omitempty"`
	CreatedAt            string      `json:"createdAt"`
	UpdatedAt            string      `json:"updatedAt"`
}

// Kpi is the TypeScript MaintenanceKpi with its window.
type Kpi struct {
	MachineAvailabilityPercentage float64 `json:"machineAvailabilityPercentage"`
	PmCompliancePercentage        float64 `json:"pmCompliancePercentage"`
	BreakdownCount                int     `json:"breakdownCount"`
	MtbfHours                     float64 `json:"mtbfHours"`
	MttrHours                     float64 `json:"mttrHours"`
	OverdueCount                  int     `json:"overdueCount"`
	EmergencyCount                int     `json:"emergencyCount"`
	MaintenanceDowntimeMinutes    float64 `json:"maintenanceDowntimeMinutes"`
	From                          string  `json:"from"`
	To                            string  `json:"to"`
}

// Emergency is the outcome of the emergency path.
type Emergency struct {
	Record     Record  `json:"record"`
	DowntimeID *string `json:"downtimeId,omitempty"`
}

// Actor is who performed a maintenance action.
type Actor struct {
	ID   string
	Name *string
	Type string
}

// Recorder is the event timeline.
type Recorder interface {
	RecordDetached(in event.Input)
}

// Service is the maintenance lifecycle.
type Service struct {
	pool      *db.Pool
	repo      Repository
	master    *masterdata.Service
	shopfloor *shopfloor.Service
	events    Recorder
	log       *slog.Logger
	now       func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, master *masterdata.Service, sf *shopfloor.Service, events Recorder, log *slog.Logger) *Service {
	return &Service{pool: pool, master: master, shopfloor: sf, events: events, log: log, now: time.Now}
}

func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// --- Plans -----------------------------------------------------------------

// DueStatus classifies a plan against the clock or the meter.
func (s *Service) dueStatus(p Plan, meter *float64) string {
	if p.Status != "ACTIVE" {
		return "SKIPPED"
	}
	if p.TriggerType == "CALENDAR" {
		if p.NextDueAt == nil {
			return "UPCOMING"
		}
		due, err := db.ParseISO(*p.NextDueAt)
		if err != nil {
			return "UPCOMING"
		}
		now := s.now()
		if now.After(due) {
			return "OVERDUE"
		}
		warningDays := 3.0
		if p.WarningThreshold != nil {
			warningDays = *p.WarningThreshold
		}
		if due.Sub(now) <= time.Duration(warningDays*float64(24*time.Hour)) {
			return "DUE"
		}
		return "UPCOMING"
	}
	if p.NextDueMeter == nil || meter == nil {
		return "UPCOMING"
	}
	if *meter >= *p.NextDueMeter {
		return "OVERDUE"
	}
	warning := p.IntervalValue * 0.1
	if p.WarningThreshold != nil {
		warning = *p.WarningThreshold
	}
	if *p.NextDueMeter-*meter <= warning {
		return "DUE"
	}
	return "UPCOMING"
}

func (s *Service) withDue(p Plan) Plan {
	p.DueStatus = db.Ptr(s.dueStatus(p, nil))
	return p
}

func computeNextDue(p Plan, performedAt string, meter *float64) (nextDueAt *string, nextDueMeter *float64) {
	if p.TriggerType == "CALENDAR" {
		days := p.IntervalValue
		switch strings.ToUpper(p.IntervalUnit) {
		case "WEEK":
			days = p.IntervalValue * 7
		case "MONTH":
			days = p.IntervalValue * 30
		}
		at, err := db.ParseISO(performedAt)
		if err != nil {
			at = time.Now()
		}
		return db.Ptr(db.ISO(at.Add(time.Duration(days * float64(24*time.Hour))))), nil
	}
	base := 0.0
	if meter != nil {
		base = *meter
	} else if p.LastPerformedMeter != nil {
		base = *p.LastPerformedMeter
	}
	return nil, db.Ptr(base + p.IntervalValue)
}

// Plans lists plans with their due status.
func (s *Service) Plans(ctx context.Context, tenantID string, f PlanFilter) ([]Plan, error) {
	var out []Plan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListPlans(ctx, tx, tenantID, f)
		return err
	})
	for i := range out {
		out[i] = s.withDue(out[i])
	}
	return out, err
}

// PlanInput is a new plan.
type PlanInput struct {
	Name                     string
	MachineID                string
	TriggerType              string
	IntervalValue            float64
	IntervalUnit             *string
	Tasks                    []string
	EstimatedDurationMinutes *float64
	WarningThreshold         *float64
	StartFrom                *string
}

func (s *Service) machine(ctx context.Context, tenantID, id string) (*masterdata.Machine, error) {
	m, err := s.master.MachineByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return nil, httpx.NotFound("Mesin tidak ditemukan.")
	}
	return m, nil
}

// CreatePlan stores an ACTIVE plan numbered PM-<year>-NNNN with its first
// due date computed from startFrom (default now).
func (s *Service) CreatePlan(ctx context.Context, tenantID string, in PlanInput, actor Actor) (Plan, error) {
	machine, err := s.machine(ctx, tenantID, in.MachineID)
	if err != nil {
		return Plan{}, err
	}
	now := db.ISO(s.now())
	var out Plan
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "maintenance_plan", "PM")
		if err != nil {
			return err
		}
		unit := db.Deref(in.IntervalUnit, "")
		if unit == "" {
			unit = "HOUR"
			if in.TriggerType == "CALENDAR" {
				unit = "DAY"
			}
		}
		tasks := in.Tasks
		if tasks == nil {
			tasks = []string{}
		}
		out = Plan{ID: fmt.Sprintf("mplan-%d", s.now().UnixMilli()), TenantID: tenantID, PlanNumber: number, Name: in.Name, MachineID: in.MachineID, MachineName: machine.Name,
			TriggerType: in.TriggerType, IntervalValue: in.IntervalValue, IntervalUnit: unit, Tasks: tasks, WarningThreshold: in.WarningThreshold,
			Status: "ACTIVE", CreatedBy: &actor.ID, CreatedAt: now, UpdatedAt: now}
		if in.EstimatedDurationMinutes != nil {
			out.EstimatedDurationMinutes = db.Ptr(int(*in.EstimatedDurationMinutes))
		}
		out.NextDueAt, out.NextDueMeter = computeNextDue(out, db.Deref(in.StartFrom, now), nil)
		if err := s.repo.UpsertPlan(ctx, tx, out); err != nil {
			return err
		}
		out = s.withDue(out)
		return nil
	})
	return out, err
}

// PlanPatch is what an update may change.
type PlanPatch struct {
	Name, MachineID, TriggerType, IntervalUnit, Status, NextDueAt, LastPerformedAt *string
	IntervalValue, WarningThreshold, NextDueMeter, LastPerformedMeter              *float64
	EstimatedDurationMinutes                                                       *int
	Tasks                                                                          []string
	HasTasks                                                                       bool
}

// UpdatePlan patches a plan.
func (s *Service) UpdatePlan(ctx context.Context, tenantID, id string, p PlanPatch) (Plan, error) {
	var out Plan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		list, err := s.repo.ListPlans(ctx, tx, tenantID, PlanFilter{ID: id})
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return httpx.NotFound("Maintenance Plan tidak ditemukan.")
		}
		out = list[0]
		if p.Name != nil {
			out.Name = *p.Name
		}
		if p.MachineID != nil {
			out.MachineID = *p.MachineID
		}
		if p.TriggerType != nil {
			out.TriggerType = *p.TriggerType
		}
		if p.IntervalUnit != nil {
			out.IntervalUnit = *p.IntervalUnit
		}
		if p.Status != nil {
			out.Status = *p.Status
		}
		if p.NextDueAt != nil {
			out.NextDueAt = db.Str(p.NextDueAt)
		}
		if p.LastPerformedAt != nil {
			out.LastPerformedAt = db.Str(p.LastPerformedAt)
		}
		if p.IntervalValue != nil {
			out.IntervalValue = *p.IntervalValue
		}
		if p.WarningThreshold != nil {
			out.WarningThreshold = p.WarningThreshold
		}
		if p.NextDueMeter != nil {
			out.NextDueMeter = p.NextDueMeter
		}
		if p.LastPerformedMeter != nil {
			out.LastPerformedMeter = p.LastPerformedMeter
		}
		if p.EstimatedDurationMinutes != nil {
			out.EstimatedDurationMinutes = p.EstimatedDurationMinutes
		}
		if p.HasTasks {
			out.Tasks = p.Tasks
		}
		out.UpdatedAt = db.ISO(s.now())
		out.DueStatus = nil
		if err := s.repo.UpsertPlan(ctx, tx, out); err != nil {
			return err
		}
		if m, err := s.master.MachineByID(ctx, tenantID, out.MachineID); err == nil && m != nil {
			out.MachineName = m.Name
		}
		out = s.withDue(out)
		return nil
	})
	return out, err
}

// DeletePlan removes a plan.
func (s *Service) DeletePlan(ctx context.Context, tenantID, id string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.DeletePlan(ctx, tx, tenantID, id) })
}

// GenerateDueWork opens a PLANNED record for every DUE or OVERDUE plan
// that has none open yet.
func (s *Service) GenerateDueWork(ctx context.Context, tenantID string, actor Actor) ([]Record, error) {
	plans, err := s.Plans(ctx, tenantID, PlanFilter{Status: "ACTIVE"})
	if err != nil {
		return nil, err
	}
	created := []Record{}
	for _, plan := range plans {
		if plan.DueStatus == nil || (*plan.DueStatus != "DUE" && *plan.DueStatus != "OVERDUE") {
			continue
		}
		open, err := s.Records(ctx, tenantID, RecordFilter{MachineID: plan.MachineID, Limit: 50})
		if err != nil {
			return nil, err
		}
		queued := false
		for _, r := range open {
			if r.MaintenancePlanID != nil && *r.MaintenancePlanID == plan.ID && r.Status != "COMPLETED" && r.Status != "CANCELLED" {
				queued = true
				break
			}
		}
		if queued {
			continue
		}
		problem := strings.Join(plan.Tasks, ", ")
		if problem == "" {
			problem = plan.Name
		}
		planID := plan.ID
		record, err := s.CreateRecord(ctx, tenantID, RecordInput{MachineID: plan.MachineID, MaintenanceType: "PREVENTIVE", MaintenancePlanID: &planID,
			Problem: &problem, ScheduledFor: plan.NextDueAt, Status: db.Ptr("PLANNED")}, actor)
		if err != nil {
			return nil, err
		}
		created = append(created, record)
	}
	return created, nil
}

// --- Requests --------------------------------------------------------------

// RequestInput is a new request from the floor.
type RequestInput struct {
	MachineID          string
	MaintenanceType    *string
	Priority           *string
	ProblemDescription string
	ReportedSymptom    *string
	WorkOrderID        *string
	DowntimeID         *string
	Notes              *string
}

// CreateRequest files a REQUESTED request numbered MR-<year>-NNNN.
func (s *Service) CreateRequest(ctx context.Context, tenantID string, in RequestInput, actor Actor) (Request, error) {
	machine, err := s.machine(ctx, tenantID, in.MachineID)
	if err != nil {
		return Request{}, err
	}
	var out Request
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "maintenance_request", "MR")
		if err != nil {
			return err
		}
		out = Request{ID: fmt.Sprintf("mreq-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, RequestNumber: number, MachineID: in.MachineID, MachineName: machine.Name,
			MaintenanceType: db.Deref(in.MaintenanceType, "CORRECTIVE"), Priority: db.Deref(in.Priority, "MEDIUM"), ProblemDescription: in.ProblemDescription,
			ReportedSymptom: db.Str(in.ReportedSymptom), WorkOrderID: db.Str(in.WorkOrderID), DowntimeID: db.Str(in.DowntimeID), RequestedBy: actor.ID, RequestedByName: actor.Name,
			RequestedAt: db.ISO(s.now()), Status: "REQUESTED", Notes: db.Str(in.Notes)}
		if out.MaintenanceType == "" {
			out.MaintenanceType = "CORRECTIVE"
		}
		if out.Priority == "" {
			out.Priority = "MEDIUM"
		}
		return s.repo.InsertRequest(ctx, tx, out)
	})
	if err != nil {
		return Request{}, err
	}
	actorType := actor.Type
	if actorType == "" {
		actorType = "USER"
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "MAINTENANCE_REQUESTED", EntityType: "MACHINE", EntityID: out.MachineID, ActorType: actorType,
		ActorID: &actor.ID, ActorName: actor.Name, MachineID: &out.MachineID, WorkOrderID: out.WorkOrderID, Summary: out.RequestNumber + ": " + out.ProblemDescription,
		AfterValue: map[string]any{"priority": out.Priority, "maintenanceType": out.MaintenanceType}})
	return out, nil
}

// Requests lists requests.
func (s *Service) Requests(ctx context.Context, tenantID string, f RequestFilter) ([]Request, error) {
	var out []Request
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListRequests(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// AcceptRequest turns a request into a PLANNED record.
func (s *Service) AcceptRequest(ctx context.Context, tenantID, requestID string, technicianID, technicianName, scheduledFor *string, actor Actor) (Record, error) {
	requests, err := s.Requests(ctx, tenantID, RequestFilter{ID: requestID})
	if err != nil {
		return Record{}, err
	}
	if len(requests) == 0 {
		return Record{}, httpx.NotFound("Maintenance Request tidak ditemukan.")
	}
	request := requests[0]
	if request.Status == "CONVERTED" {
		return Record{}, httpx.InvalidState("Permintaan ini sudah menjadi pekerjaan maintenance.")
	}
	record, err := s.CreateRecord(ctx, tenantID, RecordInput{MachineID: request.MachineID, MaintenanceType: request.MaintenanceType, MaintenanceRequestID: &request.ID,
		DowntimeID: request.DowntimeID, Problem: &request.ProblemDescription, RequesterID: &request.RequestedBy, RequesterName: request.RequestedByName,
		TechnicianID: technicianID, TechnicianName: technicianName, ScheduledFor: scheduledFor, Status: db.Ptr("PLANNED")}, actor)
	if err != nil {
		return Record{}, err
	}
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.SetRequestStatus(ctx, tx, tenantID, requestID, "CONVERTED", &record.ID)
	})
	return record, err
}

// RejectRequest marks a request REJECTED.
func (s *Service) RejectRequest(ctx context.Context, tenantID, requestID string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.SetRequestStatus(ctx, tx, tenantID, requestID, "REJECTED", nil) })
}

// --- Records ---------------------------------------------------------------

// RecordInput is a new record.
type RecordInput struct {
	MachineID            string
	MaintenanceType      string
	MaintenancePlanID    *string
	MaintenanceRequestID *string
	DowntimeID           *string
	Problem              *string
	RequesterID          *string
	RequesterName        *string
	TechnicianID         *string
	TechnicianName       *string
	ScheduledFor         *string
	Status               *string
	Notes                *string
}

// CreateRecord opens a record numbered MT-<year>-NNNN.
func (s *Service) CreateRecord(ctx context.Context, tenantID string, in RecordInput, actor Actor) (Record, error) {
	machine, err := s.machine(ctx, tenantID, in.MachineID)
	if err != nil {
		return Record{}, err
	}
	now := db.ISO(s.now())
	var out Record
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "maintenance_record", "MT")
		if err != nil {
			return err
		}
		out = Record{ID: fmt.Sprintf("mtn-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, MaintenanceNumber: number, MachineID: in.MachineID, MachineName: machine.Name,
			MaintenanceType: in.MaintenanceType, MaintenancePlanID: db.Str(in.MaintenancePlanID), MaintenanceRequestID: db.Str(in.MaintenanceRequestID), DowntimeID: db.Str(in.DowntimeID),
			Status: db.Deref(in.Status, "PLANNED"), Problem: db.Str(in.Problem), RequesterID: db.Str(in.RequesterID), RequesterName: db.Str(in.RequesterName),
			TechnicianID: db.Str(in.TechnicianID), TechnicianName: db.Str(in.TechnicianName), ScheduledFor: db.Str(in.ScheduledFor), Parts: []PartUsage{}, Notes: db.Str(in.Notes),
			CreatedAt: now, UpdatedAt: now}
		if out.Status == "" {
			out.Status = "PLANNED"
		}
		if out.RequesterID == nil {
			out.RequesterID = &actor.ID
		}
		if out.RequesterName == nil {
			out.RequesterName = actor.Name
		}
		return s.repo.InsertRecord(ctx, tx, out)
	})
	return out, err
}

// Records lists records.
func (s *Service) Records(ctx context.Context, tenantID string, f RecordFilter) ([]Record, error) {
	var out []Record
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListRecords(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

func (s *Service) record(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Record, error) {
	list, err := s.repo.ListRecords(ctx, tx, tenantID, RecordFilter{ID: id})
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// AssignTechnician sets who does the work and when.
func (s *Service) AssignTechnician(ctx context.Context, tenantID, id, technicianID string, technicianName, scheduledFor *string) (Record, error) {
	var out Record
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if err := s.repo.UpdateRecord(ctx, tx, tenantID, id, RecordPatch{TechnicianID: &technicianID, TechnicianName: technicianName, ScheduledFor: scheduledFor}); err != nil {
			return err
		}
		r, err := s.record(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if r == nil {
			return httpx.NotFound("Maintenance Record tidak ditemukan.")
		}
		out = *r
		return nil
	})
	return out, err
}

func (s *Service) setMachineState(ctx context.Context, tenantID, machineID, state string) {
	if _, err := s.master.UpdateMachine(ctx, tenantID, machineID, masterdata.Patch{"currentState": state}); err != nil && s.log != nil {
		s.log.Error("[maintenance] gagal memperbarui status mesin", "error", err)
	}
}

// StartWork moves a record to IN_PROGRESS and takes the machine OFFLINE.
func (s *Service) StartWork(ctx context.Context, tenantID, id string, actor Actor) (Record, error) {
	var out Record
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.record(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if existing == nil {
			return httpx.NotFound("Maintenance Record tidak ditemukan.")
		}
		if existing.Status == "COMPLETED" {
			return httpx.InvalidState("Pekerjaan maintenance ini sudah selesai.")
		}
		patch := RecordPatch{Status: db.Ptr("IN_PROGRESS"), StartedAt: db.Ptr(db.Deref(existing.StartedAt, db.ISO(s.now()))),
			TechnicianID: existing.TechnicianID, TechnicianName: existing.TechnicianName}
		if patch.TechnicianID == nil {
			patch.TechnicianID = &actor.ID
		}
		if patch.TechnicianName == nil {
			patch.TechnicianName = actor.Name
		}
		if err := s.repo.UpdateRecord(ctx, tx, tenantID, id, patch); err != nil {
			return err
		}
		updated, err := s.record(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		out = *updated
		return nil
	})
	if err != nil {
		return Record{}, err
	}
	s.setMachineState(ctx, tenantID, out.MachineID, machinestate.Offline)
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "MAINTENANCE_STARTED", EntityType: "MACHINE", EntityID: out.MachineID, ActorType: "USER", ActorID: &actor.ID,
		ActorName: actor.Name, MachineID: &out.MachineID, Summary: fmt.Sprintf("%s (%s) dimulai pada %s.", out.MaintenanceNumber, out.MaintenanceType, out.MachineName),
		AfterValue: map[string]any{"status": "IN_PROGRESS", "technicianId": out.TechnicianID}})
	return out, nil
}

// PartInput is one part used.
type PartInput struct {
	PartID        *string
	PartName      string
	Quantity      float64
	UOM           *string
	CostReference *float64
}

// CompleteInput closes a record.
type CompleteInput struct {
	Result        string
	RootCause     *string
	ActionTaken   *string
	CostReference *float64
	Notes         *string
	MeterReading  *float64
	Parts         []PartInput
}

// CompleteWork closes a record, books its parts, rolls its plan forward,
// resolves the linked downtime and returns the machine to IDLE.
func (s *Service) CompleteWork(ctx context.Context, tenantID, id string, in CompleteInput, actor Actor) (Record, error) {
	if in.Result == "" {
		return Record{}, httpx.Validation("Hasil penyelesaian maintenance wajib diisi.")
	}
	var out Record
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.record(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if existing == nil {
			return httpx.NotFound("Maintenance Record tidak ditemukan.")
		}
		if existing.Status == "COMPLETED" {
			out = *existing
			return nil
		}
		completedAt := db.ISO(s.now())
		startedAt := db.Deref(existing.StartedAt, completedAt)
		start, _ := db.ParseISO(startedAt)
		end, _ := db.ParseISO(completedAt)
		duration := jsnum.RoundInt(math.Max(0, end.Sub(start).Minutes()))
		if err := s.repo.UpdateRecord(ctx, tx, tenantID, id, RecordPatch{Status: db.Ptr("COMPLETED"), StartedAt: &startedAt, CompletedAt: &completedAt, DurationMinutes: &duration,
			Result: &in.Result, RootCause: in.RootCause, ActionTaken: in.ActionTaken, CostReference: in.CostReference, Notes: in.Notes}); err != nil {
			return err
		}
		for i, part := range in.Parts {
			if err := s.repo.InsertPart(ctx, tx, tenantID, PartUsage{ID: fmt.Sprintf("mpart-%d-%d", s.now().UnixMilli(), i+1), MaintenanceRecordID: id, PartID: db.Str(part.PartID),
				PartName: part.PartName, Quantity: part.Quantity, UOM: db.Deref(part.UOM, "PCS"), CostReference: part.CostReference}); err != nil {
				return err
			}
		}
		if existing.MaintenancePlanID != nil {
			plans, err := s.repo.ListPlans(ctx, tx, tenantID, PlanFilter{ID: *existing.MaintenancePlanID})
			if err != nil {
				return err
			}
			if len(plans) > 0 {
				plan := plans[0]
				plan.LastPerformedAt = &completedAt
				if in.MeterReading != nil {
					plan.LastPerformedMeter = in.MeterReading
				}
				plan.NextDueAt, plan.NextDueMeter = computeNextDue(plan, completedAt, in.MeterReading)
				plan.UpdatedAt = completedAt
				if err := s.repo.UpsertPlan(ctx, tx, plan); err != nil {
					return err
				}
			}
		}
		updated, err := s.record(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		out = *updated
		return nil
	})
	if err != nil {
		return Record{}, err
	}
	if out.DowntimeID != nil {
		if _, err := s.shopfloor.ResolveDowntime(ctx, tenantID, *out.DowntimeID, shopfloor.ResolveInput{
			ClientEventID: "maintenance-complete-" + out.ID, OccurredAt: db.Deref(out.CompletedAt, db.ISO(s.now()))}); err != nil && s.log != nil {
			s.log.Error("[maintenance] gagal menutup downtime terkait", "error", err)
		}
	}
	s.setMachineState(ctx, tenantID, out.MachineID, machinestate.Idle)
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "MAINTENANCE_COMPLETED", EntityType: "MACHINE", EntityID: out.MachineID, ActorType: "USER", ActorID: &actor.ID,
		ActorName: actor.Name, MachineID: &out.MachineID, Summary: fmt.Sprintf("%s selesai (%s), %d menit.", out.MaintenanceNumber, in.Result, db.Deref(out.DurationMinutes, 0)),
		AfterValue: map[string]any{"result": in.Result, "durationMinutes": out.DurationMinutes, "rootCause": in.RootCause}})
	return out, nil
}

// EmergencyInput is a breakdown reported from the floor.
type EmergencyInput struct {
	MachineID      string
	Problem        string
	WorkOrderID    *string
	LineID         *string
	OperatorID     *string
	ShiftID        *string
	ReasonID       *string
	TechnicianID   *string
	TechnicianName *string
}

func (s *Service) emergencyReasonID(ctx context.Context, tenantID string) (*string, error) {
	reasons, err := s.master.DowntimeReasons(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, r := range reasons {
		if r.Code == "MT-EMG" && r.Active {
			id := r.ID
			return &id, nil
		}
	}
	for _, r := range reasons {
		if r.Category == "MACHINE" && !r.IsPlanned && r.Active {
			id := r.ID
			return &id, nil
		}
	}
	return nil, nil
}

// RaiseEmergency opens a downtime, an IN_PROGRESS EMERGENCY record and
// takes the machine OFFLINE.
func (s *Service) RaiseEmergency(ctx context.Context, tenantID string, in EmergencyInput, actor Actor) (Emergency, error) {
	machine, err := s.machine(ctx, tenantID, in.MachineID)
	if err != nil {
		return Emergency{}, err
	}
	var downtimeID *string
	reasonID := in.ReasonID
	if reasonID == nil || *reasonID == "" {
		if reasonID, err = s.emergencyReasonID(ctx, tenantID); err != nil {
			return Emergency{}, err
		}
	}
	if reasonID != nil {
		lineID := in.LineID
		if lineID == nil || *lineID == "" {
			if wcs, err := s.master.WorkCenters(ctx, tenantID); err == nil {
				for _, wc := range wcs {
					if wc.ID == machine.WorkCenterID {
						id := wc.ProductionLineID
						lineID = &id
						break
					}
				}
			}
		}
		downtime, err := s.shopfloor.StartDowntime(ctx, tenantID, shopfloor.DowntimeInput{MachineID: in.MachineID, LineID: lineID, WorkOrderID: in.WorkOrderID, OperatorID: in.OperatorID,
			ShiftID: in.ShiftID, ReasonID: *reasonID, Notes: &in.Problem, ClientEventID: fmt.Sprintf("emergency-%d-%s", s.now().UnixMilli(), in.MachineID), OccurredAt: db.ISO(s.now())})
		if err != nil {
			if s.log != nil {
				s.log.Error("[maintenance] gagal membuka downtime untuk emergency", "error", err)
			}
		} else {
			downtimeID = &downtime.ID
		}
	}
	record, err := s.CreateRecord(ctx, tenantID, RecordInput{MachineID: in.MachineID, MaintenanceType: "EMERGENCY", DowntimeID: downtimeID, Problem: &in.Problem,
		TechnicianID: in.TechnicianID, TechnicianName: in.TechnicianName, Status: db.Ptr("IN_PROGRESS")}, actor)
	if err != nil {
		return Emergency{}, err
	}
	startedAt := db.ISO(s.now())
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.UpdateRecord(ctx, tx, tenantID, record.ID, RecordPatch{StartedAt: &startedAt})
	}); err != nil {
		return Emergency{}, err
	}
	s.setMachineState(ctx, tenantID, in.MachineID, machinestate.Offline)
	actorType := actor.Type
	if actorType == "" {
		actorType = "USER"
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "MAINTENANCE_STARTED", EntityType: "MACHINE", EntityID: in.MachineID, ActorType: actorType, ActorID: &actor.ID,
		ActorName: actor.Name, MachineID: &in.MachineID, WorkOrderID: in.WorkOrderID, Summary: fmt.Sprintf("Emergency maintenance %s: %s", record.MaintenanceNumber, in.Problem),
		AfterValue: map[string]any{"downtimeId": downtimeID, "machineState": machinestate.Offline}})
	record.DowntimeID, record.StartedAt = downtimeID, &startedAt
	return Emergency{Record: record, DowntimeID: downtimeID}, nil
}

// IsMachineBlocked reports whether a machine is under maintenance.
func (s *Service) IsMachineBlocked(ctx context.Context, tenantID, machineID string) (bool, error) {
	var blocked bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		blocked, err = s.repo.MachineUnderMaintenance(ctx, tx, tenantID, machineID)
		return err
	})
	return blocked, err
}

// BlockedMachines is the set of machines under maintenance right now.
func (s *Service) BlockedMachines(ctx context.Context, tenantID string) (map[string]bool, error) {
	records, err := s.Records(ctx, tenantID, RecordFilter{Limit: 500})
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, r := range records {
		if r.Status == "IN_PROGRESS" || r.Status == "WAITING_PART" || r.Status == "TESTING" {
			out[r.MachineID] = true
		}
	}
	return out, nil
}

// KPI is the reliability overview over a window (default 30 days).
func (s *Service) KPI(ctx context.Context, tenantID, from, to, machineID string) (Kpi, error) {
	now := s.now()
	if to == "" {
		to = db.ISO(now)
	}
	if from == "" {
		from = db.ISO(now.Add(-30 * 24 * time.Hour))
	}
	machines := 1
	if machineID == "" {
		list, err := s.master.Machines(ctx, tenantID)
		if err != nil {
			return Kpi{}, err
		}
		machines = len(list)
	}
	var out Kpi
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		totals, err := s.repo.ReliabilityTotals(ctx, tx, tenantID, from, to, machineID)
		if err != nil {
			return err
		}
		plans, err := s.repo.ListPlans(ctx, tx, tenantID, PlanFilter{Status: "ACTIVE"})
		if err != nil {
			return err
		}
		overdue := 0
		for _, p := range plans {
			if s.dueStatus(p, nil) == "OVERDUE" {
				overdue++
			}
		}
		fromT, _ := db.ParseISO(from)
		toT, _ := db.ParseISO(to)
		windowHours := math.Max(toT.Sub(fromT).Hours(), 1)
		grossHours := windowHours * float64(max(machines, 1))
		maintenanceHours := totals.RepairMinutes / 60
		operatingHours := math.Max(grossHours-maintenanceHours, 0)
		out = Kpi{BreakdownCount: totals.Failures, OverdueCount: overdue, EmergencyCount: totals.Emergencies, MaintenanceDowntimeMinutes: totals.RepairMinutes, From: from, To: to, PmCompliancePercentage: 100}
		if grossHours > 0 {
			out.MachineAvailabilityPercentage = jsnum.Round1((operatingHours / grossHours) * 100)
		}
		if totals.Preventive+overdue > 0 {
			out.PmCompliancePercentage = jsnum.Round1((float64(totals.Preventive) / float64(totals.Preventive+overdue)) * 100)
		}
		if totals.Failures > 0 {
			out.MtbfHours = jsnum.Round1(operatingHours / float64(totals.Failures))
			out.MttrHours = jsnum.ToFixed(maintenanceHours/float64(totals.Failures), 2)
		}
		return nil
	})
	return out, err
}
