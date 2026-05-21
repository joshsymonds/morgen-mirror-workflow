import { describe, expect, it } from "vitest";

import { iCalUidHash } from "../../src/lib/hash";

// Expected values captured from the verbatim port that we ran against
// the live Morgen bundle (groupid-verbatim.js). The first one
// (dedupTs=0) is the value that empirically merged a [Busy] mirror
// with a no-marker source in the Morgen UI — i.e. it matches what
// Morgen's renderer computes for non-recurring events whose
// originalStartTime is undefined.
describe("iCalUidHash", () => {
  const SOURCE_UID = "3r4qqlcqavl5b2eqgc9gq174js@google.com";

  it("matches Morgen's iCalUIDHash for a non-recurring event (dedupTs = 0)", () => {
    expect(iCalUidHash(SOURCE_UID, 0)).toBe("cIJFuGNoFdJsurW");
  });

  it("matches Morgen's iCalUIDHash for a recurring instance (dedupTs from originalStartTime)", () => {
    // 1779412680 = unix(2026-05-22T01:18:00Z) — the start of the
    // sniff-test source event, which would also serve as the
    // dedupTs if the event were a recurring instance.
    expect(iCalUidHash(SOURCE_UID, 1_779_412_680)).toBe("Y27IKhgiKMoRjMD");
  });

  it("returns a 15-character string", () => {
    const result = iCalUidHash(SOURCE_UID, 0);
    expect(result.length).toBe(15);
  });

  it("only uses base62 alphabet characters", () => {
    const alphabetRegex = /^[0-9a-zA-Z]+$/;
    expect(iCalUidHash(SOURCE_UID, 0)).toMatch(alphabetRegex);
    expect(iCalUidHash(SOURCE_UID, 1_779_412_680)).toMatch(alphabetRegex);
    expect(iCalUidHash("any-uid", 999_999_999)).toMatch(alphabetRegex);
  });

  it("produces a different hash for the same uid at different dedupTs values", () => {
    // The whole point of including dedupTs: each recurring instance
    // gets a unique groupId so mirrors don't cross-merge between
    // occurrences.
    const atZero = iCalUidHash(SOURCE_UID, 0);
    const atInstance = iCalUidHash(SOURCE_UID, 1_779_412_680);
    expect(atZero).not.toBe(atInstance);
  });

  it("handles long O365-style GOID uids", () => {
    // Real shape, observed in production O365 calendar events.
    const o365Uid =
      "040000008200E00074C5B7101A82E00800000000B58D4FFA5CE9DC01000000000000000010000000A4BFE90715AF1F45B8D22FD84B8C7D5D";
    const result = iCalUidHash(o365Uid, 0);
    expect(result.length).toBe(15);
    expect(result).toMatch(/^[0-9a-zA-Z]+$/);
  });

  it("handles UTF-8 codepoints in uid without crashing", () => {
    // Multi-byte chars are unusual in uids but iCalendar RFC 5545
    // permits any UTF-8 — our hash must handle them deterministically.
    const result = iCalUidHash("événement-日本", 0);
    expect(result.length).toBe(15);
    expect(iCalUidHash("événement-日本", 0)).toBe(result);
  });
});
