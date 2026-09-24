# steam-cartridges: "An error occurred while rendering this content" (Game Info, every app)

Status: root cause captured live 2026-09-24 (Big Picture, `steam-cartridges-dev`). Fix not yet implemented.

## 1. Root cause

`features/buckets/collections.ts` `waitForCollections()` reads
`collectionStore.userCollections` at plugin init, before Steam has loaded
collections from cloud storage. That read poisons a Steam MobX computed for the
whole session:

1. `userCollections` is a MobX **`keepAlive`** computed on `collectionStore`. Its
   first statement is `Array.from(this.collectionsFromStorage.values())`, and
   `collectionsFromStorage` returns the plain field `m_mapCollectionsFromStorage`.
   Steam creates that field lazily, in `OnCloudStorageChanged`.
2. `initGameInfo()` → `waitForCollections()` runs before that callback, so the
   getter throws `TypeError: Cannot read properties of undefined (reading 'values')`.
3. MobX stores the error as a `CaughtException` in the computed's `value_`. The
   getter threw before it read any observable, so the computed tracks **no
   dependencies** (`observing_ = []`) and is marked `UP_TO_DATE` (`dependenciesState_ = 0`).
   Because it is keepAlive, MobX never recomputes it. Every later read rethrows
   the same error object, with our original stack.
4. Steam's own UI reads `userCollections`. Game Info renders `CollectionsHeader`
   (steam-components.md, around line 906), and the desktop app page also reads it.
   Those reads throw into Steam's error boundary. Millennium's ErrorBoundaryHook
   blames `steam-cartridges-dev` because the stack contains our bundle.

This is a regression from **P2**, commit `123eb2b`, which added the bucket
engine and `waitForCollections`. It does not come from the Game Info merge. The
pre-merge code never read `collectionStore.userCollections`.

### Evidence

- `C:\game\steam\logs\webhelper_js.txt`, 20:44:46: `Could not preload library metadata cache: TypeError: Cannot read properties of undefined (reading 'values')`.
  After that, every render logs the same error: 20:44:51, 20:44:57, 20:45:15, 20:45:33, 20:45:58, and so on. Each one is followed by `ErrorBoundaryHook Caught an error`.
- A CDP capture in SharedJSContext while navigating to `/library/app/4263274102/tab/GameInfo` got this error:
  ```
  TypeError: Cannot read properties of undefined (reading 'values')
    at get userCollections (chunk~2dcc5aaf7.js:1:10479505)
    at st / computeValue_ / trackAndCompute / get (mobx)
    at waitForCollections (steam-cartridges-dev/.millennium/Dist/index.js:2846)
    at initGameInfo (…/index.js:3010)
  ```
  The stack still points at init, minutes after init ran. So a cached exception is being rethrown.
- MobX admin state for `collectionStore.userCollections`: `keepAlive_: true`, `observers_: 0`,
  `dependenciesState_: 0`, `observing_: []`, `value_.cause = TypeError …'values'`. It is the only
  poisoned computed. The others are either healthy or never computed (`-1`). `m_mapCollectionsFromStorage`
  now exists as an ObservableMap with 21 entries, but the computed never sees that change.
- The **native** game `435150` Game Info tab also shows the error boundary. So the failure is not
  specific to shortcuts, and it is not caused by the Steam Store view, the store-item shape, or the jsx hook.
- `scratch/check_all_tabs.js` rerun: Post-Game Summary, Activity, Your Stuff and A→B→A all PASS (captured 1 = 1).
  Check 4 FAILS: Game Info shows the error boundary. The earlier A→B→A FAIL is a timing-sensitive
  equality check (2.5 s fixed wait). It passed on the rerun, so treat it as flaky, not as a second bug.

### Ruled out

- `initGameInfo` not awaited: it is intentional (ADR-0010). It only decides *when* the poisoning read happens.
- `game-info-patch.ts`: only 6 lines changed since `steamgriddb-artwork`. The same patch worked before the merge.
- The Steam Store view and the `StoreItemCache` field names: no store bucket is configured (no `buckets`
  key in plugin config), so `handleSteamStoreView` never runs. Those fields are still unverified.
