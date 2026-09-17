package production

import (
	"errors"
	"strings"
	"testing"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
)

// The business rules ported from apps/api/test/sprint-3-domain.test.ts and
// final-qa-business-rules.test.ts. They pin the messages as well as the
// verdicts, because the console shows the messages.

func TestOnlyTheDocumentedTransitionsExist(t *testing.T) {
	want := map[string][]string{
		StatusDraft:        {StatusScheduled, StatusCancelled},
		StatusScheduled:    {StatusConfirmed, StatusDraft, StatusCancelled},
		StatusConfirmed:    {StatusInProduction, StatusScheduled, StatusCancelled},
		StatusInProduction: {StatusCompleted, StatusCancelled},
		StatusCompleted:    {},
		StatusCancelled:    {},
	}
	for from, targets := range want {
		got := AllowedTargets(from)
		if strings.Join(got, ",") != strings.Join(targets, ",") {
			t.Errorf("%s: allowed %v, want %v", from, got, targets)
		}
	}
	for _, retired := range RetiredWorkOrderStatuses {
		if CanTransition(StatusDraft, retired) || len(AllowedTargets(retired)) != 0 {
			t.Errorf("%s must not exist (ADR-18)", retired)
		}
	}
	if CanTransition(StatusDraft, StatusInProduction) {
		t.Error("DRAFT → IN_PRODUCTION must not exist")
	}
}

func TestCancelledIsReachableFromEveryLiveStatusAndNeedsAReason(t *testing.T) {
	for _, from := range []string{StatusDraft, StatusScheduled, StatusConfirmed, StatusInProduction} {
		d := Evaluate(from, StatusCancelled, TransitionContext{})
		if d.Allowed || d.Reasons[0] != "Alasan pembatalan wajib diisi." {
			t.Errorf("%s → CANCELLED without a reason: %+v", from, d)
		}
		d = Evaluate(from, StatusCancelled, TransitionContext{Reason: db.Ptr("mesin rusak")})
		if !d.Allowed || !d.Effects.SetStatusReason {
			t.Errorf("%s → CANCELLED with a reason: %+v", from, d)
		}
	}
	for _, from := range []string{StatusCompleted, StatusCancelled} {
		if d := Evaluate(from, StatusCancelled, TransitionContext{Reason: db.Ptr("x")}); d.Allowed {
			t.Errorf("%s → CANCELLED must be refused", from)
		}
	}
}

func TestDraftToScheduledNamesEveryUnmetGuard(t *testing.T) {
	d := Evaluate(StatusDraft, StatusScheduled, TransitionContext{PlannedQuantity: db.Ptr(0)})
	if d.Allowed {
		t.Fatal("expected refusal")
	}
	for _, want := range []string{
		"Planned quantity harus lebih dari nol sebelum dijadwalkan.",
		"Planned start belum ditetapkan.",
		"Planned end belum ditetapkan.",
		"Sequence process belum ditetapkan.",
	} {
		if !contains(d.Reasons, want) {
			t.Errorf("missing reason %q in %v", want, d.Reasons)
		}
	}
	d = Evaluate(StatusDraft, StatusScheduled, TransitionContext{
		PlannedQuantity: db.Ptr(10), PlannedStart: db.Ptr("2026-09-02T00:00:00.000Z"), PlannedEnd: db.Ptr("2026-09-01T00:00:00.000Z"), Sequence: db.Ptr(1),
	})
	if d.Allowed || !contains(d.Reasons, "Planned end harus setelah planned start.") {
		t.Errorf("end before start: %+v", d)
	}
	d = Evaluate(StatusDraft, StatusScheduled, TransitionContext{
		PlannedQuantity: db.Ptr(10), PlannedStart: db.Ptr("2026-09-01T00:00:00.000Z"), PlannedEnd: db.Ptr("2026-09-01T08:00:00.000Z"), Sequence: db.Ptr(1),
	})
	if !d.Allowed {
		t.Errorf("valid schedule refused: %v", d.Reasons)
	}
}

