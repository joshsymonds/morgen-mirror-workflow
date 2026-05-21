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

  it("preserves the output's prototype chain even when input carries __proto__", () => {
    // Construct an adversarial input where __proto__ is set as an own
    // enumerable property via Object.defineProperty (not the literal
    // syntax, which the parser intercepts). With bracket-assignment
    // (`out[key] = value`) this key routes through Object.prototype's
    // __proto__ setter and replaces the output's prototype chain.
    // The current Object.defineProperty form defines an own data
    // property and never triggers the setter.
    const malicious: Record<string, unknown> = { safe: "value" };
    Object.defineProperty(malicious, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const out = compactRecord(malicious);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
