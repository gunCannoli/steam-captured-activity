# Plan: steam-cartridges Architecture Migration (ports & adapters)

**Status:** Accepted 2026-09-28. **M0a, M0b-1, M0c and M1 are Ready** (mechanical; dry-run cumulatively; M0a, M0b-1 and the M0c check fix also live-validated). The rest are specified (§ 0.2).
**Kind:** Umbrella plan plus execution manual. § 0 tells the executing agent exactly how to work. § 7 holds every step. M0a has literal before/after blocks now. Every later step gets them when its row in § 0.2 is flipped to `Ready`, because earlier steps change the code it edits.
**ADR:** [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) (accepted).
**Tracking:** [TASK.md](../../TASK.md) · **Docs index:** [steam-architecture.md](../steam-architecture.md)

---

## 0. Execution manual (read all of § 0 before touching anything)

### 0.1 How to execute a step

You execute **one step per session**, the first row in § 0.2 whose status is `Ready`.
Do exactly this, in order:

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

Statuses: `Ready` = mechanical, execute it · `Spec` = specified, an architect must
write its literal blocks and dry-run them first · `Done` · `Blocked (<why>)`.

| Step | What | Status | Layer doc |
| --- | --- | --- | --- |
| M0a | Fix the render feedback loop (Properties hang) | **Done** | — (findings already in knowledgebase, steam-components, steam-debug, plugins.md guardrail 17) |
| M0b-1 | Kill switches, error budget, boot sentinel / safe mode | **Ready** (after M0a) | `docs/steam-cartridges/safety.md` |
| M0b-2 | Fail-open wrappers on every Steam hook | Spec | `docs/steam-cartridges/safety.md` (update) |
| M0c | Architecture test (import ratchet, RPC registration) + `check_all_tabs.js` flake fix | **Ready** (after M0b-1) | `docs/steam-cartridges/README.md` |
| M1 | Kernel (`ShortcutId`, events, `GameRecord`, `Surface`) | **Ready** (after M0c) | `docs/steam-cartridges/kernel.md` |
| M2 | Sensors (view, lifecycle, collections, owned apps) | Spec | `docs/steam-cartridges/sensors.md` |
| M3.1–M3.10 | Surfaces, one per step | Spec | `docs/steam-cartridges/surfaces.md` (one section per surface) |
| M4 | Resolver service + RPC facade | Spec | `service-resolver.md`, `rpc.md` |
| M5 | Metadata service | Spec | `service-metadata.md` |
| M6 | Achievements service | Spec | `service-achievements.md` |
| M7 | Freshness + ingestion | Spec | `service-freshness.md` |
| M8 | Settings split | Spec | `settings.md` |
| M9 | Cleanup + docs | Spec | all |

Order is fixed: never start a row while an earlier row is not `Done`, except
that M0b-2 (Spec) may be skipped until an architect makes it Ready; M0c and M1 do not depend on it.

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
| `npm run test:ts` | ends with `ℹ tests 64` / `ℹ pass 64` / `ℹ fail 0` (71 after M0b-1, 73 after M0c, 81 after M1) |
| `npm run build` | contains `build Succeeded`; ignore the `@steambrew/ttc` update nag |
| `git status --short` (repo root) | empty before you start |

PowerShell note: run scripts as `powershell -ExecutionPolicy Bypass -File <script>`.

### 0.4 Preconditions for every step

Run from `C:\game\millennium`:

1. `git status --short` → no output.
2. `git log -1 --format=%s` → the subject of the last commit on `main`. Write it in your report.
3. `cd steam-cartridges; npm run check` → as in § 0.3.
4. `npm run test:ts` → as in § 0.3 (`ℹ fail 0`; pass count as § 0.3 says for the current step).
5. For a step with a blocks script (M0a, M0b-1, M0c): its `check` command, as the
   step's action 1 gives it. Any line containing `STALE` means the plan is out of date:
   stop (§ 0.8).

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
| `domain/` (pure frontend policy: display rules, normalization; routing and freshness live in the backend per §11) | `kernel/` | Steam, RPC, sensors, surfaces |
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
| Media | `media_*.lua` | trailers, manuals, links | `src_screenscraper_media`, `src_igdb_community` |
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
| `owned-apps-sensor` | owned-match part of `steam-store/resolve.ts` | native candidates for the resolver's context |

### 4.6 What "a new feature touches only its part" means in practice

