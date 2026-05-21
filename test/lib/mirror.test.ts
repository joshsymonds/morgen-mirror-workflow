import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { buildMarker } from "../../src/lib/marker";
import type { CalendarRef, MorgenEvent, SourceEvent } from "../../src/lib/mirror";
import {
  createMirror,
  deleteMirror,
  findMirror,
  SEARCH_WINDOW_HOURS,
  updateMirror,
} from "../../src/lib/mirror";
import { FakeMorgenClient } from "../helpers/fake-morgen-client";

const dest: CalendarRef = { accountId: "acct-work", calendarId: "cal-work" };

const sourceEvent = (overrides: Partial<SourceEvent> = {}): SourceEvent => ({
  start: "2026-05-22T01:18:00",
  duration: "PT5M",
  timeZone: "Etc/UTC",
  showWithoutTime: false,
  ...overrides,
});

describe("createMirror", () => {
  it("creates a [Busy] event in the destination with the canonical marker", async () => {
    const client = new FakeMorgenClient();
    const groupId = "Y27IKhgiKMoRjMD";
    const created = await createMirror(client, dest, sourceEvent(), groupId);

    expect(client.createCalls).toHaveLength(1);
    const args = client.createCalls[0]!;
    expect(args.accountId).toBe("acct-work");
    expect(args.calendarId).toBe("cal-work");
    expect(args.title).toBe("[Busy]");
    expect(args.description).toBe(buildMarker(groupId));
    expect(args.freeBusyStatus).toBe("busy");
    expect(args.privacy).toBe("private");
    expect(args.start).toBe("2026-05-22T01:18:00");
    expect(args.duration).toBe("PT5M");
    expect(args.timeZone).toBe("Etc/UTC");
    expect(args.showWithoutTime).toBe(false);
    expect(created.description).toBe(buildMarker(groupId));
  });

  it("copies showWithoutTime: true for all-day source events", async () => {
    const client = new FakeMorgenClient();
    const source = sourceEvent({
      start: "2026-05-22",
      duration: "P1D",
      showWithoutTime: true,
    });
    await createMirror(client, dest, source, "g1");
    expect(client.createCalls[0]!.showWithoutTime).toBe(true);
  });
});

describe("findMirror", () => {
  const groupId = "Y27IKhgiKMoRjMD";
  const aroundStart = "2026-05-22T01:18:00";

  it("returns the mirror whose description carries the matching group id", async () => {
    const client = new FakeMorgenClient();
    const mirror: MorgenEvent = {
      id: "evt-1",
      uid: "uid-1@fake",
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      title: "[Busy]",
      description: buildMarker(groupId),
      start: aroundStart,
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    };
    client.seed(mirror);

    const found = await findMirror(client, dest, groupId, aroundStart);
    expect(found?.id).toBe("evt-1");
  });

  it("returns null when no event matches the group id", async () => {
    const client = new FakeMorgenClient();
    client.seed({
      id: "evt-other",
      uid: "uid-other@fake",
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      title: "[Busy]",
      description: buildMarker("differentId"),
      start: aroundStart,
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    });

    const found = await findMirror(client, dest, groupId, aroundStart);
    expect(found).toBeNull();
  });

  it("ignores events without a marker", async () => {
    const client = new FakeMorgenClient();
    client.seed({
      id: "evt-bare",
      uid: "uid-bare@fake",
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      title: "Regular event",
      start: aroundStart,
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    });
    expect(await findMirror(client, dest, groupId, aroundStart)).toBeNull();
  });

  it(`searches a window of exactly ±${SEARCH_WINDOW_HOURS}h around aroundStart`, async () => {
    const client = new FakeMorgenClient();
    await findMirror(client, dest, groupId, aroundStart);
    expect(client.listCalls).toHaveLength(1);
    const call = client.listCalls[0]!;
    expect(call.accountId).toBe(dest.accountId);
    expect(call.calendarIds).toBe(dest.calendarId);

    const anchor = DateTime.fromISO(aroundStart, { zone: "Etc/UTC" });
    const startDiff = DateTime.fromISO(call.start, { zone: "Etc/UTC" }).diff(anchor, "hours").hours;
    const endDiff = DateTime.fromISO(call.end, { zone: "Etc/UTC" }).diff(anchor, "hours").hours;
    expect(startDiff).toBeCloseTo(-SEARCH_WINDOW_HOURS, 6);
    expect(endDiff).toBeCloseTo(SEARCH_WINDOW_HOURS, 6);
  });

  it("ignores events in different calendars", async () => {
    const client = new FakeMorgenClient();
    client.seed({
      id: "evt-other-cal",
      uid: "uid-other-cal@fake",
      accountId: dest.accountId,
      calendarId: "OTHER-CAL",
      title: "[Busy]",
      description: buildMarker(groupId),
      start: aroundStart,
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    });
    expect(await findMirror(client, dest, groupId, aroundStart)).toBeNull();
  });
});

describe("updateMirror", () => {
  it("rewrites start and duration while preserving identity and marker", async () => {
    const client = new FakeMorgenClient();
    const mirror: MorgenEvent = {
      id: "evt-1",
      uid: "uid-1@fake",
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      title: "[Busy]",
      description: buildMarker("g1"),
      start: "2026-05-22T01:18:00",
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    };
    client.seed(mirror);

    await updateMirror(client, dest, mirror, {
      start: "2026-05-22T03:00:00",
      duration: "PT10M",
    });

    expect(client.updateCalls).toHaveLength(1);
    const call = client.updateCalls[0]!;
    expect(call.id).toBe("evt-1");
    expect(call.start).toBe("2026-05-22T03:00:00");
    expect(call.duration).toBe("PT10M");
    expect(call.description).toBe(buildMarker("g1")); // unchanged
  });

  it("forwards undefined duration verbatim (leaves the field for the API to omit)", async () => {
    // Callers may legitimately omit duration when the source has none
    // — updateMirror must not fabricate a fallback. The underlying
    // updateEvent strips undefined fields at the wire boundary.
    const client = new FakeMorgenClient();
    const mirror: MorgenEvent = {
      id: "evt-2",
      uid: "uid-2@fake",
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      title: "[Busy]",
      description: buildMarker("g2"),
      start: "2026-05-22T01:18:00",
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    };
    client.seed(mirror);

    await updateMirror(client, dest, mirror, { start: "2026-05-22T03:00:00" });

    expect(client.updateCalls).toHaveLength(1);
    expect(client.updateCalls[0]!.duration).toBeUndefined();
  });
});

describe("deleteMirror", () => {
  it("deletes by id within the destination calendar", async () => {
    const client = new FakeMorgenClient();
    const mirror: MorgenEvent = {
      id: "evt-1",
      uid: "uid-1@fake",
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      title: "[Busy]",
      description: buildMarker("g1"),
      start: "2026-05-22T01:18:00",
      duration: "PT5M",
      timeZone: "Etc/UTC",
      showWithoutTime: false,
    };
    client.seed(mirror);

    await deleteMirror(client, dest, mirror);

    expect(client.deleteCalls).toHaveLength(1);
    expect(client.deleteCalls[0]).toEqual({
      accountId: dest.accountId,
      calendarId: dest.calendarId,
      id: "evt-1",
    });
    expect(client.events.has("evt-1")).toBe(false);
  });
});
