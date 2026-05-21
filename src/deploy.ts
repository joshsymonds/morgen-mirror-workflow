/* eslint-disable no-console -- deploy.ts is a CLI; user-facing output is via console */
import { wf } from "./workflow";

// The workflow is fully self-contained — all helpers, constants, and
// SDK-runtime accessors (morgen(), luxon) live inside the run()
// function closure in workflow.ts. The SDK serializes that closure
// via fn.toString() and uploads it as one script; nothing else needs
// to be passed as userUtilities.
async function main(): Promise<void> {
  console.info("Uploading n-way-busy-mirror workflow to Morgen…");
  await wf.upload();
  console.info();
  console.info("Done. Open https://platform.morgen.so/workflows to configure:");
  console.info("  1. Add an 'Event change' trigger on all 4 calendars");
  console.info("  2. Add the same 4 calendars under 'Accounts'");
  console.info("  3. Toggle the workflow active");
}

await main();