func TestScheduledToConfirmedRequiresTheFullChecklist(t *testing.T) {
	d := Evaluate(StatusScheduled, StatusConfirmed, TransitionContext{MoldRequired: true, AssignedOperatorIDs: []string{}})
	for _, want := range []string{
		"Planned quantity belum ditetapkan.", "Jadwal (planned start dan end) belum lengkap.", "Mesin belum ditetapkan.",
		"Mold belum ditetapkan.", "Shift belum ditetapkan.", "Operator belum ditugaskan.",
	} {
		if !contains(d.Reasons, want) {
			t.Errorf("missing %q in %v", want, d.Reasons)
		}
	}
	full := TransitionContext{
		PlannedQuantity: db.Ptr(100), PlannedStart: db.Ptr("2026-09-01T00:00:00.000Z"), PlannedEnd: db.Ptr("2026-09-01T08:00:00.000Z"),
		MachineID: db.Ptr("mc-1"), MoldID: db.Ptr("mold-1"), ShiftID: db.Ptr("shift-1"), MoldRequired: true,
	}
	d = Evaluate(StatusScheduled, StatusConfirmed, full)
	if !d.Allowed || d.Effects.SetConfirmed == nil || !*d.Effects.SetConfirmed {
		t.Errorf("full checklist refused: %+v", d)
	}
	// §11/§15: mold is on the checklist only where the product declares one.
	noMold := full
	noMold.MoldID, noMold.MoldRequired = nil, false
	if d := Evaluate(StatusScheduled, StatusConfirmed, noMold); !d.Allowed {
		t.Errorf("mold demanded for a product without one: %v", d.Reasons)
	}
	conflict := full
	conflict.OpenScheduleConflicts = []string{"mc-1 sudah dijadwalkan 08:00-10:00"}
	if d := Evaluate(StatusScheduled, StatusConfirmed, conflict); d.Allowed || !contains(d.Reasons, "Konflik terbuka harus diselesaikan: mc-1 sudah dijadwalkan 08:00-10:00.") {
		t.Errorf("open conflict must block confirmation: %+v", d)
	}
}

func TestSoftPredecessorGuardAcceptsARunningPredecessor(t *testing.T) {
	running := TransitionContext{Predecessor: &PredecessorState{WorkOrderID: "WO-1", Status: StatusInProduction, AvailableQuantity: 50}}
	if d := Evaluate(StatusConfirmed, StatusInProduction, running); !d.Allowed || d.Effects.MachineState != MachineRunning || !d.Effects.SetActualStart {
		t.Errorf("running predecessor refused: %+v", d)
	}
	idle := TransitionContext{Predecessor: &PredecessorState{WorkOrderID: "WO-1", Status: StatusConfirmed, AvailableQuantity: 0}}
	d := Evaluate(StatusConfirmed, StatusInProduction, idle)
	if d.Allowed {
		t.Fatal("unstarted predecessor accepted")
	}
	if !contains(d.Reasons, "Process sebelumnya (WO-1) belum berjalan, saat ini CONFIRMED.") ||
		!contains(d.Reasons, "Belum ada quantity yang diserahkan process sebelumnya (available 0).") {
		t.Errorf("reasons: %v", d.Reasons)
	}
}

func TestStrictModeDemandsACompletedPredecessor(t *testing.T) {
	strict := TransitionContext{StrictProcessSequence: true, Predecessor: &PredecessorState{WorkOrderID: "WO-1", Status: StatusInProduction, AvailableQuantity: 500}}
	d := Evaluate(StatusConfirmed, StatusInProduction, strict)
	if d.Allowed || d.Reasons[0] != "Mode strict: process sebelumnya (WO-1) harus COMPLETED, saat ini IN_PRODUCTION." {
		t.Errorf("strict: %+v", d)
	}
	strict.Predecessor.Status = StatusCompleted
	if d := Evaluate(StatusConfirmed, StatusInProduction, strict); !d.Allowed {
		t.Errorf("completed predecessor refused in strict mode: %v", d.Reasons)
	}
}

