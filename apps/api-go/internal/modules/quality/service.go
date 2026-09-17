package quality

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

// Recorder is the event timeline, written detached.
type Recorder interface {
	RecordDetached(in event.Input)
}

// Service is the quality lifecycle.
type Service struct {
	pool       *db.Pool
	repo       Repository
	production *production.Service
	events     Recorder
	now        func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, prod *production.Service, events Recorder) *Service {
	return &Service{pool: pool, production: prod, events: events, now: time.Now}
}

func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func (s *Service) workOrder(ctx context.Context, tenantID string, id *string) (*production.WorkOrder, error) {
	if id == nil || *id == "" {
		return nil, nil
	}
	return s.production.WorkOrderByID(ctx, tenantID, *id)
}

// --- Inspection plans ------------------------------------------------------

// Plans lists plans.
func (s *Service) Plans(ctx context.Context, tenantID string, f PlanFilter) ([]Plan, error) {
	var out []Plan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListPlans(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// Plan reads one plan; nil when absent.
func (s *Service) Plan(ctx context.Context, tenantID, id string) (*Plan, error) {
	var out *Plan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.FindPlan(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// CharacteristicInput is one characteristic as posted.
type CharacteristicInput struct {
	ID            string
	Sequence      int
	Name          string
	DataType      string
	Specification *string
	LowerLimit    *float64
	UpperLimit    *float64
	TargetValue   *float64
	UOM           *string
	Required      bool
}

// PlanInput is a new plan.
type PlanInput struct {
	Name             string
	InspectionType   string
	ProductID        *string
	ProcessID        *string
	SamplingMethod   *string
	SamplingQuantity *float64
	Frequency        *string
	Mandatory        *bool
	Status           *string
	Characteristics  []CharacteristicInput
}

func (s *Service) characteristics(planID string, inputs []CharacteristicInput) []Characteristic {
	now := s.now().UnixMilli()
	out := make([]Characteristic, 0, len(inputs))
	for i, c := range inputs {
		id := c.ID
		if id == "" {
			id = fmt.Sprintf("ichar-%d-%d", now, i+1)
		}
		seq := c.Sequence
		if seq == 0 {
			seq = i + 1
		}
		dataType := c.DataType
		if dataType == "" {
			dataType = "ATTRIBUTE"
		}
		out = append(out, Characteristic{ID: id, InspectionPlanID: planID, Sequence: seq, Name: c.Name, DataType: dataType, Specification: db.Str(c.Specification),
			LowerLimit: c.LowerLimit, UpperLimit: c.UpperLimit, TargetValue: c.TargetValue, UOM: db.Str(c.UOM), Required: c.Required})
	}
	return out
}

// CreatePlan stores a plan numbered IP-<year>-NNNN.
func (s *Service) CreatePlan(ctx context.Context, tenantID string, in PlanInput, actor Actor) (Plan, error) {
	now := db.ISO(s.now())
	id := fmt.Sprintf("iplan-%d", s.now().UnixMilli())
	var out Plan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "inspection_plan", "IP")
		if err != nil {
			return err
		}
		out = Plan{
			ID: id, TenantID: tenantID, PlanNumber: number, Name: in.Name, InspectionType: in.InspectionType, ProductID: db.Str(in.ProductID), ProcessID: db.Str(in.ProcessID),
			SamplingMethod: db.Deref(in.SamplingMethod, "FIXED_QUANTITY"), SamplingQuantity: in.SamplingQuantity, Frequency: db.Str(in.Frequency),
			Mandatory: db.Deref(in.Mandatory, false), Status: db.Deref(in.Status, "DRAFT"), Characteristics: s.characteristics(id, in.Characteristics),
			CreatedBy: &actor.ID, CreatedAt: now, UpdatedAt: now,
		}
		if out.SamplingMethod == "" {
			out.SamplingMethod = "FIXED_QUANTITY"
		}
		if out.Status == "" {
			out.Status = "DRAFT"
		}
		return s.repo.UpsertPlan(ctx, tx, out)
	})
	return out, err
}

// PlanPatch is what an update may change; nil keeps the field.
type PlanPatch struct {
	Name, InspectionType, ProductID, ProcessID, SamplingMethod, Frequency, Status *string
	SamplingQuantity                                                              *float64
	Mandatory                                                                     *bool
	Characteristics                                                               []CharacteristicInput
	HasCharacteristics                                                            bool
}

// UpdatePlan patches a plan and rewrites its characteristics.
func (s *Service) UpdatePlan(ctx context.Context, tenantID, id string, p PlanPatch) (Plan, error) {
	var out Plan
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.repo.FindPlan(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if existing == nil {
			return httpx.NotFound("Inspection Plan tidak ditemukan.")
		}
		out = *existing
		if p.Name != nil {
			out.Name = *p.Name
		}
		if p.InspectionType != nil {
			out.InspectionType = *p.InspectionType
		}
		if p.ProductID != nil {
			out.ProductID = db.Str(p.ProductID)
		}
		if p.ProcessID != nil {
			out.ProcessID = db.Str(p.ProcessID)
		}
		if p.SamplingMethod != nil {
			out.SamplingMethod = *p.SamplingMethod
		}
		if p.SamplingQuantity != nil {
			out.SamplingQuantity = p.SamplingQuantity
		}
		if p.Frequency != nil {
			out.Frequency = db.Str(p.Frequency)
		}
		if p.Mandatory != nil {
			out.Mandatory = *p.Mandatory
		}
		if p.Status != nil {
			out.Status = *p.Status
		}
		if p.HasCharacteristics {
			out.Characteristics = s.characteristics(id, p.Characteristics)
		} else {
			inputs := make([]CharacteristicInput, len(existing.Characteristics))
			for i, c := range existing.Characteristics {
				inputs[i] = CharacteristicInput{ID: c.ID, Sequence: c.Sequence, Name: c.Name, DataType: c.DataType, Specification: c.Specification,
					LowerLimit: c.LowerLimit, UpperLimit: c.UpperLimit, TargetValue: c.TargetValue, UOM: c.UOM, Required: c.Required}
			}
			out.Characteristics = s.characteristics(id, inputs)
		}
		out.UpdatedAt = db.ISO(s.now())
		return s.repo.UpsertPlan(ctx, tx, out)
	})
	return out, err
}

