import { getDedupTs } from "./dedup-ts";
import type { EventLike as DedupEventLike } from "./dedup-ts";
import { iCalUidHash } from "./hash";
import { isMirror } from "./marker";
import type { CalendarRef, MorgenClient, SourceEvent } from "./mirror";
import { createMirror, deleteMirror, findMirror, updateMirror } from "./mirror";
import { shouldPropagate } from "./rsvp";
import type { EventLike as RsvpEventLike } from "./rsvp";

// The event shape we receive in trigger.eventUpdates. Wider than what
// each helper needs — this is the projection of the Morgen API event
// that our orchestrator threads through.
export interface WorkflowEvent extends DedupEventLike, RsvpEventLike {
  uid?: string | undefined;
  accountId: string;
  calendarId: string;
  title?: string | undefined;
  description?: string | undefined;
  start: string;
  duration: string;
  timeZone: string;
  showWithoutTime: boolean;
  freeBusyStatus?: string | undefined;
}

export interface WorkflowTrigger {
  eventUpdates: {
    added: WorkflowEvent[];
    modified: WorkflowEvent[];
    removed: WorkflowEvent[];
  };
  // Optional to match the SDK's `accounts.calendar?` — the workflow
  // is a no-op when calendars aren't configured anyway.
  accounts: {
    calendar?: CalendarRef[];
  };
}

function projectSource(event: WorkflowEvent): SourceEvent {
  return {
    start: event.start,
    duration: event.duration,
    timeZone: event.timeZone,
    showWithoutTime: event.showWithoutTime,
  };
}

function destinationsFor(event: WorkflowEvent, cals: CalendarRef[]): CalendarRef[] {
  return cals.filter((c) => c.calendarId !== event.calendarId);
}

interface Precheck {
  withUid: WorkflowEvent & { uid: string };
  groupId: string;
  dests: CalendarRef[];
}

// Shared prelude for handleUpsert and handleRemoval. Returns null
// for events the workflow must ignore (mirrors, uid-less events).
// freeBusyStatus is NOT gated here — removal must clean up mirrors
// of an event regardless of its current busy state.
function precheck(event: WorkflowEvent, cals: CalendarRef[]): Precheck | null {
  if (isMirror(event)) return null;
  if (!event.uid) return null;
  const withUid = event as WorkflowEvent & { uid: string };
  return {
    withUid,
    groupId: iCalUidHash(withUid.uid, getDedupTs(event)),
    dests: destinationsFor(event, cals),
  };
}

async function deleteMirrorsAcross(
  client: MorgenClient,
  dests: CalendarRef[],
  groupId: string,
  aroundStart: string,
): Promise<void> {
  await Promise.all(
    dests.map(async (dest) => {
      const existing = await findMirror(client, dest, groupId, aroundStart);
      if (existing) await deleteMirror(client, dest, existing);
    }),
  );
}

async function upsertMirrorAt(
  client: MorgenClient,
  dest: CalendarRef,
  source: WorkflowEvent & { uid: string },
  groupId: string,
): Promise<void> {
  const existing = await findMirror(client, dest, groupId, source.start);
  if (!existing) {
    await createMirror(client, dest, projectSource(source), groupId);
    return;
  }
  if (existing.start !== source.start || existing.duration !== source.duration) {
    await updateMirror(client, dest, existing, {
      start: source.start,
      duration: source.duration,
    });
  }
}

async function handleUpsert(
  client: MorgenClient,
  cals: CalendarRef[],
  event: WorkflowEvent,
): Promise<void> {
  if (event.freeBusyStatus === "free") return;
  const pre = precheck(event, cals);
  if (!pre) return;

  if (!shouldPropagate(event)) {
    // User declined / tentative: clean up any prior mirrors.
    await deleteMirrorsAcross(client, pre.dests, pre.groupId, event.start);
    return;
  }

  await Promise.all(
    pre.dests.map((dest) => upsertMirrorAt(client, dest, pre.withUid, pre.groupId)),
  );
}

async function handleRemoval(
  client: MorgenClient,
  cals: CalendarRef[],
  event: WorkflowEvent,
): Promise<void> {
  const pre = precheck(event, cals);
  if (!pre) return;
  await deleteMirrorsAcross(client, pre.dests, pre.groupId, event.start);
}

export async function runOrchestrator(
  client: MorgenClient,
  trigger: WorkflowTrigger,
): Promise<void> {
  const cals = trigger.accounts.calendar ?? [];
  if (cals.length < 2) return;

  const { added, modified, removed } = trigger.eventUpdates;
  for (const event of [...added, ...modified]) {
    await handleUpsert(client, cals, event);
  }
  for (const event of removed) {
    await handleRemoval(client, cals, event);
  }
}
