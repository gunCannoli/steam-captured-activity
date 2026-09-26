# Changelog

Workspace-level history: documentation, conventions, and decisions that span
plugins. Each plugin keeps its own changelog for anything user-facing —
see [steam-cartridges/CHANGELOG.md](steam-cartridges/CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repo is private and unversioned; entries are grouped by date.

## [Unreleased]

- **`steam-cartridges` ADR-0036 policy change (offline)**: shortcuts no rule claims use the Steam Store (fixed default); no Steam match falls back to web scraping; config v2 collection rules with include/exclude title patterns (v1 migrated in memory); resolutions sticky per session; settings panel updated. Plan: [docs/plans/steam-cartridges-parity.md § 4](docs/plans/steam-cartridges-parity.md#4-part-a-adr-0036-policy-change). `tsc` clean, `test:ts` 35/35. Live verification pending.

- **`steam-cartridges` P4 hardening (offline)**: metadata shape guard (fixes the `metadata.ts:231` `franchises.join` TypeError), wall-clock store throttle, offline circuit breaker with an 8 s timeout and a 5 min frontend retry, no wait on store items Steam already marked missing, per-slot art record (orphans refused, failed slots retried once, slots the user removed never rewritten), replay of racing views. Plan: [docs/plans/steam-cartridges-p4-hardening.md](docs/plans/steam-cartridges-p4-hardening.md). `tsc` clean, `test:ts` 28/28, Lua 71 + 86 PASS. Live verification pending.

- **`enhanced-achievements` 1.0.0 (2026-09-25)**: the audit's items are done (details in [its CHANGELOG § 1.0.0](enhanced-achievements/CHANGELOG.md)), plus JSONC themes (`theme.jsonc` reference, `ps5.jsonc`) and a three-row theme dropdown. The audit also found a **Millennium core bug**: FCTrampoline restores a stale `SP_JSX_FACTORY.jsx`/`jsxs` whenever a toast window renders, dropping every plugin's jsx patch for up to 5 s. That made queued banners fall back to Steam's toast when another toast arrived. The shared `steam/jsx-hook.ts` (enhanced-achievements and steam-cartridges) now heals within a microtask through a write guard ([plugins.md § Sharing the jsx runtime](docs/plugins.md#sharing-the-jsx-runtime-between-plugins), [knowledgebase.md](docs/knowledgebase.md)). enhanced-notifications and enhanced-achievements share Steam's pristine toast durations. Also found: Steam shows at most 3 desktop toasts at once ([steam-components.md](docs/steam-components.md#resolution-signatures--toast-windows)). One audit item was declined: confining theme assets to the theme folder would break the user's absolute-path theme, and assets are only ever shown locally. Verified live: queue-stress 16/16, smoke, tiers 6/6, captures 8/8 (settings preserved), bigpicture 2/2 (exit animation completes), jsx_chain 9/9, unit tests 65/65.

- **`enhanced-achievements` queue/lifetime rebuild and "Steam default" ownership (2026-09-25)**: two user-reported bugs before 1.0. (1) Queue on + rapid previews lost position and style: a hook-order violation in `Banner` threw on a queued toast's turn and fell back to Steam's unpinned toast. The render-side queue is replaced by a scheduler that owns banner lifetime and holds desktop popups through Steam's own `fnNotificationResolved`. (2) "Steam default" was restyled by enhanced-notifications because `claims()` returned false with no theme loaded. New live facts recorded in [steam-components.md](docs/steam-components.md#resolution-signatures--toast-windows): the desktop toast loop re-reads `fnNotificationResolved`/`nToastDurationMS` every frame; `ProcessNotification` calls `ChooseSound` on arrival without playing; `TestAchievement`'s source. Details: [enhanced-achievements/CHANGELOG.md](enhanced-achievements/CHANGELOG.md). Verified live: new `tests/queue-stress.mjs` 16/16, `smoke.mjs`, `tiers.mjs` (updated to the synthetic-100% design), `captures.mjs`, and `npm test` 56/56. 1.0 audit checklist in [TASK.md](TASK.md).

- **`enhanced-achievements` banner geometry fix implemented (Phases 1–4 of the plan)**: all 4 phases applied and gated offline — `tsc --noEmit` clean, `npm test` 34 → 41 PASS, `npm run build` succeeded. `applyPosition()`/`SetNotificationPosition` (global, unreliable) removed; replaced with `frontend/banner/window-pin.ts`, which pins the toast popup's own `SteamClient.Window.MoveTo` (own, writable property, verified live) in `useLayoutEffect` before Steam's first move, so it can no longer be raced or overwritten by Steam's per-frame toast-stack repositioning. New pure `frontend/banner/geometry.ts` (`bannerSize`, `placeBanner`) computes and clamps placement, unit tested (`tests/geometry.test.ts`). Content (title/desc font size, icon size) is now derived from the unscaled banner base, not the scaled box, so `scale` only resizes the box. `position` values are now snake_case (`top_right`, …) and `text-align` is `text_align`, with the old spellings still loading with a deprecation warning. Commit `ea76c26`. **Awaiting live verification** (plan § 10) — not yet deployed or tested against the running client.

- **`enhanced-achievements` banner geometry: smoke-test findings and fix plan (docs only)**: the user's alpha smoke test (2026-09-25) reported 5 bugs: `scale` scales the content, a scaled banner leaves the screen, `topright` should be `top_right`, the position flickers, and `margin` does not offset from the anchor. Only `enhanced-achievements-dev` is now deployed (the release copy was removed). Live CDP root causes:
  - Steam's desktop toast stack (rAF loop, fade-in/out `W=U=300` ms, fixed width `H=283`) calls `MoveTo(x, y, m_flDPI)` on each toast popup every animation frame, caching only its own last position.
  - EA's timer `MoveTo`s (0/100/300 ms) race it. Captured: EA and Steam both wrote at t=502 ms, so the last write wins, and the fade-out always returns the window to Steam's corner.
  - EA passes `true` where Steam passes the DPI, so its CSS-px coordinates land as physical px.
  - `applyPosition()` rewrites Steam's global `SetNotificationPosition` for every toast, and live it still read bottom-right with 0 inset.
  - A `24cqh` clamp rendered a 16.8 px title at 9.9 px, so text tracked the box height.

  The earlier "verified" positioning entries (below) came from single toasts, which cannot show the race.

  Plan: [enhanced-achievements-banner-geometry-fix.md](docs/plans/enhanced-achievements-banner-geometry-fix.md). It pins **that popup's own** `SteamClient.Window.MoveTo` (own, writable; verified) in `useLayoutEffect`, before Steam's first move. It adds pure `placeBanner`/`bannerSize` with clamping and stack slots, sizes content from the unscaled base, adds snake_case positions and `text_align` (legacy spellings warn), and deletes `applyPosition`. Phases 1–2 dry-run: `npm test` 34 → 41 PASS.

- **`steam-cartridges` parity plan, Part F controller addendum (docs only, ADR-0038 addendum)**: user decision 2026-09-25 answers § 12 Q2. Full Controller Support = Steam Store data > emulator inference (new `emulator_controllers.lua` table from the machine's RetroArch cores/info: consoles yes, DOS/ScummVM/PC-88/PC-98 no, unknown not inferred) > new setting `defaultFullController` (off, `ToggleField` row) > none; local/IGDB `full_controller` (hard-coded true) is no longer data. Found: `is_emulator` misses every RetroArch shortcut (Exe holds the full command); Step 37a fixes it via `program()`. Dry run: all 49 file steps and hashes match, `tsc` clean, `test:ts` 50/50, Lua 71 + 86 + 25, build OK. [Plan § 5b](docs/plans/steam-cartridges-parity.md#5b-parts-fh-only-true-badges-links-news-and-community-content-open-the-native-app).

- **`enhanced-achievements` theme sizing, unclipped PS5 layout, fade animation, and text alignment**:
  - *Full-Width Unclipped PS5 & Custom Layouts*: Adjusted default base dimensions for multi-zone layouts (`ps5`, `custom`, `default_system_right`) from 283×70 to 400×70 at 100% scale (also configurable via `banner.width` and `banner.height`). Eliminates headline truncation ("100% Comp" -> full "100% Complete"), prevents awkward two-line text wrapping for descriptions, and guarantees full visibility for right-pinned system icons.
  - *Reliable Entrance Fade Animation*: Removed invalid CSS syntax in `@keyframes` (`transform: none scale(...)`) that previously caused CEF to discard entrance animations. Isolated exterior pulsing outline glow to the `::before` pseudo-element so it operates smoothly without conflicting with or overriding `.ea-anim-fade`, `.ea-anim-slide`, `.ea-anim-up`, or `.ea-anim-down`.
  - *Text Alignment Support*: Added `"text-align"` setting (`"left"`, `"center"`, `"right"`) to theme settings and tier text definitions, wired into `--ea-text-align` and flex row justify alignment.
  - *Accurate Multi-Anchor Native Repositioning*: Fixed native window coordinate calculation and added scheduled post-animation `MoveTo` stabilization across all anchors (`topright`, `bottomright`, `topleft`, `bottomleft`, `topcenter`, `bottomcenter`), ensuring toasts remain 100% on-screen within display boundaries.
  - *Verification*: 34/34 unit tests passing, `tsc --noEmit` clean, deployed to live Steam, verified via CDP with live screenshots (`ps5_toast_live.png`, `ps5_exceptional_live.png`).


- **`steam-cartridges` parity plan amended with Parts F–H (docs only, ADR-0038)**: user decisions of 2026-09-25 folded in. F: a shortcut carries only categories true of the game (allow-list of Steam's player/controller ids; Achievements, Cloud, Trading Cards, Workshop, Remote Play, Steam Input API, Family Sharing never written; Q1 answered). G: header links verified per link against `urlStore`; Steam's `Navigator.App` (a no-op for unowned apps, reproduced live) sends a mapped native app to its shortcut. H: the partner event overlay (renders only for the event's own appid, verified live) gets the native appid, so native news opens on the shortcut page; Community Content loader checked on Steam's own state. Manage/Properties stay the shortcut's (built from app type). Gate grows to 17 checks (baseline 4 PASS / 13 FAIL), check 11 keys news by announcement GID, § 9 badge list corrected (Steam has no Shared/Split Screen badge). Dry-run from `HEAD` through P4 and Steps 1–46: all hashes match, `test:ts` 49/49, build OK. Traces in `docs/steam-components.md` § Links, navigation and native content.

- **`steam-cartridges` native-parity analysis, P4 and parity plans (docs only)**: live read-only capture of Jotunnslayer (shortcut 2315502503) vs native 2820820: **3 PASS / 10 FAIL** on 13 gate surfaces (Game Info from the wrong product via IGDB, no store match under the old `none` default, a missing developer, wrong dates and categories, dead links, no friends/community/news, logo never positioned, orphan art record). ADR-0036 (default Steam Store, web fallback, per-collection include/exclude) was already written; new ADR-0037: a mapped shortcut borrows its native app's own Steam sections (links, friends, community, news), the linker's scrapers stay dropped, and P5 is gated on `scratch/check_parity.mjs` 13/13. Plans: [steam-cartridges-p4-hardening.md](docs/plans/steam-cartridges-p4-hardening.md) (runs first: the `metadata.ts:231` `franchises.join` TypeError, wall-clock throttle, offline breaker and 8 s timeout, per-slot art record, view replay) and [steam-cartridges-parity.md](docs/plans/steam-cartridges-parity.md) (Part A = ADR-0036 policy change, Parts B–E = parity, gate script, adopt/adapt/drop table for `research/game-data-linker`). Both dry-run on a copy of `HEAD`: `test:ts` 19 → 28 → 35 → 42, Lua 71 + 86 PASS, builds OK. `docs/steam-cartridges.md` and TASK.md aligned; P5/P6 blocked on the gate.

- **`enhanced-achievements` native window positioning & scaling, margin semantics, and synthetic 100% completion (Platinum) banner**:
  - *Native Window Control & Scaling*: Discovered that desktop toast popups (`notificationtoasts_*_desktop`) are portal roots from `SharedJSContext`. Resolved `rootRef.current.ownerDocument.defaultView` to obtain the popup's native window and call `SteamClient.Window.ResizeTo(targetW, targetH, true)` on mount, achieving true resolution scaling (e.g. 200%×250% = 566×175) without shrinking internal content.
  - *Screen Positioning & Margin Semantics*: Discovered Steam's internal `ActiveWindowInstance.SetNotificationPosition(posEnum, marginX, marginY)` through dynamic webpack export resolution, delegating window placement and entrance slide animations directly to Steam's native notification manager. Eliminates slide-in collision and margin shrinkage (`.ea-banner` remains `inset: 0, width: 100%, height: 100%`, while `margin` acts as the screen boundary offset, verified live at `screenX: 1632, screenY: 5`).
  - *Synthetic 100% Exceptional Completion (Fake Platinum Trophy)*: Dropped `exceptional` from `icons` slots. The plugin detects when a real unlock completes all achievements for a game (`completesGame`) and synthesizes an `exceptional` toast (`EA_100_PERCENT`) 1.5s after the real unlock. Supports custom title/desc strings (`exceptional.text`), custom 100% achievement artwork (`exceptional.icons.achievement`), and the Platinum trophy badge (`exceptional.icons.rarity`).
  - *Verification*: 32/32 unit tests passing, `tsc --noEmit` clean, `millennium-ttc` prod build clean, verified live against running Steam CEF client via CDP (`scratch/verify_results.mjs`: `innerW: 566, innerH: 175, screenX: 1632, screenY: 5`, rendered "100% Complete" with custom trophy and artwork).

- **`enhanced-achievements` theme customization & PS5 layout implemented**: implemented according to [docs/plans/enhanced-achievements-theme-customization-plan.md](docs/plans/enhanced-achievements-theme-customization-plan.md). Features semantic rename from `box` to `banner` (backward compatibility preserved), 2D scaling `scale: [x, y]`, geometry controls (`margin`, `padding`, `gap` in consistent px units), exterior outline glow with pulsing fade animation, authentic PS5 blurry water-ripple animation, icon scaling 3-tuple `[source, scale_pct, ripple_speed_ms]`, the authentic PS5 trophy layout preset (`"layout": "ps5"`: achievement icon left, rarity icon anchored left of title matched to title height, description below, platform icon right), flexbox-style anchor layout engine (`"layout": "custom"`), and strict decoupling of capture settings (`screenshot`, `recording`) from themes into plugin configuration (`settings.json`). Verified offline (30/30 unit tests pass, `tsc` clean, `millennium-ttc --build prod` clean). Ready for user smoke testing.

- **`steam-cartridges` Game Info regression fixed offline (ADR-0035)**: local `library_metadata.json` Game Info applies to every shortcut that is not steam-store again (`features/game-info/policy.ts` + 4 tests); buckets gate only web/store fetching. `check_all_tabs.js` check 4 restored (it had been weakened) and Your Stuff polled; `test_nav_cycle.js` compares store day counts and polls. Live verification pending.
- **`steam-cartridges` regression diagnosis (docs only)**: AM2R Game Info went grey because P2 gated local `library_metadata.json` on the web-scraping bucket (default `none`). Captured live: config `{}`, 27 cached games unbucketed. ADR-0035 makes local Game Info capture-tier (buckets gate only fetching), and ADR-0033 is amended. The nav-cycle "1 vs 2 days" failure is pre-existing test timing, not data loss. Live sampling showed Steam's `RestoreActivity` creating the entry first, the store holding 3 days on every return, and the feed revealing days one by one (`nDaysToDisplay`). Guardrails 14 (gates never remove working behaviour) and 15 (never weaken a check; poll data signals). New `docs/plans/README.md` plan writing standard. Plan: `docs/plans/steam-cartridges-regression-bugfix.md` (dry-run: tsc clean, 19/19 tests).
- **`steam-cartridges` render-error fix**: `waitForCollections` read `collectionStore.userCollections` before `m_mapCollectionsFromStorage` existed, poisoning a keepAlive MobX computed for the session (Game Info error boundary on every app). New `buckets/ready.ts` gate; `getBucket` returns `via: 'pending'` until ready, source-view defers and replays; `check_all_tabs.js` made bucket-aware with error-boundary and health probes; guardrail 13. Live verification pending.

- **`steam-cartridges` P3 built offline** (Steam Store bucket): flat `steam_store_*.lua` backend (10 RPCs, throttle, emulator guard, in-memory appdetails cache, non-Steam-only `steam_store.json`), `features/source-view.ts` dispatcher, `steam-store/` (known-app match, `StoreItemCache` first, CDN art recording only written slots), settings section, Lua/TS tests on hand-shaped fixtures. Plan reconciled (no appdetails disk cache). Live CDP and Routines 1-3 pending; consolidated list in TASK.md.
- **`steam-cartridges` P2 built offline** (resolver + 6 unit tests, `settings.ts` (#903 port), `collections.ts`, panel, Game Info gate with `revertGameDetails`). ADR-0033 reconciled: config persists only the collection list and shortcut overrides, never native data or membership. Live CDP (`tests/buckets.mjs`) and Routines 1-3 pending; Lua tests not runnable here (no `lua`).
- **`steam-cartridges` P0 research closed** (docs and `scratch/cartridges/` probes; no plugin code). `collectionStore` and `StoreItemCache` (loads unowned apps) recorded; frontend fetch of the Steam CDN works; keyless achievement schema is store `appdetails` (ADR-0034 now Accepted). Not live-verified, to be self-checked in P1/P3: dotted Lua `require` (flat files chosen), Lua cwd, `SetCustomArtworkForApp` size limits. User-art detection is not possible, so P3 clears only slots it wrote. Fixtures are read-only (existing Jotunnslayer shortcut).

- **`steam-cartridges` P0–P3 implementation plans + ADRs 0032–0034** (docs only). Plans in `docs/plans/steam-cartridges-p{0-research,1-merger,2-buckets,3-steam-store}.md` came from an audit of the real code. No RPC collisions between the two plugins. `_lib`, `steam_paths.lua` and `jsx-hook.ts` are byte-identical; the artwork `shortcuts.lua` is a superset (it parses `tags`). The artwork plugin's `artwork.ts` is dead code. Its `config.lua` hardcodes `c:/game/millennium/.env`, and `dev.ps1` wipes the plugin folder, so data moves to `<steam>/millennium/config/steam-cartridges/`. ADR-0032 (merge; supersedes ADR-0012's "core never reaches the network" with "no bucket, no network"), ADR-0033 (exclusive buckets as one ordered collection list, resolved in the frontend), ADR-0034 (achievement sourcing; Proposed until P0 T4). The research licenses are MIT (linker, PlayniteAchievements) and GPLv3 (LocalAchievements, ideas only).
- **Planned `steam-cartridges`** (docs only): merge `non-steam-games-activity` + `steamgriddb-artwork`, exclusive Steam Store / Web Scraping buckets per collection, Steam-native + RetroAchievements achievements, optional SGDB rule-based artwork last. Linker's Epic/Xbox/news/community features dropped. See [docs/steam-cartridges.md](docs/steam-cartridges.md).
- **`enhanced-achievements` Phase 7 (auto-captures on unlock) + alpha readiness for both toast plugins.**
  Spec: [docs/plans/phase7-and-alpha-plan.md](docs/plans/phase7-and-alpha-plan.md).
  - Phase 7: an optional screenshot, clip and timeline marker on achievement
    unlock, via Steam's own Game Recording RPCs (`GameRecording.TakeScreenshot#1`
    / `SaveClip#1` / `UserAddTimelineEntry#1`, `window.g_GRS`). Scheduled from a
    timer, never from the notification hook itself (RPCs are opt-in and
    deferred — the one scoped exception to the "no per-toast RPC" guardrail).
    Off by default; the marker only applies to non-Steam shortcuts (Steam
    already marks its own games' achievements on their timeline). A dry-run
    mode and a bounded decision log back the live tests.
  - Both plugins: version `0.1.0-alpha.1`, `LICENSE` (MIT), `dev.ps1
    -Release`/`-Package` for an installable alpha, portable `tests/*.mjs`
    (resolve the deployed plugin name the same way the frontend does; no more
    machine-specific asset paths), and README "How to test" / "Known
    limitations" sections.
  - `enhanced-achievements`: new asset-free default theme (`steam_tiers.json`,
    original SVG trophy icons); the previous PS5-style example moved to
    `examples/` and the user's own working copy (with its real, machine-local
    asset paths) copied into this machine's user themes folder so it keeps working.
  - Both plugins: a settings-panel warning when Steam's own toast notifications
    are off, detected once (no polling) from Steam's client-settings store
    (`disable_all_toasts`) — resolved by signature, never a module id.
  - `enhanced-achievements/tests/settings-sound.mjs` uses the user-installed
    `steam_ps_exemple` theme for its sound checks and SKIPs (not FAILs) where
    that theme is absent. Verified: 13/13 PASS here; core `test_nav_cycle.js`
    and `check_all_tabs.js` PASS on desktop with all plugins enabled.
  - `TASK.md` trimmed to open work: the alpha user-test checklist (U1–U9), the
    Millennium#903 blocker, and Phases 5 and 9.

- **Docs housekeeping: one job per doc, no repeated content.** Each doc now opens
  with a "This doc's job" line and points elsewhere for the rest.
  - `docs/architecture.md` renamed to **`docs/millennium-architecture.md`** (it is
    about our suite, not Steam); its doc map is now a table, and its regression index
    links to the numbered guardrails instead of repeating them.
  - **`plugins.md`** owns every rule for plugin code: knowledgebase's Traps 1–10 were
    merged into the guardrails (new 10 registry memo, 11 re-render every window,
    12 popup hooks miss BrowserView popups; 1–9 keep their numbers), plus the CSS
    module / `cx()` pitfalls, frontend RPC wrapper, formatters and deploy/"Save as"
    notes. Fixed stale advice: npm (not pnpm), always a graceful restart (never
    `Ctrl+R`), `127.0.0.1:8080`.
  - **`steam-architecture.md`** is the map: topology, store table with deep-dive
    links, and the single table of stable signatures (taken from the shipped
    resolvers, which disagreed with two older doc copies). Its ladder copy was removed.
  - **`steam-components.md`** keeps only Steam internals. Gained the rendered summary
    DOM, the four-CSS-module split, the real `Pageable`/`Carousel` contract and the
    capture APIs (from knowledgebase). Lost the stale "what is left" list, its
    ladder copy, the signature table and the inspection method (→ steam-debug).
    Corrected: `clearActivity` keeps the `StoreItemCache` stub.
  - **`steam-debug.md`** gained the inspection method (search terms, test appids,
    mode switching, clean-up), the toast targets and Trap 7 (check the UI mode).
  - **`knowledgebase.md`** (1504 → 733 lines) keeps SDK, config API, CEF quirks,
    file formats, provider sources, and a new Prior art part (reference plugin,
    game-data-linker). Verification badges moved out of headings so anchors are stable.
  - Root `plugins.md` stub deleted. Broken anchors across the repo fixed; code
    comments that cited moved sections updated.

- **Docs: architecture.md (now millennium-architecture.md) is the agent doc-routing hub; steam-debug.md gets a
  cost-efficient debugging section.** Added a "Where to look (doc map)" section near
  the top of `docs/architecture.md`, organized by situation (live debugging, new
  feature/internals investigation, plugin work, styling, data formats/traps, ADRs,
  current work/history/plans) with an architect/implementer/verifier role map.
  Added `docs/plans/` as a row in AGENTS.md's doc table. Added
  `docs/steam-debug.md § 7 Cost-Efficient Debugging`: cheapest-first method ordering
  (targeted `Runtime.evaluate` → reuse `scratch/`/plugin `tests/` scripts →
  structural checks → filtered reads → clipped low-quality screenshots as last
  resort) plus anti-patterns, linked from AGENTS.md Routine 3.

- **`enhanced-notifications`: Big Picture toast window fixed (corrects the entry below).**
  The 2026-09-24 entry below said "friends/messages/downloads/recording/system toasts
  never get `data-en-type`... on **both** popup-tracking APIs" — that live check was run
  **in Big Picture**, not desktop, and was misread as a total failure. **Desktop styling
  was never broken**: `Millennium.AddWindowCreateHook` catches every desktop toast popup
  (`notificationtoasts_<id>_desktop`, one per toast via `g_PopupManager`) exactly as
  designed. The actual bug is Big Picture-only: its toast is a single persistent
  `SteamClient.BrowserView.CreatePopup` + `window.open` popup, reused for every toast,
  and it is **never registered with `g_PopupManager`** — so neither `AddWindowCreateHook`
  nor the old `GetPopups()` fallback (`scanPopups`) could ever see it. Fixed by reaching
  it from the `GamepadToastPlaceholder` div Steam renders into the Big Picture main
  window (which *is* in `g_PopupManager`): two `.return` hops up its React fiber, a hook
  holds the `BrowserViewPopup` object, `GetViewWindow()` returns the toast window.
  `style/injector.ts` gained `scanBigPictureToastWindows()`, run at the same per-toast
  cadence the old scan had — no new timers, no `window.open`/prototype patches, no
  hardcoded class hashes. Full diagnosis and evidence:
  [docs/plans/enhanced-notifications-toast-window-bugfix.md](docs/plans/enhanced-notifications-toast-window-bugfix.md).
  Verified live: `node tests/categories.mjs` PASSes downloads/recording/system/achievement
  on both desktop and Big Picture (friends/messages SKIP, gated on Steam's Friends
  notification settings), including across a Big Picture exit/re-entry (new toast window
  picked up, old one pruned via the existing `closed` check).

- **Shared jsx runtime patch verified (all 4 scenarios pass) and extended to a third plugin and two more patch sites:**
    - **`scratch/jsx_chain.js` result (2026-09-24):** all four scenarios (steady state, foreign wrapper, dropped reference, banner render) now pass, run fresh against a clean Steam restart. Previously untested code (`steam/jsx-hook.ts`, committed `6086323`) is confirmed working.
    - **`steamgriddb-artwork` migrated:** its `gamepad-appid.ts` still had the old unbounded re-patch pattern (`runtime.jsx !== patchedJsx` → re-wrap every 5s) that the other two plugins were already fixed for. With all three plugins loaded, this was quietly growing the shared chain. Migrated onto the shared `steam/jsx-hook.ts` (`keepJsxPatched`), identical copy per [docs/plugins.md § Sharing the jsx runtime between plugins](docs/plugins.md#sharing-the-jsx-runtime-between-plugins). `dev.ps1` builds with `npx` (no `pnpm`).
    - **Two more unguarded jsx patches found and fixed in `non-steam-games-activity`:** `activity-cards-patch.ts` (native Post-Game Summary cards in the Activity Feed) and `headline-patch.ts` ("{Username} captured" phrasing) each called `beforePatch` once at startup with no liveness check at all — no re-patch, no self-healing. If `runtime.jsx`/`jsxs` were ever externally reset (simulated by the drop-reference test), these two patches would be lost permanently with no error. Both migrated onto `keepJsxPatched`; `activity-cards-patch.ts` now uses `replaceType` (it replaces `args[0]`), `headline-patch.ts` uses `observe` with an in-place `Object.assign` on `props` (mutating, since `observe` can't replace `args[1]`). Both export their own `*JsxDiagnostics()`, wired into `index.tsx` and `scratch/jsx_chain.js`.
    - **Root-cause method note:** the SDK patcher's wrapper always makes `.toString()` return the *original* function's source (`patcher.ts`, `processPatch`, for webpack toString-filter compatibility). Inspecting `.toString()` down a patch chain is therefore useless for telling wrappers apart — use `__millenniumPatch` identity/links instead (`WeakMap`-tagging each function object, not string comparison), or this looks like every link in the chain is the same base function.
    - **`enhanced-notifications` category coexistence test (`tests/categories.mjs`) still fails**, unrelated to the above: friends/messages/downloads/recording/system toasts never get `data-en-type` or the theme `<style>` applied (only `achievement`, handed off to `enhanced-achievements`, passes). Traced to `style/injector.ts`: the toast window (CDP target `notificationtoasts_uid32`) is invisible to **both** `Millennium.AddWindowCreateHook` and `window.g_PopupManager.AddPopupCreatedCallback`/`GetPopups()` — confirmed live by installing a logging hook on each and triggering `previewCategory('system')`; neither ever fires or lists the toast popup. This contradicts the file's own doc comment, which assumes `AddWindowCreateHook` + a `GetPopups()` fallback together cover every toast window. Toast windows appear to be created through a path neither popup-tracking API observes. Not fixed this session — needs discovery work to find the real creation signal (or a polling workaround) before `injector.ts` can be fixed. Full repro and findings in [TASK.md](TASK.md).

- **New plugin `enhanced-notifications`** ([plan](docs/plans/enhanced-notifications-plan.md), [README](enhanced-notifications/README.md)): restyles every Steam toast type in place (Steam's icons, logos and text kept), plus sound per type (replace or mute) and display time. JSON themes with default -> category -> type inheritance.
    - **Step 0 findings:** the SDK's `EClientNotificationType` matches `eType` 1:1 (about 60 types). `StandardTemplateContainer`/`Title`/`Body` exist in **four** CSS modules with different hashes, so selectors are collected across all of them. Desktop toasts have no current-toast value; `PlayNotificationSound` is the "toast shown" signal.
    - **Design change:** the jsx-wrap approach failed (React committed an unwrapped element; cause not found), so styling is a scoped `<style>` per toast window plus a `data-en-type` body attribute, with no React interception.
    - **Bug fixed in both plugins:** sound hooks now ignore stand-in `PlayNotificationSound` calls (config discovery), which could break the other plugin's discovery depending on load order.
    - **Verified live (desktop):** styling for downloads, recording, system and achievement toasts; sound mute and replace; display time; settings round-trips; coexistence (`claims()` export added to `enhanced-achievements`). All `enhanced-achievements` suites still pass. Not verified: Big Picture, friends/messages, overlay.
- **"Save as" dialog cause confirmed:** reloading SharedJSContext (`Ctrl+R` / `location.reload()`) can load `/routes/library/home` as a download (user-observed at 12:35, matching our reload). `tests/reload.mjs` no longer reloads, and AGENTS.md now says to restart instead.

- **Upstream fix and dev-script hygiene:**
    - **PR opened:** [Millennium#904](https://github.com/SteamClientHomebrew/Millennium/pull/904) fixes [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903). `ffi_binder.cc` reads `methodName` type-safely, and the FFI recorder is wrapped so it can never fail a call it only observes. Not compiled locally; the PR says so.
    - **Graceful Steam shutdown** in `start-steam-dev.ps1` and all three `dev.ps1`: `steam.exe -shutdown`, wait for every `steamwebhelper`, force-kill only as a fallback. Previously only `steam.exe` was force-killed.
    - **"Save as" dialog investigated, not reproduced:** CEF's persisted list of in-app routes treated as downloads is replayed as "Rejected download" at every start. Ruled out: SharedJSContext reload, `steam://nav`, `Navigation.Navigate`, and Big Picture open/close/tab navigation. What to capture next time is in [`docs/knowledgebase.md`](docs/knowledgebase.md) (Deploying a plugin).

- **Millennium Configuration API bug root-caused and reported ([Millennium#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)):**
    - **Version corrected:** we run Millennium **v3.4.1** (latest, commit `18b89e1`). The `1.1.2` recorded earlier is `MILLENNIUM_FRONTEND_LIB_VERSION`, the bundled frontend library.
    - **Root cause** in v3.4.1 source (still on `main`): `src/engine/ffi_binder.cc` records FFI metrics *after* `process_message` succeeds, reading `data.value("methodName", std::string{})`. Config calls carry a numeric `methodName`, so nlohmann throws `type_error.302` and the catch replaces the successful result with the error. The issue includes a repro and a proposed patch (type-safe read; recorder wrapped in its own try).
    - **Change events:** `plugin_config::notify_change` intentionally skips the frontend for frontend-origin writes. This is by design, not part of the bug. Recorded in [`docs/knowledgebase.md`](docs/knowledgebase.md#plugin-settings--the-configuration-api).
- **`enhanced-achievements` settings panel:** the tier previews are now a "Preview a tier" section, one row per tier. Each row describes when that tier applies for the active theme (e.g. "10% or fewer players have it"), and all four were verified live. The user themes path now uses native separators. The smoke test waits for the first toast window after a Steam start.

- **`enhanced-achievements` Phase 6 built and verified live (banner, sound, settings):**
    - **Plugin scaffolded** ([`enhanced-achievements/`](enhanced-achievements/)): Lua backend (`ListThemes` / `LoadTheme` / `LoadAssets` / `OpenThemesFolder`; assets restricted to image/audio types, 8 MB max), TypeScript frontend, npm-based `dev.ps1` that also deploys `themes/`, user themes folder `<steam>/millennium/config/enhanced-achievements/themes/`. User-facing [README](enhanced-achievements/README.md) and [CHANGELOG](enhanced-achievements/CHANGELOG.md).
    - **Step 0 findings** (signatures in [`docs/steam-components.md § 11B`](docs/steam-components.md#achievement-notifications-notificationstore)): the achievement renderer is not exported but its dispatcher is, created through `react/jsx-runtime`, so the banner is an identity-compare jsx swap. `ProcessNotification` cannot be wrapped, so `display_time_ms` goes through the type config's `toastDurationMS`. The achievement `eType` is discovered via a stand-in `PlayNotificationSound` call, not hardcoded. The progress cache is only refreshed after the toast, which gives a deterministic 100% (`exceptional`) test. The desktop toast frame is a fixed 284×71, so `position` follows Steam's own setting.
    - **Millennium bug found (v3.4.1):** the Configuration API's writes persist but reject, and reads fail. See the follow-up entry above. Worked around in `settings.ts` (FFI `PluginConfig_GetAll` read, read-back after writes, own listeners) and recorded in [`docs/knowledgebase.md`](docs/knowledgebase.md#plugin-settings--the-configuration-api).
    - **Verification:** 10 logic tests (`npm test`). Live CDP suites in `enhanced-achievements/tests/`: tiers (normal/magic/rare/no-data/exceptional), sound replacement and Steam mute, `display_time_ms`, settings round-trips, fallbacks (sound off, banner off, missing theme), Big Picture banner without focus theft, non-achievement toasts unchanged.
    - **Core regression (Routines 1–2) with both plugins enabled:** added the missing `scratch/test_nav_cycle.js` (desktop A → B → A: Post-Game Summary, 8 media, 3 activity days intact) and `scratch/check_all_tabs.js` (Big Picture: Post-Game Summary, 3 "captured" cards, Your Stuff 8 items, Game Info without shortcut warning, A → B → A intact). All pass.
    - **Not yet verified:** the in-game overlay with a real unlock (same code path).

- **`enhanced-achievements` settings move to Millennium's Configuration API:**
    - **Decision:** Default settings ship inside the plugin (`settings.json`, bundled into the frontend). Users change them in the plugin's settings panel in Millennium's sidebar (`definePlugin({ content })`), and Millennium stores the values. No settings file is written at runtime, so updates never overwrite user choices, and new defaults still reach users who never changed that setting.
    - **Verified API facts** (installed Millennium + `@steambrew/client` 5.8.5), recorded in [`docs/knowledgebase.md`](docs/knowledgebase.md#plugin-settings--the-configuration-api): `pluginConfig.get/set/getAll`, `usePluginConfig`, `subscribePluginConfig`; Lua `millennium.config.get/set/on_change`; no way to declare defaults; 256 keys and 256 KB per value; the SDK build ships stubs that Millennium replaces at runtime.
    - **No theme builder:** Themes stay hand-edited JSON (one file plus assets is what users share). The panel instead offers per-tier Preview, Reload themes and Open themes folder.
    - [`docs/plans/enhanced-achievements-plan.md`](docs/plans/enhanced-achievements-plan.md) now has a Settings step with the key/control/default table (steps renumbered 0–6). `themes.md` and `TASK.md` were updated to match.

- **Phase 6 Plan Hardened Against Regression Guardrails (`enhanced-achievements`):**
    - **Guardrail-conformant execution plan:** Replaced the roadmap in [`docs/plans/enhanced-achievements-plan.md`](docs/plans/enhanced-achievements-plan.md) with a step-by-step Phase 6 plan (live re-verify → scaffold → config/themes → sound hook → banner → verification) plus a Phase 7 outline. Hook points are now resolved by signature instead of the numeric module ids (`11374`, `ht`) the draft used, which `docs/plugins.md` forbids.
    - **Scope boundaries & plugin guardrails:** The plugin may hook only `NotificationStore` and the achievement toast renderer. It must never touch `AppOverview`, `StoreItemCache`, the section registry or the activity/spotlight stores, never import from the core plugin, and never do per-toast disk, RPC or network work. Every hook falls through to Steam's original on failure. The core regression routines (1–3) must pass with both plugins enabled.
    - **Open risks surfaced:** Whether in-game overlay toasts render from `SharedJSContext`; whether 100% completion is knowable at toast time (needed for the `exceptional` tier); where user settings and themes live so updates don't overwrite them.
    - **Settings split:** [`enhanced-achievements/settings.json`](enhanced-achievements/settings.json) now holds the active theme, banner/sound toggles and capture defaults; themes hold only visuals and sound, with optional per-tier capture overrides. [`themes.md`](enhanced-achievements/themes.md) was rewritten to match, adding tier-selection order, a no-rarity-data fallback, merge semantics, icon shorthand and asset path resolution. `theme_exemple.json` now uses the canonical `"topright"`.
    - **Doc repair:** Commit `5ccf645` re-introduced stale lines next to their replacements in `docs/plugins.md`, `README.md`, `docs/architecture.md` (including two phantom table columns) and `themes.md`; these were removed.
    - **`TASK.md` pruned:** Shipped work (Phase 4b, shipped status rows) moved out; `TASK.md` now lists open phases only.

- **Documentation Streamlining & Lean `AGENTS.md` Refactor:**
    - **Consolidated Plugin Guide & Guardrails into `docs/plugins.md`:** Moved all 9 mandatory regression guardrails, failure traps, the 4-rung UI modification ladder, and plugin creation scaffolding guidelines into [`docs/plugins.md`](docs/plugins.md), keeping root [`plugins.md`](docs/plugins.md) as a direct entry pointer.
    - **Lean `AGENTS.md`:** Streamlined [`AGENTS.md`](AGENTS.md) down from 317 lines to 160 lines, focusing strictly on core non-Steam identifiers (`appid` vs composed `gameid`), environment facts, and 5 standard agent operating routines (Multi-Tab Smoke Verification, Two-Way Navigation Lifecycle, Automated CDP Suite, Build & Run, End-of-Session Prune/Sync/Auto-Push).
    - **Cross-Reference Hygiene:** Updated all workspace documentation (`README.md`, `TASK.md`, `docs/decisions.md`, `docs/architecture.md`) to point cleanly to `docs/plugins.md`.

- **Enhanced Achievements Architecture & Investigation Plan (Phase 6 & 7):**
    - **Live Steam Client Reverse-Engineering:** Used CDP probing against `SharedJSContext` (`127.0.0.1:8080`) to map the entire native notification engine (`NotificationStore` in module `60917`), sound playback interception (`PlayNotificationSound`, `ChooseSound`), and toast rendering (`function ht` in module `11374`).
    - **Sound & Banner Interception Hooks:** Confirmed that hooking `PlayNotificationSound` cleanly silences the default Steam chime (`j.PN.ToastAchievement`) and triggers custom audio playback via HTML5 `AudioContext` with per-tier volume control, while patching `ht` allows rendering themed banners with zero UI drift.
    - **Steam Game Recording & Capture RPCs Mapped:** Identified `CGameRecordingService` (module `80026`, export `xM`) RPCs: `UserAddTimelineEntry` (golden trophy timeline markers), `SaveClip` (instant replay buffer extraction), and `TakeScreenshot`.
    - **Schema & Theme Specification:** Updated [`enhanced-achievements/themes.md`](enhanced-achievements/themes.md) and [`enhanced-achievements/steam_ps_exemple.json`](enhanced-achievements/examples/steam_ps_exemple.json) to incorporate auto-screenshot delay (`screenshot.delay_ms`), auto-recording duration/delay (`recording.duration_s`, `recording.delay_ms`), and timeline markers across rarity tiers (`normal`, `magic`, `rare`, `exceptional`).
    - **Authored Comprehensive Implementation Plan:** Created [`docs/plans/enhanced-achievements-plan.md`](docs/plans/enhanced-achievements-plan.md) detailing plugin structure, hook points, theme inheritance rules, and phase-by-phase execution roadmap.

- **Lifecycle Cache Hardening & Navigation Resilience (Phase 4b Shipped):**
    - **Eliminated Cache Deletion on Unpatch:** Removed `storeCache.m_mapApps.delete(appid)` from `clearActivity` in `activity.ts`. In-memory StoreItem stubs now persist indefinitely across navigations (~150 bytes), preventing asynchronous 404 store requests from unmounting React hooks.
    - **Negative Cache Purging on Ingestion:** Explicitly delete `storeCache.m_setUnavailableApps?.delete(appid)` in `publishActivity` to purge any historical negative-cache poisoning prior to rendering.
    - **`StoreItemCache.prototype.BIsAppMissing` Shortcut Immunity Hook:** Hooked `BIsAppMissing` on `StoreItemCache.prototype` to return `false` whenever `appid >= 0x8000_0000`. This permanently immunizes non-Steam shortcuts from being treated as missing or unavailable store items.
    - **Two-Way Navigation Lifecycle Verification:** Verified two-way navigation loop (`AM2R -> Bloodstained -> AM2R`) via automated CDP test harness (`scratch/test_nav_cycle.js`), confirming `hasEvent: true` across all daily buckets. Verified all 4 core views (Post-Game Summary, Activity Feed, Your Stuff, Game Info) live in Big Picture Mode with zero regressions.

- **Regression Audit & Phase 4b Hardening Plan:**
    - **Live CDP Reproduction:** Traced the Big Picture blank Activity feed bug occurring on return navigation (`AM2R -> Bloodstained -> AM2R`), finding that the Day Headers rendered with an empty `<div></div>` body (`hasEvent: false`).
    - **Root Cause Identified (Module `82594`):** On unpatch, `clearActivity` deleted `fakeApp` from `StoreItemCache.m_mapApps`. Concurrent unmounting React hooks (`useStoreItemCache`) detected a cache miss, queued a 404 store request, and permanently poisoned `StoreItemCache.m_setUnavailableApps` (`BIsStoreItemMissing(appid) === true`), causing event renderer `dt` in module `80478` to return `null`. Deleting `m_setUnavailableApps.has(4263274102)` immediately restored all 3 days of events.
    - **Permanent Consolidation into Core Docs:** Codified all findings, permanent invariants, and diagnostic procedures permanently into `AGENTS.md` (Guardrails 1–9), `docs/knowledgebase.md` (Traps 1–9), and `docs/architecture.md` (Pre-Modification Review Index), retiring the temporary audit document.

- **Regression Prevention & Architecture Hardening (Guardrails & ADR-0031):**
    - **Guardrails in `AGENTS.md`:** Codified 4 unbreakable rules for AI agents: prototype hook coupling (`BIsModOrShortcut` vs `GetGameID`), zero expensive operations ($O(1)$ strictly enforced in hot prototype methods), single-pass Webpack module pre-caching, and multi-tab smoke test verification.
    - **Regression Prevention Index in `docs/architecture.md`:** Created a pre-modification review table mapping every feature area (Game Info, Your Stuff, Activity Feed, Post-Game Summary, Achievements & Notifications) to specific reference documents, affected files, and critical hazards/invariants to review before writing code.
    - **Critical Traps in `docs/knowledgebase.md`:** Documented Traps 1–7 covering ID coupling breakdown chains, $O(1)$ performance chokes, Webpack scan render-loop chokes, section memo in-place mutation, and multi-window Reactivity.
    - **ADR-0031 in `docs/decisions.md`:** Recorded the architectural decision to decouple `GetGameID` from `BIsModOrShortcut` on `AppOverview.prototype` and enforce constant-time $O(1)$ prototype lookups.

- **Smarter Scraper Logic & Canonical Platform Disambiguation (Side Task 4):**
    - **Launch Command & Core Ingestion:** Ingested shortcut launch targets, emulator cores (`snes9x`, `genesis_plus_gx`, `fceumm`, `duckstation`, etc.), and ROM file paths directly from `shortcuts.vdf` via backend `shortcuts.lua` and `steam_paths.lua`.
    - **Platform Clue Detection:** Mapped command lines and tags to retro platform hints (SNES, NES, Genesis, GBA, GB, N64, PS1, PSP, Arcade).
    - **Canonical Reference Scoring:** Scored IGDB candidates to favor canonical primary releases (boosting clean slugs like `chrono-trigger` and `battletoads-slash-double-dragon` while penalizing re-release variant slugs `--<num>`), matching platforms (boosting SNES Chrono Trigger `1802` from 1995 over 2018 PC port `206320`), and prioritizing top entries over brief port stubs (boosting Battletoads `7776` over `242267`).
- **Description vs Storyline Priority & Smart Sentence Truncation (Side Task 5):**
    - **Summary-Over-Storyline Priority:** Enforced strict priority of `summary` > `parent_game.summary` > `storyline` for the `description` field, preventing in-game plot/storyline walkthroughs from replacing general game overviews (verified on AM2R `4263274102`).
    - **Smart Sentence Boundary Truncation:** Implemented `truncate_smart` in `igdb.lua` cutting cleanly at sentence-ending punctuation (`.`, `!`, `?`) targeting ~400 characters with leeway, ensuring full complete thoughts without overflowing Steam's Game Info box.
- **Native Release Date Display Verification (Side Task 3):**
    - Verified live in Big Picture Mode that `overview.rt_original_release_date = meta.release_date` natively triggers Steam's `div.Release > div.Date` component, displaying `Aug 5, 2016` on AM2R and `Mar 11, 1995` on Chrono Trigger without custom UI injection.
- **Big Picture Navigation Performance & RPC Recovery (Smoke Test Fixes):**
    - **Eliminated Call-Stack Overhead in `BIsModOrShortcut`:** Replaced expensive `new Error().stack` inspection inside `AppOverview.prototype.BIsModOrShortcut` with an instantaneous $O(1)$ set lookup (`enrichedAppIds.has(this.appid)`), reducing BPM navigation freeze from 30+ seconds down to 27 milliseconds.
    - **Single-Pass Module Scan Pre-caching:** Cleaned up card component resolution in `activity-cards-patch.ts`, executing `initCardComponents()` once on plugin startup rather than iterating Webpack's module registry on every render.
    - **Dynamic RPC Bracket Access:** Replaced AST-rewritten `Millennium.callServerMethod` with `(window as any)['Millennium']['callServerMethod']`, resolving `-dev` suffix failures and restoring metadata population across all non-Steam shortcuts.
- **Activity Card Cutout & Big Picture Performance Fix (Side Task 1):**
    - **Container Selector Disambiguation:** Disambiguated CSS attribute selectors by scoping card widths to `[class*="CarouselThumb"]:not([class*="CarouselThumbs"])` and adding `NonSteamActivityCardsRow` with `width: 100% !important`, preventing parent flex rows from clipping cards down into ~80px cutouts.
- **Game Info Achievements Badge & Category Cache Fix (Side Task 2):**
    - **AM2R Achievements Category Removal:** Corrected AM2R (`4263274102`) in `library_metadata.json` so `categories.achievements` is `false`, ensuring non-achievement games do not display false achievement badges.
    - **Category Cache Invalidation:** `enrichGameDetails` now purges previously tracked `STEAM_CATEGORIES` from `overview.m_setStoreCategories` before applying new ones, preventing stale badges from persisting in memory.
    - **AppDetails Crash Prevention:** Removed synthetic assignment of `appData.details = {}` in `enrichGameDetails`, preventing native `GameStatsSection` crashes caused by missing store-only fields (`vecChildConfigApps`, `unEntitledContentApp`). All developer, publisher, franchise, and description metadata are cleanly served through `appData.associationData` and `appData.descriptionsData`.
- **Daily Activity Feed BPM Thumbnail Sizing & Headline Refinement (Phase 3b):**
    - **Big Picture Mode Thumbnail Sizing:** Injected scoped CSS into the Gamepad popup document (`[class*="CarouselThumb"]`) enforcing Steam's native 16:9 thumbnail dimensions (320×180px with `object-fit: cover`), preventing raw high-resolution (1440p/4K) captures from stretching across the entire screen.
    - **Unified Ingestion of Recordings & Screenshots:** `publishActivity` in `activity.ts` now collects both `screenshotsSince(appid, 0)` and `clipsSince(gameid, 0)` in parallel, registering clip thumbnails and screenshots together in `workshopStore` under chronological daily buckets.
    - **Action Headline Phrasing (`{Username} captured`):** Intercepted `react/jsx-runtime` (`jsx` and `jsxs`) for non-Steam events (`event.bIsNonSteam` / `event.appid >= NON_STEAM_APPID_MIN`), transforming community UGC text (`"{Username} shared X screenshots"`) into Steam's concise native gaming action convention (`"{Username} captured"`, mirroring `"{Username} achieved"`).
- **Game Info & Metadata Enrichment Provider (`library_metadata.json` + IGDB)** (Phase 8 & 8b):
    - **Single Source of Truth (`library_metadata.json`):** Consolidated, human-readable JSON database stored in Steam's root directory (`C:\game\steam\library_metadata.json`). Formatted with clean 2-space indentation so users can directly tweak titles, summaries, descriptions, credits, or categories in any text editor. Preserves manual edits via `custom_override`. Consolidated to a single canonical `description` field (Side Task 2).
    - **Twitch OAuth & IGDB v4 Backend:** Automatic client-credentials token caching and APICalypse queries (`igdb.lua`) extracting developer and publisher credits, franchises, genres, and release timestamps. Prioritizes canonical parent/main games over ports and DLCs.
    - **Native Game Modes & Category Flags:** Translates IGDB `game_modes` into Steam category badges (`m_setStoreCategories`): Single-player (2), Multi-player (1), Co-op (9), Shared/Split Screen (24), and Full Controller Support (28 with `xbox_controller_support = 2`).
    - **Native Game Modes & Category Badges:** Translates metadata into Steam's native `FeaturesList` category badges (`Single-player: 2`, `Multi-player: 1`, `Co-op: 9`, `Shared/Split Screen: 24`, `Full Controller Support: 28`, `Partial Controller Support: 18`, `Achievements: 22`, `Remote Play Together: 44`). Hooked `AppOverview.prototype.BHasStoreCategory` dynamically across the prototype chain (`ensureAppOverviewHooked`) to query our category cache, reliably rendering Steam's native SVG icons and labels on the right-hand side of Game Info.
    - **Native Big Picture "Game Info" Tab Ingestion:** Directly feeds `CAppDetailsStore.GetAppData(appid).descriptionsData` (`strSnippet`, `strFullDescription`) and `associationData` (`rgDevelopers`, `rgPublishers`, `rgFranchises`).
    - **Big Picture Filter Bypass via Targeted Prototype Interception (Phase 8b):** Discovered that Steam's inner Game Info component (`k` in module `15448`) tests `overview.BIsModOrShortcut()`; if true, it suppresses descriptions, developer/publisher credits, and release dates, rendering `#AppDetails_Shortcut_Explanation`. Solved by walking the prototype chain (`ensureAppOverviewHooked`) to hook `BIsModOrShortcut` when invoked from `k.render`, returning `false` for enriched shortcuts to cleanly unlock native `GameDescription`, `Stats`, and `FeaturesList` while leaving `GetGameID()` and 64-bit shortcut identifiers (`m_gameid`) completely unaltered.
    - **Cross-Window Reactive Update & Instant Cache:** Discovered active Big Picture Mode document via `window.g_PopupManager.GetExistingPopup("SP BPM_uid0")` to find mounted component fibers across all popup windows, triggering instant `forceUpdate()` when metadata arrives. Maintained an in-memory `libraryCache` in `index.tsx` for immediate synchronous application upon navigating to any shortcut.
    - **Verified Live in Big Picture Mode:** Verified live in Big Picture Mode on AM2R (`4263274102`), Battletoads (`3586085683`), and Chrono Trigger (`1234567890`) that Game Info cleanly renders full native description, developers, publishers, franchises, release dates, and category badges with zero shortcut explanation warnings.
- **Native Post-Game Summary Card Reuse & Video Playback Dialog (Side Task 1):**
    - BPM daily activity items now mount Steam's native `PostGameSummaryClip` and `SummaryScreenshot` component cards directly inside the BPM feed.
    - Preserved duration badges, hover states, and native click actions, launching Steam's native fullscreen video playback dialog (`OnShowPlaybackControlsDialog`) on clip click.
    - Heterogeneous aggregation groups screenshots and recordings under a single `{Username} captured` banner.
- **`docs/steam-architecture.md`** — Quick-reference directory and cheat sheet of
  Steam's core webpack modules, backing stores (`appSpotlightStore`, `appActivityStore`,
  `AppDetailsStore`, `StoreItemCache`), notification engine (`NotificationStore`),
  game recording RPCs (`CGameRecordingService`), and high-level `SteamClient` APIs.
- **`start-steam-dev.ps1`** — Root automation script to start Steam with CEF
  debugging on port 8080, query active DevTools targets, and distinguish
  `SharedJSContext` from popups.
- **`docs/steam-debug.md`** — CEF DevTools guide covering target topology, console
  filters, and Big Picture inspection traps.
- **Native Achievement & Notification Research** — Verified live on port 8080:
    - `AppDetailsStore.GetAchievements(appid)` (module `78057`) feeds the native
      desktop achievements sidebar.
    - `window.NotificationStore.OnNotification(id, NotificationType.Achievement, binaryPayload)`
      dispatches genuine native achievement toasts with full sound and animation.
    - `CGameRecordingService` (module `80026`) exposes `GameRecording.UserAddTimelineEntry#1`,
      `GameRecording.SaveClip#1`, and `GameRecording.TakeScreenshot#1` for timeline markers,
      instant highlight replays, and screenshot capture.
    - `SteamClient.Apps.SetCustomArtworkForApp` sets portrait, hero, logo, and wide capsules.
- **Reference Codebases Cloned** (`research/`):
    - `research/game-data-linker`: Ingestion patterns for Epic/Xbox links, SteamGridDB artwork, and activity feeds.
    - `research/PlayniteAchievements`: In-game monitoring architecture, rcheevos emulator log tailing, local RPCS3 trophy parsing (`TROPCONF.SFM`/`TROPUSR.DAT`), and sound customization.
- **Native Activity Feed Restored** (ADR-0030) — In-memory `StoreItem` stubbing in
  `StoreItemCache` satisfies Steam's `storeApp.BIsVisible()` event guard without network
  calls. Unlocked chronological per-day activity feed cards on both Desktop and Big Picture.
- **Big Picture React Portal Architecture** (ADR-0029) — Proved Big Picture runs
  in the same `SharedJSContext` runtime as Desktop. Portals and store feeding supersede
  DOM cloning completely.
- **Section Registry Restoration** (ADR-0022) — Restoring `"postgamesummary"` and
  `"activity"` in `CAppDetailsSections.prototype.GetSections` allowed deleting ~1200
  lines of hand-built UI.

### Fixed

- **"YOUR STUFF" Tab Media Regression & `GetGameID` Decoupling:**
    - **Root Cause:** In `steamgriddb-artwork/frontend/steam/game-info-patch.ts`, hooking `AppOverview.prototype.BIsModOrShortcut` to return `false` for enriched shortcuts caused Steam's native `GetGameID()` implementation (`return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString()`) to evaluate to `this.appid.toString()` (`"4263274102"`). Shortcut captures in `screenshots.vdf` and `window.g_GRS` are keyed by the composed 64-bit ID (`"18310622842007322624"`). Querying by `appid.toString()` returned 0 items in module `57150`, rendering the empty "you can take a screenshot" placeholder.
    - **Solution:** Hooked `GetGameID` on `AppOverview.prototype` in `ensureAppOverviewHooked` to return `this.m_gameid` whenever present. This completely decouples 64-bit shortcut identification from the `BIsModOrShortcut` flag.
    - **Section Protection:** Updated `isShortcut` in `non-steam-games-activity/frontend/steam/sections.ts` to test `overview.appid >= 0x8000_0000` alongside `BIsModOrShortcut()`, ensuring core detail sections (`postgamesummary`, `activity`) are never accidentally filtered when `BIsModOrShortcut()` is bypassed.
    - **Verified Live in Big Picture Mode:** Both "YOUR STUFF" (displaying 10 screenshots, 24 clips, duration badges, and "Manage my 8 items") and "GAME INFO" (displaying full smart summary, credits, release date, and category badges without shortcut warning) render concurrently with 100% data integrity.

### Changed

- **`docs/steam-styles.md` purged & rewritten** — Deleted 150+ lines of obsolete
  hand-measured pixel dimensions and gradients. The document now serves as a lean
  guide reinforcing the rule: clone existing native blocks from CEF DevTools or reuse
  native components; never author custom CSS to imitate Steam.
- **`AGENTS.md` updated** — Incorporated `docs/steam-architecture.md` into the
  required reading table, updated the styling agreement to forbid hand-written CSS,
  and designated `CHANGELOG.md` as the repository's historical truth.
- **`TASK.md` updated** — Expanded into a structured multi-session roadmap covering
  Core Caching (Phase 4), Native Achievements (Phase 5), Achievement Notifications
  (Phase 6), Auto-Captures & Timeline Markers (Phase 7), and Artwork/Metadata (Phase 8).
- **`non-steam-games-activity/frontend/steam/sections.ts`** — Removed stale comments
  claiming `activity` was disabled, documenting the ADR-0030 `StoreItemCache` solution.

### Removed

- Hand-built Big Picture clone (`renderers/gamepad-app.tsx`, ~280 lines) deleted.
- Hand-built Desktop summary and carousel components (~800 lines) deleted.
- Obsolete backend RPCs and timeline parsing (`timeline.lua`, `assets.lua`, ~700 lines) deleted.

---

## 2026-09-19

### Added

- **Workspace scaffolding** — `README.md`, `CHANGELOG.md`, `plugin.md`,
  `.gitignore`, and per-plugin changelogs.
- **`docs/knowledgebase.md`** — Millennium SDK mechanics, Steam's local data
  formats (`shortcuts.vdf`, `screenshots.vdf`, `gamerecordings/`), and
  RetroAchievements / RetroArch as provider sources.
- **`docs/architecture.md`** — The core/provider split, data flow, module layout,
  and provider contract.
- **`docs/decisions.md`** — Initial set of architectural decisions (ADR-0001 through ADR-0017).

### Changed

- **Restructured from a single retro-games plugin into a core plus providers**
  (ADR-0012). Probing Steam's own capture store showed the core could stand on exact
  arithmetic instead of fuzzy ROM matching.
- **First live load.** The plugin built, deployed, and ran in Steam, reporting 223
  shortcuts and 211 screenshots.
