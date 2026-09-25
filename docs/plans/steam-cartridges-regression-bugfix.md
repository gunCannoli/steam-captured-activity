# steam-cartridges: AM2R Game Info regression + nav-cycle / Your Stuff flakes

Status: diagnosed live 2026-09-24 (desktop, `steam-cartridges-dev`). Not implemented.
Follows [plans/README.md](README.md) (plan writing standard). Decision: [ADR-0035](../decisions.md#adr-0035-local-game-info-is-a-capture-tier-feature-buckets-gate-only-fetching).

## 1. Root causes

### 1.1 AM2R Game Info (real regression, from P2 commit `123eb2b`)

P2 gated **all** Game Info on `bucket === "web-scraping"`, including the local
`library_metadata.json` that `steamgriddb-artwork` applied to every shortcut before
the merge (`git show 3a41323^:steamgriddb-artwork/frontend/index.tsx`: preload
enriches every cached shortcut, `handleAppView` has no gate). The default bucket is
`none`, so every shortcut lost its Game Info.

Live evidence (SharedJSContext, 2026-09-24):

| Probe | Value |
| --- | --- |
| plugin config (`PluginConfig_GetAll`) | `{}` (no buckets) |
| `bucketReport().games[4263274102]` | `{ bucket: "none", via: "default" }` |
| `bucketReport().unbucketedWithMetadata` | `27` |
| `library_metadata.json` has `4263274102` | yes (description, categories) |
| `appDetailsStore.GetAppData(A).descriptionsData` | empty; `associationData` null |
| `overview.BIsModOrShortcut()` | `true` → grey `#AppDetails_Shortcut_Explanation` |
| `overview.gameid` | `18310622842007322624` (correct; guardrail 1 intact) |

Violated: plugins.md **guardrail 4** (Game Info must render without the grey
warning), **ADR-0010** (degrade, never blank), and the user's intent behind
decision 1 ("ignored" meant *no sourcing/network*, ADR-0032). ADR-0033 recorded the
loss as a consequence. The render-bugfix (`98d77ba`) then weakened
`scratch/check_all_tabs.js` check 4 to accept the grey box, which hid it. Now
guardrails **14** and **15**.

Code sites: `steam-cartridges/frontend/features/game-info/index.ts`
(`handleWebScrapingView` returns before the local apply for non-web-scraping; the
preload enriches only `web-scraping` and waits for collections; `onBucketsChanged`
reverts every non-web-scraping game) and `features/source-view.ts` (`none` branch
calls `revertGameDetails`).

### 1.2 `test_nav_cycle.js` "1 vs 2 activity days" (test flake; pre-existing)

- `steam/activity.ts`, `steam/summary.ts`, `steam/sections.ts` and
  `renderers/library-app.tsx` are **byte-identical** to pre-merge
  `non-steam-games-activity` (`git diff 3a41323^:non-steam-games-activity/frontend/<f> HEAD:steam-cartridges/frontend/<f>` is empty).
  `scratch/test_nav_cycle.js` is unchanged since `a40a3fe`.
- Live sampler (4 A→B→A cycles, every 300 ms): on every return, Steam's
  `GetAppActivity` → `RestoreActivity` creates an empty `CAppActivity` first (0 days,
  fetch requested). `publishActivity` fills **that same object** 0.3 to 1.2 s later. The
  store ended at **3 days on every visit**. The DOM showed `SEPTEMBER 2` alone, then
  `SEPTEMBER 2|SEPTEMBER 1`, 300 to 600 ms later: Steam's feed renders
  `appActivityByDay.slice(0, nDaysToDisplay)`, and `ShowMoreContent()` raises it one
  day at a time (module `80478`).
- So the script compares a progressively revealed DOM count after a fixed 3 s wait.
  If rendering is slow (for example, an occluded or unfocused window), that count is still 1. The data is never lost.
  Fix the test, not the plugin. It should compare the store day count and poll.

### 1.3 `check_all_tabs.js` "Your Stuff 0 items" once (test flake; inferred)

It happened once, on the first run after a UI mode switch, and passed (8) on the rerun. The plugin does not feed
Your Stuff. Steam queries captures by `overview.gameid`, and that value is correct live. The
script waits a fixed 2.5 s after the `Media` heading appears. "Manage my N items"
appears only after Steam's async media load, which is cold after a mode switch.
This is not reproduced live (a mode switch needs a restart, per steam-debug.md Trap 6). Fix: poll up to 10 s.
After §1.1's fix, AM2R is enriched, so `BIsModOrShortcut()` returns `false`. Your Stuff then
depends on the `GetGameID` hook (guardrail 1). `enrichGameDetails` installs that hook through
`ensureAppOverviewHooked` during the startup preload, before any view.

### Ruled out

- `activity.ts` negative cache (guardrail 5): `m_setUnavailableApps.has(A)` is `false`; stub retained.
- The `pending` bucket replay: with no assignments `getBucket` never returns `pending`.
- `refreshGameInfoInstances` load: not called for `none` games today.

## 2. Preconditions (run first; stop if any differs)

All commands use Git Bash. Run each once.

```bash
cd /c/game/millennium && git status --porcelain
```
Expected: no output. If there is output, stop (failure rule, §6).

```bash
cd /c/game/millennium/steam-cartridges && npm run check
```
Expected: the npm banner lines `> steam-cartridges@0.1.0 check` and `> tsc --noEmit`, then nothing else, exit 0.

```bash
cd /c/game/millennium/steam-cartridges && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected exactly:
```
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

## 3. Steps (in this order)

Every **before** block is copied from the file. If `Edit` cannot find it
exactly, the plan is stale: stop (failure rule).

### Step 1: new file `steam-cartridges/frontend/features/game-info/policy.ts`

Create with exactly:

```ts
/**
 * Game Info tiers per bucket (ADR-0035). Pure, no imports, so Node can run the
 * unit tests with type stripping.
 *
 *   local tier : library_metadata.json on disk. Applied to every shortcut that
 *                is not steam-store (none and pending included). No network.
 *   fetch tier : GetGameMetadata (IGDB). web-scraping only (ADR-0032).
 *   steam-store: owned by features/steam-store; neither tier runs.
 */
export interface GameInfoPlan {
    applyLocal: boolean;
    fetchWeb: boolean;
}

export function gameInfoPlan(bucket: string, via: string): GameInfoPlan {
    if (bucket === "steam-store") return { applyLocal: false, fetchWeb: false };
    if (via === "pending") return { applyLocal: true, fetchWeb: false };
    return { applyLocal: true, fetchWeb: bucket === "web-scraping" };
}
```

Run: `cd /c/game/millennium/steam-cartridges && npm run check`. Expected: same as §2 (no errors).

### Step 2: new file `steam-cartridges/tests/game-info-policy.test.ts`

Create with exactly:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameInfoPlan } from '../frontend/features/game-info/policy.ts';

