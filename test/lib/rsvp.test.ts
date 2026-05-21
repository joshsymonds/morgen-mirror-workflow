import { describe, expect, it } from "vitest";

import type { EventLike, Participant } from "../../src/lib/rsvp";
import { shouldPropagate } from "../../src/lib/rsvp";

const me = (overrides: Partial<Participant> = {}): Participant => ({
  accountOwner: true,
  calendarOwner: true,
  ...overrides,
});

const other = (overrides: Partial<Participant> = {}): Participant => ({
  accountOwner: false,
  calendarOwner: false,
  ...overrides,
});

describe("shouldPropagate", () => {
  it("propagates when participants is absent (self-created event)", () => {
    const event: EventLike = {};
    expect(shouldPropagate(event)).toBe(true);
  });

  it("propagates when participants is empty", () => {
    const event: EventLike = { participants: {} };
    expect(shouldPropagate(event)).toBe(true);
  });

  it("propagates when our participant has roles.owner (we organized it)", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { owner: true }, participationStatus: "declined" }) },
    };
    // Even with declined status, the owner check short-circuits.
    expect(shouldPropagate(event)).toBe(true);
  });

  it("propagates when our participationStatus is 'accepted'", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { attendee: true }, participationStatus: "accepted" }) },
    };
    expect(shouldPropagate(event)).toBe(true);
  });

  it("propagates when participationStatus is 'needs-action' (haven't replied yet)", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { attendee: true }, participationStatus: "needs-action" }) },
    };
    expect(shouldPropagate(event)).toBe(true);
  });

  it("does NOT propagate when participationStatus is 'declined'", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { attendee: true }, participationStatus: "declined" }) },
    };
    expect(shouldPropagate(event)).toBe(false);
  });

  it("does NOT propagate when participationStatus is 'tentative'", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { attendee: true }, participationStatus: "tentative" }) },
    };
    expect(shouldPropagate(event)).toBe(false);
  });

  it("propagates when participants exist but none is the account owner", () => {
    // Unclear scenario: a coworker meeting we're not on. Default to
    // propagating — better to over-mirror than miss busy time.
    const event: EventLike = {
      participants: {
        alice: other({ roles: { owner: true } }),
        bob: other({ roles: { attendee: true } }),
      },
    };
    expect(shouldPropagate(event)).toBe(true);
  });

  it("propagates when our participationStatus is missing (no explicit reply)", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { attendee: true } }) },
    };
    expect(shouldPropagate(event)).toBe(true);
  });

  it("picks the first accountOwner if duplicates exist (defensive)", () => {
    // Should not happen in real Morgen data, but the function must
    // not blow up.
    const event: EventLike = {
      participants: {
        first: me({ roles: { attendee: true }, participationStatus: "accepted" }),
        second: me({ roles: { attendee: true }, participationStatus: "declined" }),
      },
    };
    // Object.values preserves insertion order — "first" wins.
    expect(shouldPropagate(event)).toBe(true);
  });

  it("treats unrecognized participationStatus values as non-blocking", () => {
    const event: EventLike = {
      participants: { me: me({ roles: { attendee: true }, participationStatus: "delegated" }) },
    };
    expect(shouldPropagate(event)).toBe(true);
  });
});
