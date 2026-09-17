package production

import (
	"fmt"
	"strings"
)

// The Production Quantity Flow invariants (§10, MES-017).
//
//	input ≥ output + reject + scrap + rework      (INPUT_COVERS_DISPOSITION)
//	transferred ≤ output                         (TRANSFERRED_WITHIN_OUTPUT)
//	every bucket ≥ 0                             (NON_NEGATIVE)
//	input − dispositions = 0 when COMPLETED       (WIP_ZERO_ON_COMPLETION)
//
// Output never includes reject: the four disposition buckets are mutually
// exclusive, which is the rule the worked example in §10 exists to show.

// Flow is the seven quantities of a work order or a batch.
type Flow struct {
	PlannedQuantity     *int
	InputQuantity       int
	OutputQuantity      int
	RejectQuantity      int
	ScrapQuantity       int
	ReworkQuantity      int
	TransferredQuantity int
}

// FlowDelta is what a record adds; nil fields add nothing.
type FlowDelta struct {
	InputQuantity       int
	OutputQuantity      int
	RejectQuantity      int
	ScrapQuantity       int
	ReworkQuantity      int
	TransferredQuantity int
}

// Invariant names the rule a violation breaks.
type Invariant string

const (
	NonNegative             Invariant = "NON_NEGATIVE"
	InputCoversDisposition  Invariant = "INPUT_COVERS_DISPOSITION"
	TransferredWithinOutput Invariant = "TRANSFERRED_WITHIN_OUTPUT"
	WipZeroOnCompletion     Invariant = "WIP_ZERO_ON_COMPLETION"
)

// Violation is one broken invariant, with the message the console shows.
type Violation struct {
	Invariant Invariant
	Message   string
}

// FlowViolation is the error a failed assertion raises.
type FlowViolation struct {
	Scope      string // WORK_ORDER | BATCH
	EntityID   string
	Violations []Violation
}

func (e *FlowViolation) Error() string {
	label := "Work Order"
	if e.Scope == "BATCH" {
		label = "Batch"
	}
	msgs := make([]string, len(e.Violations))
	for i, v := range e.Violations {
		msgs[i] = v.Message
	}
	return fmt.Sprintf("Quantity flow %s %s tidak valid. %s", label, e.EntityID, strings.Join(msgs, " "))
}

// Failed lists the invariants that failed.
func (e *FlowViolation) Failed() []Invariant {
	out := make([]Invariant, len(e.Violations))
	for i, v := range e.Violations {
		out[i] = v.Invariant
	}
	return out
}

// WorkInProgress is what has entered the process and not yet been disposed.
func WorkInProgress(f Flow) int {
	return f.InputQuantity - f.OutputQuantity - f.RejectQuantity - f.ScrapQuantity - f.ReworkQuantity
}

// YieldRatio is output over input, or nil when nothing has entered.
func YieldRatio(f Flow) *float64 {
	if f.InputQuantity <= 0 {
		return nil
	}
	r := float64(f.OutputQuantity) / float64(f.InputQuantity)
	return &r
}

// CheckFlow returns every violation; an empty slice means the flow is valid.
func CheckFlow(f Flow, completed bool) []Violation {
	var violations []Violation

	labels := []struct {
		label string
		value *int
	}{
		{"planned", f.PlannedQuantity},
		{"input", &f.InputQuantity},
		{"output", &f.OutputQuantity},
		{"reject", &f.RejectQuantity},
		{"scrap", &f.ScrapQuantity},
		{"rework", &f.ReworkQuantity},
		{"transferred", &f.TransferredQuantity},
	}
	for _, l := range labels {
		if l.value == nil {
			continue
		}
		if *l.value < 0 {
			violations = append(violations, Violation{NonNegative,
				fmt.Sprintf("Quantity %s tidak boleh negatif (%d).", l.label, *l.value)})
		}
	}

	input, output, reject, scrap, rework, transferred :=
		f.InputQuantity, f.OutputQuantity, f.RejectQuantity, f.ScrapQuantity, f.ReworkQuantity, f.TransferredQuantity

	disposition := output + reject + scrap + rework
	if input < disposition {
		violations = append(violations, Violation{InputCoversDisposition,
			fmt.Sprintf("Input %d lebih kecil dari output %d + reject %d + scrap %d + rework %d = %d; selisih %d. "+
				"Output tidak pernah mencakup reject — keempat bucket saling eksklusif.",
				input, output, reject, scrap, rework, disposition, disposition-input)})
	}

	if transferred > output {
		violations = append(violations, Violation{TransferredWithinOutput,
			fmt.Sprintf("Transferred %d melebihi output %d; selisih %d. "+
				"Hanya quantity yang lolos kualitas dapat diserahkan ke process berikutnya.",
				transferred, output, transferred-output)})
	}

	if completed {
		wip := input - disposition
		if wip != 0 {
			violations = append(violations, Violation{WipZeroOnCompletion,
				fmt.Sprintf("WIP harus nol saat COMPLETED, saat ini %d (input %d − output %d − reject %d − scrap %d − rework %d). "+
					"Selesaikan disposisi seluruh unit yang masuk sebelum menutup.",
					wip, input, output, reject, scrap, rework)})
		}
	}

	return violations
}

