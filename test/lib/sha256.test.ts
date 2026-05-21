import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Bytes } from "../../src/lib/sha256";

// FIPS 180-2 / NIST test vectors. If these pass, our SHA-256
// implementation is byte-identical to the spec.
describe("sha256Bytes", () => {
  const cases: { input: string; expected: string }[] = [
    {
      input: "",
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      input: "abc",
      expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
      input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      expected: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
  ];

  it.each(cases)("hashes $input correctly", ({ input, expected }) => {
    const bytes = sha256Bytes(input);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(expected);
  });

  it("returns a 32-byte digest", () => {
    expect(sha256Bytes("anything").length).toBe(32);
  });

  // Cross-check against node:crypto as oracle for inputs the FIPS
  // vectors don't cover (multi-block, multi-byte UTF-8, emoji, the
  // exact iCalUID shapes the workflow will hash in production).
  const oracleCases = [
    "café 日本語 🎉",
    "3r4qqlcqavl5b2eqgc9gq174js@google.com.0",
    "3r4qqlcqavl5b2eqgc9gq174js@google.com.1779412680",
    "a".repeat(1000), // multi-block
  ];

  it.each(oracleCases)("matches node:crypto for %j", (input) => {
    const expected = createHash("sha256").update(input, "utf8").digest();
    const actual = sha256Bytes(input);
    expect(Buffer.from(actual).toString("hex")).toBe(expected.toString("hex"));
  });
});
