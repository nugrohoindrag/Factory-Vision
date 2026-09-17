package shopfloor

import (
	"testing"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// The golden rows are what the Node generator wrote for the pilot seed
// (read back from its database), so a drift in the PRNG port, the rounding
// or the day walk shows up as a changed figure, not as a changed chart.
func TestGenerateHistoryMatchesNodeRows(t *testing.T) {
	in := HistoryInput{
		TenantID: "tenant-pilot-factory-01", AnchorDate: "2026-08-28", Days: 60, ShiftID: "shift-1", PlannedProductionMinutes: 480,
		Lines: []HistoryLine{
			{LineID: "line-01", ProcessID: db.Ptr("proc-mixing"), BatchID: db.Ptr("batch-260829-01"), IsBatchManaged: true, MachineID: "mc-mix-01", WorkOrderID: "wo-101", OperatorID: "op-001", Profile: "GOOD", DailyTarget: 2000, IdealCycleSeconds: 90},
			{LineID: "line-01", ProcessID: db.Ptr("proc-inspection"), MachineID: "mc-ins-01", WorkOrderID: "wo-104", OperatorID: "op-001", Profile: "GOOD", DailyTarget: 2000, IdealCycleSeconds: 30},
			{LineID: "line-02", ProcessID: db.Ptr("proc-mixing"), BatchID: db.Ptr("batch-260829-02"), IsBatchManaged: true, MachineID: "mc-mix-02", WorkOrderID: "wo-201", OperatorID: "op-001", Profile: "AVERAGE", DailyTarget: 1500, IdealCycleSeconds: 100},
		},
		DowntimeReasonIDs: []string{"dt-breakdown", "dt-material", "dt-setup", "dt-cleaning", "dt-qc-wait", "dt-operator"},
		RejectReasonIDs:   []string{"rej-dimension", "rej-blister", "rej-scratch", "rej-flash", "rej-distortion", "rej-other"},
	}
	production, downtime := GenerateHistory(in)

	// 60 days back from the anchor hold eight Sundays.
	if len(production) != 52*3 {
		t.Fatalf("expected 156 production rows, got %d", len(production))
	}
	byID := map[string]ProductionRecord{}
	for _, p := range production {
		byID[p.ID] = p
	}
	golden := []struct {
		id           string
		good, reject int
		reason       string
	}{
		{"pr-hist-2026-06-29-line-01-proc-inspection", 790, 10, "rej-dimension"},
		{"pr-hist-2026-06-29-line-02-proc-mixing", 220, 3, "rej-dimension"},
		{"pr-hist-2026-07-01-line-01-proc-inspection", 849, 10, "rej-dimension"},
		{"pr-hist-2026-07-01-line-02-proc-mixing", 242, 3, "rej-dimension"},
		{"pr-hist-2026-08-27-line-01-proc-inspection", 811, 7, "rej-dimension"},
		{"pr-hist-2026-08-27-line-02-proc-mixing", 214, 3, "rej-other"},
	}
	for _, g := range golden {
		p, ok := byID[g.id]
		if !ok {
			t.Fatalf("%s missing", g.id)
		}
		if p.GoodQuantity != g.good || p.RejectQuantity != g.reject || db.Deref(p.RejectReasonID, "") != g.reason || p.InputQuantity != g.good+g.reject {
			t.Errorf("%s: got %d/%d %s input %d, want %d/%d %s", g.id, p.GoodQuantity, p.RejectQuantity, db.Deref(p.RejectReasonID, ""), p.InputQuantity, g.good, g.reject, g.reason)
		}
		if p.RecordedAt != p.ShiftDate+"T15:00:00.000Z" || p.Source != "OPERATOR_MANUAL" || p.ClientEventID != "evt-"+g.id {
			t.Errorf("%s: recordedAt %s source %s clientEventId %s", g.id, p.RecordedAt, p.Source, p.ClientEventID)
		}
	}
	if p := byID["pr-hist-2026-06-29-line-02-proc-mixing"]; !p.IsBatchManaged || db.Deref(p.BatchID, "") != "batch-260829-02" {
		t.Errorf("batch-managed line must carry its batch: %+v", p)
	}
	if _, sunday := byID["pr-hist-2026-07-05-line-01-proc-inspection"]; sunday {
		t.Error("Sunday must be a non-production day")
	}

	// The first downtime event of the first line on the first day.
	first := downtime[0]
	if first.ID != "dt-hist-2026-06-29-line-01-1" || first.ReasonID != "dt-cleaning" || !first.IsPlanned || *first.DurationSeconds != 1010 ||
		first.StartTime != "2026-06-29T11:27:05.000Z" || db.Deref(first.EndTime, "") != "2026-06-29T11:43:55.000Z" || first.Status != "RESOLVED" || db.Deref(first.WorkOrderID, "") != "wo-101" {
		t.Errorf("first downtime event: %+v", first)
	}
}

func TestMulberry32AndHashSeedAreTheJavaScriptOnes(t *testing.T) {
	// Reference values from the JavaScript functions run under Node.
	const seed = "2026-06-29:line-01:proc-mixing"
	if got := hashSeed(seed); got != 3494418857 {
		t.Fatalf("hashSeed(%q) = %d, want 3494418857", seed, got)
	}
	rand := mulberry32(hashSeed(seed))
	for i, want := range []float64{0.42005491675809026, 0.8322321670129895, 0.3922527036629617} {
		if got := rand(); got != want {
			t.Fatalf("draw %d = %v, want %v", i, got, want)
		}
	}
}
