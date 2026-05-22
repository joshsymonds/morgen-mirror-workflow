import { DateTime } from "luxon";

import { buildMarker, extractGroupId } from "./marker";

// A calendar identified by Morgen's (account, calendar) pair. The
// workflow's `trigger.accounts.calendar[]` is an array of these.
//
// `role` configures asymmetric propagation:
//   - "source": events here generate mirrors elsewhere, but mirrors are
//     never written INTO this calendar. Used when the calendar has
//     non-Josh viewers who shouldn't see [Busy] noise (the shared
//     Justin-and-Josh calendar is the originating motivation).
//   - "destination": this calendar receives mirrors but its own events
//     are never propagated outward. Less commonly needed; supplied for
//     symmetry.
//   - "both" (default when role is absent): legacy N-way behavior.
// Omitting the field is the back-compat alias for "both" so existing
// call sites and tests need no churn.
export type CalendarRole = "source" | "destination" | "both";
export interface CalendarRef {
  accountId: string;
  calendarId: string;
  role?: CalendarRole | undefined;
}

export function isSource(cal: CalendarRef): boolean {
  return cal.role !== "destination";
}

export function isDestination(cal: CalendarRef): boolean {
  return cal.role !== "source";
}

// What we need from a source event to construct a mirror payload.
// Wider event shapes can be projected to this type at call sites.
export interface SourceEvent {
  start: string;
  duration: string;
  timeZone: string;
  showWithoutTime: boolean;
}

// Participant entry on a Morgen event. We project only the fields
// the RSVP filter actually reads.
export interface MorgenParticipant {
  accountOwner?: boolean | undefined;
  calendarOwner?: boolean | undefined;
  roles?: { owner?: boolean | undefined; attendee?: boolean | undefined } | undefined;
  participationStatus?: string | undefined;
}

// JSCalendar-style original start time. Set on recurring instances
// and exceptions; undefined on non-recurring events.
export interface OriginalStartTime {
  date?: string | undefined;
  dateTime?: string | undefined;
  timeZone?: string | undefined;
}

// Subset of Morgen's event payload that we read / write. Optional
// fields use explicit `| undefined` for exactOptionalPropertyTypes
// ergonomics.
export interface MorgenEvent {
  id: string;
  uid: string;
  accountId: string;
  calendarId: string;
  title: string;
  description?: string | undefined;
  start: string;
  duration: string;
  timeZone: string;
  showWithoutTime: boolean;
  freeBusyStatus?: string | undefined;
  privacy?: string | undefined;
  participants?: Record<string, MorgenParticipant> | undefined;
  originalStartTime?: OriginalStartTime | undefined;
}

// Args mirror the morgen-cw-sdk shapes so the production adapter is
// a thin pass-through. Narrowing here keeps the unit tests free of
// SDK imports.
export interface ListEventsArgs {
  accountId: string;
  calendarIds: string;
  start: string;
  end: string;
}

// `field?: T | undefined` reads redundant but is load-bearing under
// exactOptionalPropertyTypes — Morgen API responses can carry the
// field absent or set to undefined; callers must be able to forward
// either shape into our args without a narrowing dance.
export interface CreateEventArgs {
  accountId: string;
  calendarId: string;
  title: string;
  description?: string | undefined;
  start: string;
  duration: string;
  timeZone: string;
  showWithoutTime: boolean;
  freeBusyStatus?: string | undefined;
  privacy?: string | undefined;
  // Setting false tells Morgen (and Google/M365 underneath) "this event
  // has zero alarms, do not inherit the destination calendar's default
  // reminder set." Without it, every mirror picks up that calendar's
  // default reminders (Google's 10/30-min defaults, etc.) and the user's
  // phone/watch fire N+1 notifications for one source meeting.
  // JSCalendar names the field useDefaultAlertsOnCreation; Morgen's
  // whitelist validator rejects the OnCreation suffix, so the short form
  // is the only spelling that survives the wire.
  useDefaultAlerts?: boolean | undefined;
}

