import { describe, expect, it } from "vitest";

import { iCalUidHash } from "../../src/lib/hash";
import { buildMarker } from "../../src/lib/marker";
import type { CalendarRef } from "../../src/lib/mirror";
import type { WorkflowEvent, WorkflowTrigger } from "../../src/lib/orchestrator";
import { runOrchestrator } from "../../src/lib/orchestrator";
import { FakeMorgenClient } from "../helpers/fake-morgen-client";

const personalCal: CalendarRef = { accountId: "acct-personal", calendarId: "cal-personal" };
const workCal: CalendarRef = { accountId: "acct-work", calendarId: "cal-work" };
const sharedCal: CalendarRef = { accountId: "acct-personal", calendarId: "cal-shared" };
const allCals = [personalCal, workCal, sharedCal];

const sourceEvent = (overrides: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  uid: "src-uid@google.com",
  accountId: personalCal.accountId,
  calendarId: personalCal.calendarId,
  title: "Doctor's appointment",
  start: "2026-05-22T01:18:00",
  duration: "PT5M",
  timeZone: "Etc/UTC",
  showWithoutTime: false,
  freeBusyStatus: "busy",
  ...overrides,
});

const trigger = (overrides: Partial<WorkflowTrigger> = {}): WorkflowTrigger => ({
  eventUpdates: { added: [], modified: [], removed: [] },
  accounts: { calendar: allCals },
  ...overrides,
});

describe("runOrchestrator — added events", () => {
  it("creates a [Busy] mirror in every OTHER configured calendar", async () => {
    const client = new FakeMorgenClient();
    const source = sourceEvent();
    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [source], modified: [], removed: [] } }),
    );

    expect(client.createCalls).toHaveLength(2); // dest cals: work + shared
    const destCalIds = new Set(client.createCalls.map((c) => c.calendarId));
    expect(destCalIds).toEqual(new Set([workCal.calendarId, sharedCal.calendarId]));
    for (const call of client.createCalls) {
      expect(call.title).toBe("[Busy]");
      expect(call.start).toBe(source.start);
      expect(call.description).toBe(buildMarker(iCalUidHash(source.uid!, 0)));
    }
  });

  it("skips events that are themselves mirrors (loop prevention)", async () => {
    const client = new FakeMorgenClient();
    const mirror = sourceEvent({
      title: "[Busy]",
      description: buildMarker("anyGroupId"),
    });
    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [mirror], modified: [], removed: [] } }),
    );
    expect(client.createCalls).toHaveLength(0);
  });

  it("skips events marked free", async () => {
    const client = new FakeMorgenClient();
    const freeEvent = sourceEvent({ freeBusyStatus: "free" });
    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [freeEvent], modified: [], removed: [] } }),
    );
    expect(client.createCalls).toHaveLength(0);
  });

  it("skips events without a uid", async () => {
    const client = new FakeMorgenClient();
    const noUid = sourceEvent({ uid: undefined });
    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [noUid], modified: [], removed: [] } }),
    );
    expect(client.createCalls).toHaveLength(0);
  });

  it("does not propagate declined events and cleans up any prior mirrors", async () => {
    const client = new FakeMorgenClient();
    const source = sourceEvent({
      participants: {
        me: { accountOwner: true, roles: { attendee: true }, participationStatus: "declined" },
      },
    });
    const groupId = iCalUidHash(source.uid!, 0);
    // Seed an existing mirror in work cal — should get cleaned up.
    client.seed({
      id: "stale-mirror",
      uid: "stale@fake",
      accountId: workCal.accountId,
      calendarId: workCal.calendarId,
      title: "[Busy]",
      description: buildMarker(groupId),
      start: source.start,
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    });

    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [source], modified: [], removed: [] } }),
    );

    expect(client.createCalls).toHaveLength(0);
    expect(client.deleteCalls).toHaveLength(1);
    expect(client.deleteCalls[0]!.id).toBe("stale-mirror");
  });
});