- Duplicate `onPopupCreate`/`watchGamepadAppid` wiring in `index.tsx` and `source-view.ts`: the `inflight`
  guard covers it, and it is not in any failing stack. It is a cleanup item only.

### Secondary finding (test expectation, not a code bug)

No buckets are configured, so AM2R resolves to `none`. Under ADR-0033 a `none` game gets **no** web
enrichment. That means check 4 ("description, developer, release date") cannot pass for AM2R even after
the crash is fixed, and the grey shortcut warning is the *expected* state. `check_all_tabs.js` predates P2
and must become bucket-aware (see step 6).

## 2. Fix (for @implementer)

Rule: **never read a Steam MobX computed before the data it derives from exists.** A keepAlive computed
that throws before it tracks anything caches the error for the whole session.

### Step 1: `steam-cartridges/frontend/features/buckets/ready.ts` (new, pure, no imports)

```ts
/** Plain-field read, no MobX side effects. Steam creates m_mapCollectionsFromStorage on its first
 *  cloud-storage callback; before that, reading userCollections / uncategorizedCollection throws
 *  inside a keepAlive computed and poisons it for the session (see plan). */
export function isCollectionStoreReady(store: any): boolean {
    const m = store?.m_mapCollectionsFromStorage;
    return !!m && typeof m.values === 'function';
}
/** userCollections only when ready; never throws. */
export function readUserCollections(store: any): any[] | undefined {
    if (!isCollectionStoreReady(store)) return undefined;
    try {
        const list = store.userCollections;
        return Array.isArray(list) ? list : undefined;
    } catch {
        return undefined;
    }
}
```

### Step 2: `features/buckets/collections.ts`

- `store()`: return `undefined` until `isCollectionStoreReady(s)`. Use `readUserCollections` and never read
  `s.userCollections` directly. Keep the warning one-shot, but make it say "not ready yet" and do not set
  `warned` permanently for the not-ready case.
- `waitForCollections(timeoutMs = 30_000)`: poll `isCollectionStoreReady(window.collectionStore)` only. After it
  is ready, return `readUserCollections(...) !== undefined`. Do **not** keep the `userCollections?.length` probe.
- `listCollections()` and `membersOf()`: go through `readUserCollections`. Do not cache a miss while the store
  is not ready.
