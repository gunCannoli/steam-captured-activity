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
| `enhanced-achievements` `0.1.0-alpha.1`   | 🧪 Geometry fix deployed and live; animation/queue and glow/settings-layout fixes committed 2026-09-25, **not yet deployed** — awaiting `dev.ps1` and live smoke test. **Fix existing features before anything new.** |
| `enhanced-notifications` `0.1.0-alpha.1`  | 🧪 Alpha — all toast types, desktop + Big Picture; awaiting user testing                                |
| Native Achievements (Phase 5)             | 🔬 Hook points verified in Steam client; not implemented                                                |
| Provider contract (Phase 9)               | ⬜ Architecture planned ([docs/millennium-architecture.md](docs/millennium-architecture.md))            |

---

## enhanced-achievements: banner geometry fix (current focus)

Plan: [docs/plans/enhanced-achievements-banner-geometry-fix.md](docs/plans/enhanced-achievements-banner-geometry-fix.md).
Only `enhanced-achievements-dev` is deployed (the release copy was removed 2026-09-25).
Root causes were verified live. Steam's desktop toast stack moves each toast window every frame of fade-in and fade-out,
with its own corner and a fixed 283 px width, and EA races it with timer `MoveTo`s in the wrong units (`true` instead of a DPI).
A second path, `applyPosition()`, rewrites Steam's **global** toast position and does not hold. Text and icons are sized from the box height.

| Smoke issue | Fixed in |
| --- | --- |
| 1 `scale` scales the content, not only the box | Phase 3 (content sized from the unscaled base) |
| 2 a larger `scale` loses its anchor and goes off-screen | Phases 2–3 (`placeBanner` + clamp, per-popup pin) |
| 3 `topright` should be `top_right` (and `text-align` should be `text_align`) | Phase 1 (legacy spellings still load, with a warning) |
| 4 the position flickers between top and Steam's corner | Phase 3 (pin that popup's `MoveTo`; remove `applyPosition`) |
| 5 `margin` does not offset from the anchor | Phases 2–3 (DPI-correct `MoveTo`, margin from the corner) |

- [x] **Phase 1:** snake_case `position` values and `text_align`, with deprecation warnings; bundled themes and themes.md. Gate: `npm test` 36/36 ✅.
- [x] **Phase 2:** pure `banner/geometry.ts` (`bannerSize`, `placeBanner`) + `tests/geometry.test.ts`. Gate: `npm test` 41/41 ✅.
- [x] **Phase 3:** deleted `applyPosition`; new `banner/window-pin.ts` (per-popup `MoveTo` pin in `useLayoutEffect`, stack slots);
      content sizing without `scale`/`cqh`; banner fade-out on `--toast-duration`. Gate: `npm run check && npm test && npm run build` — all clean ✅ (commit `ea76c26`).
- [x] **Phase 4:** docs: themes.md (`scale`, `margin`, Big Picture limitation), EA CHANGELOG, steam-components.md toast-stack row ✅.
- [x] **Deployed** via `dev.ps1` 2026-09-25; only `enhanced-achievements-dev` on disk and enabled, confirmed live via CDP.
- [x] Legacy `topright`/`text-align` aliases **removed** (not deprecated) 2026-09-25 — plugin is pre-release, user said no alias needed. Both live user theme files updated to snake_case. Commit `336f3ad`.
- [ ] User manual smoke test still pending (plan § 10 P3 matrix).

## enhanced-achievements: animation, ripple and queue improvements (current focus)

Plan: [docs/plans/enhanced-achievements-animation-queue-improvements.md](docs/plans/enhanced-achievements-animation-queue-improvements.md).
5 user-reported items after the geometry fix went live. Item 4 (exceptional
custom text) was confirmed **already correct** via a live CDP probe — no code
change, just confirmation. The other 4 are planned:

| # | Request | Plan phase |
| --- | --- | --- |
| 1 | `animation: fade` only fades out, not in | Phase 1–2 (`animation.in`/`.out` independently settable) |
| 2 | New `ps5` animation: slide + fade, anchor-aware direction | Phase 1–2 (`ea-pos-*` CSS classes pick direction from `position`) |
| 3 | Ripple should start at the icon's edge and expand outward, not already-inflated | Phase 2 (`.ea-ripple` rewritten as a ring at `inset: 0`) |
| 4 | Exceptional 100% text seemed hardcoded | **Confirmed already correct**, live probe 2026-09-25 — no change |
| 5 | Multiple unlocks should queue one-at-a-time, 100ms gap, not stack | Phase 3 (`banner/queue.ts`, wired into `ThemedToast`) |