describe("runOrchestrator — modified events", () => {
  it("is idempotent when start/duration unchanged", async () => {
    const client = new FakeMorgenClient();
    const source = sourceEvent();
    const groupId = iCalUidHash(source.uid!, 0);
    // Seed existing mirrors at the same start/duration.
    for (const dest of [workCal, sharedCal]) {
      client.seed({
        id: `mirror-${dest.calendarId}`,
        uid: `uid-${dest.calendarId}@fake`,
        accountId: dest.accountId,
        calendarId: dest.calendarId,
        title: "[Busy]",
        description: buildMarker(groupId),
        start: source.start,
        duration: source.duration,
        timeZone: source.timeZone,
        showWithoutTime: false,
      });
    }

    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [], modified: [source], removed: [] } }),
    );

    expect(client.createCalls).toHaveLength(0);
    expect(client.updateCalls).toHaveLength(0);
  });

  it("updates mirrors when start changes within the search window", async () => {
    const client = new FakeMorgenClient();
    const oldStart = "2026-05-22T01:18:00";
    const newStart = "2026-05-22T03:00:00";
    const source = sourceEvent({ start: newStart, duration: "PT10M" });
    const groupId = iCalUidHash(source.uid!, 0);
    // Seed an existing mirror at the old time.
    client.seed({
      id: "mirror-1",
      uid: "uid-1@fake",
      accountId: workCal.accountId,
      calendarId: workCal.calendarId,
      title: "[Busy]",
      description: buildMarker(groupId),
      start: oldStart,
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    });

    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [], modified: [source], removed: [] } }),
    );

    expect(client.updateCalls).toHaveLength(1);
    expect(client.updateCalls[0]!.start).toBe(newStart);
    expect(client.updateCalls[0]!.duration).toBe("PT10M");
    // Other destinations don't have a mirror seeded — they'd be created.
    expect(client.createCalls).toHaveLength(1);
    expect(client.createCalls[0]!.calendarId).toBe(sharedCal.calendarId);
  });
});

describe("runOrchestrator — removed events", () => {
  it("deletes mirrors across all destination cals", async () => {
    const client = new FakeMorgenClient();
    const source = sourceEvent();
    const groupId = iCalUidHash(source.uid!, 0);
    for (const dest of [workCal, sharedCal]) {
      client.seed({
        id: `mirror-${dest.calendarId}`,
        uid: `uid-${dest.calendarId}@fake`,
        accountId: dest.accountId,
        calendarId: dest.calendarId,
        title: "[Busy]",
        description: buildMarker(groupId),
        start: source.start,
        duration: source.duration,
        timeZone: "Etc/UTC",
        showWithoutTime: false,
      });
    }

    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [], modified: [], removed: [source] } }),
    );

    expect(client.deleteCalls).toHaveLength(2);
    const deletedIds = new Set(client.deleteCalls.map((c) => c.id));
    expect(deletedIds).toEqual(
      new Set([`mirror-${workCal.calendarId}`, `mirror-${sharedCal.calendarId}`]),
    );
  });

  it("ignores removed events that were mirrors themselves", async () => {
    const client = new FakeMorgenClient();
    const removedMirror = sourceEvent({
      title: "[Busy]",
      description: buildMarker("g1"),
    });
    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [], modified: [], removed: [removedMirror] } }),
    );
    expect(client.deleteCalls).toHaveLength(0);
  });

  it("ignores removed events without a uid (no hash possible)", async () => {
    const client = new FakeMorgenClient();
    const removed = sourceEvent({ uid: undefined });
    await runOrchestrator(
      client,
      trigger({ eventUpdates: { added: [], modified: [], removed: [removed] } }),
    );
    expect(client.deleteCalls).toHaveLength(0);
  });
});

describe("runOrchestrator — guards", () => {
  it("is a no-op when fewer than 2 calendars are configured", async () => {
    const client = new FakeMorgenClient();
    const source = sourceEvent();
    await runOrchestrator(
      client,
      trigger({
        accounts: { calendar: [personalCal] },
        eventUpdates: { added: [source], modified: [], removed: [] },
      }),
    );
    expect(client.createCalls).toHaveLength(0);
  });
});