test('none: local Game Info, no fetch (ADR-0035)', () => {
    assert.deepEqual(gameInfoPlan('none', 'default'), { applyLocal: true, fetchWeb: false });
});

test('pending: local Game Info, no fetch', () => {
    assert.deepEqual(gameInfoPlan('none', 'pending'), { applyLocal: true, fetchWeb: false });
});

test('web-scraping: local Game Info and web fetch', () => {
    assert.deepEqual(gameInfoPlan('web-scraping', 'collection'), { applyLocal: true, fetchWeb: true });
    assert.deepEqual(gameInfoPlan('web-scraping', 'override'), { applyLocal: true, fetchWeb: true });
});

test('steam-store: neither tier (the store handler owns Game Info)', () => {
    assert.deepEqual(gameInfoPlan('steam-store', 'collection'), { applyLocal: false, fetchWeb: false });
    assert.deepEqual(gameInfoPlan('steam-store', 'override'), { applyLocal: false, fetchWeb: false });
});
```

Run: `cd /c/game/millennium/steam-cartridges && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected exactly: `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`.

### Step 3: `steam-cartridges/frontend/features/game-info/index.ts`: imports

Before:
```ts
import { enrichGameDetails, revertGameDetails } from "./metadata";
import {
    collectionsReady,
    getBucket,
    invalidateMembership,
    onBucketsChanged,
    setMetadataAppidSource,
    waitForCollections,
} from "../buckets";
```
After:
```ts
import { enrichGameDetails, revertGameDetails } from "./metadata";
import { gameInfoPlan } from "./policy";
import {
    collectionsReady,
    getBucket,
    invalidateMembership,
    onBucketsChanged,
    setMetadataAppidSource,
} from "../buckets";
```
(Do not run `check` yet: `waitForCollections` is still used until Step 5.)

