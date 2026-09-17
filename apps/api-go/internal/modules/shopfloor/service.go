package shopfloor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/machinestate"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
)

// OfflineActor is who a replayed improvement command is recorded against.
type OfflineActor struct {
	ID   string
	Name *string
	Type string // USER | OPERATOR
}

// Improvement is the v2.0 offline-capable transactions (Improvement PRD
// §38), attached once those modules exist so a terminal that never records
// a consumption does not make the shop floor refuse to start.
type Improvement interface {
	RecordConsumption(ctx context.Context, tenantID string, payload map[string]any, workOrderID, idempotencyKey string, actor OfflineActor) (string, error)
	RecordInspection(ctx context.Context, tenantID string, payload map[string]any, workOrderID, idempotencyKey string, actor OfflineActor) (string, error)
	CreateWip(ctx context.Context, tenantID string, payload map[string]any, workOrderID string, actor OfflineActor) (string, error)
	CreateWipTransfer(ctx context.Context, tenantID string, payload map[string]any, idempotencyKey string, actor OfflineActor) (string, error)
}

// Service is shop-floor capture.
type Service struct {
	pool          *db.Pool
	production    *production.Service
	master        *masterdata.Service
	records       ProductionRecordRepository
	downtimes     DowntimeRepository
	syncEvents    SyncEventRepository
	exceptions    SyncExceptionRepository
	machineStates machinestate.Repository
	outbox        outbox.Writer
	loc           *time.Location
	log           *slog.Logger

	mu          sync.RWMutex
	improvement Improvement
}

// NewService wires the shop floor. loc is the plant's timezone, which
// decides shift_date.
func NewService(pool *db.Pool, prod *production.Service, master *masterdata.Service, ob outbox.Writer, loc *time.Location, log *slog.Logger) *Service {
	if ob == nil {
		ob = outbox.Discard{}
	}
	if loc == nil {
		loc = time.Local
	}
	return &Service{pool: pool, production: prod, master: master, outbox: ob, loc: loc, log: log}
}

// AttachImprovement connects the material, quality and WIP writers.
func (s *Service) AttachImprovement(i Improvement) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.improvement = i
}

func (s *Service) improve() Improvement {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.improvement
}

type captureContext struct {
	workOrder *production.WorkOrder
	processID *string
	batchID   *string
	productID *string
	lineID    *string
	machineID *string
}

// contextFor is the production context a shop-floor event inherits from
// its work order (US-014): process, batch and machine are properties of the
// planned work, not of the button the operator pressed. A batch-managed
// work order must have an active batch, which is the one used (ADR-29).
func (s *Service) contextFor(ctx context.Context, tx pgx.Tx, tenantID string, workOrderID *string) (captureContext, error) {
	var out captureContext
	if workOrderID == nil || *workOrderID == "" {
		return out, nil
	}
	w, err := s.production.WorkOrderIn(ctx, tx, tenantID, *workOrderID)
	if err != nil || w == nil {
		return out, err
	}
	out.workOrder = w
	out.processID, out.machineID = w.ProcessID, w.MachineID
	out.productID, out.lineID = &w.ProductID, &w.LineID
	if w.IsBatchManaged {
		batches, err := s.production.BatchesForWorkOrderIn(ctx, tx, tenantID, w.ID)
		if err != nil {
			return out, err
		}
		for _, b := range batches {
			if b.Status != "COMPLETED" && b.Status != "CANCELLED" && b.Status != "SCRAPPED" {
				id := b.ID
				out.batchID = &id
				break
			}
		}
		if out.batchID == nil {
			return out, httpx.InvalidState("Work Order berjalan pada mode batch tetapi tidak memiliki batch aktif. " +
				"Lampirkan atau buka batch terlebih dahulu.")
		}
	}
	return out, nil
}

func (s *Service) shiftContext(ctx context.Context, tenantID, occurredAt string, shiftID *string) (ShiftContext, error) {
	shifts, err := s.master.Shifts(ctx, tenantID)
	if err != nil {
		return ShiftContext{}, err
	}
	return ResolveShiftContext(shifts, occurredAt, shiftID, s.loc), nil
}

// HasProcessed reports whether a client event was already applied (US-046).
func (s *Service) HasProcessed(ctx context.Context, tenantID, clientEventID string) (bool, error) {
	var has bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		has, err = s.syncEvents.Has(ctx, tx, tenantID, clientEventID)
		return err
	})
	return has, err
}

// --- Production output (US-018, US-019) ---------------------------------

