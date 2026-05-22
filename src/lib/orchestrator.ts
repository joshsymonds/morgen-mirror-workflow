import { getDedupTs } from "./dedup-ts";
import { iCalUidHash } from "./hash";
import { extractGroupId, isMirror } from "./marker";
import type { CalendarRef, MorgenClient, MorgenEvent, SourceEvent } from "./mirror";
import { createMirror, deleteMirror, updateMirror } from "./mirror";
import { shouldPropagate } from "./rsvp";

// The function reconciles, every run, the set of mirror events that
// SHOULD exist across the configured calendars against what currently
// exists. Idempotent on stable state; the only writes happen when a
// mirror is missing, drifted (start/duration changed), or orphaned
// (the source has been deleted or no longer propagates).
//
// Why poll-and-reconcile instead of delta-driven (`eventUpdates`)?
// Morgen's `trigger.eventUpdates` populates only for Event-Change
// triggers bound to a specific calendar; manual and HTTP triggers
// always receive empty `eventUpdates`. With four source calendars
// and a single HTTP-cron trigger driving propagation, deltas are
// unavailable. Polling is also closer to how Morgen's own built-in
// Calendar Propagation works (daily run, no event-update plumbing).

export interface ReconcileOptions {
  // Time window for both source-side discovery and mirror-side
  // orphan detection. Lookback catches mirrors whose source was
  // deleted recently; lookahead catches new events scheduled forward.
  windowStartISO: string;
  windowEndISO: string;
}

interface ExpectedMirror {
  dest: CalendarRef;
  source: MorgenEvent;
  groupId: string;
}

interface ExistingMirror {
  cal: CalendarRef;
  mirror: MorgenEvent;
}

function mirrorKey(calendarId: string, groupId: string): string {
  return `${calendarId}:${groupId}`;
}

function projectSource(event: MorgenEvent): SourceEvent {
  return {
    start: event.start,
    duration: event.duration,
    timeZone: event.timeZone,
    showWithoutTime: event.showWithoutTime,
  };
}

async function listForCalendar(
  client: MorgenClient,
  cal: CalendarRef,
  windowStartISO: string,
  windowEndISO: string,
): Promise<MorgenEvent[]> {
  return client.listEvents({
    accountId: cal.accountId,
    calendarIds: cal.calendarId,
    start: windowStartISO,
    end: windowEndISO,
  });
}

function collectExpectedMirrors(
  sourceCal: CalendarRef,
  events: MorgenEvent[],
  cals: CalendarRef[],
): ExpectedMirror[] {
  const out: ExpectedMirror[] = [];
  for (const event of events) {
    if (isMirror(event)) continue;
    if (event.freeBusyStatus === "free") continue;
    if (!event.uid) continue;
    if (!shouldPropagate(event)) continue;
    const groupId = iCalUidHash(event.uid, getDedupTs(event));
    for (const dest of cals) {
      if (dest.calendarId !== sourceCal.calendarId) {
        out.push({ dest, source: event, groupId });
      }
    }
  }
  return out;
}

function collectExistingMirrors(cal: CalendarRef, events: MorgenEvent[]): ExistingMirror[] {
  const out: ExistingMirror[] = [];
  for (const event of events) {
    if (!isMirror(event)) continue;
    const groupId = extractGroupId(event.description);
    if (groupId === null) continue;
    out.push({ cal, mirror: event });
  }
  return out;
}

interface PerCalFetch {
  cal: CalendarRef;
  events: MorgenEvent[];
}

async function fetchAllCalendars(
  client: MorgenClient,
  cals: CalendarRef[],
  options: ReconcileOptions,
): Promise<PerCalFetch[]> {
  return Promise.all(
    cals.map(async (cal) => ({
      cal,
      events: await listForCalendar(client, cal, options.windowStartISO, options.windowEndISO),
    })),
  );
}

function buildExpectedMap(perCal: PerCalFetch[], cals: CalendarRef[]): Map<string, ExpectedMirror> {
  const expected = new Map<string, ExpectedMirror>();
  for (const { cal, events } of perCal) {
    for (const candidate of collectExpectedMirrors(cal, events, cals)) {
      expected.set(mirrorKey(candidate.dest.calendarId, candidate.groupId), candidate);
    }
  }
  return expected;
}

function buildExistingMap(perCal: PerCalFetch[]): Map<string, ExistingMirror> {
  const existing = new Map<string, ExistingMirror>();
  for (const { cal, events } of perCal) {
    for (const found of collectExistingMirrors(cal, events)) {
      const groupId = extractGroupId(found.mirror.description);
      if (groupId === null) continue;
      existing.set(mirrorKey(cal.calendarId, groupId), found);
    }
  }
  return existing;
}

interface ReconcilePlan {
  toCreate: ExpectedMirror[];
  toUpdate: { existing: ExistingMirror; expected: ExpectedMirror }[];
  toDelete: ExistingMirror[];
}

function planReconciliation(
  expected: Map<string, ExpectedMirror>,
  existing: Map<string, ExistingMirror>,
): ReconcilePlan {
  const toCreate: ExpectedMirror[] = [];
  const toUpdate: { existing: ExistingMirror; expected: ExpectedMirror }[] = [];
  const toDelete: ExistingMirror[] = [];

  for (const [key, exp] of expected) {
    const got = existing.get(key);
    if (!got) {
      toCreate.push(exp);
    } else if (
      got.mirror.start !== exp.source.start ||
      got.mirror.duration !== exp.source.duration
    ) {
      toUpdate.push({ existing: got, expected: exp });
    }
  }

  for (const [key, got] of existing) {
    if (!expected.has(key)) toDelete.push(got);
  }

  return { toCreate, toUpdate, toDelete };
}

async function applyPlan(client: MorgenClient, plan: ReconcilePlan): Promise<void> {
  await Promise.all([
    ...plan.toCreate.map(async (expected) => {
      await createMirror(client, expected.dest, projectSource(expected.source), expected.groupId);
    }),
    ...plan.toUpdate.map(({ existing, expected }) =>
      updateMirror(client, existing.cal, existing.mirror, {
        start: expected.source.start,
        duration: expected.source.duration,
      }),
    ),
    ...plan.toDelete.map((got) => deleteMirror(client, got.cal, got.mirror)),
  ]);
}

export interface ReconcileSummary {
  created: number;
  updated: number;
  deleted: number;
}

export async function reconcileMirrors(
  client: MorgenClient,
  cals: CalendarRef[],
  options: ReconcileOptions,
): Promise<ReconcileSummary> {
  if (cals.length < 2) return { created: 0, updated: 0, deleted: 0 };

  const perCal = await fetchAllCalendars(client, cals, options);
  const expected = buildExpectedMap(perCal, cals);
  const existing = buildExistingMap(perCal);
  const plan = planReconciliation(expected, existing);
  await applyPlan(client, plan);

  return {
    created: plan.toCreate.length,
    updated: plan.toUpdate.length,
    deleted: plan.toDelete.length,
  };
}