### Step 4: same file, `handleWebScrapingView` head

Before:
```ts
/** Web-scraping source for one shortcut view (dispatched by features/source-view.ts). */
export async function handleWebScrapingView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    // Buckets gate the web source (ADR-0033): only web-scraping games are enriched.
    const { bucket, via } = getBucket(appid);
    if (via === "pending") return;
    if (bucket !== "web-scraping") {
        if (bucket !== "steam-store" && enrichedAppIds.has(appid)) revertGameDetails(appid);
        return;
    }

    if (libraryCache.has(appid)) {
        enrichGameDetails(appid, libraryCache.get(appid)!);
    }

    if (processedApps.has(appid)) return;
```
After:
```ts
/**
 * Game Info for one view of a shortcut that is not steam-store (dispatched by
 * features/source-view.ts). Local DB for every such shortcut; the web fetch
 * only for web-scraping games (ADR-0035, ADR-0032).
 */
export async function handleWebScrapingView(appid: number): Promise<void> {
    if (appid < NON_STEAM_APPID_MIN) return;

    const { bucket, via } = getBucket(appid);
    const plan = gameInfoPlan(bucket, via);

    if (plan.applyLocal && libraryCache.has(appid)) {
        enrichGameDetails(appid, libraryCache.get(appid)!);
    }
    if (!plan.fetchWeb) return;

    if (processedApps.has(appid)) return;
```
Everything below `if (processedApps.has(appid)) return;` in that function stays unchanged.

### Step 5: same file, preload in `initGameInfo`

Before:
```ts
    // Preload all cached metadata into appDetailsStore immediately
    try {
        const all = await rpc.getAllMetadata();
        const ready = all?.success && all.library
            ? await waitForCollections()
            : false;
        if (all?.success && all.library) {
            // Cache everything; enrich only web-scraping games. On a collections
            // timeout the preload enriches nothing (views still enrich lazily).
            if (!ready) {
                logger.warn(
                    "Collections not ready; skipping Game Info preload (views enrich lazily).",
                );
            }
            let count = 0;
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    libraryCache.set(appid, meta);
                    if (
                        ready &&
                        getBucket(appid).bucket === "web-scraping" &&
                        enrichGameDetails(appid, meta)
                    ) {
                        count++;
                    }
                }
            }
```
After:
```ts
    // Preload all cached metadata into appDetailsStore immediately. Local data
    // applies to every shortcut that is not steam-store (ADR-0035), so this does
    // not wait for collections; getBucket returns 'pending' until they load
    // (guardrail 13: it never reads collectionStore computeds before then).
    try {
        const all = await rpc.getAllMetadata();
        if (all?.success && all.library) {
            let count = 0;
            for (const [key, meta] of Object.entries(all.library)) {
                const appid = Number(key);
                if (Number.isFinite(appid) && appid >= NON_STEAM_APPID_MIN) {
                    libraryCache.set(appid, meta);
                    const { bucket, via } = getBucket(appid);
                    if (
                        gameInfoPlan(bucket, via).applyLocal &&
                        enrichGameDetails(appid, meta)
                    ) {
                        count++;
                    }
                }
            }
```
The following lines (`logger.info(\`Preloaded Game Info ...`, the closing braces, and the `catch`) stay unchanged.

