// Strip undefined-valued keys from a record. Used at the Morgen API
// boundary: the /v3 endpoints whitelist allowed fields, and sending
// `undefined` is whitelist-rejected as a "property X should not
// exist" error — we want the field omitted entirely instead.
//
// null is preserved on purpose: Morgen's update endpoint
// distinguishes "clear this field" (null) from "leave unchanged"
// (absent).
//
// Assignment uses Object.defineProperty rather than bracket notation
// so an enumerable own `__proto__` key on the input doesn't trigger
// Object.prototype's prototype setter and pollute the output's
// prototype chain.
export function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return out;
}
