import { sandbox } from "morgen-cw-sdk";

import type {
  CreateEventArgs,
  DeleteEventArgs,
  ListEventsArgs,
  MorgenClient,
  MorgenEvent,
  UpdateEventArgs,
} from "./mirror";

// Loose projection of the Morgen API's event shape — the actual /v3
// response is wider than what mirror.ts needs, and the SDK's
// generated types don't match the real wire format (which wraps the
// payload in `{ data: { event: ... } }`).
interface SdkEvent {
  id?: string;
  uid?: string;
  accountId?: string;
  calendarId?: string;
  title?: string;
  description?: string;
  start?: string;
  duration?: string;
  timeZone?: string;
  showWithoutTime?: boolean;
  freeBusyStatus?: string;
  privacy?: string;
}

interface FetchResponse {
  body: unknown;
}

interface ListResponseBody {
  data?: { events?: SdkEvent[] };
}

interface CreateResponseBody {
  data?: { event?: SdkEvent };
}

function projectEvent(sdkEvent: SdkEvent): MorgenEvent {
  return {
    id: sdkEvent.id ?? "",
    uid: sdkEvent.uid ?? "",
    accountId: sdkEvent.accountId ?? "",
    calendarId: sdkEvent.calendarId ?? "",
    title: sdkEvent.title ?? "",
    description: sdkEvent.description,
    start: sdkEvent.start ?? "",
    duration: sdkEvent.duration ?? "",
    timeZone: sdkEvent.timeZone ?? "Etc/UTC",
    showWithoutTime: sdkEvent.showWithoutTime ?? false,
    freeBusyStatus: sdkEvent.freeBusyStatus,
    privacy: sdkEvent.privacy,
  };
}

// Strip undefined fields. The /v3 API is whitelist-validated and
// some endpoints reject explicit nulls; sending only set fields
// matches the shape the bundle's renderer sends.
function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

// Wraps fetchMorgen — which is injected with the workflow's runtime
// JWT inside the V8 isolate — in the narrow MorgenClient interface.
// Constructable locally for the typecheck pass; the actual HTTP calls
// only succeed inside the isolate where global.TOKEN is set.
export function createMorgenClient(): MorgenClient {
  const { fetchMorgen } = sandbox.util;

  return {
    async listEvents(args: ListEventsArgs): Promise<MorgenEvent[]> {
      const query = new URLSearchParams({
        accountId: args.accountId,
        calendarIds: args.calendarIds,
        start: args.start,
        end: args.end,
      }).toString();
      const response = (await fetchMorgen(
        `https://api.morgen.so/v3/events/list?${query}`,
      )) as FetchResponse;
      const body = response.body as ListResponseBody;
      return (body.data?.events ?? []).map((event) => projectEvent(event));
    },

    async createEvent(args: CreateEventArgs): Promise<MorgenEvent> {
      const response = (await fetchMorgen("https://api.morgen.so/v3/events/create", {
        method: "POST",
        body: JSON.stringify(compactRecord(args as unknown as Record<string, unknown>)),
      })) as FetchResponse;
      const body = response.body as CreateResponseBody;
      const created = body.data?.event;
      if (!created) throw new Error("Morgen returned no event from events/create");
      return projectEvent(created);
    },

    async updateEvent(args: UpdateEventArgs): Promise<void> {
      await fetchMorgen("https://api.morgen.so/v3/events/update", {
        method: "POST",
        body: JSON.stringify(compactRecord(args as unknown as Record<string, unknown>)),
      });
    },

    async deleteEvent(args: DeleteEventArgs): Promise<void> {
      await fetchMorgen("https://api.morgen.so/v3/events/delete", {
        method: "POST",
        body: JSON.stringify(args),
      });
    },
  };
}
