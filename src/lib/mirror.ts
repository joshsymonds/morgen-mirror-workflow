import { DateTime } from "luxon";

import { buildMarker, extractGroupId } from "./marker";

// A calendar identified by Morgen's (account, calendar) pair. The
// workflow's `trigger.accounts.calendar[]` is an array of these.
export interface CalendarRef {
  accountId: string;
  calendarId: string;
}

// What we need from a source event to construct a mirror payload.
// Wider event shapes can be projected to this type at call sites.
export interface SourceEvent {
  start: string;
  duration: string;
  timeZone: string;
  showWithoutTime: boolean;
}

// Subset of Morgen's event payload that we actually read / write.
// The real event type has more fields (participants, alerts, …) but
// the mirror logic doesn't care about them. Optional fields use
// explicit `| undefined` for exactOptionalPropertyTypes ergonomics.
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
}

export interface UpdateEventArgs {
  accountId: string;
  calendarId: string;
  id: string;
  start?: string | undefined;
  duration?: string | undefined;
  description?: string | undefined;
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
// mirror. ±24 hours catches events that have been rescheduled
// within the day while keeping the listEvents query cheap.
const SEARCH_WINDOW_HOURS = 24;

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
  return (
    events.find(
      (event) =>
        event.calendarId === dest.calendarId && extractGroupId(event.description) === groupId,
    ) ?? null
  );
}

export interface MirrorUpdate {
  start: string;
  duration: string;
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