// DeletePlan removes a plan.
func (s *Service) DeletePlan(ctx context.Context, tenantID, id string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.DeletePlan(ctx, tx, tenantID, id) })
}

// --- Inspections -----------------------------------------------------------

// Measurement is one posted measurement.
type Measurement struct {
	CharacteristicID   *string
	CharacteristicName string
	ActualValue        *string
	NumericValue       *float64
	Notes              *string
}

// InspectionInput is one recorded inspection.
type InspectionInput struct {
	InspectionPlanID  *string
	InspectionType    *string
	WorkOrderID       *string
	BatchID           *string
	ProductID         *string
	ProcessID         *string
	MachineID         *string
	InspectedQuantity float64
	FailedQuantity    *float64
	UOM               *string
	OperatorID        *string
	Notes             *string
	IdempotencyKey    *string
	Measurements      []Measurement
}

func evaluate(c *Characteristic, m Measurement) string {
	if (c != nil && c.DataType == "NUMERIC") || m.NumericValue != nil {
		if m.NumericValue == nil {
			if c != nil && c.Required {
				return "FAIL"
			}
			return "PASS"
		}
		if c != nil && c.LowerLimit != nil && *m.NumericValue < *c.LowerLimit {
			return "FAIL"
		}
		if c != nil && c.UpperLimit != nil && *m.NumericValue > *c.UpperLimit {
			return "FAIL"
		}
		return "PASS"
	}
	text := strings.ToUpper(strings.TrimSpace(db.Deref(m.ActualValue, "")))
	if text == "FAIL" || text == "NG" || text == "TIDAK OK" {
		return "FAIL"
	}
	return "PASS"
}

