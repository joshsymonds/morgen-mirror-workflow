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
