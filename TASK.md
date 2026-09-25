# TASK — current status & what's next

Lean tracker: **open work only.** Everything shipped — with verification logs
and rationale — lives in [CHANGELOG.md](CHANGELOG.md) (workspace) and each
plugin's own `CHANGELOG.md`. ADRs are in [docs/decisions.md](docs/decisions.md),
Steam internals in [docs/steam-components.md](docs/steam-components.md). Don't
duplicate that detail here — link to it.

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-achievements` and `enhanced-notifications` are separate plugins that
theme Steam's toasts and sounds.

---

## Status

| Area                                      | State                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Core (`non-steam-games-activity`)         | ✅ Shipped — [README § Status](non-steam-games-activity/README.md#status)                               |
| `enhanced-achievements` `0.1.0-alpha.1`   | 🧪 Alpha — banner, sound, tiers, Phase 7 auto-captures (off by default); awaiting user testing          |
| `enhanced-notifications` `0.1.0-alpha.1`  | 🧪 Alpha — all toast types, desktop + Big Picture; awaiting user testing                                |
| Native Achievements (Phase 5)             | 🔬 Hook points verified in Steam client; not implemented                                                |
| Provider contract (Phase 9)               | ⬜ Architecture planned ([docs/millennium-architecture.md](docs/millennium-architecture.md))            |

---

## Alpha testing (user)

Only verifiable with a real game running. Steps and expected results:
[phase7-and-alpha-plan.md § User test checklist](docs/plans/phase7-and-alpha-plan.md#user-test-checklist-only-the-user-can-verify)
and each plugin's README ("How to test").

- [ ] **U1–U5:** real-unlock captures — screenshot, clip, coalescing, Steam's own
      achievement marker, non-Steam shortcut via "Test captures".
- [ ] **U6:** no captures when in-game toasts are disabled (settings warning shows).
- [ ] **U7:** in-game overlay, both plugins (desktop overlay toasts should be caught
      via `g_PopupManager`; Big Picture overlay toasts are code-verified only).
- [ ] **U8:** `enhanced-notifications` friends/messages styling with Steam's Friends
      notifications on (currently SKIP in `tests/categories.mjs`).
- [ ] **U9:** fresh install from a `dev.ps1 -Package` zip under the release name.

## Blocked upstream

- [ ] **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
      (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
      Once a fixed release ships, re-test and drop the workaround in both plugins' `settings.ts`.

---

## Roadmap

### steam-cartridges (merger + buckets + achievements)

Plan only, no code yet: [docs/steam-cartridges.md](docs/steam-cartridges.md).
ADRs [0032–0034](docs/decisions.md#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges)
written (0034 Accepted). Run phases in order; each plan lists its exit criteria.

- [x] **P0 research closure**: [plan](docs/plans/steam-cartridges-p0-research.md)
    - [x] T1 collections (`collectionStore` enumeration, ids, membership, change signal) → steam-components.md
    - [x] T2 CDN (set/clear limits unverified) artwork + `SetCustomArtworkForApp` limits, user-art detection → steam-components.md
    - [x] T3 native-app knowledge (`appStore.allApps`, `StoreItemCache` for unowned) → steam-components.md
    - [x] T4 keyless achievement schema → knowledgebase.md; flip ADR-0034 to Accepted
    - [x] T5 Lua (unverified, flat layout; P1 self-check) dotted `require`, cwd, `millennium.config` → knowledgebase.md
    - [x] T6 fixtures (read-only variant) (`SC Test Steam` / `SC Test Retro`, throwaway shortcuts; needs user OK)
    - [x] Replace every **P0-gated** note in the P1–P3 plans
- [ ] **P1 plugin merger (refactor-only)**: [plan](docs/plans/steam-cartridges-p1-merger.md)
    - [x] `git mv` core → `steam-cartridges/`; move artwork `web/*.lua`, `features/game-info`, `features/artwork`; drop duplicates
    - [x] Merged `main.lua` (8 RPC globals, no renames), `data_dir.lua`, `migrate.lua` (secrets never logged)
    - [x] One `rpc.ts`/`logger.ts`, `steam/route.ts`, `initGameInfo()` not awaited, legacy-plugin guard
    - [x] Harness `http`/`fs`/`utils` stubs + invariant tests; `dev.ps1` retires the old plugins
    - [x] Docs renamed (AGENTS, README, architecture, plugins.md, `scratch/jsx_chain.js`)
    - [ ] Live verification pending: deploy `dev.ps1`, Routines 1–3, plan §4 steps 3–8
- [ ] **P2 exclusive bucket engine**: [plan](docs/plans/steam-cartridges-p2-buckets.md)
    - [x] `features/buckets/resolve.ts` (pure) + `tests/buckets.test.ts` (two-collection fixture)
    - [x] `settings/settings.ts` (#903 workaround port), `collections.ts`, `buckets/index.ts`, `definePlugin` panel
    - [x] Gate IGDB/Game Info to web-scraping; `revertGameDetails` on leave; live re-resolve without restart
    - [ ] `tests/buckets.mjs` CDP written, not run; Routines 1–3 pending live verification
- [ ] **P3 Steam Store bucket**: [plan](docs/plans/steam-cartridges-p3-steam-store.md)
    - [x] Flat `backend/steam_store_*.lua` (normalize, store, search, appdetails, throttle, emulators, 10 RPCs) + hermetic Lua tests (`tests/test_steam_store.lua`, hand-shaped fixtures)
    - [x] `source-view.ts` dispatcher, `known-apps.ts`, `store-item.ts`, `steam-store/index.ts`, CDN art via `SetCustomArtworkForApp` (records written slots only)
    - [x] Settings panel section; `tests/steam-store.test.ts` (normalize parity); `tests/steam-store.mjs` written, not run
    - [ ] Live verification: see "Live verification pending" below

## Active Failures & Blockers

Render-error fix re-verified live 2026-09-24 (dev deploy OK, no popup/load failure). Offline: check, build, test:ts (15), Lua via lupa (NSGA_SKIP_FIXTURES=1) all pass.

- VERIFIED: desktop test_nav_cycle.js 5/6 runs all PASS; check_all_tabs.js (Big Picture) PASS on rerun; collectionStore health OK.
- FIXED OFFLINE (plan docs/plans/steam-cartridges-regression-bugfix.md): AM2R Game Info (ADR-0035) and the two test flakes. Live verification pending (plan §7).
- BLOCKED: tests/buckets.mjs and tests/steam-store.mjs throw "fixture collections/apps not found" (no SC_STEAM/SC_RETRO collections, no SC_* shortcuts). Not created (user data).
- Ad hoc Steam Store on 'Jotunnslayer: Hordes of Hel' (shortcut 2315502503, override -> steam-store): search mapping to 2820820, art slots 0-3 applied, clear removed both, settings reset; config restored to empty.
- DIAGNOSED (plan: docs/plans/steam-cartridges-regression-bugfix.md, ready for @implementer): AM2R Game Info is a real P2 regression. The bucket gate hid the local metadata DB for `none` games (ADR-0035 restores it; buckets gate only fetching). The nav-cycle and Your Stuff failures are pre-existing test timing (the store keeps 3 days on every return; the DOM reveals days one at a time), fixed by polling in the scripts.
- Attempt Count: +1

### Live verification pending (P1-P3; nothing below has run against Steam)

Deploy is a user action (`dev.ps1`). Then:

- **P1:** deploy `-dev`, legacy plugins retired; check the P1 self-check log line (`package.path`, cwd, `data_dir`); Routines 1-3 (plan section 4 steps 3-8); `migrate.run` copies `.env` / `library_metadata.json` into `<steam>/millennium/config/steam-cartridges` on real data; old-plugin RPC names still resolve.
- **P2:** `node tests/buckets.mjs`; Routines 1-3; bucket changes re-resolve live with no restart; Game Info absent for `none` games; `waitForCollections` timing at startup; a real collection reorder/conflict in the panel.
- **P3:** `node tests/steam-store.mjs` (owned, unowned, retro, clear/reject/restore); Routines 1-3 on desktop and Big Picture for `SC_STEAM_OWNED` and `SC_RETRO_A`, `test_nav_cycle.js <SC_STEAM_OWNED> 435150`, AM2R capture views unchanged.
- **P3 unverified assumptions:** `StoreItemCache` item field names in `store-item.ts` (`m_StoreCategories` shape, `GetAssets()` method names, portrait via `GetLibraryCapsuleURL_2x`); `SetCustomArtworkForApp` size limits (a failed slot is skipped and unrecorded); `ClearCustomArtworkForApp` really clears a written slot; Millennium's `json.encode` of empty tables in `steam_store.json`; `os.rename` overwrite semantics in Millennium's Lua (store removes the target first, falls back to a direct write); real `storesearch`/`appdetails` shapes against the hand-shaped fixtures (re-record with curl); the throttle busy-wait is acceptable on the backend thread; settings panel `TextField`/buttons render and refresh; desktop and Big Picture both fire `onSourceView` without a double-apply.
- **Logs:** no store request for `none` or web-scraping games; requests throttled to 1/s.

- [ ] **P4** hardening · [ ] **P5** achievements (Steam native, RetroAchievements) · [ ] **P6** optional SteamGridDB rules (plans written when P3 lands)

Phase 5 below is superseded by P5 there.

### Phase 5: Native Achievement Integration (Desktop & Big Picture)

- **Desktop Sidebar:** Re-enable `"achievements"` in `CAppDetailsSections.GetSections()` and feed `AppDetailsStore.GetAchievements(appid)` with `{ nAchieved, nTotal, vecHighlight, vecUnachieved }`.
- **Post-Game Summary:** Feed `CGamePlaySession.prototype.AddAchievement(achievement, unlockTime)` so unlocked achievements appear in the summary card strip alongside screenshots and clips.
- **Big Picture Play Bar:** Feed `appAchievementProgressCache.m_achievementProgress.mapCache` with `{ unlocked, total }` so quick stats display under the Play button.
- **Data Adapters:** Ingest schemas and unlocks from local emulator sources (RPCS3 `TROPCONF.SFM`/`TROPUSR.DAT`, RetroArch/rcheevos logs, DuckStation, PCSX2) and generic JSON.

### Phase 9: Provider Contract & Multi-Plugin Architecture

- Formalize the provider IPC contract (`retroachievements`, `steamgriddb`, `retroarch`) adhering to [ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it) and [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently).

---

## Before writing any UI

Check whether Steam already builds it — the ladder is in
[docs/plugins.md](docs/plugins.md#build-nothing-steam-already-builds). Restoring a filtered-out section beat
a from-scratch rebuild by ~1200 lines once already
([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
The inspection method (CDP harness, traps, how to verify) is in
[steam-debug.md § 3 The inspection method](docs/steam-debug.md#3-the-inspection-method).
