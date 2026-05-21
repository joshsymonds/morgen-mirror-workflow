// Strip undefined-valued keys from a record. Used at the Morgen API
// boundary: the /v3 endpoints whitelist allowed fields, and sending
// `undefined` is whitelist-rejected as a "property X should not
// exist" error — we want the field omitted entirely instead.
//
// null is preserved on purpose: Morgen's update endpoint
// distinguishes "clear this field" (null) from "leave unchanged"
// (absent).
//
// Only own enumerable string keys are iterated, so prototype-polluted
// objects can't smuggle keys through.
export function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
