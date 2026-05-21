// Base-62 encoder using the same alphabet as Morgen's renderer:
// "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".
// Verbatim port of the base-x library implementation embedded in
// app.asar so the dedup-marker output matches byte-for-byte.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = ALPHABET.length;
const LOG_FACTOR = Math.log(256) / Math.log(BASE);
const LEAD_CHAR = ALPHABET.charAt(0);

// noUncheckedIndexedAccess types a Uint8Array read as `number |
// undefined`. For in-bounds indices the runtime always returns a
// number; wrap the read to keep the bit-arithmetic readable.
const u8 = (arr: Uint8Array, i: number): number => arr[i] ?? 0;

export function base62Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Count leading zero bytes — each becomes one leading character in
  // the output. base-x preserves the prefix this way so encode +
  // decode roundtrips correctly.
  let leadingZeros = 0;
  let inputIndex = 0;
  while (inputIndex !== bytes.length && u8(bytes, inputIndex) === 0) {
    leadingZeros++;
    inputIndex++;
  }

  // Worst-case output length: each remaining byte expands to ~log62(256)
  // ≈ 1.34 base-62 digits. +1 for safety.
  const outputLength = Math.trunc((bytes.length - inputIndex) * LOG_FACTOR) + 1;
  const digits = new Uint8Array(outputLength);
  let digitsUsed = 0;

  // Treat the input bytes as a big-endian unsigned integer and
  // repeatedly divide-by-BASE, writing remainders into `digits` from
  // the right. `digitsUsed` tracks how many tail positions hold real
  // data so we don't overshoot on subsequent bytes.
  while (inputIndex !== bytes.length) {
    let carry = u8(bytes, inputIndex);
    let count = 0;
    for (let i = outputLength - 1; (carry !== 0 || count < digitsUsed) && i !== -1; i--, count++) {
      carry += 256 * u8(digits, i);
      digits[i] = carry % BASE;
      carry = Math.floor(carry / BASE);
    }
    if (carry !== 0) throw new Error("Non-zero carry");
    digitsUsed = count;
    inputIndex++;
  }

  // Skip leading-zero digits introduced by the conversion (distinct
  // from the leadingZeros we counted in the input).
  let outIndex = outputLength - digitsUsed;
  while (outIndex !== outputLength && u8(digits, outIndex) === 0) {
    outIndex++;
  }

  let result = LEAD_CHAR.repeat(leadingZeros);
  while (outIndex < outputLength) {
    result += ALPHABET.charAt(u8(digits, outIndex));
    outIndex++;
  }
  return result;
}
