# Plan: Epic and Xbox games in steam-cartridges (ADR-0056)

**Status:** ready to execute; dry-run 2026-10-02 on `547c437` (§ 11). **Base:** `547c437`. **Decision:** ADR-0056
(pasted by step 10). **Implementer:** apply nine patches, paste the text blocks of steps 10-11, run the checks, commit.
No code is written by hand. **Verifier:** the user, or an agent with the user's go-ahead (§ 10).

The code is in [steam-cartridges-store-copies/](steam-cartridges-store-copies/) as nine patches, one per step (`p1` to
`p9`). The research behind every fact is in Appendix A; the user's decisions in A.1.

## 1. What this does, and what the research found

### 1.1 The request (the user, 2026-10-02)

Support Epic Games Store and Xbox games the way IGDB and ScreenScraper are supported: automatically, nothing typed by
hand. Steam stays first for a game that is on Steam; a game that is not (Alan Wake 2) gets its store's own data, then
IGDB, then ScreenScraper, for Game Info and the Community tab. The player's unlocks on those stores are synced (no
toast: the store's own overlay notifies). A Third-party settings section, with a toggle that adds every installed Epic
and Xbox game to the library. Epic and Xbox games are not offered by enhanced-notifications' Reset Achievements. The
Activity feed shows unlocks of every source. All decisions: Appendix A.1.

### 1.2 The question "does an unlock of any source populate the game's Activity timeline?"

