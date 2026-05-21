import { DateTime } from "luxon";

// Shape of the `originalStartTime` field on Morgen JSCalendar events.
// Set only on recurring-series instances and recurrence exceptions;
// absent on non-recurring events.
export interface OriginalStartTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

// Minimal projection of a Morgen event for dedupTs computation.
// Other modules narrow on richer types; this one only needs the
// optional originalStartTime.
export interface EventLike {
  originalStartTime?: OriginalStartTime;
}

// Mirrors EventObservable.getDeduplicationTs() in the bundled
// renderer (see app.asar dist/app.js around the EventObservable class
// definition). Returns the unix-second value that feeds into the
// natural iCalUIDHash fallback path.
//
// One intentional deviation from the bundle: if `originalStartTime`
// is present but neither `date` nor `dateTime` is set, the bundle
// would feed `undefined` to moment.tz() and yield NaN. We return 0
// instead, treating it as if the field weren't there. Morgen's API
// has never been observed emitting that shape in practice.
export function getDedupTs(event: EventLike): number {
  const { originalStartTime } = event;
  if (!originalStartTime) return 0;

  const { date, dateTime, timeZone } = originalStartTime;
  const isoInput = date ?? dateTime;
  if (!isoInput) return 0;

  return DateTime.fromISO(isoInput, { zone: timeZone ?? "Etc/UTC" }).toUnixInteger();
}
