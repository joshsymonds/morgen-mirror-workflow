import { describe, expect, it } from "vitest";

import { iCalUidHash } from "../../src/lib/hash";
import { buildMarker } from "../../src/lib/marker";
import type { CalendarRef, MorgenEvent } from "../../src/lib/mirror";
import { reconcileMirrors } from "../../src/lib/orchestrator";
import { FakeMorgenClient } from "../helpers/fake-morgen-client";

const personalCal: CalendarRef = { accountId: "acct-personal", calendarId: "cal-personal" };
const workCal: CalendarRef = { accountId: "acct-work", calendarId: "cal-work" };
const sharedCal: CalendarRef = { accountId: "acct-personal", calendarId: "cal-shared" };
const allCals = [personalCal, workCal, sharedCal];

const WINDOW = {
  windowStartISO: "2026-05-01T00:00:00",
  windowEndISO: "2026-12-31T00:00:00",
};

const sourceIn = (cal: CalendarRef, overrides: Partial<MorgenEvent> = {}): MorgenEvent => ({
  id: `src-id-${cal.calendarId}`,
  uid: `src-uid-${cal.calendarId}@google.com`,
  accountId: cal.accountId,
  calendarId: cal.calendarId,
  title: "Doctor's appointment",
  start: "2026-05-22T01:18:00",
  duration: "PT30M",
  timeZone: "Etc/UTC",
  showWithoutTime: false,
  freeBusyStatus: "busy",
  ...overrides,
});

const seededMirror = (
  cal: CalendarRef,
  groupId: string,
  overrides: Partial<MorgenEvent> = {},
): MorgenEvent => ({
  id: `mirror-id-${cal.calendarId}-${groupId}`,
  uid: `mirror-uid-${cal.calendarId}-${groupId}@google.com`,
  accountId: cal.accountId,
  calendarId: cal.calendarId,
  title: "[Busy]",
  description: buildMarker(groupId),
  start: "2026-05-22T01:18:00",
  duration: "PT30M",
  timeZone: "Etc/UTC",
  showWithoutTime: false,
  freeBusyStatus: "busy",
  privacy: "private",
  ...overrides,
});

describe("reconcileMirrors — creates", () => {
  it("creates a [Busy] mirror in every OTHER configured calendar for each source", async () => {
    const client = new FakeMorgenClient();
    const source = sourceIn(personalCal);
    client.seed(source);

    const summary = await reconcileMirrors(client, allCals, WINDOW);

    expect(summary.created).toBe(2); // mirrors in workCal + sharedCal
    expect(summary.updated).toBe(0);
    expect(summary.deleted).toBe(0);

    const expectedGroupId = iCalUidHash(source.uid, 0);
    const destCalIds = new Set(client.createCalls.map((c) => c.calendarId));
    expect(destCalIds).toEqual(new Set([workCal.calendarId, sharedCal.calendarId]));
    for (const call of client.createCalls) {
      expect(call.title).toBe("[Busy]");
      expect(call.description).toBe(buildMarker(expectedGroupId));
      expect(call.start).toBe(source.start);
    }
  });

  it("skips events whose freeBusyStatus is 'free'", async () => {
    const client = new FakeMorgenClient();
    client.seed(sourceIn(personalCal, { freeBusyStatus: "free" }));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.created).toBe(0);
  });

  it("skips events without a uid", async () => {
    const client = new FakeMorgenClient();
    // Force-empty uid through cast; FakeMorgenClient won't synthesize one for seeded data.
    client.seed({ ...sourceIn(personalCal), uid: "" });

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.created).toBe(0);
  });

  it("skips declined events", async () => {
    const client = new FakeMorgenClient();
    client.seed(
      sourceIn(personalCal, {
        participants: {
          me: { accountOwner: true, participationStatus: "declined" },
        },
      }),
    );

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.created).toBe(0);
  });
});

