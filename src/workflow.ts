import cw from "morgen-cw-sdk";

import { createMorgenClient } from "./lib/morgen-client-adapter";
import { runOrchestrator } from "./lib/orchestrator";

// The workflow uploaded to Morgen's V8 isolate. Its body runs on
// every configured event-change trigger. Construction here requires
// MORGEN_API_KEY or MORGEN_ACCESS_TOKEN in env — the SDK enforces it.
//
// The cast tightens the SDK's loose WorkflowTrigger (eventUpdates
// typed as empty arrays of unknown shape) into our richer
// WorkflowEvent projection. The runtime payload Morgen passes does
// carry these fields; the SDK types just under-specify them.
export const wf = cw.workflow(
  { name: "n-way-busy-mirror" },
  async function run(trigger): Promise<void> {
    const client = createMorgenClient();
    await runOrchestrator(client, trigger);
  },
);
