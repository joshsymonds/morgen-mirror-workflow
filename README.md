# morgen-mirror-workflow

A Morgen Custom Workflow that propagates busy-time blocks N-way between
all your configured calendars. Source events stay private in their
origin calendar; destination calendars get a `[Busy]` mirror that's
recognized by Morgen's "Merge Duplicate Events" feature as the same
event — so your Morgen aggregate view shows one entry (in the source
calendar's color) while every other calendar gets a private busy
block visible to coworkers' free/busy lookups.

Runs entirely on Morgen's infrastructure. No servers on your side.

## How it works

When an event changes on any configured source calendar, the workflow:

1. **Skips its own mirrors** — anything whose description contains
   `Calendar Propagation:` is one of our prior outputs.
2. **Skips events you've declined** — only accepted (or RSVP-not-applicable)
   events propagate.
3. **Computes a stable group identifier** that matches the source's
   natural `iCalUIDHash`: `y(uid + "." + dedupTs)` where `dedupTs` is
   `unix(originalStartTime)` for recurring instances/exceptions and `0`
   for non-recurring events. `y` is base62(sha256(input)).slice(0, 15)
   — verbatim from Morgen's renderer.
4. **Creates/updates/deletes mirrors** in every other configured
   calendar. Each mirror has:
   - Title: `[Busy]`
   - `privacy: private`, `freeBusyStatus: busy`
   - Description: a hidden HTML span carrying
     `Calendar Propagation: Ref-Group-Id <groupId>#`

The marker tricks Morgen's dedup into merging the mirror with the
source despite the title mismatch. The `Calendar Propagation` substring
demotes the mirror's display priority via `getDuplicatePriorityFactor`
(×100), so the source becomes the canonical display.

## One-time setup

1. **Install dependencies**:
   ```
   cd ~/Personal/morgen-mirror-workflow
   npm install
   ```

2. **Set your Morgen API key**:
   ```
   export MORGEN_API_KEY="$(cat /run/user/$UID/agenix/morgen-api-key)"
   ```

3. **Deploy**:
   ```
   npm run deploy
   ```

4. **Configure in the Morgen web app** at
   https://platform.morgen.so/workflows:
   - Find the workflow named `n-way-busy-mirror`.
   - Set its **Trigger** to "Event change" on every calendar you want
     to propagate from/to (all 4 of yours).
   - Set its **Accounts** to the same set of calendars (these are
     passed to the workflow as `trigger.accounts.calendar[]`).

5. **Verify** by creating a test event in one calendar; within seconds
   you should see `[Busy]` mirrors in the others, all merged in the
   Morgen view with the source's color.

## Limitations

- Mirrors are not propagated for events with `freeBusyStatus: "free"`.
- Recurring-series MASTER events aren't mirrored — only the expanded
  instances are (which is the right behavior; the master is a rule,
  not an actual time block).
- The mirror's description carries a small HTML marker. It's hidden
  in rendered views but visible in raw description fields if you go
  looking.
- Companion patches in `~/nix-config/overlays/default.nix` rewrite
  Morgen's bundled JS so merged events display in the source calendar's
  color instead of a gradient.
