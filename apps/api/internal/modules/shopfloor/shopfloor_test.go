package shopfloor

import (
	"errors"
	"testing"
	"time"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		panic(err)
	}
	return loc
}()

func demoShifts() []masterdata.Shift {
	return []masterdata.Shift{
		{ID: "shift-1", Name: "Pagi", StartTime: "06:00", EndTime: "14:00", Active: true},
		{ID: "shift-2", Name: "Siang", StartTime: "14:00", EndTime: "22:00", Active: true},
		{ID: "shift-3", Name: "Malam", StartTime: "22:00", EndTime: "06:00", CrossesMidnight: true, Active: true},
	}
}

// shift_date is the date the shift started, in the plant's zone (US-021).
func TestShiftDateFollowsTheShiftNotTheCalendar(t *testing.T) {
	cases := []struct {
		at        string // UTC instant
		wantShift string
		wantDate  string
	}{
		{"2026-09-16T18:30:00.000Z", "shift-3", "2026-09-16"}, // 01:30 WIB on the 17th: night shift began on the 16th
		{"2026-09-16T15:00:00.000Z", "shift-3", "2026-09-16"}, // 22:00 WIB, the shift's first minute
		{"2026-09-16T22:59:00.000Z", "shift-3", "2026-09-16"}, // 05:59 WIB, its last
		{"2026-09-16T23:00:00.000Z", "shift-1", "2026-09-17"}, // 06:00 WIB starts the morning shift
		{"2026-09-17T03:00:00.000Z", "shift-1", "2026-09-17"}, // 10:00 WIB
		{"2026-09-17T08:00:00.000Z", "shift-2", "2026-09-17"}, // 15:00 WIB
	}
	for _, c := range cases {
		got := ResolveShiftContext(demoShifts(), c.at, nil, jakarta)
		if got.ShiftID != c.wantShift || got.ShiftDate != c.wantDate {
			t.Errorf("%s: got %+v, want %s %s", c.at, got, c.wantShift, c.wantDate)
		}
	}
}

func TestPreferredShiftWinsButTheDateIsStillDerived(t *testing.T) {
	// A terminal pinned to the night shift posting at 01:30 WIB.
	got := ResolveShiftContext(demoShifts(), "2026-09-16T18:30:00.000Z", db.Ptr("shift-3"), jakarta)
	if got.ShiftID != "shift-3" || got.ShiftDate != "2026-09-16" {
		t.Errorf("%+v", got)
	}
	// A preferred shift that is not active falls back to the containing one.
	shifts := demoShifts()
	shifts[2].Active = false
	got = ResolveShiftContext(shifts, "2026-09-17T03:00:00.000Z", db.Ptr("shift-3"), jakarta)
	if got.ShiftID != "shift-1" || got.ShiftDate != "2026-09-17" {
		t.Errorf("%+v", got)
	}
	// No shift matches: the preferred (or default) id with the local date.
	got = ResolveShiftContext(nil, "2026-09-17T03:00:00.000Z", nil, jakarta)
	if got.ShiftID != "shift-1" || got.ShiftDate != "2026-09-17" {
		t.Errorf("%+v", got)
	}
	// An unparseable instant keeps its first ten characters as the date.
	got = ResolveShiftContext(demoShifts(), "not-a-date", db.Ptr("shift-2"), jakarta)
	if got.ShiftID != "shift-2" || got.ShiftDate != "not-a-date" {
		t.Errorf("%+v", got)
	}
}

// Ported from offline-sync-classification.test.ts: a validation failure
// is permanent, anything else may be transient.
func TestSyncClassification(t *testing.T) {
	flowErr := production.FlowValidation(production.AssertFlow("WORK_ORDER", "WO-1", production.Flow{InputQuantity: 10, OutputQuantity: 20}, false), "goodQuantity")
	code, message, retryable := Classify(flowErr)
	if code != "VALIDATION_ERROR" || retryable || message == "" {
		t.Errorf("quantity breach: %s %v %q", code, retryable, message)
	}
	var apiErr *httpx.Error
	if !errors.As(flowErr, &apiErr) || len(apiErr.Fields) != 1 || apiErr.Fields[0].Code != "INPUT_COVERS_DISPOSITION" {
		t.Errorf("violations must travel as field errors: %+v", apiErr)
	}

	code, _, retryable = Classify(httpx.NotFound("Work order tidak ditemukan."))
	if code != "NOT_FOUND" || retryable {
		t.Errorf("missing work order must be permanent: %s %v", code, retryable)
	}
	code, _, retryable = Classify(httpx.Forbidden(""))
	if code != "FORBIDDEN" || retryable {
		t.Error("forbidden must be permanent")
	}
	code, _, retryable = Classify(httpx.InvalidState("Mesin sedang downtime."))
	if code != "INVALID_STATE" || !retryable {
		t.Error("a state refusal may clear on retry")
	}
	code, message, retryable = Classify(errors.New("connection reset"))
	if code != "INTERNAL_ERROR" || !retryable || message != "connection reset" {
		t.Errorf("transient fault: %s %v %q", code, retryable, message)
	}
}