func describeSpec(c *Characteristic) *string {
	if c == nil {
		return nil
	}
	if c.Specification != nil && *c.Specification != "" {
		return c.Specification
	}
	uom := ""
	if c.UOM != nil && *c.UOM != "" {
		uom = " " + *c.UOM
	}
	if c.LowerLimit != nil && c.UpperLimit != nil {
		return db.Ptr(fmt.Sprintf("%s – %s%s", num(*c.LowerLimit), num(*c.UpperLimit), uom))
	}
	if c.TargetValue != nil {
		return db.Ptr(num(*c.TargetValue) + uom)
	}
	return nil
}

// RecordInspection judges the measurements against the plan and stores
// the inspection, idempotent on the key the terminal sends.
func (s *Service) RecordInspection(ctx context.Context, tenantID string, in InspectionInput, actor Actor) (Inspection, error) {
	if in.InspectedQuantity <= 0 {
		return Inspection{}, httpx.Validation("Kuantitas inspeksi harus lebih besar dari nol.")
	}
	wo, err := s.workOrder(ctx, tenantID, in.WorkOrderID)
	if err != nil {
		return Inspection{}, err
	}
	if in.WorkOrderID != nil && *in.WorkOrderID != "" && wo == nil {
		return Inspection{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	var out Inspection
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if in.IdempotencyKey != nil && *in.IdempotencyKey != "" {
			existing, err := s.repo.ListInspections(ctx, tx, tenantID, InspectionFilter{IdempotencyKey: *in.IdempotencyKey})
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				out = existing[0]
				return nil
			}
		}
		var plan *Plan
		if in.InspectionPlanID != nil && *in.InspectionPlanID != "" {
			var err error
			if plan, err = s.repo.FindPlan(ctx, tx, tenantID, *in.InspectionPlanID); err != nil {
				return err
			}
		}
		var characteristics []Characteristic
		if plan != nil {
			characteristics = plan.Characteristics
		}
		id := fmt.Sprintf("insp-%d-%s", s.now().UnixMilli(), db.RandomBase36(4))
		lines := make([]ResultLine, 0, len(in.Measurements))
		anyFailed := false
		for i, m := range in.Measurements {
			var c *Characteristic
			for k := range characteristics {
				if m.CharacteristicID != nil && characteristics[k].ID == *m.CharacteristicID {
					c = &characteristics[k]
					break
				}
			}
			if c == nil {
				for k := range characteristics {
					if characteristics[k].Name == m.CharacteristicName {
						c = &characteristics[k]
						break
					}
				}
			}
			result := evaluate(c, m)
			if result == "FAIL" {
				anyFailed = true
			}
			characteristicID := db.Deref(m.CharacteristicID, "")
			if c != nil {
				characteristicID = c.ID
			}
			lines = append(lines, ResultLine{ID: fmt.Sprintf("iline-%d-%d", s.now().UnixMilli(), i+1), InspectionID: id, CharacteristicID: characteristicID,
				CharacteristicName: m.CharacteristicName, ExpectedValue: describeSpec(c), ActualValue: db.Str(m.ActualValue), NumericValue: m.NumericValue, Result: result, Notes: db.Str(m.Notes)})
		}
		failed := 0.0
		if in.FailedQuantity != nil {
			failed = *in.FailedQuantity
		} else if anyFailed {
			failed = in.InspectedQuantity
		}
		passed := math.Max(in.InspectedQuantity-failed, 0)
		result := "PASS"
		if failed > 0 || anyFailed {
			result = "FAIL"
		}
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "inspection", "INS")
		if err != nil {
			return err
		}
		inspectionType := db.Deref(in.InspectionType, "")
		if inspectionType == "" && plan != nil {
			inspectionType = plan.InspectionType
		}
		if inspectionType == "" {
			inspectionType = "IN_PROCESS"
		}
		out = Inspection{
			ID: id, TenantID: tenantID, InspectionNumber: number, InspectionType: inspectionType, WorkOrderID: db.Str(in.WorkOrderID), BatchID: db.Str(in.BatchID),
			ProductID: db.Str(in.ProductID), ProcessID: db.Str(in.ProcessID), MachineID: db.Str(in.MachineID), InspectedQuantity: in.InspectedQuantity,
			PassedQuantity: passed, FailedQuantity: failed, UOM: db.Str(in.UOM), Result: result, OperatorID: db.Str(in.OperatorID), InspectorID: actor.ID,
			InspectorName: db.Deref(actor.Name, actor.ID), InspectedAt: db.ISO(s.now()), IdempotencyKey: db.Str(in.IdempotencyKey), Notes: db.Str(in.Notes), Lines: lines,
		}
		if plan != nil {
			out.InspectionPlanID, out.InspectionPlanName = &plan.ID, &plan.Name
		}
		if wo != nil {
			out.WorkOrderNumber = &wo.WoNumber
			if out.ProductID == nil {
				out.ProductID = &wo.ProductID
			}
			if out.ProcessID == nil {
				out.ProcessID = wo.ProcessID
			}
			if out.MachineID == nil {
				out.MachineID = wo.MachineID
			}
		}
		return s.repo.InsertInspection(ctx, tx, out)
	})
	if err != nil {
		return Inspection{}, err
	}
	actorType := actor.Type
	if actorType == "" {
		actorType = "USER"
	}
	ev := event.Input{
		TenantID: tenantID, EventType: "QUALITY_INSPECTION", EntityType: "INSPECTION", EntityID: out.ID, ActorType: actorType, ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: out.WorkOrderID, BatchID: out.BatchID, MachineID: out.MachineID, ProcessID: out.ProcessID,
		Summary:    fmt.Sprintf("%s: %s — %s lolos, %s gagal.", out.InspectionNumber, out.Result, num(out.PassedQuantity), num(out.FailedQuantity)),
		AfterValue: map[string]any{"result": out.Result, "inspectedQuantity": out.InspectedQuantity, "failedQuantity": out.FailedQuantity},
	}
	if wo != nil {
		ev.LineID = &wo.LineID
	}
	s.events.RecordDetached(ev)
	return out, nil
}

