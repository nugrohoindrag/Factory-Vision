import type { Shift } from '@factory-vision/domain-types';

/**
 * `shift_date` resolution (, US-021).
 *
 * The production date is the date the *shift started* not the wall-clock date
 * of the event. A record captured at 01:30 during the 22:00-06:00 night shift
 * belongs to the previous calendar day, and getting this wrong silently moves
 * a third of a factory's output onto the wrong day of every report.
 */

/** Minutes since midnight for an `HH:mm` string. */
function minutesOf(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

/** Local `YYYY-MM-DD` for an instant, offset by whole days. */
function dateKey(instant: Date, dayOffset = 0): string {
  const shifted = new Date(instant.getTime() + dayOffset * 86_400_000);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ShiftContext {
  shiftId: string;
  shiftDate: string;
}

/**
 * Picks the shift an instant falls in and returns its `shift_date`.
 *
 * `preferredShiftId` wins when the caller already knows the shift, an operator
 * terminal is pinned to one, but the date is still derived, so a night-shift
 * record cannot be filed under the wrong day just because the client sent a
 * naive timestamp.
 */
export function resolveShiftContext(
  shifts: Shift[],
  occurredAt: string,
  preferredShiftId?: string,
  fallbackShiftId = 'shift-1'
): ShiftContext {
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) {
    return { shiftId: preferredShiftId ?? fallbackShiftId, shiftDate: occurredAt.substring(0, 10) };
  }

  const minuteOfDay = instant.getHours() * 60 + instant.getMinutes();
  const active = shifts.filter((s) => s.active);

  const containing = active.find((shift) => {
    const start = minutesOf(shift.startTime);
    const end = minutesOf(shift.endTime);
    return shift.crossesMidnight || end <= start
      ? minuteOfDay >= start || minuteOfDay < end
      : minuteOfDay >= start && minuteOfDay < end;
  });

  const shift = active.find((s) => s.id === preferredShiftId) ?? containing;

  if (!shift) {
    return { shiftId: preferredShiftId ?? fallbackShiftId, shiftDate: dateKey(instant) };
  }

  // Past midnight but before the shift ends: the shift began yesterday.
  const crosses = shift.crossesMidnight || minutesOf(shift.endTime) <= minutesOf(shift.startTime);
  const beforeShiftStart = minuteOfDay < minutesOf(shift.startTime);
  const shiftDate = crosses && beforeShiftStart ? dateKey(instant, -1) : dateKey(instant);

  return { shiftId: shift.id, shiftDate };
}
