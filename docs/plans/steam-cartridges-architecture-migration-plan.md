# Plan: steam-cartridges Architecture Migration (ports & adapters)

**Status:** Accepted 2026-09-28. **M0a through M4.0 are Done** (mechanical; dry-run cumulatively; M0a, M0b-1, the M0c check fix, M2, and every M3.x except M3.8 also live-validated; M3.8 and M4.0 are docs/backend-only, no frontend live check needed). **M3 is complete and the § 5 feature freeze on `steam-cartridges` ends.** **M4a–M9b are Build** (detailed specs an implementer builds, § 0.10). M4–M9 are detailed specs; § 7.0 holds the architect decisions that bind them and the procedure that turns each into `Ready`.
**Kind:** Umbrella plan plus execution manual. § 0 tells the executing agent exactly how to work. § 7 holds every step. M0a–M1 have literal blocks; M2 ships as hash-guarded whole files plus a diff (§ 7.0 D10). Every later step gets the same when its row in § 0.2 is flipped to `Ready`, because earlier steps change the code it edits.
**ADR:** [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) (accepted).
**Tracking:** [TASK.md](../../TASK.md) · **Docs index:** [steam-architecture.md](../steam-architecture.md)

---

## 0. Execution manual (read all of § 0 before touching anything)

### 0.1 How to execute a step

You execute **one step per session**, the first row in § 0.2 whose status is `Ready` or `Build`.
A `Ready` step is packaged: follow this section. A `Build` step is a detailed spec you implement
yourself: follow § 0.10 instead of actions 3 and 6 below. A `Spec` step is **not** for you: stop and
report that it needs an architect. Do exactly this, in order:

1. Read § 0 completely. Then read that step's section in § 7 completely.
2. Run § 0.4 (preconditions). Every expected output must match **exactly**. If
   one does not, apply § 0.8 (failure rule) and stop.
3. Do the step's numbered actions in order. After **each** action, run the command
   it gives and compare the output with the expected output **exactly**.
4. Never do anything the step does not say. Specifically:
   - Do not fix other bugs you notice. Write them in § 12 (known issues) instead.
   - Do not rename, reformat or "clean up" code.
   - Do not add logging.
   - Do not change tests to make them pass.
   - Do not touch files outside the step's file list.
5. Update the docs the step lists (always: `CHANGELOG.md`, `steam-cartridges/CHANGELOG.md`,
   `TASK.md`, the step's layer doc per § 0.6, the § 0.2 status row, and
   [steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers) when a layer doc is created).
6. Commit exactly as § 0.7 says. Push. Stop. Report which step you did and every
   expected output you saw.
7. Do **not** run the live verification (§ 0.5) unless the step says "implementer
   runs live verification". Otherwise, write in your report: "Live verification
   pending: § 0.5 for step <id>".

If an instruction here conflicts with anything you remember from elsewhere, this
plan wins. If it conflicts with an ADR or a [plugins.md](../plugins.md) guardrail,
stop and report the conflict. Do not choose.

### 0.2 Status board

Statuses (what the executing agent does with the row):

| Status | Meaning | Who acts |
| --- | --- | --- |
| `Ready` | packaged and dry-run: apply the blocks or the package, check every expected output | implementer, § 0.1 |
| `Build` | detailed spec with binding contracts and named tests; the code is not written yet | implementer, § 0.10 |
| `Spec` | not detailed enough to implement (open decisions or investigation) | architect only; an implementer stops |
| `Done` | executed and verified | — |
| `Blocked (<why>)` | waiting on the named thing | whoever it names |

| Step | What | Status | Layer doc |
| --- | --- | --- | --- |
| M0a | Fix the render feedback loop (Properties hang) | **Done** | — (findings already in knowledgebase, steam-components, steam-debug, plugins.md guardrail 17) |
| M0b-1 | Kill switches, error budget, boot sentinel / safe mode | **Done** | `docs/steam-cartridges/safety.md` |
| M0b-2 | Fail-open wrappers on every Steam hook | **Folded into M3** (§ 7.0 D6) | `docs/steam-cartridges/safety.md` (update) |
| M0c | Architecture test (import ratchet, RPC registration) + `check_all_tabs.js` flake fix | **Done** | `docs/steam-cartridges/README.md` |
| M1 | Kernel (`ShortcutId`, events, `GameRecord`, `Surface`) | **Done** | `docs/steam-cartridges/kernel.md` |
| M2 | Sensors (view, lifecycle, collections; owned apps moves to M4) | **Done** | `docs/steam-cartridges/sensors.md` |
| M3.0 | Purge dead frontend code (D13) | **Done** | — (the CHANGELOG line lists what went) |
| M3.1 | Surface `sections` (also creates the `SurfaceRunner` wiring) | **Done** | `docs/steam-cartridges/surfaces.md` (created) |
| M3.2 | Surface `captures` | **Done** | `surfaces.md` § captures |
| M3.3 | Surface `game-info` | **Done** | `surfaces.md` § game-info |
| M3.4 | Surface `playbar` | **Done** | `surfaces.md` § playbar |
| M3.5 | Surface `achievements` | **Done** | `surfaces.md` § achievements |
| M3.6 | Surface `toasts` | **Done** | `surfaces.md` § toasts |
| M3.7 | Surface `native-links` | **Done** | `surfaces.md` § native-links |
| M3.8 | Purge markers on the two temporary ports (D13) | **Done** | § 7.9 ledger |
| M3.9 | Surface `artwork` | **Done** | `surfaces.md` § artwork |
| M3.10 | Surface `library-home` | **Done** | `surfaces.md` § library-home |
| M4.0 | Backend inventory: live / unwired / dead; purge only the dead | **Done** | `rpc.md` (created) |
| M4a | Routing policy → `domain/routing` (ADR-0040) | **Done (implementer); live verification pending § 0.5** | `README.md` layer list, ADR-0040 |
| M4b | Identity service + record facade (backend) | **Done (implementer); live verification pending § 0.5** | `service-resolver.md`, `rpc.md` |
| M4c | Frontend adopts records and identity | **Done (implementer); live verification pending § 0.5** | `rpc.md`, `surfaces.md`, `sensors.md` |
| M5a | Metadata service (backend) | Build | `service-metadata.md`, `rpc.md` |
| M5b | Frontend adopts metadata | Build | `service-metadata.md`, `surfaces.md`, `sensors.md` |
| M5c | SteamGridDB artwork source (feature; decided § 11 item 8) | Build | `service-artwork.md`, `safety.md` (credentials) |
| M5d | ScreenScraper metadata source (feature; decided § 11 item 8) | Build | `service-metadata.md` |
| M6a | Achievements service (backend; fixes K1, K2, K7) | Build | `service-achievements.md`, `rpc.md` |
| M6b | Frontend adopts achievements; Flow C (fixes K14) | Build | `service-achievements.md`, `surfaces.md` |
| M7a | Freshness, throttle, registry (backend; fixes K15) | Build | `service-freshness.md`, `rpc.md` |
| M7b | Frontend drives ingestion; sync manager deleted | Build | `service-freshness.md` |
| M8 | Settings split + Troubleshooting panel | Build | `settings.md`, `safety.md` |
| M9a | Cleanup: code (allowlist empty, `features/` and `rpc.ts` gone, purge ledger, ADR-0041) | Build | `rpc.md`, `README.md`, ADR-0041 |
| M9b | Cleanup: docs and live scripts (`tests/live/`, docs to the real tree, migration closed) | Build | all |

Order is fixed: never start a row while an earlier row is not `Done`. M0b-2 is not a
step of its own any more: each M3.x applies its wrapper to the hooks it moves (§ 7.0 D6).
M3.0–M3.10 are cumulative: each package's hashes are the previous step's result, so they
run strictly in order (a `STALE` line on `check` means an earlier step is missing).

### 0.3 Environment and commands (this machine)

| Thing | Value |
| --- | --- |
| Repo | `C:\game\millennium` (git, branch `main`) |
| Plugin source | `C:\game\millennium\steam-cartridges` |
| Steam | `C:\game\steam` (DevTools `http://127.0.0.1:8080`; use `127.0.0.1`, never `localhost`) |
| Deployed dev plugin | `C:\game\steam\millennium\plugins\steam-cartridges-dev` (created by `dev.ps1`) |
| Node | v24 (built-in `WebSocket`; the `scratch/arch-m0` scripts need no npm packages) |
| Lua | LuaJIT 2.1 at `C:\dev\tools\lua` (on the user `PATH`; `lua` and `luajit` both work; built from source 2026-09-28, see its `README.txt`) |
| Test shortcuts | AM2R `4263274102` (unmapped, local metadata, captures) · WUCHANG: Fallen Feathers `3135033888` (mapped → native `2277560`) · Jotunnslayer `2315502503` (mapped → `2820820`) |

Commands, run from `C:\game\millennium\steam-cartridges` unless stated otherwise:

| Command | Expected output (exact) |
| --- | --- |
| `npm run check` | the two npm banner lines `> steam-cartridges@0.1.0 check` and `> tsc --noEmit`, then nothing; exit code 0 |
| `npm run test:ts` | ends with `ℹ tests 64` / `ℹ pass 64` / `ℹ fail 0` (71 after M0b-1, 73 after M0c, 81 after M1, 87 after M2, 86 after M3.0–M3.3, 87 from M3.4 on) |
| `npm run build` | contains `build Succeeded`; ignore the `@steambrew/ttc` update nag |
| `git status --short` (repo root) | empty before you start |

PowerShell note: run scripts as `powershell -ExecutionPolicy Bypass -File <script>`.

### 0.4 Preconditions for every step

Run from `C:\game\millennium`:

1. `git status --short` → no output.
2. `git log -1 --format=%s` → the subject of the last commit on `main`. Write it in your report.
3. `cd steam-cartridges; npm run check` → as in § 0.3.
4. `npm run test:ts` → as in § 0.3 (`ℹ fail 0`; pass count as § 0.3 says for the current step).
5. For a step with a blocks or apply script (M0a, M0b-1, M0c, M2 and every later `Ready`
   step, § 7.0 D10): its `check` command, as the step's action 1 gives it. Any line
   containing `STALE` means the plan is out of date: stop (§ 0.8).

### 0.5 Live verification (the baseline every step must reproduce)

Run by the verifier (or the implementer only when the step says so). It deploys
the dev plugin and restarts Steam.

1. From `C:\game\millennium\steam-cartridges`: `powershell -ExecutionPolicy Bypass -File dev.ps1`
   → ends with `Deployed steam-cartridges-dev.` and `Devtools: http://localhost:8080`.
2. Wait until `SharedJSContext` exists, then 20 s more for the plugin to load:
   `curl -s http://127.0.0.1:8080/json` lists a target titled `SharedJSContext`.
3. From `C:\game\millennium`, run each command and compare:

| Command | PASS output (exact line) |
| --- | --- |
| `node scratch/arch-m0/count_cycle.mjs 4263274102` | last line starts `PASS render loop:` (all three counts ≤ 3; measured after M0a: `enrich(page)=1 enrich(properties)=0 achievementLoads(page)=1`) |
| `node scratch/arch-m0/test_props.mjs 3135033888 --page` | `appid 3135033888 page=true: OK; popup=["WUCHANG: Fallen Feathers"]` |
| `node scratch/arch-m0/test_props.mjs 2315502503 --page` | `appid 2315502503 page=true: OK; popup=["Jotunnslayer: Hordes of Hel"]` |
| `node scratch/test_nav_cycle.js` | six lines starting `PASS`, no `FAIL` |
| `node scratch/check_all_tabs.js` | eleven lines starting `PASS`, no `FAIL` |

Until M0c fixes it, `check_all_tabs.js` line `A -> B -> A: activity cards intact (hasEvent)`
can fail once from timing (it compares DOM card counts, which Steam reveals
progressively). If that is the **only** FAIL, run the script once more. If the
second run has no FAIL, it counts as PASS; write both outputs in the report.
Anything else is a FAIL.

4. If any check FAILs, or Steam shows its "restart the UI" dialog: stop. Put
   Steam back as the user runs it, then report:
   `powershell -ExecutionPolicy Bypass -File ..\start-steam-dev.ps1 -KillOnly`, then remove
   `"steam-cartridges-dev"` from `plugins.enabledPlugins` in
   `C:\game\steam\millennium\config\config.json` (change nothing else), delete
   `C:\game\steam\millennium\plugins\steam-cartridges-dev`, and start Steam with
   `powershell -ExecutionPolicy Bypass -File ..\start-steam-dev.ps1`.
   This is the only config edit this plan ever allows.

### 0.6 The layer doc template

Every step that creates a layer writes `docs/steam-cartridges/<name>.md` with
exactly these sections, and every later step that changes the layer updates it:

```markdown
# <Layer name>

**This doc's job:** <one sentence>. Part of the steam-cartridges architecture
(ADR-0039); index: [steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns
<bullets: the responsibilities, and nothing else owns them>

## Contract
<the exported types and functions, as code blocks, copied from the source>

## Files
| File | Role |

## Steam targets touched
<surfaces only: the `touches` list, one row per target, with the guardrail that governs it; other layers write "none">

## May import / must never import
<the row from migration plan § 4.1>

## Tests
<test files and what each proves; the live checks from migration plan § 0.5 that cover it>

## How to add <the usual extension> (e.g. a new source, a new surface)
<numbered, mechanical steps touching only this layer>

## History
<one line per migration step that changed this doc, with the date>
```

Then flip the layer's row in [steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers)
from `planned` to `current`, with a link, in the same commit.

### 0.7 Commit procedure

1. `git add` **only** the paths the step lists (never `git add -A` or `git add .`).
2. `git status --short` → only those paths are staged (`M `, `A `, `D `), nothing else is listed.
3. `git commit -F -` with the message the step gives, ending with a blank line and
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (this repo is exempt
   from AGENTS.md Routine 6; nothing here goes upstream).
4. `git push origin main` → ends with `main -> main`.

### 0.8 Failure rule

- Run a failing command at most **twice**. On the second failure, stop.
- Append to `TASK.md` § "Active failures & blockers": the step id, the command,
  its output trimmed to 30 lines, and the time.
- Revert your uncommitted edits: `git checkout -- steam-cartridges` and delete
  any file the step created. If you deployed, restore Steam as in § 0.5 step 4.
- Do not retry with changes, edit around the failure, weaken a test, or skip ahead.

### 0.9 Banned actions (all steps)

- No deploy or Steam restart unless the step or § 0.5 says so.
- No SharedJSContext reload (`location.reload()`, Ctrl+R).
- No probe or throwaway plugins.
- No edits to Millennium's `config.json` or plugin config, except § 0.5 step 4.
- No changes to the user's library, collections or shortcuts.
- No `npm install`, upgrade or new dependency.
- No `git push --force`, no `--no-verify`, no history rewriting.
- No new cross-area import outside `tests/architecture-allowlist.json` (after M0c). The allowlist never grows.
- No Steam write outside the code the step names. From M3 on: no Steam write outside `surfaces/`.
- No store write, event, RPC, timer or prototype walk inside a Steam render, getter, prototype hook or jsx handler ([guardrail 17](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components)).
- No mixing a module move and a behaviour change in one step.
- No editing the pass criteria in § 0.5 or the checks in `scratch/check_all_tabs.js` / `scratch/test_nav_cycle.js`, except M0c's one fix.

### 0.10 How to execute a `Build` step

A `Build` step gives you the design, the binding contracts, the named tests and the exit checks; you
write the code. Rules, in order:

1. Read § 0, § 7.0 (decisions D1–D14), the step's own section, and every section it points to
   (for M4–M5: "M4–M5 overview" and "Shared contracts"). Run § 0.4. For a step that touches `backend/`,
   also record the three Lua suites' current last lines (`ALL PASS`, or the known K7/K8 failures).
2. **Files:** you may create or change only the files the step's Design and Tests name, the docs its
   Docs line names, `package.json` `test:lua` when a step adds a Lua suite, and `tests/architecture-allowlist.json`
   through `ARCH_WRITE_ALLOWLIST=1` (it may only shrink). Any other file: stop and report.
3. **Contracts are binding.** Names, signatures, JSON shapes, status meanings and TTL values in the step
   (and in "Shared contracts") are not yours to change. You may add private helpers. If a contract cannot
   be met, stop (§ 0.8) and write why in `TASK.md` § Active failures; never adapt the contract.
4. **Tests first.** Write the step's named tests with the exact names given, run them and see them fail,
   then implement until they pass. Never edit or weaken an existing test, except a path change under D11
   or a deletion the step names explicitly.
5. Implement the Design's numbered items in order. After each item: `npm run check` (exit 0), `npm run test:ts`
   (`ℹ fail 0`), and the Lua suites the item touches. The architecture test must pass after every item:
   a new cross-layer import means the design was misread (fix it with D3, never by listing the edge).
6. Exit: run every command in the step's **Exit** line and paste the outputs in your report, with the new
   test counts and the allowlist before/after.
7. Docs per the step, then commit per § 0.7 with the paths from rule 2 and the message
   `<type>(steam-cartridges): <what> (<step id>)`. Push.
8. Live: the verifier runs § 0.5 and the step's live checks (§ 0.1 action 7 applies). A `Build` step is
   `Done` only after the verifier's PASS.
9. Ambiguity: if the spec allows two readings, stop and ask. Do not pick one.

---

## 1. Why: root cause of the regression pattern

The user had to uninstall `steam-cartridges` on 2026-09-28 because Steam's UI kept
crashing. Over the last several sessions, most new features broke a view that was
already working. The cause is structural. The evidence below comes from the tree at
`ec16203`.

### 1.1 Every feature can reach every other feature

`frontend/features/*` import each other's internals directly:

| Importer | Reaches into |
| --- | --- |
| `features/steam-store/index.ts` | `achievements`, `artwork/artwork`, `game-info/game-info-patch`, `game-info/metadata`, `game-info/normalize`, `renderers/library-app`, `steam/activity`, `steam/sections` |
| `features/scraper/on-update.ts` | `achievements`, `buckets`, `buckets/auto-routing`, `buckets/resolve`, `game-info/metadata`, `game-info/normalize`, `renderers/library-app` |
| `features/scraper/sync-manager.ts` | `achievements`, `buckets`, `buckets/auto-routing`, `buckets/resolve` |
| `steam/sections.ts` (a Steam binding) | `features/game-info/game-info-patch` (a feature) |
| `settings/settings.ts` | `features/buckets/resolve`; and `steam/activity.ts` imports `settings/settings` (a cycle through settings) |
| `settings/settings-panel.tsx` (2707 lines) | `achievements`, `buckets`, `buckets/resolve`, `game-info/controller`, `scraper/sync-manager` |

So the steam-store feature changes Game Info state, achievements and the activity
store, and the scraper changes metadata and achievements. When one file changes,
the effects spread in ways nobody can predict.

### 1.2 No single owner of Steam mutations

Steam's shared objects are patched from about a dozen places, none of which own them:

| Steam target (shared by the whole client) | Patched from |
| --- | --- |
| `AppOverview.prototype.GetGameID`, `.BHasStoreCategory` (every app, native included) | `features/game-info/game-info-patch.ts` `ensureAppOverviewHooked` (walks the prototype chain from any overview it sees) |
| Game Info `k`, container `G`, PlayBar `XC` — `prototype.render` **and** a `props` accessor on the prototype | `game-info-patch.ts` `hookComponentProps`, `patchKComponent` (commit `ec16203`) |
| `CAppDetailsSections.prototype.GetSections` | `steam/sections.ts` (which also imports game-info state) |
| `react/jsx-runtime` `jsx`/`jsxs` | **four** independent hooks: `steam/gamepad-appid.ts`, `steam/headline-patch.ts`, `steam/activity-cards-patch.ts`, `features/steam-store/native-sections.ts` |
| `appStore.GetAppOverviewByAppID`, `Navigator.App` | `features/steam-store/native-sections.ts` |
| `StoreItemCache.m_mapApps`, `.m_setUnavailableApps`, `BIsAppMissing` | `steam/activity.ts` |
| `collectionStore.OnAppOverviewChange` | `renderers/library-home.tsx` |
| `AppDetailsStore` app data (`descriptionsData`, `associationData`, `details.achievements`), `m_setStoreCategories` | `features/game-info/metadata.ts`, `features/achievements/store.ts` |

### 1.3 Confirmed crash: a render feedback loop (live-debugged 2026-09-28)

**User report:** opening **Properties** of the non-Steam game *WUCHANG: Fallen
Feathers* made Steam show its "restart the UI" dialog.

**Reproduced** with the dev build of `ec16203`/`22bac99` (tools in `scratch/arch-m0/`):

| Test | Result |
| --- | --- |
| `test_props.mjs 4263274102 --page` (AM2R, unmapped) | `HUNG after ~1s` |
| WUCHANG `3135033888` (mapped → `2277560`) | hung (first repro; user saw the dialog) |
| Renderer process while hung | 1.2 GB, more than one core busy, `Runtime.evaluate` times out in every target |
| `count_cycle.mjs`, AM2R page only, 10 s | **1,521** "Enriched native Game Info" log lines and **727** achievement RPCs ("cannot extract rom path") |
| Same, 8 s after opening Properties | 952 more enrichments, then the thread saturates |

