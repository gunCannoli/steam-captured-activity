# Plan: M10, close the gaps of the steam-cartridges migration (one batch, 13 steps)

**Status:** **Done (live-verified 2026-09-30: `npm run test:live` 10/10 PASS, probes below; five visual hand checks not run)** (was Ready, 2026-09-30). Dry-run done: the 13 patches in [steam-cartridges-m10-gap-batch/](steam-cartridges-m10-gap-batch/) were
applied in order to a clean worktree of `f35ed31` and every expected output below was observed there; the resulting tree is
byte-identical to the architect's build tree (§ 11). Live verification (§ 8): `dev.ps1` deploy and restart, `test:live` 10/10 PASS, `http_calls` (no source grew), `shortcut_icon` 3135033888 (`PASS icon sharp`, 184x184), `steam_store.json` slots `[0,1,2,3]`, `exception_stack` AM2R and WUCHANG (none), `toast_live` (dispatched). Not run (need eyes): BPM Activity thumbnails (step 3), Jotunnslayer first-open description after a restart (step 4), Library grid sort log line (step 8), PlayBar ⓘ and Troubleshooting surface count of 8 (step 9).
**Kind:** Architecture cleanup (ADR-0039 → [ADR-0044](../decisions.md#adr-0044-steam-cartridges-layers-stay-dumb-and-a-test-checks-what-each-layer-does)),
written for the weak implementer ([the plan standard](README.md)). The literal before/after blocks are the patch files: each
step applies one with `git apply` (a mismatch means the plan is stale: stop).
**Parent:** [the audit plan](steam-cartridges-architecture-audit-plan.md) (its findings F01–F32 and decisions R01–R22).
It absorbs [the artwork fetch plan](steam-cartridges-artwork-fetch-plan.md) as step 7.
**Asked for by:** the user, 2026-09-30: "detail part 2 so the next agent can just execute the implementation … keep each
layer boring and dumb, only with its own job, preventing the pollution that caused the migration in the first place. No
need to go too crazy: the number of layers we have is probably enough."
**Tracking:** [TASK.md](../../TASK.md) · the migration plan gets its M10 row in step 13.

---

## 0. Decisions (made by the architect on the user's principle, recorded in ADR-0044)

The user asked for every design decision to be taken here. Each answer below follows one rule: *a layer does only its
own job; no new layer*.

| Q (audit § 5 S7) | Decision | Where |
| --- | --- | --- |
| Q1 How does a surface tell the backend what it wrote? | The surface emits its own result event (`artwork.applied`); `app/artwork` records it through the port. The icon file is stored by `app/artwork` **before** the plan reaches the record, so the plan carries the file's path. Library stats are loaded by a small `app/library-stats` and read O(1) by the surface. No surface calls the backend. | steps 7, 8 |
| Q2 `GameRecord.route` is never written | Removed (ADR-0044 is the ADR § 4.2 asks for). The route is policy evaluated per view; its one shape is the kernel's `Route`. | step 1 |
| Q3 Backend layout (§ 4.3) | As built; the source contract binds new sources. Two fixes: a store never fetches (the Steam web schema moves to the source `steam_schema.lua`), no module uses an RPC module as a library (`registry.shortcut` is the one `shortcuts.vdf` lookup; it was four copies). | step 11 |
| Q4 May `settings/` import `domain/`? | Yes, for types and validators. Policy is evaluated once, in `app/routing.serviceAllowed`, which the audit panel reaches through `PanelContext`. | step 6 |
| Q5 When does the frontend retry a failed lookup? | On the next view. One `app/session-memo` remembers only final answers (`ok`, `unsupported`); `fresh_policy.lua` answers a repeat identity or artwork failure from memory for its 30-minute error TTL (no file format change). `RETRY_MS` (two copies) is gone. | step 5 |
| Q6 F1 or M10 first? | **M10 first.** The F1 plan's patches are regenerated afterwards (its status line says so). | § 10 |
| Q7 `captures/bpm-style.ts` watches popups | The view sensor emits `window.opened` / `window.closed`; the surface styles the window it is handed. | step 3 |
| Q8 `index.tsx` public exports | Every name and behaviour kept; the bodies delegate to `app/` or a surface. | steps 4, 6 |

**Scope kept small on purpose (the user: "no need to go too crazy")**, each with its reason:
- `backend/shortcut_icon.lua`'s download fallback stays: it fails closed (`sniff` rejects a body under 100 bytes, tested),
  and downloading is a backend job. Only `SteamStoreDownloadImage`, which returned 4 bytes, goes (step 7).
- Steam-boundary appid conversions in four surface files stay (Steam keys shortcuts signed or unsigned); they are named
  exceptions in the ratchet. Our own in-memory maps key each shortcut once (step 10).
- The per-surface `deps` objects (module singletons, audit F30), two copies of `asList`, and the audit panel's own
  controller-badge display logic stay: right owner, small, no coupling. Later, if ever.
- `setEnricher` in `surfaces/game-info/patch.ts` stays: its comment says it breaks an import cycle.
- K20 (found here, § 12): nothing loads the controller inference at start-up. Not fixed (a pure refactor keeps behaviour, D14).

## 1. What changes, step by step

| Step | Patch | Layer | What | Closes (audit) | Behaviour delta (deliberate; anything else is a bug) |
| --- | --- | --- | --- | --- | --- |
| 1 | `01-kernel-shapes.patch` | kernel, domain, app, ports, sensors, settings | One `Route`, `OwnedCandidate`, `SyncProgress` in `kernel/record.ts`; `GameRecord.route` removed; `steam/gameid.ts` deleted for `kernel/appid.toGameId`; `SHORTCUT_MIN` and literals replaced by `NON_STEAM_APPID_MIN` | F10–F13, R08, R12 | none |
| 2 | `02-jsx-runtime.patch` | steam, surfaces | One `jsxRuntime()` in `steam/modules.ts` (cached once found); the four `findJsxRuntime` copies and three surface `findModuleByExport` calls go | F14, R18 | the runtime is looked up once and remembered (was searched on every install) |
| 3 | `03-sensors.patch` | sensors, kernel, surfaces, index | `sensors/shortcuts` (`shortcutTitle`, `listShortcuts`) replaces two `titleOf` copies, `shortcuts()` and `steam/shortcut.ts`; the view sensor emits `window.opened`/`closed`; `bpm-style` styles the window it is handed; `shortcut.quit` carries the name | F07 (part), F08, F15, R15 | routing's and identity's title also falls back to the shortcuts.vdf name (was overview only); the Big Picture style is added one tick after the window opens |
| 4 | `04-app-factories.patch` | app, surfaces, index, tests | `app/steam-store` and `app/controller` become `create*` factories (no setters, no module state, injected backend); `app/view` loses its steam-store side effect; `game-info` reads `identity` and refreshes every window on a new Steam match (guardrail 11) | F16, F17, R02 | the guardrail-11 refresh fires when the record's Steam match changes (was: on the first steam-store view with a match) |
| 5 | `05-session-memo.patch` | app, backend, tests | `app/session-memo.ts` shared by `identity` and `artwork`; `fresh_policy.remember_error`/`recent_error`; `EnsureFresh` answers a recent identity or artwork error from memory | F18, R16 | a failed lookup is asked again on the next view and answered from the backend's memory for 30 min (was: not asked for 5 min, then asked the network) |
| 6 | `06-index-wiring.patch` | app, kernel, surfaces, settings, index, tests | `serviceAllowed` → `app/routing`; `resolveNative` → `app/achievements`; unlocks carry their items (`achievements.unlocked`) and the launch toast is an event; `toasts`/`captures` handle the events; the store-hook retry moves into the achievements surface; `steam-cartridges:rule-updated` window event replaced by the settings store's change events and `ingest.onProgress`; `PanelContext.records.achievementsOf` reads the record (`app/achievements.summary`) | F07, F19 (part), F20, F26, R07, R17, R22 | the audit panel refreshes on a settings change notice and every 4 synced games (was: a window event after each edit and every 4 games) |
| 7 | `07-artwork.patch` | kernel, domain, ports, app, surfaces, backend, tests | The artwork fetch plan, with Q1: `kernel/image-bin.ts` (slots), `ports/image` `forcePng`, `buildPlan` → `domain/art-plan`, `app/artwork` fetches the slots, stores the icon file (`SteamStoreSaveIcon`) and records `artwork.applied`; the surface reads the bin, writes, emits; `SteamStoreDownloadImage` deleted | F01, F06 (artwork), R14 | the icon file is stored at resolve time (was: when the surface ran; the backend refuses it unless eligible, as before); in the rare "mapping vanished mid-write" race the icon is set then restored (was: never set) |
| 8 | `08-library-stats.patch` | app, surfaces, index, tests | `app/library-stats.ts` loads the capture stats; `library-home` reads them O(1) | F06 (library-home), F28, R03 | stats load before the surface installs, only while `library-home` is on (as before) |
| 9 | `09-surfaces.patch` | surfaces, kernel, index, tests | `playbar` becomes a part of `game-info` (own switch `playbar`); `sections` re-renders from the `achievements` part and takes `captures.published`; `captures` emits it; `refreshSections`/`setContentListener` injection gone; **guardrail 8 fix** in `surfaces/achievements/store.ts` | F02, F05, R02, R03, R10 | `playbar` no longer appears as its own row in Troubleshooting's surface list (its switch stays); `appData.details` is never created for a shortcut |
| 10 | `10-badges-and-appids.patch` | kernel, domain, app, surfaces, settings, index, tests | `category-policy.ts` → `domain/`; the id tables → kernel; `app/metadata` puts `badge_category_ids` in the part; `game-info` writes them (no `controllerContext` dep); our maps key each shortcut once (`toUnsigned`), persisted maps read with `kernel/appid.lookupStored` | F09, F29, R11 | badges follow a changed "default full controller" setting on the next view of the game (was: on the next Game Info enrich) |
| 11 | `11-backend.patch` | backend, ports, app, tests | `registry.shortcut` (one `shortcuts.vdf` lookup, was four); `metadata_service` drops `web_rpc`; `steam_schema.lua` (source) out of `achievements_store.lua` (store); `GetGameRecord` (+ port), `GetArtworkForGame`, `SteamStoreGetAppDetails` deleted; `removeLegacySyncHistory` deleted | F21, F23–F25, F27, R09, R13 | none (the deleted RPCs had no caller) |
| 12 | `12-ratchet.patch` | tests | The capability ratchet and four more architecture checks (ADR-0044); `tests/architecture-capabilities-allowlist.json` (7 exceptions, each with its reason); `tests/architecture-unwired-rpcs.json` (7 RPCs, each with its plan) | R01 | none |
| 13 | `13-docs.patch` | docs | Layer docs to the new state (README rules table, kernel, sensors, surfaces, rpc, services, settings), migration plan M10 row, `setContentListener` ledger row | R06, R20, R21 | none |

## 2. Preconditions

Run in **Git Bash** from `C:\game\millennium` (`cd /c/game/millennium`). Another session may be working on
`enhanced-achievements` in the same checkout: every check below looks only at this plan's paths.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- steam-cartridges docs/steam-cartridges docs/millennium-architecture.md docs/plans/steam-cartridges-architecture-migration-plan.md` | prints nothing |
| P2 | `git diff --stat 024de07 HEAD -- steam-cartridges docs/steam-cartridges docs/millennium-architecture.md docs/plans/steam-cartridges-architecture-migration-plan.md` | prints nothing (the dry-run base; if it prints files, F1 or another change landed first: stop, the plan is stale) |
| P3 | `git diff --cached --name-only` | nothing, or only paths outside the four above (someone else's staged work; the commits below name their paths) |
| P4 | `ls -1 docs/plans/steam-cartridges-m10-gap-batch/` | 13 lines, `01-kernel-shapes.patch` to `13-docs.patch` |
| P5 | `cd steam-cartridges && npm run check` | `> steam-cartridges@0.1.0 check`, `> tsc --noEmit`, then nothing; exit 0 |
| P6 | `npm run test:ts` (in `steam-cartridges`) | summary contains `ℹ pass 160` and `ℹ fail 0` |
| P7 | the Lua block (§ 2.1), in `steam-cartridges` | the P7 row of the table in § 3.1 |
| P8 | `grep -c "^## ADR-0044: steam-cartridges layers stay dumb" ../docs/decisions.md` | `1` |

If P1–P8 do not all hold, stop (§ 6).

### 2.1 The Lua block (used by P7 and every step)

```bash
export NSGA_STEAM_ROOT=C:/game/steam
for t in test_backend test_steam_store test_migrate test_identity test_metadata_service test_art_service test_ach_service test_freshness test_emulator_controllers; do
  o=$(lua tests/$t.lua 2>&1); printf "%s=%s/%s " "$t" "$(echo "$o" | grep -c '  PASS')" "$(echo "$o" | grep -c '  FAIL')"
done; echo
```

It prints `name=PASS/FAIL` per suite on one line. `test_backend`'s 3 FAILs are its **library fixtures** (screenshot and
media-game counts that follow the live library, AGENTS.md Routine 4; audit F32): `NSGA_STEAM_ROOT=C:/game/steam lua
tests/test_backend.lua | grep '  FAIL'` must show only `non-steam games with media`, `screenshots indexed` and
`library_stats covers every media game`. If the numbers after `->` grew (new screenshots), that is still fine. Any other
FAIL is a stop.

## 3. Steps

Before step 1, once: `git tag m10-base` (§ 9). Then, for each step N from 1 to 13, **in order, one session, no skipping**:

```bash
cd /c/game/millennium
P=docs/plans/steam-cartridges-m10-gap-batch/<NN-name>.patch
git apply --check "$P"          # prints nothing; any output means the plan is stale: stop (§ 6), do not edit the patch
git apply --index "$P"          # prints nothing
cd steam-cartridges
npm run check                   # tsc: nothing after the two banner lines
npm run test:ts                 # compare the summary with § 3.1
# the Lua block (§ 2.1)         # compare with § 3.1
cd ..
git commit -m "<the step's message, § 3.2>" -m "<your session's attribution line>" -- steam-cartridges docs/steam-cartridges docs/millennium-architecture.md docs/plans/steam-cartridges-architecture-migration-plan.md
git log -1 --format=%h          # write the hash into your report, next to the step number
```

After step 13, also run `npm run build` in `steam-cartridges`: the output contains `build Succeeded passing all tests`
(a `TS5096` warning and the `@steambrew/ttc` update nag are known; ignore them).

### 3.1 Expected outputs (observed in the dry-run replay)

tsc prints nothing after every step. `test:ts` counts include `tests/architecture.test.ts` twice (`tests/app-routing.test.ts`
imports it), which is why step 12 adds 12.

| After | `npm run test:ts` | Lua block (§ 2.1) |
| --- | --- | --- |
| P7 (before step 1) | `ℹ pass 160` `ℹ fail 0` | `test_backend=77/3 test_steam_store=84/0 test_migrate=7/0 test_identity=18/0 test_metadata_service=49/0 test_art_service=59/0 test_ach_service=19/0 test_freshness=43/0 test_emulator_controllers=25/0` |
| step 1 | `ℹ pass 160` `ℹ fail 0` | same as P7 |
| step 2 | `ℹ pass 160` `ℹ fail 0` | same as P7 |
| step 3 | `ℹ pass 160` `ℹ fail 0` | same as P7 |
| step 4 | `ℹ pass 160` `ℹ fail 0` | same as P7 |
| step 5 | `ℹ pass 161` `ℹ fail 0` | as P7 but `test_freshness=46/0` |
| step 6 | `ℹ pass 163` `ℹ fail 0` | as step 5 |
| step 7 | `ℹ pass 168` `ℹ fail 0` | as step 5 but `test_steam_store=83/0` |
| step 8 | `ℹ pass 170` `ℹ fail 0` | as step 7 |
| step 9 | `ℹ pass 170` `ℹ fail 0` | as step 7 |
| step 10 | `ℹ pass 173` `ℹ fail 0` | as step 7 |
| step 11 | `ℹ pass 173` `ℹ fail 0` | `test_backend=77/3 test_steam_store=83/0 test_migrate=7/0 test_identity=17/0 test_metadata_service=48/0 test_art_service=59/0 test_ach_service=21/0 test_freshness=46/0 test_emulator_controllers=25/0` |
| step 12 | `ℹ pass 185` `ℹ fail 0` | as step 11 |
| step 13 | `ℹ pass 185` `ℹ fail 0` | as step 11 |

Removed checks, all of them for code the step deletes or replaces (guardrail 15 proof): step 4 replaces `app-view`'s
"leaving the steam-store bucket calls leave once" by "… stops resolving identity" and drops `steamStore.onView` from the
order test; step 5 replaces the two "retried only after 5 minutes" tests; step 7 replaces `artwork-icon`'s 7 tests (the
surface no longer saves or records) by 4, and drops `test_steam_store`'s `DownloadImage enforces the allowlist`; step 11
drops `GetGameRecord is disk only` (`test_identity`) and `GetGameRecord includes local metadata` (`test_metadata_service`).

### 3.2 Commit messages (first `-m`)

| Step | Message |
| --- | --- |
| 1 | `refactor(steam-cartridges): M10.1 shared shapes and the shortcut appid bound live in the kernel` |
| 2 | `refactor(steam-cartridges): M10.2 one jsx runtime lookup, in steam/modules` |
| 3 | `refactor(steam-cartridges): M10.3 sensors own shortcut titles and window lifecycle` |
| 4 | `refactor(steam-cartridges): M10.4 app/steam-store and app/controller are factories; game-info refreshes on a new Steam match` |
| 5 | `refactor(steam-cartridges): M10.5 one session memo in app/; the backend remembers recent identity and artwork errors` |
| 6 | `refactor(steam-cartridges): M10.6 index.tsx only wires; policy and unlock announcements live in app/` |
| 7 | `refactor(steam-cartridges): M10.7 artwork fetch leaves the surface; SteamStoreDownloadImage removed` |
| 8 | `refactor(steam-cartridges): M10.8 library capture stats are loaded by app/library-stats` |
| 9 | `fix(steam-cartridges): M10.9 no surface calls another; guardrail 8 in the achievements surface` |
| 10 | `refactor(steam-cartridges): M10.10 badges are decided in app/metadata; our maps key each shortcut once` |
| 11 | `refactor(steam-cartridges): M10.11 backend: one shortcuts.vdf lookup, the Steam schema is a source, dead RPCs removed` |
| 12 | `test(steam-cartridges): M10.12 the capability ratchet (ADR-0044)` |
| 13 | `docs: M10.13 the layer docs describe the batch (ADR-0044)` |

The attribution line is the one your session's instructions give (this repo keeps `Co-Authored-By` trailers; AGENTS.md
Routine 6 does not apply). Do not push until step 13 is committed; then `git push origin main` (never `--force`).