// Inspections lists inspections.
func (s *Service) Inspections(ctx context.Context, tenantID string, f InspectionFilter) ([]Inspection, error) {
	var out []Inspection
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListInspections(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// --- Holds -----------------------------------------------------------------

// HoldInput is a new hold.
type HoldInput struct {
	WorkOrderID, BatchID, ProductID, MaterialID, InspectionID *string
	Quantity                                                  float64
	UOM                                                       *string
	Reason                                                    string
	OwnerID                                                   string
	OwnerName                                                 *string
	Notes                                                     *string
}

// CreateHold files an OPEN hold with an owner and a reason (BR-Q04).
func (s *Service) CreateHold(ctx context.Context, tenantID string, in HoldInput, actor Actor) (Hold, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return Hold{}, httpx.Validation("Alasan hold wajib diisi.")
	}
	if in.OwnerID == "" {
		return Hold{}, httpx.Validation("Pemilik (owner) hold wajib ditentukan.")
	}
	wo, err := s.workOrder(ctx, tenantID, in.WorkOrderID)
	if err != nil {
		return Hold{}, err
	}
	var out Hold
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "quality_hold", "QH")
		if err != nil {
			return err
		}
		out = Hold{
			ID: fmt.Sprintf("qhold-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, HoldNumber: number, WorkOrderID: db.Str(in.WorkOrderID), BatchID: db.Str(in.BatchID),
			ProductID: db.Str(in.ProductID), MaterialID: db.Str(in.MaterialID), InspectionID: db.Str(in.InspectionID), Quantity: in.Quantity, UOM: db.Str(in.UOM), Reason: in.Reason,
			OwnerID: in.OwnerID, OwnerName: db.Deref(in.OwnerName, in.OwnerID), Status: "OPEN", HeldBy: actor.ID, HeldAt: db.ISO(s.now()), Notes: db.Str(in.Notes),
		}
		if out.OwnerName == "" {
			out.OwnerName = in.OwnerID
		}
		if wo != nil {
			out.WorkOrderNumber = &wo.WoNumber
			if out.ProductID == nil {
				out.ProductID = &wo.ProductID
			}
		}
		return s.repo.InsertHold(ctx, tx, out)
	})
	if err != nil {
		return Hold{}, err
	}
	ev := event.Input{
		TenantID: tenantID, EventType: "QUALITY_HOLD", EntityType: "WORK_ORDER", EntityID: db.Deref(out.WorkOrderID, out.ID), ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: out.WorkOrderID, BatchID: out.BatchID, Summary: fmt.Sprintf("%s: %s ditahan — %s", out.HoldNumber, num(out.Quantity), out.Reason),
		AfterValue: map[string]any{"quantity": out.Quantity, "reason": out.Reason, "ownerId": out.OwnerID},
	}
	if wo != nil {
		ev.LineID, ev.MachineID = &wo.LineID, wo.MachineID
	}
	s.events.RecordDetached(ev)
	return out, nil
}