So the bug is **not specific to WUCHANG, nor to Properties**. A loop runs on every
shortcut's game page at about 150 rounds a second. On the page alone the thread
keeps up, so it only costs CPU. Properties adds a second large React tree to
every round, and the one renderer thread that all Steam windows share
([knowledgebase](../knowledgebase.md#one-renderer-for-every-steam-window-a-busy-sharedjscontext-freezes-them-all))
never goes idle again.

**Stack samples** (debugger attached before the repro, [steam-debug.md Trap 10](../steam-debug.md#trap-10-diagnosing-a-hung-sharedjscontext-restart-the-ui-dialog)):
`refreshGameInfoInstances < enrichGameDetails < handleWebScrapingView < onSourceView`
(our plugin); React `updateClassComponent` → an SDK-patched `render`; React
commit recursion (356 frames); MobX `set` → deep observable conversion. Different
places on every sample means a feedback loop, not one hot function.

**The loop** (each link verified in source; commits from `git log -S`):

```
Steam renders Game Info (G / k / the props getter)
  └─► onTriggerAppView(appid)            game-info-patch.ts, G.render + props getter   (bf3839f, ec16203)
        └─► onSourceView → handleWebScrapingView → loadAchievementsForApp (RPC)
              └─► enrichGameDetails        metadata.ts: always writes a NEW descriptionsData object,
                    │                      calls AppDetailsChanged (MobX re-render), sets touched = true
                    └─► refreshGameInfoInstances   game-info-patch.ts:
                          • forceUpdate() every instance ever seen (liveInstances)
                          • for every window in g_PopupManager.m_mapPopups (includes Properties):
                            first element matching [class*="Shortcut"] … → walk EVERY ancestor
                            fiber (typeof fiber.type === "function", since cb8e0fe),
                            `delete inst.props; inst.props = cur`, forceUpdate()
                          └─► Steam renders Game Info again ─► (top)
```

Three changes were each harmless alone:
- the ancestor walk (`cb8e0fe`, 09-24)
- the render-triggered view (`bf3839f`, 09-28)
- the `props` getter trigger and `delete inst.props` (`ec16203`, 09-28)

Together they closed the loop. The `ec16203` CHANGELOG entry "Dynamic Instance
Refresh: … strip stale own-property `props` and force component re-renders" is the
last link.

**Hidden second bug, found by the fix:** with the loop gone, AM2R's Game Info lost
its release date and badges. Steam rebuilds overview fields
(`rt_original_release_date`, `m_setStoreCategories`) after we write them, and
the loop had been re-writing them about 150 times a second
([steam-components § Game Info](../steam-components.md#game-info-tab--metadata)).
M0a therefore makes enrichment idempotent **and** re-check the overview fields on
each Game Info render.

**Fix validated live (M0a blocks applied temporarily, then reverted):**

| Check | Before | After M0a |
| --- | --- | --- |
| `count_cycle.mjs` AM2R, page 10 s | 1,521 enrich / 727 RPC | 1 / 1 (`PASS render loop`) |
| Properties: AM2R, WUCHANG, Jotunnslayer | HUNG | OK, OK, OK |
| `test_nav_cycle.js` | — | 6/6 PASS |
| `check_all_tabs.js` | — | all 11 PASS in 2 of 3 runs; 1 run failed only the timing-sensitive `A -> B -> A: activity cards intact` (3 cards vs 1), fixed in M0c |

**Ruled out:** a WUCHANG- or mapping-specific cause (unmapped AM2R hangs the
same way); a JS exception (none logged); the jsx hooks and native-sections
patches (never on any sampled stack).

### 1.4 The same trigger is detected three times

"The user opened a shortcut's page" is detected in three places, and each one starts work:

1. `index.tsx` `onPopupCreate` → desktop `onLocationChange` and Big Picture `watchGamepadAppid` → `patchLibraryApp`
2. `features/source-view.ts` `initSourceView` → its own `onLocationChange` and `watchGamepadAppid` → `onSourceView`
3. `game-info-patch.ts` → the `props` getter and `G.render` → `onTriggerAppView` → `onSourceView`

The `inflight`/`rerun`/`deferred` sets in `source-view.ts` exist only to paper over this.

### 1.5 The appid is normalized ad hoc

`appid >>> 0`, `appid | 0`, `isNonSteamAppId` and triple-key lookups
(`map.get(a) || map.get(a >>> 0) || map.get(a | 0)`) are repeated per feature. Each
new feature has to remember the signed-int32 trap
([knowledgebase](../knowledgebase.md#signed-vs-unsigned-32-bit-appid-in-cef)), and
several regressions came from forgetting it (dataflow audit Finding 1, Animaniacs).

### 1.6 Nothing enforces the boundaries

The guardrails in [plugins.md](../plugins.md) are prose. There is no test that fails
when a feature imports another feature, when two modules patch the same Steam target,
or when a hot hook does I/O. There is also no kill switch: the only way to stop a
crashing feature was to uninstall the whole plugin.

**Ruled out as the primary cause:** the individual bugs fixed in the dataflow audit
(credentials, `ipairs`, TTLs). Those were fixed, and the next feature still regressed
another view. The coupling is the problem, not any one bug.

---

## 2. Target data flows (the user's spec)

Everything below serves these three flows. Each box is one owned module.

### Flow A — main pipeline (a shortcut exists or is viewed)

```
 [Registry]           [Resolver]                        [Metadata]         [Achievements]
 shortcut added  ──►  native Steam match?  ──yes──►  Steam appdetails  ──►  Steam schema
 or first seen        (manual → owned → store search)
                          │ no
                          ▼
                      web identity         ──────►  IGDB / ScreenScraper ─►  RA / local
                      (IGDB id, RA game id,                                  emulator / trophies
                       ROM hash, SS id)
                          │ none → "unresolved" (local data and captures still show)
                          ▼
                    ┌────────────────── GameRecord (read model, per shortcut) ──────────────────┐
                    └──► Surfaces inject into Steam's non-Steam game page (desktop + Big Picture)
```

Full or partial data is normal. Each part of the record has its own status, and a
surface renders whatever parts are `ok`.

### Flow B — daily freshness, only on page open

```
 ViewSensor: shortcut.viewed(appid) ─► Freshness policy: part checked > 24h ago?
      ├─ no  → surfaces render the cached record, no network
      └─ yes → refresh only that appid's stale parts → record.updated → affected surfaces re-render
```

Games that are never opened are never fetched again. The startup batch
(`sync-manager.ts` `triggerSync`) is reduced to Flow A for **newly added** shortcuts only.

### Flow C — live achievements

```
 LifecycleSensor: app launched ─► Achievement observer session (backend channels: logs,
 emulator, RA) ─► achievements.unlocked(appid, ids) ─► Achievements service persists
      ├─► Toast surface (NotificationStore)      └─► Achievements surface re-feeds Steam stores
 app quit ─► stop session ─► captures surface refresh (new screenshots/clips)
```

---

## 3. Options considered

| Option | Verdict |
| --- | --- |
| **Separate Millennium plugins per service** (true microservices) | **Rejected for now.** All frontends share one `SharedJSContext`, so a crashing surface in plugin B still crashes Steam's UI. Splitting into plugins does not isolate the failure that forced the uninstall. It also multiplies the settings, deploy and IPC contract ([ADR-0012](../decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins) cost), while Phase 9 is still unwritten. The contracts below are designed so that a source can move out to a provider plugin later with no core change. |
| **MVC** | Only partly fits. There is no view to write: Steam renders ([ADR-0022](../decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)). Our "view" is a set of adapters that write into Steam's stores, and MVC has no concept for the many external sources (IGDB, RA, Steam store). |
| **Hexagonal (ports & adapters) modular monolith** | **Recommended.** Steam is both an input port (sensors) and an output port (surfaces). IGDB, RA, ScreenScraper and the Steam store are source adapters behind service ports. The domain in the middle (routing, resolution, freshness, normalization) is pure and testable without Steam. One read model (`GameRecord`) decouples producers from consumers. This gives the "new feature touches one part" property at the module level, and the isolation the crash needs at the surface level. |

---

## 4. Target architecture

### 4.1 Layers and the dependency rule

```
                ┌──────────────────────────── frontend ────────────────────────────┐
  Steam UI ──►  sensors/  ──events──►  app/ (use cases)  ──►  ports/backend ──RPC──┼──► backend services
                                           │                                       │        │
                                           ▼                                       │     sources/ (IGDB, RA,
                                      kernel/record  (GameRecord read model)       │      SS, Steam store,
                                           │  record.updated                       │      local files)
                                           ▼                                       │        │
  Steam UI ◄──  surfaces/  (the ONLY code that writes to Steam)                    │     storage/ (JSON files)
                └──────────────────────────────────────────────────────────────────┘
```

**Import rule (enforced by a test, M0):**

| Module | May import | Must never import |
| --- | --- | --- |
| `kernel/` | nothing of ours | Steam, `@steambrew/*`, RPC, any other folder |
| `domain/` (pure frontend policy: routing (ADR-0040), display rules, normalization; freshness lives in the backend per §11) | `kernel/` | Steam, RPC, sensors, surfaces |
| `sensors/` | `kernel/`, `steam/` (read-only resolution) | `surfaces/`, `app/`, other sensors |
| `app/` (use cases, orchestration) | `kernel/`, `domain/`, `ports/` | `steam/`, `surfaces/`, `sensors/` internals |
| `ports/backend/` | `kernel/` | everything else |
| `surfaces/<name>/` | `kernel/`, `steam/`, its own folder | **another surface**, `app/`, `ports/`, `sensors/` |
| `steam/` (module resolution, `jsx-hook`, store types) | `kernel/`, `logger` | features, surfaces, settings |
| `settings/<panel>` | `kernel/`, `ports/` | surfaces, sensors |
| `index.tsx` | everything (composition root only, no logic) | — |

The one-way flow is: sensors emit events, `app/` updates the record, and surfaces
read the record. A surface never triggers a fetch, and a service never touches Steam.

**Each layer has one doc** under `docs/steam-cartridges/`, written by the step that
creates the layer, in the § 0.6 template, and indexed in
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

### 4.2 The kernel (small, stable, rarely changed)

- **`kernel/appid.ts`** — `ShortcutId` branded type, created **only** by
  `toShortcutId(raw)`, which applies `>>> 0` and the non-Steam range check. It also
  provides the gameid conversion (BigInt) and `toSignedKey` for the few Steam APIs
  that need it. Every map in the plugin is keyed by `ShortcutId`, so triple-key
  lookups are no longer possible.
- **`kernel/events.ts`** — a typed in-process bus: `shortcut.viewed`,
  `shortcut.left`, `shortcut.launched`, `shortcut.quit`, `record.updated`
  `{appid, parts[]}`, `achievements.unlocked`, `settings.changed`. Handlers run in
  isolation: one handler throwing never stops the others.
- **`kernel/record.ts`** — `GameRecord` plus an in-memory read model
  (`get(appid)` is O(1) and safe from hot hooks):

  ```ts
  GameRecord {
    appid: ShortcutId; gameid: string; title: string; exe: string;
    route:        { bucket; via };                       // policy result
    identity:     Part<{ native?: {appid, source}; web?: {igdb?, ra?, ss?, romHash?} }>;
    metadata:     Part<GameMetadata>;                    // description, credits, date, categories
    achievements: Part<AchievementSet>;                  // normalized schema + unlocks
    media:        Part<CommunityMedia>;                  // trailers, manuals, links
    artwork:      Part<ArtworkPlan>;
  }
  Part<T> = { status: "ok" | "partial" | "unsupported" | "needs-setup" | "error" | "pending";
              data?: T; source?: string; fetchedAt?: number; checkedAt?: number }
  ```
  Captures are **not** in the record. They stay Steam's own data, read live
  (ADR-0022), because that core must not depend on anything.
- **`kernel/surface.ts`** — the `Surface` contract and the isolation runner (§4.4).

Additive changes to `GameRecord` (a new optional part) are allowed in any child plan.
Changing or removing a field needs an ADR.

### 4.3 Services (backend-first, one per concern)

The backend owns I/O and merging ([ADR-0004](../decisions.md#adr-0004-backend-owns-all-io-and-merging-the-frontend-only-renders)).
Each service is a set of flat Lua files: the backend keeps its flat `require` layout
(P0 T5, `main.lua`), so folders are expressed as filename prefixes.

| Service | Files (target) | Owns | Sources (adapters) |
| --- | --- | --- | --- |
| Registry | `registry_*.lua` | shortcuts.vdf parse, known-shortcut index, "added since last run" diff | `shortcuts.lua`, `steam_paths.lua` |
| Resolver | `resolve_*.lua` | identity: native match first, then web ids; negative-result TTL separate from positive | `src_steam_search`, `src_igdb_search`, `src_ra_hash`; frontend supplies owned-app candidates and collection membership as **context** |
| Metadata | `metadata_*.lua` | normalized `GameMetadata`, local DB (`library_metadata.json`, `custom_override` preserved) | `src_steam_appdetails`, `src_igdb`, `src_screenscraper` |
| Achievements | `ach_*.lua` | schema + unlocks store, observer channels, normalization | `src_steam_schema`, `src_retroachievements`, `src_ps3/ps4_trophies`, `src_engine_logs`, `src_emulators` |
| Media (future feature, not a migration step) | `media_*.lua` | trailers, manuals, links | new sources; the old `screenscraper_media.lua` / `igdb_community.lua` had no live caller and are purged in M4.0 (restore from git if wanted) |
| Freshness | `fresh_*.lua` | per-part `checkedAt`/TTL, per-source throttle, circuit breaker | — |

**Source contract** (the same shape as the planned provider contract, so a source can
become a provider plugin later, per [ADR-0013](../decisions.md#adr-0013-providers-return-data-the-core-renders-it)
and [ADR-0014](../decisions.md#adr-0014-providers-are-isolated-and-fail-silently)):

```lua
source = { id = "igdb", supports = function(ctx) → bool,
           fetch = function(ctx) → { status, data, ttl } }   -- always pcall-wrapped by the service
```

**RPC facade** (the new surface area, versioned):

- `GetGameRecord(appid)` returns the assembled record from disk (no network).
- `EnsureFresh(appid, parts, context)` runs stale parts through the sources and returns the updated record.
- `ListShortcuts()` / `GetNewShortcuts()` return registry data.
- Achievement observer calls stay as their own group.

Old RPC names stay registered as aliases until the last child plan removes their
callers ([knowledgebase: an unregistered RPC crashes the host](../knowledgebase.md#backend-rpc-crash-trap-unregistered-methods--unhandled-errors)).
A test asserts that every name in `ports/backend` is registered in `main.lua`.

Persisted file formats **do not change** in this migration: `library_metadata.json`,
`steam_store.json`, mappings and `achievements.json` are read and written by their new
owners with the same shape. A format change would be its own plan, with a migration
in `migrate.lua`.

### 4.4 Surfaces: the only code that touches Steam

Each surface owns a declared, non-overlapping set of Steam targets:

```ts
interface Surface {
  id: string;                                   // "sections", "captures", "game-info", …
  touches: string[];                            // e.g. ["CAppDetailsSections.GetSections"]
  install(): void;                              // resolve modules once (guardrail 3), patch once
  render(record: GameRecord | undefined, appid: ShortcutId): void;  // idempotent write into Steam stores
  clear(appid: ShortcutId): void;               // never deletes StoreItemCache stubs (guardrail 5)
  uninstall(): void;
}
```

| Surface | Takes over from | Steam targets it owns |
| --- | --- | --- |
| `sections` | `steam/sections.ts` | `GetSections`, memo reset + `forceUpdate` (guardrails 10, 11) |
| `captures` | `steam/summary.ts`, `steam/activity.ts`, `headline-patch.ts`, `activity-cards-patch.ts`, `renderers/library-app.tsx` | `appSpotlightStore`, `appActivityStore`, `StoreItemCache` stubs and immunity |
| `game-info` | `features/game-info/game-info-patch.ts`, `metadata.ts` | `k`/`G` render proxy, `descriptionsData`, `associationData`, `rt_original_release_date`, categories |
| `playbar` | `game-info-patch.ts` `targetPlayBar` | PlayBar ⓘ toggle |
| `achievements` | `features/achievements/store.ts` | `AppDetailsStore` achievements, `appAchievementProgressCache` |
| `toasts` | `features/achievements/dispatcher.ts`, `launch-toast.ts` | `NotificationStore.OnNotification` |
| `native-links` | `features/steam-store/native-sections*.ts` | `GetAppOverviewByAppID` (tagged substitute), `Navigator.App`, links bar |
| `community` | `renderers/community-tab.tsx`, `steam/community-store.ts` | `CWorkshopStore`, custom tab |
| `artwork` | `features/artwork/artwork.ts`, `steam-store/art-plan.ts` | `SetCustomArtworkForApp` |
| `library-home` | `renderers/library-home.tsx` | `OnAppOverviewChange` grid fields |

Shared infrastructure, which is not a surface and owns no targets: `steam/modules.ts`
(one webpack scan) and **one** `steam/jsx-hook.ts` dispatcher. The four current jsx
hooks become handlers registered on a single `keepJsxPatched` installation, each
wrapped in its own try/catch and O(1).

**Isolation runner (the fix for "remove the whole plugin"):**

1. Each surface is installed in its own try/catch. If it fails to install, only that surface is off.
2. Each Steam render hook a surface installs follows **fail-open**: it wraps its
   logic in try/catch, and on any error it calls Steam's original render with the
   original props. It never throws into Steam's render.
3. Render hooks and getters are **pure reads** of the record (O(1) `Map.get`). No
   events, fetches, store writes or prototype walks
   ([guardrail 2](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced)).
   Store writes happen only in `Surface.render`, which is called from the event loop
   and never from inside a Steam render.
4. Error budget: after N errors in a session (initially 5), the runner uninstalls that
   surface and logs once. Steam falls back to stock for that view.
5. **Kill switches:** each surface and each service has a switch in plugin settings
   (`disabledSurfaces`, `disabledServices`), read before install. A crash is then
   bisected by switching surfaces off, not by uninstalling.
6. **Safe mode (boot sentinel, M0b-1):** see below. (Original design, superseded: the backend writes `boot.pending` on load, and the
   frontend clears it 60 s after init with no surface errors. If Steam starts and
   finds `boot.pending` from the previous run twice in a row, the frontend installs
   only `sections` + `captures` (the capture tier, which is the core promise) and
   logs which surfaces were skipped.
   **As built (M0b-1):** no backend needed. The frontend keeps
   `steam-cartridges.boot = { pending, unclean }` in SharedJSContext's `localStorage`
   (it survives Steam restarts). Each start sets `pending`; a clean shutdown
   (`pagehide`) or 60 s without feature errors clears it. Finding it still pending
   counts a bad boot; two in a row start safe mode (`sections`, `store-cache`, `captures`).
7. A test asserts that no two surfaces declare the same `touches` entry.

### 4.5 Sensors: the only code that detects what the user is doing

| Sensor | Replaces | Emits |
| --- | --- | --- |
| `view-sensor` | the three detectors in §1.4 | `shortcut.viewed` / `shortcut.left`, deduplicated per appid (desktop route + Big Picture jsx handler) |
| `lifecycle-sensor` | `onAppLaunch` in `index.tsx` | `shortcut.launched` / `shortcut.quit` |
| `collections-sensor` | `features/buckets/collections.ts`, `ready.ts` | membership snapshots, only after `collectionsReady()` ([guardrail 13](../plugins.md#13-never-read-a-steam-mobx-computed-before-its-source-exists)) |
| `owned-apps-sensor` (M4, next to its only consumer) | owned-match part of `steam-store/known-apps.ts` (`readNativeGames`) | native candidates for the resolver's context |

### 4.6 What "a new feature touches only its part" means in practice

| New feature | Files touched | Files not touched |
| --- | --- | --- |
| New metadata source (e.g. MobyGames) | `src_mobygames.lua`, the metadata source list, one settings panel | every surface, the resolver, achievements |
| New achievement source (e.g. Xenia) | `src_xenia.lua`, the achievements source list | game-info, captures, sections |
| New thing shown on the page from existing data | one new surface folder + its `touches` | services, other surfaces |
| New record field | `kernel/record.ts` (additive), the producing service, the consuming surface | everything else |
| New routing rule type | `frontend/domain/routing/policy.ts` + its TS tests (ADR-0040) | surfaces, services |

A child plan whose diff crosses more boundaries than its row allows must explain why
in its root-cause section, or it is rejected.

---

## 5. Migration strategy

**Strangler, one owner at a time.** Every child plan moves **one** module (one surface,
one sensor or one service) behind its contract, deletes the old path in the same plan,
and leaves the rest of the plugin byte-identical. There is no big-bang rewrite and no
long-lived parallel implementation.

**Behaviour freeze during migration.** No new features merge into `steam-cartridges`
until M3 is complete. Bug fixes go into the new structure when the module has already
moved, and into the old one otherwise. **Ended 2026-09-28 (M3.10 done):** every Steam
write now lives under `frontend/surfaces/`; new features may merge again, alongside
M4–M9.

**The baseline is the contract.** § 0.5 lists the exact PASS lines (the four views on
Big Picture, the nav cycle, the render-loop and Properties checks). Every step's live
verification must reproduce them exactly; M4 adds the Jotunnslayer parity check and
M6 the achievements checks ([guardrail 15](../plugins.md#15-never-weaken-a-verification-check-to-match-new-behaviour):
the baseline changes only through an accepted ADR).

---

## 6. Verified baseline (2026-09-28, tree at `0d599cf` + docs commits)

| Fact | Value |
| --- | --- |
| `npm run check` | exit 0, no output |
| `npm run test:ts` | `ℹ tests 64` · `ℹ pass 64` · `ℹ fail 0` |
| Lua tests (run 2026-09-28 with `C:\dev\tools\lua`) | `test_steam_store.lua` ALL PASS · `test_emulator_controllers.lua` ALL PASS · `test_backend.lua` 76 PASS, **2 FAIL** (§ 12 K7, K8) |
| Cross-area imports in `frontend/` | 51 (list: `scratch/arch-m0/m0c/architecture.test.ts` regenerates it) |
| Expected test counts after each Ready step (dry-run, cumulative) | M0a 64 · M0b-1 71 · M0c 73 · M1 81 · M2 87 · M3.0–M3.3 86 · M3.4–M3.10 87 (allowlist after M2 41, M3.0 39, M3.1 38, M3.2–M3.8 35, M3.9 33, M3.10 31) |
| Live (M0a+M0b-1 applied, then reverted) | `PASS render loop` · Properties OK ×3 · nav cycle 6/6 · `check_all_tabs.js` 11/11 (4 runs with the M0c fix) |

---

## 7. The steps

Each step lists **Files** (the only paths it may touch), **Actions** (with the
command and exact expected output after each), **Docs**, **Commit** and **Live**.
For `Spec` steps, **Design** says what an architect must turn into literal blocks.

### M0a — Fix the render feedback loop (Ready)

**Why:** § 1.3. **Validated:** dry-run (`tsc` exit 0, 64/64) and live (§ 6).
**Files:** `steam-cartridges/frontend/features/game-info/metadata.ts`,
`steam-cartridges/frontend/features/game-info/game-info-patch.ts`,
`steam-cartridges/frontend/features/source-view.ts`, `CHANGELOG.md`,
`steam-cartridges/CHANGELOG.md`, `TASK.md`, this plan (§ 0.2 row only).
**Do not touch:** anything else, in particular `createPatchedOverview`, `ensureAppOverviewHooked`,
`patchKComponent`'s proxy logic, `steam/sections.ts`, the settings files.

What the blocks do:
- **1.1–1.4** (`metadata.ts`): make `enrichGameDetails` idempotent. It remembers what
  it wrote; a repeat call with the same metadata and badges, while Steam still holds our
  `descriptionsData` and the overview still has our release date and categories,
  writes nothing and returns `true`. Otherwise it writes as before. `revertGameDetails`
  forgets the memory.
- **2.1–2.9** (`game-info-patch.ts`, `source-view.ts`): a Steam render never triggers a
  view any more (delete `onTriggerAppView`, `setAppViewTrigger`, the `onView` option).
  `G.render` and `k.render` call the idempotent enrichment on every render (usually a no-op),
  so Steam's overview rebuild is repaired once.
- **3.1–3.2** (`game-info-patch.ts`): `refreshGameInfoInstances` no longer visits other
  popups (Properties) and force-updates only components we patched, never their ancestors.

**Actions** (from `C:\game\millennium\steam-cartridges`):

1. `python ../scratch/arch-m0/m0a_blocks.py . check`
   → 15 lines in this order: `STEP 1.1`, `1.2`, `1.3`, `1.4`, `2.1`, `2.2`, `2.3`, `2.4`, `2.9`,
   `2.5`, `2.6`, `2.7`, `2.8`, `3.1`, `3.2`, each followed by `: ok (<path>)`. No `STALE`.
2. `python ../scratch/arch-m0/m0a_blocks.py . apply` → the same 15 lines.
   (Equivalent by hand: apply each block below with an exact find-and-replace. The
   script is the reference; if the two ever differ, stop and report.)
3. `git diff --stat` →
   ```
    .../frontend/features/game-info/game-info-patch.ts | 43 +++-----------
    .../frontend/features/game-info/metadata.ts        | 66 ++++++++++++++++++++++
    steam-cartridges/frontend/features/source-view.ts  |  7 ++-
    3 files changed, 79 insertions(+), 37 deletions(-)
   ```
4. `git grep -n "onTriggerAppView\|setAppViewTrigger\|onView" -- frontend` → no output (exit code 1).
5. `npm run check` → § 0.3 (exit 0, no output).
6. `npm run test:ts` → `ℹ tests 64` / `ℹ pass 64` / `ℹ fail 0`.
7. Docs:
   - `CHANGELOG.md`: add at the top of the list (below the intro paragraph) exactly:
     ```markdown
     - **steam-cartridges: Properties-dialog hang fixed (migration M0a, 2026-09-28)**:
       - Root cause: a render feedback loop (render → view pipeline → enrichment → force-update of every ancestor in every window, including Properties), ~150 rounds/s on every shortcut page; Properties made it saturate the shared renderer. Evidence and fix: [migration plan § 1.3](docs/plans/steam-cartridges-architecture-migration-plan.md#13-confirmed-crash-a-render-feedback-loop-live-debugged-2026-09-28).
       - Fix: renders never trigger views; `enrichGameDetails` is idempotent and re-checks overview fields Steam rebuilds; `refreshGameInfoInstances` only touches our patched components in the main and Big Picture windows. New guardrail 17 in docs/plugins.md.
     ```
   - `steam-cartridges/CHANGELOG.md`: under `## [Unreleased]`, first item, exactly:
     ```markdown
     - **Fixed: Steam's UI froze when opening Properties of a non-Steam game (2026-09-28)**: Game Info no longer re-renders itself in a loop (it ran ~150 times a second on every non-Steam game page). Release date and badges are re-applied after Steam refreshes a game.
     ```
   - `TASK.md` § Now: replace the line `Next: execute **M0a** (render-loop fix, Ready), then M0b-1, M0c, M1 (all Ready, in`
     with `M0a done (render loop fixed). Next: execute **M0b-1**, then M0c, M1 (all Ready, in`,
     and replace `saturated Steam's shared renderer. The plugin stays **uninstalled** until M0a lands.`
     with `saturated Steam's shared renderer.`
   - This plan, § 0.2: M0a status `Ready` → `Done`, and M0b-1 (the next row) stays as it is.
8. Commit (§ 0.7) with paths:
   `steam-cartridges/frontend/features/game-info/metadata.ts steam-cartridges/frontend/features/game-info/game-info-patch.ts steam-cartridges/frontend/features/source-view.ts CHANGELOG.md steam-cartridges/CHANGELOG.md TASK.md docs/plans/steam-cartridges-architecture-migration-plan.md`
   and message `fix(steam-cartridges): stop Game Info render feedback loop (Properties hang, M0a)`.

**Live:** the implementer **runs** § 0.5 for M0a (the user needs the fix confirmed).
On PASS, leave the dev plugin deployed and enabled, and say so in the report. On
FAIL, restore Steam per § 0.5 step 4.

**Guardrail checklist** (tick each with one line of proof in the report): 1 (no
`BIsModOrShortcut` prototype hook added: `git diff` has none) · 2 (render path adds a
`WeakMap` lookup and a small array join, no regex, no DOM query) · 8 (`appData.details` untouched) ·
11 (refresh still covers main and Big Picture) · 12 (Properties is deliberately excluded) ·
14 (local Game Info still applied: `check_all_tabs` check 4 PASS) · 15 (no check edited) · 17 (the point of the step).

The literal blocks (identical to `scratch/arch-m0/m0a_blocks.py`):

**Block 1.1** · `frontend/features/game-info/metadata.ts`

Before:

```ts
/** Values Steam had before our first enrichment, per appid (for revert). */
const originals = new Map<number, Partial<Originals>>();
```

After:

```ts
/** Values Steam had before our first enrichment, per appid (for revert). */
const originals = new Map<number, Partial<Originals>>();

/**
 * What enrichGameDetails last wrote, per unsigned appid. A repeat call with the same
 * metadata and badges, while Steam still holds our descriptionsData object, writes
 * nothing: a rewrite calls AppDetailsChanged, which re-renders Game Info, and a render
 * must never cause another render (M0a: render feedback loop hung SharedJSContext).
 */
const applied = new Map<
    number,
    { signature: string; descriptionsData: unknown; categoryIds: number[] }
>();

/** JSON of each metadata object, computed once (renders call enrichGameDetails). */
const metaJson = new WeakMap<object, string>();

/**
 * Steam rebuilds an AppOverview's fields when it refreshes the app, which drops our
 * release date and badge categories. The enrichment is only live if they are still there.
 */
function overviewStillEnriched(
    overview: any,
    meta: ConsolidatedMetadata,
    categoryIds: number[],
): boolean {
    if (!overview) return false;
    if (meta.release_date && meta.release_date > 0) {
        const expected = meta.original_release_date || meta.release_date;
        if (overview.rt_original_release_date !== expected) return false;
    }
    for (const id of categoryIds) {
        if (!overview.m_setStoreCategories?.has?.(id)) return false;
    }
    return true;
}
```

**Block 1.2** · `frontend/features/game-info/metadata.ts`

Before:

```ts
        let touched = false;
        const uAppid = appid >>> 0;
        markAppEnriched(uAppid);
```

After:

```ts
        let touched = false;
        const uAppid = appid >>> 0;

        // Idempotent (M0a): identical data already live in Steam -> no write, no re-render.
        let json = metaJson.get(meta);
        if (json === undefined) {
            json = JSON.stringify(meta);
            metaJson.set(meta, json);
        }
        const categoryIds = badgeCategoryIds(meta, controllerContext(uAppid));
        const signature = json + "|" + categoryIds.join(",");
        const previous = applied.get(uAppid);
        if (previous && previous.signature === signature) {
            const liveData =
                getAppDetailsStore()?.GetAppData?.(uAppid) ||
                getAppDetailsStore()?.GetAppData?.(appid | 0);
            const liveOverview =
                getAppStore()?.GetAppOverviewByAppID?.(uAppid) ||
                getAppStore()?.GetAppOverviewByAppID?.(appid | 0);
            if (
                liveData &&
                liveData.descriptionsData === previous.descriptionsData &&
                overviewStillEnriched(liveOverview, meta, previous.categoryIds)
            ) {
                return true;
            }
        }

        markAppEnriched(uAppid);
```

**Block 1.3** · `frontend/features/game-info/metadata.ts`

Before:

```ts
                // Notify mobx observers if available
                if (typeof detailsStore.AppDetailsChanged === "function") {
                    try {
                        detailsStore.AppDetailsChanged(uAppid);
                    } catch {}
                }
                touched = true;
```

After:

```ts
                // Notify mobx observers if available
                if (typeof detailsStore.AppDetailsChanged === "function") {
                    try {
                        detailsStore.AppDetailsChanged(uAppid);
                    } catch {}
                }
                applied.set(uAppid, {
                    signature,
                    descriptionsData: appData.descriptionsData,
                    categoryIds,
                });
                touched = true;
```

**Block 1.4** · `frontend/features/game-info/metadata.ts`

Before:

```ts
        originals.delete(appid);
        originals.delete(uAppid);
```

After:

```ts
        originals.delete(appid);
        originals.delete(uAppid);
        applied.delete(uAppid);
```

**Block 2.1** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
                    const rawAppid = overview.appid >>> 0;
                    if (options.onView) {
                        onTriggerAppView?.(rawAppid);
                    }

                    if (options.requireMetadata) {
```

After:

```ts
                    const rawAppid = overview.appid >>> 0;

                    if (options.requireMetadata) {
```

**Block 2.2** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
    options: {
        requireMetadata?: boolean;
        onView?: boolean;
    },
```

After:

```ts
    options: {
        requireMetadata?: boolean;
    },
```

**Block 2.3** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
            hookComponentProps(targetG, {
                requireMetadata: true,
                onView: true,
            });
```

After:

```ts
            hookComponentProps(targetG, {
                requireMetadata: true,
            });
```

**Block 2.4** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
                        const rawAppid = overview.appid >>> 0;
                        onTriggerAppView?.(rawAppid);

                        const store = getAppDetailsStore();
                        let appData =
                            store?.GetAppData?.(overview.appid) ||
                            store?.GetAppData?.(rawAppid);

                        if (
                            !appData?.descriptionsData?.strSnippet &&
                            onGetMetadata &&
```

After:

```ts
                        const rawAppid = overview.appid >>> 0;

                        const store = getAppDetailsStore();
                        let appData =
                            store?.GetAppData?.(overview.appid) ||
                            store?.GetAppData?.(rawAppid);

                        // Every render re-checks: enrichGameDetails is a no-op while our data is
                        // live, and re-applies once after Steam rebuilds the overview (M0a).
                        if (
                            onGetMetadata &&
```

**Block 2.9** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
                if (
                    !appData?.descriptionsData?.strSnippet &&
                    onGetMetadata &&
                    onEnrichGameDetails
                ) {
```

After:

```ts
                // Every render re-checks: enrichGameDetails is a no-op while our data is
                // live, and re-applies once after Steam rebuilds the overview (M0a).
                if (onGetMetadata && onEnrichGameDetails) {
```

**Block 2.5** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
let onTriggerAppView: ((appid: number) => void) | undefined;
let onGetMetadata: ((appid: number) => any) | undefined;
let onEnrichGameDetails: ((appid: number, meta: any) => boolean) | undefined;

export function setAppViewTrigger(fn: (appid: number) => void): void {
    onTriggerAppView = fn;
}
```

After:

```ts
let onGetMetadata: ((appid: number) => any) | undefined;
let onEnrichGameDetails: ((appid: number, meta: any) => boolean) | undefined;
```

**Block 2.6** · `frontend/features/source-view.ts`

Before:

```ts
import { setAppViewTrigger } from "./game-info/game-info-patch";
```

After: **nothing.** Delete the Before lines entirely (the script replaces them with an empty string).

**Block 2.7** · `frontend/features/source-view.ts`

Before:

```ts
    setAppViewTrigger((appid) => void onSourceView(appid));
```

After: **nothing.** Delete the Before lines entirely (the script replaces them with an empty string).

**Block 2.8** · `frontend/features/source-view.ts`

Before:

```ts
/** Wires every place a game page can open (game-info patch, Big Picture, desktop). */
```

After:

```ts
/**
 * Wires every place a game page can open (Big Picture, desktop). A Steam render never
 * triggers a view: that closed a render -> enrich -> re-render loop (M0a).
 */
```

**Block 3.1** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
        if (popupMgr?.m_mapPopups) {
            for (const popup of popupMgr.m_mapPopups.values()) {
                const doc =
                    popup?.m_popup?.window?.document || popup?.window?.document;
                if (doc && !docs.includes(doc)) {
                    docs.push(doc);
                }
            }
        }
```

After:

```ts
        // Only the main window and Big Picture host Game Info. Never walk other popups
        // (Properties, dialogs): force-updating their trees hung SharedJSContext (M0a).
```

**Block 3.2** · `frontend/features/game-info/game-info-patch.ts`

Before:

```ts
                    (fiber.type.name === "k" ||
                        fiber.type.name === "G" ||
                        fiber.type.name === "ct" ||
                        fiber.type.name === "be" ||
                        Boolean(fiber.type.s_setGameInfoVisible) ||
                        typeof fiber.type.prototype?.onCollapseStarted ===
                            "function" ||
                        typeof fiber.type === "function")
```

After:

```ts
                    (fiber.type.__nsga_props_hooked === true ||
                        fiber.type.__nsga_gameinfo_patched === true)
```


### M0b-1 — Kill switches, error budget, safe mode (Ready after M0a is Done)

**Why:** § 1.6. The only way to stop a crashing feature was to uninstall the plugin.
**Validated:** dry-run after M0a (`tsc` 0, 71/71) and live (all § 0.5 checks PASS;
`safetyDiagnostics()` clean; the boot sentinel cleared itself after 60 s).
**Files:** new `steam-cartridges/frontend/safety/{features,boot,switches}.ts`, new
`steam-cartridges/tests/safety.test.ts`, `steam-cartridges/frontend/settings/settings.ts`,
`steam-cartridges/frontend/index.tsx`, new `docs/steam-cartridges/safety.md`,
`docs/steam-architecture.md` (§ 3 row), `CHANGELOG.md`, `steam-cartridges/CHANGELOG.md`, `TASK.md`, this plan (§ 0.2).

Feature ids (the kill-switch names; never rename): `sections`, `store-cache`, `captures`,
`headline`, `activity-cards`, `native-links`, `achievements`, `achievements-observer`,
`game-info`, `library-home`, `background-sync`. Safe mode keeps `sections`,
`store-cache`, `captures`. To switch features off, the user runs this in the
SharedJSContext console, then restarts Steam:
`PLUGIN_LIST['steam-cartridges-dev'].setSetting('disabledFeatures', 'game-info,achievements')`.

**Actions** (from `C:\game\millennium\steam-cartridges`):

1. `python ../scratch/arch-m0/m0b/m0b1_blocks.py . check` → 18 lines, order `1.1 1.2 1.4 1.3 2.1 … 2.14`, all `ok`.
2. `python ../scratch/arch-m0/m0b/m0b1_blocks.py . apply` → the same 18 lines.
3. `New-Item -ItemType Directory frontend/safety` (PowerShell) and copy the three files:
   `Copy-Item ../scratch/arch-m0/m0b/safety/features.ts, ../scratch/arch-m0/m0b/safety/boot.ts, ../scratch/arch-m0/m0b/switches.ts frontend/safety/`
   and `Copy-Item ../scratch/arch-m0/m0b/safety.test.ts tests/`.
   Then `Get-ChildItem frontend/safety | % Name` → `boot.ts`, `features.ts`, `switches.ts`.
4. `npm run check` → exit 0, no output.
5. `npm run test:ts` → `ℹ tests 71` / `ℹ pass 71` / `ℹ fail 0`.
6. Write `docs/steam-cartridges/safety.md` from the template (§ 0.6). Contract section:
   copy the exported signatures of `features.ts` and `boot.ts`. "How to add": adding a
   feature id (append to `FEATURE_IDS`, wrap its start-up in `features.run("<id>", …)` in
   `index.tsx`, list it here). Flip the Safety row in `docs/steam-architecture.md` § 3 to `current`.
7. CHANGELOG entries (workspace + plugin), `TASK.md` "Next: M0b-2 (spec) or M0c", § 0.2 row → `Done`.
8. Commit: the files above; message `feat(steam-cartridges): kill switches, error budget and safe mode (M0b-1)`.

**Live:** verifier runs § 0.5. Additionally:
`node scratch/arch-m0/probe.mjs "PLUGIN_LIST['steam-cartridges-dev'].safetyDiagnostics()"` →
`{"safeMode": false, "disabled": [], "tripped": [], "errors": {}}` (pretty-printed), and
after 60 s `node scratch/arch-m0/probe.mjs "localStorage.getItem('steam-cartridges.boot')"`
→ contains `"pending":false`.

The literal blocks (identical to `scratch/arch-m0/m0b/m0b1_blocks.py`):

**Block 1.1** · `frontend/settings/settings.ts`

Before:

```ts
    /** Show external community destinations (Discord, Speedrun, Wiki). Default true. */
    communityShowExternalLinks: boolean;
}
```

After:

```ts
    /** Show external community destinations (Discord, Speedrun, Wiki). Default true. */
    communityShowExternalLinks: boolean;
    /** Kill switches (migration plan M0b): comma-separated feature ids skipped at start-up. Default "". */
    disabledFeatures: string;
}
```

**Block 1.2** · `frontend/settings/settings.ts`

Before:

```ts
    communityShowExternalLinks: true,
};

const VALIDATORS
```

After:

```ts
    communityShowExternalLinks: true,
    disabledFeatures: '',
};

const VALIDATORS
```

**Block 1.4** · `frontend/settings/settings.ts`

Before:

```ts
    communityShowExternalLinks: true,
};
const listeners
```

After:

```ts
    communityShowExternalLinks: true,
    disabledFeatures: '',
};
const listeners
```

**Block 1.3** · `frontend/settings/settings.ts`

Before:

```ts
    communityShowExternalLinks: (raw) => raw !== false,
```

After:

```ts
    communityShowExternalLinks: (raw) => raw !== false,
    disabledFeatures: (raw) => (typeof raw === 'string' ? raw : ''),
```

**Block 2.1** · `frontend/index.tsx`

Before:

```ts
import { triggerSync } from "./features/scraper/sync-manager";
```

After:

```ts
import { triggerSync } from "./features/scraper/sync-manager";
import { features } from "./safety/switches";
import { beginBoot, watchBoot } from "./safety/boot";
```

**Block 2.2** · `frontend/index.tsx`

Before:

```ts
export { setSetting, resetSettings };
```

After:

```ts
export { setSetting, resetSettings };
/** Kill switches, error counts and safe mode (migration plan M0b). */
export const safetyDiagnostics = () => features.diagnostics();
```

**Block 2.3** · `frontend/index.tsx`

Before:

```ts
    // Settings first: the Game Info gate reads them (ADR-0033).
    await initSettings();
```

After:

```ts
    // Settings first: the Game Info gate reads them (ADR-0033).
    await initSettings();

    // ===== Safety (migration plan M0b) =====
    // Kill switches come from the `disabledFeatures` setting. Two starts in a row that
    // never finished cleanly switch safe mode on (capture tier only, ADR-0012).
    features.reload();
    try {
        const boot = beginBoot(window.localStorage);
        if (boot.safeMode) {
            features.setSafeMode(true);
            logger.error(
                `Safe mode: the last ${boot.unclean} starts did not finish cleanly; only sections and captures are on.`,
            );
        }
        watchBoot(window.localStorage, () => features.errorCount(), window);
    } catch (e) {
        logger.warn("Boot sentinel unavailable.", e);
    }
```

**Block 2.4** · `frontend/index.tsx`

Before:

```ts
    if (!registerLibraryApp()) {
```

After:

```ts
    if (features.isEnabled("sections") && !features.run("sections", () => registerLibraryApp())) {
```

**Block 2.5** · `frontend/index.tsx`

Before:

```ts
    ensureStoreCacheHooked();
```

After:

```ts
    features.run("store-cache", () => ensureStoreCacheHooked());
```

**Block 2.6** · `frontend/index.tsx`

Before:

```ts
    installHeadlinePatch();
```

After:

```ts
    features.run("headline", () => installHeadlinePatch());
```

**Block 2.7** · `frontend/index.tsx`

Before:

```ts
    installActivityCardsPatch();
```

After:

```ts
    features.run("activity-cards", () => installActivityCardsPatch());
```

**Block 2.8** · `frontend/index.tsx`

Before:

```ts
    installNativeSections();
```

After:

```ts
    features.run("native-links", () => installNativeSections());
```

**Block 2.9** · `frontend/index.tsx`

Before:

```ts
    initAchievements();
```

After:

```ts
    features.run("achievements", () => initAchievements());
```

**Block 2.10** · `frontend/index.tsx`

Before:

```ts
    void loadAutoRoutingProfiles();
    initSourceView();
    void initGameInfo().catch((e) =>
        logger.error("Game Info feature failed; activity is unaffected.", e),
    );
```

After:

```ts
    features.run("game-info", () => {
        void loadAutoRoutingProfiles();
        initSourceView();
        void initGameInfo().catch((e) => {
            features.reportError("game-info", e);
            logger.error("Game Info feature failed; activity is unaffected.", e);
        });
    });
```

**Block 2.11** · `frontend/index.tsx`

Before:

```ts
    await registerLibraryHome();
```

After:

```ts
    if (features.isEnabled("library-home")) {
        try {
            await registerLibraryHome();
        } catch (e) {
            features.reportError("library-home", e);
        }
    }
```

**Block 2.12** · `frontend/index.tsx`

Before:

```ts
    onPopupCreate((popup, type) => {
        if (type === PopupType.Desktop) {
```

After:

```ts
    onPopupCreate((popup, type) => {
        if (!features.isEnabled("captures")) return undefined;
        if (type === PopupType.Desktop) {
```

**Block 2.13** · `frontend/index.tsx`

Before:

```ts
        handleAppLaunchAchievements(app.appid);

        // Start active observer session while game is running
        void rpc.steamStoreGetMapping(app.appid).then((res) => {
```

After:

```ts
        features.run("achievements-observer", () => handleAppLaunchAchievements(app.appid));

        // Start active observer session while game is running
        if (features.isEnabled("achievements-observer")) void rpc.steamStoreGetMapping(app.appid).then((res) => {
```

**Block 2.14** · `frontend/index.tsx`

Before:

```ts
    triggerSync(3000);
```

After:

```ts
    features.run("background-sync", () => triggerSync(3000));
```


The three new files are in `scratch/arch-m0/m0b/` (`safety/features.ts`, `safety/boot.ts`,
`switches.ts`) and the test in `scratch/arch-m0/m0b/safety.test.ts`. Copy them
byte-for-byte; do not retype them.

### M0b-2 — Fail-open Steam hooks (folded into M3)

**Not executed as its own step** (§ 7.0 D6, decided 2026-09-28): each M3.x step wraps the
hooks it moves in the shape below, and the table's "On error return" column is the
reference for each hook. The forced-error live check below becomes the M3 switch-off check.

**Design** (the architect writes literal blocks against the post-M0a/M0b-1 tree,
dry-runs them, then flips this row to `Ready`): every function we install into Steam
gets this shape, and nothing else changes:

```ts
const original = target.method;
target.method = function (this: any, ...args: any[]) {
    if (!features.isEnabled("<id>")) return original.apply(this, args);
    try {
        /* existing body, unchanged */
    } catch (err) {
        features.reportError("<id>", err);
        return original.apply(this, args);
    }
};
```

| Hook (file · symbol) | Feature id | On error return |
| --- | --- | --- |
| `game-info-patch.ts` · `k.prototype.render` in `patchKComponent` | `game-info` | `origKRender.apply(this, arguments)` |
| `game-info-patch.ts` · `targetG.prototype.render` | `game-info` | `origGRender.apply(this, arguments)` |
| `game-info-patch.ts` · `targetPlayBar.prototype.render` | `game-info` | `origPlayBarRender.apply(this, arguments)` |
| `game-info-patch.ts` · `props` getter in `hookComponentProps` | `game-info` | `this._nsga_raw_props` |
| `game-info-patch.ts` · `GetGameID`, `BHasStoreCategory` in `ensureAppOverviewHooked` | `game-info` | the original method's result |
| `steam/sections.ts` · `patchedGetSections` | `sections` | the original `GetSections` result |
| `steam/activity.ts` · `BIsAppMissing` hook | `store-cache` | original result |
| `steam/gamepad-appid.ts` · jsx handler | `captures` | no-op (handler returns nothing) |
| `steam/headline-patch.ts` · jsx handler | `headline` | no-op |
| `steam/activity-cards-patch.ts` · jsx handler | `activity-cards` | no-op |
| `features/steam-store/native-sections.ts` · `GetAppOverviewByAppID` afterPatch, `Navigator.App` beforePatch, jsx handler | `native-links` | the unmodified return value / no-op |
| `renderers/library-home.tsx` · `OnAppOverviewChange` afterPatch | `library-home` | unmodified |

Tests: none can exercise Steam here. The live check is § 0.5 plus a forced error:
temporarily set `disabledFeatures` to `game-info`, restart, and confirm the other § 0.5
checks still PASS and Game Info shows Steam's stock grey box. Then set it back to `''`.
(This is the one setting the M0b-2 live step may change, and it must restore it.)

### M0c — Architecture test, flake fix, live-test home (Ready after M0b-1 is Done)

**Why:** § 1.6. Rules that are only prose regress.
**Validated:** the test passes on the post-M0b-1 tree (73/73), fails with a clear
message on a planted forbidden import and on an unregistered RPC name, and the
`check_all_tabs.js` fix passed 4 runs in a row live.
**Files:** new `steam-cartridges/tests/architecture.test.ts`, new
`steam-cartridges/tests/architecture-allowlist.json`, `scratch/check_all_tabs.js`,
new `docs/steam-cartridges/README.md`, `docs/steam-architecture.md` § 3, CHANGELOGs, `TASK.md`, this plan.

**Actions** (from `C:\game\millennium\steam-cartridges` unless stated):

1. `Copy-Item ../scratch/arch-m0/m0c/architecture.test.ts tests/`
2. `Set-Content tests/architecture-allowlist.json '[]'`
3. `$env:ARCH_WRITE_ALLOWLIST='1'; npm run test:ts; Remove-Item Env:ARCH_WRITE_ALLOWLIST`
   → ends `ℹ tests 73` / `ℹ pass 73` / `ℹ fail 0`.
4. `node -e "console.log(require('./tests/architecture-allowlist.json').length)"` → `53`. Then
   `node -e "const a=require('./tests/architecture-allowlist.json');console.log(a.filter(x=>x.includes('safety')).join(' | '))"`
   → `index -> safety | safety -> settings`.
5. `npm run test:ts` (without the variable) → `ℹ tests 73` / `ℹ pass 73` / `ℹ fail 0`.
6. From `C:\game\millennium`: `python scratch/arch-m0/m0c/m0c_blocks.py . check` → `STEP 1.1: ok …`, `STEP 1.2: ok …`;
   then `… apply` → the same two lines.
7. Write `docs/steam-cartridges/README.md` (the migration's overview doc; template § 0.6
   adapted: "What it owns" = the layer list of § 4.1 with each layer's status; "May import"
   = the § 4.1 table; "Tests" = `architecture.test.ts`; "How to add a feature" = § 4.6).
   Flip the Overview row in `docs/steam-architecture.md` § 3.
8. Docs + commit: message `test(steam-cartridges): architecture ratchet and RPC registration check (M0c)`;
   paths: the two test files, `scratch/check_all_tabs.js`, `docs/steam-cartridges/README.md`,
   `docs/steam-architecture.md`, CHANGELOGs, `TASK.md`, this plan.

**Live:** verifier runs § 0.5; the `A -> B -> A: activity cards intact` line now prints
`({"cards":N,"days":D,"daysBefore":D})` with the two `D` equal. The temporary re-run
allowance in § 0.5 no longer applies once M0c is `Done`.

The `check_all_tabs.js` blocks (identical to `scratch/arch-m0/m0c/m0c_blocks.py`):

**Block 1.1** · `scratch/check_all_tabs.js`

Before:

```js
    ok('2. Activity feed: "{Username} captured" cards (hasEvent)', activity.captured > 0, activity.captured);
```

After:

```js
    ok('2. Activity feed: "{Username} captured" cards (hasEvent)', activity.captured > 0, activity.captured);
    // Guardrail 15: the A -> B -> A check compares Steam's store (the data signal), not DOM
    // card counts, which Steam reveals progressively (1 or 3 cards for the same data, 2026-09-28).
    const activityDays = () =>
        shared.evaluate(`window.appActivityStore?.GetAppActivity?.(${A})?.appActivityByDay?.length ?? 0`);
    const daysA = await activityDays();
```

**Block 1.2** · `scratch/check_all_tabs.js`

Before:

```js
    let back;
    for (let i = 0; i < 20; i++) {
        back = await view(shared, `/library/app/${A}`, nameA);
        if (back.captured >= 1 && back.captured === activity.captured) break;
        await wait(500);
    }
    ok('A -> B -> A: Post-Game Summary intact', back.postGameSummary);
    ok('A -> B -> A: no error boundary', !back.errorBoundary);
    ok('A -> B -> A: activity cards intact (hasEvent)', back.captured >= 1 && back.captured === activity.captured, back.captured);
```

After:

```js
    let back;
    let daysBack = 0;
    for (let i = 0; i < 20; i++) {
        back = await view(shared, `/library/app/${A}`, nameA);
        daysBack = await activityDays();
        if (back.captured >= 1 && daysBack === daysA) break;
        await wait(500);
    }
    ok('A -> B -> A: Post-Game Summary intact', back.postGameSummary);
    ok('A -> B -> A: no error boundary', !back.errorBoundary);
    ok('A -> B -> A: activity cards intact (hasEvent)', back.captured >= 1 && daysA > 0 && daysBack === daysA, { cards: back.captured, days: daysBack, daysBefore: daysA });
```


### M1 — Kernel (Done)

**Why:** § 1.5, § 4.2. Nothing uses the kernel yet; later steps adopt it.
**Validated:** dry-run on top of M0a+M0b-1+M0c: `tsc` 0, 81/81; no allowlist change
(the kernel imports nothing outside itself).
**Files:** new `steam-cartridges/frontend/kernel/{appid,events,record,surface}.ts`, new
`steam-cartridges/tests/kernel.test.ts`, new `docs/steam-cartridges/kernel.md`,
`docs/steam-architecture.md` § 3, CHANGELOGs, `TASK.md`, this plan.

**Actions:**
1. `New-Item -ItemType Directory frontend/kernel`; `Copy-Item ../scratch/arch-m0/m1/kernel/*.ts frontend/kernel/`;
   `Copy-Item ../scratch/arch-m0/m1/kernel.test.ts tests/`.
   `Get-ChildItem frontend/kernel | % Name` → `appid.ts`, `events.ts`, `record.ts`, `surface.ts`.
2. `npm run check` → exit 0, no output.
3. `npm run test:ts` → `ℹ tests 81` / `ℹ pass 81` / `ℹ fail 0`.
4. `npm run build` → contains `build Succeeded`.
5. `docs/steam-cartridges/kernel.md` per § 0.6 (Contract: copy every `export` of the
   four files; "How to add": a new record part = add it to `RecordPart` and `GameRecord`,
   additive only, per § 4.2).
6. Docs + commit: message `feat(steam-cartridges): architecture kernel (M1)`.

**Live:** none needed (no runtime code path uses the kernel yet); state that in the report.

### 7.0 Architect decisions for M2–M9 (read before any of them)

Found while dry-running M2 on 2026-09-28 against `915cb1a`. They bind every step
below. A step that needs to break one needs an ADR first.

| # | Decision | Why |
| --- | --- | --- |
| D1 | **The architecture test knows the § 4.1 layer rules.** M2 adds `LAYER_RULES` and `ruleAllows()` to `tests/architecture.test.ts`. Rule-allowed edges never enter the allowlist. The allowlist holds only legacy edges, and it only shrinks. The children of `features/`, `sensors/` and `surfaces/` are separate areas (`sensors/view`, `surfaces/sections`), so a sensor or surface that imports another one fails the test. | The M0c ratchet froze the legacy graph. Every new edge the target architecture needs (`sensors -> steam`, `app -> kernel`, `index -> sensors`) would have failed it. |
| D2 | **A file that a node test loads has only `import type` relative imports, or none.** Pure logic goes in `core.ts` (tested); the Steam wiring goes in `index.ts` (not tested). Tests pass collaborators in (e.g. `toShortcutId`). | `node --experimental-strip-types` cannot resolve the extensionless imports that `tsc` and `millennium-ttc` accept. `kernel/` and `buckets/resolve.ts` already follow this. |
| D3 | **Composition-root injection instead of imports.** When module A needs module B and the rules forbid the import, A exports a setter that holds a no-op default (`setCollectionsSource`, `setContentListener`, …). `index.tsx` wires B into it at start-up. The setter's parameter is typed structurally inside A, with no type import from B. | Keeps "one module moves per step": old callers keep working with no forbidden edge. This **replaces** the old M3 idea of `app/legacy-*.ts` adapters: they would read `features/` state, which is an `app -> features` edge the ratchet forbids. |
| D4 | **M3 moves ownership; M4–M7 move data.** In M3 a surface keeps its imperative API (e.g. `setHasContent`), and callers reach it only through D3 setters. Its `render(appid, record)` stays a no-op until the service step that produces the parts it reads (column **Record-driven in** of the M3 table). That step replaces the setter with a read of the record. | No record part has a producer until the backend facade exists (M4). A fake producer in M3 would be the long-lived parallel implementation that § 5 forbids. |
| D5 | **Store writes never run on a Steam render stack.** The view sensor emits on a `setTimeout(0)` (M2). From M4 (the first `record.updated` producer), `record.updated` goes through `app/render-queue.ts`: changed parts are coalesced per appid and flushed to `runner.render` on a `setTimeout(0)`. | A Big Picture sighting arrives from inside a jsx call, which runs inside Steam's render. Legacy code can also update state from inside a render (K6). Guardrail 17. |
| D6 | **M0b-2 is folded into M3.** Each M3.x step wraps the hooks it moves in the M0b-2 fail-open shape, using the "On error return" column of the M0b-2 table. A surface's `id` is its FeatureId. Existing ids are never renamed, because users type them. A surface that takes over several ids (`captures` takes `store-cache`, `captures`, `headline`, `activity-cards`) gets `isEnabled(id)` and `reportError(id, err)` injected and checks the right id in each hook. New ids are appended to `FEATURE_IDS`. | A separate M0b-2 would edit every hook once, and then M3 would move them all again. |
| D7 | **`touches` naming:** `<SteamObject>.<member>` for patches and store writes (`CAppDetailsSections.GetSections`); `jsx:<name>` for a handler on the jsx runtime; `SteamClient.<Api>.<Method>` for client API calls that write. `CWorkshopStore.m_mapPublishedFiles` belongs to `captures`, because `steam/activity.ts` writes it. Its only other writer, `steam/community-store.ts`, is unreachable (K9). | `assertDisjointTouches` throws when a target has two owners. |
| D8 | **`index.tsx`'s exports are a public API** (CDP scripts in `scratch/`, `tests/buckets.mjs`, the settings panel alias block). Names and behaviour stay until M9. | `PLUGIN_LIST[...].bucketReport()`, `setSteamStoreMapping()` and others are called from outside. |
| D9 | **Every step lists its deliberate behaviour deltas.** Any other difference the verifier finds is a bug in the step. | § 5 behaviour freeze. |
| D10 | **Packaging of a `Ready` step:** `scratch/arch-m0/<step>/files/` holds every changed file as dry-run; `<step>_apply.py` (a copy of `m2/m2_apply.py` with new hashes and file lists) checks and applies; `<step>.diff` is the review copy. The plan section says what changed and why, and the script plus the diff are the literal blocks. | For the executing agent, a whole-file copy guarded by a hash of the "before" file is more reliable than 30 find-and-replace blocks, and it still detects a stale plan (`STALE`). |
| D12 | **Payload shapes a surface needs live in the kernel.** `GameMetadata`, `GameCategories`, the achievement schema/unlock records and the artwork URL/asset shapes move from `rpc.ts` to `kernel/record.ts` in the M3 step that first needs them. `rpc.ts` keeps the old names as type aliases until M9. | Surfaces may not import `rpc` (§ 4.1), and a type-only import still counts as an edge. These are the record's own shapes, which the kernel reserved ("filled in by the service steps"). |
| D13 | **Dead code is purged before it would move; temporary code is marked.** Code nothing uses is deleted in a purge step that runs before the layer's moves (M3.0 for the frontend, M4.0 for the backend), never migrated. Temporary live code (D3 ports and setters) is marked on its first line (or above the symbol) with `// PURGE(<step>): <why>. Ledger: migration plan § 7.9.` and listed in § 7.9 with the step that deletes it. M9 ends with `git grep -n "PURGE(" -- frontend` printing nothing. | User decision 4 (2026-09-28): "we delete legacy as the migration is completed" and "no need to migrate dead code". |
| D14 | **Migration steps are pure moves.** A behaviour bug found while moving code (K3, K4, K6, K13) goes to § 12 with its own bugfix plan after M3, and is never fixed inside a move step. | User, 2026-09-28: each layer has a very specific input/job/output; mixing a fix into a move hides which one caused a regression. |
| D11 | **Test files move with their module.** When a step moves a tested file, it updates only the test's import path, and the test body stays byte-identical. This is the one test edit a step may make without saying more. | § 0.1 forbids changing tests to make them pass. A path is not behaviour. |

#### 7.0.1 How an architect turns a `Spec` step into `Ready`

1. Start from a clean `main` whose earlier rows are all `Done`. Create a worktree in your
   scratchpad: `git worktree add <scratch>/wt HEAD --detach`, then link the dependencies:
   `cmd /c mklink /J <scratch>\wt\steam-cartridges\node_modules C:\game\millennium\steam-cartridges\node_modules`.
2. Implement the step's **Design** in the worktree, and nothing else. Run `npm run check`,
   `npm run test:ts` and `npm run build`. Then run `ARCH_WRITE_ALLOWLIST=1 npm run test:ts` and
   compare `git diff tests/architecture-allowlist.json` with the step's **Allowlist delta**.
   An edge that would be *added* means the design is wrong. Fix it with D3. Never list the edge.
3. Package it per D10. From M3 on, commit the step inside the worktree and run
   `python C:/game/millennium/scratch/arch-m0/pack_step.py . HEAD~1 HEAD C:/game/millennium/scratch/arch-m0/<step>`
   (it writes `manifest.json`, `files/` and `<step>.diff`; the executing agent uses `apply_step.py`).
   Replay every package, in order, on a second clean worktree, and diff the result against the dry-run
   tree. The step's expected outputs are what you saw in that replay.
   **Trap:** before removing a worktree, delete the `node_modules` junction link itself (PowerShell:
   `(Get-Item <wt>/steam-cartridges/node_modules -Force).Delete()`). `git worktree remove` follows the
   junction and deletes files in the real `node_modules` (it did on 2026-09-28: `.bin` had to be rebuilt).
4. If the step says "architect live-validates": deploy from the worktree
   (`powershell -ExecutionPolicy Bypass -File dev.ps1` in `<scratch>\wt\steam-cartridges`),
   run § 0.5, then put the user's build back by running `dev.ps1` from
   `C:\game\millennium\steam-cartridges`.
5. Rewrite the step section in the M2 format (Why, Validated, Boundary, Files, What changes,
   Behaviour deltas, Actions with exact outputs, Docs, Commit, Live, Guardrails). Flip § 0.2
   to `Ready`. Remove the worktree with `git worktree remove --force <scratch>/wt`.

---

### M2 — Sensors (Done)

**Why:** § 1.4 (the same trigger is detected three times) and § 4.5.
**Validated:** dry-run on `915cb1a` (M1 Done): `tsc` exit 0, `ℹ tests 87` / `ℹ pass 87` / `ℹ fail 0`,
`build Succeeded`, allowlist 53 → 41 entries. Not live-validated; the verifier runs § 0.5.
**Boundary:** moves detection only. Every handler that reacted to a detector now reacts to a
bus event, with the same body. Owned-apps detection moves in M4, next to its only consumer
(the resolver).
**Files:** new `steam-cartridges/frontend/app/bus.ts`, `frontend/sensors/view/core.ts`,
`frontend/sensors/view/index.ts`, `frontend/sensors/lifecycle/index.ts`,
`frontend/sensors/collections/index.ts`, `tests/sensors.test.ts`; edited
`frontend/features/buckets/collections.ts`, `frontend/features/buckets/ready.ts`,
`frontend/features/source-view.ts`, `frontend/index.tsx`, `tests/architecture.test.ts`,
`tests/architecture-allowlist.json`, `tests/buckets-ready.test.ts`; new `docs/steam-cartridges/sensors.md`;
`docs/steam-architecture.md` § 3; `docs/steam-cartridges/README.md`; `CHANGELOG.md`,
`steam-cartridges/CHANGELOG.md`, `TASK.md`, this plan (§ 0.2 row).
**Do not touch:** `steam/gamepad-appid.ts` and `steam/jsx-hook.ts` (the sensor uses them as they are), `features/buckets/index.ts`,
`resolve.ts`, every other feature, `renderers/`, `settings/`.

**What changes** (the full diff is `scratch/arch-m0/m2/m2.diff`, 769 lines):

| File | Change |
| --- | --- |
| `app/bus.ts` | `export const bus = createEventBus(...)`: the plugin's one bus. A throwing handler is logged (`Handler for "<event>" failed:`) and skipped. |
| `sensors/view/core.ts` | Pure `createViewTracker({ toShortcutId, viewed, left, now })` with `route(raw)` (desktop), `sighting(raw)` (Big Picture), `close(mode)`, `current(mode)`. It emits `viewed` only when a mode moves to a new shortcut, and `left` for the shortcut it moves away from. Big Picture has no "leave" signal, so the same appid seen again after `GAMEPAD_QUIET_MS` (2000) of silence counts as a new view. |
| `sensors/view/index.ts` | `installViewSensor(bus)`: desktop = `onLocationChange` on the main window's route (the code that was in `index.tsx` and `source-view.ts`). Big Picture = `watchGamepadAppid`, counted only while a Big Picture window is open. It emits on `setTimeout(0)` (D5) and logs `Viewed shortcut <appid> (<mode>).` / `Left shortcut <appid> (<mode>).` |
| `sensors/lifecycle/index.ts` | `installLifecycleSensor(bus)`: `onAppLaunch` → `shortcut.launched { appid, name }`, and `onQuit` → `shortcut.quit { appid }`, for shortcuts only. |
| `sensors/collections/index.ts` | `isCollectionStoreReady` and `readUserCollections`, moved verbatim from `features/buckets/ready.ts`, plus `collectionsSource = { ready(), list() }` over `window.collectionStore`. |
| `features/buckets/collections.ts` | Reads through an injected `CollectionsSource` (D3: `setCollectionsSource`; the default is "not ready"). It no longer touches `window.collectionStore`. The API is unchanged. |
| `features/buckets/ready.ts` | Keeps only `pendingOr`. |
| `features/source-view.ts` | Both detectors are deleted. `onSourceView` normalizes with `toShortcutId` from the kernel. `initSourceView` now only replays views deferred until collections were ready. |
| `index.tsx` | `setCollectionsSource(collectionsSource)` is the first line of `init()`. The game-info block subscribes `onSourceView` to `shortcut.viewed`. The captures handlers `patchLibraryApp` / `unpatchLibraryApp` subscribe to `shortcut.viewed` / `shortcut.left`. The Big Picture thumbnail `<style>` injection stays, in an `onPopupCreate` that handles only `Gamepad`. Launch and quit run as bus handlers with a `sessions` map. `installViewSensor(bus)` and `installLifecycleSensor(bus)` run **last**, because they report the current page and the already-open windows immediately. |
| `tests/architecture.test.ts` | D1: `GROUPED`, `LAYER_RULES`, `ruleAllows`; the ratchet ignores rule-allowed edges and reports allowlisted ones as redundant; +1 test (`layer rules allow the § 4.1 edges and nothing it forbids`). |
| `tests/architecture-allowlist.json` | −12: `features/source-view -> steam` and the 11 `index -> *` edges (now allowed by rule). |
| `tests/buckets-ready.test.ts` | The import path of the two moved functions (D11). |
| `tests/sensors.test.ts` | +5 tests: one view per desktop navigation, A → B order, signed appids, Big Picture re-render dedupe plus re-open after silence, independent modes and `close`. |

**Behaviour deltas** (deliberate, D9):
1. Desktop, shortcut A → shortcut B directly: A is now unpublished (`unpatchLibraryApp(A)`) before
   B is published, as Big Picture already did. Before, A stayed published.
2. A route change that stays on the same shortcut (search, hash or sub-page) no longer re-publishes
   captures and no longer re-runs the view pipeline.
3. Big Picture: re-renders of an open page are one view. Before, every render re-ran the pipeline
   and re-published captures. Sightings count only while a Big Picture window exists; before,
   `source-view.ts` also listened in desktop mode.
4. Launch and quit handlers get the unsigned appid. Before, they got Steam's raw value.
5. A game that quits before its Steam mapping has loaded now stops its achievement observer.
   Before, the `onQuit` registered after the quit never ran, which leaked the observer.
6. View events run on a timer after the signal, never on Steam's render stack (D5).
7. Two new log lines per navigation, `Viewed shortcut …` and `Left shortcut …`. They are the
   verification signal below.

**Actions** (from `C:\game\millennium\steam-cartridges`):

1. `python ../scratch/arch-m0/m2/m2_apply.py . check` → exactly these 13 lines, exit code 0:
   ```
   EDIT frontend/features/buckets/collections.ts: ok
   EDIT frontend/features/buckets/ready.ts: ok
   EDIT frontend/features/source-view.ts: ok
   EDIT frontend/index.tsx: ok
   EDIT tests/architecture-allowlist.json: ok
   EDIT tests/architecture.test.ts: ok
   EDIT tests/buckets-ready.test.ts: ok
   NEW frontend/app/bus.ts: ok
   NEW frontend/sensors/view/core.ts: ok
   NEW frontend/sensors/view/index.ts: ok
   NEW frontend/sensors/lifecycle/index.ts: ok
   NEW frontend/sensors/collections/index.ts: ok
   NEW tests/sensors.test.ts: ok
   ```
   Any line with `STALE` means stop (§ 0.8). The script has written nothing.
2. `python ../scratch/arch-m0/m2/m2_apply.py . apply` → the same 13 lines, exit code 0.
3. `git diff --stat` → last line ` 7 files changed, 117 insertions(+), 144 deletions(-)`.
   `git status --short` → the 7 `M` paths from action 1, plus `?? frontend/app/`,
   `?? frontend/sensors/`, `?? tests/sensors.test.ts`.
4. `git grep -n --untracked "onLocationChange\|onAppLaunch(\|watchGamepadAppid(" -- frontend` → exactly:
   ```
   frontend/sensors/lifecycle/index.ts:13:    onAppLaunch((app, { onQuit }) => {
   frontend/sensors/view/index.ts:6:import { onLocationChange, onPopupCreate, PopupType } from "steambrew-utils/watchers";
   frontend/sensors/view/index.ts:18: * already open and onLocationChange reports the current route immediately.
   frontend/sensors/view/index.ts:43:    watchGamepadAppid((appid) => {
   frontend/sensors/view/index.ts:49:            const stop = onLocationChange(
   frontend/steam/gamepad-appid.ts:129:export function watchGamepadAppid(onAppid: (appid: number) => void): () => void {
   ```
   (one detector each, all inside `sensors/`).
5. `npm run check` → § 0.3 (exit 0, no output).
6. `npm run test:ts` → `ℹ tests 87` / `ℹ pass 87` / `ℹ fail 0`.
7. `npm run build` → contains `build Succeeded`.
8. `node -e "console.log(require('./tests/architecture-allowlist.json').length)"` → `41`.
9. Docs:
   - Write `docs/steam-cartridges/sensors.md` per § 0.6. **What it owns:** detecting page views,
     launches and quits, and reading collection membership; nothing else detects these.
     **Contract:** copy the exports of `sensors/view/core.ts`, `sensors/view/index.ts`,
     `sensors/lifecycle/index.ts`, `sensors/collections/index.ts` and `app/bus.ts`.
     **Steam targets touched:** none (sensors only read). **May import:** the § 4.1 sensors row, plus
     "sensors never import each other: D1 makes each sensor folder its own area". **Tests:**
     `sensors.test.ts` (the tracker), `buckets-ready.test.ts` (collections reads),
     `architecture.test.ts`. Live: § 0.5 and the M2 `Viewed shortcut` count. **How to add a sensor:**
     (1) create `frontend/sensors/<name>/index.ts` with `install<Name>Sensor(bus: EventBus)`
     that emits kernel events only; (2) put pure logic in `core.ts` (D2) and test it;
     (3) if it needs a new event, add it to `kernel/events.ts` `Events` (additive only);
     (4) call the install function in `index.tsx` **after** every subscriber of its events;
     (5) the handlers go in `index.tsx` (M2–M3) or in `app/` (M4+). **History:** `M2 (2026-09-28): created`.
   - `docs/steam-architecture.md` § 3: the Sensors row becomes
     `| Sensors: view, lifecycle, collections (owned apps: M4) | [sensors.md](steam-cartridges/sensors.md) (M2) | current |`.
   - `docs/steam-cartridges/README.md`: in "What it owns", mark `sensors/` and `app/` (bus only) as current.
     Under "May import", add one line: "Rule-allowed edges are listed in `LAYER_RULES` in
     `tests/architecture.test.ts` (D1) and never in the allowlist."
   - `CHANGELOG.md`, at the top of the list:
     ```markdown
     - **steam-cartridges: sensors own detection (migration M2, 2026-09-28)**: page views, launches/quits and collection membership are each detected in one place (`frontend/sensors/`) and published on one bus; the three view detectors of plan § 1.4 are gone. The architecture test now knows the § 4.1 layer rules (allowlist 53 → 41). Deltas: plan § 7 M2 "Behaviour deltas".
     ```
   - `steam-cartridges/CHANGELOG.md`, under `## [Unreleased]`, first item:
     ```markdown
     - **Changed: one place detects which game page is open (2026-09-28)**: desktop and Big Picture page views, game launches and quits now come from dedicated sensors. Big Picture no longer re-runs the page pipeline on every re-render; switching directly between two non-Steam games now clears the first one's activity, as Big Picture already did.
     ```
   - `TASK.md` § Now: replace `Next: **M2** (sensors, spec; needs an architect pass first), or M0b-2 (spec).`
     with `M2 done (sensors). Next: **M3.1** (sections surface, Ready).`
   - This plan, § 0.2: M2 → `Done`.
10. Commit (§ 0.7) with paths `steam-cartridges/frontend/app steam-cartridges/frontend/sensors steam-cartridges/tests/sensors.test.ts steam-cartridges/frontend/features/buckets/collections.ts steam-cartridges/frontend/features/buckets/ready.ts steam-cartridges/frontend/features/source-view.ts steam-cartridges/frontend/index.tsx steam-cartridges/tests/architecture.test.ts steam-cartridges/tests/architecture-allowlist.json steam-cartridges/tests/buckets-ready.test.ts docs/steam-cartridges/sensors.md docs/steam-cartridges/README.md docs/steam-architecture.md CHANGELOG.md steam-cartridges/CHANGELOG.md TASK.md docs/plans/steam-cartridges-architecture-migration-plan.md`
    and message `refactor(steam-cartridges): sensors own view, lifecycle and collections detection (M2)`.

**Live:** the verifier runs § 0.5. Before `count_cycle.mjs`, the main window must show the
library home, not AM2R: a view is a *change* of page. Additional PASS conditions:
- `count_cycle.mjs 4263274102` prints a line of the form `    1 A:page :: … Viewed shortcut # (desktop).`
  (count exactly 1), and no `B:properties` line contains `Viewed shortcut`.
- In Big Picture (`..\start-steam-dev.ps1 -BigPicture`), `node scratch/check_all_tabs.js` → eleven `PASS`.
- Optional user check (only the user can launch games): launch AM2R, wait 15 s, quit. The
  SharedJSContext console then shows `AM2R closed; refreshing its activity.` once.

**Guardrail checklist:** 2 (the jsx observer does one id comparison and at most one `setTimeout`) ·
6 (A → B → A: `check_all_tabs.js` and `test_nav_cycle.js`) · 12 (the view sensor uses only the
Desktop and Gamepad popups, and Properties and dialogs are ignored on purpose) · 13 (membership is
read only by `sensors/collections`; `renderers/library-home.tsx` patches `OnAppOverviewChange`,
which is a write owned by M3.10) · 15 (no check edited) · 17 (sensors emit on a timer, never
inside a Steam render: D5).

### M3.0–M3.10 — Dead-code purge, then surfaces (Ready, one step each, in this order)

**Why:** § 1.2 (no single owner of Steam mutations) and § 4.4. M3.0 first deletes the frontend
code nothing uses, so no step moves dead code (user, 2026-09-28: "no need to migrate dead code").
After M3, every Steam write lives under `frontend/surfaces/`, one folder per surface, each with
declared `touches`, a kill switch and fail-open hooks, and `frontend/renderers/` no longer exists.
One exception remains until M6b: K14 (`observer-session.ts` writes the spotlight session).
**Validated (all eleven, 2026-09-28):** dry-run cumulatively on top of M2 (tree `5b6b2c8` + M2).
Then the packages were **replayed** on a clean worktree in order (M2, then M3.0 … M3.10):
every `check` all `ok`, `tsc` with 0 errors, tests green after every step, `build Succeeded`,
and the replayed tree byte-identical to the dry-run tree. Not live-validated: the verifier runs
the live checks after each step.
**Boundary:** M3.0 only deletes; M3.1–M3.10 are pure moves (user, 2026-09-28: "each layer has a very specific input/job/output").
Code moves into its surface. Callers reach it through D3 setters wired in `index.tsx`. Hooks get the
D6 fail-open wrapper. Known behaviour bugs stay as they are: K3, K4, K6 and K13 go to their own
bugfix plans (§ 12).

#### Common to every M3.x step (read before each one)

**Tool:** `scratch/arch-m0/apply_step.py` (generic; one `scratch/arch-m0/<step>/manifest.json` per
step, with the new content in `<step>/files/` and the review diff in `<step>/<step>.diff`).

**Actions** (from `C:\game\millennium\steam-cartridges`; `<step>` is `m3.0` … `m3.10`):

1. `python ../scratch/arch-m0/apply_step.py <step> check` → exactly the step's **Check lines** below,
   in that order (`EDIT` sorted, then `DELETE`, then `NEW`), each ending in `: ok`, exit code 0.
   Any `STALE` means stop (§ 0.8). The script has written nothing. `STALE` on a first run usually
   means an earlier step is not applied.
2. `python ../scratch/arch-m0/apply_step.py <step> apply` → the same lines, exit code 0. It writes the
   edited and new files, deletes the `DELETE` files and removes folders left empty.
3. `npm run check` → exit 0, no output after the npm banner.
4. `npm run test:ts` → `ℹ tests <T>` / `ℹ pass <T>` / `ℹ fail 0`, with `<T>` from the step table.
5. `npm run build` → contains `build Succeeded`.
6. `node -e "console.log(require('./tests/architecture-allowlist.json').length)"` → `<A>` from the step table.
7. `git status --short` → one line per manifest path (` M` for `EDIT`, ` D` for `DELETE`, `??` for `NEW`;
   a folder that is entirely new shows once as `?? <folder>/`) and nothing else.
8. Docs: the common list below, plus the step's own.
9. Commit (§ 0.7). Stage with
   `git add -- $(python ../scratch/arch-m0/apply_step.py <step> paths)` (the manifest paths, one per
   line; this works in PowerShell and in bash, and stages deletions too), then `git add` the doc paths
   from the repo root. The message is in the step table.

**Docs, every step:**
- `docs/steam-cartridges/surfaces.md`: M3.1 creates it per § 0.6. Its **Contract** section holds
  `Surface` and `SurfaceDeps` from `kernel/surface.ts`, and **How to add a surface** is the common
  design of this section. Each step then adds one `## <id>` section with: `touches` (one row per
  target, with the guardrail that governs it), `reads`, the kill switch(es), the injected deps, the
  API and the setter the features use to reach it, the hooks with their fail-open return, and
  "Record-driven in: <step>".
- `steam-cartridges/README.md` module table: replace the rows of moved files with their new paths.
- `CHANGELOG.md`, at the top of the list: `- **steam-cartridges: <surface> surface (migration <step>, <date>)**: <one line from "What changes">. Allowlist <A-before> → <A>.`
- `steam-cartridges/CHANGELOG.md`: only for steps with a **User-visible** line (new kill switches).
- `TASK.md` § Now: `<step> done. Next: <next step>.` (after M3.10: `M3 done; the feature freeze (§ 5) ends. Next: M4 (spec).`)
- This plan, § 0.2: the step's row → `Done`.

**Live, every step:** the verifier runs § 0.5, then the **switch-off check**: run
`PLUGIN_LIST['steam-cartridges-dev'].setSetting('disabledFeatures', '<id>')` in the SharedJSContext
console and restart Steam (`..\start-steam-dev.ps1 -Restart`). Confirm that the other § 0.5 checks
still PASS and the view the step names falls back to Steam's stock behaviour. Then set
`disabledFeatures` back to `''` and restart. This is the only setting M3 live checks may change,
and they must restore it.

**Behaviour delta common to all M3 steps (D6):** every wrapped hook reads its kill switch when it
is **called**, not only at install, so a switch changed in settings takes effect for existing hooks
without a restart. The live checks still restart.

| Step | Surface | Check lines (E/D/N) | Tests `<T>` | Allowlist `<A>` | Commit message |
| --- | --- | --- | --- | --- | --- |
| M3.0 | — (dead-code purge) | 10 / 4 / 0 | 86 | 39 | `chore(steam-cartridges): purge dead frontend code (M3.0)` |
| M3.1 | `sections` | 6 / 1 / 1 | 86 | 38 | `refactor(steam-cartridges): sections surface (M3.1)` |
| M3.2 | `captures` | 4 / 5 / 8 | 86 | 35 | `refactor(steam-cartridges): captures surface (M3.2)` |
| M3.3 | `game-info` | 10 / 3 / 5 | 86 | 35 | `refactor(steam-cartridges): game-info surface (M3.3)` |
| M3.4 | `playbar` | 5 / 0 / 2 | 87 | 35 | `refactor(steam-cartridges): playbar surface (M3.4)` |
| M3.5 | `achievements` | 7 / 3 / 5 | 87 | 35 | `refactor(steam-cartridges): achievements surface (M3.5)` |
| M3.6 | `toasts` | 5 / 1 / 5 | 87 | 35 | `refactor(steam-cartridges): toasts surface (M3.6)` |
| M3.7 | `native-links` | 4 / 2 / 2 | 87 | 35 | `refactor(steam-cartridges): native-links surface (M3.7)` |
| M3.8 | — (purge markers on the two ports) | 2 / 0 / 0 | 87 | 35 | `chore(steam-cartridges): mark temporary ports for purge (M3.8)` |
| M3.9 | `artwork` | 6 / 2 / 4 | 87 | 33 | `refactor(steam-cartridges): artwork surface (M3.9)` |
| M3.10 | `library-home` | 2 / 1 / 2 | 87 | 31 | `refactor(steam-cartridges): library-home surface (M3.10)` |

`index.tsx` after M3: one `SurfaceRunner` and one `surfaceDeps` (`isEnabled` / `reportError` from
`safety/switches`). All D3 setters are wired at the top of `init()`, and each surface is registered
and installed (`runner.register(...)`, `runner.installAll()`) where its old start-up call was, so
the start-up order is unchanged.

#### M3.0 — Purge dead frontend code (Done)

**Why:** user decision 4 (§ 11): dead code is deleted, never migrated. Found with a TypeScript
language-service sweep (reachability from `frontend/index.tsx` plus `findReferences` on every
export) and verified by hand. After M3.0 the sweep reports nothing dead except `unpatchSections`,
which M3.1 gives a job as the sections surface's `uninstall`.
**Check lines:**
```
EDIT frontend/features/achievements/types.ts: ok
EDIT frontend/features/artwork/artwork.ts: ok
EDIT frontend/features/game-info/game-info-patch.ts: ok
EDIT frontend/features/game-info/metadata.ts: ok
EDIT frontend/features/steam-store/index.ts: ok
EDIT frontend/renderers/library-app.tsx: ok
EDIT frontend/rpc.ts: ok
EDIT frontend/steam/gameid.ts: ok
EDIT frontend/steam/modules.ts: ok
EDIT tests/architecture-allowlist.json: ok
DELETE frontend/renderers/community-tab.tsx: ok
DELETE frontend/steam/community-core.ts: ok
DELETE frontend/steam/community-store.ts: ok
DELETE tests/community.test.ts: ok
```
**What it deletes** (deletions only; the diff adds a single line, a trimmed import):

| Deleted | Why it is dead |
| --- | --- |
| `renderers/community-tab.tsx`, `steam/community-store.ts`, `steam/community-core.ts`, `tests/community.test.ts` (its 1 test) | nothing imports `community-tab.tsx`; the other two only serve it (K9) |
| `applyCustomArtwork` (artwork.ts) | never called; left over from `steamgriddb-artwork`'s bundle flow |
| `NotificationStoreInstance` (achievements/types.ts), `STEAM_CATEGORIES` (game-info/metadata.ts), `getCachedCategoriesForApp` (game-info-patch.ts), `unpatchAll` (library-app.tsx), `appIdFromGameId` (steam/gameid.ts, replaced by the kernel's `fromGameId`), `resolveClassMap` (steam/modules.ts, the Big Picture clone fallback's helper) | exported, never referenced |
| `acceptSteamStoreSuggestion`, `rejectSteamStoreSuggestion` (steam-store/index.ts) | exported, never referenced (the settings panel uses `setSteamStoreMapping` directly) |
| `rpc.ts` wrappers `getDiagnostics`, `saveGameMetadata`, `getArtworkForGame`, `steamStoreRejectSuggestion`, `getGameMedia`, `getGameManual`, `getGameTrailers`, `getGameCommunityLinks`, and the types only they used: `Diagnostics`, `ImageAsset`, `ArtworkBundle`, `GameArtworkResponse`, `GameMediaResponse`, `GameManualResponse`, `GameTrailerItem`, `GameTrailersResponse`, `GameCommunityLinkItem`, `GameArtworkCommunityItem`, `GameCommunityLinksResponse` | no frontend caller (the four community ones only had the dead `community-store.ts`) |

The backend methods behind those wrappers stay registered in `main.lua` (a registered but uncalled
method is harmless; an unregistered called one crashes the host). They are **unwired features**, not
dead code (§ 7.10): M4.0 classifies them and M5c/M5d/the Media service connect them.
- Allowlist −2: `renderers -> settings`, `steam -> rpc`. Tests 87 → 86 (the deleted `community.test.ts`
  tested only deleted code; this is the one test deletion the migration makes, and it says so here).
**Deltas:** none (nothing deleted was reachable). **Extra docs:** none beyond the common list; in the
`CHANGELOG.md` line, name the four files and "dead exports and RPC wrappers (plan M3.0 table)".
**Live:** § 0.5 only (no switch-off check: no surface yet).

#### M3.1 — `sections` (Done)

**Check lines:**
```
EDIT frontend/features/achievements/store.ts: ok
EDIT frontend/features/steam-store/index.ts: ok
EDIT frontend/index.tsx: ok
EDIT frontend/kernel/surface.ts: ok
EDIT frontend/renderers/library-app.tsx: ok
EDIT tests/architecture-allowlist.json: ok
DELETE frontend/steam/sections.ts: ok
NEW frontend/surfaces/sections/index.ts: ok
```
**What changes:**
- `steam/sections.ts` → `surfaces/sections/index.ts`, plus `createSectionsSurface(deps)`:
  `touches` `CAppDetailsSections.GetSections`, `CAppDetailsSections.m_setSectionsMemo`; `reads`
  identity, metadata, achievements. `install` throws if the registry component is not found; the old
  error log in `index.tsx` stays and now reads `runner.status()`.
- `patchedGetSections` is fail-open: Steam's `base.call` runs first, exactly as before, and a throw in
  our part returns Steam's result and counts against `sections`.
- `kernel/surface.ts` gains `SurfaceDeps { isEnabled(id), reportError(id, err) }` (additive).
- D3 setters replace imports: `setGameInfoProbe` (sections ← game-info `isAppEnriched`),
  `setContentListener` (`library-app` → `setHasContent`), `setExtraSectionsSink` (`steam-store` →
  `setExtraSections`), `setSectionsRefresher` (achievements store → `refreshSections`).
  `library-app.register()` is deleted, because install belongs to the runner.
- Allowlist −1: `steam -> features/game-info`.
**Deltas:** the common one, plus one out-of-scope bugfix (K16, user decision 2026-09-28): the switch-off
live check surfaced that every kill switch was inert (`settings.ts` `apply()` discarded any stored value
that wasn't valid JSON, which `disabledFeatures` never is). Fixed in `settings.ts` in this step because
every remaining M3.x switch-off check depends on it; the fix is one line (keep the original string on a
`JSON.parse` failure instead of discarding it) and touches no M3.1 file. **Extra docs:** create
`surfaces.md`; in `docs/steam-architecture.md` § 3, flip the Surfaces row to `current` with a link; add
`SurfaceDeps` to `kernel.md` Contract (History: `M3.1: SurfaceDeps`); § 12 gets K16.
**Extra live:** switch-off `sections` → the Post-Game Summary and Activity sections are gone and Steam
shows "information is unavailable". **Verified 2026-09-28** (live, after the K16 fix): `disabled` reads
`["sections"]` in `safetyDiagnostics()` across a restart; the desktop AM2R page drops "Post-Game Summary"
and "Activity" and shows Steam's "detailed information … is unavailable" text; § 0.5 baseline (render
loop PASS, 11/11 `check_all_tabs.js`) still holds with the switch restored to `''`.

#### M3.2 — `captures` (Done)

**Check lines:**
```
EDIT frontend/features/scraper/on-update.ts: ok
EDIT frontend/features/steam-store/index.ts: ok
EDIT frontend/index.tsx: ok
EDIT tests/architecture-allowlist.json: ok
DELETE frontend/renderers/library-app.tsx: ok
DELETE frontend/steam/activity-cards-patch.ts: ok
DELETE frontend/steam/activity.ts: ok
DELETE frontend/steam/headline-patch.ts: ok
DELETE frontend/steam/summary.ts: ok
NEW frontend/surfaces/captures/activity-cards.ts: ok
NEW frontend/surfaces/captures/activity.ts: ok
NEW frontend/surfaces/captures/bpm-style.ts: ok
NEW frontend/surfaces/captures/deps.ts: ok
NEW frontend/surfaces/captures/headline.ts: ok
NEW frontend/surfaces/captures/index.ts: ok
NEW frontend/surfaces/captures/publish.ts: ok
NEW frontend/surfaces/captures/summary.ts: ok
```
**What changes:**
- Moves into `surfaces/captures/`: `summary.ts`, `activity.ts`, `headline.ts` (ex `headline-patch.ts`),
  `activity-cards.ts` (ex `activity-cards-patch.ts`), `publish.ts` (ex `renderers/library-app.tsx`) and
  `bpm-style.ts` (the Big Picture thumbnail `<style>` block, moved out of `index.tsx`).
- `touches`: `AppSpotlightStore.GetOrCreateAppData`, `AppActivityStore.m_mapAppActivity`,
  `StoreItemCache.m_mapApps`, `StoreItemCache.m_setUnavailableApps`, `StoreItemCache.BIsAppMissing`,
  `CWorkshopStore.m_mapPublishedFiles`, `jsx:headline`, `jsx:activity-cards`, `BPM.style#nsga-bpm-activity-thumbs`.
- Four kill switches in one surface (D6): `install` installs each part under its own id
  (`store-cache`, `headline`, `activity-cards`). The `BIsAppMissing` hook, the headline observer and the
  activity-cards `replaceType` are fail-open under their own id. `activity.ts` gets the two activity
  settings through `deps.activityOptions()` in place of importing `settings`.
- D3 setters: `setCapturesSinks({ setNativeActivitySource, republish })` (steam-store) and
  `setCapturesRefresher` (scraper/on-update).
- `index.tsx` public exports (D8) are unchanged: `registerSummaryProvider`, the `Summary*` types,
  `headlineJsxDiagnostics` and `activityCardsJsxDiagnostics` are now re-exported from `surfaces/captures`.
- Allowlist −3: `features/scraper -> renderers`, `features/steam-store -> renderers`, `steam -> settings`.
**Deltas:** (1) switching `captures` off now also skips `store-cache`, `headline` and `activity-cards`
(the runner does not install a switched-off surface; the three parts only serve captures).
(2) The Big Picture `<style>` is registered when the surface installs, earlier in start-up, and
`onPopupCreate` replays open windows, so the result is the same. (3) The CSS text inside the
template literal is indented 4 spaces more (whitespace only).
**Extra live:** switch-off `captures` → no Post-Game Summary cards and no activity cards; then
switch-off `headline` alone → the activity headline reads "shared N screenshots" again.

#### M3.3 — `game-info` (Done)

**Check lines:**
```
EDIT frontend/features/game-info/controller.ts: ok
EDIT frontend/features/game-info/index.ts: ok
EDIT frontend/features/scraper/on-update.ts: ok
EDIT frontend/features/steam-store/index.ts: ok
EDIT frontend/features/steam-store/native-sections.ts: ok
EDIT frontend/index.tsx: ok
EDIT frontend/kernel/record.ts: ok
EDIT frontend/rpc.ts: ok
EDIT tests/category-policy.test.ts: ok
EDIT tests/routing-rules.test.ts: ok
DELETE frontend/features/game-info/category-policy.ts: ok
DELETE frontend/features/game-info/game-info-patch.ts: ok
DELETE frontend/features/game-info/metadata.ts: ok
NEW frontend/surfaces/game-info/category-policy.ts: ok
NEW frontend/surfaces/game-info/deps.ts: ok
NEW frontend/surfaces/game-info/index.ts: ok
NEW frontend/surfaces/game-info/metadata.ts: ok
NEW frontend/surfaces/game-info/patch.ts: ok
```
**What changes:**
- `game-info-patch.ts` → `surfaces/game-info/patch.ts`; `metadata.ts` and `category-policy.ts` move with
  it. `normalize.ts`, `policy.ts` and `controller.ts` stay in `features/game-info` (pipeline and policy).
- **D12:** `GameMetadata` (the `ConsolidatedMetadata` shape) and `GameCategories` move from `rpc.ts` into
  `kernel/record.ts`; `rpc.ts` keeps both names as type aliases, so no other importer changes.
  `controller.ts` keeps a structural copy of `ControllerContext` (D3).
- `touches`: `GameInfo.k.render`, `GameInfo.k.props`, `GameInfo.G.render`, `GameInfo.G.props`,
  `PlayBar.render`, `PlayBar.props` (until M3.4), `AppOverview.GetGameID`, `AppOverview.BHasStoreCategory`,
  `AppOverview.rt_original_release_date`, `AppOverview.m_setStoreCategories`,
  `AppDetailsStore.descriptionsData`, `AppDetailsStore.associationData`.
- Fail-open on all seven hooks: k/G/PlayBar `render` run Steam's original on error; the `props` getter
  returns `this._nsga_raw_props`; `GetGameID` and `BHasStoreCategory` return the original's result.
  `install` = `setCachedStores` + `patchGameInfoComponent` (moved out of `initGameInfo`).
- One webpack scanner (guardrail 3): `getSteamRequire` is deleted; `patch.ts` and
  `native-sections.ts` use `steamRequire()` from `steam/modules.ts` (same chunk-push technique).
- D3: `setGameInfoWriter` (features/game-info), `setGameInfoSink` (steam-store) and
  `setGameInfoEnricher` (scraper), all wired to `gameInfoWriter { enrich, revert, refresh, isEnriched }`.
  The surface gets `controllerContext` and `metadataOf` (= `getCachedLibraryMetadata`) as deps.
- Allowlist: no change. `steam-store -> game-info` and `scraper -> game-info` remain because of
  `normalize.ts` (M5).
**Deltas:** `steamRequire` caches a failed capture, where `getSteamRequire` retried on every call. Both
callers call it once at start-up, so there is no practical difference.
**Extra docs:** `kernel.md` (History: `M3.3: GameMetadata, GameCategories (D12)`).
**Extra live:** the three Properties checks of § 0.5 are the core of this step. Switch-off `game-info` →
Steam's stock grey Game Info box, no ⓘ button, no Properties hang.

#### M3.4 — `playbar` (Done)

**Check lines:**
```
EDIT frontend/index.tsx: ok
EDIT frontend/safety/features.ts: ok
EDIT frontend/surfaces/game-info/index.ts: ok
EDIT frontend/surfaces/game-info/patch.ts: ok
EDIT tests/architecture.test.ts: ok
NEW frontend/steam/overview-proxy.ts: ok
NEW frontend/surfaces/playbar/index.ts: ok
```
**What changes:**
- The PlayBar lookup and hooks leave `game-info` for `surfaces/playbar`. PlayBar is resolved with
  `resolveOnce` (the shared scanner) by its static signature. The props getter is the
  `requireMetadata: false` path of game-info's `hookComponentProps`; the render fallback is moved verbatim.
- `createPatchedOverview` → `steam/overview-proxy.ts`. A new architecture test (+1) asserts that
  only `surfaces/game-info` and `surfaces/playbar` import it (guardrail 1).
- The PlayBar hooks call game-info's `ensureAppOverviewHooked` and `trackInstance` through deps, and
  the PlayBar class keeps the `__nsga_props_hooked` flag, so `refreshGameInfoInstances` still re-renders it.
- New FeatureId `playbar` (appended). The ⓘ button is on only while both `playbar` **and**
  `game-info` are on, as before the split.
**Deltas:** none. **User-visible:** a new kill switch, `playbar`. **Extra docs:** `safety.md`
(FeatureId list). **Extra live:** the desktop PlayBar of AM2R shows the ⓘ button; switch-off
`playbar` → the ⓘ button is gone and Game Info itself stays.
**K4** ("Mark as Private"): untouched here, per the user (pure move); see § 12.

#### M3.5 — `achievements` (Done)

**Check lines:**
```
EDIT frontend/features/achievements/index.ts: ok
EDIT frontend/features/achievements/launch-toast.ts: ok
EDIT frontend/features/achievements/observer-session.ts: ok
EDIT frontend/index.tsx: ok
EDIT frontend/kernel/record.ts: ok
EDIT frontend/rpc.ts: ok
EDIT tests/achievements.test.ts: ok
DELETE frontend/features/achievements/achievements-core.ts: ok
DELETE frontend/features/achievements/store.ts: ok
DELETE frontend/features/achievements/types.ts: ok
NEW frontend/features/achievements/store-port.ts: ok
NEW frontend/steam/achievement-types.ts: ok
NEW frontend/surfaces/achievements/core.ts: ok
NEW frontend/surfaces/achievements/index.ts: ok
NEW frontend/surfaces/achievements/store.ts: ok
```
**What changes:**
- `store.ts` and `achievements-core.ts` (→ `core.ts`) move to `surfaces/achievements/`. `types.ts` holds
  Steam's own achievement shapes and moves to `steam/achievement-types.ts`, where surfaces may import it.
- **D12:** `AchievementSchemaItem`, `AchievementSchemaRecord` and `AchievementUnlockRecord` move to the
  kernel; `rpc.ts` keeps the names.
- Fail-open on all six hooks (`AppDetailsStore.GetAchievements`; `AchievementsFullStore`
  `LoadMyAchievements`, `GetMyAchievements`, `GetGlobalAchievements`, `GetPlayerAchievements`,
  `LoadFriendAchievements`) through one `failOpen()` helper. It handles sync throws and rejected promises.
- The features reach the store through `features/achievements/store-port.ts` (D3; `PURGE(M6)` from M3.8).
  Its five functions have the old names, so the feature files only change an import path. The
  retry loop in `initAchievements` stays.
**Deltas:** none. **Extra docs:** `kernel.md` History (D12 types).
**Extra live:** before deploying, the verifier runs `node scratch/test_animaniacs_achievements.mjs` on
the current build and keeps the output; after deploying, the output must be identical. Switch-off
`achievements` → the Achievements section of a mapped game shows Steam's stock state.

#### M3.6 — `toasts` (Done)

**Check lines:**
```
EDIT frontend/features/achievements/index.ts: ok
EDIT frontend/features/achievements/launch-toast.ts: ok
EDIT frontend/features/achievements/observer-session.ts: ok
EDIT frontend/index.tsx: ok
EDIT frontend/safety/features.ts: ok
DELETE frontend/features/achievements/dispatcher.ts: ok
NEW frontend/features/achievements/toast-port.ts: ok
NEW frontend/surfaces/toasts/achievement.ts: ok
NEW frontend/surfaces/toasts/deps.ts: ok
NEW frontend/surfaces/toasts/index.ts: ok
NEW frontend/surfaces/toasts/launch.ts: ok
```
**What changes:**
- `dispatcher.ts` → `surfaces/toasts/achievement.ts`. From `launch-toast.ts`, only the Steam write
  (`dispatchLaunchToast`) moves, to `surfaces/toasts/launch.ts`; the launch policy (setting + local
  achievements) stays in `features/achievements/launch-toast.ts`.
- `touches`: `NotificationStore.OnNotification`, `NotificationStore.ProcessNotification`,
  `NotificationStore.m_nNextTestNotificationID`. No hooks, so there is nothing to fail open. Both
  writes return `false` while `toasts` is off.
- The features reach it through `features/achievements/toast-port.ts` (D3; `PURGE(M6)` from M3.8).
  Toasts stay direct calls. The switch to the `achievements.unlocked` event is a flow change and belongs to M6.
- New FeatureId `toasts`. The public `dispatchAchievementToast` export (D8) is unchanged.
**User-visible:** a new kill switch, `toasts`. **Extra docs:** `safety.md`.
**Extra live:** in the console, run
`PLUGIN_LIST['steam-cartridges-dev'].dispatchAchievementToast(4263274102, {id:'m36',name:'M3.6 check',description:'toast surface',icon:'https://media.retroachievements.org/Badge/00001.png'})`
→ `true` and a Steam achievement toast appears. With `toasts` switched off → `false` and no toast.

#### M3.7 — `native-links` (Done)

**Check lines:**
```
EDIT frontend/features/steam-store/index.ts: ok
EDIT frontend/index.tsx: ok
EDIT frontend/surfaces/sections/index.ts: ok
EDIT tests/native-sections.test.ts: ok
DELETE frontend/features/steam-store/native-sections-core.ts: ok
DELETE frontend/features/steam-store/native-sections.ts: ok
NEW frontend/surfaces/native-links/core.ts: ok
NEW frontend/surfaces/native-links/index.ts: ok
```
**What changes:** `native-sections.ts` → `surfaces/native-links/index.ts`, and `native-sections-core.ts`
→ `core.ts` (test path, D11). The three hooks are fail-open: the `GetAppOverviewByAppID` afterPatch
returns the unmodified value, the `Navigator.App` beforePatch passes the arguments through, and the jsx
observer does nothing. `touches`: `appStore.GetAppOverviewByAppID`, `Navigator.App`,
`jsx:native-sections`. D3 `setNativeLinksSink` (steam-store → `setNativeAppid`).
`nativeSectionsDiagnostics` (D8) is unchanged.
**Extra live:** `node scratch/check_parity.mjs` → `17 PASS / 0 FAIL`; switch-off `native-links` →
Jotunnslayer's Links, Friends and Community sections are stock.

#### M3.8 — Purge markers on the temporary ports (Done)

**Check lines:**
```
EDIT frontend/features/achievements/store-port.ts: ok
EDIT frontend/features/achievements/toast-port.ts: ok
```
**What changes:** comments only. It introduces the purge marker (D13) for **temporary live** code:
`// PURGE(<step>): <why>. Ledger: migration plan § 7.9.` The two M3 ports are marked `PURGE(M6)`.
`git grep -n "PURGE(" -- frontend` then lists exactly those two files. (Dead code is not marked: M3.0
deleted it.)
**Extra docs:** tick the M3.8 rows of § 7.9. **Live:** none (comments only); say so in the report.

#### M3.9 — `artwork` (Done)

**Check lines:**
```
EDIT frontend/features/steam-store/index.ts: ok
EDIT frontend/index.tsx: ok
EDIT frontend/kernel/record.ts: ok
EDIT frontend/rpc.ts: ok
EDIT frontend/safety/features.ts: ok
EDIT tests/architecture-allowlist.json: ok
DELETE frontend/features/artwork/artwork.ts: ok
DELETE frontend/features/steam-store/logo.ts: ok
NEW frontend/surfaces/artwork/artwork.ts: ok
NEW frontend/surfaces/artwork/deps.ts: ok
NEW frontend/surfaces/artwork/index.ts: ok
NEW frontend/surfaces/artwork/logo.ts: ok
```
**What changes:**
- `features/artwork/artwork.ts` and `features/steam-store/logo.ts` → `surfaces/artwork/`. The three
  `ClearCustomArtworkForApp` calls in `steam-store/index.ts` become `artwork.clearSlot()` through
  `setArtworkSink` (D3), which calls on the object, never an extracted method.
  `rpc.steamStoreDownloadImage` becomes the `downloadImage` dep. `art-plan.ts` stays (pipeline policy, M4).
- **D12:** `ArtworkUrls` moves to the kernel; `rpc.ts` keeps the name. (`ImageAsset` and `ArtworkBundle`
  were deleted with the dead `applyCustomArtwork` in M3.0.)
- New FeatureId `artwork`: while it is off, no slot is written or cleared and the logo position is not touched.
- Allowlist −2: `features/artwork -> rpc`, `features/steam-store -> features/artwork`.
**User-visible:** a new kill switch, `artwork`. **Extra docs:** `safety.md`, `kernel.md` History.
**Extra live:** open WUCHANG twice; the second view logs no `Steam Store: applied … art slot(s)` line
(art already applied). Switch-off `artwork` → no art writes on a newly mapped game.

#### M3.10 — `library-home` (Done)

**Check lines:**
```
EDIT frontend/index.tsx: ok
EDIT tests/architecture-allowlist.json: ok
DELETE frontend/renderers/library-home.tsx: ok
NEW frontend/surfaces/library-home/grid.ts: ok
NEW frontend/surfaces/library-home/index.ts: ok
```
**What changes:** `renderers/library-home.tsx` → `surfaces/library-home/grid.ts`. `touches`:
`collectionStore.OnAppOverviewChange`, `AppOverview.rt_recent_activity_time`,
`AppOverview.rt_last_time_played_or_installed`. The afterPatch is fail-open (returns Steam's value).
`rpc.getLibraryStats` becomes the `loadLibraryStats` dep. Registration stays async: `install()` starts
it, and `index.tsx` awaits `ready()`, so the start-up order is unchanged. Allowlist −2: `renderers -> rpc`,
`renderers -> steam`; `frontend/renderers/` is now empty and `apply_step.py` removes the folder.
**Extra live:** the library grid sorts AM2R by its newest capture ("last played"); switch-off
`library-home` → Steam's own values.
**After M3.10:** the feature freeze (§ 5) ends. Write that in `TASK.md`.

### M4–M5 overview (read before any of these steps)

**Decided 2026-09-28 (§ 11 items 6 and 7):** (6) the routing policy (buckets and service rules)
stays **pure TypeScript** in `frontend/domain/routing/`, because routing rules have a `regex`
condition evaluated with JavaScript `RegExp` and Lua has no regex engine. The backend still owns
identity, fetching, storage and freshness, and receives the evaluated route as **context**
(ADR-0040, written in M4a). (7) SteamGridDB, ScreenScraper and IGDB-community are **unwired
features**, not dead code: their backend providers stay, and M5c/M5d (and the Media service after
M7) connect them (§ 7.10).

| Step | What | Kind | Behaviour |
| --- | --- | --- | --- |
| M4.0 | Backend inventory: every RPC classified live / unwired / dead; only dead code is deleted | backend | none |
| M4a | Routing policy → `domain/routing`; `getBucket` / `bucketReport` → `app/routing.ts` | frontend move | none |
| M4b | Identity service + record facade (`GetGameRecord`, `EnsureFresh`) in the backend, Lua-tested | backend addition | none (nothing calls it yet) |
| M4c | Frontend adopts it: records, render queue, ports, owned-apps sensor; sections / native-links / captures record-driven | frontend switch | identity resolved by one backend call instead of up to three |
| M5a | Metadata service in the backend (steam appdetails, IGDB, local DB, store-item context) | backend addition | none (nothing calls it yet) |
| M5b | Frontend adopts it: store-item sensor, game-info surface record-driven, old pipeline deleted | frontend switch | Game Info selection done by the backend |
| M5c | SteamGridDB artwork source (feature) | feature | new: art for shortcuts without a Steam match, empty slots only |
| M5d | ScreenScraper metadata source (feature) | feature | new: metadata when IGDB is not configured or finds nothing |

Every step is `Build`: the implementer follows § 0.10; the verifier runs § 0.5 and the M3 common
switch-off check for any surface the step changes. The contracts below are **binding**: the implementer
may add private helpers, but a contract changes only by an architect amending this section first.

#### Shared contracts (M4b, M4c, M5a, M5b)

**Parts on the wire.** A part is the kernel `Part<T>` as JSON. The backend writes times in **ms**
(`os.time() * 1000`). Status meanings for this migration:

| Part | `ok` | `pending` | `unsupported` | `error` |
| --- | --- | --- | --- | --- |
| identity | resolved; `data.native` present = Steam match, absent = no match | title unknown, try again on the next view | no store lookup for this shortcut (emulator launcher, or route is not `steam-store`) | the lookup failed (network); retry after 5 min |
| metadata | `data` is a `GameMetadata` to show | nothing local and no fetch allowed yet (route `pending`, or identity not known) | route `none` and nothing local | the fetch failed; local data, if any, is still in `data` |

**RPC facade** (backend `record_rpc.lua`, registered in `main.lua`; frontend `ports/backend.ts`):

```ts
// frontend/ports/backend.ts (M4c). Imports kernel types only; transport from ports/transport.ts.
export interface OwnedCandidate { appid: number; name: string }
export interface FreshContext {
    title: string;                                   // the shortcut's display name ("" when unknown)
    route: { bucket: "steam-store" | "web-scraping" | "none"; via: string };
    owned?: OwnedCandidate[];                        // identity only: natives Steam knows (sensors/owned-apps)
    storeItem?: GameMetadata | null;                 // metadata only (M5): StoreItemCache data for identity.native
    allowWeb?: boolean;                              // metadata only (M5): igdb enabled and allowed by routing
    noNetwork?: boolean;                             // true = disk and context only (bulk re-evaluation)
    hardcore?: boolean;                              // achievements only (M6a): setting raHardcoreMode
    force?: boolean;                                 // M7a: ignore TTLs, never a custom_override record
}
export interface RecordResponse {
    appid: number;
    parts: Partial<Record<RecordPart, Part<unknown>>>;
    error?: string;                                  // set instead of parts when the call failed
}
export const backend: {
    getGameRecord(appid: ShortcutId): Promise<RecordResponse>;                 // disk only
    ensureFresh(appid: ShortcutId, parts: RecordPart[], ctx: FreshContext): Promise<RecordResponse>;
    getAllRecords(): Promise<{ records: Record<string, RecordResponse["parts"]> }>;  // M5a, disk only
};
```

```lua
-- backend/record_rpc.lua (M4b; M5a adds "metadata" and GetAllRecords). Wrapped in rpc.lua method():
-- never throws across the boundary, errors come back as { error = "..." }.
RPC.GetGameRecord  = method("GetGameRecord",  function(d) --[[ {appid} ]] end)                -- -> { appid, parts }
RPC.EnsureFresh    = method("EnsureFresh",    function(d) --[[ {appid, parts, context} ]] end) -- -> { appid, parts }
RPC.GetAllRecords  = method("GetAllRecords",  function(_) end)                                  -- M5a -> { records }
```

Unknown part names in `parts` are ignored (not an error). `appid` must be a shortcut (≥ 2^31) or the
call returns `{ error = "not a shortcut" }`. Persisted formats do not change (§ 4.3): identity reads and
writes `steam_store.json` through `steam_store_store.lua`, metadata reads and writes
`library_metadata.json` through `web_metadata_db.lua`, and **native Steam metadata is never persisted**
(steam_store_store.lua rule; M5a returns it without writing it).

---

### M4.0 — Backend inventory, purge only the dead (Done)

**Why:** D13 (dead code is purged, not moved) with § 11 item 7 (unwired features are kept).
**Design:**
1. List every global assigned in `backend/main.lua`. For each, record its callers: the frontend
   (`rpc.ts` after M3.0), other backend modules, Lua tests, `scratch/` scripts, docs.
2. Classify into the table below and write it into `docs/steam-cartridges/rpc.md` (created here; M4b
   and M5a extend it):
   - **live**: the frontend calls it.
   - **unwired**: implemented, no caller, a feature the user wants → stays registered, gets a row in § 7.10.
   - **dead**: no caller and no feature behind it → deleted, with its Lua test lines and any module only it uses.
3. Expected result (verify, do not assume):

| RPC | Class | Note |
| --- | --- | --- |
| `GetArtworkForGame` + `web_sgdb.lua` | unwired | § 7.10: SteamGridDB artwork (M5c) |
| `GetGameMedia`, `GetGameManual` + `screenscraper_media.lua` | unwired | § 7.10: ScreenScraper media (Media service after M7) and metadata (M5d) |
| `GetGameTrailers`, `GetGameCommunityLinks` + `igdb_community.lua` | unwired | § 7.10: IGDB community (Media service after M7) |
| `SaveGameMetadata` | unwired | § 7.10: manual Game Info editing (`custom_override`); no UI yet |
| `SteamStoreRejectSuggestion` | unwired | § 7.10: reject a suggestion in the Steam Store settings list; no UI yet |
| `GetDiagnostics` | live (debug) | keep: documented in millennium-architecture.md; M7 adds `http_calls` |

   If the table holds, M4.0 deletes **nothing** and is docs-only (`rpc.md` + § 7.10 checked). If the
   inventory finds a truly dead RPC, delete it here with its test lines, packaged per D10.
**K8 (decided, user 2026-09-28: the library change was intentional and predates the migration):** set
`FIXTURE.retroarch = 215` in `tests/test_backend.lua` (220 shortcuts: WUCHANG was added and the RetroArch
shortcut "Densetsu no Ogre Battle" removed after the fixture was written on 2026-09-24). Separate commit:
`test(steam-cartridges): update RetroArch fixture count (K8)`.
**Orphaned metadata records (decided, user 2026-09-28: clean all 5).** `library_metadata.json` holds five
records whose shortcut no longer exists:

| Key | Title | Why it is orphaned |
| --- | --- | --- |
| `3876190134` | Densetsu no Ogre Battle - The March of the Black Queen (Japan) (NP) (T-En by FinS v1.2) | shortcut removed |
| `4034579314` | Wing Commander Prophecy: Secret Ops | shortcut removed |
| `1234567890` | Chrono Trigger | test data: not a shortcut appid (< 2^31) |
| `4000000001` | Secret of Mana | test data: fake appid |
| `999999` | Sengoku 3 | test data: not a shortcut appid |

The backend keeps the database in memory and rewrites the whole file on every save, so a hand edit while
Steam runs is lost. The cleanup is therefore **migration v2** in `backend/migrate.lua`: guarded by a new
marker `<data dir>/.migrated-v2`; first copies `library_metadata.json` to `library_metadata.json.bak-v2`;
then removes exactly these five keys, **skipping any record with `custom_override = true`** (and logging that
it did); writes the file; logs counts only ("Migration v2: removed N orphaned metadata record(s), kept K
with manual edits"). `main.lua` runs it right after v1, before `metadata_db` is first loaded. It is a fixed
list, not a rule: pruning every record whose shortcut is missing would delete manual edits whenever a
shortcut is removed temporarily (a separate decision, not taken). Lua checks (in a new hermetic
`tests/test_migrate.lua`, temp data dir): `v2 removes the five orphans` · `v2 keeps a record with custom_override`
· `v2 writes the backup first` · `v2 runs once (marker)` · `v2 leaves every other record byte-identical`.
**Exit:** the RPC registration test passes; the Lua suites give the same output as before except K8 now
passes (only K7 fails, fixed in M6a); `test_migrate.lua` → `ALL PASS`; after deploying, the backend log shows
the v2 line once and `library_metadata.json` has 220 records.

### M4a — Routing policy to the domain (Build)

**Why:** § 11 item 6. The policy is pure and tested; this step gives it its layer and moves the
stateful `getBucket` / `bucketReport` into `app/`. **Behaviour: none.**
**Design:**
1. `git mv frontend/features/buckets/resolve.ts frontend/domain/routing/policy.ts` (verbatim).
   `frontend/features/buckets/ready.ts` (`pendingOr`) → `frontend/domain/routing/pending.ts` (verbatim).
   Test paths (D11): `tests/buckets.test.ts`, `tests/routing-rules.test.ts`, `tests/buckets-ready.test.ts`.
2. `frontend/app/routing.ts` = `features/buckets/index.ts` + `collections.ts` + `auto-routing.ts`, rewritten
   as a factory over injected inputs so it is node-testable (D2) and needs no forbidden import:

   ```ts
   export interface RoutingInputs {
       buckets(): BucketsConfig;                 // setting('buckets')
       autoMode(): boolean;                      // setting('autoRoutingMode')
       collections: { ready(): boolean; list(): any[] | undefined };   // sensors/collections (M2)
       titleOf(appid: number): string | undefined;                      // appStore display name
       shortcuts(): { appid: number; name: string }[];                   // appStore.allApps shortcuts
       loadProfiles(): Promise<Record<string, AutoRoutingProfile>>;      // rpc.getAutoRoutingProfiles
       metadataAppids(): Iterable<number>;       // for bucketReport.unbucketedWithMetadata
   }
   export function createRouting(inputs: RoutingInputs): {
       getBucket(appid: number): Resolution;     // same memo rules as today: sticky per session, 'pending' never memoised
       onBucketsChanged(): void;                 // clears the memo and the membership cache (was the onSettingChange hook)
       bucketReport(): BucketReport;             // same shape as today (D8: public API)
       listCollections(): CollectionInfo[]; membersOf(id: string): ReadonlySet<number> | undefined;
       waitForCollections(timeoutMs?: number): Promise<boolean>;
       loadAutoRoutingProfiles(): Promise<void>; getAutoRoutingProfile(appid: number): AutoRoutingProfile | undefined;
       listShortcuts(): { appid: number; name: string }[];
   };
   ```

   `index.tsx` creates the one instance (`export const routing = createRouting({...})` lives in
   `index.tsx` or `app/routing-instance.ts` wired there) and passes it to every former caller through
   D3 setters: `features/source-view.ts`, `features/game-info/index.ts`, `features/scraper/*`,
   `settings/settings-panel.tsx` (the panel gets it through a setter in `settings.ts`, not an import of `app/`).
   `features/buckets/` is deleted.
3. Architecture test (D1): add `[/^(app|settings|features\/.+)$/, /^domain$/]` to `LAYER_RULES` (the
   pure domain is a leaf like the kernel; `domain` itself may import only `kernel`). +1 assertion
   in the layer-rules test: `features/scraper -> domain` allowed, `domain -> steam` forbidden.
4. ADR-0040 in `docs/decisions.md` (text): *"Routing policy is pure TypeScript in `frontend/domain/routing`.
   Routing rules include a `regex` condition with JavaScript `RegExp` semantics that Lua cannot evaluate.
   The frontend app layer evaluates the policy and passes the route and allowed services to the backend
   as context; the backend keeps identity, fetching, storage and freshness. Amends ADR-0039 and § 11
   decision 1 of the migration plan for routing only."*
**Tests:** +4 in new `tests/app-routing.test.ts`: (1) a resolved bucket is memoised and survives a
membership change; (2) `pending` (collections not ready, rules present) is not memoised; (3)
`onBucketsChanged()` clears the memo; (4) `bucketReport()` returns `ready: false` and only `games`
before collections are ready. Plus the one layer-rule assertion.
**Allowlist delta (expected):** every `* -> features/buckets` edge and `features/buckets -> *` edge
disappears; `settings -> features/buckets` goes. Record the exact list in the report.
**Live:** § 0.5; `node steam-cartridges/tests/buckets.mjs` is **not** run (it writes config); instead
the verifier compares `PLUGIN_LIST['steam-cartridges-dev'].bucketReport()` before and after deploy:
identical JSON.

### M4b — Identity service and record facade (Build)

**Why:** Flow A, first half: the backend decides whether a shortcut is a Steam game. Today that takes
up to three frontend round trips (`SteamStoreGetMapping`, `SteamStoreSaveKnownMatch`, `SteamStoreSearch`,
in `features/steam-store/index.ts` `resolveMapping`). **Behaviour: none** (nothing calls the new RPCs until M4c).
**Design:**
1. `backend/resolve_identity.lua`, a port of `resolveMapping` plus the two existing RPC bodies, with
   injectable dependencies for tests:

   ```lua
   local M = {}
   M.deps = {
     http_get = nil,          -- nil = steam_store_throttle.http_get (search.search's default)
     is_emulator = nil,       -- nil = launches_emulator(appid) as in steam_store_rpc.lua (moved here, shared)
     now = function() return os.time() end,
   }
   --- Disk only: the saved mapping as an identity part, or nil. Never touches the network.
   function M.saved(appid) end
   --- Full resolution: saved mapping -> owned candidates -> store search. Returns a Part (table).
   --- ctx = { title = string, owned = { {appid=, name=}, ... } | nil, route = { bucket=, via= } }
   function M.ensure(appid, ctx) end
   return M
   ```

   Order and outcomes (each line is one test in step 4):
   - route bucket ≠ `steam-store` → `{ status = "unsupported" }` (no disk write, no network).
   - saved mapping exists → `{ status="ok", data={ native={ appid=, source=<mapping.source> } }, source="steam-store" }`.
   - `is_emulator(appid)` → `{ status="unsupported" }` (same rule as today's `skipped = "emulator"`).
   - title `""` → `{ status="pending" }`.
   - owned candidates: the **unique** candidate whose `steam_store_normalize.normalize(name)` equals
     `normalize(title)` and is not in `rejected` → `store.set_mapping(appid, id, name, "owned")` → ok with
     `source="owned"`. Two candidates with the same normalized name = no owned match (as `matchKnownIndex`).
   - store search (`steam_store_search.search(title, deps.http_get, store)`): `exact` not rejected →
     `set_mapping(..., "search")`, `remove_suggestion` → ok with `source="search"`; exact but rejected →
     ok without native; suggestions only → `store.add_suggestions` → ok without native; `skipped="negative"`
     → ok without native; `error` → `{ status="error", message=<error> }`.
   - every returned part gets `checkedAt = deps.now() * 1000`.
2. `backend/record_rpc.lua`: `GetGameRecord` returns `{ appid, parts = { identity = resolve_identity.saved(appid) } }`
   (omit `identity` when nil). `EnsureFresh` runs `resolve_identity.ensure` when `"identity"` is in `parts`.
   Register both in `main.lua` under a new comment `-- Record facade (migration M4b).`
3. `steam_store_rpc.lua` keeps its RPCs (aliases until M9) and its `launches_emulator` moves into
   `resolve_identity.lua` as the default `is_emulator` (steam_store_rpc requires it from there).
4. New hermetic `tests/test_identity.lua`, modelled on `test_steam_store.lua` (same stubs, `M._path` on the
   store, `deps.http_get` injected, `http` stubbed to throw). Cases, one `check` each, in this order:
   `route not steam-store is unsupported` · `saved manual mapping, no network` · `emulator is unsupported` ·
   `empty title is pending` · `unique owned match saves source owned` · `duplicate owned names are no match` ·
   `rejected owned candidate is skipped` · `store exact saves source search` · `store exact but rejected, no native` ·
   `suggestions only are stored, no native` · `negative cache skips the request` (assert the injected
   http_get is not called twice) · `network error is status error` · `checkedAt is in ms` ·
   `GetGameRecord is disk only` · `EnsureFresh ignores unknown parts` · `EnsureFresh rejects a native appid`.
   Expected output ends `ALL PASS`. Add it to `package.json` `test:lua`.
5. Frontend: no change. M4b is backend-only, and the RPC registration test is unaffected because
   the frontend does not call the new names yet (M4c does).
**Exit:** `lua tests/test_identity.lua` → `ALL PASS` (16 checks); the other Lua suites unchanged (K7/K8);
`npm run test:ts` unchanged; § 0.5 PASS (backend loads: the log shows `Backend loaded.`).
**Docs:** `rpc.md` (the two new methods with request/response), `service-resolver.md` (new, § 0.6 template:
what it owns = identity; sources = saved mapping, owned candidates, store search; "How to add a source").

### M4c — Frontend adopts records and identity (Build)

**Why:** D4: the first record-driven surfaces. **Behaviour delta:** identity comes from one
`EnsureFresh` call (log lines change: the backend logs the search; the frontend logs `Identity <appid>:
<status> <native|->` once per resolution).
**Design:**
1. `frontend/ports/transport.ts`: the `call()` function moved from `rpc.ts` (verbatim); `rpc.ts` imports it
   (add `[/^rpc$/, /^ports$/]` to `LAYER_RULES`, temporary until M9 folds `rpc.ts` into `ports/`).
   `frontend/ports/backend.ts`: the contract above. Extend the RPC registration test to scan
   `ports/backend.ts` as well as `rpc.ts` (same regex; it must find `GetGameRecord` and `EnsureFresh`).
2. `frontend/sensors/owned-apps/index.ts`: `ownedCandidates(): OwnedCandidate[]` = `readNativeGames` moved
   verbatim from `features/steam-store/known-apps.ts`. `known-apps.ts` is deleted, and so are the TS matching
   helpers only it used (`buildKnownIndex`, `matchKnownIndex`, `matchKnownApp`, `normalizeTitle` in
   `features/steam-store/resolve.ts`) with their tests in `tests/steam-store.test.ts`: the backend's
   `normalize` (tested by `tests/fixtures/normalize-cases.json` in Lua) is now the only matcher. State the
   test-count change in the step.
3. `frontend/app/records.ts`: `createRecords(bus)` → `{ store: RecordStore, ensureBase(appid, title) }`
   (`ensureBase` upserts `{appid, gameid: toGameId(appid), title, exe: ""}`).
   `frontend/app/render-queue.ts` (D5): `createRenderQueue(render: (appid, parts) => void, schedule = (f) => setTimeout(f, 0))`;
   coalesces parts per appid; one flush per tick; `index.tsx` wires `bus.on("record.updated") → queue → runner.render(appid, records.get(appid), parts)`.
4. `frontend/app/identity.ts`: `createIdentity({ backend, records, owned, titleOf, now })` →
   `{ ensure(appid, route): Promise<Part<Identity>>, invalidate(appid) }` with today's session rules:
   one resolution per appid per session; `pending` is not memoised; `error` is retried on a view after
   5 min (the old `RETRY_MS`); `invalidate` drops the memo (manual mapping, clear). It writes the part with
   `records.update(appid, { identity })`. Route not `steam-store` → it writes `{ status: "unsupported" }`
   without calling the backend.
5. `features/source-view.ts` steam-store branch: `const identity = await app.identity.ensure(appid, route)`
   replaces the `resolveMapping` half of `handleSteamStoreView`; `handleSteamStoreView(appid, identity)`
   keeps its metadata and artwork half (until M5b/M5c). `setSteamStoreMapping` and `clearSteamStore`
   (public, D8) call `identity.invalidate(appid)` after the backend write and re-run the view.
6. Record-driven surfaces (D4), each `reads` updated and its sink deleted:
   - `sections.render(appid, record)`: `setExtraSections(appid, record?.identity?.data?.native ? NATIVE_SECTIONS : undefined)`
     (`NATIVE_SECTIONS` moves from steam-store into the surface). Delete `setExtraSectionsSink`.
   - `native-links.render`: `setNativeAppid(appid, record?.identity?.data?.native?.appid)`. Delete `setNativeLinksSink`.
   - `captures.render`: when `identity` is in the changed parts, `setNativeActivitySource(appid, native?.appid)`
     then `publish(appid)` (was the steam-store `republish`). Delete `setCapturesSinks`.
   - `game-info`: unchanged in M4c (`refreshGameInfoInstances` after a new mapping stays in steam-store until M5b).
7. Tests (+N; report the exact count): `tests/render-queue.test.ts` (2: coalescing; one flush per tick),
   `tests/app-identity.test.ts` (5: not steam-store → unsupported without a call; memo per session;
   pending not memoised; error retried only after 5 min; invalidate re-resolves), minus the deleted
   TS matching tests.
**Exit:** § 0.5 PASS; `node scratch/check_parity.mjs` → `17 PASS / 0 FAIL` (Jotunnslayer: links, friends,
community, news from native 2820820); WUCHANG shows its native sections; AM2R (route `none`) shows none
and makes no identity call (backend log has no `EnsureFresh` for 4263274102); M3 switch-off checks for
`sections`, `native-links`, `captures`.
**Docs:** `rpc.md` (ports), `surfaces.md` (the three "Record-driven in" cells → done), `sensors.md` (owned-apps),
`README.md` layer list (`app/`, `ports/` current), § 7.9 (tick the M4 rows).

### M5a — Metadata service (Build)

**Why:** Flow A, second half. Today Game Info selection is spread over `features/game-info/index.ts`
(`handleWebScrapingView`, the preload), `policy.ts` (`gameInfoPlan`), `features/steam-store/index.ts`
(`loadNative`) and `features/scraper/on-update.ts`. **Behaviour: none** (nothing calls it until M5b).
**Design:**
1. `backend/metadata_service.lua` with injectable deps (`igdb_fetch = igdb.fetch_game_metadata`,
   `appdetails_fetch = appdetails.fetch`, `shortcut_info = web_rpc.get_shortcut_info`, `now`):
   `M.local_part(appid)` (disk only) and `M.ensure(appid, ctx) → Part<GameMetadata>` with this selection,
   a port of `gameInfoPlan` + `loadNative` + `GetGameMetadata` (one test per line):
   - DB record with `custom_override = true` → ok, `source="custom"`, whatever the route (user edits win).
   - `route.via == "pending"` → DB record → ok `source="local_db"`; none → `pending`. No network.
   - `route.bucket == "steam-store"` and identity has native: `ctx.storeItem` present → ok with it,
     `source="steam-store"`, **not persisted**; else `appdetails_fetch(native)` → `to_metadata` → ok,
     `source="steam-appdetails"`, not persisted; appdetails error → the DB record if any with `status="error"`.
   - `route.bucket == "steam-store"` and identity ok without native, or `route.bucket == "web-scraping"`:
     DB record → ok `local_db`; none and `ctx.allowWeb` and not `ctx.noNetwork` → `igdb_fetch` → persist →
     ok `source="igdb"`; IGDB no match → persist the fallback record exactly as `GetGameMetadata` does →
     ok `source="fallback"`; not allowed → `pending`.
   - `route.bucket == "steam-store"` and identity not known (`pending`/`error`) → DB record or `pending` (local only, as today).
   - `route.bucket == "none"` → DB record → ok `local_db`; none → `unsupported`.
   The service needs the identity: `EnsureFresh(appid, ["identity","metadata"], ctx)` resolves identity
   first in the same call; `["metadata"]` alone reads the saved identity (`resolve_identity.saved`).
2. `record_rpc.lua`: `EnsureFresh` handles `"metadata"`; `GetGameRecord` adds `metadata = metadata_service.local_part(appid)`;
   new `GetAllRecords` → `{ records = { ["<appid>"] = { identity=?, metadata=? } } }` for every DB record and
   every saved mapping (disk only; replaces the frontend's `getAllMetadata` preload in M5b).
3. `GetGameMetadata` / `RefreshGameMetadata` / `GetAllMetadata` stay registered (aliases until M9; the
   settings panel and M7's sync still call them).
4. New hermetic `tests/test_metadata_service.lua` (stubs as `test_identity.lua`; `library_metadata.json` in
   a temp dir via `data_dir` override): the selection lines above as checks, plus the six cases of
   `tests/game-info-policy.test.ts` ported by name (that TS test is deleted in M5b with `policy.ts`), plus
   `steam-store metadata is never written to library_metadata.json` and `GetAllRecords is disk only`.
   Expected `ALL PASS`; add to `test:lua`.
**Exit:** new suite `ALL PASS`; the others unchanged; § 0.5 PASS. **Docs:** `rpc.md`, `service-metadata.md` (new).

### M5b — Frontend adopts metadata (Build)

**Why:** D4 for `game-info`. **Behaviour delta:** Game Info is selected by the backend; the result must
be identical per shortcut (the exit checks prove it).
**Design:**
1. `frontend/sensors/store-item/index.ts`: `loadStoreItem(steamAppid)` moved from
   `features/steam-store/store-item.ts` (it queues Steam's own StoreItemCache request and polls; a read of
   Steam's data, so a sensor). The pure mapping (`metadataFromStoreItem`, `categoryIds`, `gameCategoryIds`,
   `assetUrlsFromItem`) → `frontend/domain/store-item.ts` (types from the kernel, D12); `tests/steam-store.test.ts`
   paths (D11). `normalize.ts` (metadata normalization) → `frontend/domain/metadata-normalize.ts`
   (`tests/metadata-normalize.test.ts` path).
2. `frontend/app/metadata.ts`: `createMetadata({ backend, records, storeItemFor, allowWeb })` →
   `ensure(appid, route, identity)`: when identity has a native, `ctx.storeItem = domain.metadataFromStoreItem(await storeItemFor(native))`;
   `ctx.allowWeb = services.igdbEnabled !== false && isServiceAllowed('igdb', …)` (domain, M4a);
   one `EnsureFresh(["metadata"])`; `records.update(appid, { metadata })`. Start-up: `getAllRecords()` →
   `records.update` for every shortcut (replaces the `initGameInfo` preload). Bucket settings change:
   re-route every record, and for each whose route changed call `ensure` with `noNetwork: true`
   (today's behaviour: revert store data, apply local, fetch nothing until the next view).
3. `game-info.render(appid, record)`: `metadata.status` is `ok` (or `error` with `data`) → `enrich(appid, data)`
   (idempotent, M0a); otherwise, if the app was enriched → `revert(appid)`. After a new identity, it
   calls `refreshGameInfoInstances()` (was in steam-store, guardrail 11). Its deps `metadataOf` now reads
   `records.get(appid)?.metadata?.data`.
4. Deleted (and their § 7.9 rows ticked): `features/game-info/index.ts` (libraryCache, `handleWebScrapingView`,
   `initGameInfo` preload, the bucket-change hook), `features/game-info/policy.ts` + `tests/game-info-policy.test.ts`
   (ported to Lua in M5a), the metadata half of `features/steam-store/index.ts` (`metaCache`, `loadNative`,
   `matched`), the metadata part of `features/scraper/on-update.ts`, setters `setGameInfoWriter`,
   `setGameInfoSink`, `setGameInfoEnricher`, `setGameInfoProbe` (sections reads `record.metadata.status`).
   `features/source-view.ts` shrinks to: route → identity → metadata → (steam-store artwork until M5c).
**Exit:** `node scratch/audit_missing_metadata.mjs` → `0 missing` (220/220 shortcuts with Game Info, as
before); AM2R Game Info intact with route `none` (ADR-0035); WUCHANG Game Info from the Steam store
(release date, developer, badges as before); a web-scraping game shows its IGDB data; `count_cycle.mjs`
→ `PASS render loop`; § 0.5 PASS; switch-off `game-info`.
**Docs:** `service-metadata.md`, `surfaces.md` (game-info record-driven), `sensors.md` (store-item),
`README.md`, § 7.9.

#### Provider credentials (binding for M5c, M5d and every later provider)

User decision 8 (§ 11): the plugin's users enter provider credentials in the plugin settings
panel; they are saved locally and safely. Today's mechanism already does most of this and is kept:

- **Where:** `SaveServiceCredentials` → `web_config.save_credentials` writes key=value lines to
  `<Steam>/millennium/config/steam-cartridges/.env` (the plugin data folder, `data_dir`). Nothing
  else stores a credential. The SteamGridDB key moves from `sgdb_key.txt` to `.env` as `steamgriddb_api`
  (`config.get_api_key` already reads both; `migrate.lua` copies an existing `sgdb_key.txt` into `.env`
  once and deletes the file).
- **Never shown back:** the settings panel's credential fields start empty, use `bIsPassword` for
  secrets, and show only a "saved" / "verified" state. `GetStatus` returns booleans only (`has_twitch`,
  `has_sgdb`, `has_screenscraper`, `has_retroachievements`); no RPC ever returns a stored secret.
- **Never leaves the machine except to its provider:** a credential is sent only to its own provider's
  HTTPS endpoint, never logged (a Lua test greps the providers' `logger:` calls for credential
  variables), never written to `library_metadata.json` or any other file, and never in the repo
  (AGENTS.md: never commit secrets).
- **Clearing:** saving an empty field removes the key from `.env` (already `save_credentials`' behaviour).
- Encryption at rest (e.g. Windows DPAPI) is **not** available from the Lua sandbox; the protection is
  the user's own profile folder. `safety.md` states this plainly.

### M5c — SteamGridDB artwork source (Build; feature, after M5b)

**Why:** § 7.10 row 1. SteamGridDB is the artwork source for non-Steam games; the provider exists
(`web_sgdb.lua`: search by title, lookup by Steam appid, portrait/hero/logo/wide URLs), but nothing
calls it since the `steamgriddb-artwork` merge. **Behaviour: new** (feature freeze ended with M3).
**Decided (user, 2026-09-28, § 11 item 8):**
- **Which games:** every shortcut **without a Steam match** (`identity.data.native` absent: routes
  `web-scraping`, and `steam-store` with no match). Two existing contracts still apply and the step must
  not break them: a shortcut in bucket `none` makes no network call (ADR-0035), so it gets SteamGridDB
  art only if the user moves it out of `none`; and the user's routing rules / service toggle for
  `steamgriddb` can exclude games (the rules UI already offers `steamgriddb`). Mapped games keep Steam CDN
  art (today's behaviour).
- **Only empty slots:** SteamGridDB writes a slot only when the shortcut has **no** custom artwork in it
  (checked with Steam's own data before writing), and records the slots it wrote in `applied_artwork`
  exactly like the Steam Store path, so "Clear" removes only ours. A slot the user set is never touched.
- **Credentials:** the API key is entered in the settings panel (new "SteamGridDB" service entry next to
  ScreenScraper and IGDB, one masked field), saved per "Provider credentials" above.
**Design:**
1. Backend Artwork service `backend/art_service.lua`: `EnsureFresh(["artwork"])` → `record.artwork =
   Part<{ urls: ArtworkUrls; source: "steam-cdn" | "steamgriddb" }>`. Sources: `steam_cdn` (identity has a
   native: today's CDN URLs, incl. the hashed URLs the frontend reads from StoreItemCache, passed as
   context) and `sgdb` (no native: `web_sgdb.search_game(title)` then `fetch_artwork_urls(id)`; no key →
   `needs-setup`, silent otherwise, ADR-0014). Negative results cached like the store search.
2. `art-plan.ts` → `frontend/domain/art-plan.ts` (pure; tests path, D11), extended with "empty slots only"
   for the `steamgriddb` source.
3. The `artwork` surface becomes record-driven (`reads: ["artwork"]`); `setArtworkSink` is deleted
   (§ 7.9). A slot is **empty** when none of its grid files exists in `<user>/config/grid/`
   (`steam_store_store.slot_files(appid, slot)` names them: `<appid>p`, `<appid>_hero`, `<appid>_logo`,
   `<appid>` with `.png` / `.jpg` / `.jpeg`; the same check `prune_missing_slots` already uses). The backend
   returns the empty slots with the part (`data.emptySlots`), and the surface writes only those.
4. New settings key `services.steamgriddbEnabled` (default `true`; additive, no existing key changes).
5. Lua tests: no key → `needs-setup` without a request; search miss → negative cache; mapped game →
   `steam-cdn` and no SteamGridDB request; the credential never appears in a `logger:` call.
**Exit:** an unmatched web-scraping shortcut with no custom art gets portrait/hero/logo/wide from
SteamGridDB; a shortcut whose portrait the user set keeps it (only the other slots are filled);
"Clear" removes only our slots; AM2R (bucket `none`) makes no SteamGridDB request; § 0.5 PASS.

### M5d — ScreenScraper metadata source (Build; feature, after M5b)

**Why:** § 7.10 row 2. ScreenScraper credentials are in settings, but no metadata ever came from it:
`screenscraper_media.lua` fetches only media (screenshots, fanart, video, manual) through `jeuInfos.php`.
**Decided (user, 2026-09-28, § 11 item 8):**
- **Priority:** **IGDB first when the user has entered IGDB (Twitch) credentials**; ScreenScraper fills
  in when IGDB is not configured or finds no match. ScreenScraper matters because it is the easy one:
  a plain free account is enough, while IGDB needs a Twitch developer app.
- **Credentials:** as today (settings panel, masked, `.env`), per "Provider credentials" above.
- **Fields (decided, user 2026-09-28):** `synopsis` → `description` (English first, else the first language
  available); `developpeur` → `developers`; `editeur` → `publishers`; `familles` → `franchises`; `dates` →
  `release_date` = the **earliest** regional date (Steam shows one original release date); `joueurs` →
  `categories.single_player` (min players is 1) and `categories.multiplayer` (max players > 1); `genres` →
  `genres` (stored, not displayed by Steam). Co-op, split screen and controller badges are not provided by
  ScreenScraper (controller support keeps coming from the emulator inference). One Lua check per mapping.
**Design:** `src_screenscraper` in `metadata_service.lua`, reusing `screenscraper_media.lua`'s
`jeuInfos.php` client and ROM hashing (CRC/MD5 of the ROM path from the shortcut's launch options),
gated by `services.screenscraperEnabled` and the routing service `screenscraper`. Selection for
`web-scraping` and unmatched `steam-store` becomes: local DB → IGDB (if configured and allowed) →
ScreenScraper (if configured and allowed) → fallback record. Lua tests with a recorded `jeuInfos`
fixture (no network); `audit_missing_metadata.mjs` stays at 0 missing; a retro shortcut with only
ScreenScraper credentials gets its synopsis and credits.
**Beyond metadata:** ScreenScraper is also the main source for the community/media section
(artwork, fanart, videos, manuals and guides; § 7.10 row 3, Media service after M7).

### M6a — Achievements service (Build)

**Why:** Flow C and § 4.3. Achievement selection is spread over `CartridgesAchievementsGet`
(backend, a fixed fall-through chain) and `features/achievements/*` (frontend loader, observer polling,
launch toast). Fixes **K1**, **K2** and **K7**. **Behaviour:** none visible except the three fixes
(nothing calls the new part until M6b).
**Design:**
1. `backend/ach_service.lua` with sources behind the § 4.3 contract and injectable deps for tests:

   ```lua
   local M = {}
   M.deps = {
     entry = nil,        -- nil = shortcuts.vdf lookup (steam_paths + shortcuts.by_appid); tests inject a table
     steam = nil,        -- nil = achievements_store.get_or_fetch(shortcut, native)
     ps3 = nil, ps4 = nil, ra = nil,   -- nil = ps3_trophies/ps4_trophies/retroachievements .get_or_fetch
   }
   --- ctx = { native = number|nil, hardcore = boolean, title = string }
   --- Returns Part<{ schema, unlocks }> with source = "steam" | "rpcs3" | "shadps4" | "retroachievements".
   function M.ensure(appid, ctx) end
   --- Disk only: achievements_store.get_state(appid) as a part, or nil.
   function M.local_part(appid) end
   return M
   ```

   Sources in this **order** (today's chain, unchanged), each with `supports(ctx, entry)`:

   | Source | supports | fetch |
   | --- | --- | --- |
   | `steam` | `ctx.native > 0` | `achievements_store.get_or_fetch(appid, native)` |
   | `rpcs3` | `ps3_trophies.find_trophy_dir(entry.exe, entry.launch_options)` is not nil | `ps3_trophies.get_or_fetch(appid)` |
   | `shadps4` | `ps4_trophies.find_trophy_dir(entry.exe, entry.launch_options)` is not nil | `ps4_trophies.get_or_fetch(appid)` |
   | `retroachievements` | `retroachievements.extract_rom_path(entry.exe, entry.launch_options)` is not nil | `retroachievements.get_or_fetch(appid, ctx.hardcore)` |

   Outcomes: the first supporting source that returns a schema → `ok`; a supporting source that returns
   `nil, err` → try the next; no source supports the shortcut → `{ status = "unsupported" }` and **no log
   line** (**K2**: AM2R has no ROM path, so RetroAchievements is never asked); every supporting source
   failed → `{ status = "error", message = <last err> }`. `CartridgesAchievementsGet` becomes a thin alias
   that calls `M.ensure` (same response shape: `{ schema, unlocks }` or `{ error }`).
2. `record_rpc.lua`: `EnsureFresh` handles `"achievements"` (`ctx.native` comes from the saved identity,
   `ctx.hardcore` from the frontend setting `raHardcoreMode`, passed in `FreshContext.hardcore`, a new
   optional field); `GetGameRecord` and `GetAllRecords` add `achievements = ach_service.local_part(appid)`.
3. `CheckUnlocks` (new RPC; `CartridgesAchievementsCheckUnlocks` stays as an alias): the body of
   `achievements_observer.check_unlocks`, returning `{ new_unlocks = [...] }`. **K1:** Millennium's
   `cjson` encodes an empty Lua table as `{}`, so the frontend got an object; the port normalizes
   (`Array.isArray(x) ? x : Object.values(x ?? {})`, M6b) and the Lua side sets
   `setmetatable(list, cjson.array_mt)` when `cjson.array_mt` exists (belt and braces).
4. **K7:** `achievements_observer.get_possible_folder_names`: replace the byte class
   `[:\xe2\x80\x93\xe2\x80\x94]` with whole-sequence substitutions (`:` → `-`, `–` → `-`, `—` → `-`) and
   collapse runs of spaces to one. The existing `test_backend.lua` check `keeps colon-to-dash normalized
   title` then passes (its expectation is the spec; do not edit it).
5. New hermetic `tests/test_ach_service.lua` (stubs as `test_identity.lua`; `deps` injected; no files
   read): `PC game without a ROM path is unsupported and silent` (assert the injected `ra` is not called
   and no `logger:warn` fired) · `native schema wins` · `rpcs3 trophy dir selects rpcs3` ·
   `shadps4 trophy dir selects shadps4` · `ROM path selects retroachievements with hardcore flag` ·
   `failing source falls through to the next` · `all supporting sources failing is error` ·
   `local_part is disk only` · `CheckUnlocks returns a list when nothing is new` ·
   `EnsureFresh achievements uses the saved identity`. Expected `ALL PASS`; add to `test:lua`.
**Exit:** `lua tests/test_ach_service.lua` → `ALL PASS`; `NSGA_STEAM_ROOT=C:/game/steam lua tests/test_backend.lua`
→ only the K8 line fails (`retroarch shortcut count`) unless M4.0 already fixed the fixture, then `ALL PASS`;
other suites unchanged; § 0.5 PASS.
**Docs:** `rpc.md`; `service-achievements.md` (new, replaces `docs/steam-cartridges-achievements.md`: sources,
order, `supports` rules, status meanings); § 12 K1/K2/K7 → fixed by M6a.

### M6b — Frontend adopts achievements; Flow C (Build)

**Why:** D4 for the `achievements` and `toasts` surfaces; Flow C (launch → observe → unlock → toast).
Deletes `features/achievements/` (the `PURGE(M6)` ports included). Fixes **K14**.
**Design:**
1. `frontend/app/achievements.ts`: `createAchievements({ backend, records, bus, hardcore, now })`:
   - `ensure(appid)`: `EnsureFresh(["achievements"], { …, hardcore })` → `records.update(appid, { achievements })`.
     Called from the view pipeline for every route except `none`, and on `shortcut.quit` (new captures,
     new unlocks).
   - Session (Flow C, replaces `observer-session.ts` and the launch/quit handlers in `index.tsx`):
     on `shortcut.launched` → launch toast policy (below), then poll `CheckUnlocks(appid)` every 2000 ms
     (today's interval) until `shortcut.quit`, plus one final check at quit. Each poll result is
     normalized to an array (K1); non-empty → `records.update(appid, { achievements: <merged> })` and
     `bus.emit("achievements.unlocked", { appid, ids })`.
   - Launch toast policy (moved from `launch-toast.ts`, unchanged): setting `localAchievementsNotifyOnLaunch`
     `off` / `first_run` / `all_runs`, and only when the record has achievements with `nTotal > 0`.
2. Surfaces become record-driven (D4):
   - `achievements.render(appid, record)`: feeds Steam's stores from `record.achievements.data`
     (`updateShortcutState`, which today's loader calls). Deletes `features/achievements/store-port.ts`.
   - `toasts`: subscribed in `index.tsx` to `achievements.unlocked`; it shows one toast per id, reading the
     name/description/icon/global % from `records.get(appid).achievements.data.schema`. Launch toast via the
     same surface. Deletes `features/achievements/toast-port.ts`.
   - `captures` gains `addSessionAchievement(appid, item)` and subscribes to `achievements.unlocked`: the
     `appSpotlightStore.GetOrCreateAppData(appid).m_session.AddAchievement(...)` write moves here from
     `observer-session.ts` (**K14**: the last Steam write outside `surfaces/`). `touches` gains
     `AppSpotlightStore.m_session.AddAchievement`.
3. Public API (D8) stays on `index.tsx`, reimplemented over `app/achievements.ts` and the ports:
   `loadAchievementsForApp`, `triggerAchievement`, `resetAchievements`, `getLocalAchievements`,
   `getLocalSchema`, `checkObserverUnlocks`, `startAchievementsObserver`, `dispatchAchievementToast`,
   `initAchievements` (the `cartridges:trigger_fake_achievement` window event listener stays: it is a
   documented test hook). Same names, same argument order, same return types.
4. Deleted: `features/achievements/` (all files), the achievements half of `features/scraper/on-update.ts`,
   the launch/quit achievement code in `index.tsx`. `FEATURE_IDS` unchanged (`achievements`,
   `achievements-observer`, `toasts` keep their meaning: `achievements-observer` gates the session).
5. Tests: `tests/app-achievements.test.ts`: `poll result object is normalized to an array` (K1) ·
   `launch toast off / first_run / all_runs` (3) · `unlock emits achievements.unlocked with the new ids` ·
   `quit stops polling and runs one final check` · `route none makes no achievements call`.
   `tests/achievements.test.ts` keeps testing `surfaces/achievements/core.ts` unchanged.
**Exit:** Animaniacs shows `0/98` (`node scratch/test_animaniacs_achievements.mjs`, output identical to the
pre-deploy run); Castlevania: Aria of Sorrow shows 66 achievements; AM2R shows no achievements and
`count_cycle.mjs` phase A has no `achievements for shortcut` line (K2); opening WUCHANG logs no
`newUnlocks.map` error (K1); `git grep -n "appSpotlightStore" -- frontend/features frontend/app` → nothing
(K14); § 0.5 PASS; switch-off `achievements` and `toasts`. **User test (only the user can):** a real
unlock during play shows one Steam toast, and the game's page lists it afterwards.
**Carry-over from the removed achievement plans** (read with `git show 0d599cf:<path>`; M6 **decides where each
plugs in**, it does not build them; each becomes its own feature plan):

| Removed doc | Open goal | Plugs in as |
| --- | --- | --- |
| `docs/plans/steam-cartridges-achievements-plan.md` | Agnostic local-unlock detector (engine logs, save files, emulator logs) | more channels inside `CheckUnlocks` (`achievements_observer.lua`), no new part |
| same | Launch toast Off / First run / All runs | done (setting exists; M6b keeps it) |
| same | Make the unlock real on Steam's side | out of scope (Steam-side write; ADR needed) |
| `docs/plans/steam-cartridges-native-achievements-mirror-plan.md` | Mirror a mapped shortcut's native schema/progress (ADR-0038 open question) | the `steam` source of `ach_service.lua` (schema already fetched); progress mirroring needs live investigation |
| `docs/plans/steam-cartridges-retrogames-achievements-plan.md`, `docs/steam-cartridges-retrogames-achievements.md` | Multi-console hashing, standalone emulator discovery (DuckStation, PCSX2, Dolphin, PPSSPP), RPCS3 trophies | new `supports`/fetch pairs in `ach_service.lua` (one source per emulator family); audit `ps3_trophies.lua`, `ps4_trophies.lua`, `emulator_controllers.lua`, `ra_hasher.js` first |

**Docs:** `service-achievements.md`, `surfaces.md` (achievements, toasts, captures record-driven),
`README.md`, § 7.9 (M6 rows ticked), § 12 (K14 fixed).

### M7a — Freshness, throttle and ingestion in the backend (Build)

**Why:** Flow B and user decision 2: only **new** shortcuts are fetched in the background; everything
else refreshes only when its page is opened and its data is stale. Today `features/scraper/sync-manager.ts`
scans the whole library for missing data (up to 100 per run) and keeps its history in SharedJSContext
`localStorage`; `on-update.ts` re-queries on every open. Fixes **K15** (a forced sync could overwrite a
user's manual Game Info edits). **Behaviour:** none until M7b calls it, except K15.
**Design:**
1. `backend/net.lua`: the **one** outgoing HTTP entry point. `net.get(url, opts)`, `net.post(url, body, opts)`
   wrap Millennium's `http` module and keep, per source id (`opts.source`: `"steam-store"`, `"igdb"`,
   `"retroachievements"`, `"steam-web"`, `"sgdb"`, `"screenscraper"`), a call counter and a circuit
   breaker: HTTP 429 → that source paused 30 min; 5 consecutive failures → paused 15 min (today's
   sync-manager numbers); while paused, calls return `nil, "paused"` without a request. `steam_store_throttle`
   keeps its rate limit and offline detection and calls `net`. Every module that did `require("http")`
   switches to `net` (list them with `git grep -n 'require("http")' -- backend` and put the list in the report). `GetDiagnostics` gains `http_calls = { [source] = n }` and `paused = { [source] = until }`.
2. `backend/fresh_policy.lua`: per `(appid, part)` it stores `checkedAt` (ms) in a **new** file
   `<data dir>/freshness.json` (`{ version = 1, parts = { ["<appid>"] = { identity = ms, metadata = ms, achievements = ms } } }`;
   a new file, so no existing format changes). `M.is_stale(appid, part, status, now)` with one table of TTLs:

   | Part / status | TTL | Why |
   | --- | --- | --- |
   | any, `custom` source | never | user edits are never refreshed (K15) |
   | identity `ok` with native | never | a Steam match is sticky; the user clears it in settings |
   | identity `ok` without native | 7 days | same as the store search negative cache |
   | metadata `ok` (igdb / screenscraper / fallback) | 24 h | Flow B |
   | metadata / identity / achievements `error` | 30 min | retry soon, never in a loop |
   | achievements `ok` | 24 h for the schema; unlocks are checked on every open (local files, no network for emulators) | Flow C covers play sessions |

   `EnsureFresh` consults it: a part that is not stale is returned from disk with no source call;
   `ctx.force = true` (new optional `FreshContext` field) ignores the TTL but **never** a `custom_override`
   record (**K15**: `RefreshGameMetadata`'s `force` stays for its alias callers only, and M7b removes them).
3. `backend/registry.lua`: `known_shortcuts.json` (new file: `{ version = 1, appids = [...] }`).
   `GetNewShortcuts()` → shortcuts in `shortcuts.vdf` not in the file, as `[{ appid, name, exe }]`.
   **First run** (no file): write every current shortcut as known and return `[]` (existing shortcuts were
   handled by the old sync; this prevents a 220-game storm). `MarkKnown({ appids })` adds to the file.
   The backend has no timer, so the frontend drives the loop (M7b).
4. Lua tests `tests/test_freshness.lua` (hermetic, clock injected): each TTL row as one check;
   `custom override is never forced` (K15); `first run seeds without new shortcuts`; `a new shortcut is
   reported once, then known after MarkKnown`; `429 pauses the source for 30 min`; `5 failures pause for
   15 min`; `a paused source makes no request`; `http_calls counts per source`. `ALL PASS`; add to `test:lua`.
**Exit:** the new suite and every other Lua suite pass (K8 per M4.0); § 0.5 PASS.
**Docs:** `service-freshness.md` (new: the TTL table, the breaker numbers, the registry rule); `rpc.md`.

### M7b — Frontend drives ingestion; sync manager and on-update deleted (Build)

**Why:** Flow B finished in the frontend; one owner for "when do we fetch". **Behaviour delta (user
decision 2):** the startup background job fetches **only new shortcuts**; opening a page refreshes only
its stale parts; the settings panel's "sync now" refreshes everything that is stale (or everything, with
force) but never a manual edit.
**Design:**
1. `frontend/app/ingest.ts` (replaces `sync-manager.ts`): `createIngest({ backend, routing, records, … })` with
   the same public surface the settings panel uses today, so the panel only changes an import path:
   `getSyncProgress`, `onSyncProgress`, `useSyncProgress`-equivalent hook data, `startSync({ forceAll, onlyAppids })`,
   `triggerSync(delayMs)`. Startup (`background-sync` switch, `triggerSync(3000)` as today): `GetNewShortcuts()`
   → for each, one at a time, 300 ms apart (today's pause): `EnsureFresh(appid, ["identity","metadata","achievements"], ctx)`
   with the route and allowed services from `domain/routing`, then `MarkKnown`. Stops on a `paused` result.
   `startSync({ forceAll })` from the panel: every shortcut, `ctx.force = forceAll`, same pacing and stop rule.
   Progress is reported exactly as today (`SyncProgress` shape unchanged).
2. The view pipeline (`features/source-view.ts` → `app/view.ts`, the last `features/` file of the pipeline):
   route → `EnsureFresh(parts, ctx)` for the parts the route allows; the backend's TTLs decide what is fetched.
   `on-update.ts` is deleted (its three jobs are covered: captures republish on every view since M2, unlocks by
   M6b's `ensure` on open, metadata by `EnsureFresh` with TTL).
3. Deleted: `features/scraper/` (both files), `features/source-view.ts` (now `app/view.ts`), the
   `steam_cartridges_sync_history_v1` localStorage key is ignored (not deleted: another profile may read it;
   M9 decides), `setCapturesRefresher` (§ 7.9).
4. Tests `tests/app-ingest.test.ts`: `startup ingests only new shortcuts` · `pacing is sequential` ·
   `a paused result stops the run` · `force sets ctx.force` · `progress events keep the SyncProgress shape`.
**Exit:** restart Steam and leave it 10 minutes on the library home without opening a game page:
`GetDiagnostics().http_calls` shows calls only for shortcuts added since the last run (zero if none).
Agents never change the library (§ 0.9); to see the positive case, **the user** adds one shortcut before
the restart, and exactly that one is fetched. Opening a page
whose metadata is older than 24 h increases `http_calls.igdb` by 1 for that app only; opening it again at
once adds 0. A shortcut with `custom_override` keeps its edits after "sync now" with force. § 0.5 PASS.
**Docs:** `service-freshness.md`, `README.md`, § 7.9 (M7 rows), § 12 (K15 fixed).

### M8 — Settings split (Build)

**Why:** `settings/settings-panel.tsx` is 2,707 lines and imports four `features/` modules, `rpc` and the
routing policy. By M8, three of those modules no longer exist (M4a, M6b, M7b replace them), so the panel
must reach the app through a proper port. **Behaviour: none**, except the new Troubleshooting panel
(kill switches and safety diagnostics, § 4.4 item 5) and one help line in "Community & Media".
**Hard rule (do-not-touch 1):** no settings key renamed, no default changed, no validator changed. The
first action below pins that with a test.
**Design:**
1. **Pin the defaults first.** Extract `DEFAULTS`, `DEFAULT_SERVICES` and the types (`Settings`, `SettingKey`,
   `ServicesConfig`, `ControllerOverride`, `LaunchNotifyOption`) from `settings/settings.ts` into
   `settings/defaults.ts`, which has **only `import type`** (D2: node cannot load an extensionless runtime
   import). The one runtime value it used from routing, `DEFAULT_BUCKETS`, is written there as the same
   literal (`{ version: 2, default: 'steam-store', rules: [], overrides: {} }`); `VALIDATORS` (which need
   `validateConfig`) stay in `settings.ts`, and `settings.ts` re-exports everything it exported before.
   Generate the snapshot from `defaults.ts` right after the extraction, before any other M8 edit:
   `node --experimental-strip-types -e "import('./frontend/settings/defaults.ts').then(m=>console.log(JSON.stringify(m.DEFAULTS,null,2)))" > tests/fixtures/settings-defaults.json`,
   and check it by hand against `git show HEAD:steam-cartridges/frontend/settings/settings.ts` (every key, every value).
   New `tests/settings-defaults.test.ts` (+2): `settings keys and defaults are unchanged` (deep-equal with the
   fixture) · `the bucket default equals the routing policy's DEFAULT_BUCKETS` (imports
   `domain/routing/policy.ts`, which has no runtime imports).
2. `settings/context.ts` (D3): the only way panels reach the app. `setPanelContext(ctx)` is called by
   `index.tsx` at the top of `init()`; panels read it with `usePanelContext()`. Structural types only
   (no import of `app/`):

   ```ts
   export interface PanelContext {
       routing: {
           listCollections(): { id: string; name: string; dynamic: boolean; shortcutCount: number }[];
           listShortcuts(): { appid: number; name: string }[];
           membersOf(id: string): ReadonlySet<number> | undefined;
           shortcutName(appid: number): string;
           getAutoRoutingProfile(appid: number): AutoRoutingProfile | undefined;   // type from domain/routing
       };
       ingest: {
           progress(): SyncProgress;                                  // shape unchanged (M7b)
           onProgress(fn: (p: SyncProgress) => void): () => void;
           trigger(delayMs?: number): void;
           start(opts?: { forceAll?: boolean; onlyAppids?: number[] }): Promise<void>;
       };
       records: {
           achievementsOf(appid: number): { nAchieved: number; nTotal: number } | undefined;
           metadataOf(appid: number): GameMetadata | undefined;       // kernel type
       };
       controller: { load(): Promise<void>; inferredFor(appid: number): boolean | undefined };
       steamStore: { setMapping(appid: number, steamAppid: number, name?: string): Promise<unknown> };
       safety: { featureIds: readonly string[]; diagnostics(): unknown; surfaces(): { id: string; installed: boolean; disabled: boolean; errors: number; lastError?: string }[] };
   }
   ```

   Backend calls go through `ports/backend.ts` (`settings -> ports` is rule-allowed). M8 adds these
   wrappers there, moved from `rpc.ts`: `getStatus`, `saveServiceCredentials`, `getRetroStatus`
   (`CartridgesAchievementsGetRetroStatus`). The panel's per-game "refresh metadata" uses
   `ensureFresh(appid, ["metadata"], { …, force: true })`, never `RefreshGameMetadata` (K15).
3. **Split verbatim** (only imports and the replacements in the table change):

   | New file | Moved from `settings-panel.tsx` | Replacements |
   | --- | --- | --- |
   | `settings/components.tsx` | `ITEM_ROW_STYLE`, `ItemRow`, `ToggleRow`, `SettingsModal` | — |
   | `settings/panels/metadata.tsx` | `MetadataServiceDef`, `MetadataSection` | `rpc.getStatus` / `rpc.saveServiceCredentials` → `backend.*`; `triggerSync` → `ctx.ingest.trigger` |
   | `settings/panels/achievements.tsx` | `AchievementSourceDef`, `AchievementsSection` | `rpc.cartridgesAchievementsGetRetroStatus` → `backend.getRetroStatus`; credentials and `triggerSync` as above |
   | `settings/panels/notifications.tsx` | `NotificationsSection` | — |
   | `settings/panels/activity.tsx` | `ActivitySection` | — |
   | `settings/panels/community.tsx` | `CommunitySection` | adds one help line under the title: "These apply when the Media service is connected (migration plan § 7.10)." |
   | `settings/panels/rules.tsx` | `RulesSection` | `listCollections` / `listShortcuts` → `ctx.routing`; `triggerSync` → `ctx.ingest.trigger`; the routing types come from `domain/routing` |
   | `settings/panels/audit.tsx` | `FlaggedShortcut`, `RevisionSection` ("Library Audit") | `ctx.routing.*`; `ctx.controller.*`; `getLocalAchievements` → `ctx.records.achievementsOf`; `rpc.getAllMetadata` → `backend.getAllRecords`; `rpc.getAutoRoutingProfiles` → `ctx.routing.getAutoRoutingProfile`; `rpc.cartridgesAchievementsGet` → `backend.ensureFresh(…, ["achievements"], …)`; `rpc.refreshGameMetadata` → `backend.ensureFresh(…, ["metadata"], { force: true })`; `rpc.steamStoreSetMapping` → `ctx.steamStore.setMapping`; `useSyncProgress` → `ctx.ingest`; `isServiceAllowed` from `domain/routing` |
   | `settings/sync-progress.tsx` | `SyncProgressBar` | `useSyncProgress` → a hook over `ctx.ingest.progress` / `onProgress` |
   | `settings/panels/troubleshooting.tsx` | **new** | see item 4 |
   | `settings/panel.tsx` | `SettingsPanel` (the shell, same order, Troubleshooting last before the progress bar) | — |

   `settings/settings-panel.tsx` is deleted. `index.tsx` imports `SettingsPanel` from `settings/panel`
   and **exports** it (a public-API addition, D8; the check in item 6 needs it).
4. **Troubleshooting panel** (the only new UI): title "Troubleshooting". One toggle per
   `ctx.safety.featureIds` entry, on = not in `disabledFeatures`; toggling writes the setting with the pure
   helper `toggleFeature(raw: string, id: string, on: boolean): string` in `settings/troubleshooting-core.ts`
   (keeps the order of `featureIds`, keeps unknown ids the user typed, no duplicates). A line "Changes take
   effect after Steam restarts." A read-only block: safe mode on/off, tripped ids and error counts from
   `ctx.safety.diagnostics()`, and one line per surface from `ctx.safety.surfaces()`
   (`id: installed | off | tripped (errors)`). Tests `tests/troubleshooting-core.test.ts` (+3): `turning off
   appends the id` · `turning on removes the id and keeps the rest in order` · `unknown ids are preserved`.
5. Architecture (D1): after M8 the allowlist has **no** `settings -> *` edge (`settings -> rpc`,
   `settings -> features/*` go); `settings -> domain` and `settings -> ports` are rule-allowed; `settings -> app`
   stays forbidden (the context is the port). Record the exact delta in the report.
6. **Read-only render check** `scratch/check_settings_panel.mjs` (new; the implementer writes it; CDP on
   `127.0.0.1:8080`, SharedJSContext): mount `PLUGIN_LIST['steam-cartridges-dev'].SettingsPanel` into a
   **detached** `<div>` with Steam's React (`SP_REACTDOM.createRoot(div).render(SP_REACT.createElement(Panel))`,
   or `SP_REACTDOM.render` when `createRoot` is absent), wait 3 s, and for each title print `PASS <title>` if
   `div.textContent` contains it, else `FAIL <title>`: `Metadata`, `Achievements`, `Notifications`,
   `Activity Feed`, `Community & Media`, `Routing Rules`, `Library Audit`, `Troubleshooting`. Then unmount.
   It clicks nothing and writes nothing.
**Exit:** `npm run test:ts` green with +5 tests; `node scratch/check_settings_panel.mjs` → 8 `PASS` lines;
`PLUGIN_LIST['steam-cartridges-dev'].safetyDiagnostics()` unchanged before/after deploy; § 0.5 PASS.
**User test:** open the plugin's settings page; every section shows as before, plus Troubleshooting;
switching one feature off there and restarting Steam shows it off in `safetyDiagnostics()`.
**Docs:** `settings.md` (new, § 0.6 template: the panels, the context contract, "How to add a panel");
`safety.md` (Troubleshooting panel); `README.md` layer list.

### M9a — Cleanup: code (Build)

**Why:** close the migration: every file in its layer, the allowlist empty, the purge ledger executed.
**Behaviour: none.**
**Design:**
1. **Remaining `features/` files move into their layer.** After M8 the architect expects exactly these
   (the implementer lists `git ls-files frontend/features` first; anything else: stop and ask):
   - `features/steam-store/index.ts` remainder (the public `setSteamStoreMapping`, `clearSteamStore`,
     `steamStoreState`, `acceptSteamStoreSuggestion`-free since M3.0) → `app/steam-store.ts`, over `ports/backend.ts`
     (`SteamStoreSetMapping`, `SteamStoreClearMapping`, `SteamStoreGetState` wrappers move there).
   - `features/steam-store/enriched.ts`, `resolve.ts` (`cdnArtworkUrls`), `store-item.ts` remainder: pure →
     `domain/`; anything that reads Steam → `sensors/`.
   - `features/game-info/controller.ts` → `app/controller.ts` (its `setting()` read becomes an injected reader).
   Then `frontend/features/` is deleted.
2. **`rpc.ts` folds into `ports/`**: every remaining wrapper moves to `ports/backend.ts`; importers switch
   to the kernel type names (D12); `rpc.ts` is deleted, and the `[/^rpc$/, /^ports$/]` layer rule with it.
   The RPC registration test scans `ports/backend.ts` only.
3. **Backend aliases:** list the globals in `main.lua` that `ports/backend.ts` does not call. Delete an
   alias only when it is (a) superseded by the facade and (b) not in § 7.10 (unwired features stay registered)
   and (c) not `GetDiagnostics`. Expected deletions: `GetGameMetadata`, `RefreshGameMetadata`, `GetAllMetadata`,
   `CartridgesAchievementsGet`, `CartridgesAchievementsCheckUnlocks`, `SteamStoreGetMapping`,
   `SteamStoreSaveKnownMatch`, `SteamStoreSearch` (verify each with `git grep`; update the Lua tests that call
   them to call the facade instead, and say which in the report). `rpc.md` lists the final set.
4. **Empty the allowlist.** Every remaining entry is removed by moving code (items 1–2) or by D3 injection.
   Known one: `safety -> settings` (`safety/switches.ts` reads the `disabledFeatures` setting) → the
   `FeatureSwitches` instance is created in `index.tsx` with an injected `readDisabled` and the setting-change
   hook; `safety/switches.ts` is deleted. End state: `tests/architecture-allowlist.json` is `[]`. The ratchet
   test stays (an empty allowlist means every edge must be rule-allowed).
5. **Kernel everywhere:** `steam/route.ts` `isNonSteamAppId` / `NON_STEAM_APPID_MIN` → `kernel/appid.ts`
   (`isShortcutAppId`, `NON_STEAM_APPID_MIN`); `route.ts` keeps only `appIdFromPath`. Remaining
   `appid >>> 0` / `| 0` triple lookups become `ShortcutId` keys (§ 1.5); list them with
   `git grep -nE "\\| 0\\)|>>> 0" -- frontend` and convert each, or justify it in the report (Steam APIs that
   need the signed key use `toSignedKey`).
6. **jsx hooks (§ 4.4 "one dispatcher"):** after M3 there are four `keepJsxPatched` installs (view sensor,
   captures headline, captures activity-cards, native-links). **Decision (architect, 2026-09-28): keep them
   separate.** Each already runs one O(1) handler, `jsx-hook.ts` guarantees one chain position per label and
   is shared by identical copy with `enhanced-achievements` (do-not-touch 6); a dispatcher would change that
   shared file for no measured gain. M9a writes ADR-0041 ("jsx-runtime hooks stay one per concern") and
   amends § 4.4. It adds one architecture test (+1): `keepJsxPatched` is called only from
   `sensors/view`, `surfaces/captures` and `surfaces/native-links`.
7. **Purge ledger (§ 7.9):** delete every row marked "M9" and decide every "M9 decides" row in the ledger
   itself. `setContentListener` is permanent composition wiring (captures → sections), not temporary: move its
   row to "kept, by design". The `steam_cartridges_sync_history_v1` localStorage key (M7b left it): removed once
   at start-up (`localStorage.removeItem`, in `app/ingest.ts`), then the line is deleted in a later release.
8. **Exit:** `git grep -n "PURGE(" -- frontend` → nothing; `ls frontend` → `app domain index.tsx kernel logger.ts
   ports safety sensors settings steam surfaces`; `node -e "console.log(require('./tests/architecture-allowlist.json').length)"`
   → `0`; `npm run check`, `npm run test:ts`, `npm run build`, all Lua suites green; § 0.5 PASS; parity 17/0;
   `audit_missing_metadata.mjs` 0 missing.
**Docs:** `rpc.md` (final RPC set, plus a "Public plugin API" section listing every `index.tsx` export with its purpose and callers, D8: each one stays public or is removed with the reason), `README.md` (every layer `current`), ADR-0041, § 4.4, § 7.9 closed.

### M9b — Cleanup: docs and live scripts (Build)

**Why:** the docs must describe the real tree, and the live checks must live with the plugin.
**Behaviour: none.**
**Design:**
1. **Live scripts:** `git mv scratch/arch-m0/{cdp,probe,test_props,count_cycle,catch_hang}.mjs` and
   `scratch/{check_all_tabs.js,test_nav_cycle.js,check_parity.mjs,check_settings_panel.mjs,audit_missing_metadata.mjs}`
   into `steam-cartridges/tests/live/` (fix their relative imports), add `npm run test:live` that runs the
   § 0.5 set in order, and update every reference: this plan's § 0.5 table and step exits, `AGENTS.md`
   Routine 3, `docs/plugins.md` guardrail 17, `docs/steam-debug.md` Trap 10 and § 7
   (`git grep -n "scratch/" -- docs AGENTS.md` must list only historical CHANGELOG lines afterwards).
2. **Execution aids:** delete `scratch/arch-m0/m*/` packages, `apply_step.py` and `pack_step.py` (§ 7.9 row);
   the migration's history stays in git and CHANGELOG.
3. **Docs to the real tree:** `docs/millennium-architecture.md` § Module layout (generated from
   `git ls-files steam-cartridges/frontend steam-cartridges/backend`, one line per file with its layer);
   `docs/steam-architecture.md` § 3 (every row `current`); `AGENTS.md` "What this repo is", Conventions
   and Routine 4 paths; `steam-cartridges/README.md` module table; `docs/steam-cartridges/README.md`
   "How to add a feature" re-checked against § 4.6 with the real paths.
4. **Close the migration:** this plan's header → "Complete"; § 0.2 all `Done`; ADR-0039 gets a
   "Completed 2026-…" note; `TASK.md` § Now points at the next work (the § 7.10 unwired features in their
   order: Media service, manual Game Info editing UI, reject-suggestion UI; and the D14 bugfix plans for
   K3, K4, K6, K13).
**Exit:** `npm run test:live` → every § 0.5 line PASS; `git grep -n "arch-m0" -- . ':!CHANGELOG.md'` → nothing;
the docs index links resolve (`git grep -n "](steam-cartridges/" -- docs/steam-architecture.md` → every target exists).
**Docs:** everything listed above.

### 7.9 Purge ledger (D13)

Temporary code the migration leaves behind on purpose, and the step that deletes it. **Dead code
is not in this ledger: it is deleted before it would be moved** (M3.0 frontend, M4.0 backend).
Each file row carries a `PURGE(<step>)` marker in the code from the step in "Marked". Setters are D3 wiring:
the listed step replaces them with a read of the record or a backend call, and deletes them
from both the feature and `index.tsx`. M9's exit includes `git grep -n "PURGE(" -- frontend`
printing nothing, and every row below being deleted.

| Item | Marked | Delete in | Why |
| --- | --- | --- | --- |
| dead frontend code (community tab/store/core, `applyCustomArtwork`, 8 unused exports, 8 RPC wrappers) | — | **M3.0 (done before any move)** | see the M3.0 table |
| dead backend code, if the M4.0 inventory finds any (the RPCs behind the M3.0 wrappers are **unwired features**, § 7.10, and stay) | — | **M4.0 (before the backend moves)** | see M4.0 |
| `frontend/features/achievements/store-port.ts` | M3.8 `PURGE(M6)` | M6 | D3 port; M6 moves the achievements pipeline to the backend |
| `frontend/features/achievements/toast-port.ts` | M3.8 `PURGE(M6)` | M6 | D3 port; toasts become `achievements.unlocked` subscribers |
| ~~setters `setExtraSectionsSink`, `setNativeLinksSink`, `setCapturesSinks`~~ | — | ~~M4c~~ **done** | `identity.native` comes from the record |
| setter `setArtworkSink` | — | M5c | the artwork part comes from the Artwork service |
| ~~`features/steam-store/known-apps.ts` and the TS title matcher in `features/steam-store/resolve.ts`~~ | — | ~~M4c~~ **done** | the backend's `normalize` is the only matcher |
| setters `setGameInfoProbe`, `setGameInfoWriter`, `setGameInfoSink`, `setGameInfoEnricher`; `features/game-info/index.ts`, `policy.ts` | — | M5b | Game Info comes from `record.metadata` |
| setter `setCapturesRefresher`, `features/scraper/on-update.ts`, `features/scraper/sync-manager.ts` | — | M7 | freshness and ingestion move to the backend |
| setter `setContentListener` | — | M9 decides | the content flag stays captures → sections; keep the setter or move it to an event |
| `rpc.ts` type aliases (`ConsolidatedMetadata`, `GameCategories`, achievement and artwork shapes), and `rpc.ts` itself (its `call` moves to `ports/transport.ts` in M4c) | — | M9 | importers use the kernel names (D12) and `ports/` |
| old RPC names kept as aliases for the M4–M7 facade | — | M9 | the registration test proves which are unused |
| `steam/route.ts` `isNonSteamAppId` | — | M9 | `kernel/appid.ts` everywhere |
| `scratch/arch-m0/<step>/` packages, `apply_step.py`, `pack_step.py` | — | M9 | execution aids, not product code; the live scripts move to `steam-cartridges/tests/live/` |

### 7.10 Unwired features register (§ 11 item 7)

Backend providers that are implemented and wanted but have no caller. They are **kept** (not dead
code, D13 does not apply) and each has the step that connects it. M4.0 verifies this list.

| # | Feature | What exists | What is missing | Wired in |
| --- | --- | --- | --- | --- |
| 1 | SteamGridDB artwork for shortcuts without a Steam match, empty slots only (§ 11 item 8a) | `web_sgdb.lua` (search by title, lookup by Steam appid, portrait/hero/logo/wide URLs), `GetArtworkForGame`, key storage in `web_config.lua`, routing option `steamgriddb`, the frontend URL writer with the SGDB CORS proxy fallback (`surfaces/artwork`) | a caller; a settings field for the key; the empty-slot check | M5c |
| 2 | ScreenScraper metadata, after IGDB when IGDB is configured (§ 11 item 8c) | credentials in settings, `screenscraper_media.lua` (`jeuInfos.php` client, ROM hashing), service toggle and routing option | any metadata mapping (the module extracts media only); a caller | M5d |
| 3 | ScreenScraper media for the community section: artwork, fanart, videos, guides/manuals (the main source, § 11 item 8c) | `GetGameMedia`, `GetGameManual`, `screenscraper_media.lua` | a surface that shows them (the old custom tab was never mounted and was deleted in M3.0; restore with `git show 5b6b2c8:steam-cartridges/frontend/renderers/community-tab.tsx` if wanted, but ADR-0022 prefers Steam's own sections) | Media service, after M7 |
| 4 | IGDB community (trailers, links, official artworks) | `igdb_community.lua`, `GetGameTrailers`, `GetGameCommunityLinks` | a surface; the `media` record part | Media service, after M7 |
| 5 | Manual Game Info editing | `SaveGameMetadata` (sets `custom_override`, which `web_metadata_db` and M5a honour) | a settings UI | settings step after M8 (M8 does not add features) |
| 6 | Reject a Steam Store suggestion | `SteamStoreRejectSuggestion`, the `rejected` list | a button in the Steam Store settings list | settings step after M8 |

---

## 8. Rules for every child plan

### 8.1 Required contents

Everything in [README.md](README.md) (root cause, preconditions, literal before/after
blocks, a command after every step, do-not-touch, banned actions, dry-run, failure
rule, guardrail checklist, commit, live verification), plus:

- **Boundary statement:** which single module moves, and the import-allowlist entries it removes.
- **`touches` declaration** for any surface it creates.
- **Baseline:** the § 0.5 PASS lines, all reproduced; plus the step's own extra checks.
- **Layer doc** per § 0.6.

### 8.2 Do-not-touch (whole migration)

1. Persisted file formats: `library_metadata.json` (including `custom_override`), `steam_store.json`, mappings, `achievements.json`, plugin settings keys and defaults.
2. [Guardrail 1](../plugins.md#1-prototype-hook-coupling-bismodorshortcut-shortcut-icons-and-getgameid): never hook `BIsModOrShortcut` on `AppOverview.prototype`; the scoped proxy stays inside the `game-info`/`playbar` surfaces.
3. [Guardrail 5](../plugins.md#5-persistent-in-memory-stubs--negative-cache-immunization): `StoreItemCache` stubs are never deleted, `m_setUnavailableApps` is purged on ingest, and nothing is ever written into `appStore.m_mapApps`.
4. [Guardrail 8](../plugins.md#8-dedicated-metadata-association-never-overwrite-appdatadetails): never assign `appData.details = {}`.
5. [Guardrail 16](../plugins.md#16-millennium-settings-panel-resolution--build-name-divergence): the dual-alias block in `definePlugin` and the `dev.ps1` `-SkipBuild` check.
6. `steam/jsx-hook.ts` semantics (write guard, chain walk); it is shared by identical copy with `enhanced-achievements`.
7. The core promise ([ADR-0012](../decisions.md#adr-0012-split-into-a-core-plugin-and-optional-provider-plugins)): `sections` + `captures` work with every service disabled and no network.

### 8.3 Banned actions (whole migration)

See § 0.9. They apply to every step.

### 8.4 Failure rule

See § 0.8.

### 8.5 Guardrail checklist this migration touches

| Guardrail | How the architecture enforces it |
| --- | --- |
| 1 ID coupling | proxy lives only in `game-info`/`playbar` surfaces; `touches` test forbids `AppOverview.BIsModOrShortcut` |
| 2 O(1) hooks | hooks read `record.get()` only; banned action 8.3 |
| 3 single-pass modules | `Surface.install` resolves once; `steam/modules.ts` is the only scanner |
| 4 multi-tab smoke / 6 two-way nav / 9 CDP suite | § 0.5, required in every step |
| 5 stubs | owned by `captures`; `clear()` contract forbids deleting stubs |
| 7 categories | owned by `game-info`, which alone writes `m_setStoreCategories` |
| 8 details | owned by `game-info`/`achievements`; do-not-touch 4 |
| 10/11 memo + re-render | owned by `sections`; other surfaces request a refresh through `record.updated` |
| 12 popups | `view-sensor` and `toasts` document their window assumptions |
| 13 MobX computed | only `collections-sensor` reads `collectionStore` |
| 14 gates | domain routing gates fetching only; surfaces always render local parts |
| 15 checks | baseline never edited by a migration plan |
| 16 build name | do-not-touch 5 |
| 17 renders never start work | kernel `record.update` emits only real changes; surfaces write in `render()` from events, never from a Steam render; hooks are pure reads; § 0.5 `count_cycle.mjs` in every step |

---

## 9. ADR

**[ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) (accepted):** steam-cartridges is a ports-and-adapters modular monolith; only surfaces
write to Steam.** It records §3 (options), §4.1 (dependency rule), §4.4 (surfaces,
isolation, kill switches, safe mode) and the `GameRecord` read model. It amends
[ADR-0004](../decisions.md#adr-0004-backend-owns-all-io-and-merging-the-frontend-only-renders)
(the frontend also owns sensors and surfaces, which are Steam I/O) and
[ADR-0033](../decisions.md#adr-0033-exclusive-source-buckets-resolved-in-the-frontend-from-steams-collections)
(collections are read by a sensor, and routing policy is pure domain code). It keeps
ADR-0012/13/14 as the path to provider plugins.

---

## 10. Commit instructions (this plan's own updates)

A plan or docs update (no plugin code) stages only the doc paths it changed,
e.g. `git add docs/plans/steam-cartridges-architecture-migration-plan.md TASK.md CHANGELOG.md`,
and commits per § 0.7 with a `docs(plans): …` message. This repo is exempt from
AGENTS.md Routine 6.

## 11. User decisions (2026-09-28)

1. **Pipeline logic lives in the backend** (M4–M7): resolution, freshness and
   metadata/achievement selection (routing excepted: item 6). The frontend is sensors, surfaces and a thin `app/`
   that calls `GetGameRecord` / `EnsureFresh`.
2. **New shortcuts are fetched in the background** at startup, rate-limited. All
   other refreshes happen only when the page is opened (Flow B).
3. **Feature freeze** on `steam-cartridges` until M3 is complete.
4. **Dead code is purged, not migrated; temporary code is deleted when the migration completes**
   (2026-09-28, answering K9 and `applyCustomArtwork`): code nothing uses is deleted before its
   layer moves (M3.0 frontend, M4.0 backend); temporary D3 ports and setters are marked
   `PURGE(<step>)` and listed in the § 7.9 ledger (D13).
5. **Migration steps are pure moves** (2026-09-28, answering K4): "the point of the migration is a
   hexagonal architecture where each layer has a very specific input/job/output". Behaviour bugs
   found on the way get their own bugfix plans (D14).
6. **Routing policy stays pure TypeScript** (2026-09-28): routing rules have a `regex` condition
   (JavaScript `RegExp`) that Lua cannot evaluate, so buckets and service rules live in
   `frontend/domain/routing/`; the backend gets the route as context and keeps identity, fetching,
   storage and freshness. Amends decision 1 for routing only (ADR-0040, written in M4a).
7. **SteamGridDB, ScreenScraper and IGDB-community are features to wire, not dead code** (2026-09-28):
   their backend providers are kept and connected by M5c, M5d and the Media service (§ 7.10).
8. **Providers** (2026-09-28): (a) SteamGridDB fetches artwork for any game without a Steam match,
   into empty art slots only; (b) provider credentials are entered by the plugin's users in the
   settings panel and saved locally and safely (plan § 7 "Provider credentials"); (c) IGDB takes
   priority for metadata when the user has entered its credentials; ScreenScraper, which only needs a
   simple account, fills in otherwise, and is also the main source for the community/media section
   (artwork, fanart, videos, guides/manuals). (d) ScreenScraper → Game Info fields: description (English
   first), developer, publisher, franchise, earliest regional release date, single/multiplayer badges from the
   player count, genres stored (M5d).
9. **Library housekeeping** (2026-09-28): K8's count change is intentional (fixture → 215 in M4.0); the five
   orphaned `library_metadata.json` records are removed once by migration v2 (M4.0).

Recorded in [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam).

---

## 12. Known issues (found 2026-09-28, not fixed by M0a)

Executing agents add to this list instead of fixing things outside their step.

| Id | Issue | Evidence | Fixed by |
| --- | --- | --- | --- |
| K1 | `checkObserverUnlocks` throws `TypeError: newUnlocks.map is not a function` | SharedJSContext console on opening WUCHANG, stack `checkObserverUnlocks < handleGameOpenUpdate`; cause: Millennium's `cjson` encodes an empty Lua table as `{}` | M6a (backend) + M6b (port normalizes) |
| K2 | A plain PC game (AM2R) goes through RetroAchievements and logs `Failed loading achievements for shortcut …: cannot extract rom path` on every view; should be `unsupported` and silent (ADR-0014) | `count_cycle.mjs` phase A output | M6a (`supports` needs a ROM path) |
| K3 | `liveInstances` in `game-info-patch.ts` (now `surfaces/game-info/patch.ts`) never drops unmounted component instances (slow leak; `forceUpdate` on them is a no-op) | source read | Bugfix plan after M3 (D14; needs a live check of React's unmount state) |
| K4 | "Mark as Private" is enabled for an enriched shortcut and would send the shortcut appid to the private-apps service | [steam-components.md § Header buttons](../steam-components.md#header-buttons-manage-and-properties) | Bugfix plan after M3 (D14; user decides hide-or-keep there) |
| K5 | **Resolved 2026-09-28:** LuaJIT 2.1 installed at `C:\dev\tools\lua` and added to the user `PATH`. Was: no Lua interpreter on this machine: `tools/lua/` is missing and `lua`/`luajit` are not on `PATH`, so `tests/test_backend.lua` and `tests/test_steam_store.lua` cannot run. AGENTS.md Routine 4 assumes `tools/lua/` | `which lua luajit` → nothing | **User**: provide a LuaJIT/Lua 5.1 binary in `tools/lua/`. Blocks M4–M7 |
| K7 | `achievements_observer.get_possible_folder_names` (commit `22bac99`, never run: there was no Lua until K5 was fixed) turns `"WUCHANG: Fallen Feathers"` into `"WUCHANG -  Fallen Feathers"` (two spaces), and its `[:\xe2\x80\x93\xe2\x80\x94]` byte class replaces **each byte** of an en/em dash, so `"A – B"` becomes `"A  -  -  -  B"` | `test_backend.lua`: `FAIL keeps colon-to-dash normalized title`; `lua -e` repro | M6a |
| K8 | `test_backend.lua` fixture `FIXTURE.retroarch = 216`; the live library now has 215 RetroArch shortcuts (library-dependent fixture, AGENTS.md Routine 4) | `FAIL retroarch shortcut count -> 215` | M4.0 (user confirmed the change is intentional; fixture → 215) |
| K9 | `renderers/community-tab.tsx` is imported by nothing, so `steam/community-store.ts` (the second writer of `CWorkshopStore.m_mapPublishedFiles`, D7) never runs; the trailers/manual/links RPCs have no frontend caller | `git grep -n "community-tab\|community-store" -- frontend` (2026-09-28) | M3.0 (deleted before any move) |
| K10 | Desktop A → B between two shortcuts never unpublished A (Big Picture did) | `index.tsx` desktop `onLocationChange` block, read 2026-09-28 | M2 (behaviour delta 1) |
| K11 | An achievement observer whose mapping resolved after the game quit was never stopped (`onQuit` registered too late) | `steambrew-utils` `onAppLaunch` source: quit callbacks run once, at quit | M2 (behaviour delta 5) |
| K12 | `source-view.ts`'s Big Picture detector ran the view pipeline synchronously from inside a jsx call (inside Steam's render), on every re-render | `watchGamepadAppid` observes `jsx()` calls; source read 2026-09-28 | M2 (D5: timer emit, re-render dedupe) |
| K13 | `surfaces/captures/activity-cards.ts` (ex `steam/activity-cards-patch.ts`) has its own `getSteamRequire` chunk-push scanner next to `steam/modules.ts` `steamRequire` (guardrail 3: one scanner) | `git grep -n getSteamRequire -- frontend` after M3.3 | Bugfix plan after M3 (D14) |
| K14 | `features/achievements/observer-session.ts` writes Steam's `appSpotlightStore` session (`m_session.AddAchievement`) directly: the last Steam write outside `surfaces/` after M3 | `git grep -n appSpotlightStore -- frontend/features` (2026-09-28) | M6b (moves into the `captures` surface) |
| K15 | The settings panel's "sync all" (`startSync({ forceAll })`) calls `RefreshGameMetadata`, whose `force` write bypasses `custom_override`, so a full sync can overwrite a user's manual Game Info edits | `web_rpc.lua` `RefreshGameMetadata` → `metadata_db.set(appid, meta, true)`; `sync-manager.ts` | M7a (TTLs never force a custom record) + M7b (the panel stops calling it) |
| K6 | Render-time Steam store writes remain in `G.render`/`k.render`/the props getter (idempotent after M0a, but still writes during render) | M0a design | Bugfix plan after M3 (D14): find a non-render trigger for Steam's overview rebuild, else an ADR exception for the idempotent render-time repair |
| K16 | Every kill switch was silently inert: `settings.ts` `apply()` ran `JSON.parse(raw)` unconditionally on a stored string value and discarded it (`raw = undefined`, falling back to `DEFAULTS[k]`) whenever the value wasn't valid JSON — which `disabledFeatures` (a plain comma-separated string, e.g. `"sections"`) never is. `setSetting('disabledFeatures', id)` therefore persisted to disk correctly but the in-memory `current.disabledFeatures` (and so `features.isEnabled`) stayed `''` forever, live or after a restart. Present since M0b-1; found live-testing M3.1's switch-off check (2026-09-28) | `safetyDiagnostics().disabled` stayed `[]` after `setSetting('disabledFeatures','sections')` and a restart; DOM still showed the sections | **User decision (2026-09-28): fixed inline in M3.1**, not deferred — every M3.x switch-off live check depends on it. Fix: on a `JSON.parse` failure, keep the original string instead of discarding it |
| K17 | `dispatchAchievementToast`'s `resolveAchievementProto()` webpack scanner never finds `CClientNotificationAchievement` on this Steam build/version: every call logs "Could not resolve Steam achievement notification protobuf." and returns `false`, so the native achievement toast never fires. Present before M3.6 too (confirmed on the pre-move build); a pure move (D14) does not fix it | `PLUGIN_LIST['steam-cartridges-dev'].dispatchAchievementToast(...)` → `false` on both the pre-M3.6 and M3.6 builds; `Could not resolve Steam achievement notification protobuf.` in the SharedJSContext console | Bugfix plan after M3 (D14): needs a fresh scanner signature check against the live Steam build (ADR-0005 signatures may be stale) |
| K18 | `check_parity.mjs` check 15 (header links: Store Page, Community Hub, Discussions, Guides, Support) fails on the native `HelpAppPage` ("Support") link — it never resolves for a mapped shortcut, so the header's Support link stays on the shortcut's own (non-existent) page instead of opening the native app's. Present before M3.7 too (confirmed 16 PASS / 1 FAIL on both the pre-move and M3.7 builds) | `node scratch/check_parity.mjs` → check 15 FAIL with `needIds` missing `HelpAppPage`, on both builds | Bugfix plan after M3 (D14): `native-links` needs to also map the Support header link, not just Store/Community Hub/Discussions/Guides |