// validateOutput is everything that can be judged without the database.
func (s *Service) validateOutput(ctx context.Context, tenantID string, in OutputInput) error {
	if in.GoodQuantity < 0 || in.RejectQuantity < 0 {
		return httpx.Validation("Quantity tidak boleh negatif.",
			httpx.FieldError{Field: "goodQuantity", Code: "OUT_OF_RANGE", Message: "Quantity tidak boleh negatif."})
	}
	// US-019: a reject without a reason is a number nobody can act on.
	if in.RejectQuantity > 0 && (in.RejectReasonID == nil || *in.RejectReasonID == "") {
		return httpx.Validation("Reject reason wajib diisi ketika mencatat reject.",
			httpx.FieldError{Field: "rejectReasonId", Code: "REQUIRED", Message: "Pilih alasan reject."})
	}
	if in.RejectReasonID != nil && *in.RejectReasonID != "" {
		reasons, err := s.master.RejectReasons(ctx, tenantID)
		if err != nil {
			return err
		}
		valid := false
		for _, r := range reasons {
			if r.ID == *in.RejectReasonID && r.Active {
				valid = true
				break
			}
		}
		if !valid {
			return httpx.Validation("Reject reason tidak valid.",
				httpx.FieldError{Field: "rejectReasonId", Code: "UNKNOWN_REFERENCE", Message: "Alasan reject tidak dikenal atau nonaktif."})
		}
	}
	return nil
}

// RecordOutput stores a production record and, in the same transaction,
// the work order totals it justifies and the machine state it implies.
func (s *Service) RecordOutput(ctx context.Context, tenantID string, in OutputInput) (ProductionRecord, error) {
	if err := s.validateOutput(ctx, tenantID, in); err != nil {
		return ProductionRecord{}, err
	}
	shift, err := s.shiftContext(ctx, tenantID, in.OccurredAt, in.ShiftID)
	if err != nil {
		return ProductionRecord{}, err
	}

	var out ProductionRecord
	created := false
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// A replay returns the record the first attempt produced.
		existing, err := s.records.FindByClientEventID(ctx, tx, tenantID, in.ClientEventID)
		if err != nil {
			return err
		}
		if existing != nil {
			out = *existing
			return nil
		}
		cc, err := s.contextFor(ctx, tx, tenantID, &in.WorkOrderID)
		if err != nil {
			return err
		}
		if cc.workOrder == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		w := cc.workOrder

		// §10: input is what actually entered the process — good + reject
		// today; scrap and rework join it when the terminal captures them.
		inputQuantity := in.GoodQuantity + in.RejectQuantity

		// MES-017: judged against the totals the work order already holds,
		// before the increment is applied. The domain violation becomes a
		// validation error here, so the offline sync classifies it as
		// permanent rather than retrying an impossible quantity for ever.
		if _, err := production.AssertDelta("WORK_ORDER", w.WoNumber, w.Flow(), production.FlowDelta{
			InputQuantity: inputQuantity, OutputQuantity: in.GoodQuantity, RejectQuantity: in.RejectQuantity,
		}, false); err != nil {
			return production.FlowValidation(err, "goodQuantity")
		}

		machineID := ""
		if in.MachineID != nil && *in.MachineID != "" {
			machineID = *in.MachineID
		} else if cc.machineID != nil {
			machineID = *cc.machineID
		}
		draft := ProductionRecord{
			ID:                fmt.Sprintf("pr-%d-%s", time.Now().UnixMilli(), db.RandomBase36(5)),
			TenantID:          tenantID,
			WorkOrderID:       in.WorkOrderID,
			ProcessID:         cc.processID,
			BatchID:           cc.batchID,
			MachineID:         machineID,
			OperatorID:        in.OperatorID,
			ShiftID:           shift.ShiftID,
			ShiftDate:         shift.ShiftDate,
			GoodQuantity:      in.GoodQuantity,
			RejectQuantity:    in.RejectQuantity,
			InputQuantity:     inputQuantity,
			IsBatchManaged:    w.IsBatchManaged,
			HasChildWorkOrder: w.HasChildWorkOrder,
			RejectReasonID:    db.Str(in.RejectReasonID),
			RecordedAt:        in.OccurredAt,
			Source:            "OPERATOR_MANUAL",
			ClientEventID:     in.ClientEventID,
			Notes:             db.Str(in.Notes),
		}
		record, wasCreated, err := s.records.Create(ctx, tx, draft)
		if err != nil {
			return err
		}
		out, created = record, wasCreated
		if !wasCreated {
			return nil
		}
		if err := s.production.IncrementQuantitiesIn(ctx, tx, tenantID, in.WorkOrderID, production.Increment{
			Good: in.GoodQuantity, Reject: in.RejectQuantity, Input: inputQuantity,
		}); err != nil {
			return err
		}
		if _, err := s.syncEvents.Claim(ctx, tx, tenantID, in.ClientEventID, "RECORD_OUTPUT", &in.WorkOrderID, &record.ID); err != nil {
			return err
		}
		// Output means the machine was running when it happened (§11).
		if record.MachineID != "" {
			if _, err := s.machineStates.Transition(ctx, tx, machinestate.Entry{
				TenantID: tenantID, MachineID: record.MachineID, ProcessID: record.ProcessID,
				State: machinestate.Running, StartedAt: record.RecordedAt, WorkOrderID: &record.WorkOrderID, ShiftDate: &record.ShiftDate,
			}); err != nil {
				return err
			}
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "production:output-recorded", AggregateType: "production_record", AggregateID: record.ID, Payload: record})
	})
	if err != nil {
		return ProductionRecord{}, err
	}
	if created {
		s.production.Changed(tenantID)
	}
	return out, nil
}