### Step 6: same file, `onBucketsChanged` handler

Before:
```ts
    onBucketsChanged(() => {
        invalidateMembership();
        if (!collectionsReady()) return;
        for (const appid of [...enrichedAppIds]) {
            const bucket = getBucket(appid).bucket;
            // steam-store games keep their enrichment (its view handler owns it);
            // anything else, or a game that left steam-store, is reverted.
            if (bucket === "steam-store") continue;
            if (bucket !== "web-scraping" || storeEnrichedAppIds.has(appid)) {
                revertGameDetails(appid);
                storeEnrichedAppIds.delete(appid);
            }
        }
        for (const [appid, meta] of libraryCache) {
            if (
                !enrichedAppIds.has(appid) &&
                getBucket(appid).bucket === "web-scraping"
            ) {
                enrichGameDetails(appid, meta);
            }
        }
    });
```
After:
```ts
    onBucketsChanged(() => {
        invalidateMembership();
        if (!collectionsReady()) return;
        // A game that left steam-store drops the store's Game Info (ADR-0033) ...
        for (const appid of [...storeEnrichedAppIds]) {
            if (getBucket(appid).bucket === "steam-store") continue;
            revertGameDetails(appid);
            storeEnrichedAppIds.delete(appid);
        }
        // ... and every shortcut that is not steam-store shows its local Game Info (ADR-0035).
        for (const [appid, meta] of libraryCache) {
            const { bucket, via } = getBucket(appid);
            if (!enrichedAppIds.has(appid) && gameInfoPlan(bucket, via).applyLocal) {
                enrichGameDetails(appid, meta);
            }
        }
    });
```

Run: `cd /c/game/millennium/steam-cartridges && npm run check`. Expected: no errors, exit 0.

### Step 7: `steam-cartridges/frontend/features/source-view.ts`

7a. Imports. Before:
```ts
import { handleWebScrapingView } from "./game-info";
import { enrichedAppIds, setAppViewTrigger } from "./game-info/game-info-patch";
import { revertGameDetails } from "./game-info/metadata";
import { handleSteamStoreView, leaveSteamStore } from "./steam-store";
```
After:
```ts
import { handleWebScrapingView } from "./game-info";
import { setAppViewTrigger } from "./game-info/game-info-patch";
import { handleSteamStoreView, leaveSteamStore } from "./steam-store";
```

7b. `onSourceView` body. Before:
```ts
        const { bucket, via } = getBucket(appid);
        if (via === "pending") {
            deferred.add(appid);
            return;
        }
        if (bucket === "web-scraping") {
            // Came from steam-store: drop its Game Info before the web source fills in.
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            await handleWebScrapingView(appid);
        } else if (bucket === "steam-store") {
            await handleSteamStoreView(appid);
        } else {
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            else if (enrichedAppIds.has(appid)) revertGameDetails(appid);
        }
```
After:
```ts
        const { bucket, via } = getBucket(appid);
        if (via === "pending") {
            // Local Game Info only until collections load (ADR-0035); replayed then.
            deferred.add(appid);
            await handleWebScrapingView(appid);
            return;
        }
        if (bucket === "steam-store") {
            await handleSteamStoreView(appid);
        } else {
            // web-scraping or none. Came from steam-store: drop its Game Info first;
            // the handler then applies local data (and fetches for web-scraping only).
            if (storeEnrichedAppIds.has(appid)) leaveSteamStore(appid);
            await handleWebScrapingView(appid);
        }
```

Run: `cd /c/game/millennium/steam-cartridges && npm run check`. Expected: no errors, exit 0.

### Step 8: `steam-cartridges/frontend/settings/settings-panel.tsx` (line ~215)

