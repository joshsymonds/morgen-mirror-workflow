/* eslint-disable no-console -- deploy.ts is a CLI; user-facing output is via console */
import { base62Encode } from "./lib/base62";
import { getDedupTs } from "./lib/dedup-ts";
import { iCalUidHash } from "./lib/hash";
import { buildMarker, extractGroupId, isMirror } from "./lib/marker";
import { createMirror, deleteMirror, findMirror, updateMirror } from "./lib/mirror";
import { createMorgenClient } from "./lib/morgen-client-adapter";
import { runOrchestrator } from "./lib/orchestrator";
import { shouldPropagate } from "./lib/rsvp";
import { sha256Bytes } from "./lib/sha256";
import { wf } from "./workflow";

// Every helper the workflow's transitive call graph touches must be
// listed here so the SDK serializes it into the uploaded V8 script.
// import_name maps to the file basename our cross-module references
// compile to; the SDK rewrites `<import_name>_1.<name>` → `<name>`.
const userUtilities = [
  { import_name: "sha256", value: sha256Bytes },
  { import_name: "base62", value: base62Encode },
  { import_name: "hash", value: iCalUidHash },
  { import_name: "dedup-ts", value: getDedupTs },
  { import_name: "marker", value: buildMarker },
  { import_name: "marker", value: extractGroupId },
  { import_name: "marker", value: isMirror },
  { import_name: "rsvp", value: shouldPropagate },
  { import_name: "mirror", value: createMirror },
  { import_name: "mirror", value: findMirror },
  { import_name: "mirror", value: updateMirror },
  { import_name: "mirror", value: deleteMirror },
  { import_name: "morgen-client-adapter", value: createMorgenClient },
  { import_name: "orchestrator", value: runOrchestrator },
];

async function main(): Promise<void> {
  console.info("Uploading n-way-busy-mirror workflow to Morgen…");
  await wf.upload({ userUtilities });
  console.info();
  console.info("Done. Open https://platform.morgen.so/workflows to configure:");
  console.info("  1. Add an 'Event change' trigger on all 4 calendars");
  console.info("  2. Add the same 4 calendars under 'Accounts'");
  console.info("  3. Toggle the workflow active");
}

await main();