func TestCompletedIsRefusedWhileADowntimeIsActive(t *testing.T) {
	d := Evaluate(StatusInProduction, StatusCompleted, TransitionContext{ActiveDowntimeCount: 2})
	if d.Allowed || d.Reasons[0] != "Masih ada 2 downtime record berstatus ACTIVE; selesaikan downtime sebelum menutup Work Order." {
		t.Errorf("%+v", d)
	}
	d = Evaluate(StatusInProduction, StatusCompleted, TransitionContext{})
	if !d.Allowed || !d.Effects.SetActualEnd || d.Effects.MachineState != MachineIdle || !d.Effects.AggregateOnCompletion {
		t.Errorf("COMPLETED effects: %+v", d)
	}
}

func TestValidateTransitionCarriesTheGuardFailures(t *testing.T) {
	_, err := ValidateTransition(StatusScheduled, StatusConfirmed, TransitionContext{})
	var terr *TransitionError
	if !errors.As(err, &terr) {
		t.Fatalf("expected TransitionError, got %v", err)
	}
	if terr.From != StatusScheduled || terr.To != StatusConfirmed || len(terr.Reasons) < 4 {
		t.Errorf("%+v", terr)
	}
	if !strings.HasPrefix(terr.Error(), "Work Order tidak dapat berpindah dari SCHEDULED ke CONFIRMED: Planned quantity belum ditetapkan.") {
		t.Errorf("message: %s", terr.Error())
	}
	_, err = ValidateTransition(StatusCompleted, StatusInProduction, TransitionContext{})
	if err == nil || !strings.Contains(err.Error(), "Dari COMPLETED hanya diizinkan: (tidak ada).") {
		t.Errorf("illegal edge message: %v", err)
	}
	if _, err := ValidateTransition(StatusConfirmed, StatusConfirmed, TransitionContext{}); err == nil || !strings.Contains(err.Error(), "Work Order sudah berstatus CONFIRMED.") {
		t.Errorf("same status: %v", err)
	}
	// Backward moves are unguarded and drop the confirmation.
	d := Evaluate(StatusConfirmed, StatusScheduled, TransitionContext{})
	if !d.Allowed || d.Effects.SetConfirmed == nil || *d.Effects.SetConfirmed {
		t.Errorf("CONFIRMED → SCHEDULED: %+v", d)
	}
}

func TestBatchLifecycle(t *testing.T) {
	if strings.Join(BatchAllowedTargets(BatchPlanned), ",") != "IN_PRODUCTION,CANCELLED" ||
		strings.Join(BatchAllowedTargets(BatchInProduction), ",") != "COMPLETED,CANCELLED" ||
		len(BatchAllowedTargets(BatchCompleted)) != 0 || len(BatchAllowedTargets(BatchCancelled)) != 0 {
		t.Fatal("batch lifecycle is not PLANNED → IN_PRODUCTION → COMPLETED")
	}
	for _, retired := range RetiredBatchStatuses {
		if BatchCanTransition(BatchPlanned, retired) {
			t.Errorf("%s must not exist", retired)
		}
	}
	d := EvaluateBatch(BatchPlanned, BatchInProduction, BatchContext{WorkOrderStatus: db.Ptr(StatusConfirmed)})
	if d.Allowed || d.Reasons[0] != "Work Order induk harus berstatus IN_PRODUCTION sebelum batch dimulai, saat ini CONFIRMED." {
		t.Errorf("batch started before its work order: %+v", d)
	}
	d = EvaluateBatch(BatchPlanned, BatchInProduction, BatchContext{WorkOrderStatus: db.Ptr(StatusInProduction), PlannedQuantity: db.Ptr(10)})
	if !d.Allowed || !d.Effects.SetActualStart {
		t.Errorf("%+v", d)
	}
	d = EvaluateBatch(BatchInProduction, BatchCancelled, BatchContext{})
	if d.Allowed || d.Reasons[0] != "Alasan pembatalan (status_reason) wajib diisi." {
		t.Errorf("%+v", d)
	}
	d = EvaluateBatch(BatchInProduction, BatchCancelled, BatchContext{Reason: db.Ptr("material rusak")})
	if !d.Allowed || !d.Effects.ReleaseRemainingPlanned || d.Effects.AggregateToWorkOrder {
		t.Errorf("cancelling a batch must spare the work order: %+v", d)
	}
	d = EvaluateBatch(BatchInProduction, BatchCompleted, BatchContext{ActiveDowntimeCount: 1})
	if d.Allowed || d.Reasons[0] != "Masih ada 1 downtime record berstatus ACTIVE pada batch ini; selesaikan downtime sebelum menutup batch." {
		t.Errorf("%+v", d)
	}
	// Legacy ACTIVE reads as IN_PRODUCTION.
	if NormalizeBatchStatus("ACTIVE") != BatchInProduction || NormalizeBatchStatus("SCRAPPED") != BatchCancelled {
		t.Error("legacy aliases")
	}
	if d := EvaluateBatch("ACTIVE", BatchCompleted, BatchContext{}); !d.Allowed {
		t.Errorf("ACTIVE → COMPLETED: %v", d.Reasons)
	}
	_, err := ValidateBatchTransition(BatchCompleted, BatchInProduction, BatchContext{})
	if err == nil || !strings.HasPrefix(err.Error(), "Batch tidak dapat berpindah dari COMPLETED ke IN_PRODUCTION: Transisi COMPLETED → IN_PRODUCTION tidak ada pada lifecycle batch.") {
		t.Errorf("%v", err)
	}
}

