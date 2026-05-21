import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import type { EventLike } from "../../src/lib/dedup-ts";
import { getDedupTs } from "../../src/lib/dedup-ts";

// Mirrors the bundle's getDeduplicationTs():
//   if (!this.originalStartTime) return 0;
//   let { date, dateTime, timeZone } = this.originalStartTime;
//   return moment.tz(date ?? dateTime, timeZone).unix();

describe("getDedupTs", () => {
  it("returns 0 when originalStartTime is undefined (non-recurring events)", () => {
    const event: EventLike = {};
    expect(getDedupTs(event)).toBe(0);
  });

  it("returns 0 when originalStartTime exists but has neither date nor dateTime", () => {
    // Defensive: bundle would yield NaN here; we prefer a sentinel.
    const event: EventLike = { originalStartTime: { timeZone: "Etc/UTC" } };
    expect(getDedupTs(event)).toBe(0);
  });

  it("parses a timed UTC dateTime to its unix epoch", () => {
    // Anchor case — the value that empirically merged our sniff-test
    // mirror with its source. 2026-05-22T01:18:00 UTC = unix 1779412680.
    const event: EventLike = {
      originalStartTime: { dateTime: "2026-05-22T01:18:00", timeZone: "Etc/UTC" },
    };
    expect(getDedupTs(event)).toBe(1_779_412_680);
  });

  it("interprets a dateTime in its declared timezone (CDT)", () => {
    const dateTime = "2026-05-22T01:18:00";
    const timeZone = "America/Chicago";
    const expected = DateTime.fromISO(dateTime, { zone: timeZone }).toUnixInteger();
    const event: EventLike = { originalStartTime: { dateTime, timeZone } };
    expect(getDedupTs(event)).toBe(expected);
    // Sanity: a different zone for the same wall-clock string must
    // produce a different unix epoch.
    expect(expected).not.toBe(1_779_412_680);
  });

  it("uses `date` for all-day events (start-of-day in zone)", () => {
    const event: EventLike = {
      originalStartTime: { date: "2026-05-22", timeZone: "Etc/UTC" },
    };
    const expected = DateTime.fromISO("2026-05-22", { zone: "Etc/UTC" }).toUnixInteger();
    expect(getDedupTs(event)).toBe(expected);
  });

  it("prefers `date` over `dateTime` when both are present (matches bundle `e ?? t`)", () => {
    const event: EventLike = {
      originalStartTime: {
        date: "2026-05-22",
        dateTime: "2026-05-22T01:18:00",
        timeZone: "Etc/UTC",
      },
    };
    const expectedFromDate = DateTime.fromISO("2026-05-22", { zone: "Etc/UTC" }).toUnixInteger();
    expect(getDedupTs(event)).toBe(expectedFromDate);
  });

  it("falls back to UTC when timeZone is missing", () => {
    const event: EventLike = {
      originalStartTime: { dateTime: "2026-05-22T01:18:00" },
    };
    expect(getDedupTs(event)).toBe(1_779_412_680);
  });

  it("handles a DST-boundary date correctly via luxon", () => {
    // 2026 US DST starts 2026-03-08 02:00 → 03:00 local. A wall-clock
    // moment at 2026-03-08T03:30 in America/Chicago is unambiguous.
    const dateTime = "2026-03-08T03:30:00";
    const timeZone = "America/Chicago";
    const expected = DateTime.fromISO(dateTime, { zone: timeZone }).toUnixInteger();
    const event: EventLike = { originalStartTime: { dateTime, timeZone } };
    expect(getDedupTs(event)).toBe(expected);
  });
});