describe("reconcileMirrors — updates", () => {
  it("updates a mirror whose start/duration has drifted from its source", async () => {
    const client = new FakeMorgenClient();
    const source = sourceIn(personalCal, { start: "2026-05-22T03:00:00", duration: "PT45M" });
    const groupId = iCalUidHash(source.uid, 0);
    client.seed(source);
    // Seed a mirror with stale time
    client.seed(
      seededMirror(workCal, groupId, { start: "2026-05-22T01:18:00", duration: "PT30M" }),
    );
    client.seed(
      seededMirror(sharedCal, groupId, { start: source.start, duration: source.duration }),
    );

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.deleted).toBe(0);

    const updateCall = client.updateCalls[0]!;
    expect(updateCall.start).toBe("2026-05-22T03:00:00");
    expect(updateCall.duration).toBe("PT45M");
  });

  it("is a no-op when all mirrors already match their sources (idempotency)", async () => {
    const client = new FakeMorgenClient();
    const source = sourceIn(personalCal);
    const groupId = iCalUidHash(source.uid, 0);
    client.seed(source);
    client.seed(seededMirror(workCal, groupId));
    client.seed(seededMirror(sharedCal, groupId));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(client.updateCalls).toHaveLength(0);
    expect(client.createCalls).toHaveLength(0);
    expect(client.deleteCalls).toHaveLength(0);
  });
});

describe("reconcileMirrors — deletes orphans", () => {
  it("deletes mirrors whose source no longer exists", async () => {
    const client = new FakeMorgenClient();
    // No source seeded — but a stale mirror exists in workCal
    const orphanGroupId = "orphanedGroupId";
    client.seed(seededMirror(workCal, orphanGroupId));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.deleted).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(0);
    expect(client.deleteCalls).toHaveLength(1);
  });

  it("deletes orphans across multiple destination calendars", async () => {
    const client = new FakeMorgenClient();
    const orphanGroupId = "abandoned";
    client.seed(seededMirror(workCal, orphanGroupId));
    client.seed(seededMirror(sharedCal, orphanGroupId));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.deleted).toBe(2);
  });

  it("cleans up mirrors for declined sources (source still present but RSVP changed)", async () => {
    const client = new FakeMorgenClient();
    const source = sourceIn(personalCal, {
      participants: {
        me: { accountOwner: true, participationStatus: "declined" },
      },
    });
    const groupId = iCalUidHash(source.uid, 0);
    client.seed(source);
    client.seed(seededMirror(workCal, groupId));
    client.seed(seededMirror(sharedCal, groupId));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.deleted).toBe(2);
    expect(summary.created).toBe(0);
  });
});

describe("reconcileMirrors — loop prevention", () => {
  it("does NOT treat its own mirror events as sources for further propagation", async () => {
    const client = new FakeMorgenClient();
    // Only mirrors exist; no real sources. Orphan-detection should delete them, but
    // crucially nothing should be created (no cascading propagation).
    const groupId = "cascadeBlocker";
    client.seed(seededMirror(workCal, groupId));
    client.seed(seededMirror(sharedCal, groupId));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.created).toBe(0);
    expect(summary.deleted).toBe(2); // both are orphans (no source)
  });
});

describe("reconcileMirrors — guards", () => {
  it("is a no-op when fewer than 2 calendars are configured", async () => {
    const client = new FakeMorgenClient();
    client.seed(sourceIn(personalCal));

    const summary = await reconcileMirrors(client, [personalCal], WINDOW);
    expect(summary).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(client.listCalls).toHaveLength(0);
  });
});

describe("reconcileMirrors — propagation matrix", () => {
  it("propagates sources from every calendar to every other (true N-way)", async () => {
    const client = new FakeMorgenClient();
    // One source event in each of the three calendars
    client.seed(sourceIn(personalCal));
    client.seed(sourceIn(workCal, { start: "2026-06-01T10:00:00" }));
    client.seed(sourceIn(sharedCal, { start: "2026-06-02T14:00:00" }));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    // 3 sources × 2 destinations = 6 mirrors
    expect(summary.created).toBe(6);
  });
});

