/* eslint-disable max-lines-per-function, unicorn/prevent-abbreviations, unicorn/consistent-function-scoping, @typescript-eslint/naming-convention -- this file is the V8-isolate deployment artifact: a single self-contained run() function whose toString() must include every constant and helper it references. Moving anything to outer scope (consistent-function-scoping) or renaming `DateTime` (naming-convention) would break the SDK's serialization round-trip. The pure logic in src/lib/* remains strict; this file hand-mirrors it. */
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

interface CalendarRef {
  accountId: string;
  calendarId: string;
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
    const BLOCKING_STATUSES = new Set(["declined", "tentative"]);
    const SEARCH_WINDOW_HOURS = 168;

    // ── SHA-256 (mirror src/lib/sha256.ts) ────────────────────
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
      const padded = padMessage(new TextEncoder().encode(input));
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
    function getDedupTs(event: SdkEvent): number {
      const ost = event.originalStartTime;
      if (!ost) return 0;
      const isoInput = ost.date ?? ost.dateTime;
      if (!isoInput) return 0;
      return DateTime.fromISO(isoInput, { zone: ost.timeZone ?? "Etc/UTC" }).toUnixInteger();
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
      if (me.roles?.owner === true) return true;
      const status = me.participationStatus;
      if (status === undefined) return true;
      return !BLOCKING_STATUSES.has(status);
    }

    // ── Mirror CRUD over morgen() (mirror src/lib/mirror.ts) ──
    function offsetIso(iso: string, hours: number): string {
      const shifted = DateTime.fromISO(iso, { zone: "Etc/UTC" }).plus({ hours });
      return shifted.toISO({ suppressMilliseconds: true, includeOffset: false }) ?? iso;
    }

    function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) if (v !== undefined) out[k] = v;
      return out;
    }

    async function listEventsInWindow(dest: CalendarRef, aroundStart: string): Promise<SdkEvent[]> {
      const response = await morgen().events.listEventsV3({
        accountId: dest.accountId,
        calendarIds: dest.calendarId,
        start: offsetIso(aroundStart, -SEARCH_WINDOW_HOURS),
        end: offsetIso(aroundStart, SEARCH_WINDOW_HOURS),
      });
      return response.data?.events ?? [];
    }

    async function findMirror(
      dest: CalendarRef,
      groupId: string,
      aroundStart: string,
    ): Promise<SdkEvent | null> {
      const events = await listEventsInWindow(dest, aroundStart);
      return events.find((e) => extractGroupId(e.description) === groupId) ?? null;
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
        }),
      });
    }

    async function updateMirror(
      dest: CalendarRef,
      mirror: SdkEvent,
      patch: { start: string; duration: string },
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

    // ── Orchestration (mirror src/lib/orchestrator.ts) ────────
    function destinationsFor(event: SdkEvent, cals: CalendarRef[]): CalendarRef[] {
      return cals.filter((c) => c.calendarId !== event.calendarId);
    }

    interface Precheck {
      groupId: string;
      dests: CalendarRef[];
    }

    function precheck(event: SdkEvent, cals: CalendarRef[]): Precheck | null {
      if (isMirror(event)) return null;
      if (!event.uid) return null;
      return {
        groupId: iCalUidHash(event.uid, getDedupTs(event)),
        dests: destinationsFor(event, cals),
      };
    }

    async function deleteMirrorsAcross(
      dests: CalendarRef[],
      groupId: string,
      aroundStart: string,
    ): Promise<void> {
      await Promise.all(
        dests.map(async (dest) => {
          const existing = await findMirror(dest, groupId, aroundStart);
          if (existing) await deleteMirror(dest, existing);
        }),
      );
    }

    async function upsertMirrorAt(
      dest: CalendarRef,
      source: SdkEvent,
      groupId: string,
    ): Promise<void> {
      if (!source.start) return;
      const existing = await findMirror(dest, groupId, source.start);
      if (!existing) {
        await createMirror(dest, source, groupId);
        return;
      }
      if (existing.start !== source.start || existing.duration !== source.duration) {
        await updateMirror(dest, existing, {
          start: source.start,
          duration: source.duration ?? "PT0M",
        });
      }
    }

    async function handleUpsert(cals: CalendarRef[], event: SdkEvent): Promise<void> {
      if (event.freeBusyStatus === "free") return;
      const pre = precheck(event, cals);
      if (!pre || !event.start) return;
      if (!shouldPropagate(event)) {
        await deleteMirrorsAcross(pre.dests, pre.groupId, event.start);
        return;
      }
      await Promise.all(pre.dests.map((dest) => upsertMirrorAt(dest, event, pre.groupId)));
    }

    async function handleRemoval(cals: CalendarRef[], event: SdkEvent): Promise<void> {
      const pre = precheck(event, cals);
      if (!pre || !event.start) return;
      await deleteMirrorsAcross(pre.dests, pre.groupId, event.start);
    }

    // ── Entry ────────────────────────────────────────────────
    const cals = trigger.accounts?.calendar ?? [];
    if (cals.length < 2) return;
    const updates = trigger.eventUpdates ?? {};
    const added = updates.added ?? [];
    const modified = updates.modified ?? [];
    const removed = updates.removed ?? [];
    for (const event of [...added, ...modified]) {
      await handleUpsert(cals, event);
    }
    for (const event of removed) {
      await handleRemoval(cals, event);
    }
  },
);