Before:
```tsx
                <div>{report.unbucketedWithMetadata} game(s) have cached metadata but no bucket, so Game Info is hidden for them.</div>
```
After:
```tsx
                <div>{report.unbucketedWithMetadata} game(s) have cached metadata but no bucket: they show their saved Game Info, but it is never refreshed from the web.</div>
```

Run: `npm run check` (expected clean), then
`cd /c/game/millennium/steam-cartridges && npm run test:ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`, then
`cd /c/game/millennium/steam-cartridges && npm run build 2>&1 | tail -3` → the last line starts with
`build Succeeded passing all tests`. Ignore the `versionMon ... requires update to 3.3.7` / `run "npm install ..."`
lines: they are a nag, not an error. **Do not act on them** (§5).
(Dry-run of Steps 1–10 on a copy, 2026-09-24: `tsc` exit 0, `ℹ pass 19`, both scripts `SYNTAX_OK`.)

### Step 9: `scratch/check_all_tabs.js`

9a. Add a `read()` helper. Before (the end of `view`):
```js
        await wait(2500); // async store feeding
        return JSON.parse(await win.evaluate(VIEW));
    } finally {
        win.close();
    }
}
```
After:
```js
        await wait(2500); // async store feeding
        return JSON.parse(await win.evaluate(VIEW));
    } finally {
        win.close();
    }
}

/** Re-read the current Big Picture page without navigating (polling, guardrail 15). */
async function read() {
    const win = await connect(BPM);
    try {
        return JSON.parse(await win.evaluate(VIEW));
    } finally {
        win.close();
    }
}
```

9b. Poll Your Stuff. Before:
```js
    const stuff = await view(shared, `/library/app/${A}/tab/YourStuff`, 'Media');
    ok('3. Your Stuff: media items', stuff.media > 0, stuff.media);
```
After:
```js
    let stuff = await view(shared, `/library/app/${A}/tab/YourStuff`, 'Media');
    // Steam loads the media list asynchronously (slow on the first view after a
    // mode switch): poll the page for up to 10 s instead of a fixed wait.
    for (let i = 0; i < 20 && !(stuff.media > 0); i++) {
        await wait(500);
        stuff = await read();
    }
    ok('3. Your Stuff: media items', stuff.media > 0, stuff.media);
```

9c. Restore check 4 (undo the weakening). Before:
```js
    const bucket = await shared.evaluate(`PLUGIN_LIST['steam-cartridges-dev'].bucketReport().games[${A}]?.bucket ?? 'none'`);
    if (bucket === 'web-scraping' || bucket === 'steam-store') {
        console.log(`INFO  check 4 branch: ${bucket} (expect enrichment)`);
        ok('4. Game Info: description, developer, release date', !!info.description && info.developer && info.releaseDate, info.description);
        ok('4. Game Info: no grey shortcut warning', !info.shortcutWarning);
    } else {
        console.log('INFO  check 4 branch: none (grey shortcut warning accepted)');
    }
```
After:
```js
    // ADR-0035: local Game Info shows in every bucket, including none. AM2R has a
    // local metadata entry on this machine, so enrichment is always expected.
    const bucket = await shared.evaluate(`PLUGIN_LIST['steam-cartridges-dev'].bucketReport().games[${A}]?.bucket ?? 'none'`);
    console.log(`INFO  check 4 bucket: ${bucket} (enrichment expected in every bucket)`);
    ok('4. Game Info: description, developer, release date', !!info.description && info.developer && info.releaseDate, info.description);
    ok('4. Game Info: no grey shortcut warning', !info.shortcutWarning);
```

Run: `cd /c/game/millennium && node --check scratch/check_all_tabs.js && echo SYNTAX_OK` → `SYNTAX_OK`.

### Step 10: `scratch/test_nav_cycle.js`

