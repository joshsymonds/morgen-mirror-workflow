import { DateTime } from "luxon";

// Shape of the `originalStartTime` field on Morgen JSCalendar events.
// Set only on recurring-series instances and recurrence exceptions;
// absent on non-recurring events.
export interface OriginalStartTime {
  date?: string | undefined;
  dateTime?: string | undefined;
  timeZone?: string | undefined;
}

// Minimal projection of a Morgen event for dedupTs computation.
// Other modules narrow on richer types; this one only needs the
// optional originalStartTime (a client-side bundle field) and
// recurrenceId (the API-surface field for the same information).
export interface EventLike {
  originalStartTime?: OriginalStartTime | undefined;
  recurrenceId?: string | undefined;
  timeZone?: string | undefined;
}

// Mirrors EventObservable.getDeduplicationTs() in the bundled
// renderer (see app.asar dist/app.js around the EventObservable class
// definition). Returns the unix-second value that feeds into the
// natural iCalUIDHash fallback path.
//
// Two source fields, checked in order:
// 1. `originalStartTime` — set on EventObservable instances inside
//    the Morgen client app. Tests use this shape because it matches
//    the bundle's internal model exactly.
// 2. `recurrenceId` — the API-surface field that listEvents returns
//    on recurring-series instances. The bundle's `originalStartTime`
//    is built from this at sync time, so deriving from it ourselves
//    reproduces the bundle's dedupTs for production events read via
//    `listEvents`. Without this fallback, every recurring instance
//    collapses to dedupTs=0 and all instances share a single
//    groupId — causing perpetual mirror oscillation.
//
// Deviations from the bundle: if `originalStartTime` is present but
// neither `date` nor `dateTime` is set, bundle yields NaN; we return
// 0 (same handling applies to a missing `recurrenceId`).
export function getDedupTs(event: EventLike): number {
  const { originalStartTime } = event;
  if (originalStartTime) {
    const { date, dateTime, timeZone } = originalStartTime;
    const isoInput = date ?? dateTime;
    if (isoInput) {
      return DateTime.fromISO(isoInput, { zone: timeZone ?? "Etc/UTC" }).toUnixInteger();
    }
  }

  if (event.recurrenceId) {
    return DateTime.fromISO(event.recurrenceId, {
      zone: event.timeZone ?? "Etc/UTC",
    }).toUnixInteger();
  }

  return 0;
}
