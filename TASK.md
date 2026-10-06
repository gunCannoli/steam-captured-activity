# TASK — current status & what's next

Lean tracker: **what we're doing and what's next, nothing else.** Shipped
work (with verification logs and rationale) lives in
[CHANGELOG.md](CHANGELOG.md) (workspace) and each plugin's own
`CHANGELOG.md`. Detailed root cause, ordered steps and execution records
live in per-feature plans under [docs/plans/](docs/plans/) — link to them,
don't duplicate them here. ADRs are in [docs/decisions.md](docs/decisions.md).

**Goal:** a non-Steam game's app detail page looks like a native one, on both
desktop and Big Picture, by restoring Steam's own sections and feeding Steam's
own stores — not by rebuilding the page ([ADR-0022](docs/decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).
`enhanced-notifications` themes Steam's toasts and sounds, achievements included (enhanced-achievements merged into it, ADR-0050).

---

## Now

**steam-cartridges data flow audit (2026-10-06, [plan](docs/plans/steam-cartridges-dataflow-improvements-plan.md)): audit done, nothing implemented.**
Achievements show late because the view enqueues them last (after metadata, artwork and media's first call) in one FIFO call queue
with no priority, in front of a Lua host that serves one call at a time; ingest, the 60 s store-sync tick and the 2 s observer
(`setInterval`, piles up) share that queue; failed or empty achievements re-resolve on every request; the RA MD5 cache is memory only.
Next: Phase 0 (per-call timing + live probe, needs the Steam lock), then priority lanes (Phase 1) and paint-from-disk (Phase 2), each
written as a mechanical plan first; needs ADR-0060.

**steam-cartridges controller inference restoration & background RetroAchievements ingestion (2026-10-06): deployed and verified live.**
Fixed regression where emulator shortcuts lacked controller support badges and showed "Unknown controller" in Library Analytics (root cause: `createController` never called `controller.load()` at start-up). Added `controller.load()` at start-up, hooked `onLoaded` to `metadata.rebadge()`, and expanded backend emulator lists to 24 standalone emulators (`snes9x`, `mgba`, `vbam`, `ares`, `project64`, etc.) with command-line ROM extension inspection. Live CDP probe confirmed 218/228 shortcuts populated with `xbox_support: 2` and category `28`. Fixed missing RetroAchievements across library by extending `app/ingest.ts` with `needsFetch` to ingest existing shortcuts lacking metadata or achievements schemas sequentially in the background (300 ms pacing). Added per-game "Fetch" and batch "Fetch All" in Review modal. Live verification confirmed 218 shortcuts populated in `achievements.json`.

**steam-cartridges RA global unlock % and Library Analytics controller support (2026-10-05): deployed and verified live.**
Fixed Metroid Fusion *Explosive Chamber* unlock rate (from 4% points fallback to true 92.47%) and refreshed schemas in `achievements.json`. Resolved false "Unknown controller" issues for Steam-mirrored shortcuts (*Jotunnslayer: Hordes of Hel*) and Epic/Xbox store copies in Library Analytics. Mapped and store copies now accurately count toward `Metadata Match` and satisfy controller support. Deployed and verified live via CDP.

**steam-cartridges Library Analytics & Review achievement controls (2026-10-05): deployed and verified live.**
Added `Achievements Match - ##` stat below `Metadata Match`. Extended "Issues detected" count and Review modal with filter options (`All Issues`, `Missing Achievements`, `Missing Controller`, `Not Scraped`) and per-game actions: RetroAchievements URL/ID link, Steam App ID link, "Mark No Achievements" dismiss, and "Reset Achievement Source". Wired through `SetAchievementSource` and `ClearAchievementSource` RPCs with live progress cache updates. Verified via CDP and all 315 unit tests.

**steam-cartridges performance & stability optimization (ADR-0059, 2026-10-06, [plan](docs/plans/steam-cartridges-performance-and-stability-optimization-plan.md)): deployed and verified live.**
Permanently fixed the recurring `EXCEPTION_ACCESS_VIOLATION (0xC0000005)` in `millennium.luavm64.exe` (`+0x1087C`, `movdqu [r15], xmm0`). Minidump disassembly and assembly tracing proved that LuaJIT's C parser (`lj_cparse.c`, `cp_decl_spec`) uses callee-saved register `R15` for storage class flags (`0x38000`, `0x20000`, `0x8000`, `0`). Any error during C parsing (struct redeclarations in dynamic `pcall(ffi.cdef)` or undeclared types in `pcall(ffi.typeof)`) caused LuaJIT's `lj_err_throw` to longjmp directly back to Lua, skipping `lj_cparse`'s epilogue (`mov r15, [rsp + 0x9e0]`) and clobbering `R15`. When Millennium's C++ RPC handler `evaluate` (`0x14000e8a0`) finished, `movdqu [r15], xmm0` dereferenced `0x38000` or `0`, crashing C++. Resolved permanently by: 1) eliminating all dynamic/repetitive `ffi.cdef` and `ffi.typeof` calls, 2) wrapping all FFI type declarations with idempotent, non-throwing boolean guards (`_G.__RA_KEYCHAIN_CDEF_LOADED`, `_G.__WININET_CDEF_LOADED`, `_G.__SILENT_EXEC_CDEF_LOADED`), and 3) caching decrypted RetroArch keychain credentials and config in memory. Live verified on Steam via CDP: *Kirby* (70 achievements), *Lufia II* (67 achievements), *Dragon Ball Z: The Legacy of Goku* (39 achievements), and *The Lion King* (33 achievements) all passed sequentially in a single pass with 0 errors, 0 crashes, and passing two-way navigation lifecycle tests (`check_all_tabs.js`). Next: persistent ROM MD5 caching and EnsureFresh roundtrip batching.

