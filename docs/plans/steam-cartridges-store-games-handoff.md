# Handoff: Epic and Xbox games in steam-cartridges (state of 2026-10-03, end of a long session)

**Read this first if you pick the work up later.** It records what is built and deployed, what was learned, every decision
(taken and open), the options, and the next steps in order. Deeper evidence: [the unlock-detection research](steam-cartridges-store-unlock-detection-research.md)
(timelines, tables, samples), [the store-copies plan](steam-cartridges-store-copies-plan.md) (ADR-0056, applied),
[service-store.md](../steam-cartridges/service-store.md), [TASK.md](../../TASK.md). Times below are the user's local time (UTC-3)
unless a log is named; the watcher's logs are UTC.

## 1. What exists and is deployed (all pushed to `origin/main`)

| Area | State | Commits |
| --- | --- | --- |
| ADR-0056 store copies (Epic and Xbox found from the PC, store Game Info and screenshots, synced unlocks, unlocks in the Activity feed, Third-party settings, auto-add, Reset filter in enhanced-notifications) | applied in two phases, live-tested | `3e39ce2` backend, `5dfc40e` frontend, `739fcf8` docs and ADR |
| Xbox sign-in popup: clickable link, click-to-copy code with MDI clipboard icons | deployed, verified live | `30473c9` |
| Auto-add of games installed while Steam runs (60 s tick, `sensors/installs`) | deployed; **bug found and fixed**: the install list was cached for the whole session, so the tick never saw new games | `32b0a2a`, `4c57066` |
| Epic: a manifest with `bIsIncompleteInstall: true` (download in progress) is not an installed game | deployed | `32b0a2a` |
| Xbox: games without a game config are found through the manifest's `xboxliveapp-<n>` protocol (Microsoft Sudoku) | deployed, verified live | `70208a8` |
| Collection filing waits for Steam's collections to load, and retries (the first add after a restart could not be filed) | deployed | `4c57066` |
| Research probe `unlock_watcher.mjs` (+ `unlock_report.mjs`, `unlock_mark.mjs`, `epic_overlay.mjs`, two PowerShell helpers) | working | many, last `70208a8` |
| Docs: research note, TASK entries, ADR-0056 addendum, `sensors.md`, `service-store.md`, CHANGELOGs | written | `ed093eb` and earlier |

Test counts at the end: steam-cartridges TS 295 pass / 0 fail, Lua 11 suites all pass (`test_store.lua` has the new checks),
`npm run test:live` 13/13 (parity 17/17 now that the Epic test shortcut exists), enhanced-notifications 172 pass / 0 fail.

**Machine state (so a new session does not trip on it):** Steam runs the deployed build (restarted 18:01); the Steam lock is free;
Xbox is signed in as gunCannoli; the Epic profile is public (achievements readable without a sign-in); settings
`autoAddEpicGames` and `autoAddXboxGames` are on; shortcuts added by the plugin: Epic Games collection = BURIED STARS 4069313383,
Jotunnslayer 4202674849 (the live tests use this one: `check_parity.mjs` default and `run.mjs`); Xbox collection = Fortress Merge
3009476336, Microsoft Minesweeper 2663546656, Microsoft Sudoku 2527215573, Microsoft Ultimate Word Games (Wordament) 2426089520.
Microsoft Jigsaw was uninstalled by the user and its shortcut removed by the agent during a test (not re-added: it is not
installed). Minesweeper's shortcut was also removed by the agent in a test and came back at the next restart with a **new** appid.
The Epic overlay renderer files are in place (not muted). A leftover `window.__ucProbe` in Steam's page is harmless until a restart.

## 2. What we learned (facts, verified live unless marked)

### 2.1 Seeing an unlock as it happens

