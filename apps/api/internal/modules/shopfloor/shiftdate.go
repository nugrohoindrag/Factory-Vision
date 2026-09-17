package shopfloor

import (
	"strconv"
	"strings"
	"time"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// shift_date resolution (US-021).
//
// The production date is the date the shift started, not the wall-clock
// date of the event: a record captured at 01:30 during the 22:00–06:00
// night shift belongs to the previous calendar day. The Node API used the
// process timezone (TZ); here the plant's location is passed explicitly.

// ShiftContext is the shift an instant falls in and its production date.
type ShiftContext struct {
	ShiftID   string
	ShiftDate string
}

// minutesOf is minutes since midnight for an HH:mm string.
func minutesOf(clock string) int {
	parts := strings.SplitN(clock, ":", 2)
	h, _ := strconv.Atoi(parts[0])
	m := 0
	if len(parts) > 1 {
		m, _ = strconv.Atoi(parts[1])
	}
	return h*60 + m
}

// ResolveShiftContext picks the shift an instant falls in and returns its
// shift_date. A preferred shift wins when the caller already knows it (an
// operator terminal pinned to one), but the date is still derived.
func ResolveShiftContext(shifts []masterdata.Shift, occurredAt string, preferredShiftID *string, loc *time.Location) ShiftContext {
	const fallbackShiftID = "shift-1"
	if loc == nil {
		loc = time.Local
	}
	preferred := ""
	if preferredShiftID != nil {
		preferred = *preferredShiftID
	}
	instant, err := db.ParseISO(occurredAt)
	if err != nil {
		id := preferred
		if id == "" {
			id = fallbackShiftID
		}
		date := occurredAt
		if len(date) > 10 {
			date = date[:10]
		}
		return ShiftContext{ShiftID: id, ShiftDate: date}
	}
	local := instant.In(loc)
	minuteOfDay := local.Hour()*60 + local.Minute()

	var containing *masterdata.Shift
	var chosen *masterdata.Shift
	for i := range shifts {
		s := &shifts[i]
		if !s.Active {
			continue
		}
		if preferred != "" && s.ID == preferred && chosen == nil {
			chosen = s
		}
		if containing == nil {
			start, end := minutesOf(s.StartTime), minutesOf(s.EndTime)
			var inside bool
			if s.CrossesMidnight || end <= start {
				inside = minuteOfDay >= start || minuteOfDay < end
			} else {
				inside = minuteOfDay >= start && minuteOfDay < end
			}
			if inside {
				containing = s
			}
		}
	}
	if chosen == nil {
		chosen = containing
	}
	if chosen == nil {
		id := preferred
		if id == "" {
			id = fallbackShiftID
		}
		return ShiftContext{ShiftID: id, ShiftDate: local.Format("2006-01-02")}
	}

	crosses := chosen.CrossesMidnight || minutesOf(chosen.EndTime) <= minutesOf(chosen.StartTime)
	beforeShiftStart := minuteOfDay < minutesOf(chosen.StartTime)
	date := local
	if crosses && beforeShiftStart {
		date = local.Add(-24 * time.Hour)
	}
	return ShiftContext{ShiftID: chosen.ID, ShiftDate: date.Format("2006-01-02")}
}
