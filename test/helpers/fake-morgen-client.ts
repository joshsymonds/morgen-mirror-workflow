import { randomUUID } from "node:crypto";

import type {
  CreateEventArgs,
  DeleteEventArgs,
  ListEventsArgs,
  MorgenClient,
  MorgenEvent,
  UpdateEventArgs,
} from "../../src/lib/mirror";

// Hand-written fake — no mocking libraries (project convention,
// mirrors savecraft's pattern).
//
// Stores events in memory; ListEvents respects accountId/calendarIds
// and a [start, end] window comparing against event.start (ISO local
// time, lex-compare is correct for same-format strings).
export class FakeMorgenClient implements MorgenClient {
  public events = new Map<string, MorgenEvent>();
  public createCalls: CreateEventArgs[] = [];
  public updateCalls: UpdateEventArgs[] = [];
  public deleteCalls: DeleteEventArgs[] = [];
  public listCalls: ListEventsArgs[] = [];

  // Seed an event without going through createEvent (for setup that
  // simulates pre-existing data on Morgen's side).
  seed(event: MorgenEvent): void {
    this.events.set(event.id, event);
  }

  listEvents(args: ListEventsArgs): Promise<MorgenEvent[]> {
    this.listCalls.push(args);
    const calendarIds = new Set(args.calendarIds.split(","));
    const matches = [...this.events.values()].filter(
      (event) =>
        event.accountId === args.accountId &&
        calendarIds.has(event.calendarId) &&
        event.start >= args.start &&
        event.start <= args.end,
    );
    return Promise.resolve(matches);
  }

  createEvent(args: CreateEventArgs): Promise<MorgenEvent> {
    this.createCalls.push(args);
    const event: MorgenEvent = {
      id: randomUUID(),
      uid: `${randomUUID()}@fake`,
      ...args,
    };
    this.events.set(event.id, event);
    return Promise.resolve(event);
  }

  updateEvent(args: UpdateEventArgs): Promise<void> {
    this.updateCalls.push(args);
    const existing = this.events.get(args.id);
    if (existing) {
      // Only overlay fields the caller actually provided. Skipping
      // undefined values keeps stored events well-typed (matches
      // exactOptionalPropertyTypes semantics: absence ≠ undefined).
      const next: MorgenEvent = { ...existing };
      if (args.start !== undefined) next.start = args.start;
      if (args.duration !== undefined) next.duration = args.duration;
      if (args.description !== undefined) next.description = args.description;
      this.events.set(args.id, next);
    }
    return Promise.resolve();
  }

  deleteEvent(args: DeleteEventArgs): Promise<void> {
    this.deleteCalls.push(args);
    this.events.delete(args.id);
    return Promise.resolve();
  }
}
