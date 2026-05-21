import { describe, expect, it } from "vitest";

import {
  buildMarker,
  extractGroupId,
  isMirror,
  MARKER_PREFIX,
  MARKER_REGEX,
} from "../../src/lib/marker";

describe("buildMarker", () => {
  it("contains the Ref-Group-Id segment for the given group id", () => {
    const marker = buildMarker("Y27IKhgiKMoRjMD");
    expect(marker).toContain("Ref-Group-Id Y27IKhgiKMoRjMD#");
  });

  it("includes the Calendar Propagation prefix for priority demotion", () => {
    expect(buildMarker("anyId")).toContain(MARKER_PREFIX);
  });

  it("produces a string parseable by extractGroupId (roundtrip)", () => {
    const groupId = "cIJFuGNoFdJsurW";
    expect(extractGroupId(buildMarker(groupId))).toBe(groupId);
  });
});

describe("extractGroupId", () => {
  it("returns the captured id from a plain-text description", () => {
    expect(extractGroupId("Ref-Group-Id Y27IKhgiKMoRjMD#")).toBe("Y27IKhgiKMoRjMD");
  });

  it("returns the captured id when embedded mid-string", () => {
    const description = "Some preamble. Ref-Group-Id abcDEF123#. Trailing notes.";
    expect(extractGroupId(description)).toBe("abcDEF123");
  });

  it("returns the captured id from an HTML-wrapped description", () => {
    const description = "<p>Calendar Propagation: Ref-Group-Id Y27IKhgiKMoRjMD#</p>";
    expect(extractGroupId(description)).toBe("Y27IKhgiKMoRjMD");
  });

  it("returns null when there is no marker", () => {
    expect(extractGroupId("Doctor's appointment")).toBeNull();
  });

  it("returns null for undefined, null, and empty descriptions", () => {
    // unicorn/no-useless-undefined misreads this; we're testing input
    // handling, not invoking with a redundant arg.
    const absent: string | undefined = undefined;
    expect(extractGroupId(absent)).toBeNull();
    expect(extractGroupId(null)).toBeNull();
    expect(extractGroupId("")).toBeNull();
  });

  it("returns null when the prefix appears without a terminating '#'", () => {
    expect(extractGroupId("Ref-Group-Id Y27IKhgiKMoRjMD")).toBeNull();
  });

  it("returns the FIRST id when multiple markers are present", () => {
    const description = "Ref-Group-Id firstId#. Then Ref-Group-Id secondId#.";
    expect(extractGroupId(description)).toBe("firstId");
  });

  it("uses the regex constant matching the renderer's pattern", () => {
    // Sanity check that we're exporting the same regex we documented.
    expect(MARKER_REGEX.source).toBe("Ref-Group-Id ([^#]+)#");
  });
});

describe("isMirror", () => {
  it("returns true when description contains 'Calendar Propagation:'", () => {
    expect(isMirror({ description: "Calendar Propagation: Ref-Group-Id x#" })).toBe(true);
  });

  it("returns true even with HTML wrapping", () => {
    expect(isMirror({ description: "<p>Calendar Propagation: Ref-Group-Id x#</p>" })).toBe(true);
  });

  it("returns false for normal events with descriptions", () => {
    expect(isMirror({ description: "Doctor's appointment notes" })).toBe(false);
  });

  it("returns false when description is undefined, null, or empty", () => {
    expect(isMirror({ description: undefined })).toBe(false);
    expect(isMirror({ description: null })).toBe(false);
    expect(isMirror({ description: "" })).toBe(false);
    expect(isMirror({})).toBe(false);
  });

  it("returns false when only the Ref-Group-Id segment is present (no prefix)", () => {
    // Defensive: an external system might emit Ref-Group-Id without our
    // Calendar Propagation prefix. We don't claim those as ours.
    expect(isMirror({ description: "Ref-Group-Id abc#" })).toBe(false);
  });
});