- [x] **Phase 1:** `AnimationPair` schema (`{in, out}` or bare string), `resolveAnimation`, `tests/theme.test.ts` additions. Gate: `npm test` 44/44 ✅.
- [x] **Phase 2:** CSS split `ea-in-*`/`ea-out-*` (was `ea-anim-*`+`ea-exit`), new `ps5` preset via `ea-pos-*` classes, ripple rewritten as an edge-anchored ring. Gate: `npm run check && npm test` ✅.
- [x] **Phase 3:** new pure `banner/queue.ts` + `tests/queue.test.ts`; wired into `Banner` via `requestTurn`/`releaseTurn`, released on `animationend` (`ea-out-*`) or unmount. Gate: `npm run check && npm test && npm run build`, 50/50 ✅.
- [x] **Phase 4:** docs: themes.md `animation` shape, ripple note; EA CHANGELOG; guardrail table row 10 ✅.
- [x] **Executed and committed** 2026-09-25, commit `db93e79`. `tsc --noEmit` clean, `npm test` 50/50, build succeeded.
- [ ] **Live verification** (needs `dev.ps1` deploy — user action): plan § 8 P1–P4 (animation directions incl. `ps5` at different anchors, ripple shape, rapid-fire queue behaviour incl. the synthetic exceptional toast, exceptional text re-confirm). Note: the queue is now **off by default** (see next section) — turn on "One achievement at a time" in settings before testing P3.
- [ ] Open questions: plan § 9 Q1–Q3 (default animation pair, `ps5` timings, queue overflow behaviour).

## enhanced-achievements: glow removal, capture slider, settings layout, queue toggle (current focus)

Plan: [docs/plans/enhanced-achievements-glow-queue-settings-improvements.md](docs/plans/enhanced-achievements-glow-queue-settings-improvements.md).
5 more user-reported items after the animation/queue plan landed; 2 are **out
of scope by user decision** (dropdown width/text size, button padding — no
`className`/`style` hook on those SDK components, and the panel deliberately
uses no custom CSS). Executed and committed 2026-09-25, commit `0be4cf0`.

| # | Request | Resolution |
| --- | --- | --- |
| 1 | Glow should be an outer outline pulse, not inside the banner | **Dropped** (user decision) — double-clipped by `overflow:hidden` and the exact-fit toast window; a real fix needs the geometry fix's resize math changed. `banner.glow` still parses, no visual effect. |
| 2 | `recording.duration_s` slider should start at 0, not 5 | Fixed — `CAPTURE_RANGES` |
| 3 | Wider/smaller-text theme dropdown | **Out of scope** (user decision) — no SDK style hook |
| 4 | Buttons have no horizontal padding | **Out of scope** (user decision) — no SDK style hook |
| 4b | Two-row layout: label+control on row 1, description on row 2 | Fixed — SDK's own `layout="below"` prop on every panel row, no custom CSS |
| 5 | Queue should be a checkbox, default to Steam's own behaviour | Fixed — new `queue.enabled` setting, **off by default** |

- [x] **Phase 1:** glow removed (`ea-glow`/`ea-pulse` CSS + class-list logic); `banner.glow` still parses.
- [x] **Phase 2:** `recording.duration_s` range `{min: 0, max: 60, step: 5}` (was `min: 5`).
- [x] **Phase 3:** `layout="below"` on every `Toggle`/`Slider`/`DropdownItem`/`ButtonItem` in the settings panel.
- [x] **Phase 4:** new `queue.enabled` setting (off by default), gates `requestTurn`/`releaseTurn` in `themed-toast.tsx`; `banner/queue.ts` stays pure/setting-unaware.
- [x] **Phase 5:** docs — EA CHANGELOG (Added/Changed/Removed), README (dropped "glow" from the feature list), themes.md.
- [x] **Dry-run: done** 2026-09-25 on a scratch copy — every before block matched, `tsc --noEmit` clean, `npm test` 50/50.
- [x] **Executed and committed**, commit `0be4cf0`. `tsc --noEmit` clean, `npm test` 50/50 (unchanged), build succeeded.
- [ ] **Live verification** (needs `dev.ps1` deploy — user action): plan § 8 P1–P4 (no glow on any tier, slider floor at 0, every row's two-line layout, queue toggle on/off behaviour).
- [ ] Open questions: plan § 9 Q1–Q2 (`queue.enabled` default off vs on, `duration_s: 0` edge case).

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
