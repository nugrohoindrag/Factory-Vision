package production

import (
	"fmt"
	"sort"
	"strings"
)

// Routing validation, run before any work order is generated (MES-042).
//
// A separate, pure step rather than checks scattered through the generator,
// because no partial work orders may be stored: the whole routing is judged
// first, and generation either runs on a valid routing or does not run at
// all. Every failure names its cause so a planner can fix the master data.

// RoutingStep is one product_routing row with what generation needs to know
// about it.
type RoutingStep struct {
	RoutingID            string
	ProcessID            string
	ProcessCode          string
	ProcessName          string
	ProcessStatus        string
	Sequence             int
	WorkCenterID         *string
	MachineID            *string
	Active               bool
	EligibleMachineCount int
}

// RoutingProblem is one named defect in a routing.
type RoutingProblem struct {
	Code        string
	ProcessID   string
	ProcessCode string
	Sequence    *int
	Message     string
}

// RoutingError is raised for an invalid routing.
type RoutingError struct {
	ProductID string
	Problems  []RoutingProblem
}

func (e *RoutingError) Error() string {
	msgs := make([]string, len(e.Problems))
	for i, p := range e.Problems {
		msgs[i] = p.Message
	}
	return fmt.Sprintf("Routing product %s tidak valid: %s", e.ProductID, strings.Join(msgs, " "))
}

// ValidateRouting returns every problem with a routing, in the order they
// would be met. Continuity is checked against the active steps only.
func ValidateRouting(productID string, steps []RoutingStep) []RoutingProblem {
	if len(steps) == 0 {
		return []RoutingProblem{{
			Code: "NO_ROUTING",
			Message: fmt.Sprintf("Product %s belum memiliki process routing. ", productID) +
				"Tetapkan routing pada master data sebelum generate Work Order.",
		}}
	}

	var problems []RoutingProblem
	problem := func(code string, step RoutingStep, message string) {
		seq := step.Sequence
		problems = append(problems, RoutingProblem{Code: code, ProcessID: step.ProcessID, ProcessCode: step.ProcessCode, Sequence: &seq, Message: message})
	}

	for _, step := range steps {
		if !step.Active {
			problem("ROUTING_STEP_INACTIVE", step, fmt.Sprintf(
				"Baris routing sequence %d (%s) berstatus non-aktif, sehingga rantai process terputus.", step.Sequence, step.ProcessCode))
		}
	}
	for _, step := range steps {
		if step.ProcessStatus != "ACTIVE" {
			problem("PROCESS_INACTIVE", step, fmt.Sprintf(
				"Process %s (%s) berstatus %s. Aktifkan kembali process tersebut atau ubah routing product.",
				step.ProcessCode, step.ProcessName, step.ProcessStatus))
		}
	}

	active := make([]RoutingStep, 0, len(steps))
	for _, step := range steps {
		if step.Active {
			active = append(active, step)
		}
	}
	sort.SliceStable(active, func(i, j int) bool { return active[i].Sequence < active[j].Sequence })

	seen := map[int]bool{}
	for _, step := range active {
		if seen[step.Sequence] {
			problem("SEQUENCE_DUPLICATE", step, fmt.Sprintf(
				"Sequence %d dipakai lebih dari satu process (%s); urutan process menjadi ambigu.", step.Sequence, step.ProcessCode))
		}
		seen[step.Sequence] = true
	}

	if len(active) > 0 {
		if active[0].Sequence != 1 {
			problem("SEQUENCE_NOT_CONTINUOUS", active[0], fmt.Sprintf(
				"Routing dimulai dari sequence %d, bukan 1. Process pertama harus bersequence 1.", active[0].Sequence))
		}
		for i := 1; i < len(active); i++ {
			previous, current := active[i-1], active[i]
			if current.Sequence != previous.Sequence+1 {
				problem("SEQUENCE_NOT_CONTINUOUS", current, fmt.Sprintf(
					"Sequence melompat dari %d (%s) ke %d (%s); tidak ada process di antaranya.",
					previous.Sequence, previous.ProcessCode, current.Sequence, current.ProcessCode))
			}
		}
	}

	for _, step := range active {
		if step.MachineID == nil && step.WorkCenterID == nil && step.EligibleMachineCount == 0 {
			problem("NO_MAPPABLE_RESOURCE", step, fmt.Sprintf(
				"Process %s tidak memiliki mesin atau work center yang dapat dipetakan. ", step.ProcessCode)+
				"Tetapkan machine/work center pada routing, atau product machine rate pada master data.")
		}
	}

	return problems
}

// AssertRoutingValid raises a RoutingError on the first invalid routing.
func AssertRoutingValid(productID string, steps []RoutingStep) error {
	if problems := ValidateRouting(productID, steps); len(problems) > 0 {
		return &RoutingError{ProductID: productID, Problems: problems}
	}
	return nil
}