## 4. Do-not-touch

- The patch files and everything under `docs/plans/steam-cartridges-m10-gap-batch/` (they are the dry-run record).
- Persisted formats: `library_metadata.json`, `steam_store.json`, `achievements.json`, `freshness.json`,
  `known_shortcuts.json`, plugin settings keys and defaults (`tests/fixtures/settings-defaults.json`).
- `FEATURE_IDS` (the `playbar` id stays although `playbar` is no longer its own surface), the public exports of
  `frontend/index.tsx` (names), `steam/jsx-hook.ts` (shared by copy with enhanced-achievements), the guardrail-16 alias block.
- `tests/live/**` (guardrail 15), `tests/test_backend.lua`'s library fixtures, `tests/architecture-allowlist.json` (stays `[]`).
- Anything under `enhanced-achievements/`, `enhanced-notifications/`, other plans, ADRs (ADR-0044 is already committed).

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`) before step 13 is committed, and after it only as § 8 says;
no SharedJSContext reload; no probe or throwaway plugins; no edits to Millennium's `config.json` or the plugin's config
(except § 8's documented rollback); no changes to the user's library, collections or shortcuts beyond what § 8 lists; no
`npm install` / upgrade; no editing a patch "to make it fit"; no hand edits of product code (every code change is a patch);
no `git push --force`; no `--no-verify`; no `git stash`; no `git add -A` (commit with the pathspec of § 3); no
`ARCH_WRITE_ALLOWLIST=1` or `ARCH_WRITE_CAPABILITIES=1`.

## 6. Failure rule

Run a failing command at most twice. On the second failure, stop: append the command, its output (trimmed to 30 lines)
and the step number to [TASK.md](../../TASK.md) § Active Failures & Blockers, then exit. Do not retry, edit around the
failure or skip ahead. A step whose patch applied but whose checks fail is **not** committed: undo it with
`git apply -R --index docs/plans/steam-cartridges-m10-gap-batch/<NN-name>.patch` (prints nothing), then stop.

## 7. Guardrail checklist

Tick each after step 13, with its proof (`BASE` = `m10-base`):

- [ ] **1 (BIsModOrShortcut):** untouched. `git diff BASE -- steam-cartridges/frontend | grep -E "^\+.*BIsModOrShortcut"` prints nothing (the playbar code that reads it moved as a rename).
- [ ] **2 (O(1) hooks):** hooks do Map reads only. `git diff BASE -- steam-cartridges/frontend/surfaces | grep -E "^\+.*(fetch\(|callServerMethod|await )"` prints exactly four `await` lines of `surfaces/artwork` (`SetCustomArtworkForApp`, `setShortcutIcon`, `applyCustomArtwork`, `applyIcon`: the plan executor, not a Steam hook).
- [ ] **3 (one scanner):** `git grep -n "findModuleByExport" -- steam-cartridges/frontend` prints only `steam/modules.ts`.
- [ ] **5 (stubs):** `git diff BASE --stat -- steam-cartridges/frontend/surfaces/captures/activity.ts` prints nothing.
- [ ] **7 (categories):** the managed ids are still purged before each write: `git grep -n "MANAGED_CATEGORY_IDS" -- steam-cartridges/frontend/surfaces` prints the kernel import and the two purge loops in `game-info/metadata.ts`.
- [ ] **8 (appData.details):** `git grep -nE "\.details\s*=[^=]" -- steam-cartridges/frontend` prints only `surfaces/native-links/core.ts` (jsx props, allowlisted with its reason).
- [ ] **11 (re-render every window):** `git grep -n "refreshGameInfoInstances()" -- steam-cartridges/frontend/surfaces/game-info/index.ts` prints the identity-change refresh.
- [ ] **14 (a gate never removes behaviour):** every behaviour delta is in § 1; nothing else changed (the live suite, § 8).
- [ ] **15 (never weaken a check):** `git diff BASE --stat -- steam-cartridges/tests/live` prints nothing; the removed unit checks are exactly those listed under § 3.1.
- [ ] **16 (build name):** `git diff BASE -- steam-cartridges/frontend/index.tsx | grep -c "MILLENNIUM_SIDEBAR_NAVIGATION_PANELS"` prints `0`.
- [ ] **17 (a render never starts work):** surfaces start no fetch: `git grep -nE "\bfetch\(" -- steam-cartridges/frontend/surfaces` prints nothing; the ratchet (step 12) passes.

## 8. Live verification

Run by the implementer **only if the user said in this session that Steam may be restarted**; otherwise write "Live
verification pending: M10 § 8" in the report and stop. From `steam-cartridges`:

1. `powershell -ExecutionPolicy Bypass -File dev.ps1` (deploys the `-dev` copy, restarts Steam; the released plugin is
   not touched). Wait for `SharedJSContext` (`curl -s http://127.0.0.1:8080/json`) plus 20 s.
