package production

import (
	"fmt"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// The Work Order lifecycle (§11, MES-015, ADR-18).
//
//	DRAFT ──► SCHEDULED ──► CONFIRMED ──► IN_PRODUCTION ──► COMPLETED
//	  │           │  ▲          │  ▲            │
//	  │           │  └──────────┘  │            │
//	  │           └────────────────┘            │
//	  └─────────────────┴──────────────────────┴──► CANCELLED
//
// RELEASED, IN_PROGRESS and PAUSED do not exist: a pause on the shop floor
// is a downtime record, not a work order status. Backward moves (CONFIRMED →
// SCHEDULED, SCHEDULED → DRAFT) are allowed without guards; forward moves
// name every unmet condition so a planner can fix all of them at once.

var legalTransitions = map[string][]string{
	StatusDraft:        {StatusScheduled, StatusCancelled},
	StatusScheduled:    {StatusConfirmed, StatusDraft, StatusCancelled},
	StatusConfirmed:    {StatusInProduction, StatusScheduled, StatusCancelled},
	StatusInProduction: {StatusCompleted, StatusCancelled},
	StatusCompleted:    {},
	StatusCancelled:    {},
}

// RetiredWorkOrderStatuses are the statuses ADR-18 removed.
var RetiredWorkOrderStatuses = []string{"RELEASED", "IN_PROGRESS", "PAUSED"}

// PredecessorState is what the soft/strict process guard judges (§13).
type PredecessorState struct {
	WorkOrderID       string // the predecessor's number, as the message shows it
	Status            string
	AvailableQuantity int
}

// TransitionContext is every fact a guard may consult.
type TransitionContext struct {
	PlannedQuantity       *int
	PlannedStart          *string
	PlannedEnd            *string
	Sequence              *int
	MachineID             *string
	MoldID                *string
	ShiftID               *string
	MoldRequired          bool
	AssignedOperatorIDs   []string // nil means "not judged"
	OpenScheduleConflicts []string
	IncompatibleResources []string
	OccupiedResources     []string
	ShiftActive           *bool
	ActiveDowntimeCount   int
	Predecessor           *PredecessorState
	StrictProcessSequence bool
	Reason                *string
}

// MachineEffect is the machine state a transition drives.
type MachineEffect string

const (
	MachineRunning MachineEffect = "RUNNING"
	MachineIdle    MachineEffect = "IDLE"
)

// TransitionEffects are the side effects a legal transition carries.
type TransitionEffects struct {
	SetActualStart        bool
	SetActualEnd          bool
	SetConfirmed          *bool
	MachineState          MachineEffect
	SetStatusReason       bool
	AggregateOnCompletion bool
}

// Decision is the outcome of evaluating a transition.
type Decision struct {
	Allowed bool
	Reasons []string
	Effects TransitionEffects
}

// TransitionError carries every guard that failed.
type TransitionError struct {
	From, To string
	Reasons  []string
}

func (e *TransitionError) Error() string {
	return fmt.Sprintf("Work Order tidak dapat berpindah dari %s ke %s: %s", e.From, e.To, strings.Join(e.Reasons, " "))
}

func isBlank(s *string) bool { return s == nil || strings.TrimSpace(*s) == "" }

// CanTransition reports whether the edge exists.
func CanTransition(current, next string) bool {
	for _, s := range legalTransitions[current] {
		if s == next {
			return true
		}
	}
	return false
}

// AllowedTargets lists where a status may move.
func AllowedTargets(current string) []string {
	return append([]string(nil), legalTransitions[current]...)
}

// Evaluate judges a transition without applying it.
func Evaluate(current, next string, c TransitionContext) Decision {
	if current == next {
		return Decision{Reasons: []string{fmt.Sprintf("Work Order sudah berstatus %s.", current)}}
	}
	if !CanTransition(current, next) {
		targets := strings.Join(AllowedTargets(current), ", ")
		if targets == "" {
			targets = "(tidak ada)"
		}
		return Decision{Reasons: []string{fmt.Sprintf(
			"Transisi %s → %s tidak ada pada state machine. Dari %s hanya diizinkan: %s.", current, next, current, targets)}}
	}

	var reasons []string
	var effects TransitionEffects

	if next == StatusCancelled {
		if isBlank(c.Reason) {
			reasons = append(reasons, "Alasan pembatalan wajib diisi.")
		}
		effects.SetStatusReason = true
		return Decision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if current == StatusDraft && next == StatusScheduled {
		if c.PlannedQuantity == nil || *c.PlannedQuantity <= 0 {
			reasons = append(reasons, "Planned quantity harus lebih dari nol sebelum dijadwalkan.")
		}
		if isBlank(c.PlannedStart) {
			reasons = append(reasons, "Planned start belum ditetapkan.")
		}
		if isBlank(c.PlannedEnd) {
			reasons = append(reasons, "Planned end belum ditetapkan.")
		}
		if !isBlank(c.PlannedStart) && !isBlank(c.PlannedEnd) {
			start, errS := db.ParseISO(*c.PlannedStart)
			end, errE := db.ParseISO(*c.PlannedEnd)
			if errS == nil && errE == nil && !end.After(start) {
				reasons = append(reasons, "Planned end harus setelah planned start.")
			}
		}
		if c.Sequence == nil {
			reasons = append(reasons, "Sequence process belum ditetapkan.")
		}
		for _, conflict := range c.OpenScheduleConflicts {
			reasons = append(reasons, fmt.Sprintf("Konflik jadwal terbuka: %s.", conflict))
		}
		return Decision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if current == StatusScheduled && next == StatusConfirmed {
		if c.PlannedQuantity == nil || *c.PlannedQuantity <= 0 {
			reasons = append(reasons, "Planned quantity belum ditetapkan.")
		}
		if isBlank(c.PlannedStart) || isBlank(c.PlannedEnd) {
			reasons = append(reasons, "Jadwal (planned start dan end) belum lengkap.")
		}
		if isBlank(c.MachineID) {
			reasons = append(reasons, "Mesin belum ditetapkan.")
		}
		if c.MoldRequired && isBlank(c.MoldID) {
			reasons = append(reasons, "Mold belum ditetapkan.")
		}
		if isBlank(c.ShiftID) {
			reasons = append(reasons, "Shift belum ditetapkan.")
		}
		if c.AssignedOperatorIDs != nil && len(c.AssignedOperatorIDs) == 0 {
			reasons = append(reasons, "Operator belum ditugaskan.")
		}
		for _, resource := range c.IncompatibleResources {
			reasons = append(reasons, fmt.Sprintf("Resource tidak compatible dengan product: %s.", resource))
		}
		for _, conflict := range c.OpenScheduleConflicts {
			reasons = append(reasons, fmt.Sprintf("Konflik terbuka harus diselesaikan: %s.", conflict))
		}
		effects.SetConfirmed = db.Ptr(true)
		return Decision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if current == StatusConfirmed && next == StatusInProduction {
		if c.AssignedOperatorIDs != nil && len(c.AssignedOperatorIDs) == 0 {
			reasons = append(reasons, "Operator belum ditugaskan pada Work Order ini.")
		}
		if c.ShiftActive != nil && !*c.ShiftActive {
			reasons = append(reasons, "Shift yang dijadwalkan belum aktif.")
		}
		for _, resource := range c.OccupiedResources {
			reasons = append(reasons, fmt.Sprintf("Resource sedang dipakai Work Order lain: %s.", resource))
		}
		reasons = append(reasons, predecessorGuardFailures(c)...)
		effects.SetActualStart = true
		effects.MachineState = MachineRunning
		return Decision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if current == StatusInProduction && next == StatusCompleted {
		if c.ActiveDowntimeCount > 0 {
			reasons = append(reasons, fmt.Sprintf(
				"Masih ada %d downtime record berstatus ACTIVE; selesaikan downtime sebelum menutup Work Order.", c.ActiveDowntimeCount))
		}
		effects.SetActualEnd = true
		effects.MachineState = MachineIdle
		effects.AggregateOnCompletion = true
		return Decision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if next == StatusDraft || next == StatusScheduled {
		return Decision{Allowed: true, Effects: TransitionEffects{SetConfirmed: db.Ptr(false)}}
	}
	return Decision{Allowed: true}
}

// predecessorGuardFailures is the soft process guard (§13, MES-015-4): in
// strict mode the predecessor must be COMPLETED; otherwise it must have
// started and have handed something over.
func predecessorGuardFailures(c TransitionContext) []string {
	p := c.Predecessor
	if p == nil {
		return nil
	}
	var failures []string
	if c.StrictProcessSequence {
		if p.Status != StatusCompleted {
			failures = append(failures, fmt.Sprintf(
				"Mode strict: process sebelumnya (%s) harus COMPLETED, saat ini %s.", p.WorkOrderID, p.Status))
		}
		return failures
	}
	started := p.Status == StatusInProduction || p.Status == StatusCompleted
	if !started {
		failures = append(failures, fmt.Sprintf(
			"Process sebelumnya (%s) belum berjalan, saat ini %s.", p.WorkOrderID, p.Status))
	}
	if p.AvailableQuantity <= 0 {
		failures = append(failures, fmt.Sprintf(
			"Belum ada quantity yang diserahkan process sebelumnya (available %d).", p.AvailableQuantity))
	}
	return failures
}

// ValidateTransition returns the effects of a legal transition or a
// TransitionError listing every failed guard.
func ValidateTransition(current, next string, c TransitionContext) (TransitionEffects, error) {
	d := Evaluate(current, next, c)
	if !d.Allowed {
		return d.Effects, &TransitionError{From: current, To: next, Reasons: d.Reasons}
	}
	return d.Effects, nil
}

// --- Batch lifecycle (MES-016, §12) ------------------------------------
//
//	PLANNED ──► IN_PRODUCTION ──► COMPLETED
//	    │             │
//	    └─────────────┴──────────► CANCELLED
//
// A batch has no SCHEDULED and no CONFIRMED: both are work order concerns.
// It may only start once its work order is IN_PRODUCTION, and cancelling it
// never cancels the work order.

const (
	BatchPlanned      = "PLANNED"
	BatchInProduction = "IN_PRODUCTION"
	BatchCompleted    = "COMPLETED"
	BatchCancelled    = "CANCELLED"
)

var batchTransitions = map[string][]string{
	BatchPlanned:      {BatchInProduction, BatchCancelled},
	BatchInProduction: {BatchCompleted, BatchCancelled},
	BatchCompleted:    {},
	BatchCancelled:    {},
}

// Legacy statuses, mapped onto the v1.0 lifecycle when read.
var batchLegacyAliases = map[string]string{
	"ACTIVE":   BatchInProduction,
	"HOLD":     BatchInProduction,
	"SCRAPPED": BatchCancelled,
}

// RetiredBatchStatuses are the statuses the batch model deliberately lacks.
var RetiredBatchStatuses = []string{"SCHEDULED", "CONFIRMED", "PAUSED"}

// BatchContext is what the batch guards consult.
type BatchContext struct {
	WorkOrderStatus     *string
	PlannedQuantity     *int
	ActiveDowntimeCount int
	Reason              *string
}

// BatchEffects are the side effects of a batch transition.
type BatchEffects struct {
	SetActualStart          bool
	SetActualEnd            bool
	SetStatusReason         bool
	AggregateToWorkOrder    bool
	ReleaseRemainingPlanned bool
}

// BatchDecision is the outcome of evaluating a batch transition.
type BatchDecision struct {
	Allowed bool
	Reasons []string
	Effects BatchEffects
}

// BatchTransitionError carries every failed batch guard.
type BatchTransitionError struct {
	From, To string
	Reasons  []string
}

func (e *BatchTransitionError) Error() string {
	return fmt.Sprintf("Batch tidak dapat berpindah dari %s ke %s: %s", e.From, e.To, strings.Join(e.Reasons, " "))
}

// NormalizeBatchStatus maps a legacy status onto the lifecycle.
func NormalizeBatchStatus(status string) string {
	if alias, ok := batchLegacyAliases[status]; ok {
		return alias
	}
	return status
}

// BatchCanTransition reports whether the edge exists.
func BatchCanTransition(current, next string) bool {
	for _, s := range batchTransitions[NormalizeBatchStatus(current)] {
		if s == next {
			return true
		}
	}
	return false
}

// BatchAllowedTargets lists where a batch status may move.
func BatchAllowedTargets(current string) []string {
	return append([]string(nil), batchTransitions[NormalizeBatchStatus(current)]...)
}

// EvaluateBatch judges a batch transition without applying it.
func EvaluateBatch(current, next string, c BatchContext) BatchDecision {
	from := NormalizeBatchStatus(current)
	if from == next {
		return BatchDecision{Reasons: []string{fmt.Sprintf("Batch sudah berstatus %s.", next)}}
	}
	if !BatchCanTransition(from, next) {
		targets := strings.Join(BatchAllowedTargets(from), ", ")
		if targets == "" {
			targets = "(tidak ada)"
		}
		return BatchDecision{Reasons: []string{fmt.Sprintf(
			"Transisi %s → %s tidak ada pada lifecycle batch. Dari %s hanya diizinkan: %s.", from, next, from, targets)}}
	}

	var reasons []string
	var effects BatchEffects

	if next == BatchCancelled {
		if isBlank(c.Reason) {
			reasons = append(reasons, "Alasan pembatalan (status_reason) wajib diisi.")
		}
		effects.SetStatusReason = true
		effects.ReleaseRemainingPlanned = true
		return BatchDecision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if from == BatchPlanned && next == BatchInProduction {
		if c.WorkOrderStatus != nil && *c.WorkOrderStatus != StatusInProduction {
			reasons = append(reasons, fmt.Sprintf(
				"Work Order induk harus berstatus IN_PRODUCTION sebelum batch dimulai, saat ini %s.", *c.WorkOrderStatus))
		}
		if c.PlannedQuantity != nil && *c.PlannedQuantity <= 0 {
			reasons = append(reasons, "Planned quantity batch harus lebih dari nol.")
		}
		effects.SetActualStart = true
		return BatchDecision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	if from == BatchInProduction && next == BatchCompleted {
		if c.ActiveDowntimeCount > 0 {
			reasons = append(reasons, fmt.Sprintf(
				"Masih ada %d downtime record berstatus ACTIVE pada batch ini; selesaikan downtime sebelum menutup batch.", c.ActiveDowntimeCount))
		}
		effects.SetActualEnd = true
		effects.AggregateToWorkOrder = true
		return BatchDecision{Allowed: len(reasons) == 0, Reasons: reasons, Effects: effects}
	}

	return BatchDecision{Allowed: true}
}

// ValidateBatchTransition returns the effects or a BatchTransitionError.
func ValidateBatchTransition(current, next string, c BatchContext) (BatchEffects, error) {
	d := EvaluateBatch(current, next, c)
	if !d.Allowed {
		return d.Effects, &BatchTransitionError{From: NormalizeBatchStatus(current), To: next, Reasons: d.Reasons}
	}
	return d.Effects, nil
}