10a. In `visit`. Before:
```js
        // Wait for the page to show the game, then give async store feeding a moment.
        for (let i = 0; i < 30; i++) {
            if (await win.evaluate(`document.body.innerText.includes(${JSON.stringify(expectText)})`)) break;
            await wait(500);
        }
        await wait(3000);
        const metrics = JSON.parse(await win.evaluate(METRICS));
```
After:
```js
        // Wait for the page to show the game.
        for (let i = 0; i < 30; i++) {
            if (await win.evaluate(`document.body.innerText.includes(${JSON.stringify(expectText)})`)) break;
            await wait(500);
        }
        // Then poll (max 10 s) until the shortcut's data is fed and drawn. storeDays is
        // what the plugin feeds (appActivityStore). The DOM reveals days one at a time
        // (nDaysToDisplay), so DOM day counts are never compared (guardrail 15).
        let metrics;
        for (let i = 0; i < 20; i++) {
            metrics = JSON.parse(await win.evaluate(METRICS));
            metrics.storeDays = await shared.evaluate(`appActivityStore.m_mapAppActivity.get(${appid})?.appActivityByDay?.length ?? 0`);
            if (appid !== A) break;
            if (metrics.postGameSummary && metrics.mediaCount > 0 && metrics.storeDays > 0 && metrics.activityDays > 0) break;
            await wait(500);
        }
```

10b. Assertions. Before:
```js
    ok('A: activity day sections with captures (hasEvent)', first.activityDays > 0 && first.loopbackImages > 0);
    ok('A (return visit): Post-Game Summary still present', second.postGameSummary);
    ok('A (return visit): same media count', second.mediaCount === first.mediaCount);
    ok('A (return visit): same activity days, captures still shown', second.activityDays === first.activityDays && second.loopbackImages > 0);
```
After:
```js
    ok('A: activity day sections with captures (hasEvent)', first.activityDays > 0 && first.storeDays > 0 && first.loopbackImages > 0);
    ok('A (return visit): Post-Game Summary still present', second.postGameSummary);
    ok('A (return visit): same media count', second.mediaCount === first.mediaCount);
    ok('A (return visit): same activity days in the store, captures still shown', second.storeDays === first.storeDays && second.activityDays > 0 && second.loopbackImages > 0);
```

Run: `cd /c/game/millennium && node --check scratch/test_nav_cycle.js && echo SYNTAX_OK` → `SYNTAX_OK`.

### Step 11: docs

11a. `CHANGELOG.md`: insert this as the first bullet under `## [Unreleased]`:
```
- **`steam-cartridges` Game Info regression fixed offline (ADR-0035)**: local `library_metadata.json` Game Info applies to every shortcut that is not steam-store again (`features/game-info/policy.ts` + 4 tests); buckets gate only web/store fetching. `check_all_tabs.js` check 4 restored (it had been weakened) and Your Stuff polled; `test_nav_cycle.js` compares store day counts and polls. Live verification pending.
```

11b. `TASK.md` § Active Failures & Blockers. Replace the line starting `- FLAKY: nav_cycle run 3:` with:
```
- FIXED OFFLINE (plan docs/plans/steam-cartridges-regression-bugfix.md): AM2R Game Info (ADR-0035) and the two test flakes. Live verification pending (plan §7).
```

### Step 12: commit (do not push unless the caller said so)

```bash
cd /c/game/millennium && git add steam-cartridges/frontend/features/game-info/policy.ts steam-cartridges/tests/game-info-policy.test.ts steam-cartridges/frontend/features/game-info/index.ts steam-cartridges/frontend/features/source-view.ts steam-cartridges/frontend/settings/settings-panel.tsx scratch/check_all_tabs.js scratch/test_nav_cycle.js CHANGELOG.md TASK.md && git status --porcelain
```
Expected: only `M ` / `A ` lines for exactly those 9 paths. Anything else: stop.