describe("reconcileMirrors — per-calendar roles", () => {
  // Roles let one calendar propagate OUT to others without receiving
  // their mirrors. Motivating case: the Justin-and-Josh shared calendar
  // — Josh's husband uses it to see joint plans and doesn't want every
  // standup from Josh's work calendars showing up as [Busy].

  it("source-only calendars propagate out but never receive mirrors", async () => {
    const client = new FakeMorgenClient();
    const sourceOnlyShared = { ...sharedCal, role: "source" as const };
    const cals = [
      { ...personalCal, role: "both" as const },
      { ...workCal, role: "both" as const },
      sourceOnlyShared,
    ];
    // A source on the shared cal should still propagate to the other two
    client.seed(sourceIn(sourceOnlyShared));

    const summary = await reconcileMirrors(client, cals, WINDOW);
    expect(summary.created).toBe(2); // mirrors in personalCal + workCal
    const destIds = new Set(client.createCalls.map((c) => c.calendarId));
    expect(destIds).toEqual(new Set([personalCal.calendarId, workCal.calendarId]));
  });

  it("source-only calendars never receive mirrors from other sources", async () => {
    const client = new FakeMorgenClient();
    const sourceOnlyShared = { ...sharedCal, role: "source" as const };
    const cals = [
      { ...personalCal, role: "both" as const },
      { ...workCal, role: "both" as const },
      sourceOnlyShared,
    ];
    // Sources elsewhere should NOT create a mirror in the source-only shared cal
    client.seed(sourceIn(personalCal));

    const summary = await reconcileMirrors(client, cals, WINDOW);
    expect(summary.created).toBe(1); // mirror in workCal only — shared is source-only
    expect(client.createCalls[0]!.calendarId).toBe(workCal.calendarId);
  });

  it("deletes pre-existing mirrors in a calendar that is now source-only", async () => {
    // Migration story: when you flip a calendar from `both` to `source`,
    // the next reconcile tick should sweep out its existing mirrors as
    // orphans (no longer "expected"). This is what cleans up the 521
    // [Busy] entries already in Justin-and-Josh.
    const client = new FakeMorgenClient();
    const sourceOnlyShared = { ...sharedCal, role: "source" as const };
    const cals = [
      { ...personalCal, role: "both" as const },
      { ...workCal, role: "both" as const },
      sourceOnlyShared,
    ];
    // Source elsewhere with a mirror that USED to live on the shared cal
    const source = sourceIn(personalCal);
    const groupId = iCalUidHash(source.uid, 0);
    client.seed(source);
    client.seed(seededMirror(sharedCal, groupId)); // legacy mirror, no longer expected
    client.seed(seededMirror(workCal, groupId)); // expected, should NOT be deleted

    const summary = await reconcileMirrors(client, cals, WINDOW);
    expect(summary.deleted).toBe(1);
    expect(client.deleteCalls[0]!.calendarId).toBe(sharedCal.calendarId);
    expect(summary.created).toBe(0); // workCal mirror already in place
  });

  it("treats absent role as 'both' for backward compatibility", async () => {
    // Existing call sites (and the orchestrator's older tests above)
    // pass plain CalendarRefs without a role; default semantics must
    // match the legacy N-way behavior.
    const client = new FakeMorgenClient();
    client.seed(sourceIn(personalCal));

    const summary = await reconcileMirrors(client, allCals, WINDOW);
    expect(summary.created).toBe(2); // unchanged from the original suite
  });

  it("destination-only calendars receive mirrors but their events are not sources", async () => {
    // Symmetric case: a calendar that only consumes (no propagation out).
    // Less commonly needed than source-only, but the role model supports
    // it cleanly. Sources on this calendar are ignored.
    const client = new FakeMorgenClient();
    const destOnly = { ...sharedCal, role: "destination" as const };
    const cals = [
      { ...personalCal, role: "both" as const },
      { ...workCal, role: "both" as const },
      destOnly,
    ];
    // Source on personalCal should still mirror INTO destOnly
    client.seed(sourceIn(personalCal));
    // Source on destOnly should be ignored — no mirror produced anywhere
    client.seed(sourceIn(destOnly, { start: "2026-06-15T10:00:00" }));

    const summary = await reconcileMirrors(client, cals, WINDOW);
    expect(summary.created).toBe(2); // only personalCal's source propagates → workCal + destOnly
  });
});