func TestQuantityFlowInvariants(t *testing.T) {
	balanced := Flow{PlannedQuantity: db.Ptr(100), InputQuantity: 100, OutputQuantity: 90, RejectQuantity: 6, ScrapQuantity: 3, ReworkQuantity: 1, TransferredQuantity: 90}
	if v := CheckFlow(balanced, true); len(v) != 0 {
		t.Errorf("balanced flow refused: %+v", v)
	}
	if WorkInProgress(balanced) != 0 {
		t.Error("WIP must be zero")
	}

	short := Flow{InputQuantity: 100, OutputQuantity: 90, RejectQuantity: 15}
	v := CheckFlow(short, false)
	if len(v) != 1 || v[0].Invariant != InputCoversDisposition ||
		v[0].Message != "Input 100 lebih kecil dari output 90 + reject 15 + scrap 0 + rework 0 = 105; selisih 5. Output tidak pernah mencakup reject — keempat bucket saling eksklusif." {
		t.Errorf("%+v", v)
	}

	over := Flow{InputQuantity: 100, OutputQuantity: 80, TransferredQuantity: 90}
	v = CheckFlow(over, false)
	if len(v) != 1 || v[0].Invariant != TransferredWithinOutput ||
		v[0].Message != "Transferred 90 melebihi output 80; selisih 10. Hanya quantity yang lolos kualitas dapat diserahkan ke process berikutnya." {
		t.Errorf("%+v", v)
	}

	wip := Flow{InputQuantity: 100, OutputQuantity: 80, RejectQuantity: 10}
	v = CheckFlow(wip, true)
	if len(v) != 1 || v[0].Invariant != WipZeroOnCompletion || !strings.HasPrefix(v[0].Message, "WIP harus nol saat COMPLETED, saat ini 10 (input 100 − output 80 − reject 10 − scrap 0 − rework 0).") {
		t.Errorf("%+v", v)
	}

	negative := Flow{InputQuantity: -1, OutputQuantity: 0}
	v = CheckFlow(negative, false)
	if len(v) == 0 || v[0].Invariant != NonNegative || v[0].Message != "Quantity input tidak boleh negatif (-1)." {
		t.Errorf("%+v", v)
	}

	// The invariants are identical for Work Order and Batch; only the label
	// on the message changes.
	errWO := AssertFlow("WORK_ORDER", "WO-1", short, false)
	errBatch := AssertFlow("BATCH", "B-1", short, false)
	if !strings.HasPrefix(errWO.Error(), "Quantity flow Work Order WO-1 tidak valid. ") || !strings.HasPrefix(errBatch.Error(), "Quantity flow Batch B-1 tidak valid. ") {
		t.Errorf("%v / %v", errWO, errBatch)
	}

	// A delta is judged before it is applied.
	next, err := AssertDelta("WORK_ORDER", "WO-1", Flow{InputQuantity: 50, OutputQuantity: 40, RejectQuantity: 5}, FlowDelta{InputQuantity: 10, OutputQuantity: 8, RejectQuantity: 2}, false)
	if err != nil || next.InputQuantity != 60 || next.OutputQuantity != 48 || next.RejectQuantity != 7 {
		t.Errorf("%+v %v", next, err)
	}
	if _, err := AssertDelta("WORK_ORDER", "WO-1", Flow{InputQuantity: 50, OutputQuantity: 50}, FlowDelta{OutputQuantity: 1}, false); err == nil {
		t.Error("delta beyond input accepted")
	}

	// §9 Q6: batch total may be less than the WO, split must be exact.
	if err := AssertBatchPlannedWithinWorkOrder("WO-1", 100, 80); err != nil {
		t.Error("batch under the work order refused")
	}
	if err := AssertBatchPlannedWithinWorkOrder("WO-1", 100, 120); err == nil || !strings.Contains(err.Error(), "melebihi planned quantity Work Order 100; kelebihan 20.") {
		t.Errorf("%v", err)
	}
	if err := AssertSplitPlannedExact("WO-1", 100, 90); err == nil || !strings.Contains(err.Error(), "Total planned quantity child 90 tidak sama dengan planned quantity parent 100; selisih -10.") {
		t.Errorf("%v", err)
	}

	// Yield is derived, and undefined when nothing entered.
	if YieldRatio(Flow{}) != nil {
		t.Error("yield with no input")
	}
	if y := YieldRatio(Flow{InputQuantity: 200, OutputQuantity: 150}); y == nil || *y != 0.75 {
		t.Errorf("yield %v", y)
	}
	// §10: available quantity to the successor is transferred minus own input.
	if AvailableQuantity(9600, 9000) != 600 || AvailableQuantity(100, 150) != 0 {
		t.Error("available quantity")
	}
}