| New feature | Files touched | Files not touched |
| --- | --- | --- |
| New metadata source (e.g. MobyGames) | `src_mobygames.lua`, the metadata source list, one settings panel | every surface, the resolver, achievements |
| New achievement source (e.g. Xenia) | `src_xenia.lua`, the achievements source list | game-info, captures, sections |
| New thing shown on the page from existing data | one new surface folder + its `touches` | services, other surfaces |
| New record field | `kernel/record.ts` (additive), the producing service, the consuming surface | everything else |
| New routing rule type | backend `resolve_policy.lua` + its Lua tests | surfaces, other services |

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
moved, and into the old one otherwise.

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
| Expected test counts after each Ready step (dry-run, cumulative) | M0a 64 · M0b-1 71 · M0c 73 · M1 81 |
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

### M0b-2 — Fail-open Steam hooks (Spec)

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


### M1 — Kernel (Ready after M0c is Done)

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

### M2 — Sensors (Spec)

**Design:** create `frontend/sensors/` and make each current detector a sensor that
emits kernel events through one bus instance (`frontend/app/bus.ts`, created here:
`export const bus = createEventBus((ev, err) => logger.warn(...))`).

| Sensor file | Takes over (delete from the old place in the same step) | Emits |
| --- | --- | --- |
| `sensors/view.ts` | `index.tsx` desktop `onLocationChange` + Big Picture `watchGamepadAppid` blocks; `features/source-view.ts` `initSourceView` detectors | `shortcut.viewed` / `shortcut.left` (dedupe: same appid + mode within 250 ms is one view) |
| `sensors/lifecycle.ts` | `index.tsx` `onAppLaunch` block | `shortcut.launched` / `shortcut.quit` |
| `sensors/collections.ts` | `features/buckets/collections.ts`, `ready.ts` | membership snapshot getter + `settings.changed`-style refresh |

`source-view.ts` becomes a subscriber of `shortcut.viewed`; `library-app` patch/unpatch
subscribe to `shortcut.viewed`/`shortcut.left`. Exit: one view log line per navigation
(`count_cycle.mjs` phase A shows exactly one `Fetching Game Info` line), § 0.5 PASS,
allowlist loses `index -> features/source-view` and the `features/source-view -> steam` edge.
Layer doc: `docs/steam-cartridges/sensors.md`.

### M3.1–M3.10 — Surfaces (Spec, one step each, in this order)

**Design common to all:** create `frontend/surfaces/<id>/index.ts` exporting a
`Surface` (kernel). Move the listed code **verbatim** into the surface folder, register
it with one `SurfaceRunner` in `index.tsx` (created in M3.1), and replace its old
start-up call. A surface reads only `GameRecord` parts plus Steam; it never imports
another surface, `features/`, or `rpc`. Every hook it installs is fail-open (M0b-2 shape)
and pure ([guardrail 17](../plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components)).

