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
| `enhanced-achievements` `0.1.0-alpha.1`   | 🧪 Geometry, animation/queue, glow/settings-layout, settings-panel-cleanup, Steam-default-theme and settings-spacing/toasts-off-warning fixes all committed and deployed 2026-09-25; awaiting user's live smoke test. |
| `enhanced-notifications` `0.1.0-alpha.1`  | 🧪 Alpha — all toast types, desktop + Big Picture; awaiting user testing                                |
| Native Achievements (Phase 5)             | 🔬 Hook points verified in Steam client; not implemented                                                |
| Provider contract (Phase 9)               | ⬜ Architecture planned ([docs/millennium-architecture.md](docs/millennium-architecture.md))            |

---

## enhanced-achievements: recent fixes, all deployed (user smoke test pending)

Four rounds of user-reported fixes, each fully executed, gated, and deployed.
Full detail (root causes, before/after, phase gates) lives in each plan and in
[enhanced-achievements/CHANGELOG.md](enhanced-achievements/CHANGELOG.md); this
is just the index.

1. **Banner geometry fix** — [plan](docs/plans/enhanced-achievements-banner-geometry-fix.md), commit `ea76c26`. Per-popup `MoveTo` pin (was racing Steam's own toast-stack repositioning), DPI-correct margin, content sized from the unscaled box, snake_case `position`/`text_align` (legacy aliases removed outright, not deprecated — pre-release).
2. **Animation in/out split, `ps5` preset, edge-anchored ripple, one-at-a-time queue** — [plan](docs/plans/enhanced-achievements-animation-queue-improvements.md), commit `db93e79`. `animation.in`/`.out` independently settable; new pure `banner/queue.ts`.
3. **Glow removal, capture slider floor, two-row settings layout, queue toggle** — [plan](docs/plans/enhanced-achievements-glow-queue-settings-improvements.md), commit `0be4cf0`. Glow dropped (double-clipped by `overflow:hidden` + the exact-fit toast window — `banner.glow` still parses, no visual effect); `recording.duration_s` now starts at 0; every row uses SDK `layout="below"`; new `queue.enabled` toggle (off by default).
4. **Settings panel cleanup** — commit `c55a783`. `banner.enabled`/`sound.enabled` removed (banner theming always on with a loaded theme; sound theming follows whether the theme defines a clip per tier); renamed labels/sections (Achievement queue, Preview Achievements, Screenshots & Recordings); every row grouped under a `DialogControlsSectionHeader`; dropped the toast-disabled disclaimer, the "(yours)" theme suffix, and the "Test captures" button; tier preview labels/rules now theme-driven instead of hardcoding bronze/silver/gold.
5. **"Steam default" as the shipped default theme** — commit `bac1703`. `theme: ""` (was `"steam_tiers"`) means no theme loaded, Steam's own stock toast and chime; the settings panel's Theme dropdown lists it as the first option. Answers the user's question about theme modularity: a theme file's fields were already independently optional (set only `sound`, only `icons`, etc.), but keeping Steam's *own* native banner rendering specifically requires selecting "Steam default" — any theme file always replaces the banner with ours.
6. **Consistent row spacing, dropped capture status line, reactive toasts-off warning** — commit `664afc3`. Every row now passes `bottomSeparator="none"` except the last in its group (fixes group headers sitting flush against the row above, and groups looking unevenly spaced); removed the "No game is being recorded" status line; the settings panel now reactively warns and disables itself when Steam's own toasts are globally off (polled every 2s while mounted, cheap — replaces the earlier static disclaimer). Item 4 ("force achievements even with Steam toasts off") was investigated and declined: `ProcessNotification` returns early in that state and calls nothing this plugin hooks — no event exists to react to (same conclusion as the prior plan's Q5).

- [ ] **User's live smoke test** across all six rounds — not yet run.
- [ ] Open questions (not blocking, defaults already applied): default animation pair, `ps5` timings, queue overflow behaviour (plan 2 § 9); `queue.enabled` default off vs on, `duration_s: 0` edge case (plan 3 § 9).

## Alpha testing (user)

