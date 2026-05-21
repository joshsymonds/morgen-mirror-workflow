import { base62Encode } from "./base62";
import { sha256Bytes } from "./sha256";

// Morgen's renderer derives an event's iCalUIDHash from its description
// (a `Ref-Group-Id <hash>#` marker if present) or, when absent, from
// the natural fields via this fallback:
//
//   y(`${iCalUID}.${getDeduplicationTs()}`)
//
// where y(s) = base62(sha256(s)).slice(0, 15). For non-recurring
// events `getDeduplicationTs()` returns 0 because `originalStartTime`
// is undefined; for recurring instances/exceptions it returns the
// unix epoch of `originalStartTime` parsed in its timezone.
//
// We reproduce that function exactly so a mirror's Ref-Group-Id
// marker — derived from the source's uid and dedupTs — matches the
// source's natural hash, triggering the merge without us ever writing
// to the source description.

const HASH_LENGTH = 15;

export function iCalUidHash(uid: string, dedupTs: number): string {
  const digest = sha256Bytes(`${uid}.${dedupTs}`);
  return base62Encode(digest).slice(0, HASH_LENGTH);
}