// Holds lists holds.
func (s *Service) Holds(ctx context.Context, tenantID string, f HoldFilter) ([]Hold, error) {
	var out []Hold
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListHolds(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// ReleaseHold releases an OPEN hold.
func (s *Service) ReleaseHold(ctx context.Context, tenantID, id, reason string, actor Actor) (Hold, error) {
	var out Hold
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		list, err := s.repo.ListHolds(ctx, tx, tenantID, HoldFilter{ID: id})
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return httpx.NotFound("Quality Hold tidak ditemukan.")
		}
		if list[0].Status != "OPEN" {
			return httpx.InvalidState("Hold ini sudah tidak terbuka.")
		}
		if err := s.repo.CloseHold(ctx, tx, tenantID, id, "RELEASED", actor.ID, nil); err != nil {
			return err
		}
		out = list[0]
		out.Status, out.ReleasedBy, out.ReleasedAt = "RELEASED", &actor.ID, db.Ptr(db.ISO(s.now()))
		return nil
	})
	if err != nil {
		return Hold{}, err
	}
	s.events.RecordDetached(event.Input{
		TenantID: tenantID, EventType: "QUALITY_RELEASE", EntityType: "WORK_ORDER", EntityID: db.Deref(out.WorkOrderID, out.ID), ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: out.WorkOrderID, BatchID: out.BatchID, Summary: fmt.Sprintf("%s dilepas: %s", out.HoldNumber, reason), AfterValue: map[string]any{"status": "RELEASED", "reason": reason},
	})
	return out, nil
}

// TransferBlock is the gate a WIP handoff consults: open holds block, and
// so does a mandatory plan without a PASS.
func (s *Service) TransferBlock(ctx context.Context, tenantID, workOrderID string, productID, processID *string) (Gate, error) {
	var out Gate
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		held, err := s.repo.OpenHoldQuantity(ctx, tx, tenantID, workOrderID)
		if err != nil {
			return err
		}
		if held > 0 {
			out = Gate{Blocked: true, Reason: db.Ptr(fmt.Sprintf("%s unit masih berstatus Quality Hold.", num(held)))}
			return nil
		}
		mandatory, err := s.repo.MandatoryPlans(ctx, tx, tenantID, productID, processID)
		if err != nil {
			return err
		}
		if len(mandatory) == 0 {
			out = Gate{}
			return nil
		}
		inspections, err := s.repo.ListInspections(ctx, tx, tenantID, InspectionFilter{WorkOrderID: workOrderID})
		if err != nil {
			return err
		}
		for _, plan := range mandatory {
			passed := false
			for _, i := range inspections {
				if i.InspectionPlanID != nil && *i.InspectionPlanID == plan.ID && i.Result == "PASS" {
					passed = true
					break
				}
			}
			if !passed {
				out = Gate{Blocked: true, Reason: db.Ptr(fmt.Sprintf("Inspeksi wajib \"%s\" belum PASS.", plan.Name))}
				return nil
			}
		}
		out = Gate{}
		return nil
	})
	return out, err
}

// --- Dispositions ----------------------------------------------------------