func TestWorkedExampleFourProcessesYield9600(t *testing.T) {
	// §10: 10.000 planned → 9.800 → 9.700 → 9.650 → 9.600 finished, never 38.750.
	steps := []struct{ input, output int }{{10000, 9800}, {9800, 9700}, {9700, 9650}, {9650, 9600}}
	finished := 0
	for _, s := range steps {
		flow := Flow{InputQuantity: s.input, OutputQuantity: s.output, RejectQuantity: s.input - s.output, TransferredQuantity: s.output}
		if v := CheckFlow(flow, true); len(v) != 0 {
			t.Fatalf("step %+v: %+v", s, v)
		}
		finished = s.output
	}
	if finished != 9600 {
		t.Fatalf("finished %d", finished)
	}
}

func TestSplitRules(t *testing.T) {
	parent := WorkOrder{ID: "wo-1", WoNumber: "WO-1", Status: StatusConfirmed, PlannedQuantity: 100}
	two := []SplitPart{{PlannedQuantity: 60}, {PlannedQuantity: 40}}
	if err := AssertSplittable(parent, two); err != nil {
		t.Fatalf("valid split refused: %v", err)
	}
	expectStatus := func(err error, status int, contains string) {
		t.Helper()
		var apiErr *httpx.Error
		if !errors.As(err, &apiErr) || apiErr.Status != status || !strings.Contains(apiErr.Message, contains) {
			t.Errorf("want %d %q, got %v", status, contains, err)
		}
	}
	split := parent
	split.HasChildWorkOrder = true
	expectStatus(AssertSplittable(split, two), 409, "sudah pernah di-split")
	done := parent
	done.Status = StatusCompleted
	expectStatus(AssertSplittable(done, two), 409, "Status yang bisa: SCHEDULED, CONFIRMED, IN_PRODUCTION.")
	expectStatus(AssertSplittable(parent, two[:1]), 422, "minimal 2 child")
	expectStatus(AssertSplittable(parent, []SplitPart{{PlannedQuantity: 100}, {PlannedQuantity: 0}}), 422, "Bagian ke-2: planned quantity harus lebih besar dari nol.")
	recorded := parent
	recorded.InputQuantity, recorded.OutputQuantity = 10, 8
	expectStatus(AssertSplittable(recorded, two), 409, "sudah mencatat produksi (output 8, reject 0, input 10)")
	err := AssertSplittable(parent, []SplitPart{{PlannedQuantity: 60}, {PlannedQuantity: 50}})
	var apiErr *httpx.Error
	if !errors.As(err, &apiErr) || apiErr.Status != 422 || len(apiErr.Fields) != 1 || apiErr.Fields[0].Field != "parts" || apiErr.Fields[0].Code != "INPUT_COVERS_DISPOSITION" {
		t.Errorf("inexact split: %v", err)
	}
	if suffixFor(0) != "A" || suffixFor(25) != "Z" || suffixFor(26) != "AA" || suffixFor(27) != "AB" {
		t.Error("child suffixes")
	}
}

