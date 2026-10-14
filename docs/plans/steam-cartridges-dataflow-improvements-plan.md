# steam-cartridges data flow improvements: audit and plan

**Status (2026-10-06):** Phases 0-4 implemented, deployed and live-verified ([ADR-0060](../decisions.md)); § 9 records
what was built, what differs from the design below and the live numbers. Phase 5 (research) and the `achievements.json`
split are not started.
**Scope:** the path from "a non-Steam shortcut exists in the library" to "its page shows Game Info, achievements and
community content", plus the start-up and background jobs that share that path.
**Goal:** a page's own data (Game Info, achievements) never waits behind slower or background work. Community content
may arrive later but must not hold anything else up. No change to the hexagon (sensor -> app -> port -> service ->
record -> surface; only surfaces write to Steam).

This doc was written as an **audit plus a phased design**; the user asked for the fixes to be implemented directly,
so § 9 is the execution record instead of mechanical before/after steps.

---

## 1. The constraint everything follows from

**Millennium's Lua host runs one RPC at a time, and every download in it blocks** (WinINet FFI, `rpc_client::run`):
proved in the community crash investigation (`git show 6ece444:docs/plans/steam-cartridges-community-crash-and-speed-investigation.md`) § H4 and
recorded in [ADR-0051](../decisions.md). Parallel frontend calls only queue up behind each other (measured: 3-at-a-time
images 30.6 s, serial 10.1 s).

So "async" here cannot mean "run in parallel in the backend". It means:

1. **Order:** what the user is looking at goes first.
2. **Short units:** no single call holds the host for long while something urgent waits.
3. **Paint from disk first:** show what is already stored, then refresh it.
4. **Never repeat work that already failed or found nothing.**

Do not re-introduce parallel backend calls (TASK.md, ADR-0051).

---

## 2. How data flows today

```
Steam start
 ├─ index.tsx init: controller.load (x2), routing profiles (x2), media.pruneCache, libraryStats.load,
 │   metadata.preload -> GetAllRecords, achievements.preload -> GetAllRecords (again),
 │   storeSync.run + repair (then every 60 s), ingest.triggerSync(3000)
 │
 ├─ ingest (background): for each new shortcut, or one missing metadata/achievements:
 │     EnsureFresh(["identity"]) -> EnsureFresh(["metadata","achievements"]) -> MarkKnown -> 300 ms pause
 │
 └─ a shortcut's page opens (sensors/view -> shortcut.viewed -> app/view.onSourceView), strictly in order:
       await store.ensure        EnsureFresh(["store"])
       await identity.ensure     EnsureFresh(["identity"])            (steam-store bucket only)
       await metadata.ensure     EnsureFresh(["metadata"])            -> Game Info
       await artwork.ensure      EnsureFresh(["artwork"]) + browser image fetches + SteamStoreSaveIcon
       void  media.ensure        EnsureFresh(["media"]) then GetMediaImage x N, one at a time
       void  achievements.ensure EnsureFresh(["achievements"])        -> achievements
```

