// The literal substrings Morgen's renderer recognizes:
//
//   isPropagatedEvent() returns true if description includes
//   "Calendar Propagation". We use it as our priority-demotion lever
//   (~100× higher getDuplicatePriorityFactor) so the source becomes
//   the primary in the merged display.
//
//   extractGroupIdFromNotes() runs `/Ref-Group-Id ([^#]+)#/` on the
//   description and returns the captured group; that becomes the
//   event's iCalUIDHash, bypassing the natural y(uid.dedupTs)
//   computation. Setting this on the MIRROR with the source's natural
//   hash value makes the two match without modifying the source.

export const MARKER_PREFIX = "Calendar Propagation:";
export const MARKER_REGEX = /Ref-Group-Id ([^#]+)#/;

export function buildMarker(groupId: string): string {
  return `${MARKER_PREFIX} Ref-Group-Id ${groupId}#`;
}

export function extractGroupId(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = MARKER_REGEX.exec(description);
  return match?.[1] ?? null;
}

// `description?: string | null | undefined` reads redundant but is
// load-bearing under exactOptionalPropertyTypes: events arrive from
// the Morgen API with the field absent, set to a string, or
// explicitly null; callers must be able to pass any of those shapes.
export function isMirror(event: { description?: string | null | undefined }): boolean {
  return event.description?.includes(MARKER_PREFIX) ?? false;
}