- **Xbox: Windows hands over the whole achievement.** Event log `Microsoft-Windows-PushNotification-Platform/Operational` records
  every push with its payload as hex; Xbox sends each achievement as a `wns/raw` push to the Xbox app's widgets. The JSON
  (after CRLF headers): `service: "achievements"`, `titleId`, `titleName`, `achievementId`, `achievementName`,
  `achievementDescription`, `achievementIcon`, `unlockTime`, `gamerscore`, `rarityPercentage`. Readable **without admin**. No toast
  window exists to read. Needs the Xbox app / Game Bar installed and the Windows account signed in to Xbox; **our own sign-in is not
  needed for detection**. A burst of unlocks arrives as separate pushes about a second apart.
- **Epic: only triggers, the API names the achievement.** Epic's overlay draws its toast inside the game (no window, no toast-database
  row). Useful triggers: the overlay renderer's (`EOSOverlayRenderer-Win64-Shipping.exe`) **new connections, about 1 s after
  the unlock**; `cef.log` ffmpeg lines (timestamp is inside the line, but the file is written late, up to 10 s); a 178x178 GIF
  appearing in `%LOCALAPPDATA%\Epic Games\EOSOverlay\BrowserCache\...\f_<n>` (generic toast asset, not the achievement icon).
  **Not** an unlock trigger: the game's connection to `api.epicgames.dev` (made once at launch).
- **First end-to-end runs, unlock to Steam's native toast** (`--steam`): Xbox **1.0 s** (push 0.94 s, post 0.04 s, shown +6 ms);
  Epic **4.3 s** (trigger +1.3 s, the API showed the unlock on its third check). The plugin's plain API poll alone would give
  about 5 s (Xbox) and up to 10 s (Epic).
- **Posting a native toast:** `NotificationStore.OnNotification(id, achievementType, protobuf)` (the call enhanced-notifications uses for
  previews). Fields: `appid` (normalise with `>>> 0`: shortcut appids pass 0x7FFFFFFF), `achievement_id`, `name`, `description`,
  `image_url`, `achieved: true`, `rtime_unlocked`, `global_achieved_pct`. enhanced-notifications' sensor ignores only `EA_` ids, so our
  toast counts as a real unlock for it (banner, sounds, captures).
- **Captures did not run in either test:** `Unlock captures skipped for appid ...: no-running-timeline`. See section 4: this is the
  next problem.
