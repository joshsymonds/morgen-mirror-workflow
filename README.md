# morgen-mirror-workflow

A Morgen Custom Workflow that propagates busy-time blocks N-way
between all your configured calendars. Source events stay in their
origin calendar; destination calendars get a `[Busy]` mirror that's
recognized by Morgen's "Merge Duplicate Events" feature as the same
event — so your Morgen aggregate view shows one entry (in the source
calendar's color, with the optional [companion bundle patch][color-patch])
while every other calendar gets a private busy block visible to
coworkers' free/busy lookups.

Runs entirely on Morgen's infrastructure. No daemon on your side.

[color-patch]: https://github.com/joshsymonds/nix-config/blob/main/overlays/default.nix

## How it works

When an event changes on any configured source calendar, the workflow:

1. **Skips its own mirrors** — events whose description contains
   `Calendar Propagation:` are prior outputs of this workflow.
2. **Skips events you've declined** — only `accepted` /
   `needs-action` / no-RSVP events propagate. Declining an event
   also cleans up any mirrors that already exist for it.
3. **Skips events marked `free`** — only busy time propagates.
4. **Computes a stable group identifier** that matches the source's
   natural `iCalUIDHash`: `y(uid + "." + dedupTs)` where `dedupTs` is
   `unix(originalStartTime)` for recurring instances/exceptions and
   `0` for non-recurring events; `y` = `base62(sha256(input)).slice(0, 15)`
   — byte-equivalent to the renderer's hash function.
5. **Creates/updates/deletes mirrors** in every other configured
   calendar:
   - Title: `[Busy]`
   - `privacy: "private"`, `freeBusyStatus: "busy"`
   - Description: `Calendar Propagation: Ref-Group-Id <groupId>#`

The `Ref-Group-Id` substring tricks Morgen's dedup into merging the
mirror with its source despite the title mismatch. The
`Calendar Propagation` substring demotes the mirror's display
priority via `getDuplicatePriorityFactor` (×100), so the source
becomes the canonical display in the merged group.

## One-time setup

```
cd ~/Personal/morgen-mirror-workflow
npm install
MORGEN_API_KEY=$(cat /run/user/$UID/agenix/morgen-api-key) npm run deploy
```

The deploy script:
1. Bundles the workflow source + all userUtilities
2. POSTs it to Morgen's `workflows/create` (or `/update` if it already
   exists by name)
3. Prints the trigger and config URLs

Then **configure in the Morgen web app** at
https://platform.morgen.so/workflows:

- Find `n-way-busy-mirror` in the list
- Add an **Event change trigger** with all 4 source calendars selected
- Under **Accounts**, add the same 4 calendars (these are passed in as
  `trigger.accounts.calendar[]`)
- Toggle the workflow active

**Verify** by creating a test event in one calendar; within seconds
you should see `[Busy]` mirrors in the others, merged in the Morgen
view.

## Re-deploying after code changes

Same command:

```
MORGEN_API_KEY=$(cat /run/user/$UID/agenix/morgen-api-key) npm run deploy
```

The SDK's update path preserves your trigger and account configuration;
only the source code changes.

## Development

```
npm run test           # vitest
npm run test:watch     # vitest in watch mode
npm run test:coverage  # coverage report (90% threshold per metric)
npm run lint           # eslint
npm run lint:fix       # eslint with --fix
npm run fmt            # prettier --write
npm run typecheck      # tsc --noEmit
npm run check          # all of the above (CI gate)
```

TDD is the working style: every behavior has a failing test before
implementation. No mocking libraries — the Morgen client is wrapped
behind a narrow interface and tests use the hand-written
`FakeMorgenClient` in `test/helpers/`.

## Repo structure

```
src/
  lib/
    sha256.ts                    # pure-JS FIPS 180-4
    base62.ts                    # verbatim port of bundle's base-x
    hash.ts                      # iCalUidHash composing the two
    dedup-ts.ts                  # extract unix-ts from originalStartTime
    marker.ts                    # build/extract Ref-Group-Id markers
    rsvp.ts                      # accepted-only filter
    mirror.ts                    # MorgenClient interface + CRUD operations
    orchestrator.ts              # the propagation logic (testable)
    compact-record.ts            # strip-undefined helper; lib parity copy for workflow.ts inline
  workflow.ts                    # self-contained V8-isolate artifact (hand-mirrors src/lib/*)
  deploy.ts                      # one-shot upload CLI
test/
  lib/                           # mirror of src/lib/
  helpers/
    fake-morgen-client.ts        # hand-written fake for orchestrator/mirror tests
```

## Limitations

- Mirrors are not propagated for events with `freeBusyStatus: "free"`.
- Recurring-series MASTER events aren't mirrored — only the expanded
  instances are (which is the right behavior; the master is a rule,
  not an actual time block).
- The mirror's description carries the visible marker text. Owners of
  destination calendars and IT admins can see it; non-delegate
  viewers see only "Busy" thanks to `privacy: "private"`.