Every call above, from every caller, goes through **one global FIFO** in
[ports/transport.ts:30](../../steam-cartridges/frontend/ports/transport.ts#L30) (`callQueue`): no priority, no
cancellation, no timing.

---

## 3. Findings: why achievements are late

Ranked by expected impact. "Evidence" is file:line at `eb567aa` plus the working tree of 2026-10-06.

### B1. Achievements are enqueued last on every view (high)

[app/view.ts:58-72](../../steam-cartridges/frontend/app/view.ts#L58-L72): `achievements.ensure` is only started after
`store`, `identity`, `metadata` and `artwork` have all **resolved**, and after `media.ensure` has already put its
`EnsureFresh(["media"])` into the queue (line 65 runs before line 66). Achievements depend only on `store` and
`identity` (the backend reads both from ctx or disk, [record_rpc.lua:95-118](../../steam-cartridges/backend/record_rpc.lua#L95-L118)),
not on metadata, artwork or media.

So the achievements call waits for:
- metadata: on a stale or first visit, IGDB and/or ScreenScraper `jeuInfos` (network);
- artwork: SteamGridDB lookup (network), the slot image downloads in the browser, then `SteamStoreSaveIcon`;
- media: IGDB media and ScreenScraper `jeuInfos` (network, first visit or 7 days stale).

On a first visit, all of that is several seconds of network before the achievements call even starts.

### B2. One FIFO queue with no priority (high)

[ports/transport.ts:4-37](../../steam-cartridges/frontend/ports/transport.ts#L4-L37). A view's call waits behind
whatever was queued before it: the ingest call in flight, the 60 s store-sync tick (`StoreInstalledGames`,
`StoreXboxRepairs`), observer polls, the previous game's media images, start-up preloads. The Lua host cannot be
interrupted, so the worst case is "the longest call already running" plus everything queued ahead of it.

### B3. The in-game observer piles calls into the queue (high while a game runs)

[app/achievements.ts:191](../../steam-cartridges/frontend/app/achievements.ts#L191) uses `setInterval(checkNow, 2000)`.
It does not wait for the last check to finish, so when the host is busy (an ingest or media call), a new
`CheckUnlocks` joins the queue every 2 s (10 queued after a 20 s stall), and each one runs before any later view call.
On the backend, when the shortcut has no stored schema, every poll runs a **full source resolve**
([achievements_observer.lua:473](../../steam-cartridges/backend/achievements_observer.lua#L473): `ach_service._resolve`,
which for RetroAchievements means hashing and network), every 2 s.

### B4. Failed or empty achievements are re-resolved on every request (high for RA misses)

[record_rpc.lua:102-118](../../steam-cartridges/backend/record_rpc.lua#L102-L118): the TTL check only runs `if cached`.
A shortcut with no stored schema (RA found nothing, an error, or a PC game with no source) has no cached part, so
**every** `EnsureFresh(["achievements"])` resolves from scratch: on every view, every ingest run, and every observer
poll (B3). Identity, artwork and media each have a 30 min `recent_error` memo in the same function; achievements has
none. `fresh_policy.touch` records the time but not the status, so "unsupported for 24 h" (`TTL.unsupported`) cannot
be answered from disk.

### B5. The first RetroAchievements resolve is long and blocks the host (high, first visit and every Steam start)

[retroachievements.lua:1235-1338](../../steam-cartridges/backend/retroachievements.lua#L1235-L1338), all in one RPC:
1. parse the whole `shortcuts.vdf` (its own copy of the parse; see B8);
2. read the emulator credentials;
3. **spawn `node ra_hasher.js`** and wait up to **5 s** ([silent_exec.lua:122](../../steam-cartridges/backend/silent_exec.lua#L122));
4. `dorequest.php?r=gameid` (network, 10 s timeout);
5. `API_GetGameInfoAndUserProgress` or the legacy `patch` + `unlocks` endpoints (network, 10 s timeout each);
6. on a miss, the per-console `gameslist` download (memory cache only) and title matching;
7. rewrite the whole `achievements.json` (2.6 MB, ADR-0059).

The ROM MD5 cache is **memory only** ([retroachievements.lua:659](../../steam-cartridges/backend/retroachievements.lua#L659)),
and so is md5 -> GameID. Every Steam start hashes again (TASK.md already lists "persistent ROM MD5 caching" as next).
A good point: once a valid schema is stored, `get_or_fetch` returns it from disk at step 1, so a 24 h refresh of a
found game is cheap. The cost is concentrated in first resolves and misses (B4).

### B6. Ingest runs whole multi-part calls in the same queue, and re-selects the same games every start (medium-high)

- [app/ingest.ts:194](../../steam-cartridges/frontend/app/ingest.ts#L194): one `EnsureFresh(["metadata","achievements"])`
  per shortcut. It is one host call that holds IGDB/ScreenScraper **and** the RA resolve (B5) back to back. A view
  that arrives meanwhile waits for all of it.
- [index.tsx:321-329](../../steam-cartridges/frontend/index.tsx#L321-L329) `needsFetch`: a shortcut counts as
  "missing achievements" unless its record has `schema.total > 0` or `source === "none"`. A PC game with no source
  (`unsupported`) and an RA miss are never satisfied, so **every Steam start** sends all of them through ingest again,
  each paying B4 + B5. `fetchedInSession` only stops repeats within a session.
- Race: `needsFetch` reads the frontend records 3 s after init ([index.tsx:670](../../steam-cartridges/frontend/index.tsx#L670)),
  but the records are filled by `metadata.preload` and `achievements.preload`, which are queued behind other start-up
  calls. If preload has not landed, every shortcut looks missing. `ingest.ready()` waits for routing, not for preload.
- `achievements.preload` skips parts whose status is not `ok` (so `none` never reaches the record), which makes
  `needsFetch`'s `source === "none"` check dead at start-up.

### B7. Start-up does duplicate work in the queue (medium)

- `GetAllRecords` is called twice: `metadata.preload` ([app/metadata.ts](../../steam-cartridges/frontend/app/metadata.ts))
  and `achievements.preload` ([app/achievements.ts](../../steam-cartridges/frontend/app/achievements.ts)). Each builds
  every stored metadata record **and every stored achievement schema** (megabytes of JSON across IPC).
- `controller.load()` runs twice ([index.tsx:175](../../steam-cartridges/frontend/index.tsx#L175) and
  [index.tsx:603](../../steam-cartridges/frontend/index.tsx#L603)), each parsing `shortcuts.vdf` and probing emulators.
- Auto-routing profiles load twice (the game-info block and `ingest.ready`).
- `achievements.preload` sits behind `await libraryStats.load()` and `await libraryHomeReady()`
  ([index.tsx:616-631](../../steam-cartridges/frontend/index.tsx#L616-L631)), so stored achievements reach Steam's
  stores only after the library grid is ready.

### B8. Backend hot paths re-read files on every call (low; corrected during implementation)

- ~~`registry.shortcut` parses the whole `shortcuts.vdf` on every call~~. **Wrong:** `shortcuts.parse` already caches
  the parsed list by the file's mtime (`shortcuts.lua`, `fs.last_write_time`); each lookup only rebuilds a ~230-entry
  map. No change made.
- `achievements_store` rewrites the whole `achievements.json` (2.6 MB) on every write, including each observer unlock
  (`store.unlock`) and `get_state` with a new native.
- `fresh_policy.touch` rewrites `freshness.json` on every touch (small; low cost).

### B9. Media's first call is in front of achievements (medium; resolved by B1's fix)

Media's `EnsureFresh` (network on first visit) is queued before achievements (B1). Its per-image loop already stops
when the view moves away ([app/media.ts:250](../../steam-cartridges/frontend/app/media.ts#L250)), and the images
interleave with later calls because each is a separate call. Community content is allowed to be slow; it must simply
be queued **after** achievements and in a lower lane than view calls.

---

## 4. Findings: what makes Game Info (custom or fetched metadata) slow to show

| # | Blocker | Evidence | Effect |
| --- | --- | --- | --- |
| G1 | Start-up Game Info preload is gated behind `controller.load()` and the routing profiles | [index.tsx:601-612](../../steam-cartridges/frontend/index.tsx#L601-L612): `await Promise.all([controller.load(), loadAutoRoutingProfiles()])` before `metadata.preload()` | Stored Game Info (including manual edits) reaches the record only after two RPCs and everything queued ahead of them. The controller badge is already re-derived by `onLoaded -> metadata.rebadge`, so the gate is not needed for correctness |
| G2 | Metadata on a view waits for `store` and `identity` | [app/view.ts:58-63](../../steam-cartridges/frontend/app/view.ts#L58-L63) | First visit: the store's API name lookup and the Steam Store search run before the Game Info call. A custom edit never needs either (`custom_override` short-circuits, [metadata_service.lua:270-273](../../steam-cartridges/backend/metadata_service.lua#L270-L273)) |
| G3 | A stale record (24 h) is refreshed **inline** | [metadata_service.lua:319-330](../../steam-cartridges/backend/metadata_service.lua#L319-L330) | The stored record is not returned first; the view waits for IGDB/ScreenScraper. Preload hides this when it landed first; otherwise the page shows Steam's grey shortcut panel until the network answers |
| G4 | A Steam match with no `StoreItemCache` item calls `appdetails` on every view | [metadata_service.lua:286-295](../../steam-cartridges/backend/metadata_service.lua#L286-L295) | Network on every view of that game; nothing is cached |
| G5 | Collections not ready (`via: "pending"`) | [app/view.ts:50-55](../../steam-cartridges/frontend/app/view.ts#L50-L55) | Local-only Game Info, then a full replay when collections load. Correct, but the replay re-queues the whole pipeline |
| G6 | Everything in B2/B6/B7 | | Any queued background call delays the Game Info call too |

---

## 5. Design: what changes and where (hexagon kept)

| Change | Layer that owns it | Why it belongs there |
| --- | --- | --- |
| Priority lanes in the call queue (mechanism only) | `ports/transport.ts` | The port is the only door to the backend; a queue discipline is transport mechanics, not a decision |
| Which lane each call uses | `app/*` use cases (and `index.tsx` wiring) | Choosing urgency is orchestration; ports must not decide (README layer rules) |
| "Answer from disk, tell me what is stale" | backend `record_rpc.lua` + `fresh_policy.lua` | TTLs already live in `fresh_policy`; the backend owns staleness |
| Paint-then-refresh order on a view | `app/view.ts` | It already owns the view order |
| Negative caches, MD5 cache, vdf memo | backend services/sources | Each service owns its own data |
| No surface, sensor or kernel event changes | — | Surfaces keep reading the record; `record.updated` drives rendering as today |

Needs a new ADR (ADR-0060, "Page data first: priority lanes and paint from disk then refresh"). It does not contradict
ADR-0051: the host stays serial, only the order changes.

### Phase 0: measure (do first; it decides the order of the rest)

1. `ports/transport.ts`: per call, record `name`, lane (once Phase 1 exists), `queuedAt`, `startedAt`, `endedAt`, in a
   ring buffer of the last 200 calls; expose `rpcDiagnostics()` from `index.tsx` (like `communityDiagnostics`).
2. Backend `rpc.lua` `method()`: log RPCs that take more than 500 ms, with name and duration (`datetime.now()`).
3. A live probe `tests/live/probes/dataflow_timing.mjs` (read-only CDP plus navigation, **needs the Steam lock**):
   open game A cold and warm, then a native game, then A again (Routine 2). Print per call wait and run time, and the
   time from `shortcut.viewed` to the `record.updated` carrying `achievements` and the one carrying `metadata`.
   Run it once with ingest idle and once during a forced "Sync now".
4. Record the baseline in this doc's § 7 table. **Exit criterion:** we know the p50 and max for view -> achievements
   and view -> Game Info, and which calls were ahead in the queue.

### Phase 1: priority lanes and polite pollers (frontend only)

- `ports/transport.ts`: `call(name, payload, opts?: { lane?: Lane })`, `type Lane = "view" | "normal" | "media" | "background"`.
  Replace the promise chain with one queue per lane and a single pump that, when the host is free, takes the head of the
  highest non-empty lane. Within a lane, FIFO. Default lane `normal` (no behaviour change for unported callers).
- `ports/backend.ts`: an optional trailing `opts?: CallOptions` on `ensureFresh`, `getMediaImage`, `getManualChunk`,
  `getManualCover`, `checkUnlocks`, `getAllRecords`, `storeInstalledGames`, `storeXboxRepairs`.
- Lane choice (app layer):
  - `view`: the view pipeline's store, identity, metadata and achievements calls (app/view passes it down to the
    resolvers' `ensure`, or the resolvers take a lane argument);
  - `normal`: artwork, Game Data editor, settings actions, observer `CheckUnlocks`;
  - `media`: media `EnsureFresh`, `GetMediaImage`, manual chunks and covers;
  - `background`: ingest, store-sync ticks, start-up preloads after the first paint, `pruneMediaCache`, library stats.
- Observer ([app/achievements.ts:191](../../steam-cartridges/frontend/app/achievements.ts#L191)): replace `setInterval`
  with a self-scheduling `setTimeout` after each `checkNow` settles, so at most one poll is ever queued.
- Tests: transport lane ordering (a `view` call queued after three `background` calls runs right after the call in
  flight); observer never has two checks outstanding; architecture tests unchanged (no new import edges).

Expected: view -> achievements no longer waits for ingest, store-sync or media backlog; the worst case becomes
"the one call already running".

### Phase 2: paint from disk, then refresh (backend + app/view)

- Backend `record_rpc.lua`:
  - `achievements` honours `ctx.noNetwork`: returns `local_part` or `{ status = "pending" }`, never resolves.
  - Every part answered from disk while due adds `result.stale[part] = true` (metadata, achievements, media; artwork
    keeps its session memo). `fresh_policy` stays the only TTL owner.
- `app/view.ts`, new order:
  1. `store.ensure` (cheap local detection; its network name lookup moves to the refresh step when the copy is new);
  2. **one** `EnsureFresh(["metadata","achievements"], { noNetwork: true })` in the `view` lane -> both parts to the
     record (Game Info and achievements paint from disk);
  3. `identity.ensure` (steam-store bucket);
  4. refreshes, each its own call so they interleave: `achievements` (if stale or missing) then `metadata` (if stale or
     missing), `view` lane;
  5. `artwork` (`normal`), then `media` (`media` lane).
- A custom Game Info edit is answered at step 2 and never refreshed (unchanged K15 rule).
- Tests: `app-view.test.ts` order assertions; `test_backend.lua` / `test_freshness.lua` for `noNetwork` and `stale`.

Expected: a page with stored data shows Game Info and achievements after one short disk call; network work happens
afterwards, in short calls.

### Phase 3: remove the backend's repeat work

1. **Achievements negative memo (B4):** in `record_rpc.lua`, the same `recent_error` 30 min memo as artwork/media for
   `error`, and persist the last status per part in `freshness.json` (additive field) so `unsupported` is answered
   from disk for `TTL.unsupported` (24 h). `force` (Sync now, Review "Fetch") bypasses both.
2. **Observer (B3):** `check_unlocks` with no stored schema returns no unlocks instead of `_resolve` on every poll; the
   quit-time `ensure` (already there) loads the schema.
3. **Persistent RA caches (B5):** `rom_hashes.json` keyed by ROM path + size + mtime -> md5, and md5 -> GameID (with a
   7-day negative entry). The node hasher runs once per ROM, ever.
4. ~~**vdf memo (B8)**~~: not needed, the parse is already mtime-cached (see B8).
5. **Optional, separate plan:** split `achievements.json` into schemas (rarely written) and per-shortcut state
   (unlocks, often written) through `migrate.lua`, so an unlock no longer re-encodes 2.6 MB.

### Phase 4: start-up and ingest

1. One shared `GetAllRecords` (a `records.preloadAll()` in `app/records.ts` that both preloads consume), `background`
   lane after the first view, or `view` lane when no view has happened yet.
2. `controller.load()` and the routing profiles once (drop the second calls; keep `onLoaded -> rebadge`).
3. `metadata.preload()` no longer waits for controller and profiles (G1); `achievements.preload()` no longer waits for
   `libraryHomeReady()`.
4. Ingest: `ready()` also awaits the shared preload (fixes the B6 race); `needsFetch` treats `unsupported`, `none`
   and a recent `error` as handled (the backend's status from Phase 3.1 travels in `GetAllRecords`); split the
   combined call into `["metadata"]` and `["achievements"]` calls so each host hold is shorter; all in the
   `background` lane.

### Phase 5: research only, needs its own ADR

A truly asynchronous fetch path: an out-of-process worker (the backend already spawns `node` for `ra_hasher.js`) that
fetches into the disk caches while the Lua host stays free, with the host only reading files. Open questions: node
presence on a user's PC (the published plugin cannot assume it; `ra_hasher.js` already does), credentials handling
(never on a command line or in logs), lifecycle with Steam's shutdown. Do not start before Phases 0-4 are measured.

---

## 6. Do not

- Run backend calls in parallel, or raise `IMAGE_CONCURRENCY` (ADR-0051, the community investigation).
- Make a surface fetch, or let a port decide lanes (README layer rules, `tests/architecture.test.ts`).
- Write identity into records at start-up (knowledgebase Part 7: every record-driven surface would render at once).
- Widen an architecture allowlist to make a phase pass.
- Refresh a `custom` metadata record (K15).

## 7. Measurements

Live, 2026-10-06, after deploy, `node tests/live/probes/dataflow_timing.mjs` (times from the plugin's `shortcut.viewed`;
the view sensor itself reports 0.3-0.8 s after Steam's navigation). No "before" numbers were taken: the old transport
kept no timings.

| Scenario | view -> Game Info and achievements in the record (disk) | longest wait of a view call | calls ahead in queue |
| --- | --- | --- | --- |
| 19XX (RA, metadata due): first view | 11 ms (paint), achievements refresh done +288 ms | 251 ms (achievements behind the metadata refresh) | none |
| 19XX: A -> home -> A | 14 ms per paint (the sensor reported the view 3 times) | 5 ms | none |
| The Lion King (RA, all fresh): first view | 45 ms; no refresh asked | 23 ms | none |
| The Lion King: A -> home -> A | 22 ms | 9 ms | none |
| A view while background calls are queued | covered offline: `tests/transport.test.ts` (a view call runs right after the call in flight) | | |

## 8. Verification per phase

Offline: `npm run check`, `npm run test:ts`, `npm run test:lua` in `steam-cartridges/`. Live (holding the Steam lock,
AGENTS.md Routine 0): `dev.ps1`, `node steam-health.mjs`, `npm run test:live`, AGENTS.md Routines 1-3 (four views,
A -> B -> A), then the Phase 0 probe to fill § 7. A phase is done when its row improves and nothing regresses.

## 9. Execution record (2026-10-06)

Built as designed, with these differences:

- **Refresh order:** Game Info before achievements (the design said achievements first). Game Info is the top of the
  page and its fetch is short; a first RetroAchievements resolve can take many seconds. Both are in the view lane, before
  artwork and media, so achievements no longer wait for artwork or media.
- **Paint calls:** two disk calls (metadata, achievements) through the existing resolvers instead of one combined
  call, so the badge derivation and the "an empty answer never replaces the record" rule stay in one place each. Each
  measured 3-23 ms.
- **Phase 3.4** dropped (B8 was wrong). **Phase 3.5** (`achievements.json` split) not done: needs a migration, its own plan.
- **Phase 4.4:** `needsFetch` was not changed to read the backend's remembered statuses; instead ingest waits for the
  preloads (the race), and the backend answers a remembered `unsupported`/`error` without asking any source, so the
  games ingest re-selects each start now cost one disk read each.
- Found on the way: `tests/test_ach_service.lua` leaked an open file handle (`io.open(...):read()`), so on Windows every
  later `wipe()` silently failed to delete the store file; fixed (closed handles).

Files: `frontend/ports/transport.ts` (lanes, timings), `ports/backend.ts` (`CallOptions`), `kernel/record.ts`
(`Part.stale`), `app/view.ts` (paint, refresh order, `needsRefresh`), `app/achievements.ts` (`noNetwork`, lanes,
self-arming poll), `app/metadata.ts`, `app/identity.ts`, `app/store-copy.ts`, `app/media.ts`, `app/manuals.ts`,
`app/ingest.ts` (one part per call, background), `app/store-sync.ts`, `app/controller.ts`, `app/library-stats.ts`,
`app/routing.ts` (`ensureProfiles`), `app/records.ts` (`sharedRead`), `index.tsx` (wiring, `rpcDiagnostics`);
backend `record_rpc.lua`, `fresh_policy.lua`, `metadata_service.lua`, `achievements_observer.lua`,
`retroachievements.lua`, new `ra_cache.lua`. Tests: `tests/transport.test.ts` (new), `app-view`, `app-achievements`,
`app-ingest`, `test_ach_service.lua`, `test_freshness.lua`; probe `tests/live/probes/dataflow_timing.mjs`.

Verification: `npm run check` clean; `npm run test:ts` 326 pass, 0 fail (was 317); `npm run test:lua` 12/12 suites
ALL PASS; build OK; deployed with `dev.ps1`; `steam-health` PASS; `npm run test:live` 13/13 PASS (navigation cycle and
tabs included, Routines 1-3); the timing probe PASS on two RetroAchievements games.

**Amendment (the user's review, same day):** a stored RetroAchievements game never asked its profile again (a
pre-existing gap: `get_or_fetch` returned the stored copy, whatever the TTL). Now its part comes due after 30 min (first 5 min; raised at the user's request) and the
refresh is one request by GameID, merged into the stored unlocks (`refresh_unlocks`, ADR-0060 amendment), so unlocks
earned on another device show on the next page open.

The `Assertion failed` rejections noted here were later traced to the captures surface's activity-feed entries and
fixed (2026-10-06; CHANGELOG, knowledgebase Part 8).