- Export `collectionsReady()` = `isCollectionStoreReady(window.collectionStore)`.
- Keep this file as the only place that touches `collectionStore` (library-home's `OnAppOverviewChange` hook is unrelated).

### Step 3: `features/buckets/resolve.ts` and `index.ts`

- Add `'pending'` to `Resolution['via']`.
- `getBucket(appid)`: if `setting('buckets')` has assignments and `!collectionsReady()`, return
  `{ bucket: 'none', via: 'pending' }`. Otherwise keep the current behaviour. Overrides still resolve
  immediately, because they do not need collections, so check overrides first.
- `bucketReport()`: report `ready: boolean`. When it is not ready, return empty `collections`/`conflicts`
  and do not compute `missing`, so the panel does not show every assignment as "missing".

### Step 4: `features/source-view.ts`

- In `onSourceView`: if `getBucket(appid).via === 'pending'`, do nothing. Do not revert and do not call
  `leaveSteamStore`. Remember the appid in a `deferred` set.
- In `initSourceView`: `void waitForCollections().then(() => deferred.forEach((a) => void onSourceView(a)))`.

### Step 5: `features/game-info/index.ts`

- Preload: keep the flow, which is now safe. The try/catch stays. Skip `handleWebScrapingView`'s revert branch
  when `via === 'pending'`.
- `onBucketsChanged` handler: return early if `!collectionsReady()`. Keep `invalidateMembership()` first.

### Step 6: `scratch/check_all_tabs.js` (verification script)

- Add a check for any view: FAIL if the text contains `An error occurred while rendering this content`. Apply it
  to the A, B, and A GameInfo views.
- Add a Game Info check for native B (`/library/app/${B}/tab/GameInfo`): no error boundary.
- Add a SharedJSContext health probe:
  `(() => { try { return Array.isArray(collectionStore.userCollections) } catch { return false } })()` must be `true`.
- Make check 4 bucket-aware. Read `PLUGIN_LIST['steam-cartridges-dev'].bucketReport().games[A].bucket`.
  If the bucket is `web-scraping` or `steam-store`, expect description, developer and release date. If it is
  `none`, expect no error boundary and accept the grey shortcut warning. Print which branch ran.
- Replace A→B→A's fixed `wait(2500)` + `captured ===` with a poll of up to 10 s for `captured >= 1` and equality.

### Step 7: docs

- `docs/steam-components.md` § Collections, "Readiness" bullet (around line 1405). Replace
  "Wait on `collectionStore?.userCollections?.length > 0`" with: "Wait on `collectionStore.m_mapCollectionsFromStorage`
  (a plain field, created in the first `OnCloudStorageChanged`). Never read `userCollections` or any other
  collectionStore computed before then. They are MobX keepAlive computeds, and a throw before they track anything
  poisons them for the session, which breaks Steam's `CollectionsHeader` for every app."
- `docs/plugins.md` guardrails: add **13. Never read a Steam MobX computed before its source exists**, with the
  mechanism above and the symptom ("An error occurred while rendering this content" on unrelated pages, and a
  stack pointing at plugin init).
- `docs/steam-debug.md` § 7 or traps: to diagnose, read the computed's admin
  (`obj[Symbol(mobx administration)].values_.get(name)`: `value_.cause`, `observing_`, `dependenciesState_`).
  A poisoned session only recovers after a Steam restart.
- CHANGELOG entry. Clear the TASK "Active Failures" entry once verified.

## 3. Tests to add

- `steam-cartridges/tests/buckets-ready.test.ts` (node `--experimental-strip-types`, pure):
  - A fake store whose `userCollections` getter counts reads and throws when `m_mapCollectionsFromStorage` is
    undefined. `isCollectionStoreReady` is false, and `readUserCollections` returns `undefined` with **0 getter reads**.
  - After `m_mapCollectionsFromStorage = new Map()` and a working getter: ready is true, and the list is returned.
  - A getter that throws while ready: `readUserCollections` returns `undefined` and does not throw.
- `tests/buckets.test.ts`: `resolveBucket` still returns `default` for an undefined `membersOf` (unchanged).
  Add a case for the `pending` resolution if the logic sits in a pure helper. If not, cover it in the ready test by
  extracting `pendingOr(resolve)` into `ready.ts`.
- A live regression lives in `scratch/check_all_tabs.js` (step 6). It needs to be the probe, not a unit test,
  because the poisoning only reproduces against Steam's real MobX at startup.

## 4. Re-verify

The current Steam session stays poisoned until Steam restarts. Deploy with a restart:
`cd steam-cartridges; npm run check; npm test; npm run build; powershell -ExecutionPolicy Bypass -File dev.ps1`.

1. Log: no `Could not preload library metadata cache` line, and no `reading 'values'` in
   `C:\game\steam\logs\webhelper_js.txt` after the restart.
2. Big Picture: `node scratch/check_all_tabs.js`. All checks pass, including the new error-boundary check, the
   native-B Game Info check and the collectionStore health probe. Check 4 runs its `none` branch for AM2R.
3. Web-scraping branch: `PLUGIN_LIST['steam-cartridges-dev'].setSetting('buckets', { overrides: { "4263274102": "web-scraping" } })`,
   then rerun `check_all_tabs.js`. Check 4 must show description, developer and release date. Afterwards run
   `resetSettings()`, which is plugin config only. Do not touch the user's collections.
4. Desktop (switch UI mode through a Steam restart, not by toggling; steam-debug.md Trap 6):
   `node scratch/test_nav_cycle.js` must be `hasEvent: true` on every visit, with no error boundary.
5. P2 live: `node tests/buckets.mjs` (fixture collections), then the P3 checks from TASK.md.