// DispositionInput is one decision.
type DispositionInput struct {
	Decision                                                                             string
	Quantity                                                                             float64
	Reason                                                                               string
	InspectionID, QualityHoldID, WorkOrderID, BatchID, ProductID, UOM, DefectCode, NcrID *string
}

// CreateDisposition records a decision; SCRAP and REWORK move the work
// order's buckets, and a hold it answers is closed.
func (s *Service) CreateDisposition(ctx context.Context, tenantID string, in DispositionInput, actor Actor) (Disposition, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return Disposition{}, httpx.Validation("Alasan disposition wajib diisi.")
	}
	if in.Quantity <= 0 {
		return Disposition{}, httpx.Validation("Kuantitas disposition harus lebih besar dari nol.")
	}
	wo, err := s.workOrder(ctx, tenantID, in.WorkOrderID)
	if err != nil {
		return Disposition{}, err
	}
	var out Disposition
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		out = Disposition{
			ID: fmt.Sprintf("qdisp-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, InspectionID: db.Str(in.InspectionID), QualityHoldID: db.Str(in.QualityHoldID),
			WorkOrderID: db.Str(in.WorkOrderID), BatchID: db.Str(in.BatchID), ProductID: db.Str(in.ProductID), Decision: in.Decision, Quantity: in.Quantity, UOM: db.Str(in.UOM),
			Reason: in.Reason, DefectCode: db.Str(in.DefectCode), NcrID: db.Str(in.NcrID), DecidedBy: actor.ID, DecidedByName: actor.Name, DecidedAt: db.ISO(s.now()),
		}
		if wo != nil {
			out.WorkOrderNumber = &wo.WoNumber
			if out.ProductID == nil {
				out.ProductID = &wo.ProductID
			}
		}
		if err := s.repo.InsertDisposition(ctx, tx, out); err != nil {
			return err
		}
		if out.InspectionID != nil {
			if err := s.repo.SetInspectionDisposition(ctx, tx, tenantID, *out.InspectionID, out.ID); err != nil {
				return err
			}
		}
		if out.QualityHoldID != nil {
			status := "DISPOSITIONED"
			if in.Decision == "RELEASE" {
				status = "RELEASED"
			}
			if err := s.repo.CloseHold(ctx, tx, tenantID, *out.QualityHoldID, status, actor.ID, &out.ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Disposition{}, err
	}
	if out.WorkOrderID != nil && (in.Decision == "SCRAP" || in.Decision == "REWORK") {
		inc := production.Increment{Input: int(in.Quantity)}
		if in.Decision == "SCRAP" {
			inc.Scrap = int(in.Quantity)
		} else {
			inc.Rework = int(in.Quantity)
		}
		if err := s.production.IncrementQuantities(ctx, tenantID, *out.WorkOrderID, inc); err != nil {
			return Disposition{}, err
		}
	}
	eventType := "QUALITY_DISPOSITION"
	switch in.Decision {
	case "SCRAP":
		eventType = "SCRAP_RECORDED"
	case "REWORK":
		eventType = "REWORK_STARTED"
	}
	ev := event.Input{
		TenantID: tenantID, EventType: eventType, EntityType: "WORK_ORDER", EntityID: db.Deref(out.WorkOrderID, out.ID), ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: out.WorkOrderID, BatchID: out.BatchID, Summary: fmt.Sprintf("Disposition %s %s: %s", out.Decision, num(out.Quantity), out.Reason),
		AfterValue: map[string]any{"decision": out.Decision, "quantity": out.Quantity},
	}
	if wo != nil {
		ev.LineID, ev.MachineID = &wo.LineID, wo.MachineID
	}
	s.events.RecordDetached(ev)
	return out, nil
}

// Dispositions lists dispositions.
func (s *Service) Dispositions(ctx context.Context, tenantID string, f DispositionFilter) ([]Disposition, error) {
	var out []Disposition
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListDispositions(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// --- NCR -------------------------------------------------------------------

// NcrInput is a new NCR.
type NcrInput struct {
	Title, Description                                                                          string
	Severity                                                                                    *string
	OwnerID                                                                                     string
	OwnerName                                                                                   *string
	ProductID, BatchID, WorkOrderID, ProcessID, MachineID, OperatorID, DefectCode, InspectionID *string
	Quantity                                                                                    *float64
	UOM, DueDate                                                                                *string
}

// CreateNcr opens an NCR numbered NCR-<year>-NNNN.
func (s *Service) CreateNcr(ctx context.Context, tenantID string, in NcrInput, actor Actor) (Ncr, error) {
	wo, err := s.workOrder(ctx, tenantID, in.WorkOrderID)
	if err != nil {
		return Ncr{}, err
	}
	var out Ncr
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "non_conformance_record", "NCR")
		if err != nil {
			return err
		}
		severity := db.Deref(in.Severity, "MEDIUM")
		if severity == "" {
			severity = "MEDIUM"
		}
		out = Ncr{
			ID: fmt.Sprintf("ncr-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, NcrNumber: number, Title: in.Title, Description: in.Description, Severity: severity,
			Status: "OPEN", ProductID: db.Str(in.ProductID), BatchID: db.Str(in.BatchID), WorkOrderID: db.Str(in.WorkOrderID), ProcessID: db.Str(in.ProcessID), MachineID: db.Str(in.MachineID),
			OperatorID: db.Str(in.OperatorID), DefectCode: db.Str(in.DefectCode), InspectionID: db.Str(in.InspectionID), Quantity: in.Quantity, UOM: db.Str(in.UOM),
			OwnerID: in.OwnerID, OwnerName: db.Deref(in.OwnerName, in.OwnerID), RaisedBy: actor.ID, RaisedAt: db.ISO(s.now()), DueDate: db.Str(in.DueDate), Actions: []Action{},
		}
		if out.OwnerName == "" {
			out.OwnerName = in.OwnerID
		}
		if wo != nil {
			out.WorkOrderNumber = &wo.WoNumber
			if out.ProductID == nil {
				out.ProductID = &wo.ProductID
			}
			if out.ProcessID == nil {
				out.ProcessID = wo.ProcessID
			}
			if out.MachineID == nil {
				out.MachineID = wo.MachineID
			}
		}
		return s.repo.InsertNcr(ctx, tx, out)
	})
	if err != nil {
		return Ncr{}, err
	}
	s.events.RecordDetached(event.Input{
		TenantID: tenantID, EventType: "NCR_OPENED", EntityType: "NCR", EntityID: out.ID, ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: out.WorkOrderID, BatchID: out.BatchID, MachineID: out.MachineID, Summary: fmt.Sprintf("%s dibuka: %s", out.NcrNumber, out.Title),
		AfterValue: map[string]any{"severity": out.Severity, "ownerId": out.OwnerID},
	})
	return out, nil
}

// Ncrs lists NCRs.
func (s *Service) Ncrs(ctx context.Context, tenantID string, f NcrFilter) ([]Ncr, error) {
	var out []Ncr
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListNcrs(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// UpdateNcr patches an NCR; closing needs every action verified.
func (s *Service) UpdateNcr(ctx context.Context, tenantID, id string, p NcrPatch, actor Actor) (Ncr, error) {
	var out Ncr
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		target, err := s.repo.FindNcr(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if target == nil {
			return httpx.NotFound("NCR tidak ditemukan.")
		}
		if p.Status != nil && *p.Status == "CLOSED" {
			open, err := s.repo.OpenActionCount(ctx, tx, tenantID, id)
			if err != nil {
				return err
			}
			if open > 0 {
				return httpx.InvalidState(fmt.Sprintf("NCR tidak dapat ditutup: masih ada %d corrective action yang belum diverifikasi.", open))
			}
		}
		p.ClosedBy = &actor.ID
		if err := s.repo.UpdateNcr(ctx, tx, tenantID, id, p); err != nil {
			return err
		}
		updated, err := s.repo.FindNcr(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		out = *updated
		return nil
	})
	if err != nil {
		return Ncr{}, err
	}
	if p.Status != nil && *p.Status == "CLOSED" {
		s.events.RecordDetached(event.Input{
			TenantID: tenantID, EventType: "NCR_CLOSED", EntityType: "NCR", EntityID: id, ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
			WorkOrderID: out.WorkOrderID, Summary: out.NcrNumber + " ditutup.", AfterValue: map[string]any{"rootCause": out.RootCause},
		})
	}
	return out, nil
}

// ActionInput is a new corrective action.
type ActionInput struct {
	Action    string
	OwnerID   string
	OwnerName *string
	DueDate   *string
	Notes     *string
}

// AddCorrectiveAction appends an action and moves the NCR to ACTION.
func (s *Service) AddCorrectiveAction(ctx context.Context, tenantID, ncrID string, in ActionInput) (Action, error) {
	var out Action
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		seq, err := s.repo.NextSequence(ctx, tx, tenantID, ncrID)
		if err != nil {
			return err
		}
		out = Action{ID: fmt.Sprintf("ca-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, NcrID: ncrID, Sequence: seq, Action: in.Action,
			OwnerID: in.OwnerID, OwnerName: db.Deref(in.OwnerName, in.OwnerID), DueDate: db.Str(in.DueDate), Status: "OPEN", Notes: db.Str(in.Notes)}
		if out.OwnerName == "" {
			out.OwnerName = in.OwnerID
		}
		if err := s.repo.InsertAction(ctx, tx, out); err != nil {
			return err
		}
		return s.repo.UpdateNcr(ctx, tx, tenantID, ncrID, NcrPatch{Status: db.Ptr("ACTION")})
	})
	return out, err
}

// UpdateCorrectiveAction moves an action.
func (s *Service) UpdateCorrectiveAction(ctx context.Context, tenantID, id string, status, evidence *string, actor Actor) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.UpdateAction(ctx, tx, tenantID, id, status, evidence, actor.ID)
	})
}