**No, today none does** (verified live 2026-10-02). Super Mario World (RetroAchievements, 1/149 unlocked on 2026-09-26 in
Steam's progress cache) had one activity day: "added to library". `surfaces/captures/activity.ts` publishes captures, a
mapped game's native days and the two synthetic events; nothing reads the record's unlocks. Unlocks reach only the
Post-Game Summary (`addSessionAchievement`). **After this plan every source does** (emulator saves, trophy files,
RetroAchievements, Epic, Xbox), with setting `activityShowAchievements` (default on). The live trace (Appendix A.3, § 4.8):

- Steam's achievement event is class `P` in module 12750, not exported; built only by the day class. An object on the
  shared event base (`Object.getPrototypeOf(hO.prototype)`, the exported screenshot class's parent) with P's fields
  renders as Steam's own card: "SEPTEMBER 26 · cannoliGun achieved All Exits · 100% clear the game", badge loaded.
- The open feed re-renders only when `appActivityStore.m_mapAppActivity` (MobX) is given a **new** object for the app;
  mutating the existing object or `forceUpdate` does nothing. So `captures` builds a new object on each publish and
  sets it only when the feed changed (guardrail 17.2).

### 1.3 Ruled out

- **Pasting store links into Properties** (game-data-linker): the user's decision 1; copies are found from install data.
- **A store copy inside the `identity` part:** `resolve_identity.lua` is "is this a Steam game", runs only for the
  steam-store bucket and returns early otherwise; a copy is a separate fact that also exists for web-scraping routes.
  It gets its own part (`store`) and service, read by the other services like the Steam match.
- **The unlock grouping in `domain/`:** surfaces may not import `domain/`; the captures surface already groups captures by
  local day itself, so `achievement-days.ts` lives in `surfaces/captures/` (pure, unit-tested).
- **Store art in the artwork service:** SteamGridDB already has Epic and Xbox games; the user's decisions name Game Info
  and the Community tab. Adding a third art source changes the art plan's types in five layers (follow-up, § 12).
- **Store trailers in the Community tab:** Steam's community card plays YouTube ids only (steam-components.md, "Only
  YouTube ids: no MP4"); Epic trailers are `.webm`, Xbox's HLS/DASH.
- **egdata.app for game data:** Epic's own GraphQL answers anonymously with everything used here.
- **An Epic sign-in:** a public profile answers anonymously; a private one is explained in the panel instead.
- **Reading the Epic launcher's saved session** to sign in: it is the launcher's secret, not ours.
- **Polling a store while the game runs:** ADR-0007; the store notifies; a sync on page open and at quit is enough.

## 2. The design

### 2.1 Where each piece sits (steam-cartridges.md § 2, ADR-0039/0044)

| Layer | New or changed | Job |
| --- | --- | --- |
| kernel | `record.ts` `StoreKind`, `StoreCopy`, part `store`, `MediaItem.source` + `epic`/`xbox`; `events.ts` `achievements.synced`, `store.add-requested`, `store.shortcut-added` | Shapes and events only |
| domain | `community-media.ts` | Card order: manual, trailers, **store screenshots**, ScreenScraper, IGDB |
| backend source | `store_epic_local.lua`, `store_xbox_local.lua` | Local install data (disk, registry); no network |
| backend source | `epic_graphql.lua`, `xbox_catalog.lua`, `xbox_live.lua` | The stores' APIs, through `net` (`epic`, `xbox-catalog`, `xbox-live`) |
| backend store | `store_copies_store.lua` | `store_copies.json`; never fetches |
| backend service | `store_service.lua` | The `store` part; installed games |
| backend service | `store_achievements.lua` + rows in `ach_service.lua`; `achievements_store.sync`; `fresh_policy` 15 min | Synced unlocks |
| backend service | `metadata_service.lua`, `media_service.lua` | Store tier before IGDB and ScreenScraper, only without a Steam match |
| backend RPC | `record_rpc.lua` part `store`; `store_rpc.lua` (5 RPCs) | The facade |
| ports | `backend.ts`: `FreshContext.allowEpic/allowXbox`, 5 methods | The only door |
| app | `store-copy.ts`, `store-sync.ts`; `view.ts` (store first), `achievements.ts` (synced copies), `metadata.ts`, `media.ts` | Decide and orchestrate |
| surfaces | `captures` (unlocks in the feed; new object per publish; `onSynced`); new `library-shortcuts` | The only Steam writes |
| steam | `stores.ts` `activityEventBase()` | Resolution |
| settings | `panels/third-party.tsx`, `activity.tsx` toggle, defaults | UI |
| safety | feature id `library-shortcuts` | Kill switch |
| enhanced-notifications | `surfaces/reset/{reset,index}.ts` `shortcutOffered` | Reset filter |

### 2.2 Flow of a page view

`app/view` → `store.ensure` (EnsureFresh `["store"]`: local detection, store ids once per game) → identity (steam-store
route) → metadata (store tier when no Steam match) → artwork → media (store screenshots first when no Steam match) →
achievements (`epic`/`xbox` rows first for a copy; Steam's list kept when it covers the store's ids). On quit, a copy is
synced with `force`; new unlocks go out as `achievements.synced` (Post-Game Summary, no toast). The record's unlocks of
any source become activity days in `captures`.

### 2.3 Files per step

| Step | Patch | Paths |
| --- | --- | --- |
| 1 | `p1-kernel-settings.patch` | `frontend/kernel/{record,events}.ts`, `frontend/domain/community-media.ts`, `frontend/settings/{defaults,settings}.ts`, `frontend/surfaces/community/{core,icons}.ts`, `tests/{community-core,community-media}.test.ts`, `tests/fixtures/settings-defaults.json` |
| 2 | `p2-backend-store-detection.patch` | `backend/{store_epic_local,store_xbox_local,epic_graphql,xbox_catalog,xbox_live,store_copies_store,store_service,store_rpc,iso_date}.lua` (new), `backend/{record_rpc,main,web_config}.lua`, `tests/test_store.lua` (new), `package.json`, `tests/architecture.test.ts`, `tests/architecture-unwired-rpcs.json` |
| 3 | `p3-backend-achievements.patch` | `backend/store_achievements.lua` (new), `backend/{ach_service,achievements_store,fresh_policy,record_rpc}.lua`, `tests/test_ach_service.lua` |
| 4 | `p4-backend-gameinfo-media.patch` | `backend/{metadata_service,media_service,epic_graphql,xbox_catalog}.lua`, `tests/{test_metadata_service,test_media_service}.lua` |
| 5 | `p5-frontend-use-cases.patch` | `frontend/app/store-copy.ts` (new), `frontend/app/{view,metadata,media,achievements}.ts`, `frontend/ports/backend.ts`, `frontend/index.tsx`, `tests/app-store-copy.test.ts` (new), `tests/{app-view,app-achievements}.test.ts` |
| 6 | `p6-surfaces.patch` | `frontend/surfaces/captures/achievement-days.ts` (new), `frontend/surfaces/captures/{activity,deps,index,session}.ts`, `frontend/surfaces/library-shortcuts/index.ts` (new), `frontend/app/store-sync.ts` (new), `frontend/steam/stores.ts`, `frontend/kernel/events.ts`, `frontend/ports/backend.ts`, `frontend/safety/features.ts`, `frontend/index.tsx`, `tests/{achievement-days,store-sync,library-shortcuts}.test.ts` (new), `tests/architecture-unwired-rpcs.json` |
| 7 | `p7-settings.patch` | `frontend/settings/panels/third-party.tsx` (new), `frontend/settings/{panel.tsx,panels/activity.tsx}`, `frontend/ports/backend.ts`, `tests/architecture-unwired-rpcs.json` |
| 8 | `p8-enhanced-notifications.patch` | `enhanced-notifications/frontend/surfaces/reset/{reset,index}.ts`, `enhanced-notifications/tests/reset.test.ts` |
| 9 | `p9-docs.patch` | `docs/steam-cartridges.md`, `docs/steam-cartridges/{service-store (new),service-achievements,service-metadata,service-media,surfaces,settings,rpc,kernel,safety}.md`, `docs/steam-components.md`, `docs/knowledgebase.md`, `docs/enhanced-notifications/architecture.md` |

Paths of steps 1-7 are under `steam-cartridges/` unless written in full. Step 2 lists the five new RPCs in
`architecture-unwired-rpcs.json` so every step stays green; steps 6 and 7 remove them as they are wired.

## 3. Preconditions

Run from `c:\game\millennium` in PowerShell. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git merge-base --is-ancestor 547c437 HEAD; $LASTEXITCODE` | `0` |
| P2 | `git status --short -- steam-cartridges enhanced-notifications/frontend/surfaces/reset enhanced-notifications/tests/reset.test.ts` | prints nothing |
| P3 | `Select-String -Path docs/decisions.md -Pattern '^## ADR-0056'` | prints nothing (if it prints a line, ADR-0056 is taken: stop, § 7) |
| P4 | `cd steam-cartridges; npx tsc --noEmit; $LASTEXITCODE; cd ..` | `0`, nothing else |
| P5 | `cd steam-cartridges; npm run test:ts 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 272`, `ℹ fail 0` |
| P6 | `cd steam-cartridges; $env:NSGA_STEAM_ROOT='C:/game/steam'; npm run test:lua *> $env:TEMP\lua0.txt; $LASTEXITCODE; (Select-String -Path $env:TEMP\lua0.txt -Pattern 'ALL PASS').Count; cd ..` | `0`, `10` |
| P7 | `cd enhanced-notifications; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass 164`, `ℹ fail 1` (the known bundled-asset test, TASK.md; any other failure: stop) |
| P8 | `git apply --check docs/plans/steam-cartridges-store-copies/p1-kernel-settings.patch; $LASTEXITCODE` | `0` |
| P9 | `node steam-lock.mjs status` | anything: you do not touch Steam (§ 5); this only tells you whether a live run is in progress |

If P5, P6 or P7 shows another count, stop (§ 7): something changed since the dry run.

## 4. Do-not-touch list

- Every path not listed in § 2.3, except `docs/decisions.md`, `CHANGELOG.md` and `TASK.md` (steps 10-11, text blocks).
- `steam-cartridges/tests/architecture-allowlist.json` (stays `[]`) and `tests/architecture-capabilities-allowlist.json`
  (unchanged: no capability exception is added).
- `steam-cartridges/backend/resolve_identity.lua`, `art_service.lua`, `achievements_observer.lua`, `achievements_reset.lua`.
- `enhanced-notifications/themes/**` (the user's untracked theme files) and anything another agent has uncommitted.

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`), no SharedJSContext reload, no probe or throwaway plugin,
no edit of Millennium's `config.json` or a plugin's settings, no change to the user's library, collections or shortcuts,
no `npm install` or upgrade (ignore the `@steambrew/ttc` update notice), no `git push --force`, no `--no-verify`, no
`git add -A` (other agents' work is in the tree), no edit of a patch file, no AI attribution in the commit (Routine 6).

## 6. Steps

Apply each patch from `c:\game\millennium`, then run its checks. `tsc` means
`cd steam-cartridges; npx tsc --noEmit; $LASTEXITCODE; cd ..` (expected: `0` and nothing else). `ts` means
`cd steam-cartridges; npm run test:ts 2>&1 | Select-String '^ℹ (pass|fail)'; cd ..`. `lua` means
`cd steam-cartridges; $env:NSGA_STEAM_ROOT='C:/game/steam'; npm run test:lua *> $env:TEMP\lua.txt; $LASTEXITCODE; (Select-String -Path $env:TEMP\lua.txt -Pattern 'ALL PASS').Count; (Select-String -Path $env:TEMP\lua.txt -Pattern '^  FAIL').Count; cd ..`.

| Step | Command | Expected |
| --- | --- | --- |
| 1 | `git apply docs/plans/steam-cartridges-store-copies/p1-kernel-settings.patch; $LASTEXITCODE` | `0` |
| 1 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 274`, `ℹ fail 0`; `0`, `10`, `0` |
| 2 | `git apply docs/plans/steam-cartridges-store-copies/p2-backend-store-detection.patch; $LASTEXITCODE` | `0` |
| 2 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 274`, `ℹ fail 0`; `0`, `11`, `0` |
| 2 | `cd steam-cartridges; lua tests/test_store.lua \| Select-String 'census:\|ALL PASS'; cd ..` | `census: <n> manifest file(s) in ...` (n = this PC's Epic manifests, 1 on the dry run's PC) and `ALL PASS` |
| 3 | `git apply docs/plans/steam-cartridges-store-copies/p3-backend-achievements.patch; $LASTEXITCODE` | `0` |
| 3 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 274`, `ℹ fail 0`; `0`, `11`, `0` |
| 3 | `cd steam-cartridges; lua tests/test_achievements_reset.lua \| Select-Object -Last 1; cd ..` | `30 passed, 0 failed` |
| 4 | `git apply docs/plans/steam-cartridges-store-copies/p4-backend-gameinfo-media.patch; $LASTEXITCODE` | `0` |
| 4 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 274`, `ℹ fail 0`; `0`, `11`, `0` |
| 5 | `git apply docs/plans/steam-cartridges-store-copies/p5-frontend-use-cases.patch; $LASTEXITCODE` | `0` |
| 5 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 282`, `ℹ fail 0`; `0`, `11`, `0` |
| 6 | `git apply docs/plans/steam-cartridges-store-copies/p6-surfaces.patch; $LASTEXITCODE` | `0` |
| 6 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 292`, `ℹ fail 0`; `0`, `11`, `0` |
| 7 | `git apply docs/plans/steam-cartridges-store-copies/p7-settings.patch; $LASTEXITCODE` | `0` |
| 7 | `tsc`, `ts`, `lua` | `0`; `ℹ pass 292`, `ℹ fail 0`; `0`, `11`, `0` |
| 7 | `Get-Content steam-cartridges/tests/architecture-unwired-rpcs.json` | exactly the two keys `GetDiagnostics` and `SteamStoreRejectSuggestion` |
| 7 | `cd steam-cartridges; npm run build 2>&1 \| Select-String 'build (Succeeded\|Failed)'; cd ..` | `build Succeeded ...` (a `constSysfsExpr ... never used` warning is expected). The build output is git-ignored |
| 8 | `git apply docs/plans/steam-cartridges-store-copies/p8-enhanced-notifications.patch; $LASTEXITCODE` | `0` |
| 8 | `cd enhanced-notifications; npx tsc --noEmit; $LASTEXITCODE; npm test 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `0`; `ℹ pass 165`, `ℹ fail 1` (the same known test) |
| 9 | `git apply docs/plans/steam-cartridges-store-copies/p9-docs.patch; $LASTEXITCODE` | `0` |
| 9 | `Select-String -Path docs/steam-cartridges.md -Pattern 'service-store.md'` | one line |
| 10 | Paste the ADR (§ 6.1) and the three status edits (§ 6.2) into `docs/decisions.md` | — |
| 10 | `(Select-String -Path docs/decisions.md -Pattern '^## ADR-0056').Count` | `1` |
| 11 | Paste the CHANGELOG entry (§ 6.3) and replace the TASK.md entry (§ 6.4) | — |

### 6.1 The ADR (step 10): append to the end of `docs/decisions.md`

```markdown
## ADR-0056: Epic and Xbox copies are found from the PC, filled from their store, and their unlocks are synced

**Status:** Accepted · 2026-10-02 (the user's decisions) · **Amends [ADR-0034](#adr-0034-achievement-sourcing-per-bucket-locked-only-for-unowned-steam-games)** (unlocks also come from the copy's store) · **Amends [ADR-0037](#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity)** (Epic and Xbox are no longer dropped) · replaces invariant 1 of service-achievements.md

### Context

A non-Steam shortcut is often a copy of a game bought on the Epic Games Store or on Xbox (PC Game Pass). Those stores
know the game and the player's unlocks; steam-cartridges ignored them ("Epic/Xbox stay dropped", ADR-0037, and "never
requires Epic or Xbox credentials", service-achievements.md). Research (docs/plans/steam-cartridges-store-copies-plan.md,
Appendix A) found every copy on disk (Epic manifests, Store packages with an Xbox game config), Epic's own GraphQL
answering anonymously with game data, achievement lists and a public profile's unlocks, Microsoft's catalog answering
anonymously, and Xbox Live unlocks after a device-code sign-in. Unlocks of no source reached the Activity feed.

### Decision

1. **A copy is found, never typed:** from the store's install data on this PC (`store` part, `store_service.lua`).
2. **Steam first:** a copy with a Steam match keeps Steam's Game Info, art, community content and news. Without one: the
   copy's store, then IGDB, then ScreenScraper, for Game Info and the Community tab (store screenshots; no store
   trailers: Steam's card plays YouTube only). Art stays SteamGridDB.
3. **Unlocks are synced, not observed:** sources `epic` and `xbox` come first for a copy; synced when the page opens (at
   most every 15 min) and with `force` when the game quits. No launch toast, no polling, no unlock toast: the store's
   overlay notifies; a sync's new unlocks go to the Post-Game Summary (`achievements.synced`). Steam's list is kept when
   it covers every store id.
4. **Credentials:** Epic needs none (the account id is on disk; the profile's achievements must be public, the panel
   says how). Xbox stores only the refresh token, xuid and gamertag in the data folder's `.env` through `web_config`;
   tokens and device codes are never logged. The public client ids (Microsoft's `00000000402b5328`) are constants; the
   risk that a store blocks a borrowed client is accepted, and the source then fails silently (ADR-0014).
5. **Not resettable:** an Epic or Xbox copy is not offered by Reset Achievements (`achievementsResettable`).
6. **Unlocks of every source appear in the Activity feed** as Steam's own "achieved" event, one per day.
7. **Auto-add:** per store, off by default; adds installed games without a shortcut (launcher link for Epic,
   `shell:AppsFolder` for Xbox) into a collection named after the store; never removes one. The plugin may write the
   user's library only through the `library-shortcuts` surface, and only when the user turned the toggle on.

### Consequences

- A store copy shows its store's Game Info and screenshots, and the player's store unlocks, with no setup (Epic) or one
  sign-in (Xbox). A private Epic profile shows a locked list and a note.
- Two new network services (Epic, Xbox) behind `net`'s breakers; one request per game for ids, remembered.
- Activity days now include achievements for every shortcut; the feed object is replaced on each change.
- The library can change on its own once the user turns auto-add on (new shortcuts, a new collection).
- Not verified yet: a GDK game (`MicrosoftGame.config`), the collection API, and launching through the Epic link form;
  the live checks in the plan cover them, and each fails open.
```

### 6.2 Status edits in `docs/decisions.md` (step 10)

| Find (exact) | Replace with |
| --- | --- |
| `**Status:** Accepted · 2026-09-24 · P0 trace T4 named the keyless schema source` (ADR-0034) | `**Status:** Accepted · 2026-09-24 · P0 trace T4 named the keyless schema source · **Amended by [ADR-0056](#adr-0056-epic-and-xbox-copies-are-found-from-the-pc-filled-from-their-store-and-their-unlocks-are-synced)** (an Epic or Xbox copy's unlocks come from its store)` |
| `  no Web API calls for news. Epic/Xbox stay dropped.` (ADR-0037) | `  no Web API calls for news. Epic/Xbox stay dropped (reversed by ADR-0056: copies are found and filled from their stores; friends and news stay dropped).` |
| `- Epic, Xbox and other stores' achievements are not seen by steam-cartridges, so they are neither listed nor reset.` (ADR-0054) | `- Epic, Xbox and other stores' achievements are not seen by steam-cartridges, so they are neither listed nor reset. (ADR-0056: Epic and Xbox copies are synced now, and not offered for a reset at all.)` |

Each "Find" text occurs exactly once (checked on the dry run). Check: `(Select-String -Path docs/decisions.md -Pattern
'ADR-0056').Count` prints `4` (the heading and the three edited lines). Another number: an edit did not match; compare
with the table and stop (§ 7).

### 6.3 CHANGELOG entry (step 11): add as the first entry under the format note of `CHANGELOG.md`

```markdown
- **Epic and Xbox games in steam-cartridges (ADR-0056, 2026-10-02)**: at the user's request. A shortcut that is an Epic
  Games Store or Xbox copy is found from the PC's install data (Epic manifests; Store packages with an Xbox game config),
  never typed. Without a Steam match it gets the store's Game Info and screenshots (store, then IGDB, then
  ScreenScraper); the player's unlocks are synced (Epic: the public profile, no sign-in; Xbox: device-code sign-in), on
  page open and at quit, no toast. Unlocks of every source now appear in the Activity feed (Steam's own "achieved"
  card; the feed object is replaced so an open page updates). New Third-party settings section with per-store
  auto-add (off by default). enhanced-notifications leaves store copies out of Reset Achievements. Tests: steam-cartridges
  TS 292, Lua 11 suites (new `test_store.lua`, 60 checks), enhanced-notifications 165. Live verification: see the plan § 10.
```

### 6.4 TASK.md (step 11): replace the paragraph that starts `**Epic and Xbox games (ADR-0056, 2026-10-02): plan ready` with

```markdown
**Epic and Xbox games (ADR-0056, 2026-10-02): code committed, waiting for the live verification in
[its plan § 10](docs/plans/steam-cartridges-store-copies-plan.md#10-live-verification).** Deploy steam-cartridges and
enhanced-notifications with `dev.ps1` under the Steam lock, then `npm run test:live` in both, then the by-hand checks
(Xbox sign-in, Jigsaw and Jotunnslayer pages, auto-add, Reset Achievements). When § 10 passes, delete the plan and its
patch folder.
```

## 7. Failure rule

Run a failing command at most twice. On the second failure, stop. Append the command, its output (trimmed to 30 lines)
and the step number to `TASK.md` § Active failures & blockers, then exit. Do not retry, edit a patch, edit around the
failure or skip ahead. If a patch does not apply, run `git apply --reject` **never**: stop instead (the base changed).

## 8. Guardrail checklist (plugins.md)

Tick each as "not violated", with one line of proof, after step 9.

| # | Guardrail | Proof to write |
| --- | --- | --- |
| 1 | No `BIsModOrShortcut` hook | no change to `AppOverview.prototype` in any patch |
| 2 | Hot paths O(1) | the new code runs on page view, quit, a toggle; nothing in a prototype hook or jsx handler |
| 5 | Stubs kept | `clearActivity` still keeps StoreItemCache stubs (unchanged lines) |
| 11 | Every window re-renders | the activity feed updates through the observable map (new object), verified live |
| 13 | No collectionStore computed before its source | `library-shortcuts` checks `m_mapCollectionsFromStorage` first |
| 14 | A gate never hides shown data | store tiers only fetch; a disabled store leaves the local record |
| 15 | No check weakened | `git diff 547c437 -- steam-cartridges/tests/live` is empty; no test expectation was loosened (p5 adds `store` to the view test's expected order) |
| 17 | No work from a render; idempotent writes | `publishActivity` writes the map only when the signature changed; `render` only sets sources and calls `patch` as before |
| 18 | Settings layout | Third-party uses `ToggleRow`, `ButtonRow`, `ItemRow`/`Field`, `SettingsModal`, `ActionRow`, `CredentialsNote`; no diagnostics |
| 20 | `require` every module | `lua tests/test_globals.lua` passes (part of `lua`) |

## 9. Commit instructions

```powershell
git add -- steam-cartridges/backend steam-cartridges/frontend steam-cartridges/tests steam-cartridges/package.json enhanced-notifications/frontend/surfaces/reset enhanced-notifications/tests/reset.test.ts docs/steam-cartridges.md docs/steam-cartridges docs/steam-components.md docs/knowledgebase.md docs/enhanced-notifications/architecture.md docs/decisions.md CHANGELOG.md TASK.md
git status --short
```

`git status --short` must show staged (`A`/`M` in the first column) only the 75 paths of § 2.3 plus `docs/decisions.md`,
`CHANGELOG.md`, `TASK.md`; another agent's unstaged changes may remain in the second column and are left alone. Then:

```powershell
git commit -m "feat(steam-cartridges): Epic and Xbox copies found from the PC, store Game Info and synced unlocks, achievements in the activity feed, auto-add (ADR-0056)"
git push origin main
```

No `Co-Authored-By` or "Generated with" line (AGENTS.md Routine 6).

## 10. Live verification

Done by the user, or an agent with the user's go-ahead, holding the Steam lock for the whole sequence (AGENTS.md
Routine 0). The implementer does not run it.

```powershell
node steam-lock.mjs acquire --owner sc-store-verify --purpose "steam-cartridges + enhanced-notifications: ADR-0056 deploy and verify"
$env:STEAM_LOCK_OWNER='sc-store-verify'
cd steam-cartridges; powershell -ExecutionPolicy Bypass -File dev.ps1; cd ..
cd enhanced-notifications; powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart; cd ..
node steam-health.mjs --wait 120                                # PASS  Steam UI is up and every enabled plugin loaded
cd steam-cartridges; npm run test:live; cd ..                   # the suite's own PASS lines, 13/13 as before
cd enhanced-notifications; npm run test:live; cd ..             # as before (Big Picture checks may SKIP)
```

By hand, in this order (desktop, then Big Picture for the pages):

| # | Do | Expect |
| --- | --- | --- |
| H1 | Super Mario World's page | ACTIVITY shows "SEPTEMBER 26 · <you> achieved All Exits"; the four views of Routine 1 intact; Game A ➔ B ➔ A (Routine 2) |
| H2 | Settings → Third-party | Epic: account "Found on this PC"; Xbox: Sign in; both Auto-add off, with counts (Epic 1 installed, 0 in library; Xbox 1, 0) |
| H3 | Xbox → Sign in, type the code at microsoft.com/link | "✓ Signed in as <gamertag>"; the row says Signed in |
| H4 | Turn Auto-add on for Epic, then Xbox | Jotunnslayer and Microsoft Jigsaw appear in the library, named correctly, in "Epic Games" / "Xbox" collections (if not in a collection: note it, the log says "could not put it in"; the collection API is the unverified part) |
| H5 | Play each new shortcut from Steam | Epic: the launcher starts the game (the `ns%3Aitem%3Aapp` link form is unverified: note the result). Xbox: Jigsaw starts |
| H6 | Jotunnslayer's page | Steam's Game Info (it is on Steam); achievements list = Steam's, with `ACH_FRIENDLY_JOTUNN` unlocked (Epic sync); activity has its day |
| H7 | Jigsaw's page | Game Info from the Xbox catalog ("Puzzle & trivia", Xbox Game Studios); COMMUNITY tab: Xbox screenshots with the XBOX badge; achievements 1/20 with "First Unlock" |
| H8 | Unlock one more achievement in Jigsaw, quit | No toast from Steam or enhanced-notifications; the Post-Game Summary lists it; the activity feed shows it without reopening the page |
| H9 | enhanced-notifications → Reset Achievements | Jotunnslayer and Jigsaw are not in the list; Super Mario World still is |
| H10 | `C:\game\steam\logs\webhelper_js.txt` | no `exceeded its error budget`; lines `Store copy <appid>: epic (manifest)`, `Store copy <appid>: xbox (launch-link)` |

Then `node steam-lock.mjs release --owner sc-store-verify`. Record the results in CHANGELOG.md and TASK.md.

## 11. Dry run (2026-10-02, on `547c437`)

A fresh worktree at the base, the nine patches applied in order with `git apply --check` then `git apply`, every check
of § 6 run. Recorded output: base `ℹ pass 272` and 10 Lua suites; p1 274 / 10; p2 274 / 11; p3 274 / 11
(`test_achievements_reset` 30/0); p4 274 / 11; p5 282 / 11; p6 292 / 11; p7 292 / 11 and `build Succeeded`; p8
enhanced-notifications `ℹ pass 165`, `ℹ fail 1` (the known bundled-asset test); p9 13 doc paths; `tsc` empty at every
step. 75 paths changed. `docs/enhanced-notifications/architecture.md` has another agent's uncommitted edit in the main
tree: `git apply --check --include=docs/enhanced-notifications/architecture.md p9-docs.patch` passes against it.

## 12. Open items (not in this plan)

- **Store art:** Epic `DieselStoreFrontWide`/`OfferImageTall`, Xbox `SuperHeroArt`/`Poster` as a tier behind SteamGridDB.
- **GDK games** (`MicrosoftGame.config`, games in the `.GamingRoot` folder): parsed and unit-tested, not seen live.
- **Playtime** from Xbox `userstats` (`MinutesPlayed`) and Epic's library service (signed-in only).
- **Recording a store unlock as it happens** (enhanced-notifications): Appendix A.7.
- **GOG Galaxy:** the same shape, from Galaxy's local database (service-store.md "How to add a store").

## Appendix A: decisions and research (2026-10-02)

### A.1 The user's decisions

1. **Nothing manual.** No pasting store links into Properties (game-data-linker's way). A copy is found from the
   shortcut and the store's local install data.
2. **Steam stays first** for every game on both stores: metadata, artwork and community content are still mirrored from
   the native Steam app.
3. **A game not on Steam** takes its data from its store first, then IGDB, then ScreenScraper, for **Game Info** and for
   the **Community tab** alike.
4. **Achievements are synced, not observed.** Fetched from the store's API when the page opens and when the game quits.
   No unlock toast or sound from steam-cartridges or enhanced-notifications for these games.
5. **Activity feed from every source** that knows an unlock time (stores, RetroAchievements, emulator files).
6. **A "Third-party" settings section** with an **auto-sync toggle** that adds every installed Epic and Xbox game to the
   library as a shortcut.
7. **Epic and Xbox games are not listed** in enhanced-notifications' Reset Achievements dropdown: their unlocks live on
   the store's account and cannot be reset in any form (a reset here would be undone by the next sync).
8. **Credentials stay local and safe**, like the RetroAchievements and ScreenScraper accounts today: tokens in the data
   folder through `web_config` (`<data dir>/.env`, `config.save_credentials`), never logged, never sent anywhere but the
   store's own hosts. The public client ids are constants in the code, not user data.
9. **Research first.** Before any code, find out what each store gives and how, preferring automated, sign-in-free paths
   the way IGDB and ScreenScraper work (§ 4 is round 1; Phase 0 lists what is left).
10. **Out of scope for now** (§ 9): enhanced-notifications noticing a store's unlock as it happens, to save a screenshot
    or a recording.

Answers to the round-1 questions:

1. **Epic profile privacy:** set to public. Epic needs no sign-in (§ 4.7).
2. **Auto-add:** agreed: off by default, never remove a shortcut automatically, one collection per store.
3. **Xbox test game:** Microsoft Jigsaw installed, one achievement unlocked; Jotunnslayer's shortcut removed so auto-add
   can add it back.

### A.2 What we keep from game-data-linker, and what we drop

game-data-linker (MIT, licence checked in ADR-0034), read 2026-10-02. We take **data paths only**, never its rendering.
Round 1 (§ 4) found better paths than its own for most of them.

| game-data-linker | Ours | Why |
| --- | --- | --- |
| The user pastes a store link in Properties | **Dropped.** Found from local install data (§ 4.1, § 4.4) | Decision 1 |
| Shows the linked game's data in place of the shortcut's | **Dropped.** A copy keeps its own identity | ADR-0038 |
| Epic data and achievement list from egdata.app | **Replaced** by Epic's own store GraphQL (§ 4.2). egdata.app only for trailer files | Epic's own API answers without a sign-in |
| Epic sign-in posing as the Launcher's client; used only for friends | **Pending** step 0.1: needed only if unlocks require it | Decision 4 |
| Xbox device-code sign-in, Xbox Live tokens | **Kept**: the only way to read Xbox unlocks | Decision 4 |
| Xbox achievements with unlocked state | **Kept** | Decision 4 |
| Xbox store data from Microsoft's display catalog | **Kept**, plus lookup by package family name (§ 4.5) | Decision 3 |
| Friends who play; Google News; Reddit | **Dropped** | ADR-0037 |
| SteamGridDB logo for Xbox | **Already ours** (`web_sgdb.lua`) | — |
| Injected HTML copies of Steam's panels | **Dropped.** We feed Steam's stores | ADR-0022, ADR-0045 |
| Tokens as plain JSON in the plugin's folder | **Changed**: `web_config`, data folder | Decision 8 |

### A.3 Research rounds 1 and 2: what each store gives, and how

Read-only, from this machine. Every network call was one anonymous GET or GraphQL query with a descriptive
`User-Agent`. The user's Epic account id was used once, read-only, and is not written here.

#### 4.1 Epic, on disk (no network)

| File | What it gives |
| --- | --- |
| `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON, one per installed game) | `InstallLocation`, `LaunchExecutable`, `DisplayName`, `CatalogNamespace` (= the achievement sandbox), `CatalogItemId`, `AppName`; `MainGame*` set for an add-on |
| `%ProgramData%\Epic\UnrealEngineLauncher\LauncherInstalled.dat` (JSON) | The installed list: `InstallLocation`, `NamespaceId`, `ItemId`, `ArtifactId` (= `AppName`), `AppVersion` |
| `%ProgramData%\Epic\EpicGamesLauncher\Data\Catalog\catcache.bin` (base64 of a JSON array) | Catalog items for installed or recently used namespaces only (97 items, 4 namespaces here): `title`, `description`, `developer`, `keyImages` (`DieselGameBox` 2560x1440, `DieselGameBoxTall` 1200x1600), `releaseInfo`, `categories`. Offline Game Info for an installed game |
| `%LOCALAPPDATA%\EpicGamesLauncher\Saved\Data\<32 hex>.dat` | The file name is the signed-in Epic account id (its profile resolved through GraphQL). The file content was not read |

Shortcut shapes: the one Epic shortcut here (Jotunnslayer, 2315502503) runs
`"C:\Program Files\Epic Games\JotunnslayerHordesofrI2Zp\Jotunnslayer.exe"` directly; the launcher's own shortcuts use
`com.epicgames.launcher://apps/<AppName>?action=launch&silent=true`. Both must match (exe inside an `InstallLocation`,
or the `AppName` in the link).

#### 4.2 Epic, store GraphQL without a sign-in (`POST https://store.epicgames.com/graphql`)

Answers anonymously (200). Introspection is off; field names were found by trial. `launcher.store.epicgames.com`
redirects to a captcha; `graphql.epicgames.com` is gone (404).

| Query | Gives |
| --- | --- |
| `Achievement.productAchievementsRecordBySandbox(sandboxId, locale)` | `productId`, `totalAchievements` (38), `totalProductXP`, sets, and per achievement `name` (the API name), `hidden`, `unlockedDisplayName`, `unlockedDescription`, `unlockedIconLink`, `lockedIconLink`, `XP`, `rarity.percent` |
| `Catalog.catalogOffers(namespace, locale, params)` | Every offer of a namespace with `offerType` (`BASE_GAME`, `EDITION`, `ADD_ON`): the way from an installed game to its store offer |
| `Catalog.catalogOffer(namespace, id, locale)` | `title`, `developerDisplayName`, `publisherDisplayName`, `releaseDate`, `pcReleaseDate`, `tags { name groupName }` (genres, features such as `Single Player`), `keyImages` (`DieselStoreFrontWide`, `OfferImageTall`, `Thumbnail`, 9 `featuredMedia` screenshots, 4 `heroCarouselVideo` as `com.epicgames.video://<uuid>?cover=…`) |
| `Catalog.catalogItem(namespace, id)` | `title`, `description`, `developer`, `keyImages` |
| `Catalog.searchStore(keywords, category, …)` | Title search (Alan Wake 2 → its offer); only for a game with no manifest |
| `PlayerProfile.playerProfile(epicAccountId)` | The profile resolves; `privacy` is null anonymously |
| `PlayerProfile.playerProfile.achievementsSummaries` / `productAchievements(productId)` | `ServiceError` with `status 403` ("Request failed with status code 403") for this account, anonymously |
| `PlayerAchievement.playerAchievementGameRecordsBySandbox(epicAccountId, sandboxId)` | `records: null` anonymously |

**Achievement ids match Steam's for Jotunnslayer**: Epic's `ACH_A_TROPHY_SPECIAL` is in our stored Steam schema for
native 2820820. One game is not a rule (step 0.4).

#### 4.3 Epic, egdata.app (community service, no sign-in)

`/sandboxes/<ns>/achievements`, `/items/<id>`, `/offers/<id>`, `/offers/<id>/media`, `/autocomplete?query=`. Same data as
§ 4.2, plus one thing Epic's GraphQL does not give: `/offers/<id>/media` `videos[].outputs[]` resolves trailers to
files (`media-cdn.epicgames.com/…-high.webm`, 1920x1080, `video/webm`). Use it only for that, and only if Steam's viewer
can play a direct file (step 0.6).

#### 4.4 Xbox, on disk (no network)

| File | What it gives |
| --- | --- |
| `<drive>:\.GamingRoot` | Where the Xbox app installs games: `RGBX`, a uint32 count, then NUL-terminated UTF-16 folder paths relative to the drive root. Here: `C:\` → `game\gamepass` (empty) |
| `<install folder>\<Game>\Content\MicrosoftGame.config` | Expected for GDK games: `<TitleId>`, `<StoreId>`, `<Identity Name=…>`, executables. **Not verified**: no Xbox game is installed here |
| `Get-AppxPackage` (or the registry) | Installed packages with `PackageFamilyName` and `InstallLocation`; 0 GDK game packages here |

The Xbox app and Gaming Services are installed. Shortcut shapes to check on a real install (step 0.2):
`shell:AppsFolder\<PackageFamilyName>!<AppId>`, `explorer.exe shell:AppsFolder\…`, an exe under the GamingRoot folder.

#### 4.5 Xbox, Microsoft's display catalog without a sign-in (`https://displaycatalog.mp.microsoft.com/v7.0/`)

| Call | Gives |
| --- | --- |
| `products/lookup?alternateId=PackageFamilyName&value=<PFN>&market=US&languages=en-US,neutral&fieldsTemplate=details` | The product id (`Microsoft.SeaofThieves_8wekyb3d8bbwe` → `9P2N57MC619K`): from an installed package to its store entry |
| `products/lookup?alternateId=XboxTitleId&value=<id>…` | 200; from `MicrosoftGame.config`'s `TitleId` to the product |
| `products?bigIds=<id>…` | `ProductTitle`, `DeveloperName`, `PublisherName`, `OriginalReleaseDate`, `AlternateIds` (`XboxTitleId` 1717113201), images by purpose (7 `Screenshot`, `SuperHeroArt`, `TitledHeroArt`, `Poster`, `BoxArt`, `Logo`, `BrandedKeyArt`), `Properties.Category`, `Properties.Attributes` (`SinglePlayer`, `XblOnlineCoop`, `XblOnlineMultiPlayer`, `XblCrossPlatformCoop`, `XblAchievements`, `ConsoleKeyboardMouse` …, which map to Steam categories), `CMSVideos` (trailers as HLS and DASH streams with a caption and size), packages with their `PackageFamilyName` |

#### 4.6 Signed-in APIs (round 1: from public sources and game-data-linker's code; Xbox rows verified in § 4.7)

| Store | Call | Gives |
| --- | --- | --- |
| Xbox | `achievements.xboxlive.com/users/xuid(<xuid>)/achievements?titleId=<id>` (contract 2) | Each achievement with `progressState`, `progression.timeUnlocked`, Gamerscore, rarity, icon. game-data-linker uses it |
| Xbox | `titlehub.xboxlive.com/users/xuid(<xuid>)/titles/titlehistory/decoration/achievement,image,detail` | Every played title with unlocked and total counts and last played time, in one call: lets a sync skip unchanged games |
| Xbox | `userstats.xboxlive.com` `MinutesPlayed` | Playtime per title (a possible later feature) |
| Xbox | Sign-in: device code at `login.live.com/oauth20_connect.srf` (client `00000000402b5328`, scope `service::user.auth.xboxlive.com::MBI_SSL`), then `user.auth.xboxlive.com` and `xsts.auth.xboxlive.com` | A user code shown in our settings, typed at microsoft.com/link: no password ever passes through the plugin |
| Epic | The same GraphQL queries with the user's bearer token | Unknown: whether that turns the 403 / `records: null` above into unlocks (step 0.1) |
| Epic | `library-service.live.use1a.on.epicgames.com/library/api/public/items`, `…/playtime/account/<id>/all` | Owned games and playtime (Legendary / Heroic use them) |

#### 4.7 Round 2: verified with the user's accounts (2026-10-02)

The user set their Epic profile's achievements to public, installed Microsoft Jigsaw (Xbox), unlocked one achievement in
each store, and removed Jotunnslayer's shortcut from Steam (to test auto-add later). Neither game is a shortcut now.

**Epic unlocks need no sign-in once the profile is public** (anonymous `store.epicgames.com/graphql`, account id from
§ 4.1):

| Query | Answer |
| --- | --- |
| `PlayerProfile.playerProfile(epicAccountId).achievementsSummaries` (fragment `PlayerAchievementResponseSuccess`) | `status 200`, one entry per game with unlocks: `sandboxId`, `totalUnlocked` (1), `totalXP` (10). One call for every game: a sync asks per game only when this changed |
| `PlayerProfile.playerProfile(epicAccountId).productAchievements(productId)` (fragment `PlayerProductAchievementsResponseSuccess`) | `playerAchievements[].playerAchievement { achievementName: "ACH_FRIENDLY_JOTUNN", unlocked: true, unlockDate: "2026-10-02T17:44:53.533Z" }` |
| `PlayerAchievement.playerAchievementGameRecordsBySandbox` | Still `records: null`: not the query to use |
| A private profile | `ServiceError { status 403, message }` (round 1): the source answers `needs-setup` ("set your Epic profile's achievements to public"); no Epic sign-in is built |

`productId` comes from `productAchievementsRecordBySandbox` (§ 4.2). `ACH_FRIENDLY_JOTUNN` is also a Steam id of native
2820820 (the overlay rule of step 0.4 holds for this game).

**Xbox, a UWP game, detected locally** (Microsoft Jigsaw, `Get-AppxPackage`, `SignatureKind: Store`):

- `<InstallLocation>\xboxservices.config` (JSON): `TitleId` 2003863742 (decimal), `PrimaryServiceConfigId`. A GDK game
  has `MicrosoftGame.config` instead (§ 4.4, still unverified: Jigsaw is not GDK). Either file means "an Xbox Live game".
- `AppxManifest.xml`: `Application Id="App"`, `Executable="Jigsaw.exe"`, `DisplayName`; launch with
  `shell:AppsFolder\Microsoft.MicrosoftJigsaw_8wekyb3d8bbwe!App`.
- Catalog lookup by package family name → product `9WZDNCRFJ9X2`, `ProductKind: Game` (tells a game from an app),
  `XboxTitleId` 2003863742 (equals the local `TitleId`), 9 screenshots, 6 hero, 4 logo, 2 trailers. It is installed in
  `WindowsApps`, not in the `.GamingRoot` folder: the package list, not the folder, is the source of truth.

**Xbox signed-in calls, verified** (device code typed by the user at microsoft.com/link; client `00000000402b5328`;
`RpsTicket` with no prefix worked; the Microsoft token lasts 24 h and comes with a refresh token; XSTS lasts about 16 h):

| Call | Answer |
| --- | --- |
| `achievements.xboxlive.com/users/xuid(<xuid>)/achievements?titleId=2003863742&maxItems=1000` (contract 2) | 200, 20 achievements: `id`, `name`, `description`, `lockedDescription`, `isSecret`, `progressState`, `progression.timeUnlocked`, `rewards` (Gamerscore), `mediaAssets` (icon), `rarity` (absent for this title). Unlocked: id 2 "First Unlock", 20 G, `2026-10-02T17:54:21.767Z` |
| `titlehub.xboxlive.com/…/titlehistory/decoration/achievement,image,detail` (contract 2) | 200, 46 titles played on the account (installed or not, PC and console): `titleId`, `name`, `type`, `devices`, `pfn`, `achievement { currentAchievements, currentGamerscore, totalGamerscore, progressPercentage }` (`totalAchievements` is 0 for newer titles: use the gamerscore), `titleHistory.lastTimePlayed`. One call for every game: a sync asks per game only when this changed |
| `userstats.xboxlive.com/batch` `MinutesPlayed` | 200, `value: "6"` for Jigsaw: playtime is available |

The probe kept tokens in memory only (a scratchpad script; results saved without tokens).

#### 4.8 Round 3: live checks for the implementation (2026-10-02, Steam lock held)

- **Activity feed today:** Super Mario World (2713503983, RetroAchievements 1/149, unlocked 1790471689) had one day
  (type 3, added to library); no unlock of any source becomes an activity event (`publishActivity` reads captures,
  native days and synthetic events only).
- **Steam's achievement event:** class `P` in module 12750 (`m_rgAchievements`, `m_rtOldestAchievement`,
  `AddAchievement(a, rtUnlocked)`, `get achievements()`, constructor `(rtTime, steamIDActor, gameid)` calling
  `InitFromUserNewsEvent(2, gameid, rtTime, actor)`); not exported (a scan of every module for `AddAchievement` found no
  export); created only by the day class's `AddAchievementEvent`. A live native event's achievement entry:
  `{ strName, strDescription, strImage, flAchieved, strID, rtUnlocked, bAchieved }`.
- **Our event renders:** built on `Object.getPrototypeOf(hO.prototype)` with P's fields, it showed "SEPTEMBER 26 ·
  cannoliGun achieved All Exits · 100% clear the game" with the badge image (64x64) loaded.
- **Re-render:** `forceUpdate` on the activity section's class components and mutating the day map did not refresh the
  open feed; setting a new activity object into `appActivityStore.m_mapAppActivity` (a MobX map, prototype `e`) did,
  within 2 s. All probe changes were removed and the feed rebuilt afterwards.
- **`SteamClient.Apps.AddShortcut`:** a URL as the exe answers `{ result: 2, message: '' }` and adds nothing. With the
  launcher exe it resolves to the appid (3235712508) and writes `shortcuts.vdf` at once; the name argument is ignored
  (named "EpicGamesLauncher"), the launch options argument too (stored empty); `SetShortcutName` and
  `SetShortcutLaunchOptions` fix both and keep the appid. Exe and start dir are stored as given. The test shortcut was
  removed (no Jotunnslayer entry remains, so auto-add can be tested on it).
- **Registry:** `HKCR\com.epicgames.launcher\shell\open\command` = `"C:\Program Files\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe" %1`;
  `HKLM\SOFTWARE\Epic Games\EpicGamesLauncher` `AppDataPath`. Store packages: 361 in 0.19 s by `reg query`.
- **Image CDNs:** Epic `?w=640&resize=1` → 640x360 (37 KB from 120 KB); Xbox `?w=640` → 75 KB from 277 KB.
- **Epic GraphQL fields** used by the code all answer (`description` plain, `longDescription` HTML); feature tags on
  Rocket League, It Takes Two, Fall Guys: `Single Player`, `Multiplayer`, `Co-op`, `Controller Support`,
  `Competitive`, `Cross Platform`.
- **Trailers:** not usable in Steam's community card (YouTube ids only, steam-components.md).

### A.7 Future considerations (not scheduled)

- **Recording a store unlock as it happens** (enhanced-notifications). A sync learns of an unlock too late to capture the
  moment. To research later, passive only (no injection into games):
  - Xbox: Game Bar's unlock toast may go through Windows' notification platform; a `UserNotificationListener` reader
    could see it and ask Steam for a screenshot at once.
  - Epic: its overlay draws inside the game, not through Windows; a game's EOS log lines, if any, or a short sync loop
    while it runs (only if the API's limits allow; ADR-0007 forbids it today).
  - The capture goes into Steam's own screenshots for the shortcut, so the captures pipeline shows it. No toast.
- **Playtime** from Xbox `userstats` and Epic's library service.
- **GOG Galaxy** fits the same shape (identity and unlocks from Galaxy's local database, no network).