- **Xbox without our sign-in:** detection, toast, captures, Post-Game Summary line and Activity feed entry work from the push alone.
  The sign-in adds the full list (locked achievements), totals ("1 of 20", the 100% toast), history from before the listener ran,
  and secret/rarity details. No anonymous source exists (probed: profile and title-history APIs 401, achievements API 400 "no valid
  claims", `xbox.com/play/user` is an empty shell, mirror sites block us, nothing cached on disk). Whether Windows' Xbox identity can
  hand a plugin a token (GDK `XUser`) was **not** checked.
- The Xbox sign-in page names the borrowed client id (`00000000402b5328`) "Minecraft Launcher".

### 2.2 Installs and auto-add

- Matching an existing shortcut to an installed game: an Epic launcher link naming the AppName, an exe inside the install folder, an
  Xbox `shell:AppsFolder\<package>` target or an exe inside the package folder. On this PC only the six plugin-made shortcuts are
  store games (225 shortcuts scanned), so manual-shortcut matching is unproven.
- A game is requested once per session (`requested` in `app/store-sync.ts`); a re-add after a deletion produced a different appid, so
  the shortcut loses its playtime and activity.
- A real install while Steam runs has not been seen yet (the tick runs every 60.0 s and the list is fresh; unit tests cover it).

### 2.3 Why Big Picture and Steam's recording cannot see the game (this session's last topic)

Evidence from the watcher logs and the PC:

| Store | What the shortcut runs now | Who really starts the game | Result |
| --- | --- | --- | --- |
| Epic | `EpicGamesLauncher.exe` + `com.epicgames.launcher://apps/<ns>%3A<item>%3A<app>?action=launch&silent=true` | the already-running **launcher** (pid of `EpicGamesLauncher`), with `-AUTH_LOGIN=unused -AUTH_PASSWORD=<one-time exchange code> -AUTH_TYPE=exchangecode -epicapp=... -EpicPortal -epicusername=... -epicuserid=...` | the Steam-launched process only forwards the link and exits (or is the idle launcher), the game is outside Steam's process tree |
| Xbox UWP (Minesweeper, Wordament, Sudoku) | `explorer.exe` + `shell:AppsFolder\<package>!App` | **svchost (DcomLaunch)**, `Minesweeper.exe -ServerName:App...mca` (COM activation) | the game cannot be a child of Steam; its exe cannot be run directly |
| Xbox GDK (Fortress Merge) | same | same | here a direct exe exists: package root `C:\Program Files\WindowsApps\QubicGames.FortressMerge_...` is a link to `C:\game\gamepass\Fortress Merge\Content\` which holds `Fortress Merge.exe`, `MicrosoftGame.config`, `gamelaunchhelper.exe` (the manifest's executable) |

Steam tracks a launched shortcut by its **process tree**; recording ("no-running-timeline") and the Steam overlay depend on the game
being in that tree. Findings from outside (sources below): an already-running Epic launcher breaks the tree; closing it first and
letting Steam start the launcher makes the game a descendant; a **wrapper that Steam launches, which starts the game and stays
alive until it exits** gives Steam a stable parent (playtime, running state, recording attaches to the parent session) but not the
overlay; packaged Xbox games need COM activation (`IApplicationActivationManager`), and a wrapper blocks until the game exits.

Sources read (2026-10-03):
- WSGM (GPLv3, do not copy code into an MIT plugin): wrapper in the shortcut **Target**, the real program in the launch arguments
  ("Steam ignores exe-replacement launch options in shortcuts"); for packaged Xbox games it ships a launcher that puts the overlay
  and Steam Input back, by injection, with an anti-cheat/ban warning. https://github.com/KillerPixelCrew/WSGM
- SteamedPass (MIT; vendors UWPHook and VDFParser, MIT): the shortcut's `Exe` points at `steamedpass.exe` with the AUMID and exe name
  as arguments; it activates the app through `IApplicationActivationManager` and **blocks until the game exits**; no overlay claim.
  https://github.com/Arcadeguy/steamedpass
- steamRecord-for-nonSteam-games (C#, no license stated): Steam launches the wrapper, the wrapper launches the game as a child and
  stays alive until it exits, "Steam Recording attaches to this persistent parent session"; explicitly no overlay.
  https://github.com/Krekensis/steamRecord-for-nonSteam-games
- Gist for Epic with overlay: add `cmd.exe` with `/c start "" "com.epicgames.launcher://apps/<id>?action=launch&silent=true"`; closing
  the Epic launcher first helps; overlay unreliable. https://gist.github.com/ryrun/3f6b0ed86c43381309ebd8d1af053597
- The Windows Club article the user linked (https://www.thewindowsclub.com/add-windows-store-games-to-steam) answered HTTP 403 to our
  fetch: **not read**. Search summaries say: Game Pass games installed under `WindowsApps` cannot be added by their exe; many current
  Game Pass PC games are plain Win32/GDK exes that work as normal non-Steam games.

## 3. Decisions

**Taken (the user's, 2026-10-02/03):** Steam first, then the store, then IGDB, then ScreenScraper for a non-Steam copy; nothing typed by
hand; unlocks synced (now also shown live); auto-add per store, off by default, never removes a shortcut automatically; Epic and Xbox
are not offered by Reset Achievements; the Epic native toast should be hideable so Steam's toast shows alone (research:
`--mute-epic-overlay`); the unlock should reach Steam as a **native** achievement toast so other plugins see it as native.

**Open, with a recommendation each:**

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Deleted shortcut and restore | A persistent "already added" list (dropped when the game is uninstalled, so a reinstall adds again); B restore controls in Settings (per game Add button, "Add all missing"); C re-add every tick; D keep today | **A + B** |
| D2 | Existing and manual shortcuts | title fallback match, re-check just before `AddShortcut`, never edit an existing shortcut, first enable asks first (checkbox list), a button to add existing store shortcuts to the collection, skip games owned on Steam | all six (TASK.md) |
| D3 | Xbox account | lite (push only, no link) by default, full (sign-in) optional; or sign-in required | **lite default, full optional**; own registered Microsoft app instead of the borrowed Minecraft client id |
| D4 | Epic overlay mute | manual documented step (edits Program Files, needs admin) or a button with a warning | manual step, decide later |
| D5 | Epic detection speed | poll the API every 0.5 s during the burst (more requests to Epic) or keep 1.5 s | try 0.5 s |
| D6 | **How the shortcut launches the game** (section 4) | see options below | decide after the experiments |
| D7 | ADR | supersede ADR-0056 decision 3 ("no toast") with: store unlocks post Steam's native toast, per-store setting | write it before the build |

## 4. The launch problem: options and experiments (next work)

The user's point (2026-10-03): the shortcut target is the launcher (`EpicGamesLauncher.exe`) or Explorer, not the game exe, so
Steam, Big Picture focus, screenshots and recordings cannot see the game. Goal: a shortcut whose process tree contains the real game.

**Epic**
- **E1 direct game exe** (`...\BURIEDSTARSd7620\BURIED STARS.exe`): game is Steam's child (overlay, recording, focus all work). Cost: no
  `-AUTH_*` exchange code (single-use, minted by the launcher from its session; reading that session is "the launcher's secret" and
  was ruled out), so EOS login fails and **achievements and the Epic overlay may not work, which our unlock detection needs**. Some
  games run fine without the launcher; test per game.
- **E5 Steam starts the launcher** (no new code): if the launcher is not already running, the current shortcut already makes the
  launcher, and so the game, descendants of Steam. Weak spot: users keep the launcher in the tray.
- **E2 wrapper script**: if the launcher runs, close it; start `EpicGamesLauncher.exe <link>` as the wrapper's child; find the game
  process (exe inside `InstallLocation`); wait for it; exit. Tree: Steam, wrapper, launcher, game. Costs a launcher restart per launch.
- **E3 wrapper that only waits** (SteamedPass style): Steam gets a stable parent and playtime, but the game is outside the tree:
  recording and overlay unknown.

**Xbox**
- **X2 GDK games** (`MicrosoftGame.config` present, e.g. Fortress Merge): shortcut to the exe in the library folder
  (`C:\game\gamepass\<Game>\Content\<Game>.exe` per the config's `Executable`, not `gamelaunchhelper.exe` unless needed): direct, in the
  tree. Needs a test that Xbox services and achievements still work.
- **X1 UWP games** (Minesweeper, Wordament, Sudoku: `EntryPoint` is an app class, `XboxServices.config`, no direct exe): COM activation only. A wrapper
  (`IApplicationActivationManager`, then wait for the process whose path is in the package root) gives Steam a stable parent and
  playtime, but not the tree or the overlay (WSGM injects; out of scope and risky).
- The wrapper can be a **PowerShell script** the plugin writes to its data folder (no native build): shortcut Exe =
  `powershell.exe` (hidden window), launch options = `-File <script> <store> <id>`; Add-Type can host the COM call. Alternative: a tiny
  compiled exe (needs a build step in the repo). Both are new surfaces in `library-shortcuts` and need the app-id change that comes
  with a different Exe (a different shortcut appid).

**Experiments, in order (each cheap):**
1. T1 (no code): fully quit the Epic launcher, start BURIED STARS from its Steam shortcut. Check with the watcher (`process+` parent
   chain), Steam's own state, `window.g_GRS.m_mapActiveTimelines`, Shift+Tab, Big Picture focus, and whether unlock captures run
   (enhanced-notifications log: no more `no-running-timeline`).
2. T3: Fortress Merge as a direct-exe shortcut (test shortcut, then remove): does it start, sign in to Xbox, unlock, and is it in the tree?
3. T2/T4: prototype the wrapper scripts for Epic (launcher running) and UWP Xbox, repeat the checks of T1.
4. Decide D6 from the results, write the ADR (D7) and a plan under `docs/plans/` with patches (the plan standard).

## 5. Full list of what is still to test or build

**Live checks still open** (also in the research note):
1. A real install while Steam runs gets its shortcut within a minute, in "Epic Games"/"Xbox", launches; an Epic download in progress
   is not added; an Xbox game mid-install (does the registry show it early?). A deleted shortcut is not re-added in the session.
2. Epic with the overlay muted (`--mute-epic-overlay`, elevated PowerShell, start before the game): Steam's toast alone, detection
   still fires (overlay triggers vanish; the API burst and the game's own traffic remain), files restored.
3. A second Epic sample: GIF/`cef.log` recurrence; the launch toast is distinguishable.
4. Xbox: app closed, Game Bar off, a console unlock on the same account (must not toast: no local shortcut).
5. Captures (section 4) and Game A, B, A navigation (Routine 2) with the toast flow.
6. Two unlocks in one second, two stores at once, a game with no shortcut (logged, no toast), no duplicate toasts.
7. By hand from the ADR-0056 plan: Xbox sign-in done; Jotunnslayer/Jigsaw pages seen; H5 play the shortcuts; H8; H9 Reset list; Big
   Picture look at pages and the Third-party panel.

**To build, nothing started** (each needs a plan, an ADR amendment and tests): the persistent added-list and restore controls (D1);
the manual-shortcut policy (D2); the launch strategy (D6); a `store-unlock` sensor in steam-cartridges; the backend push-log reader
(Lua spawning `wevtutil`/PowerShell, decoding hex, parsing JSON; nothing on a timer while no store game runs, ADR-0007: start on
`shortcut.launched`, stop on `quit`, then the existing forced sync; an event-driven child would beat polling if the backend can hold
one) and the Epic trigger (overlay renderer connections need a connection reader; or the burst on `shortcut.launched` plus a
`cef.log` timestamp read); the `toasts` surface posting through `OnNotification` (the existing launch toast calls it with one
argument and shows nothing: TASK.md); Xbox lite/full modes and settings rows; unit tests (push payload, id mapping, dedupe, appid
signedness), Lua tests (hex decode, parser), live tests; then the four views of Routine 1.

## 6. How to resume

- Read: AGENTS.md, TASK.md, this note, the research note. Take the Steam lock before anything that drives or restarts Steam
  (`node steam-lock.mjs acquire --owner <id> --purpose "..."`; release after). Deploy: `powershell -ExecutionPolicy Bypass -File dev.ps1`
  in `steam-cartridges` (restarts Steam; a backend change needs it).
- The watcher (elevated PowerShell, `cd C:\game\millennium\steam-cartridges`):
  `node tests/live/probes/unlock_watcher.mjs --steam [--mute-epic-overlay] [--simulate <appid>] [--for <s>]`; F8 marks the moment you see a
  toast; `node tests/live/probes/unlock_report.mjs` prints the events around each unlock; `node tests/live/probes/epic_overlay.mjs
  status|mute|restore` undoes a stuck mute. Logs: `scratch/unlock-watch-*.jsonl` (UTC; `scratch/` is untracked).
- Time zone: the user is UTC-3.
- Pitfalls met: shell and Python escaping of backslashes mangled Lua and JS strings several times (write patch scripts to a file, check
  `\\` in Lua after editing); `WebFetch` gets 403 from some sites; the Epic command line carries a live exchange code (never log
  or commit it); `RemoveShortcut` in a test leaves the game unadded until a restart; shortcut appids are not stable across a re-add.
- Unit tests: `cd steam-cartridges; npx tsc --noEmit; npm run test:ts; $env:NSGA_STEAM_ROOT='C:/game/steam'; npm run test:lua`.