export interface UpdateEventArgs {
  accountId: string;
  calendarId: string;
  id: string;
  start?: string | undefined;
  duration?: string | undefined;
  description?: string | undefined;
  // Same field, on the update path — used by the one-shot backfill that
  // strips default reminders from mirrors created before this flag
  // existed. Steady-state updates from the reconciler don't touch it
  // (mirrors created post-fix already carry useDefaultAlerts: false).
  useDefaultAlerts?: boolean | undefined;
}

export interface DeleteEventArgs {
  accountId: string;
  calendarId: string;
  id: string;
}

export interface MorgenClient {
  listEvents(args: ListEventsArgs): Promise<MorgenEvent[]>;
  createEvent(args: CreateEventArgs): Promise<MorgenEvent>;
  updateEvent(args: UpdateEventArgs): Promise<void>;
  deleteEvent(args: DeleteEventArgs): Promise<void>;
}

// Time window around a source's start when scanning for an existing
// mirror. 7 days catches cross-day reschedules (the common case:
// "moving Tuesday's meeting to next Wednesday") without making the
// listEvents query expensive. Reschedules >7 days will orphan the
// old mirror; that's an acceptable failure mode at this scale.
export const SEARCH_WINDOW_HOURS = 168;

function offsetIso(iso: string, hours: number): string {
  // iso is a local-naive ISO string ("YYYY-MM-DDTHH:mm:ss") with no
  // offset. Treat it as UTC for the window computation — we only
  // need approximate bounds, and Morgen's events/list happily
  // accepts a UTC-interpreted window for events declared in any zone.
  const shifted = DateTime.fromISO(iso, { zone: "Etc/UTC" }).plus({ hours });
  // luxon returns null on toISO() for invalid DateTime; can't happen
  // for the well-formed ISO strings Morgen emits.
  /* v8 ignore next */
  return shifted.toISO({ suppressMilliseconds: true, includeOffset: false }) ?? iso;
}

export async function createMirror(
  client: MorgenClient,
  dest: CalendarRef,
  source: SourceEvent,
  groupId: string,
): Promise<MorgenEvent> {
  return client.createEvent({
    accountId: dest.accountId,
    calendarId: dest.calendarId,
    title: "[Busy]",
    description: buildMarker(groupId),
    start: source.start,
    duration: source.duration,
    timeZone: source.timeZone,
    showWithoutTime: source.showWithoutTime,
    freeBusyStatus: "busy",
    privacy: "private",
    useDefaultAlerts: false,
  });
}

export async function findMirror(
  client: MorgenClient,
  dest: CalendarRef,
  groupId: string,
  aroundStart: string,
): Promise<MorgenEvent | null> {
  const events = await client.listEvents({
    accountId: dest.accountId,
    calendarIds: dest.calendarId,
    start: offsetIso(aroundStart, -SEARCH_WINDOW_HOURS),
    end: offsetIso(aroundStart, SEARCH_WINDOW_HOURS),
  });
  // listEvents already filters by calendarId via the calendarIds
  // query parameter, so re-checking event.calendarId here would be
  // redundant defense.
  return events.find((event) => extractGroupId(event.description) === groupId) ?? null;
}

export interface MirrorUpdate {
  start: string;
  // Optional so callers can leave the mirror's duration unchanged
  // when the source's duration is itself absent — the underlying
  // updateEvent call will omit the field rather than coerce a value.
  duration?: string | undefined;
}

export async function updateMirror(
  client: MorgenClient,
  dest: CalendarRef,
  mirror: MorgenEvent,
  patch: MirrorUpdate,
): Promise<void> {
  await client.updateEvent({
    accountId: dest.accountId,
    calendarId: dest.calendarId,
    id: mirror.id,
    start: patch.start,
    duration: patch.duration,
    description: mirror.description,
  });
}

export async function deleteMirror(
  client: MorgenClient,
  dest: CalendarRef,
  mirror: MorgenEvent,
): Promise<void> {
  await client.deleteEvent({
    accountId: dest.accountId,
    calendarId: dest.calendarId,
    id: mirror.id,
  });
}