```bash
cd /c/game/millennium && git commit -m "fix(steam-cartridges): local Game Info for every non-store shortcut (ADR-0035); poll-based nav/tab checks" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## 4. Do not touch

- `steam-cartridges/frontend/steam/**` (activity, summary, sections, stores, jsx-hook, gamepad-appid, headline/activity-cards patches)
- `steam-cartridges/frontend/renderers/**`
- `steam-cartridges/frontend/features/game-info/game-info-patch.ts` and `metadata.ts`
- `steam-cartridges/frontend/features/buckets/**`, `features/steam-store/**`, `settings/settings.ts`
- `steam-cartridges/backend/**`, `plugin.json`, `dev.ps1`, `package.json`, `tsconfig.json`
- `docs/decisions.md`, `docs/plugins.md` guardrails, any other test file
- Anything under `C:\game\steam\` (plugins, config, `library_metadata.json`, userdata)

## 5. Banned actions

- No deploy or restart: no `dev.ps1`, `start-steam-dev.ps1`, `steam.exe`.
- No SharedJSContext reload, no CDP writes, no probe or throwaway plugins.
- No edits to Millennium `config.json` or plugin config (`setSetting`, `PluginConfig_*`).
- No changes to the user's library, collections, shortcuts or artwork.
- No `git push --force`, `--no-verify`, `git add -A`, amend, or rebase.
- Do not change any assertion or expected value in this plan to make a step pass.
- No `npm install`, `npm update` or dependency/version change (even when a tool suggests it); no edits outside the files in §3.

## 6. Failure rule

Run any failing command at most **twice**. After the second failure, stop. Do not edit
code to work around it, and do not continue to later steps. Append the following to
`TASK.md` § Active Failures & Blockers:
```
- BLOCKED regression-bugfix step <N>: `<command>` failed twice:
  <first 30 lines of output>
```
Then commit only `TASK.md` (message `docs(task): regression-bugfix blocked at step <N>`,
with the attribution line) and exit.

## 7. Live verification (user or verifier, after the user deploys with `dev.ps1`)

Not for the implementer. After a graceful restart:

1. Desktop: `node scratch/test_nav_cycle.js`, 5 runs. All 6 lines `PASS` on every run.
2. Big Picture (start with `start-steam-dev.ps1 -BigPicture`, not a mode toggle): `node scratch/check_all_tabs.js`.
   Every line `PASS`, including `4. Game Info: description, developer, release date` and
   `4. Game Info: no grey shortcut warning`, with `INFO  check 4 bucket: none`.
3. SharedJSContext: `appDetailsStore.GetAppData(4263274102).descriptionsData.strSnippet` is non-empty.
   `webhelper_js.txt` shows no `Fetching Game Info & Metadata` line for a `none` game (no network).
4. Routine 1 by eye on AM2R: Summary, Activity, Your Stuff (item count), Game Info (no grey box).

## 8. Guardrail checklist (re-read each in docs/plugins.md; tick with one line of proof)

- [ ] **1 ID coupling:** more shortcuts now get `BIsModOrShortcut() === false`. `enrichGameDetails` still calls
      `ensureAppOverviewHooked` (metadata.ts, unchanged), which hooks `GetGameID` → `m_gameid`;
      `sections.ts isShortcut` still checks `appid >= 0x8000_0000` (unchanged).
- [ ] **2 O(1) hooks:** no prototype hook or jsx handler changed.
- [ ] **3 single-pass:** no `req.m` scan added.
- [ ] **4 multi-tab:** covered by §7 (not run by the implementer).
- [ ] **5 stubs/negative cache:** `activity.ts` untouched.
- [ ] **6 two-way nav:** `test_nav_cycle.js` still does A → B → A; the return is compared on store days.
- [ ] **7 categories:** category purge in `enrichGameDetails` unchanged.
- [ ] **8 details:** no `appData.details` write added.
- [ ] **11 re-render:** `refreshGameInfoInstances` unchanged and still called by enrich/revert.
- [ ] **13 MobX computed:** no new `collectionStore` read; `getBucket` gates on `collectionsReady()` before any membership read; `waitForCollections` remains only in `source-view.ts`.
- [ ] **14 gates:** `none`/`pending` now apply local data; only fetching is gated.
- [ ] **15 checks:** check 4 is stricter than before (restored); waits replaced by polling, no assertion loosened.
