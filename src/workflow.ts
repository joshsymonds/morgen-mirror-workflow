/* eslint-disable max-lines-per-function, unicorn/prevent-abbreviations, unicorn/consistent-function-scoping -- this file is the V8-isolate deployment artifact: a single self-contained run() function whose toString() must include every constant and helper it references. Moving anything to outer scope would break the SDK's serialization round-trip; the SHA-256 / base62 register names match the bundled crypto modules. The pure logic in src/lib/* remains strict; this file hand-mirrors it. */
import type { DateTime as LuxonDateTime } from "luxon";
import cw from "morgen-cw-sdk";

// V8-isolate globals injected by Morgen's runtime. These declarations
// are typing-only — they resolve at execution time inside the
// uploaded workflow.
//
// `morgen()` is in the SDK's `modules` rewrite list
// (node_modules/morgen-cw-sdk/src/index.ts:189-204), so bare `morgen`
// references inside the run function survive the toString-and-bundle
// round-trip. `luxon` is the same — the SDK's auto-break-time example
// uses it as a bare identifier in the run body, confirming Morgen
// injects luxon globally in the isolate.
declare const morgen: () => MorgenApi;
declare const luxon: { DateTime: typeof LuxonDateTime };
declare const log: (...args: unknown[]) => void;

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
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  // API-surface field for recurring-series instances. The bundle's
  // originalStartTime is built from this; we use it as the dedupTs
  // source for events read via listEvents.
  recurrenceId?: string;
  participants?: Record<
    string,
    {
      accountOwner?: boolean;
      calendarOwner?: boolean;
      roles?: { owner?: boolean; attendee?: boolean };
      participationStatus?: string;
    }
  >;
}

interface MorgenApi {
  events: {
    listEventsV3(args: {
      accountId: string;
      calendarIds: string;
      start: string;
      end: string;
    }): Promise<{ data?: { events?: SdkEvent[] } }>;
    createEventV3(args: { requestBody: Record<string, unknown> }): Promise<{
      data?: { event?: SdkEvent };
    }>;
    updateEventV3(args: { requestBody: Record<string, unknown> }): Promise<void>;
    deleteEventV3(args: { requestBody: Record<string, unknown> }): Promise<void>;
  };
}

// Role mirrors src/lib/mirror.ts CalendarRole — see that file for the
// model. Kept inline here because workflow.ts is the V8-isolate
// deployment artifact and can't reach back into the bundle's modules.
type CalendarRole = "source" | "destination" | "both";

interface CalendarRef {
  accountId: string;
  calendarId: string;
  role?: CalendarRole;
}

interface WorkflowTrigger {
  eventUpdates?: {
    added?: SdkEvent[];
    modified?: SdkEvent[];
    removed?: SdkEvent[];
  };
  accounts?: {
    calendar?: CalendarRef[];
  };
}