// --- Downtime (US-016, US-017, US-020) ----------------------------------

// processIDForMachine is the process a machine normally runs, via its
// routing, so a standalone stop is still attributable.
func (s *Service) processIDForMachine(ctx context.Context, tenantID, machineID string) (*string, error) {
	routings, err := s.master.Routings(ctx, tenantID, "")
	if err != nil {
		return nil, err
	}
	for _, r := range routings {
		if r.Active && r.MachineID != nil && *r.MachineID == machineID {
			id := r.ProcessID
			return &id, nil
		}
	}
	return nil, nil
}

// StartDowntime opens a stop. The reason is mandatory and scoped, and
// is_planned follows the configured code, never the client.
func (s *Service) StartDowntime(ctx context.Context, tenantID string, in DowntimeInput) (DowntimeRecord, error) {
	reasons, err := s.master.DowntimeReasons(ctx, tenantID)
	if err != nil {
		return DowntimeRecord{}, err
	}
	var reason *masterdata.DowntimeReason
	for i := range reasons {
		if reasons[i].ID == in.ReasonID {
			reason = &reasons[i]
			break
		}
	}
	if reason == nil {
		return DowntimeRecord{}, httpx.Validation("Downtime reason tidak valid.",
			httpx.FieldError{Field: "reasonId", Code: "UNKNOWN_REFERENCE", Message: "Alasan downtime tidak dikenal."})
	}
	if !reason.Active {
		return DowntimeRecord{}, httpx.Validation("Downtime reason sudah nonaktif.",
			httpx.FieldError{Field: "reasonId", Code: "UNKNOWN_REFERENCE", Message: "Alasan downtime tidak lagi berlaku."})
	}
	shift, err := s.shiftContext(ctx, tenantID, in.OccurredAt, in.ShiftID)
	if err != nil {
		return DowntimeRecord{}, err
	}

	var out DowntimeRecord
	created := false
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.downtimes.FindByClientEventID(ctx, tx, tenantID, in.ClientEventID)
		if err != nil {
			return err
		}
		if existing != nil {
			out = *existing
			return nil
		}
		cc, err := s.contextFor(ctx, tx, tenantID, in.WorkOrderID)
		if err != nil {
			return err
		}
		lineID := ""
		if in.LineID != nil && *in.LineID != "" {
			lineID = *in.LineID
		} else if cc.lineID != nil {
			lineID = *cc.lineID
		} else if lineID, err = s.master.LineIDForMachine(ctx, tenantID, in.MachineID); err != nil {
			return err
		}
		if lineID == "" {
			return httpx.Validation("Production line tidak dapat ditentukan untuk downtime ini.",
				httpx.FieldError{Field: "lineId", Code: "REQUIRED", Message: "Line wajib diisi bila tidak dapat diturunkan dari mesin."})
		}
		processID := cc.processID
		if processID == nil {
			if processID, err = s.processIDForMachine(ctx, tenantID, in.MachineID); err != nil {
				return err
			}
		}
		draft := DowntimeRecord{
			ID:            fmt.Sprintf("dt-%d-%s", time.Now().UnixMilli(), db.RandomBase36(4)),
			TenantID:      tenantID,
			MachineID:     in.MachineID,
			ProcessID:     processID,
			LineID:        lineID,
			OperatorID:    db.Str(in.OperatorID),
			WorkOrderID:   db.Str(in.WorkOrderID),
			ShiftID:       shift.ShiftID,
			ShiftDate:     shift.ShiftDate,
			ReasonID:      in.ReasonID,
			StartTime:     in.OccurredAt,
			IsPlanned:     reason.IsPlanned,
			Notes:         db.Str(in.Notes),
			ClientEventID: in.ClientEventID,
			Status:        "ACTIVE",
		}
		record, wasCreated, err := s.downtimes.Create(ctx, tx, draft)
		if err != nil {
			return err
		}
		out, created = record, wasCreated
		if !wasCreated {
			return nil
		}
		if _, err := s.syncEvents.Claim(ctx, tx, tenantID, in.ClientEventID, "RECORD_DOWNTIME", record.WorkOrderID, &record.ID); err != nil {
			return err
		}
		if _, err := s.machineStates.Transition(ctx, tx, machinestate.Entry{
			TenantID: tenantID, MachineID: record.MachineID, ProcessID: record.ProcessID, State: machinestate.Downtime,
			ReasonID: &record.ReasonID, StartedAt: record.StartTime, WorkOrderID: record.WorkOrderID, ShiftDate: &record.ShiftDate,
		}); err != nil {
			return err
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "downtime:started", AggregateType: "downtime_record", AggregateID: record.ID, Payload: record})
	})
	if err != nil {
		return DowntimeRecord{}, err
	}
	if created {
		s.production.Changed(tenantID)
	}
	return out, nil
}