2. `npm run test:live`: every line `PASS` (parity may `SKIP` in Big Picture), exit 0. The ten lines: `parity`, `K4: Mark as
   Private disabled`, `K6: overview repair via trigger`, `render loop`, `Properties (WUCHANG)`, `Properties (Jotunnslayer)`,
   `navigation cycle`, `tabs`, `settings panel renders`, `audit: no missing metadata`.
3. Per step, by hand (AGENTS.md Routine 1 views on AM2R `4263274102`, WUCHANG `3135033888`, Jotunnslayer `2315502503`):
   - step 3: Big Picture, AM2R's Activity feed: thumbnails 320×180 (the `nsga-bpm-activity-thumbs` style).
   - step 4 (guardrail 11): after a Steam restart, open Jotunnslayer first thing: Game Info shows the native description
     without navigating away.
   - step 5: `node tests/live/probes/http_calls.mjs` before and after one `test_nav_cycle.js`: no new source's count grows.
   - step 6: launch and quit AM2R: no toast (no achievements), the log line `AM2R closed; refreshing its activity.`;
     `node tests/live/probes/toast_live.mjs` as before M10.
   - step 7: the artwork fetch plan § 7 items 1–2 (clear and re-link WUCHANG; `node tests/live/probes/shortcut_icon.mjs 3135033888`
     prints `PASS icon sharp`; `steam_store.json` `applied_artwork["3135033888"].slots` is `[0,1,2,3]`).
   - step 8: the Library grid sorts AM2R by its newest screenshot (the log line `Filled in last-played for …`).
   - step 9: desktop PlayBar ⓘ on AM2R; `node tests/live/probes/exception_stack.mjs 4263274102` and `… 3135033888` print
     no `TypeError`; WUCHANG's Achievements tab shows its achievements (guardrail 8 fix); Troubleshooting lists 8 surfaces.
   - step 10: Game Info badges of AM2R and WUCHANG as before M10 (the `parity` line covers the categories).