// The workflow function is uploaded to Morgen's V8 isolate via
// `wf.upload({ userUtilities: [] })`. Everything it needs lives in
// its own closure so the SDK's toString-and-concatenate serialization
// captures the entire logic verbatim. The pure logic in src/lib/* is
// the source-of-truth tested locally; this file hand-mirrors it as
// the deployment artifact.
export const wf = cw.workflow(
  { name: "n-way-busy-mirror" },
  async function run(trigger: WorkflowTrigger): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- preserves luxon's class name
    const { DateTime } = luxon;

    // ── Constants (mirror src/lib/*) ─────────────────────────
    const ROUND_CONSTANTS = new Uint32Array([
      0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b, 0x59_f1_11_f1,
      0x92_3f_82_a4, 0xab_1c_5e_d5, 0xd8_07_aa_98, 0x12_83_5b_01, 0x24_31_85_be, 0x55_0c_7d_c3,
      0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7, 0xc1_9b_f1_74, 0xe4_9b_69_c1, 0xef_be_47_86,
      0x0f_c1_9d_c6, 0x24_0c_a1_cc, 0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da,
      0x98_3e_51_52, 0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47,
      0x06_ca_63_51, 0x14_29_29_67, 0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc, 0x53_38_0d_13,
      0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85, 0xa2_bf_e8_a1, 0xa8_1a_66_4b,
      0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19, 0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70,
      0x19_a4_c1_16, 0x1e_37_6c_08, 0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a,
      0x5b_9c_ca_4f, 0x68_2e_6f_f3, 0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08,
      0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2,
    ]);
    const INITIAL_HASH = new Uint32Array([
      0x6a_09_e6_67, 0xbb_67_ae_85, 0x3c_6e_f3_72, 0xa5_4f_f5_3a, 0x51_0e_52_7f, 0x9b_05_68_8c,
      0x1f_83_d9_ab, 0x5b_e0_cd_19,
    ]);
    const BLOCK_BYTES = 64;
    const DIGEST_BYTES = 32;
    const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const BASE = ALPHABET.length;
    const LOG_FACTOR = Math.log(256) / Math.log(BASE);
    const LEAD_CHAR = ALPHABET.charAt(0);
    const HASH_LENGTH = 15;
    const MARKER_PREFIX = "Calendar Propagation:";
    const MARKER_REGEX = /Ref-Group-Id ([^#]+)#/;
    const BLOCKING_STATUSES: ReadonlySet<string> = new Set(["declined", "tentative"]);

    // ── SHA-256 (mirror src/lib/sha256.ts) ────────────────────
    // Morgen's V8 isolate doesn't expose TextEncoder; encode UTF-8
    // by hand to keep the workflow self-contained.
    function utf8Encode(input: string): Uint8Array {
      const bytes: number[] = [];
      for (let i = 0; i < input.length; i++) {
        const codePoint = input.codePointAt(i) ?? 0;
        if (codePoint > 0xff_ff) i++;
        if (codePoint < 0x80) {
          bytes.push(codePoint);
        } else if (codePoint < 0x8_00) {
          bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
        } else if (codePoint < 0x1_00_00) {
          bytes.push(
            0xe0 | (codePoint >> 12),
            0x80 | ((codePoint >> 6) & 0x3f),
            0x80 | (codePoint & 0x3f),
          );
        } else {
          bytes.push(
            0xf0 | (codePoint >> 18),
            0x80 | ((codePoint >> 12) & 0x3f),
            0x80 | ((codePoint >> 6) & 0x3f),
            0x80 | (codePoint & 0x3f),
          );
        }
      }
      return Uint8Array.from(bytes);
    }

    const u32 = (arr: Uint32Array, i: number): number => arr[i] ?? 0;
    const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

    function padMessage(bytes: Uint8Array): Uint8Array {
      const messageBits = BigInt(bytes.length) * 8n;
      const minLength = bytes.length + 1 + 8;
      const paddedLength = Math.ceil(minLength / BLOCK_BYTES) * BLOCK_BYTES;
      const padded = new Uint8Array(paddedLength);
      padded.set(bytes);
      padded[bytes.length] = 0x80;
      new DataView(padded.buffer).setBigUint64(paddedLength - 8, messageBits, false);
      return padded;
    }

    function expandSchedule(padded: Uint8Array, offset: number): Uint32Array {
      const w = new Uint32Array(64);
      const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const x15 = u32(w, i - 15);
        const x2 = u32(w, i - 2);
        const s0 = rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3);
        const s1 = rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10);
        w[i] = (u32(w, i - 16) + s0 + u32(w, i - 7) + s1) >>> 0;
      }
      return w;
    }

    function compressBlock(state: Uint32Array, w: Uint32Array): void {
      const h0 = u32(state, 0);
      const h1 = u32(state, 1);
      const h2 = u32(state, 2);
      const h3 = u32(state, 3);
      const h4 = u32(state, 4);
      const h5 = u32(state, 5);
      const h6 = u32(state, 6);
      const h7 = u32(state, 7);
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let i = 0; i < 64; i++) {
        const big1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + big1 + ch + u32(ROUND_CONSTANTS, i) + u32(w, i)) >>> 0;
        const big0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (big0 + mj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      state[0] = (h0 + a) >>> 0;
      state[1] = (h1 + b) >>> 0;
      state[2] = (h2 + c) >>> 0;
      state[3] = (h3 + d) >>> 0;
      state[4] = (h4 + e) >>> 0;
      state[5] = (h5 + f) >>> 0;
      state[6] = (h6 + g) >>> 0;
      state[7] = (h7 + h) >>> 0;
    }

    function sha256Bytes(input: string): Uint8Array {
      const padded = padMessage(utf8Encode(input));
      const state = new Uint32Array(INITIAL_HASH);
      for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
        compressBlock(state, expandSchedule(padded, offset));
      }
      const result = new Uint8Array(DIGEST_BYTES);
      const resultView = new DataView(result.buffer);
      for (let i = 0; i < 8; i++) resultView.setUint32(i * 4, u32(state, i), false);
      return result;
    }

    // ── Base62 (mirror src/lib/base62.ts) ─────────────────────
    const u8 = (arr: Uint8Array, i: number): number => arr[i] ?? 0;

    function base62Encode(bytes: Uint8Array): string {
      if (bytes.length === 0) return "";
      let leadingZeros = 0;
      let inputIndex = 0;
      while (inputIndex !== bytes.length && u8(bytes, inputIndex) === 0) {
        leadingZeros++;
        inputIndex++;
      }
      const outputLength = Math.trunc((bytes.length - inputIndex) * LOG_FACTOR) + 1;
      const digits = new Uint8Array(outputLength);
      let digitsUsed = 0;
      while (inputIndex !== bytes.length) {
        let carry = u8(bytes, inputIndex);
        let count = 0;
        for (
          let i = outputLength - 1;
          (carry !== 0 || count < digitsUsed) && i !== -1;
          i--, count++
        ) {
          carry += 256 * u8(digits, i);
          digits[i] = carry % BASE;
          carry = Math.floor(carry / BASE);
        }
        if (carry !== 0) throw new Error("Non-zero carry");
        digitsUsed = count;
        inputIndex++;
      }
      let outIndex = outputLength - digitsUsed;
      while (outIndex !== outputLength && u8(digits, outIndex) === 0) outIndex++;
      let result = LEAD_CHAR.repeat(leadingZeros);
      while (outIndex < outputLength) {
        result += ALPHABET.charAt(u8(digits, outIndex));
        outIndex++;
      }
      return result;
    }

    // ── Hash composition (mirror src/lib/hash.ts) ─────────────
    function iCalUidHash(uid: string, dedupTs: number): string {
      const digest = sha256Bytes(`${uid}.${dedupTs}`);
      return base62Encode(digest).slice(0, HASH_LENGTH);
    }

    // ── DedupTs (mirror src/lib/dedup-ts.ts) ──────────────────
    // listEvents responses don't carry originalStartTime — they
    // carry recurrenceId for recurring instances. Without using it
    // here, every instance of a recurring series collapses to
    // dedupTs=0 and the resulting groupId collisions cause mirror
    // oscillation across instances.
    function getDedupTs(event: SdkEvent): number {
      const ost = event.originalStartTime;
      if (ost) {
        const isoInput = ost.date ?? ost.dateTime;
        if (isoInput) {
          return DateTime.fromISO(isoInput, {
            zone: ost.timeZone ?? "Etc/UTC",
          }).toUnixInteger();
        }
      }
      if (event.recurrenceId) {
        return DateTime.fromISO(event.recurrenceId, {
          zone: event.timeZone ?? "Etc/UTC",
        }).toUnixInteger();
      }
      return 0;
    }

    // ── Marker (mirror src/lib/marker.ts) ─────────────────────
    function buildMarker(groupId: string): string {
      return `${MARKER_PREFIX} Ref-Group-Id ${groupId}#`;
    }

    function extractGroupId(description: string | null | undefined): string | null {
      if (!description) return null;
      const match = MARKER_REGEX.exec(description);
      return match?.[1] ?? null;
    }

    function isMirror(event: SdkEvent): boolean {
      return event.description?.includes(MARKER_PREFIX) ?? false;
    }

    // ── RSVP (mirror src/lib/rsvp.ts) ─────────────────────────
    function shouldPropagate(event: SdkEvent): boolean {
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

    // ── Compact (mirror src/lib/compact-record.ts) ────────────
    function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
      const out: Partial<T> = {};
      for (const [key, value] of Object.entries(record)) {
        if (value !== undefined) {
          // Object.defineProperty bypasses Object.prototype's
          // __proto__ setter, preventing prototype pollution from
          // adversarial inputs.
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

    // ── Mirror CRUD over morgen() (mirror src/lib/mirror.ts) ──
    async function listEventsInCalendar(
      cal: CalendarRef,
      windowStartISO: string,
      windowEndISO: string,
    ): Promise<SdkEvent[]> {
      const response = await morgen().events.listEventsV3({
        accountId: cal.accountId,
        calendarIds: cal.calendarId,
        start: windowStartISO,
        end: windowEndISO,
      });
      return response.data?.events ?? [];
    }

    async function createMirror(
      dest: CalendarRef,
      source: SdkEvent,
      groupId: string,
    ): Promise<void> {
      await morgen().events.createEventV3({
        requestBody: compactRecord({
          accountId: dest.accountId,
          calendarId: dest.calendarId,
          title: "[Busy]",
          description: buildMarker(groupId),
          start: source.start,
          duration: source.duration,
          timeZone: source.timeZone,
          showWithoutTime: source.showWithoutTime,
          freeBusyStatus: "busy",
          privacy: "private",
          // See src/lib/mirror.ts CreateEventArgs for the rationale and the
          // Morgen-whitelist gotcha (useDefaultAlertsOnCreation is rejected
          // — only the short form survives the wire).
          useDefaultAlerts: false,
        }),
      });
    }

    async function updateMirror(
      dest: CalendarRef,
      mirror: SdkEvent,
      patch: { start: string; duration?: string | undefined },
    ): Promise<void> {
      if (!mirror.id) return;
      await morgen().events.updateEventV3({
        requestBody: compactRecord({
          accountId: dest.accountId,
          calendarId: dest.calendarId,
          id: mirror.id,
          start: patch.start,
          duration: patch.duration,
          description: mirror.description,
        }),
      });
    }

    async function deleteMirror(dest: CalendarRef, mirror: SdkEvent): Promise<void> {
      if (!mirror.id) return;
      await morgen().events.deleteEventV3({
        requestBody: {
          accountId: dest.accountId,
          calendarId: dest.calendarId,
          id: mirror.id,
        },
      });
    }

    // ── Reconcile (mirror src/lib/orchestrator.ts) ────────────
    // Poll-and-reconcile: list events from every configured cal in a
    // forward-looking window, compute the set of mirrors that SHOULD
    // exist, compare to what does exist, and create / update / delete
    // to converge. Trigger-agnostic — works for manual, HTTP, cron,
    // or event-change triggers because we don't depend on
    // trigger.eventUpdates (which Morgen only populates for
    // Event-Change triggers anyway).
    function mirrorKey(calendarId: string, groupId: string): string {
      return `${calendarId}:${groupId}`;
    }

    interface ExpectedMirror {
      dest: CalendarRef;
      source: SdkEvent;
      groupId: string;
    }
    interface ExistingMirror {
      cal: CalendarRef;
      mirror: SdkEvent;
    }
    interface PerCalFetch {
      cal: CalendarRef;
      events: SdkEvent[];
    }

    function sourceGroupIdOrNull(event: SdkEvent): string | null {
      if (isMirror(event)) return null;
      if (event.freeBusyStatus === "free") return null;
      if (!event.uid) return null;
      if (!event.start) return null;
      if (!shouldPropagate(event)) return null;
      return iCalUidHash(event.uid, getDedupTs(event));
    }

    // Asymmetric propagation. See src/lib/mirror.ts isSource/isDestination
    // for the model: a calendar with role "destination" never has its
    // own events propagated out; one with role "source" never receives
    // mirrors. "both" (or undefined) is the legacy N-way default. This
    // workflow caps the inline calendar list in cals[] with explicit
    // roles further down — see the `applyRoles` step in the entry block.
    const isSource = (cal: CalendarRef): boolean => cal.role !== "destination";
    const isDestination = (cal: CalendarRef): boolean => cal.role !== "source";

    function collectExpected(
      sourceCal: CalendarRef,
      events: SdkEvent[],
      allCals: CalendarRef[],
      out: Map<string, ExpectedMirror>,
    ): void {
      if (!isSource(sourceCal)) return;
      for (const event of events) {
        const groupId = sourceGroupIdOrNull(event);
        if (groupId === null) continue;
        for (const dest of allCals) {
          if (dest.calendarId === sourceCal.calendarId) continue;
          if (!isDestination(dest)) continue;
          out.set(mirrorKey(dest.calendarId, groupId), { dest, source: event, groupId });
        }
      }
    }

    function collectExisting(
      cal: CalendarRef,
      events: SdkEvent[],
      out: Map<string, ExistingMirror>,
    ): void {
      for (const event of events) {
        if (!isMirror(event)) continue;
        const groupId = extractGroupId(event.description);
        if (groupId !== null) {
          out.set(mirrorKey(cal.calendarId, groupId), { cal, mirror: event });
        }
      }
    }

    interface ReconcilePlan {
      toCreate: ExpectedMirror[];
      toUpdate: { existing: ExistingMirror; expected: ExpectedMirror }[];
      toDelete: ExistingMirror[];
    }

    function planReconciliation(
      expected: Map<string, ExpectedMirror>,
      existing: Map<string, ExistingMirror>,
    ): ReconcilePlan {
      const toCreate: ExpectedMirror[] = [];
      const toUpdate: { existing: ExistingMirror; expected: ExpectedMirror }[] = [];
      const toDelete: ExistingMirror[] = [];
      for (const [key, exp] of expected) {
        const got = existing.get(key);
        if (!got) {
          toCreate.push(exp);
        } else if (
          got.mirror.start !== exp.source.start ||
          got.mirror.duration !== exp.source.duration
        ) {
          toUpdate.push({ existing: got, expected: exp });
        }
      }
      for (const [key, got] of existing) {
        if (!expected.has(key)) toDelete.push(got);
      }
      return { toCreate, toUpdate, toDelete };
    }

    async function applyPlan(plan: ReconcilePlan): Promise<void> {
      await Promise.all([
        ...plan.toCreate.map(async (exp) => {
          await createMirror(exp.dest, exp.source, exp.groupId);
        }),
        ...plan.toUpdate.map(({ existing: got, expected: exp }) =>
          updateMirror(got.cal, got.mirror, {
            start: exp.source.start ?? got.mirror.start ?? "",
            duration: exp.source.duration,
          }),
        ),
        ...plan.toDelete.map((got) => deleteMirror(got.cal, got.mirror)),
      ]);
    }

    // ── Entry ────────────────────────────────────────────────
    // Per-calendar role overrides. Calendars not listed here default to
    // "both" (legacy N-way). Keyed by Morgen's opaque calendarId — these
    // strings are stable per (account, calendar) pair.
    //
    // Justin-and-Josh shared (Google): propagates OUT so my work calendars
    // know I'm busy on joint plans, but receives no [Busy] noise — Justin
    // uses this calendar too and the inbound mirrors clutter the shared
    // view with my standups, 1:1s, etc.
    const CALENDAR_ROLES: Record<string, CalendarRole> = {
      // Justin and Josh
      WyI2YTA0Yjc3OGM4OTcxZTlmMjU2ZDI2YTMiLCJ0M3M2YWdvdjNodWZpNmhzcTd0dnI2Y2g4c0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29tIl0:
        "source",
    };

    const cals: CalendarRef[] = (trigger.accounts?.calendar ?? []).map((cal) => ({
      ...cal,
      role: CALENDAR_ROLES[cal.calendarId] ?? "both",
    }));
    log("n-way-busy-mirror entry", {
      calendarCount: cals.length,
      calendars: cals.map((c) => ({ id: c.calendarId, role: c.role })),
    });
    if (cals.length < 2) {
      log("skip: <2 configured calendars (configure Accounts in the workflow's UI)");
      return;
    }

    const now = DateTime.now();
    // luxon's toISO returns `string | null`, but null only for invalid
    // DateTimes; DateTime.now() is always valid and remains so under
    // .minus/.plus arithmetic. TS narrows the result to string in this
    // file's tsconfig.
    //
    // Window: 7-day lookback (catches mirrors whose source was just
    // deleted) + 90-day lookahead (most people schedule within 3
    // months). Each cron run scans 4 calendars × ~97 days; even
    // dense calendars stay under a few hundred events per cal.
    const startISO = now
      .minus({ days: 7 })
      .toISO({ suppressMilliseconds: true, includeOffset: false });
    const endISO = now
      .plus({ days: 90 })
      .toISO({ suppressMilliseconds: true, includeOffset: false });

    log("reconcile window", { startISO, endISO });

    const perCal: PerCalFetch[] = await Promise.all(
      cals.map(async (cal) => ({ cal, events: await listEventsInCalendar(cal, startISO, endISO) })),
    );

    const expected = new Map<string, ExpectedMirror>();
    const existing = new Map<string, ExistingMirror>();
    for (const { cal, events } of perCal) {
      collectExpected(cal, events, cals, expected);
      collectExisting(cal, events, existing);
    }

    const plan = planReconciliation(expected, existing);
    log("reconcile plan", {
      toCreate: plan.toCreate.length,
      toUpdate: plan.toUpdate.length,
      toDelete: plan.toDelete.length,
    });

    await applyPlan(plan);

    log("n-way-busy-mirror done", {
      created: plan.toCreate.length,
      updated: plan.toUpdate.length,
      deleted: plan.toDelete.length,
    });
  },
);
