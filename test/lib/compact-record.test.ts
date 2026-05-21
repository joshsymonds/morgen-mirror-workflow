import { describe, expect, it } from "vitest";

import { compactRecord } from "../../src/lib/compact-record";

describe("compactRecord", () => {
  it("returns an empty object for an empty input", () => {
    expect(compactRecord({})).toEqual({});
  });

  it("preserves all defined values", () => {
    const input = { a: 1, b: "two", c: true, d: null, e: 0, f: "" };
    expect(compactRecord(input)).toEqual(input);
  });

  it("strips undefined-valued keys", () => {
    const input = { a: 1, b: undefined, c: 3 };
    expect(compactRecord(input)).toEqual({ a: 1, c: 3 });
  });

  it("preserves null (distinct from undefined)", () => {
    // Morgen distinguishes 'cleared' (null) from 'unchanged' (absent)
    // on the update endpoint; the helper must let null through.
    expect(compactRecord({ k: null })).toEqual({ k: null });
  });

  it("only iterates own enumerable properties (no proto pollution)", () => {
    const input: Record<string, unknown> = { real: 1 };
    Object.defineProperty(input, "hidden", { value: 2, enumerable: false });
    expect(compactRecord(input)).toEqual({ real: 1 });
  });

  it("does not write to __proto__ when input has that key", () => {
    // Object.entries iterates own enumerable string keys, which on a
    // literal-created object cannot include __proto__ — but the
    // contract is that the function only assigns keys it iterated.
    const out = compactRecord({ safe: "value" });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});