| Step | Surface `id` | Moves in (old file · symbols) | `touches` | Reads |
| --- | --- | --- | --- | --- |
| M3.1 | `sections` | `steam/sections.ts` (all) | `CAppDetailsSections.GetSections`, `m_setSectionsMemo` | route, metadata, achievements |
| M3.2 | `captures` | `steam/summary.ts`, `steam/activity.ts`, `steam/headline-patch.ts`, `steam/activity-cards-patch.ts`, `renderers/library-app.tsx` | `appSpotlightStore`, `appActivityStore`, `StoreItemCache.m_mapApps`, `StoreItemCache.BIsAppMissing`, jsx:headline, jsx:activity-cards | none (Steam's own captures) |
| M3.3 | `game-info` | `features/game-info/game-info-patch.ts` (k, G, `hookComponentProps`, `ensureAppOverviewHooked`, `refreshGameInfoInstances`), `metadata.ts`, `category-policy.ts` | `GameInfo.k.render`, `GameInfo.G.render`, `AppOverview.GetGameID`, `AppOverview.BHasStoreCategory`, `AppDetailsStore.descriptionsData`, `AppDetailsStore.associationData`, `AppOverview.rt_original_release_date`, `AppOverview.m_setStoreCategories` | metadata |
| M3.4 | `playbar` | `targetPlayBar` hook from `game-info-patch.ts` | `PlayBar.render`, `PlayBar.props` | metadata |
| M3.5 | `achievements` | `features/achievements/store.ts` | `AppDetailsStore.achievements`, `appAchievementProgressCache` | achievements |
| M3.6 | `toasts` | `features/achievements/dispatcher.ts`, `launch-toast.ts` | `NotificationStore.OnNotification` | achievements (via `achievements.unlocked`) |
| M3.7 | `native-links` | `features/steam-store/native-sections*.ts` | `appStore.GetAppOverviewByAppID`, `Navigator.App`, jsx:native-sections | identity |
| M3.8 | `community` | `renderers/community-tab.tsx`, `steam/community-store.ts`, `steam/community-core.ts` | `CWorkshopStore.m_mapPublishedFiles`, custom tab | media |
| M3.9 | `artwork` | `features/artwork/artwork.ts`, `features/steam-store/art-plan.ts` | `SteamClient.Apps.SetCustomArtworkForApp` | artwork |
| M3.10 | `library-home` | `renderers/library-home.tsx` | `collectionStore.OnAppOverviewChange` | none (library stats RPC stays until M4) |

During M3, a surface still gets its data from today's feature modules through a
**temporary adapter in `app/`** (e.g. `app/legacy-metadata.ts` that reads
`libraryCache` and calls `records.update`). M5/M6 replace the adapters with the
backend record. Each M3 step's exit: § 0.5 PASS, its allowlist edges removed, its
section added to `docs/steam-cartridges/surfaces.md`.

### M4 — Resolver service + RPC facade (Spec)

**Design:** backend `resolve_policy.lua` (port of `features/buckets/resolve.ts` +
`auto-routing.ts`; port the TS tests `buckets.test.ts`, `routing-rules.test.ts` to Lua
**first** and make them pass against the TS behaviour as the oracle), `resolve_identity.lua`
(native match: manual → owned candidates from `sensors/owned-apps` context → store
search; web identity: IGDB id, RA game id/hash, ScreenScraper id; negative results TTL
separate from positive). RPC: `GetGameRecord(appid)` (disk only) and
`EnsureFresh(appid, parts, context)`. Old RPC names stay as aliases (the M0c RPC test
keeps them registered). Frontend: `ports/backend.ts` replaces direct `rpc` imports for
the moved features. Exit: Jotunnslayer parity (`node scratch/check_parity.mjs` → `17 PASS / 0 FAIL`),
§ 0.5 PASS, Lua tests pass. Docs: `service-resolver.md`, `rpc.md`.

### M5 — Metadata service (Spec)

Sources behind `{ id, supports(ctx), fetch(ctx) → { status, data, ttl } }`:
`src_steam_appdetails` (from `steam_store_appdetails.lua` + `steam_store_normalize.lua`),
`src_igdb` (`web_igdb.lua`), `src_screenscraper` (`screenscraper_media.lua`, metadata
half). Storage stays `library_metadata.json` (`custom_override` preserved). The
`game-info` surface reads only `record.metadata`. Exit: 220/220 coverage unchanged
(`node scratch/audit_missing_metadata.mjs` → 0 missing), AM2R Game Info intact with
bucket `none` (ADR-0035), § 0.5 PASS. Doc: `service-metadata.md`.

### M6 — Achievements service (Spec)

Sources: `src_steam_schema`, `src_retroachievements` (`retroachievements.lua`),
`src_ps3_trophies`, `src_ps4_trophies`, `src_engine_logs` + emulator channels
(`achievements_observer.lua`, `emulator_controllers.lua`). Flow C events. Fix K1 and K2
(§ 12) here. **Inputs carried from removed plans** (read in full with
`git show 0d599cf:<path>`):

| Removed doc | Open goals M6 must decide or carry |
| --- | --- |
| `docs/plans/steam-cartridges-achievements-plan.md` | Agnostic local-unlock detector (engine logs, save files, emulator logs); launch toast setting Off / First run / All runs (exists: `localAchievementsNotifyOnLaunch`); later: make the unlock real on Steam's side |
| `docs/plans/steam-cartridges-native-achievements-mirror-plan.md` | Mirror a mapped shortcut's native schema/progress: choose between redirecting Steam's component to the native appid and fetching the schema; ADR-0038's open question; needs live investigation incl. UI performance |
| `docs/plans/steam-cartridges-retrogames-achievements-plan.md`, `docs/steam-cartridges-retrogames-achievements.md` | Multi-console hashing (N64 endian, NES header, Genesis SMD, `.m3u`, PS1/PS2 `SYSTEM.CNF`), standalone emulator discovery (DuckStation, PCSX2, Dolphin, PPSSPP), RPCS3 trophies. Audit what already exists (`ps3_trophies.lua`, `ps4_trophies.lua`, `emulator_controllers.lua`, `ra_hasher.js`) before planning |

Exit: Animaniacs `0/98`, Castlevania: Aria of Sorrow 66 achievements, AM2R shows no
achievements and logs nothing (`unsupported` is silent, ADR-0014), a real unlock toast
(user test). Doc: `service-achievements.md` replaces `docs/steam-cartridges-achievements.md`.

### M7 — Freshness + ingestion (Spec)

Backend `fresh_policy.lua`: per-part `checkedAt`, TTL 24 h, negative TTL separate;
per-source throttle and circuit breaker (from `steam_store_throttle.lua` and
`sync-manager.ts`). `registry_diff.lua`: shortcuts added since the last run →
background fetch, rate-limited (user decision 2). Delete `features/scraper/sync-manager.ts`
batch and `on-update.ts` once their callers use `EnsureFresh`. Exit: over a 10-minute
session with no page opened, the backend log shows **zero** network calls for
existing shortcuts; opening a page whose metadata is older than 24 h refreshes only
that app. Doc: `service-freshness.md`.

### M8 — Settings split (Spec)

Split `settings/settings-panel.tsx` (2,707 lines) into one panel per service/surface
under `settings/panels/`, each talking only to `ports/`. No settings key renamed, no
default changed. Add a "Troubleshooting" panel for `disabledFeatures` and
`safetyDiagnostics()`. Exit: all 7 tabs render (existing check in the settings plan
history: `git show 0d599cf:docs/plans/steam-cartridges-settings-redesign-plan.md`),
§ 0.5 PASS. Doc: `settings.md`.

### M9 — Cleanup (Spec)

Remove RPC aliases with no callers (the M0c test proves registration), empty the
allowlist, rewrite [millennium-architecture.md](../millennium-architecture.md) § Module
layout to the real tree, update AGENTS.md Routine 4 paths, and move
`scratch/arch-m0/{cdp,probe,test_props,count_cycle,catch_hang}.mjs` into
`steam-cartridges/tests/live/` (update every reference: § 0.5, plugins.md guardrail 17,
steam-debug.md Trap 10).

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
   metadata/achievement selection. The frontend is sensors, surfaces and a thin `app/`
   that calls `GetGameRecord` / `EnsureFresh`.
2. **New shortcuts are fetched in the background** at startup, rate-limited. All
   other refreshes happen only when the page is opened (Flow B).
3. **Feature freeze** on `steam-cartridges` until M3 is complete.

Recorded in [ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam).

---

## 12. Known issues (found 2026-09-28, not fixed by M0a)

Executing agents add to this list instead of fixing things outside their step.

| Id | Issue | Evidence | Fixed by |
| --- | --- | --- | --- |
| K1 | `checkObserverUnlocks` throws `TypeError: newUnlocks.map is not a function` | SharedJSContext console on opening WUCHANG, stack `checkObserverUnlocks < handleGameOpenUpdate` (`features/achievements`, `features/scraper/on-update.ts`) | M6 |
| K2 | A plain PC game (AM2R) goes through RetroAchievements and logs `Failed loading achievements for shortcut …: cannot extract rom path` on every view; should be `unsupported` and silent (ADR-0014) | `count_cycle.mjs` phase A output | M6 |
| K3 | `liveInstances` in `game-info-patch.ts` never drops unmounted component instances (slow leak; `forceUpdate` on them is a no-op) | source read | M3.3 |
| K4 | "Mark as Private" is enabled for an enriched shortcut and would send the shortcut appid to the private-apps service | [steam-components.md § Header buttons](../steam-components.md#header-buttons-manage-and-properties) | M3.4 (decide) |
| K5 | **Resolved 2026-09-28:** LuaJIT 2.1 installed at `C:\dev\tools\lua` and added to the user `PATH`. Was: no Lua interpreter on this machine: `tools/lua/` is missing and `lua`/`luajit` are not on `PATH`, so `tests/test_backend.lua` and `tests/test_steam_store.lua` cannot run. AGENTS.md Routine 4 assumes `tools/lua/` | `which lua luajit` → nothing | **User**: provide a LuaJIT/Lua 5.1 binary in `tools/lua/`. Blocks M4–M7 |
| K7 | `achievements_observer.get_possible_folder_names` (commit `22bac99`, never run: there was no Lua until K5 was fixed) turns `"WUCHANG: Fallen Feathers"` into `"WUCHANG -  Fallen Feathers"` (two spaces), and its `[:\xe2\x80\x93\xe2\x80\x94]` byte class replaces **each byte** of an en/em dash, so `"A – B"` becomes `"A  -  -  -  B"` | `test_backend.lua`: `FAIL keeps colon-to-dash normalized title`; `lua -e` repro | M6 (or a bugfix plan before it) |
| K8 | `test_backend.lua` fixture `FIXTURE.retroarch = 216`; the live library now has 215 RetroArch shortcuts (library-dependent fixture, AGENTS.md Routine 4) | `FAIL retroarch shortcut count -> 215` | Update the fixture to the live count in the next backend step, after confirming the user removed one on purpose |
| K6 | Render-time Steam store writes remain in `G.render`/`k.render`/the props getter (idempotent after M0a, but still writes during render) | M0a design | M3.3 moves them to `Surface.render` |
