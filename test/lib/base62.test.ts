import { describe, expect, it } from "vitest";

import { base62Encode } from "../../src/lib/base62";

// Alphabet: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
// Verbatim from Morgen's bundle. Hand-computed expectations from the
// bytes-as-big-endian-integer interpretation the base-x library uses.
describe("base62Encode", () => {
  it("encodes empty input as empty string", () => {
    expect(base62Encode(new Uint8Array([]))).toBe("");
  });

  it("represents each leading zero byte as a '0' character", () => {
    expect(base62Encode(new Uint8Array([0]))).toBe("0");
    expect(base62Encode(new Uint8Array([0, 0, 0]))).toBe("000");
  });

  it("encodes small in-range values directly", () => {
    expect(base62Encode(new Uint8Array([1]))).toBe("1");
    // alphabet[61] = 'Z' (last character)
    expect(base62Encode(new Uint8Array([61]))).toBe("Z");
  });

  it("rolls over past the alphabet (62 → '10')", () => {
    // 62 decimal = 1*62 + 0 → digits [1, 0] → "10"
    expect(base62Encode(new Uint8Array([62]))).toBe("10");
  });

  it("encodes max-byte value [255] as '47'", () => {
    // 255 = 4*62 + 7
    expect(base62Encode(new Uint8Array([255]))).toBe("47");
  });

  it("interprets multiple bytes as big-endian unsigned integer", () => {
    // [1, 0] = 256 = 4*62 + 8 → "48"
    expect(base62Encode(new Uint8Array([1, 0]))).toBe("48");
  });

  it("preserves leading zeros alongside encoded payload", () => {
    // [0, 1] → one leading '0' + base62(1) = "01"
    expect(base62Encode(new Uint8Array([0, 1]))).toBe("01");
    // [0, 0, 62] → "0010"
    expect(base62Encode(new Uint8Array([0, 0, 62]))).toBe("0010");
  });

  it("reaches every character in the alphabet across [0..61]", () => {
    const seen = new Set<string>();
    for (let value = 0; value < 62; value++) {
      const encoded = base62Encode(new Uint8Array([value]));
      const lastChar = encoded.at(-1);
      if (lastChar !== undefined) seen.add(lastChar);
    }
    expect(seen.size).toBe(62);
  });

  it("matches the bundle output for a 32-byte SHA-256 digest", () => {
    // The exact 32 bytes of SHA-256("hello"), and the corresponding
    // first 15 chars of the bundle's base62 output — captured from
    // groupid-verbatim.js against the live extracted Morgen bundle.
    const sha256OfHello = new Uint8Array([
      0x2c, 0xf2, 0x4d, 0xba, 0x5f, 0xb0, 0xa3, 0x0e, 0x26, 0xe8, 0x3b, 0x2a, 0xc5, 0xb9, 0xe2,
      0x9e, 0x1b, 0x16, 0x1e, 0x5c, 0x1f, 0xa7, 0x42, 0x5e, 0x73, 0x04, 0x33, 0x62, 0x93, 0x8b,
      0x98, 0x24,
    ]);
    const fullEncoded = base62Encode(sha256OfHello);
    expect(fullEncoded.slice(0, 15)).toBe("aEO7hBt3J4tVAa0");
  });
});
