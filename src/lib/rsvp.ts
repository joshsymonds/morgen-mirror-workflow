// JSCalendar participant shape, minimal projection. Real entries
// carry more fields (email, name, locale, …); we narrow to what the
// RSVP decision needs.
export interface Participant {
  accountOwner?: boolean | undefined;
  calendarOwner?: boolean | undefined;
  roles?:
    | {
        owner?: boolean | undefined;
        attendee?: boolean | undefined;
        chair?: boolean | undefined;
        informational?: boolean | undefined;
      }
    | undefined;
  participationStatus?: string | undefined;
}

export interface EventLike {
  participants?: Record<string, Participant> | undefined;
}

// Statuses that block propagation. Whitelist-style: anything else
// (accepted, needs-action, delegated, missing, unrecognized future
// JSCalendar values) propagates. The rationale: declining or
// tentatively-accepting an invite is an explicit "I might not be
// there" — don't broadcast busy time to other calendars on the
// user's behalf.
const BLOCKING_STATUSES: ReadonlySet<string> = new Set(["declined", "tentative"]);

// True iff the event should generate mirror busy-blocks in other
// calendars. Determined by the user's RSVP status (when there's
// participant data) or by default when there isn't.
export function shouldPropagate(event: EventLike): boolean {
  const participants = event.participants;
  if (!participants) return true;

  const me = Object.values(participants).find((p) => p.accountOwner === true);
  if (!me) return true;

  // Organizers don't RSVP — they always count as attending.
  if (me.roles?.owner === true) return true;

  const status = me.participationStatus;
  if (status === undefined) return true;

  return !BLOCKING_STATUSES.has(status);
}