// ResolveDowntime closes a stop. A replayed resolve must not stretch the
// duration to the retry's clock, so an already-resolved record is returned
// as is.
func (s *Service) ResolveDowntime(ctx context.Context, tenantID, downtimeID string, in ResolveInput) (DowntimeRecord, error) {
	var out DowntimeRecord
	changed := false
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		record, err := s.downtimes.FindByID(ctx, tx, tenantID, downtimeID)
		if err != nil {
			return err
		}
		if record == nil {
			return httpx.NotFound("Downtime record tidak ditemukan.")
		}
		if record.Status == "RESOLVED" {
			out = *record
			return nil
		}
		start, err := db.ParseISO(record.StartTime)
		if err != nil {
			return err
		}
		end, err := db.ParseISO(in.OccurredAt)
		if err != nil {
			return httpx.Validation("occurredAt harus berupa timestamp ISO 8601.",
				httpx.FieldError{Field: "occurredAt", Code: "INVALID_FORMAT", Message: "Gunakan format ISO 8601."})
		}
		duration := int(end.Sub(start) / time.Second)
		if duration < 0 {
			duration = 0
		}
		resolved, err := s.downtimes.Resolve(ctx, tx, tenantID, downtimeID, in.OccurredAt, duration)
		if err != nil {
			return err
		}
		if resolved == nil {
			return httpx.NotFound("Downtime record tidak ditemukan.")
		}
		if _, err := s.syncEvents.Claim(ctx, tx, tenantID, in.ClientEventID, "RESOLVE_DOWNTIME", resolved.WorkOrderID, &resolved.ID); err != nil {
			return err
		}
		// The stop is over, so the machine is idle until output proves it is
		// running again.
		if _, err := s.machineStates.Transition(ctx, tx, machinestate.Entry{
			TenantID: tenantID, MachineID: resolved.MachineID, ProcessID: resolved.ProcessID, State: machinestate.Idle,
			StartedAt: in.OccurredAt, WorkOrderID: resolved.WorkOrderID, ShiftDate: &resolved.ShiftDate,
		}); err != nil {
			return err
		}
		out, changed = *resolved, true
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: "downtime:resolved", AggregateType: "downtime_record", AggregateID: resolved.ID, Payload: resolved})
	})
	if err != nil {
		return DowntimeRecord{}, err
	}
	if changed {
		s.production.Changed(tenantID)
	}
	return out, nil
}

// ActiveDowntimeForMachine is the still-open downtime on a machine.
func (s *Service) ActiveDowntimeForMachine(ctx context.Context, tenantID, machineID string) (*DowntimeRecord, error) {
	var out *DowntimeRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.downtimes.FindActiveForMachine(ctx, tx, tenantID, machineID)
		return err
	})
	return out, err
}

// ActiveDowntimeForWorkOrder is the still-open downtime on a work order.
func (s *Service) ActiveDowntimeForWorkOrder(ctx context.Context, tenantID, workOrderID string) (*DowntimeRecord, error) {
	var out *DowntimeRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.downtimes.FindActiveForWorkOrder(ctx, tx, tenantID, workOrderID)
		return err
	})
	return out, err
}