**enhanced-notifications notifications queue (ADR-0055, 2026-10-02): deployed; one open issue.** Works live (one
toast at a time, Steam's `displayToastAlone`; the stack stall it caused is fixed by refreshing Steam's fullscreen
query when the stack empties, `steam/toast-stack.ts`). **Open: toasts sometimes vanish in the full live suite**, one
check per run and a different one each time (run 4 `notifications-queue`: 0 of 3 test toasts entered Steam's queue;
run 5 `achievements-queue`: 1 of 5 banners), never when the same test runs alone (passed 6 times alone, and twice with
a wrapper on `ClearAllToastNotifications` that saw no clear). Not seen before the queue; not proven caused by it.
Suspects: Steam's `ClearAllToastNotifications` when its fullscreen check answers true (our refresh asks it more
often), or `ProcessNotification` returning early. Next: keep the `entered` diagnostic in `notifications-queue.mjs`,
add the clear counter to the suite, run it with the queue off to see whether the drop exists without it. Left for the
user: use the queue for a while and say if a notification ever goes missing; look at the ps5 toasts (padding fix,
`"gap": [10, 2]`).

**Epic and Xbox games in steam-cartridges: where we are, what is missing, what is next (2026-10-03).** Full state, findings and decisions:
[the handoff](docs/plans/steam-cartridges-store-games-handoff.md); evidence and timings: [the unlock research](docs/plans/steam-cartridges-store-unlock-detection-research.md);
the open investigation: [the launch-tracking plan](docs/plans/steam-cartridges-store-launch-tracking-plan.md).

