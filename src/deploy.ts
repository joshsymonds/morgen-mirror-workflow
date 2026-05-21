/* eslint-disable no-console, unicorn/no-process-exit, unicorn/prefer-top-level-await -- deploy.ts is a CLI. Console output is intentional. process.exit propagates the failure code to npm-run. Top-level await is unavailable under CommonJS, which we use here because morgen-cw-sdk's CJS default-export interop requires it. */
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

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