// HasActiveDowntimeForMachine implements production.DowntimeSource.
func (s *Service) HasActiveDowntimeForMachine(ctx context.Context, tenantID, machineID string) (bool, error) {
	d, err := s.ActiveDowntimeForMachine(ctx, tenantID, machineID)
	return d != nil, err
}

// HasActiveDowntimeForWorkOrder implements production.DowntimeSource.
func (s *Service) HasActiveDowntimeForWorkOrder(ctx context.Context, tenantID, workOrderID string) (bool, error) {
	d, err := s.ActiveDowntimeForWorkOrder(ctx, tenantID, workOrderID)
	return d != nil, err
}

// ActiveDowntimes is every open stop.
func (s *Service) ActiveDowntimes(ctx context.Context, tenantID string) ([]DowntimeRecord, error) {
	var out []DowntimeRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.downtimes.ListActive(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// DowntimeRecords lists stops, optionally per line.
func (s *Service) DowntimeRecords(ctx context.Context, tenantID string, f DowntimeFilter) ([]DowntimeRecord, error) {
	var out []DowntimeRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.downtimes.List(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// ProductionRecords lists output records, optionally per work order.
func (s *Service) ProductionRecords(ctx context.Context, tenantID string, f ProductionRecordFilter) ([]ProductionRecord, error) {
	var out []ProductionRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.records.List(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// ProductionRecordsIn lists output records inside a caller's transaction.
func (s *Service) ProductionRecordsIn(ctx context.Context, tx pgx.Tx, tenantID string, f ProductionRecordFilter) ([]ProductionRecord, error) {
	return s.records.List(ctx, tx, tenantID, f)
}

// DowntimeRecordsIn lists stops inside a caller's transaction.
func (s *Service) DowntimeRecordsIn(ctx context.Context, tx pgx.Tx, tenantID string, f DowntimeFilter) ([]DowntimeRecord, error) {
	return s.downtimes.List(ctx, tx, tenantID, f)
}

// MachineStates is what each machine is doing right now.
func (s *Service) MachineStates(ctx context.Context, tenantID string) ([]machinestate.Log, error) {
	var out []machinestate.Log
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.machineStates.ListOpen(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// MachineStateHistory is the log behind the current states.
func (s *Service) MachineStateHistory(ctx context.Context, tenantID, machineID string) ([]machinestate.Log, error) {
	var out []machinestate.Log
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.machineStates.List(ctx, tx, tenantID, machineID, 0)
		return err
	})
	return out, err
}

// Counts is the boot log's row counts.
func (s *Service) Counts(ctx context.Context, tenantID string) (records, downtime, states int, err error) {
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		if records, err = s.records.Count(ctx, tx, tenantID); err != nil {
			return err
		}
		if downtime, err = s.downtimes.Count(ctx, tx, tenantID); err != nil {
			return err
		}
		states, err = s.machineStates.Count(ctx, tx, tenantID)
		return err
	})
	return
}

// --- Offline sync (US-045, US-046) ---------------------------------------

// permanentCodes are the failures that will fail identically forever.
var permanentCodes = map[string]bool{"VALIDATION_ERROR": true, "FORBIDDEN": true, "NOT_FOUND": true}

// Classify decides what a terminal does with a failed command: a
// validation failure is permanent, anything else may be transient.
func Classify(err error) (code string, message string, retryable bool) {
	var apiErr *httpx.Error
	if errors.As(err, &apiErr) {
		return apiErr.Code, apiErr.Message, !permanentCodes[apiErr.Code]
	}
	if c := db.Describe(err); c != nil {
		return c.Code, c.Message, !permanentCodes[c.Code]
	}
	message = "Gagal memproses perintah."
	if err != nil {
		message = err.Error()
	}
	return "INTERNAL_ERROR", message, true
}

// SyncBatch drains an operator terminal's offline queue. Every command is
// reported individually: APPLIED clears the row, DUPLICATE clears it too,
// FAILED keeps it with retryable deciding what the terminal does next.
// Nothing is ever dropped silently.
func (s *Service) SyncBatch(ctx context.Context, tenantID string, commands []SyncCommand) (SyncBatchResult, error) {
	results := make([]SyncCommandResult, 0, len(commands))

	// One round trip decides which events were already applied, instead of
	// one query per command.
	ids := make([]string, 0, len(commands))
	for _, c := range commands {
		if c.ClientEventID != "" {
			ids = append(ids, c.ClientEventID)
		}
	}
	var processed map[string]bool
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		processed, err = s.syncEvents.Processed(ctx, tx, tenantID, ids)
		return err
	}); err != nil {
		return SyncBatchResult{}, err
	}

	applied := false
	for _, cmd := range commands {
		if cmd.ClientEventID == "" {
			results = append(results, SyncCommandResult{
				ClientEventID: "", Status: "FAILED", ErrorCode: db.Ptr("VALIDATION_ERROR"),
				ErrorMessage: db.Ptr("client_event_id wajib ada pada setiap perintah offline."), Retryable: false,
			})
			continue
		}
		if processed[cmd.ClientEventID] {
			results = append(results, SyncCommandResult{ClientEventID: cmd.ClientEventID, Status: "DUPLICATE", Retryable: false})
			continue
		}
		entityID, err := s.applyCommand(ctx, tenantID, cmd)
		if err == nil {
			processed[cmd.ClientEventID] = true
			applied = true
			results = append(results, SyncCommandResult{ClientEventID: cmd.ClientEventID, Status: "APPLIED", EntityID: entityID, Retryable: false})
			// A command that finally lands closes the exception it raised
			// earlier, and a quantity beyond what the predecessor handed over
			// is reported, not refused (§13, MES-082).
			s.closeExceptionFor(ctx, tenantID, cmd.ClientEventID)
			s.reportAvailableQuantityVariance(ctx, tenantID, cmd)
			continue
		}
		code, message, retryable := Classify(err)
		results = append(results, SyncCommandResult{
			ClientEventID: cmd.ClientEventID, Status: "FAILED", ErrorCode: &code, ErrorMessage: &message, Retryable: retryable,
		})
		s.recordSyncException(ctx, tenantID, cmd, code, message, retryable)
	}

	out := SyncBatchResult{Processed: len(results), Results: results, ServerTime: db.Now()}
	for _, r := range results {
		switch r.Status {
		case "APPLIED":
			out.Applied++
		case "DUPLICATE":
			out.Duplicates++
		case "FAILED":
			out.Failed++
		}
	}
	if applied {
		s.production.Changed(tenantID)
	}
	return out, nil
}

func payloadString(p map[string]any, key string) *string {
	if p == nil {
		return nil
	}
	if s, ok := p[key].(string); ok && s != "" {
		return &s
	}
	return nil
}

func payloadInt(p map[string]any, key string) int {
	if p == nil {
		return 0
	}
	switch v := p[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func (s *Service) applyCommand(ctx context.Context, tenantID string, cmd SyncCommand) (*string, error) {
	payload := cmd.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	workOrderID := db.NullIf(cmd.WorkOrderID)
	mark := func(entityID string) (*string, error) {
		return &entityID, s.markProcessed(ctx, tenantID, cmd.ClientEventID, cmd.Type, workOrderID, &entityID)
	}
	actor := func() OfflineActor {
		id := "operator"
		if op := payloadString(payload, "operatorId"); op != nil {
			id = *op
		}
		return OfflineActor{ID: id, Name: payloadString(payload, "operatorName"), Type: "OPERATOR"}
	}

	switch cmd.Type {
	case "RECORD_OUTPUT":
		operatorID := ""
		if op := payloadString(payload, "operatorId"); op != nil {
			operatorID = *op
		}
		record, err := s.RecordOutput(ctx, tenantID, OutputInput{
			WorkOrderID: cmd.WorkOrderID, MachineID: payloadString(payload, "machineId"), OperatorID: operatorID,
			ShiftID: payloadString(payload, "shiftId"), GoodQuantity: payloadInt(payload, "goodQuantity"),
			RejectQuantity: payloadInt(payload, "rejectQuantity"), RejectReasonID: payloadString(payload, "rejectReasonId"),
			ClientEventID: cmd.ClientEventID, OccurredAt: cmd.OccurredAt, Notes: payloadString(payload, "notes"),
		})
		if err != nil {
			return nil, err
		}
		return &record.ID, nil

	case "RECORD_DOWNTIME":
		machineID := ""
		if m := payloadString(payload, "machineId"); m != nil {
			machineID = *m
		}
		reasonID := ""
		if r := payloadString(payload, "reasonId"); r != nil {
			reasonID = *r
		}
		record, err := s.StartDowntime(ctx, tenantID, DowntimeInput{
			MachineID: machineID, LineID: payloadString(payload, "lineId"), WorkOrderID: workOrderID,
			OperatorID: payloadString(payload, "operatorId"), ShiftID: payloadString(payload, "shiftId"), ReasonID: reasonID,
			Notes: payloadString(payload, "notes"), ClientEventID: cmd.ClientEventID, OccurredAt: cmd.OccurredAt,
		})
		if err != nil {
			return nil, err
		}
		return &record.ID, nil

	case "RESOLVE_DOWNTIME":
		target := payloadString(payload, "downtimeId")
		if target == nil {
			active, err := s.ActiveDowntimeForWorkOrder(ctx, tenantID, cmd.WorkOrderID)
			if err != nil {
				return nil, err
			}
			if active != nil {
				target = &active.ID
			}
		}
		if target == nil {
			return nil, httpx.NotFound("Tidak ada downtime aktif untuk diselesaikan.")
		}
		record, err := s.ResolveDowntime(ctx, tenantID, *target, ResolveInput{ClientEventID: cmd.ClientEventID, OccurredAt: cmd.OccurredAt})
		if err != nil {
			return nil, err
		}
		return &record.ID, nil

	case "START_WO":
		operatorID := ""
		if op := payloadString(payload, "operatorId"); op != nil {
			operatorID = *op
		}
		wo, err := s.production.StartWorkOrder(ctx, tenantID, cmd.WorkOrderID, operatorID, db.NullIf(cmd.OccurredAt))
		if err != nil {
			return nil, err
		}
		return mark(wo.ID)

	case "CONFIRM_WO":
		wo, err := s.production.ConfirmWorkOrder(ctx, tenantID, cmd.WorkOrderID, payloadString(payload, "operatorId"))
		if err != nil {
			return nil, err
		}
		return mark(wo.ID)

	case "PAUSE_WO", "RESUME_WO":
		// Pauses and resumptions on the shop floor are downtime events
		// (ADR-18, ADR-24); the command is acknowledged and nothing moves.
		return mark(cmd.WorkOrderID)

	case "COMPLETE_WO":
		wo, err := s.production.CompleteWorkOrder(ctx, tenantID, cmd.WorkOrderID, db.NullIf(cmd.OccurredAt))
		if err != nil {
			return nil, err
		}
		return mark(wo.ID)

	// --- MES Improvement v2.0 (§38): each has its own idempotency key, and
	// clientEventId is reused as that key.
	case "RECORD_CONSUMPTION":
		imp := s.improve()
		if imp == nil {
			return nil, httpx.Validation("Modul material belum aktif.")
		}
		id, err := imp.RecordConsumption(ctx, tenantID, payload, cmd.WorkOrderID, cmd.ClientEventID, actor())
		if err != nil {
			return nil, err
		}
		return mark(id)

	case "RECORD_INSPECTION":
		imp := s.improve()
		if imp == nil {
			return nil, httpx.Validation("Modul quality belum aktif.")
		}
		id, err := imp.RecordInspection(ctx, tenantID, payload, cmd.WorkOrderID, cmd.ClientEventID, actor())
		if err != nil {
			return nil, err
		}
		return mark(id)

	case "RECORD_WIP":
		imp := s.improve()
		if imp == nil {
			return nil, httpx.Validation("Modul WIP belum aktif.")
		}
		id, err := imp.CreateWip(ctx, tenantID, payload, cmd.WorkOrderID, actor())
		if err != nil {
			return nil, err
		}
		return mark(id)

	case "TRANSFER_WIP":
		imp := s.improve()
		if imp == nil {
			return nil, httpx.Validation("Modul WIP belum aktif.")
		}
		id, err := imp.CreateWipTransfer(ctx, tenantID, payload, cmd.ClientEventID, actor())
		if err != nil {
			return nil, err
		}
		return mark(id)
	}
	return nil, httpx.Validation(fmt.Sprintf("Tipe perintah offline tidak dikenal: %s.", cmd.Type))
}

// markProcessed records a client event for commands whose handler writes
// no row of its own.
func (s *Service) markProcessed(ctx context.Context, tenantID, clientEventID, commandType string, workOrderID, entityID *string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := s.syncEvents.Claim(ctx, tx, tenantID, clientEventID, commandType, workOrderID, entityID)
		return err
	})
}

func shiftDateOf(occurredAt string) *string {
	if len(occurredAt) >= 10 {
		return db.Ptr(occurredAt[:10])
	}
	return nil
}

// recordSyncException files a rejection where a supervisor can see it. It
// never fails the batch: the command's outcome is already decided.
func (s *Service) recordSyncException(ctx context.Context, tenantID string, cmd SyncCommand, code, reason string, retryable bool) {
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		cc, err := s.contextFor(ctx, tx, tenantID, db.NullIf(cmd.WorkOrderID))
		if err != nil {
			// A batch-mode refusal is itself the reason being filed; the
			// line is then simply unknown.
			var apiErr *httpx.Error
			if !errors.As(err, &apiErr) {
				return err
			}
		}
		payload := cmd.Payload
		if payload == nil {
			payload = map[string]any{}
		}
		_, err = s.exceptions.Record(ctx, tx, ExceptionInput{
			TenantID: tenantID, ClientEventID: cmd.ClientEventID, CommandType: cmd.Type,
			WorkOrderID: db.NullIf(cmd.WorkOrderID), OperatorID: payloadString(payload, "operatorId"),
			Payload: payload, OccurredAt: db.NullIf(cmd.OccurredAt), ErrorCode: code, Reason: reason,
			Retryable: retryable, LineID: cc.lineID, ShiftDate: shiftDateOf(cmd.OccurredAt),
		})
		return err
	})
	if err != nil && s.log != nil {
		s.log.Error("[sync-exception] gagal mencatat exception", "error", err)
	}
}