// AssertFlow fails with a FlowViolation when any invariant is broken.
func AssertFlow(scope, entityID string, f Flow, completed bool) error {
	if v := CheckFlow(f, completed); len(v) > 0 {
		return &FlowViolation{Scope: scope, EntityID: entityID, Violations: v}
	}
	return nil
}

// AssertDelta judges a change before it is applied and returns the flow it
// would produce.
func AssertDelta(scope, entityID string, current Flow, delta FlowDelta, completed bool) (Flow, error) {
	next := Flow{
		PlannedQuantity:     current.PlannedQuantity,
		InputQuantity:       current.InputQuantity + delta.InputQuantity,
		OutputQuantity:      current.OutputQuantity + delta.OutputQuantity,
		RejectQuantity:      current.RejectQuantity + delta.RejectQuantity,
		ScrapQuantity:       current.ScrapQuantity + delta.ScrapQuantity,
		ReworkQuantity:      current.ReworkQuantity + delta.ReworkQuantity,
		TransferredQuantity: current.TransferredQuantity + delta.TransferredQuantity,
	}
	if err := AssertFlow(scope, entityID, next, completed); err != nil {
		return next, err
	}
	return next, nil
}

// AssertBatchPlannedWithinWorkOrder: the batches of a work order may plan
// less than it (the rest is remaining batch capacity), never more (§9 Q6).
func AssertBatchPlannedWithinWorkOrder(workOrderID string, workOrderPlanned, batchPlannedTotal int) error {
	if batchPlannedTotal > workOrderPlanned {
		return &FlowViolation{Scope: "BATCH", EntityID: workOrderID, Violations: []Violation{{
			InputCoversDisposition,
			fmt.Sprintf("Total planned quantity batch %d melebihi planned quantity Work Order %d; kelebihan %d. "+
				"Total batch boleh kurang (sisanya remaining batch capacity), tidak boleh lebih.",
				batchPlannedTotal, workOrderPlanned, batchPlannedTotal-workOrderPlanned),
		}}}
	}
	return nil
}

// AssertSplitPlannedExact: a split divides the parent completely, so the
// children's planned total must equal the parent's (§9 Q6).
func AssertSplitPlannedExact(parentWorkOrderID string, parentPlanned, childPlannedTotal int) error {
	if childPlannedTotal != parentPlanned {
		return &FlowViolation{Scope: "WORK_ORDER", EntityID: parentWorkOrderID, Violations: []Violation{{
			InputCoversDisposition,
			fmt.Sprintf("Total planned quantity child %d tidak sama dengan planned quantity parent %d; selisih %d. "+
				"Split membagi habis pekerjaan, jadi totalnya harus persis sama.",
				childPlannedTotal, parentPlanned, childPlannedTotal-parentPlanned),
		}}}
	}
	return nil
}

// AvailableQuantity is what the predecessor has handed over and the
// successor has not yet taken in (ADR-25): never negative.
func AvailableQuantity(predecessorTransferred, successorInput int) int {
	if v := predecessorTransferred - successorInput; v > 0 {
		return v
	}
	return 0
}