4. On any FAIL or a Steam "restart the UI" dialog: stop and roll back (§ 9 step 4), then report.

Only after 1–3 pass: set this plan's **Status** to "Done (live-verified <date>)" and fill the CHANGELOG line (§ 10).

## 9. Revert protocol (every step can be undone; observed in the dry-run)

1. **Before step 1:** `git tag m10-base` (and `git push origin m10-base` together with the batch).
2. **Undo step k:** revert the steps from 13 down to k, newest first, each as its own commit:
   `git revert --no-edit <hash of 13> <hash of 12> … <hash of k>` (the hashes from your report). The tree is then
   identical to the state after step k−1 and its checks are that row of § 3.1 (dry-run: reverting 13..7 left the tree
   byte-identical to step 6, `ℹ pass 163`). Re-apply the later steps that are still wanted with § 3's loop; if one no
   longer applies, it depended on step k: stop and ask the architect.
3. **Undo a single step alone** works for steps 2, 9, 10, 11, 12, 13 (dry-run: `git revert` applies cleanly), but the
   ratchet (step 12) then fails and names what came back (`ℹ fail` 2 to 6): that is the ratchet working. Either revert
   step 12 as well, or re-add the named entries to `tests/architecture-capabilities-allowlist.json` with a reason (a
   deliberate decision the user takes). Steps 1, 3–8 cannot be reverted alone (later steps edit the same lines): use 2.