func (s *Service) closeExceptionFor(ctx context.Context, tenantID, clientEventID string) {
	_ = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return s.exceptions.ResolveByEvent(ctx, tx, tenantID, clientEventID, "Perintah berhasil diterapkan pada percobaan berikutnya.")
	})
}

// reportAvailableQuantityVariance files an available-quantity shortfall as
// an exception, not a rejection (ADR-25, ADR-26, MES-082).
func (s *Service) reportAvailableQuantityVariance(ctx context.Context, tenantID string, cmd SyncCommand) {
	if cmd.Type != "RECORD_OUTPUT" || cmd.WorkOrderID == "" {
		return
	}
	recorded := payloadInt(cmd.Payload, "goodQuantity") + payloadInt(cmd.Payload, "rejectQuantity")
	if recorded <= 0 {
		return
	}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		w, err := s.production.WorkOrderIn(ctx, tx, tenantID, cmd.WorkOrderID)
		if err != nil || w == nil || w.PredecessorWorkOrderID == nil {
			return err
		}
		// inputQuantity already includes this command, so the available
		// figure is measured before it.
		before := *w
		before.InputQuantity = w.InputQuantity - recorded
		if before.InputQuantity < 0 {
			before.InputQuantity = 0
		}
		available, err := s.production.AvailableQuantityIn(ctx, tx, tenantID, before)
		if err != nil || available >= recorded {
			return err
		}
		shortfall := recorded - available
		_, err = s.exceptions.Record(ctx, tx, ExceptionInput{
			TenantID: tenantID, ClientEventID: cmd.ClientEventID + ":available-qty", CommandType: cmd.Type,
			WorkOrderID: &cmd.WorkOrderID, OperatorID: payloadString(cmd.Payload, "operatorId"),
			Payload:    map[string]any{"recorded": recorded, "available": available, "shortfall": shortfall},
			OccurredAt: db.NullIf(cmd.OccurredAt), ErrorCode: "AVAILABLE_QUANTITY_VARIANCE",
			Reason: fmt.Sprintf("Tercatat %d unit sementara process sebelumnya baru menyerahkan %d unit; selisih %d unit. "+
				"Catatan tetap diterima, mohon periksa serah terima antar process.", recorded, available, shortfall),
			Retryable: false, LineID: &w.LineID, ShiftDate: shiftDateOf(cmd.OccurredAt),
		})
		return err
	})
	if err != nil && s.log != nil {
		s.log.Error("[sync-exception] gagal memeriksa selisih available quantity", "error", err)
	}
}

// SyncExceptions lists exceptions for the supervisor.
func (s *Service) SyncExceptions(ctx context.Context, tenantID string, f ExceptionFilter) ([]SyncException, error) {
	var out []SyncException
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.exceptions.List(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// SyncExceptionSummary is the open count per line.
func (s *Service) SyncExceptionSummary(ctx context.Context, tenantID string) ([]ExceptionSummaryRow, error) {
	var out []ExceptionSummaryRow
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.exceptions.OpenSummary(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// SetSyncExceptionStatus resolves, ignores or reopens an exception.
func (s *Service) SetSyncExceptionStatus(ctx context.Context, tenantID, id, status, actorID string, note *string) (SyncException, error) {
	var out *SyncException
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.exceptions.SetStatus(ctx, tx, tenantID, id, status, actorID, note)
		return err
	})
	if err != nil {
		return SyncException{}, err
	}
	if out == nil {
		return SyncException{}, httpx.NotFound("Sync exception tidak ditemukan.")
	}
	return *out, nil
}

// Location is the plant timezone shift_date is derived in.
func (s *Service) Location() *time.Location { return s.loc }