*Done and deployed (live-checked by the agent):* ADR-0056 store copies (Epic and Xbox found from the PC, store Game Info and screenshots, synced unlocks, unlocks in the
Activity feed, Third-party settings, auto-add, Reset filter; `test:live` 13/13); auto-add of games installed while Steam runs (60 s tick; the install list is read afresh;
Epic downloads in progress are skipped; Xbox games without a game config are found by their `xboxliveapp-` protocol: Sudoku; a new shortcut waits for Steam's collections);
the Xbox sign-in popup (clickable link, click-to-copy code). *Proven in the probe only* (`unlock_watcher.mjs --steam`, nothing of it is in the plugin): an unlock becomes Steam's
native achievement toast, **Xbox 1.0 s** (Windows' push log carries the full achievement) and **Epic 4.3 s** (overlay-renderer trigger plus the API); enhanced-notifications takes it
for a real unlock. *Verified by the user:* a dash-prefixed Epic launch link with the launcher closed first makes Steam track the game under the shortcut and shows the Steam overlay.
*Deployed 2026-10-03:* new Epic shortcuts carry the dash.

*Missing, in order of importance:*
1. **Launch tracking (plan § 7-8).** *Epic: shipped 2026-10-03 (ADR-0057), the "Epic Steam Overlay Workaround" setting (Third-party, off by
   default; on on this PC for testing).* Pressing Play on an Epic launcher-link shortcut closes an open launcher first (Steam's launch waits about 1 s), so
   Steam starts the launcher and its overlay reaches the game; after the game and Epic's cloud sync the launcher is ended and the entry stops running.
   Live (E9, the real Jotunnslayer shortcut, Steam's own Play button): launcher closed at Play, overlay attached to the game, entry ended 10 s after the
   game; a non-Epic shortcut is never held. BURIED STARS was converted back to the launcher with the dashed link (appid kept). Left: Big Picture's Play (same
   code path, not run live), a desktop-shortcut launch (not held: the reaper still ends the launcher), Steam's Stop during play. *Xbox UWP: shipped
   2026-10-04 (ADR-0058, U0)*: Minesweeper, Sudoku and Ultimate Word Games run their own exe (converted, appids kept), so Steam shows them running with
   playtime and a timeline for the whole session (live: Minesweeper 18 s, ended 2 s after the game); after an app update the plugin repoints the
   shortcut within a minute (live: a simulated update repaired in 37 s, no duplicate). No overlay for Xbox games (no route; plan § 7). Left: a real Store
   update; Sudoku and Word Games launched from Steam (same mechanism, only Minesweeper run live); Fortress Merge (GDK) stays on Explorer, no running
   state (U1, a compiled wrapper, was not built); SISR for controller layouts: a later option. Verified facts and measurements: the plan § 2 and § 7.
2. **Captures under the working Epic route:** the in-tree game has a running timeline, Steam's in-game toast window and a recording that starts (plan § 7, E1 and
   the E6 control); still to do: a real unlock with `unlock_watcher.mjs --steam`, with the user's recording mode on (it is **Manual** on this PC, so captures skip
   with `recording-not-active` until a recording runs).
3. **The unlock feature is not in the plugin.** To build (needs a plan, an ADR superseding ADR-0056 decision 3 "no toast", and tests): a push-log reader in the Lua backend
   (nothing on a timer while no store game runs: start on `shortcut.launched`, stop on `quit`), an Epic trigger, a `store-unlock` sensor, the `toasts` surface posting through
   `NotificationStore.OnNotification` (the existing launch toast calls it wrongly: see the Wuchang entry below), per-store settings, Xbox lite and full modes.
4. **Auto-add policy (decide, then plan):** a deleted shortcut (today forgotten each restart and re-added at the next; options A persistent added-list, B restore controls in Settings,
   C re-add every check (rejected), D keep; recommended A and B); shortcuts added by hand or before the plugin (title fallback, re-check before adding, never edit an existing shortcut,
   first enable asks first, a collection button, Steam-owned games); a re-added game gets a new appid (loses its playtime). Details: the two auto-add entries under Considerations.
5. **Small open decisions:** Epic overlay mute (`--mute-epic-overlay` works only in an elevated shell, untested on the real files: manual step or a button); a registered Microsoft app
   instead of the borrowed "Minecraft Launcher" client id; Epic's API burst at 0.5 s instead of 1.5 s.
6. **Live checks still open:** a real install while Steam runs gets its shortcut within a minute (Epic and Xbox, a download in progress is not added); Xbox with the Xbox app closed, Game Bar off,
   a console unlock (must not toast); a second Epic sample (does the toast GIF and the `cef.log` line recur); two unlocks in one second; a game with no shortcut (logged, no toast); the user's by-hand
   list from ADR-0056: H5 (play the new shortcuts), H8 (an unlock shows in the Post-Game Summary and feed, no duplicate), H9 (Reset Achievements lists neither store), a Big Picture look at the pages and the Third-party panel.

*Next, in order:* (1) re-run item 2 (captures on a real Epic unlock, now that the game runs in Steam's tree); (2) the user decides the
auto-add policy (item 4) and handoff D1-D5; (3) plans and ADRs for the unlock feature (item 3) and the auto-add policy; (4) build, test (unit, Lua,
live), Routines 1 to 3 of AGENTS.md.

**Reset Achievements reaches emulator and trophy files (ADR-0054, 2026-10-02): deployed, live-checked read-only.**
Left: (1) the user: open Reset Achievements for WUCHANG and look at the popup (warning, "Also reset local achievements
(RUNE)" toggle, popup size) on desktop and in Big Picture; Super Mario World's popup with "Open RetroAchievements to
reset manually" on (the game page opens in the browser after the reset); a real reset with the toggle on, then launch the game and
confirm nothing comes back (the backup is `achievements.ini.bak-<date>` next to the file). (2) **RPCS3 and shadPS4,
untested on real files** (none on this machine): with a game that has trophies, check the source is listed with the
right count, reset with the toggle on, and confirm the emulator shows the trophies locked and still loads the file
(RPCS3: `TROPUSR.DAT`, entries 0x70 bytes; shadPS4: `<home>/<user>/trophy/<npcommid>.xml`; shadNet may sync back).
The readers changed too (`ps3_trophies.parse_tropusr`, `ps4_trophies.find_save_files`): check detected unlocks match.

**steam-cartridges "Achievements Enabled" launch toast never shows (found 2026-10-02, the user's Wuchang report): not
fixed, needs a decision.** `surfaces/toasts/launch.ts` calls `NotificationStore.ProcessNotification(notif)` with one
argument; Steam's is `ProcessNotification(config, notification, kind)` and returns before showing anything (module
60917; server notifications go through `OnServerNotification`, batched 3 s, gated by the user's per-type toast
preference). Options: post it through `OnNotification` with a client type that takes a title and body, or drop it.

**enhanced-notifications settings tweaks (ADR-0053, 2026-10-02): deployed, `test:live` passes (Big Picture check skipped).** Left for
the user: a look at the panel (Steam default first, Select Notification card, Achievements Preview showing only with
the ps5 theme) on desktop and in Big Picture.

**enhanced-notifications simpler theme format (ADR-0052, 2026-10-02): code, themes and docs done, not live-verified.**
Unit tests pass except the bundled-asset check: `themes/ps5.jsonc` points at `PlayStation/*.svg` (the folder holds
`.png`), and the user's untracked `ps5.json` / `SteamStation.json` at a missing `ps5_assets/`; the user fixes the paths.
Then deploy with `dev.ps1`, `npm run test:live` (`achievements-bigpicture.mjs` changed: the banner now uses the theme's
corner), and look at the ps5 theme's toasts and Preview on desktop and in Big Picture (`text_align`, `game_icon`).
Follow-up: make Steam's own toasts honour `popup.scale` and `popup.layout` (banner only today); needs a live probe of
the per-toast popup's size (`ResizeTo`, `STEAM_TOAST_WIDTH` in `theme/placement.ts`) and of Steam's toast DOM.

**steam-cartridges settings panel tidy-up (2026-10-02): done, layout measured live.** Left for the user: a look at the
panel and its popups (Add service / source, Emulator status, Add Rule, Review) on desktop and in Big Picture. Open:
ScreenScraper's developer account comes from `screenscraper_dev_*` in a `.env` (this machine's workspace `.env`); a
published build needs it shipped with the plugin (decide how).

**steam-cartridges community tab (2026-10-01): crash fixed, downloads kept on disk (ADR-0051).** Both live-verified by the
agent (Chrono Trigger after a restart: images 479 ms, was 11-23 s; `test:live` 13/13). Left for the user: plan § 7 of
[the investigation](docs/plans/steam-cartridges-community-crash-and-speed-investigation.md) (Chrono Trigger three times, then
after a restart), and a look at the "Cache downloaded media" slider in Settings → Community Content (desktop and Big Picture).
When both pass, delete the investigation plan. Do not re-introduce parallel backend calls (no gain: the host serves one
request at a time).

**enhanced-achievements merged into enhanced-notifications (ADR-0050, 2026-10-01): code committed, waiting for the live
verification in [its plan § 9](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-achievements-merge-plan.md)** (the user: disable
enhanced-achievements, move the ps5 theme and settings, deploy, `npm run test:live`, the by-hand checks). It supersedes
the live steps of the architecture-port and Big Picture fix plans that use enhanced-achievements as a separate plugin;
their by-hand checks are folded into § 9. The three plans are deleted (2026-10-03, implemented; still readable at `9a7df2b`). Entries
below that name enhanced-achievements now mean enhanced-notifications' achievement banner; "Force achievement position
in Big Picture" no longer exists.

**enhanced-notifications sibling port (ADR-0047): code committed (2026-09-30), waiting for the live verification in
[its plan § 9](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-architecture-port-plan.md).** Deploy both toast plugins with `dev.ps1`, then
`npm run test:live` in both, then the by-hand checks.

**Big Picture toasts (2026-10-01): flicker fixed and "Force achievement position in Big Picture" added (ADR-0049); scripted live checks pass.** Left for a human, in Big Picture with it in front: the by-hand checks H1-H4 in [the fix plan § 11](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md) (Preview pressed quickly with a `top_left` / `ps5` theme; an achievement right after a download; first toast after re-entering Big Picture; a possible one-frame flash after a LowBattery toast), and the new toggle: on, an achievement goes to enhanced-achievements' corner and the next toast back to enhanced-notifications'. Then delete the plan and its patch folder. Small follow-up: give enhanced-achievements' `tiers`, `safety` and `queue-stress` a Big Picture SKIP (they wait for the persistent toast window to close).

**enhanced-notifications: one style for every notification, random Preview, position / animation in Big Picture too (2026-10-01): done,
live-verified** on desktop and in Big Picture with test toasts (`test:live` 5/5 in each). Left for a human: look at it (a theme with
`"settings": { "position": "top_left", "animation": "ps5" }`, Preview pressed a few times), and an in-game overlay toast. Both toast
plugins now read `margin` / `padding` in CSS's clockwise order; the user's own `ps5.json` padding was converted (`[10, 15, 10, 10]`).

**F2 Community media: done and pushed (2026-09-30); a few live checks are still pending.** Live-verified by the agent: § 9.1
(feed, loader, cards, ScreenScraper `blob:` images, no URL or credential on disk), Routine 2 in desktop and Big Picture
(native game, AM2R, mapped game), `npm run test:live` 12/12 in desktop, trailer plays inline, image viewer in Big Picture
shows "Created by", the date and Close, controls hidden on our cards ([ADR-0046](docs/decisions.md), amended). Pending, in
order (the user, or an agent with the user's go-ahead):
1. **Big Picture by hand:** the viewer layout (tall images, the Close button position), the COMMUNITY tab with trailers, and that
   the author row and icons look right on a controller; also the first view of a shortcut after a Steam restart.
2. **Desktop image viewer:** it does not open on this machine (`CVRPathHelpers not found`, native cards too). Check whether that
   is this Steam build or this machine, and that our cards open it where native ones do.
3. **Right-click "Save screenshot"** on one IGDB image and one ScreenScraper `blob:` image (a `blob:` download may fail: note it).
4. **Author row click** (opens Steam's profile page for a made-up account: expected an error page; decide whether to hide the click).
5. **A long first page / "no more content"** on a shortcut with a 20+ item feed (Super Mario World) in Big Picture.
6. **Section reuse between games:** the stale-loader repair is proven on a simulated stale section only; navigation alone
   remounted the section every time here. Open a few shortcuts one after another in Big Picture (and on a controller) and
   confirm each COMMUNITY tab shows its own game's cards, never another game's or an empty section.
7. **F2c manuals** (ADR-0048): Big Picture checked by the user (Captain Commando); Chrono Trigger (7.5 MiB, 80 pages) fixed and
   live-checked in desktop 2026-10-01, as are the loading skeleton and the captions. Earlier note: live-checked in desktop 2026-10-01 (backend, first-page cover, viewer with 20 pages,
   "Scroll down to view the manual", fonts released, `test:live` 13/13); still open: **Steam places cards with a
   `Math.random` template shuffle, so the manual is not guaranteed the top-left cell** (decide: leave it, or wrap the
   loader's `AddCommunityContent` to move its cell first); a game whose media was cached before manuals has none for
   7 days (`media_ok`; decide whether to bump the cache); and the rest of [the plan § 11](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/steam-cartridges-f2c-manuals-plan.md)
   in Big Picture (D-pad scrolling, Routine 2).
   ScreenScraper videos and IGDB links are not started; ScreenScraper stays limited to its image types and the manual
   (title screen, screenshot, fanart, boxes, mixes, cartridge, flyer, HyperSpin theme) by the user's decisions (2026-09-30).
Vote, award, comment and Report controls are hidden on our cards, so the plan's § 9.3 rows for them are moot.

**enhanced-achievements Reset dialog, 4-value margin/padding, ps5 fade, ripple (2026-09-30, `39919c2`): deployed, not restarted.**
After a Steam restart, check on desktop: Reset keeps one dialog open (Resetting..., then the outcome, Close) and its window
(480 x 250) is not clipped; in Big Picture the same flow; a toast with `"padding": [10, 5, 4, 7]` (clockwise since 2026-10-01: 10 top, 5 right, 4 bottom, 7 left), the ps5 fade and the ripple;
a theme with a typo, picked and then reloaded, opens the theme-problems popup (560 x 360) listing it, and none opens at Steam's start.

**F1 Game Data editor: the user did a live check (2026-09-30); follow-ups are coded, waiting for a second live check.** Settings now use
enhanced-achievements' spacing ([plugins.md guardrail 18](docs/plugins.md#18-settings-panel-layout-reference-enhanced-notifications)),
Troubleshooting is gone, Game Data is the **Manual Edit** block in Library Audit, and the popup has a Controller support dropdown (the
`controllerOverrides` setting now reaches Game Info). Deploy with `dev.ps1`, then look at every section and the popup (desktop and Big Picture),
set Multi-player, Co-op and a controller option on a game whose data is wrong and check its Game Info, then run `check_settings_panel.mjs`,
`click_settings_panel.mjs` and `npm run test:live`. Then mark F1 done in the [features plan](docs/plans/steam-cartridges-features-plan.md).

**Lesson carried from the achievements preload (ADR-0045):** a dry run that never restarts Steam cannot see start-up order
(it failed live three times: `appStore` empty at boot, `{}` for an empty list (K1), Steam replacing its progress cache after
login). For F2's learn-once jsx observer and loader patch, run the plan's live probe right after a Steam restart and before
opening any game page, and read `C:\game\steam\logs\webhelper_js.txt` for `exceeded its error budget` after each deploy.

**Owed by a human:** the five visual hand checks listed in [verification.md](docs/steam-cartridges/verification.md) (never run after M10).
The shortcut library icon's optional last check (choose an icon by hand, confirm it is kept) is also yours.

**Done and live-verified, history in [CHANGELOG.md](CHANGELOG.md):** the `steam-cartridges` migration M0-M10 (ports and adapters,
[ADR-0039](docs/decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam) to
[ADR-0044](docs/decisions.md#adr-0044-steam-cartridges-layers-stay-dumb-and-a-test-checks-what-each-layer-does)); the
`enhanced-achievements` migration E0a-E3 ([ADR-0043](docs/decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net)).
How to verify and roll back: [verification.md](docs/steam-cartridges/verification.md).

## Considerations (decided later, not scheduled)

- **Auto-add next to shortcuts the user added by hand, or had before the plugin (found 2026-10-03, decide with the item below).**
  Today a game counts as "in the library" when a shortcut matches it: an Epic launcher link naming its AppName, an exe inside its
  install folder, or for Xbox a `shell:AppsFolder\<package>` target or an exe inside the package folder (`match` in
  `store_epic_local.lua` / `store_xbox_local.lua`, applied to every shortcut by `store_service.installed_games`). So the usual manual
  shapes are not duplicated; verified on this PC only for the six shortcuts the plugin made (the other 219 are not store games).
  Not covered: a shortcut that runs a wrapper (a .bat, Playnite, Heroic/Legendary), a renamed or different exe, an Xbox
  `ms-xbl-<id>://` or `xboxliveapp-` URI, or a copy of the same game on both stores. Proposal: (1) keep the matching and add a
  **title fallback**, a shortcut whose name equals the game's (case and punctuation ignored) counts as the same game and the panel
  says "In library as <name>"; (2) **re-check the live shortcut list just before AddShortcut** (a shortcut added by hand between two
  checks); (3) never edit or replace an existing shortcut, even a poor one; (4) **first enable asks first**: Settings lists the games
  it would add (checkboxes, "already in your library" greyed) so turning the toggle on with 40 Epic games installed adds only what
  the user ticked; (5) a button "Add existing store shortcuts to the Epic Games / Xbox collection" (routing rules use the
  collections, ADR-0036), never done silently; (6) skip, or ask about, a game the user already owns on Steam (the Steam match is
  only known after adding, so this needs the catalog title lookup first). Note for the persistent list: re-adding a deleted game
  gave a different appid (Minesweeper 2811889182, then 2663546656), so a re-add loses that shortcut's playtime and activity.
- **Auto-add and a shortcut the user deleted (needs a decision before auto-add is called finished, found 2026-10-03).** Today it is
  inconsistent: a game is requested once per session (`requested` in `app/store-sync.ts`), so a shortcut the user deletes stays gone
  until Steam restarts, then comes back at every restart while the toggle is on; and nothing restores one deleted by mistake.
  Options: **A.** a persistent list of games auto-added (backend data file), never added again even after a restart; an entry is
  dropped when the game is no longer installed, so uninstall then reinstall counts as new and is added again. **B.** restore controls
  in Settings → Third-party: each installed game shows "In library" / "Not in library" with an **Add** button, plus "Add all
  missing" (the panel already lists installed games and their library state). **C.** re-add on every 60 s check: rejected, it fights a
  deliberate deletion. **D.** keep today's behaviour. Recommended: **A and B together** (A makes a deletion stick, B is the easy
  undo; without B, A makes a mistaken deletion permanent). Questions: should a reinstall bring the shortcut back by itself (leaning
  yes), and should Add also appear on the game's own page (leaning no, settings only). Plan and an ADR amendment first.
- **Before publishing enhanced-notifications as its own public repo:** `themes/PlayStation/` and parts of
  `themes/SteamStation/` hold Sony's PlayStation trophy art and sounds (`trophy_ps4.mp3`, `trophy_ps5.mp3`,
  `platinum_trophy_ps5.mp3`, the bronze/silver/gold trophy images, `*_playstation.png`). Fine in this private repo;
  replace them with original or licensed assets, or ship `ps5` / `SteamStation` without them, before the public split
  ([plugins.md § 6](docs/plugins.md#6-publish-as-a-public-repo)). `SteamStation.json` bronze trophy has been recreated
  as `bronze.png` with Steam controller XYAB markers matching silver/gold (2026-10-02).

- **Achievement timeline markers for non-Steam games, in steam-cartridges** (removed from enhanced-notifications
  2026-10-02 as a Steam-native feature for shortcuts). Steam marks achievements on its own games' timelines but not on
  shortcuts'. steam-cartridges already knows each unlock (its `achievements.unlocked` event, with name and description),
  so a `timeline` surface (with a kill switch and a `touches` entry) could add the marker. What is known: the RPC is
  `GameRecording.UserAddTimelineEntry#1` on `CGameRecordingService`, resolved by signature (steam-components.md § Game
  Recording RPCs); the running timeline is in `window.g_GRS.m_mapActiveTimelines` (loader `BIsTimelineRunning`,
  `GetGameID`, `GetRunningTimelineDurationMS`, `GetTimelineStartBeforeGlobalZeroMS`); the entry time is the unlock's
  offset plus `GetTimelineStartBeforeGlobalZeroMS`. enhanced-notifications sent an `Event` entry (`type: 2`,
  `marker_icon: 'steam_achievement'`, `range_title`, `marker_description`, `range_duration: '0'`) and fell back to a
  `UserMarker` (`type: 5`, `steam_marker`); its code is in git before this change (`frontend/surfaces/captures/captures.ts`
  `sendMarker`, `frontend/capture/plan.ts`). Open: on Wuchang (2026-10-02 11:47, unlocks 2 s after launch) both forms
  were rejected with EResult 42, likely because the timeline was not running yet; probe live with a game that has been
  running for a while before designing.
- **Wrap `LoadCacheFile` instead of watching (ADR-0045 decision 5, option 2).** steam-cartridges re-applies its
  achievements when Steam replaces its progress cache after login, detected by polling the map's identity
  (`sensors/progress-cache`, 1 s, at most 10 min). If the poll ever proves too slow, too costly, or misses a user who logs
  in after 10 minutes, hook Steam's own load instead. Tips: the target is
  `window.appAchievementProgressCache.LoadCacheFile` (async; on the store's prototype, read it with
  `Object.getPrototypeOf(window.appAchievementProgressCache)` first, the class name is minified); call the original, then
  `achievements.rerenderAll()` (app layer, already exists); install it in a surface, never in a sensor (guardrail: only
  surfaces patch Steam), so it needs a `touches` entry (`appAchievementProgressCache.LoadCacheFile`), a kill switch and a
  line in `surfaces.md`; it runs once per login, so guardrail 2 (hot paths) is no concern. Other plugins may wrap the same
  method: always call the original and return its value so the wraps compose. Verify live with
  `tests/live/probes/ach_preload.mjs` right after a restart, and read
  `window.appAchievementProgressCache.m_achievementProgress.mapCache` identity before and after login (steam-components.md,
  "When Steam fills each achievement store"). Amend ADR-0045 (or supersede it) when done.
- **Surface `deps` singletons (F30).** Each `surfaces/*/deps.ts` is a module-level object that `create*Surface` overwrites. Rewriting the
  six surfaces as real factories would touch every Steam hook (the highest-risk code) for a benefit that has not occurred. Instead add one
  capability-ratchet rule in `tests/architecture.test.ts`: `index.tsx` calls each `create*Surface` at most once, and nothing outside a
  surface's folder imports its `deps`. Revisit the factory rewrite only if a surface ever needs a second instance.

## Next

- **enhanced-notifications Theme Creator (designed 2026-10-04, nothing coded).** A big modal from the Theme section
  (above Reload): start from a bundled template, edit a user theme or start fresh; live in-modal preview of four toasts
  (chosen, random, achievement tiers, mixed) with sounds; "Test on screen" with real toasts; the 17 AI sound packs as a
  bundled WAV library (Subtle / Distinct / Grand, picked per tier; no ps4/ps5/platinum names). Columns: navigation,
  preview, editor. Bundled themes are Save-as-only templates, made by the user. Design, decisions D1-D12, spikes S1-S8
  and phases P1-P10: [docs/plans/enhanced-notifications-theme-creator-plan.md](docs/plans/enhanced-notifications-theme-creator-plan.md).
  The user answered its § 3.2 (2026-10-04). **Next: P1 (sound library) and P2 (pure groundwork)**, each with its own
  mechanical plan first.
- **Phase 9 — provider contract** ([ADR-0013](docs/decisions.md#adr-0013-providers-return-data-the-core-renders-it),
  [ADR-0014](docs/decisions.md#adr-0014-providers-are-isolated-and-fail-silently)), after the migration:
  a provider becomes one more source adapter behind the migration's source contract.
- **Provider Plugin Extraction**: Extract `retroachievements` and `screenscraper`/`igdb`
  into standalone provider plugins communicating via the Phase 9 IPC contract.

## Later

- Optional SteamGridDB artwork filter rules (`g{Author:maxKB}` per artwork type, off by
  default), from the removed `docs/steam-cartridges.md` § 6
  (`git show 0d599cf:docs/steam-cartridges.md`). After the migration, as a source adapter.

## Waiting on the user

- Alpha testing checklist (U1–U9, real hardware/real unlocks only) —
  the plan's "User test checklist" (deleted plan; `git show 0cc6249^:docs/plans/phase7-and-alpha-plan.md`).

## Blocked upstream

- **Millennium Configuration API bug** [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)
  (fix proposed in [PR #904](https://github.com/SteamClientHomebrew/Millennium/pull/904)).
  Re-test and drop the workaround in both plugins' `settings.ts` once fixed.

## Active failures & blockers

None.

---

## Before writing any code

Building a plugin or a feature? Follow the playbook in
[docs/plugins.md § Playbook](docs/plugins.md#playbook-creating-a-plugin-or-a-feature).
Every other doc, by situation: [docs/README.md](docs/README.md).