4. **Live rollback** of a deployed batch: `git worktree add <scratch>/rb m10-base --detach`; link
   `node_modules` as a junction (`cmd //c mklink //J <scratch>\rb\steam-cartridges\node_modules C:\game\millennium\steam-cartridges\node_modules`);
   run `powershell -ExecutionPolicy Bypass -File dev.ps1` in `<scratch>/rb/steam-cartridges`; afterwards **delete the
   junction first** (`(Get-Item <scratch>/rb/steam-cartridges/node_modules -Force).Delete()` in PowerShell), then
   `git worktree remove --force <scratch>/rb` (otherwise it deletes the real `node_modules`).
5. No persisted file changes in M10, so a revert needs no data migration.

## 10. After the batch

- [TASK.md](../../TASK.md) § Now: replace the "**M10 gap batch (Ready, 2026-09-30).**" paragraph with one line:
  `**M10 gap batch: done <date>** (<live-verified | live verification pending>); the F1 plan's patches must be
  regenerated on top of M10 before F1 runs.`
- [CHANGELOG.md](../../CHANGELOG.md), new first bullet: `**steam-cartridges: M10, the layers stay dumb (ADR-0044, <date>)**: 13
  steps closed the audit's gaps (artwork fetch and backend calls out of surfaces, guardrail 8 fix, index.tsx only wires,
  one freshness owner, one shortcut lookup per side, playbar inside game-info) and added the capability ratchet. test:ts
  185/185. Plan: [steam-cartridges-m10-gap-batch-plan.md](docs/plans/steam-cartridges-m10-gap-batch-plan.md).`