// --- Dashboard -------------------------------------------------------------

// QualityDashboard is the overview over a window (default 30 days).
func (s *Service) QualityDashboard(ctx context.Context, tenantID, from, to string) (Dashboard, error) {
	now := s.now()
	if to == "" {
		to = db.ISO(now)
	}
	if from == "" {
		from = db.ISO(now.Add(-30 * 24 * time.Hour))
	}
	var out Dashboard
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		inspected, passed, failed, inspections, failures, err := s.repo.YieldTotals(ctx, tx, tenantID, from, to)
		if err != nil {
			return err
		}
		holds, err := s.repo.ListHolds(ctx, tx, tenantID, HoldFilter{Status: "OPEN"})
		if err != nil {
			return err
		}
		dispositions, err := s.repo.ListDispositions(ctx, tx, tenantID, DispositionFilter{Limit: 1000})
		if err != nil {
			return err
		}
		ncrs, err := s.repo.ListNcrs(ctx, tx, tenantID, NcrFilter{Limit: 1000})
		if err != nil {
			return err
		}
		sumOf := func(decision string) float64 {
			t := 0.0
			for _, d := range dispositions {
				if d.Decision == decision {
					t += d.Quantity
				}
			}
			return t
		}
		held := 0.0
		for _, h := range holds {
			held += h.Quantity
		}
		today := db.ISO(now)[:10]
		openNcr, overdue := 0, 0
		for _, n := range ncrs {
			if n.Status != "CLOSED" {
				openNcr++
				if n.DueDate != nil && *n.DueDate < today {
					overdue++
				}
			}
		}
		out = Dashboard{InspectedQuantity: inspected, PassedQuantity: passed, FailedQuantity: failed, Inspections: inspections, FailedInspections: failures,
			OpenHolds: len(holds), HeldQuantity: held, ReworkQuantity: sumOf("REWORK"), ScrapQuantity: sumOf("SCRAP"), OpenNcr: openNcr, OverdueNcr: overdue, From: from, To: to}
		if inspected > 0 {
			out.FirstPassYield = jsnum.Round1((passed / inspected) * 100)
			out.FailRate = jsnum.Round1((failed / inspected) * 100)
		}
		return nil
	})
	return out, err
}