Only verifiable with a real game running. Steps and expected results:
[phase7-and-alpha-plan.md § User test checklist](docs/plans/phase7-and-alpha-plan.md#user-test-checklist-only-the-user-can-verify)
and each plugin's README ("How to test").

- [ ] **U1–U5:** real-unlock captures — screenshot, clip, coalescing, Steam's own
      achievement marker, non-Steam shortcut (via a real unlock; the settings
      panel's "Test captures" button was removed 2026-09-25, see `fireTestUnlock`
      in `tests/captures.mjs` for the equivalent CDP-driven check).
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

Parent plan: [docs/steam-cartridges.md](docs/steam-cartridges.md). P1–P3 are
implemented offline; their live verification is pending (below). ADRs
[0032–0037](docs/decisions.md#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges).
Run phases in order; each plan lists its exit criteria.

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

- VERIFIED live 2026-09-24 (regression fix 907f59c, desktop, dev deploy OK, no popup/load failure): offline check, build, test:ts (19), Lua via lupa pass; test_nav_cycle.js 5/5 all PASS; check_all_tabs.js 3/3 all PASS (AM2R Game Info renders, bucket none, no grey warning, A->B->A intact); no new "Fetching Game Info" log lines (last 20:03, before deploy).
- NOT RUN (fixtures absent, not approved): tests/buckets.mjs, tests/steam-store.mjs. Big Picture check and plan sec 7 step 3 (GetAppData snippet) not run.
- NON-BLOCKING WARNING: webhelper_js.txt "Could not enrich native Game Info for 4263274102: TypeError: (meta.franchises || []).join is not a function" (metadata.ts:231 debug log line; franchises not an array). Old (1173 hits since 11:09), pre-existing; data still applied. Fix planned: P4 H1.
- Attempt Count: +1

### Live verification pending (P1-P3; nothing below has run against Steam)

Deploy is a user action (`dev.ps1`). Then:

- **P1:** deploy `-dev`, legacy plugins retired; check the P1 self-check log line (`package.path`, cwd, `data_dir`); Routines 1-3 (plan section 4 steps 3-8); `migrate.run` copies `.env` / `library_metadata.json` into `<steam>/millennium/config/steam-cartridges` on real data; old-plugin RPC names still resolve.
- **P2:** `node tests/buckets.mjs`; Routines 1-3; bucket changes re-resolve live with no restart; Game Info absent for `none` games; `waitForCollections` timing at startup; a real collection reorder/conflict in the panel.
- **P3:** `node tests/steam-store.mjs` (owned, unowned, retro, clear/reject/restore); Routines 1-3 on desktop and Big Picture for `SC_STEAM_OWNED` and `SC_RETRO_A`, `test_nav_cycle.js <SC_STEAM_OWNED> 435150`, AM2R capture views unchanged.
- **P3 unverified assumptions:** `StoreItemCache` item field names in `store-item.ts` (`m_StoreCategories` shape, `GetAssets()` method names, portrait via `GetLibraryCapsuleURL_2x`); `SetCustomArtworkForApp` size limits (a failed slot is skipped and unrecorded); `ClearCustomArtworkForApp` really clears a written slot; Millennium's `json.encode` of empty tables in `steam_store.json`; `os.rename` overwrite semantics in Millennium's Lua (store removes the target first, falls back to a direct write); real `storesearch`/`appdetails` shapes against the hand-shaped fixtures (re-record with curl); the throttle busy-wait is acceptable on the backend thread; settings panel `TextField`/buttons render and refresh; desktop and Big Picture both fire `onSourceView` without a double-apply.
- **Logs:** no store request for `none` or web-scraping games; requests throttled to 1/s.

### Next, in this order (user decisions A and B, 2026-09-24)

- [ ] **1. P4 hardening**: [plan](docs/plans/steam-cartridges-p4-hardening.md) (goes first: the other two are cut on top of it)
    - [ ] H1 metadata shape guard (the `metadata.ts:231` TypeError) · H2 wall-clock throttle · H3 offline breaker, 8 s timeout, 5 min retry · H4 skip missing store items · H5 per-slot art record, no orphans · H6 replay racing views
    - [ ] Offline gates: `tsc`, `test:ts` 28/28, Lua 71 + 86 PASS
    - [ ] Live verification (plan § 7)
- [ ] **2. ADR-0036 policy change** (no collection → Steam Store, web fallback, per-collection include/exclude): [parity plan Part A](docs/plans/steam-cartridges-parity.md#4-part-a-adr-0036-policy-change)
    - [ ] Config v2 rules and title patterns, fixed default `steam-store`, sticky resolutions
    - [ ] Store first, web fallback on no match; settings panel
    - [ ] Offline gates: `tsc`, `test:ts` 35/35
- [ ] **3. Native parity, Jotunnslayer vs 2820820**: [parity plan Parts B–E](docs/plans/steam-cartridges-parity.md#5-parts-be-close-the-parity-gaps), then [Parts F–H](docs/plans/steam-cartridges-parity.md#5b-parts-fh-only-true-badges-links-news-and-community-content-open-the-native-app) (user decisions 2026-09-25, [ADR-0038](docs/decisions.md#adr-0038-a-mapped-shortcut-shows-only-what-is-true-of-its-copy-its-links-news-and-community-content-open-the-native-app))
    - [ ] B Game Info fields · C Links / Friends / Community sections · D native news in the activity feed · E logo position
    - [ ] `scratch/check_parity.mjs` · offline gates: `tsc`, `test:ts` 42/42
    - [ ] F badge policy · G header links and `Navigator.App` redirect · H news click-through, Community Content from the native app
    - [ ] Offline gates: `tsc`, `test:ts` 50/50, Lua 71 + 86 + 25
      (Part F now includes the controller addendum, Steps 37a–37i: Steam data > emulator inference > "Default to full controller support" setting, off > no badge; live check § 9 item 5b)
    - [ ] **Parity gate: `node scratch/check_parity.mjs` prints `17 PASS / 0 FAIL`** (baseline 2026-09-25: 4 PASS / 13 FAIL), plus plan § 9 items 1–7
    - [ ] Open questions for the user: plan § 12 Q2–Q4 (Full Controller default for local data, Manage/Properties, tags/languages/ratings)
- [ ] ⛔ **P5** achievements (Steam native, RetroAchievements): **blocked on the parity gate** (user decision B)
- [ ] ⛔ **P6** optional SteamGridDB rules: blocked on P5

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