- `steam-cartridges/CHANGELOG.md`: one line under the newest heading, `M10: internal cleanup (no user-visible change) —
  see the workspace CHANGELOG.`
- Commit these three files only (`git add TASK.md CHANGELOG.md steam-cartridges/CHANGELOG.md`), message
  `docs: M10 done`, push.
- **F1** ([its plan](steam-cartridges-f1-game-data-editor-plan.md)): stale after M10 (M10 edits `main.lua`, `web_rpc.lua`,
  `steam_store_rpc.lua`, `ports/backend.ts`, `tests/test_steam_store.lua`, `app/steam-store.ts`, `settings/panels/*`). An
  architect regenerates its patches on top of M10; its RPCs `SaveGameMetadata` and `SteamStoreRejectSuggestion` are in
  `tests/architecture-unwired-rpcs.json` and leave it when F1 wires or deletes them.

## 11. Dry-run record (2026-09-30)

- Built in a scratch worktree of `024de07` (steam-cartridges identical to `08b2960`, the audit's base), one commit per step,
  with `npm run check`, `npm run test:ts`, the Lua suites and `npm run build` after each.
- Replayed: a second clean worktree of `f35ed31` (`git diff --stat 024de07 f35ed31` on this plan's paths prints nothing),
  the 13 patches applied with `git apply --index` in order; § 3.1 is that replay's output. The final tree is
  byte-identical to the build tree; `npm run build` succeeded.
- Ratchet proof: `12-ratchet.patch` alone on `f35ed31` fails, naming 22 offenders, among them
  `net frontend/surfaces/artwork/artwork.ts` (the fetch the audit started from), `details frontend/surfaces/achievements/store.ts`
  (guardrail 8), the three surface webpack scans, `index.tsx`'s Steam reads and window events, and the app singletons.
- Revert proof: § 9 steps 2–3 were run on the replayed tree (every single-step revert, and the suffix revert 13..7).
- Not done: live verification (§ 8).

## 12. Known issues found while building (not fixed here, D14)

| Id | Issue | Evidence | Next |
| --- | --- | --- | --- |
| K20 | Nothing loads the controller inference at start-up (only the audit panel calls `controller.load()`), although `app/controller`'s comment says "loaded once at start-up (ADR-0038 addendum)". Until the panel is opened, emulator-inferred controller badges are missing. | `git grep -n "controller.load\|loadControllerInference" -- steam-cartridges/frontend` (before and after M10) | a one-line bugfix plan: `void controller.load()` in `init()`, with a live check of AM2R's badge |
| — | `shortcut_icon.lua`'s download fallback and `web_sgdb.download_image` stay (fail closed, tested) | § 0 | none |
| — | Remaining small duplicates: ~~`asList`, `union`~~ (moved to `kernel/lists.ts`, 2026-09-30), per-surface `deps` objects | `bash docs/plans/steam-cartridges-architecture-audit/scan.sh` D1 | later, if ever |
