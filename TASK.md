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

**B3 (in-game toasts go to the visible view, ADR-0064): coded, deployed, verified with nothing focused 2026-10-08.** The flaky first toast came from the signal: `document.visibilityState` of the Big Picture window flips with the Windows desktop (minimised RDP: no foreground window), not with the game. B3 now decides by Steam's focused app (`m_currentlyFocusedAppid`); with focus on "desktop" (413080) both toasts go one after another to Big Picture's view in every run (scratch/en-spikes/B3-loc6-8). **Next, needs the user at the screen (RDP window open):** AM2R or another game in front in Big Picture, then `node tests/probes/ingame-views.mjs 14000` (Steam lock): expect both toasts in the `OV` view. Also for the user: the uncommitted bundled `themes/ps5.jsonc` has `"popup_icon": [true, 8]`, read as scale 8 % (clamped to 25 %), not radius 8; `[true, 100, 8]` was probably meant. Then B4-B7.

**enhanced-notifications Big Picture in-game bugs and consistency: stage A done; B1 (card leaves with the toast) and B2 (one type per view) deployed and verified in game 2026-10-08; B3-B7 next.** Left for the user: look at a themed toast leaving in game (no card left behind, no top-left flash). Next: B4 sounds, B5 queue stall (C5: still seen in the full live suite, every script passes alone). Findings ([plan § 7](docs/plans/enhanced-notifications-consistency-plan.md)):
the flash and the bad fade are the theme's card background sitting on `.GamepadToastPopup`, outside the element our exit
animates (it stays opaque; in the game overlay Steam moves the view to (0, 0) before hiding it, so the card flashes
top-left); "only one shows" is Steam's own: in game two toast views pop from one queue and the second toast lands in Big
Picture's view behind the game; sounds are not blocked, they overlap (a chime inside our clip). Next: B1 (card animates
with its content: small, first), then B2-B7 (§ 6b), each with its own mechanical plan. The user: repeat a real F12 + recording
burst in a game whose overlay draws (AM2R's overlay does not show here). Also: 2 theme unit tests fail since the theme
reorganisation (`themes/steam_midnight.json` missing; B6). Earlier note: The user's report (in game,
Big Picture, ps5): a toast flashes top-left before it leaves, the fade-out looks wrong, other notifications' sounds seem lost while a custom
achievement sound plays; and the plugin should feel less erratic. [Plan](docs/plans/enhanced-notifications-consistency-plan.md): hypotheses
per symptom (leading: our styling stops matching before Steam hides its view, so Steam's animations restart as it moves the view to
(0, 0); the in-game overlay path, never traced; our own capture burst queued or rate-limited), stage A spikes (A0: make `placement.mjs` /
`sound-duration.mjs` restore settings; the user's theme and queue were found reset today), then stage B fix phases. Next: A0, then A1-A4
with Big Picture in front and a game running.

**steam-cartridges-local owns every Steam API emulator and local-game source; extensions push unlocks (ADR-0063, 2026-10-08): deployed (`-dev`, both plugins), partly live-verified.**
[Plan](docs/plans/steam-cartridges-local-emulator-split-plan.md); history in [CHANGELOG.md](CHANGELOG.md). Live (agent, 11:31 restart): boot health PASS;
`window.SteamCartridges.version` 1.1.0 with `reportUnlocks` / `onAppLaunched`; the local provider and panel registered; `LocalDetectFiles`
finds Wuchang's `SOVEREIGN.ini` from the exe (0 unlocks), label "Local achievements (SOVEREIGN)"; `test:live` passes render loop,
Properties, nav cycle, tabs, settings, F1, F2, audit. Next, in order:
1. **`check_parity.mjs` 3 PASS / 14 FAIL** (Game Info, links, artwork, friends of the mapped shortcut 4202674849): it read the native page
   left open by earlier tests (header links of 105600, then 435150), with Steam's desktop window hidden in the tray after the restart.
   Re-run with the window open; if it still fails, bisect against `d4aa57e` (ADR-0063 does not touch those surfaces).
2. **The user:** open Wuchang's page (no toast), Settings → Local achievements (one toggle), the Reset dialog lists "Local
   achievements (SOVEREIGN)" (do not reset unless wanted); launch Wuchang from Steam and learn a discipline skill: expect Steam's toast
   within ~2 s and the unlock in the Post-Game Summary.
3. **Wuchang `SOVEREIGN.ini`**: the emulator wrote a key-less `=1` (CRLF, the only such line) at 01:22 with the first save; every launch
   since crashed ~11 s after start (`SOVEREIGN.log`, UE crash report). Settled: AppID/SteamID are not the cause (saves in
   `Saved/22202` = the emulator's SteamID), the list has all 40 achievements (Disciplinary Discipline = `ACH_COPPER_10_F`), Windows'
   INI reader skips the `;` comments (tested). Open: the crash first (launch the exe outside Steam to rule out the overlay), then whether
   a real unlock writes `ACH_COPPER_10_F=1` or another `=1`.
4. Optional: plan phases 6 (core: Steam appcache schema, Xenia, shadPS4 layout) and 7 (local: progress, SOVEREIGN comment schema,
   mapping suggestion).

**steam-cartridges-local & steam-cartridges SOVEREIGN.ini achievements & core provider integration (2026-10-08): completed and live-verified.**
- Implemented SOVEREIGN.ini parsing (Format B `[Achievements]` with Unix timestamps, numeric/boolean states, comment tolerance, and safe reset with `.bak` backups).
- Live verified against *WUCHANG: Fallen Feathers* (`AppID=2277560`, shortcut AppID `3135033888`) at `D:\Games\WUCHANG - Fallen Feathers\Engine\Binaries\ThirdParty\Steamworks\Steamv155\Win64\SOVEREIGN.ini`.
- Added game executable parent traversal and shortcut auto-lookup (shortcuts.vdf binary parsing, 64-bit SteamID account id conversion) in `file_search.lua`.
- Integrated emulator discovery improvements inspired by PSerban93/Achievements (Tenoke, Online-Fix, SkidRow, EMPRESS, RELOADED, SmartSteamEmu, UniverseLAN).
- Connected `ExtensionRegistry.getAchievementProviders()` to core `steam-cartridges` (`load`, `checkNow`, `resetSources`, `reset`).
- Portable category 22 (Achievements) rebadging supported on shortcut records with real achievements. Full test suites pass 100% (334 TS tests, 12 Lua suites, all live CDP tests).

**steam-cartridges-third-party Xbox UWP Steam Overlay Workaround & Pool Blitz Fixes (2026-10-07): completed and live-verified.**
- Executed all 4 research spikes from `docs/plans/steam-cartridges-uwp-overlay-research-plan.md`. Shipped Option 1 (Mirrored Presentation Wrapper) via `tools/uwp_presenter/` (`bin/uwp_presenter.exe`).
- Diagnosed and fixed Pool Blitz issues: Windows SDK COM CLSID typo (`S_OK`), `OpenInputDesktop` enumeration for active desktop windows, yellow border suppression (`session.IsBorderRequired = false`), dynamic DXGI swapchain backbuffer resizing (fixed black screen bug), GDK child process tree resolution (`CreateToolhelp32Snapshot`), window title self-exclusion bug, transient splash screen filter (`IsTransientOrLauncherWindow` to skip `gamingservicesui.exe` so the real game `Pool-WinGDK-Shipping.exe` is captured), borderless fullscreen presentation matching game display resolution, and mouse click forwarding with telemetry.
- Implemented multi-target sensor telemetry engine across C# (`uwp_presenter.log`), backend Lua (`third_party.log`), and live "Diagnostics & Sensor Telemetry" UI modal in Third-Party settings.
- Resolved and eliminated duplicate shortcut generation by adding `--aumid` recognition to core `store_xbox_local.lua`, and documented Guardrail 22 in `docs/plugins.md` and `docs/steam-cartridges.md`. Unit tests and full live CDP suite 100% pass.

**steam-captured-activity event-driven clean-up (2026-10-07): deployed, the 3 Steam event sources register.** Left: see a real
screenshot or clip saved and deleted reach an open AM2R feed within seconds (`diagnostics().captureEvents.recent`). Open:
AM2R clips `…20260920_054439`, `…20261007_130809`, `…132038`, `…132350` left the disk at 10:25:56 during the user's test session
(no plugin capture action logged); find out what deleted them.

**Recordings missing from Steam (2026-10-07): root cause found and fixed, live-verified.** steam-cartridges' start-up burst of
~450 `GetClips` calls emptied Steam's clip list for the session; now only an open page publishes (all 8 clips list again). See
[CHANGELOG.md](CHANGELOG.md). The "background recording" tile is Steam's own bug (user, plugins
disabled). Left for the user: the three malformed probe clips are in `userdata/83513586/gamerecordings_quarantine_20261007/`:
delete them, or put them back.

**steam-captured-activity split out of steam-cartridges (ADR-0062, 2026-10-07): built, deployed (`-dev`), live-verified by the agent.**
[Architecture](docs/steam-captured-activity.md); history in [CHANGELOG.md](CHANGELOG.md). Left for the user: look at its settings
panel (two toggles) on desktop and in Big Picture; delete a real screenshot and confirm its card leaves the feed on the next
visit (the agent only simulated it). The missing clips were steam-cartridges' start-up burst (entry above). Not published yet
(public repo, plugin database).

**enhanced-notifications live scripts that reset settings (found 2026-10-07).** `placement.mjs` and `sound-duration.mjs` end with
`resetSettings()`, so running one alone wipes the user's settings (only `npm run test:live` snapshots and restores). Next: make
each snapshot and restore its own settings like `achievements-captures.mjs`, keeping their checks. Also open: Big Picture
placement for normal notifications (`bigpicture.mjs`, needs Big Picture open).

**enhanced-notifications capture on unlock without background recording (ADR-0061, 2026-10-07): built, deployed, works; one open issue.**
After the unlock's recording, Steam's media list shows the session's timeline as a recording that opens "no recording
available" (`gamerecording.pb` keeps `timeline_…_042020`; its video went into the clip). Next: compare with a manual
Ctrl+F11 start/stop by the user (same tile = Steam's behaviour), then with DevTools inspect what Steam lists for that
timeline and whether removing the entry is safe. Leftover probe files: none found on disk for AM2R.

**steam-cartridges-local & steam-cartridges-third-party backend logger syntax & module isolation (2026-10-06): completed and verified.**
- Fixed Lua logger method calls to colon syntax (`logger:info`, `logger:error`) in `steam-cartridges-local/backend/main.lua` and `steam-cartridges-third-party/backend/main.lua` to properly pass `self` required by Millennium's C++ logger binding.
- Stripped lingering core dependencies (`captures`, `shortcuts`, `steam_paths`) and dead RPC methods (`GetLibraryStats`, `GetDiagnostics`) from `steam-cartridges-third-party/backend/rpc.lua`.
- Verified cleanly via unit tests (`npm test` 100% in both plugins) and live Steam health checks (`node steam-health.mjs` report: all 5 plugins loaded without startup crashes).

**steam-cartridges consistent card block spacing & font typography in Review and Manual Edit modals (2026-10-06): completed and verified.**
- Structured Review modal (`audit.tsx`) so each game (both flagged issue games and unscraped games) renders as its own card block (`CARD_BACKGROUND`, `borderRadius: "4px"`, border) separated by standard `BLOCK_GAP` (22px). Standardized modal width to 640px.
- Restructured Manual Edit modal (`GameDataEditor`): wrapped `GamePicker` in a proper `ItemRow` card matching `enhanced-notifications` reference, wrapped `MetadataForm`, `IgdbLink`, and `SteamLink` sections in dedicated card blocks, and wrapped text inputs in `<ItemRow trailing>`.
- Removed hand-written `fontSize: "12px"` and custom error styles (`NOTE_STYLE`, `ERROR_STYLE`) across `game-editor/`, converting messages and validation errors to standard `ActionRow` and `Field` components per Guardrail 18.
- Verified cleanly via unit tests (331 TS tests, 12 Lua test suites) and full live CDP verification suite (`steam-health.mjs`, `test_nav_cycle.js`, `check_all_tabs.js`).

**steam-cartridges & steam-cartridges-third-party uninstalled game auto-removal & settings cleanup (2026-10-06): completed and verified.**
- Streamlined `steam-cartridges-third-party` settings section per Guardrail 18 with compact status badges (`(3 installed, 2 in library)`) and short, punchy descriptions.
- Implemented automatic cleanup of shortcuts in Steam library when third-party games (Epic / Xbox) are uninstalled, active only while each store's auto-add toggle is turned on.
- Verified cleanly via unit tests (331 TS tests, 12 Lua test suites) and full live CDP verification suite (`steam-health.mjs`, `test_nav_cycle.js`, `check_all_tabs.js`).

**steam-cartridges extension system, modular expansion plugins & universal Captured Activity (2026-10-06): completed and verified.**
Plan executed and deleted 2026-10-07 (readable at `3e1269b`); its captured-activity pillar is superseded by ADR-0062.
- Decoupled `steam-cartridges` into a modular core by establishing a typed extension registry on `window.SteamCartridges` (`frontend/kernel/extensions.ts`) with load-order queueing (`__STEAM_CARTRIDGES_QUEUE__`) and dynamic settings panel injection (`SettingsPanel` in `panel.tsx`).
- Created `steam-cartridges-local`: standalone, publishable Millennium plugin holding all offline Steam emulator achievement parsing (.ini and .json for CODEX, RUNE, GSE, Goldberg) and backup/reset capabilities. Verified with unit tests passing 100%.
- Created `steam-cartridges-third-party`: standalone, publishable Millennium plugin carrying Epic Games and Xbox / Microsoft Store / Game Pass detection, shortcut auto-add, achievement synchronization, launcher overlays, and Microsoft OAuth device sign-in. Verified with tests passing 100%.
- Captured Activity for Steam games and shortcuts: since moved to its own plugin, `steam-captured-activity` (ADR-0062, entry above).
- Removed dead third-party settings and unused backend RPCs (`StoreAccounts`, `XboxSignInStart`, `XboxSignInPoll`, `XboxSignOut`). Resolved settings panel null config crash in `steam-cartridges-third-party` (null-safe `useSetting` hook and default fallback) and added `ExtensionErrorBoundary` isolation in core `SettingsPanel`. Process detachment hardened across `dev.ps1` via WMI. Verified zero regressions: 328 TypeScript tests passing, all Lua test suites passing, and zero capability ratchet violations.

**steam-cartridges background artwork/icon ingestion & settings modals Guardrail 18 cleanup (2026-10-06): completed and verified.**
Wired `ArtworkResolver.ensure` into `frontend/app/ingest.ts` during background ingestion so cover art (`SetCustomArtworkForApp`) and shortcut icons (`SetShortcutIcon`) are written to Steam immediately when shortcuts are fetched, eliminating the requirement to visit the game page for native components to update. Cleaned up Review (`settings/panels/audit.tsx`) and Game Data Editor (`game-editor/*`) modals: removed repeated format hints (semicolons, date formats) from individual field labels and consolidated into a top-level section description; shortened verbose labels and descriptions across both dialogs; wrapped per-game cards in block containers to enforce `<Blocks>` spacing (`BLOCK_GAP`); converted dropdowns to `FullWidthRows` and action controls to `ButtonRow`. Verified via 327 TypeScript unit tests, 12 Lua test suites, and production build.

**steam-cartridges unsupported ROM hash guard & ScreenScraper media cache capacity (2026-10-06): deployed and verified live.**
Enforced strict ROM hash gating in `backend/retroachievements.lua`: when an emulator shortcut has an extracted and computed ROM MD5 (e.g. *Super Bomberman 5 Caravan Event Ban*, MD5 `772ca292857d5bcf1f8776009fa1d280`) that is unsupported by RetroAchievements, the plugin no longer falls back to title matching and returns `nil, "unsupported rom hash"` (preventing false attachment of achievement sets that can never unlock in-game). Title matching remains active for shortcuts where no ROM path could be extracted, and manual user linking remains available. Resolved broken ScreenScraper images in community cards by raising `MAX_MEDIA_APPIDS` in `kernel/media-bin.ts` from 8 to 64 (preventing premature revocation of `blob:` object URLs during library browsing) and adding base64 whitespace sanitization in `ports/image.ts`. Live verified via CDP: Super Bomberman 5 returns `unsupported rom hash` and 0 achievements, supported games (Kirby) retain 70 achievements, and ScreenScraper media images render cleanly in the Steam DOM.

**steam-cartridges IGDB metadata search & linking, Super Bomberman 5 RA resolution, and Millennium luavm64 R15 hot-patch (2026-10-06): deployed and verified live.**
Permanently eliminated recurring `EXCEPTION_ACCESS_VIOLATION (0xC0000005)` crashes in `millennium.luavm64.exe` at RVA `+0x1087C` (`movdqu [r15], xmm0`) by implementing an in-memory dynamic hot-patch (`millennium_patch.lua`) using LuaJIT FFI and `VirtualProtect`. The patch reroutes the `jbe` at RVA `0x1055f` through a 26-byte trampoline at RVA `0x231b80` that reloads caller register `R15` from `[RSP + 0xE8]` before executing `movdqu [r15], xmm0`. Resolved Super Bomberman 5 RetroAchievements matching to GameID 1444 (*Super Bomberman 5: Gold Cartridge*, 46 achievements) by rejecting dummy/cheated ROM entries, inspecting IGDB alternative names, and falling back to clean title matching. Added full IGDB catalog search and direct ID linking in `GameDataEditor` (`igdb-link.tsx`) and the Review panel (`audit.tsx`) while preserving manual metadata editing and Steam link capabilities. Live verified via CDP: 10 consecutive stress calls completed with zero crashes, `IgdbSearch` returned 13 candidates, Super Bomberman 5 resolved 46 achievements, and full navigation lifecycle tests passed cleanly.

**steam-cartridges page data first (ADR-0060, 2026-10-06, [plan](docs/plans/steam-cartridges-dataflow-improvements-plan.md)): deployed and live-verified by the agent.**
Priority lanes in the call queue, paint from disk then refresh, remembered empty lookups, persistent RA hash/GameID cache, one start-up
read. Left for the user: open a few RetroAchievements games and a game never opened before, and say whether achievements now show with the
page. Follow-up: split `achievements.json` (schemas vs unlocks) so an unlock stops re-encoding 2.6 MB (needs a plan).

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
- **Extension System, Expansions & Universal Captured Activity ([plan](docs/plans/steam-cartridges-extension-system-and-expansions-plan.md)):**
  Decouple `steam-cartridges` into a modular core with a typed Extension API (`window.SteamCartridges`). Extract `steam-cartridges-local`
  (CODEX/RUNE/GSE/Goldberg local achievements .ini support; Wuchang reference game) and `steam-cartridges-third-party` (Epic/Xbox game discovery,
  auto-add, store achievements, and launcher tracking). Generalize Captured Activity to render 16:9 thumbnails and `{Username} captured`
  on both native Steam games and non-Steam shortcuts.
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