func TestRoutingValidation(t *testing.T) {
	step := func(seq int, code string, active bool) RoutingStep {
		return RoutingStep{RoutingID: "r-" + code, ProcessID: "p-" + code, ProcessCode: code, ProcessName: code, ProcessStatus: "ACTIVE", Sequence: seq, MachineID: db.Ptr("mc-" + code), Active: active}
	}
	if p := ValidateRouting("prod-1", []RoutingStep{step(1, "MIX", true), step(2, "EXT", true), step(3, "CUR", true)}); len(p) != 0 {
		t.Errorf("valid routing: %+v", p)
	}
	p := ValidateRouting("prod-1", []RoutingStep{step(1, "MIX", true), step(2, "EXT", true), step(4, "CUR", true)})
	if len(p) != 1 || p[0].Code != "SEQUENCE_NOT_CONTINUOUS" || p[0].Message != "Sequence melompat dari 2 (EXT) ke 4 (CUR); tidak ada process di antaranya." {
		t.Errorf("gap: %+v", p)
	}
	inactive := step(2, "EXT", true)
	inactive.ProcessStatus = "INACTIVE"
	p = ValidateRouting("prod-1", []RoutingStep{step(1, "MIX", true), inactive})
	if len(p) != 1 || p[0].Code != "PROCESS_INACTIVE" || !strings.HasPrefix(p[0].Message, "Process EXT (EXT) berstatus INACTIVE.") {
		t.Errorf("inactive: %+v", p)
	}
	bare := step(2, "EXT", true)
	bare.MachineID, bare.WorkCenterID = nil, nil
	p = ValidateRouting("prod-1", []RoutingStep{step(1, "MIX", true), bare})
	if len(p) != 1 || p[0].Code != "NO_MAPPABLE_RESOURCE" {
		t.Errorf("no resource: %+v", p)
	}
	p = ValidateRouting("prod-1", []RoutingStep{step(2, "EXT", true), step(3, "CUR", true)})
	if len(p) != 1 || p[0].Message != "Routing dimulai dari sequence 2, bukan 1. Process pertama harus bersequence 1." {
		t.Errorf("starts at 2: %+v", p)
	}
	p = ValidateRouting("prod-1", nil)
	if len(p) != 1 || p[0].Code != "NO_ROUTING" || !strings.HasPrefix(p[0].Message, "Product prod-1 belum memiliki process routing.") {
		t.Errorf("no routing: %+v", p)
	}
	p = ValidateRouting("prod-1", []RoutingStep{step(1, "MIX", true), step(2, "EXT", false), step(3, "CUR", true)})
	codes := []string{}
	for _, x := range p {
		codes = append(codes, x.Code)
	}
	if strings.Join(codes, ",") != "ROUTING_STEP_INACTIVE,SEQUENCE_NOT_CONTINUOUS" {
		t.Errorf("inactive step in the middle: %v", codes)
	}
	err := AssertRoutingValid("prod-1", nil)
	var rerr *RoutingError
	if !errors.As(err, &rerr) || !strings.HasPrefix(err.Error(), "Routing product prod-1 tidak valid: ") {
		t.Errorf("%v", err)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
