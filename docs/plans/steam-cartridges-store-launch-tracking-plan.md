# Plan: make Steam track Epic and Xbox games (launch tracking, drop-with-the-game, UWP) (investigation, then decision, then build)

**Status:** investigation **done 2026-10-03 21:21-22:05** (§ 7: results, verdicts, recommendation, the reaper design); Play interception E8 22:47; **the user answered § 8 A-D (2026-10-03),
E (and the confirmations in it) is open; no product code before the build plan**. **Audience:** an agent that can run
experiments on the live Steam client (Routine 0, the Steam lock) and write findings back into this file. **Owner of the decisions:** the
user. **Context in one paragraph:** steam-cartridges adds installed Epic and Xbox games as shortcuts. Steam launches the shortcut's exe and
tracks that process **and its descendants** (verified, § 2). For Epic the exe is the launcher; for Xbox it is Explorer. When the game is not a
descendant, Steam cannot show its overlay (so no in-game toast, no Shift+Tab), has no recording timeline for it (enhanced-notifications logs
`no-running-timeline`, so no unlock screenshot or clip) and cannot focus it in Big Picture. Read first:
[the handoff](steam-cartridges-store-games-handoff.md) (state, decisions D1-D8, § 4 to 4d) and
[the unlock-detection research](steam-cartridges-store-unlock-detection-research.md).

## 1. Goal and requirements (the user's, 2026-10-03)

1. **Epic:** the game runs inside Steam's process tree so the Steam overlay works (done by hand with the dashed link, § 2), **and when the game is dropped
   (exits) the Epic launcher is dropped too**, so Steam stops showing the entry as running. Today Jotunnslayer still shows as running after the game
   exited, because the launcher lingers.
2. The launcher must not need to be closed by hand before launching (today it must).
3. **UWP Xbox games** (Minesweeper, Sudoku, Wordament: COM-activated, not Steam's children): find what, if anything, gives Steam a running state, playtime, a recording timeline,
   and ideally the overlay. The user's observation: the Epic shortcut's target stays the launcher, yet the overlay works, so **the shortcut's exe need not be the
   renderer; the renderer only has to be in the tracked tree**. Can a UWP game be put in a tree Steam tracks?
4. **GDK Xbox games** (Fortress Merge): decide direct exe or wrapper.
5. Must not duplicate shortcuts (matching, § 4), must not edit an existing user shortcut, must keep the unlock detection working (it needs the launcher's
   login: the game must still be started with the launcher's exchange code).

## 2. Verified facts (evidence you can re-read; do not re-derive)

| # | Fact | Evidence |
| --- | --- | --- |
| F1 | Steam tracks a launched shortcut by its **process tree**. For Jotunnslayer (appid 4202674849, game id 18050351032210292736) with the Epic launcher closed first and the dashed link, `C:\game\steam\logs\gameprocess_log.txt` (2026-10-03 21:00:53-21:01:41) lists, as tracked processes of that id: `EpicGamesLauncher.exe -com.epicgames.launcher://apps/...`, its `-forwarduri -silent` instance, `EOSBootStrapper.exe`, launcher web helpers, `EOSOverlayRenderer-Win64-Shipping.exe`, then `Jotunnslayer.exe -AUTH_LOGIN=unused -AUTH_PASSWORD=<exchange code> -AUTH_TYPE=exchangecode -epicapp=... -EpicPortal ...` and `UnityCrashHandler64.exe`. The user saw the Steam overlay. | gameprocess_log; the user |
| F2 | The shortcut's Exe stays `EpicGamesLauncher.exe`. The overlay works anyway. | `shortcuts.vdf`; the user |
| F3 | Without the dash, or with the launcher already running, the launcher only forwards the link; the game's parent is the running launcher (pid in the watcher's `process+` rows, e.g. `BURIED STARS.exe` parent 15128) and is **not** tracked. enhanced-notifications then logs `Unlock captures skipped for appid ...: no-running-timeline`. | unlock_watcher logs; webhelper_js.txt |
| F4 | After the game exits Steam keeps tracking the launcher (and its helpers) until they exit: the entry shows as running. Observed 2026-10-03 21:02 (launcher pid 30812, started by `EOSBootStrapper` inside the chain, alive after the game's exit at 21:01:41). Steam logs `no longer tracking PID n` per process; the app leaves the running list only when none is left. | gameprocess_log |
| F5 | The launcher writes `LogCloudSync: Cloud Sync: Upload Complete <namespace>:<item>:<AppName>` to `%LOCALAPPDATA%\EpicGamesLauncher\Saved\Logs\EpicGamesLauncher.log` about 5 s after the game exits (21:01:46 after 21:01:41). A pending download shows as a non-empty `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\Pending\` or a manifest with `bIsIncompleteInstall: true`. | the launcher log |
| F6 | Epic launches the game with a **single-use exchange code** in `-AUTH_PASSWORD`; only the launcher can mint it. A game started by its exe alone lacks it (EOS login, achievements and the EOS overlay may not work). BURIED STARS' shortcut currently runs the exe directly (changed by hand): its behaviour is unverified. | the process command lines; `shortcuts.vdf` |
| F7 | Xbox UWP games are started by COM activation: `Minesweeper.exe -ServerName:App...mca`, parent `svchost` (DcomLaunch, pid 1624 in the logs). Manifest `EntryPoint` is an app class. Our shortcut runs `explorer.exe shell:AppsFolder\<PFN>!App`. **Corrected by F16:** the exe *can* be started from `WindowsApps`, but Windows then activates it the same way. | watcher logs; AppxManifest |
| F8 | Fortress Merge is GDK: `MicrosoftGame.config`, manifest executable `GameLaunchHelper.exe`, `EntryPoint="Windows.FullTrustApplication"`; its package root `C:\Program Files\WindowsApps\QubicGames.FortressMerge_...` is a link to `C:\game\gamepass\Fortress Merge\Content\` which holds `Fortress Merge.exe`. | PowerShell listing |
| F9 | `csc.exe` (.NET Framework 4, `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`) exists on every Windows 10/11: a small exe can be compiled on the user's PC. | file listing |
| F10 | Outside sources: SteamedPass (MIT) activates Store apps through `IApplicationActivationManager` and blocks until the game exits (shortcut Exe = its own exe with the AUMID as arguments); steamRecord-for-nonSteam-games (C#, no licence) is a wrapper that starts the game as a child and stays alive, "recording attaches to the persistent parent session", no overlay; WSGM (GPLv3) injects the overlay into packaged Xbox games (ban risk); SISR (GPLv3, Go) and GlosSI (Apache-2.0, archived) give the overlay with a transparent topmost window the shortcut's own process owns, not by launching the game. Do not copy GPL code. | handoff § 2.3, § 4b |
| F11 | The unlock to Steam-toast path works (Xbox 1.0 s, Epic 4.3 s) but the toast is a desktop popup until the game is in the overlay's reach. | research note |
| F12 | **Steam tracks processes created *by* a tracked process** (also grandchildren, also after their parent exits), not by job object and not by parent pid alone. Tracked: a plain child, a `CREATE_BREAKAWAY_FROM_JOB` child (outside Steam's job), a `ShellExecute` child, a process started through `cmd /c start` (an orphan once cmd exits). Not tracked: what the shell's Explorer opens for us, a WMI-created process, and a packaged helper whose parent pid **is** our tracked process but which Windows' activation service created (E5). The Steam-started process is in a job (`IsProcessInJob` true). | E0, E5c (§ 7) |
| F13 | `gameprocess_log.txt` writes `no longer tracking PID n` lines **in a batch when the app leaves the running list**, not when each process exits (E0: the root exited 21:30:25, logged 21:31:57). Use `Remove <id> from running list` for timing, and the console log line `Game process removed`. | E0 |
| F14 | **Objective overlay check:** `C:\game\steam\logs\console_log.txt` writes `GameOverlay: started '...gameoverlayui64.exe' (pid n) for game process <pid>` when Steam's overlay attaches to a rendering process. An in-game toast for a focused hooked game opens a CDP target `notificationtoasts_uid<appid>-<n>`; a desktop toast opens `notificationtoasts_<n>_desktop`. | E1, E2, E6 control |
| F15 | A Steam **timeline** (`BIsTimelineRunning`) exists for every running shortcut, whatever its process tree: `no-running-timeline` only means "Steam shows no running app for this shortcut". **Recording** (`m_runningRecording`) starts only for a hooked process: `g_GRS.StartRecording(gameid)` gave `rec: true` for Jotunnslayer in the tree and for the carrier, `rec: false` for the activated Minesweeper and Fortress Merge. On this PC `gamerecording_background_mode` is **2 = Manual** (enum 0 Never, 1 Always, 2 Manual; module `50396` `rI/i0/p8`), so captures also need the user's recording on. | E1-E6 |
| F16 | `CreateProcess` of a UWP exe in `WindowsApps` (no attributes) succeeds: Windows starts **`SystemUWPLauncher.exe`** as the caller's child, which activates the app (game parent stays svchost/DcomLaunch) and **exits within 1 s of the game**. A shortcut whose Exe is that path therefore gives Steam a running app that lives exactly as long as the game. | E4b, E3c |
| F17 | `PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME` (0x20008) is refused for a normal caller: `CreateProcess` error **575** for `Minesweeper.exe`, `GameLaunchHelper.exe` and `Fortress Merge.exe`; with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` (the PFN's AppContainer SID) error **87**. | E4 |
| F18 | Fortress Merge (GDK) started by its exe or its `gamelaunchhelper.exe` from the library folder **relaunches itself through package activation**: the Steam-started process exits within 2 s and the game runs with package identity under a new `gamelaunchhelper` from the `WindowsApps` path, outside the tree. Its image path resolves to `C:\game\gamepass\Fortress Merge\Content\` (the package root is a link). `IApplicationActivationManager` with `QubicGames.FortressMerge_e3x7kyz1wvfw4!Game` works (hr 0). | E5 |
| F19 | Steam's **Stop** (`SteamClient.Apps.TerminateApp(gameid, false)`, as Steam's own button calls it) ends the shortcut's root process (exit code 1, about 7 s after the request) and asks the game to close; it does **not** end processes outside the tree, and it left the Epic launcher alive once a wrapper sat between Steam and it. The first Stop request of one run did nothing visible (nothing logged); the second worked. `SteamClient.Settings.SetEnableSoftProcessKill` exists (not tried). | E2b, E3b, E3d |
| F20 | Neither Millennium nor `SteamClient` can re-target Steam's tracking or overlay: Millennium's hooks rewrite the JavaScript Steam serves, its Lua `utils` offers `exec`, files and env, its config API stores plugin preferences, the TS `Millennium` object has window hooks and RPC; no `SteamClient.*` call adds a pid to a running app or attaches the overlay to a process (probed: `Overlay.*` drive the overlay's browser windows, `Apps.LaunchNonSteamApp` launches). Tracking (`Game process added`) and overlay injection (`GameOverlayRenderer64.dll`) are native code in `steam.exe`. | docs.steambrew.app (hooking, config, lua/utils, ts/Millennium), live probe |

## 3. Problems, and what each option has to solve

| # | Problem | Needs |
| --- | --- | --- |
| P1 | Epic launcher must be fully closed before the shortcut runs | a pre-launch step, or accept the manual rule |
| P2 | Epic entry keeps running after the game exits (**the user's priority**) | end the launcher (and helpers) when the game is gone, after cloud sync, so Steam sees every tracked process end |
| P3 | UWP games are outside any tree Steam tracks | a way to give Steam a running parent, and/or to place the game under one |
| P4 | GDK games | direct exe, or the same as UWP |
| P5 | A new shortcut Exe or arguments change the shortcut appid and the matching rules | matching of every legacy and new form, no duplicates |
| P6 | In-game toast for games Steam cannot hook | the overlay carrier (decision D8), only if P3 has no tree answer |

## 4. Options to evaluate (each ends with a measured verdict in § 7)

- **R. Launcher reaper, no new exe (answers P2 only).** The plugin already learns of a launch (`shortcut.launched`, `sensors/lifecycle`). For an Epic copy it then, in the
  backend and only while that game runs, checks the local process list every 3 s for any image under the game's `InstallLocation`; when none has existed for 5 s it waits for the F5
  line (cap 30 s) and refuses if F5's pending-download test is true, then ends the launcher and its helpers (`taskkill /T` of the launcher image started inside Steam's chain, i.e. the
  tracked pids from F1). Nothing runs on a timer while no store game runs (ADR-0007 spirit). **Does not fix P1.** Cheapest, ship-able first.
- **W. Wrapper exe, Epic mode (P1 and P2).** A C# program compiled by the plugin with `csc` (F9). Steam starts it; it closes a running launcher (guarded by F5's pending test),
  starts the launcher with the dashed link as its child, waits for the game, then does R's wait-and-close, and exits. Tree: Steam, wrapper, launcher, game. New file kind for the plugin
  (compile on demand into the data folder, unsigned exe). Changes the shortcut Exe (P5).
- **U1. Wrapper, UWP activation (P3, partly).** `IApplicationActivationManager.ActivateApplication(aumid, null, 0, out pid)` then wait on `pid`: gives Steam a running state, playtime, Stop.
  Expected: not the overlay (the game is not a child). Measure the recording timeline (`window.g_GRS.m_mapActiveTimelines`) and whether enhanced-notifications' captures still say
  `no-running-timeline`.
- **U2. Put the UWP game into the tree (P3).** Test whether the process can be created as the wrapper's **child** with the package's identity:
  `CreateProcess` with `PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME` (Windows 10 2004 and later) on the package's exe. Works for packaged Win32/GDK exes; for AppContainer UWP apps expect failure:
  record the exact error. Also test whether Steam tracks a process that **Explorer or the Shell** starts for the wrapper (`ShellExecute`), and whether Steam's tracking
  follows a **Windows job object** or only the parent-child chain (start a harmless exe both ways and read `gameprocess_log.txt`).
- **G. GDK direct exe (P4).** Shortcut Exe = `C:\game\gamepass\<Game>\Content\<Game>.exe` (the config's `Executable`, try `GameLaunchHelper.exe` too). Check: it starts, Xbox sign-in and
  achievements work (a real unlock: the Windows push should still arrive), the game is in the tree, the overlay shows.
- **C. Overlay carrier (P6).** The wrapper also opens a transparent topmost window with a graphics swap chain (OpenGL by P/Invoke) so Steam's overlay hooks it (SISR/GlosSI method). Only
  if U2 fails. Measure: overlay and posted toast over a borderless game, F12, Steam's recording, Big Picture focus; known limit: exclusive fullscreen.
- **K. Keep the manual rule (P1).** Document "close the Epic launcher first" in the settings text; ship R for P2. The baseline to beat.
- **U0. UWP exe as the shortcut's Exe, no program of ours (P3, partly; added during the investigation, F16).** Exe = `C:\Program Files\WindowsApps\<PackageFullName>\<Executable>`;
  Windows' `SystemUWPLauncher` becomes Steam's child and lives as long as the game. Same expected gains and limits as U1, plus: the path carries the package version.
- **P. Intercept Steam's Play (P1 without an exe; added 2026-10-03 after the first § 7 pass).** `SteamClient.Apps.RunGame` is an own, writable, configurable
  property, and Steam's Play paths call it by lookup at call time (module `5808`, the library Play action, with the Big Picture branch in the same function;
  module `59718`, the game list). A surface wraps it: for an Epic launcher-link copy it holds the launch, the backend closes a running launcher (never with a
  download pending), then Steam's original runs. Launches that bypass Steam's UI (a desktop shortcut, a `steam://rungameid` link) are not seen.
- **T. Trick Steam itself (the user's question, 2026-10-03).** Re-target Steam's process tracking or its overlay through Millennium hooks or `SteamClient` APIs, so a game
  Steam did not start counts as the shortcut's renderer.

## 5. Preconditions (run before step 1; every line must hold)

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- steam-cartridges docs/plans` | prints nothing you did not make (other agents' work may show: leave it) |
| P2 | `node steam-lock.mjs status` | `free` (else wait: Routine 0) |
| P3 | `node steam-health.mjs` | `PASS  Steam UI is up and every enabled plugin loaded` |
| P4 | `cd steam-cartridges; npx tsc --noEmit; $LASTEXITCODE` | `0` |
| P5 | `cd steam-cartridges; npm run test:ts 2>&1 \| Select-String '^ℹ (pass\|fail)'` | `ℹ pass 295`, `ℹ fail 0` |
| P6 | `cd steam-cartridges; $env:NSGA_STEAM_ROOT='C:/game/steam'; npm run test:lua *> $env:TEMP\lua0.txt; (Select-String -Path $env:TEMP\lua0.txt -Pattern 'ALL PASS').Count` | `11` |

If a count differs, another change landed since this was written: note it and continue only if the failing area is unrelated.

## 6. Experiments, in order (each: do, observe, record in § 7)

Take the Steam lock for the whole sequence (`node steam-lock.mjs acquire --owner launch-track-<time> --purpose "launch tracking experiments"`). Use test shortcuts you create and remove
yourself (`SteamClient.Apps.AddShortcut`, `SetShortcutName`, `SetShortcutLaunchOptions`, `RemoveShortcut`); never edit the user's existing shortcuts. To read what Steam tracks:
`Get-Content C:\game\steam\logs\gameprocess_log.txt -Tail 60` (`adding PID n as a tracked process`, `no longer tracking PID n`, `Remove <id> from running list`). The game id of a shortcut is
`(appid << 32) | 0x02000000` (AGENTS.md); the log prints it unsigned. To read the recording state: in SharedJSContext `window.g_GRS.m_mapActiveTimelines` (keys are game ids) and the
enhanced-notifications line `Unlock captures skipped ... no-running-timeline` in `C:\game\steam\logs\webhelper_js.txt`. The watcher
(`steam-cartridges/tests/live/probes/unlock_watcher.mjs`, handoff § 6) logs process starts with parents (`process+ ... ppid`).

1. **E0 tracking rules (U2, no game).** Write a tiny exe or script that starts `notepad.exe` three ways (child via `CreateProcess`, via `ShellExecute`, via COM/Explorer) while Steam runs it as a
   shortcut; record which notepads appear as `adding PID` lines. Expected to learn: tree-only, or also shell- or job-started processes.
2. **E1 reaper (R) on Jotunnslayer.** Prototype the logic as a script first (read-only until it decides): launch from Steam with the launcher closed, let the game run 30 s, quit the game, and
   record the times: game exit, F5 line, the decision, the launcher kill, the last `no longer tracking`, `Remove ... from running list`. Pass: the entry stops running within 40 s of the game's exit
   and Epic's cloud sync completed (compare with the launcher log).
3. **E2 wrapper Epic mode (W).** Compile a minimal wrapper with `csc /target:winexe`, make a test shortcut for Jotunnslayer, run with the launcher (a) closed, (b) open and idle, (c) open with a
   download pending (it must refuse to kill). Check the tree in `gameprocess_log.txt`, the overlay, a posted toast (`unlock_watcher.mjs --steam --simulate <appid>`), the running state after exit.
   Also: Steam's Stop button (does it end the game and the launcher?) and a game that never starts (the 3-minute timeout, the exit code).
4. **E3 UWP activation (U1) on Minesweeper.** Wrapper test shortcut: activate, wait on the pid. Record: pid returned, running state, playtime counted, Stop button, timeline present or not,
   captures after a real unlock (the push watcher), the overlay (expected absent).
5. **E4 UWP in the tree (U2).** Try `CreateProcess` with `PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME` for Minesweeper, Sudoku, Wordament (UWP) and Fortress Merge (GDK). Record the exact Win32 error or the
   parent pid of the new process and whether Steam tracks it (E0's lessons apply).
6. **E5 GDK direct (G) on Fortress Merge.** As in § 4 G. A throwaway shortcut only.
7. **E6 carrier (C), only if E4 failed for UWP.** A transparent topmost OpenGL window in the wrapper: overlay, toast, F12, recording, Big Picture focus over a borderless game; note exclusive fullscreen.
8. **E7 matching (P5).** For every shortcut form the plan would write and every legacy form (launcher link without and with dash, wrapper with `--app`/`--aumid`, `shell:AppsFolder`, the direct exe), run
   `store_service.detect` (Lua, hermetic, as `tests/test_store.lua` does) and `installed_games` and show no game is listed twice or marked missing.

## 7. Results (fill in; one row per experiment, with the evidence line or file)

Run 2026-10-03 21:21-22:05 (local, UTC-3) under the Steam lock (`lt-inv-2126`), preconditions P1-P6 all as expected (tsc 0, TS 295/0, Lua 11 ALL PASS).
Every run used throwaway `LT-*` shortcuts (removed afterwards; `shortcuts.vdf` and `store_copies.json` hold none); the user's shortcuts were not run or edited.
Tools: a probe program compiled with `csc` (modes `e0`, `reap`, `epic`, `uwp`, `pkg`, `carrier`) and a CDP driver, kept in
[`steam-cartridges/tests/live/probes/launch_tracking/`](../../steam-cartridges/tests/live/probes/launch_tracking/) (how to build and run: the header of `ltprobe.cs`). Times are Steam's logs unless noted.

| Exp | Date | Result | Evidence |
| --- | --- | --- | --- |
| E0 | 2026-10-03 21:29 | **Tracking follows "created by a tracked process", not the job** (F12). Of six ways to start a copy: child, breakaway-from-job child, `ShellExecute` child and `cmd /c start` orphan **tracked**; the exe Explorer opened (parent = the shell's Explorer 6652) and the WMI one (parent WmiPrvSE 5668) **not tracked**. The entry ran until the last tracked child exited (21:31:55), 92 s after the Steam-started process (21:30:25). Exit lines are batched (F13). | `gameprocess_log.txt` 21:29:25 `adding PID 2256 / 16616 / 30744 / 28388 / 30456 / 16944`, none for 21800 or 14804; 21:31:57 `Remove -590945955 from running list`; probe log `inJob=False` for the breakaway child |
| E1 | 2026-10-03 21:33, again 22:01 | **R passes.** Launcher closed first, dashed link, reaper outside Steam: game closed 21:34:07, Epic's `Cloud Sync: Upload Complete ...:05cc0386...` 21:34:13.164 (+6 s), reaper ended launcher tree #5788 at 21:34:13.546 (8 processes), **entry left the running list 21:34:15 (+8 s)**. Second sample: game 22:02:26, sync 22:02:36.196 (+10 s), entry ended by 22:02:39 (+13 s). The overlay attached to the game (21:33:38). | `gameprocess_log.txt` `Remove -762706425 from running list` 21:34:15; `console_log.txt` `GameOverlay: started ... for game process 30844`; launcher log `[2026.10.04-00.34.13:164]...Cloud Sync: Upload Complete`; probe log `reap` lines |
| E2 | 2026-10-03 21:36-21:46 | **W works, with two defects.** (a) launcher closed: tree Steam > wrapper > launcher > game, **overlay attached to the game** (21:36:42), entry ended 21:37:19, 8 s after the game. (b) launcher already open (started outside Steam 21:38:34): wrapper ended its tree, started its own, game in the tree, overlay 21:39:10. **Steam's Stop:** the first request (21:39:37) did nothing; the second (21:41:50) closed the game (exit 0) and terminated the wrapper, but the **launcher survived and kept the entry running** until ended by hand (21:42:47). (c) pending download (simulated: `--manifests` pointed at a copy with a `Pending` entry, Epic's own files untouched): wrapper **refused to close** the open launcher and to end it after the game (rc 3); game outside the tree (parent = the open launcher, no overlay line), yet the entry ended with the game (21:44:15, +10 s) because the wrapper waited. (d) game never starts (bogus link, 25 s timeout): wrapper exited 2, the **launcher it started kept the entry running**. | probe log (`epic` lines); `gameprocess_log.txt` `Remove -1663328877` 21:37:19, 21:42:47, 21:44:15, 21:46:33; `console_log.txt` overlay lines for 32096 and 16700 |
| E3 | 2026-10-03 21:47-21:52 | **U1 works with limits (UWP).** `ActivateApplication(Microsoft.MicrosoftMinesweeper_8wekyb3d8bbwe!App)` hr 0, returns the game's pid (parent svchost 1624). Running state and a **running timeline** while the game runs; entry ended 4 s after the game. No overlay line. **Recording does not start** (`StartRecording` accepted, `rec: false`; in the tree it gives `rec: true`, E6 control). **Stop** terminated the wrapper (exit 1, 7 s) and ended the entry, but **Minesweeper kept running**. **U0** (Exe = `Minesweeper.exe` in `WindowsApps`, F16): the same in every point (timeline, ends 2 s after the game, Stop leaves the game), with no program of ours. | probe log `ActivateApplication hr=0x00000000 pid=20044 ppid(of game)=1624`; `Remove -1255104574` 21:47:46, 21:48:54; U0 `adding PID 20128 ... Minesweeper.exe`, `Remove -1579930223` 21:51:38, 21:52:14 |
| E4 | 2026-10-03 21:49-21:50 | **U2 fails.** `CreateProcess` + `PROC_THREAD_ATTRIBUTE_PACKAGE_FULL_NAME`: error **575** for Minesweeper (UWP), `GameLaunchHelper.exe` and `Fortress Merge.exe` (GDK); + the AppContainer attribute: error **87**; the `-ServerName` + activate variant never got a process. Plain `CreateProcess` of the UWP exe gives `SystemUWPLauncher` (F16, which became U0). And even a packaged process whose parent pid is ours is not tracked (E5c, F12), so no tree route exists for packaged games. | probe log `CreateProcess(Minesweeper.exe, full=True, appcontainer=False) ok=False err=575`, `... appcontainer=True) ok=False err=87`, `child after 3 s: alive SystemUWPLauncher.exe` |
| E5 | 2026-10-03 21:53-21:58 | **G fails for Fortress Merge** (F18): from `Content\Fortress Merge.exe` or `Content\gamelaunchhelper.exe` Steam's process exits within 2 s and the entry leaves the running list; the game relaunches with package identity, outside the tree, and talks to Xbox Live (`userpresence`/`xsts.auth.xboxlive.com` in the DNS cache), no overlay line. **U1 works for GDK**: running state and timeline 21:57:20 until 6 s after the game (needs the resolved `Content` folder as the game's root, the package root is a link). Achievements were not unlocked in these runs. | `Remove -307804630` 21:53:19, `Remove -2089186894` 21:54:43, `Remove -1519204096` 21:57:58; `pkgof` `package=QubicGames.FortressMerge_1.0.11.0_x64__e3x7kyz1wvfw4 ppid=11676` |
| E6 | 2026-10-03 22:00-22:03 | **C: the overlay attaches, the toast does not reach it.** A transparent, click-through, never-activated topmost OpenGL window in the wrapper: Steam's overlay **attached to the carrier** 1 s after start (no such line without it). A test toast (`NotificationStore.TestAchievement(appid)`) still opened a **desktop** toast window, as without the carrier, because the foreground was Minesweeper's frame; the in-tree control (Jotunnslayer focused) opened the in-game window `notificationtoasts_uid2342770011-10015`. Recording starts on the carrier (`rec: true`), so it would record the carrier's empty frames, not the game (not verified: no clip saved). F12 and Big Picture focus not run: F12 goes to the focused, unhooked game; Big Picture would take over the user's screen. Exclusive fullscreen cannot be covered by a window. | `console_log.txt` 22:00:33 `GameOverlay: started ... for game process 18352` (the carrier); CDP targets after the toast: `notificationtoasts_..._desktop` (carrier, baseline) vs `notificationtoasts_uid...` (control) |
| E7 | 2026-10-03 22:04 | **Matching:** every legacy form and the new dashed link match; `installed_games` lists each Epic game once. **Not matched (would be added again by auto-add):** wrapper with `--app` only, wrapper with `--aumid`, U0 after an app update (old version in the path), GDK direct exe (library folder behind the link), GDK wrapper with `--aumid`. A wrapper whose arguments carry `--link <dashed link>` (Epic) or `shell:AppsFolder\<PFN>!<App>` (Xbox) matches with no change to `match`. | hermetic Lua run over this PC's manifests (`e7_matching.lua`): 12 forms, 7 matched, 5 `NOT MATCHED`; `FAIL xbox Fortress Merge listed once and in the library` |

| E8 (P) | 2026-10-03 22:47 | **P passes.** Epic launcher opened outside Steam first (pid 29420, as from the tray); a temporary wrap of `RunGame` in SharedJSContext; **Steam's own Play button** clicked on an `LT-` shortcut's page (desktop). The wrap caught the launch 0.47 s after the click, the launcher was closed 0.24 s later (`taskkill /T`, run by the script in place of the backend), Steam's original `RunGame` ran: **hold 0.69 s** in all. The game ran in Steam's tree (parent = the Steam-started launcher 16748) and **the overlay attached to it**; after the game the reaper ended the launcher after Epic's cloud sync and the entry left the running list 8 s after the game. Not run: Big Picture's Play (same function, unverified live), launches from outside Steam's UI. | `e8_play.ps1`; `console_log.txt` 22:48:27 `GameOverlay: started ... for game process 20212`; `gameprocess_log.txt` 22:48:17 `+ 25688 EpicGamesLauncher.exe` ... `Remove -1755641712 from running list` 22:48:54; wrap removed (`RunGame` back to native) |

| E9 (shipped) | 2026-10-03 23:08 and 23:16 | **The shipped workaround (ADR-0057) passes**, twice, on the real Jotunnslayer shortcut with the setting on and the launcher opened first as from the tray, through Steam's own Play button and with no help from the test: the plugin logged "launcher closed before 4202674849 starts", the game ran under the Steam-started launcher with the overlay attached, and after the game the plugin logged "finished (synced)" and Steam dropped the entry 9-10 s after the game. Found and fixed between the two runs: a non-Epic shortcut waited out the 8 s cap when the backend was busy (a freshly opened page fetching metadata); now only the Epic launcher-link shortcuts are held (a plain shortcut started 0.74 s after Play on a fresh page) and the backend closes nothing for a request older than 3 s. `npm run test:live` 13/13. | `e9_product.ps1`; `console_log.txt` 23:16:39 `GameOverlay: started ... for game process 32148`; `gameprocess_log.txt` 23:17:13 `Remove -92292447 from running list`; webhelper_js `Epic overlay workaround:` lines |

| E10 (shipped) | 2026-10-04 00:21 | **U0 with the repair passes** on the user's converted Minesweeper shortcut: Steam's own Play started the game in 1.2 s (parent svchost, as expected), Steam showed it running with a timeline for the whole session and dropped it 2 s after the game ended; the shortcut pointed at an older version's folder was repointed by the plugin's next 60 s check (37 s), appid unchanged, one shortcut only (auto-add on). `npm run test:live` 13/13. | `e10_u0.ps1`; webhelper_js `Xbox shortcut "Microsoft Minesweeper" (2663546656) now runs the updated game.` |

### Verdicts

| Option | Verdict | Why (experiment) |
| --- | --- | --- |
| **R** reaper | **works** | Entry ends 8-13 s after the game, after Epic's cloud sync, overlay unaffected (E1 x2). Does not fix P1. Not tried with Steam's Stop, but it reacts to "game gone", which Stop produces (E2b), so it also clears the launcher Stop leaves behind. |
| **W** Epic wrapper | **works with limits** | Fixes P1 and P2 and keeps the overlay (E2a, E2b); refuses on a pending download (E2c). Defects to fix before use: Stop leaves the launcher (needs the launcher in a kill-on-close job, or R as a safety net); a game that never starts leaves the launcher (end the launcher it started). New artifact (a compiled exe), new Exe (new appid, P5). |
| **U1** UWP/GDK activation | **works with limits** | Running state, playtime, timeline, Stop ends the entry (E3, E5d). No overlay, no recording (so no screenshot or clip), desktop toasts; Stop leaves the game running (fixable: a hidden window that closes the game on Steam's soft close). New artifact. |
| **U0** UWP exe as Exe | **works with limits** | Same gains and limits as U1 with no program of ours (E3c-d). The path holds the package version, so an app update breaks the shortcut and its matching (E7); not usable for GDK (F18). |
| **U2** packaged child | **fails** | Error 575 / 87 (E4); activation-created children are not tracked (E5c). |
| **G** GDK direct exe | **fails** (Fortress Merge) | The game relaunches through activation; Steam loses it in 2 s (E5a-b). Other GDK games may differ; test per game before trusting it. |
| **C** overlay carrier | **fails for its purpose** | The overlay attaches but toasts go to the desktop unless the carrier is the focused window, and focusing it would take the game's input; recording would capture the carrier (E6). Big Picture and exclusive fullscreen unsolved. |
| **P** Play interception | **works** | Solves P1 with no exe and no new shortcut, keeps the overlay (E8). Limits: launches outside Steam's UI are not seen (then the K rule applies); Big Picture to verify. Closes the user's launcher at each Epic launch (same cost as W). |
| **K** manual rule | **works** (baseline) | With the dashed link and the launcher closed first, everything works in the tree (E1, E2a); the launcher lingers without R. |
| **T** trick Steam | **fails** (no API) | Nothing in Millennium or `SteamClient` touches native tracking or overlay injection (F20). The only levers left are native: injecting `GameOverlayRenderer64.dll` into the game (WSGM's way: anti-cheat ban risk, an AppContainer may not even load it) or patching `steam.exe`; both out of scope for a Millennium plugin. The carrier (C) is the legal form of the trick, and E6 shows its limit. |

### Recommendation (ranked)

1. **Epic: P + R** behind one setting (after E8; before it, the recommendation was R with K's sentence). No exe, no new shortcut; the in-tree route gives the
   overlay, in-game toasts and recording (E1, E6 control, E8), so TASK item 2 (captures on a real unlock) can be tested right after. Keep K's sentence for launches
   from outside Steam's UI.
2. **W only if P proves insufficient** (e.g. many launches from desktop shortcuts), with the two fixes above and R kept as the safety net.
3. **Xbox UWP and GDK: U1** if a plugin-compiled exe is accepted (version-proof, one route for both kinds), else **U0 for UWP only** (no exe, but an app update
   breaks the shortcut; the plugin would have to offer a new one). Both give the running state, playtime and a timeline; **neither gives the overlay, in-game
   toasts, screenshots or clips** (recording needs a hooked process, E3/E6). Say this in the settings text.
4. **D8 (overlay carrier): do not build C**; accept desktop toasts for Xbox games. **G**: do not use for Fortress Merge; keep the current route or U1. **T**: no.

### Design of the reaper (R), no code yet

- **Where:** a backend service `backend/store_reaper.lua` (owns no data; uses `silent_exec`), RPCs `store.reaper_check`; a frontend use case in `app/` started by
  `shortcut.launched` (sensor `sensors/lifecycle`) when `store_service.detect` says the shortcut is an **Epic copy launched through the launcher link** (not
  a direct exe), stopped by `shortcut.quit` or when the check answers `done`. It touches no Steam UI, so no surface. ADR-0007 spirit: nothing runs while no Epic game runs.
- **Loop (frontend tick every 3 s while active, backend does the work):** phase `waiting-game` (up to 180 s: the game's image, the manifest's
  `LaunchExecutable`, appears under `InstallLocation`); `running`; `gone` when no such process for 5 s; then wait for the launcher log line
  `Cloud Sync: Upload Complete <ns>:<item>:<AppName>` newer than the exit (cap 30 s; F5); then **refuse** if `Manifests\Pending` is not empty or a
  manifest has `bIsIncompleteInstall: true`; else end **only launcher processes started at or after the launch** (`taskkill /T /F /PID`; a launcher the
  user had open earlier is never touched, and with it the game is outside the tree anyway). Process list: `tasklist` by image name per tick (cheap);
  start times and paths read once, when deciding.
- **Setting:** "Close the Epic launcher when the game exits" in Third-party (default per § 8 Q2), a safety feature id and kill switch, and a log line per decision
  (never a command line: the game's carries an exchange code).
- **Tests:** Lua: the cloud-sync line parser (UTC timestamp, AppName match, older lines ignored); the pending test (empty folder, a `Pending` file, an incomplete
  manifest); the phase machine (game never seen: timeout, no kill; crash-handler restart within 5 s: still running; gone: sync seen; gone: no sync after the cap;
  pending: refuse); "started before the launch" launchers left alone; `taskkill` command built per pid. TS: the use case starts only for an Epic launcher-link copy,
  stops on `shortcut.quit`, stops on `done`, never runs for a direct-exe copy or an Xbox copy. Live: E1's sequence (entry ends within 40 s of the game, cloud sync
  logged first), Stop pressed during play (the launcher is still ended), a launcher already open before the launch (left alone), and Routine 1-3 of AGENTS.md.

## 8. Decisions for the user (ask after § 7, with the recommendation)

**The goal, restated by the user (2026-10-03): the Steam overlay on non-Steam games.** For Epic it works whenever the launcher is closed at Play, so P1
matters more than P2; for Xbox UWP and GDK no clean route exists (§ 7). **Answers so far (2026-10-03):**

| # | Decision | Answer |
| --- | --- | --- |
| A | Epic, launcher closed at Play | **P, Play interception**: **shipped** (ADR-0057; E8, E9) |
| B | Epic, launcher closed after the game | **R**, as an **"Epic Steam Overlay Workaround"** setting, **off by default**; on for our tests. **One setting turns on both P and R** (confirmed) |
| C | Xbox UWP | **No overlay; running state, playtime, timeline: U0, shipped 2026-10-04** with the auto-repair after app updates (ADR-0058; E10: Play gives the running state for the whole session, a simulated update repaired in 37 s) |
| D | Xbox GDK | **Same route as UWP**. U0 cannot serve GDK (F18), so one route for both means **U1** (a plugin-compiled exe), **or S** below: the user is weighing S |
| E | New shortcuts only, or a convert button | **Convert the existing store shortcuts in the user's library to the chosen format, and new games follow it** (the plugin is not released, so no playtime to protect) |

**S. SISR route for UWP (the user's proposal, 2026-10-03: a plugin or a steam-cartridges extension that generates SISR shortcuts for UWP games and runs SISR for them).**
What SISR's docs say (v0.6.1, `docs/guides/multi_configs.md`, `usage.md`, `getting-started/installation.md` in Alia5/SISR, GPL-3.0): a Steam shortcut to `SISR.exe --w --f`
per game gives per-game Steam Input and Steam overlay features in a transparent window; **SISR does not launch the game**; Windows Store games are the case where the
game is started *outside* SISR; and the tray menu row "Enable Steam Overlay" says it **"does currently also not work with UWP games"** (and never in exclusive
fullscreen). Install: `irm https://alia5.github.io/SISR/stable/install.ps1 | iex` puts SISR in `%LOCALAPPDATA%\SISR\`, VIIPER in `%LOCALAPPDATA%\VIIPER\`, installs
the USBIP-Win2 **kernel driver** and turns on Steam's CEF remote debugging. So for UWP, S gives **Steam Input** (controller layouts via an emulated pad), not the overlay,
matching E6. Shape if chosen: inside steam-cartridges (it needs the store-copy data and the shortcut writer; a separate plugin would need the unbuilt provider
contract), active only when SISR is found installed (never installed or bundled by us: driver, GPL); the game's shortcut runs SISR, the backend activates the game
on `shortcut.launched` (`shell:AppsFolder`, no exe of ours) and ends SISR when the game is gone (R's loop), so Steam's running state, playtime and timeline follow
the game, as U1. Matching: SISR's Exe names no game, so the plugin keeps its own appid-to-game map. To test before deciding (the user installs SISR): Minesweeper
through such a shortcut: controller input in the game, the overlay (expected absent), a test toast's window, running state, ending with the game.

The original questions, kept for the record:

1. Ship **R** now (P2 only, no new file) or wait for **W**? Recommendation: **R now** (E1: the entry ends 8-13 s after the game).
2. Accept ending the Epic launcher by force when the game is gone, Epic's cloud sync is logged and no download is pending, as a **default-on** setting (Epic has no
   exit switch)? Or default off? Recommendation: default on, with the K sentence ("close the launcher before starting") in the same panel.
3. Compile and run a plugin-built exe? It is a new kind of artifact for a Millennium plugin (antivirus, updates). Per route: **W** (Epic P1: no manual close),
   **U1** (Xbox running state, version-proof). C is not recommended (E6). Recommendation: not now for W; yes for U1 if you want Xbox playtime with the
   least breakage, else U0.
4. Xbox UWP: **U1** (our exe, survives app updates), **U0** (no exe, the shortcut breaks at each app update), or keep Explorer (no running state)? Either way:
   no overlay, no in-game toast, no screenshot or clip for Xbox games (E3, E6), so the toast stays a desktop toast (D8 = accept desktop toasts).
5. GDK (Fortress Merge): direct exe **failed** (E5). Same route as UWP (U1), or keep Explorer?
6. New shortcuts only (a different Exe changes the appid and loses playtime), or a "convert this shortcut" button (never silent), tied to D1/D2 of the handoff?
   (R needs no change of shortcut: it works with the existing dashed Epic shortcuts.)

## 9. After the decision: the build (not mechanical yet; write the patches only then)

Per chosen route: a service and sensor in steam-cartridges (the reaper belongs in a backend service started on `shortcut.launched`, ending on `shortcut.quit` or when the game's processes are gone), safety feature ids and
kill switches, settings rows, the matching changes of § 4 E7, an ADR amending ADR-0056 (and superseding decision 3 "no toast" if not done yet), unit tests (Lua for the reaper decision and the log-line parser, TS for the sensor),
live checks per route, docs (`service-store.md`, `surfaces.md`, `sensors.md`, `settings.md`). Then convert this plan into the mechanical form of [the plan standard](README.md) (patches, expected outputs, dry run).

## 10. Do-not-touch, banned actions, failure rule

- Do not touch: the user's existing shortcuts and collections (test shortcuts you create and remove are fine), `steam-cartridges/tests/architecture-allowlist.json`, anything another agent has uncommitted, Millennium's `config.json`.
- Banned: killing the Epic launcher while a download or install is pending (F5 test) or without the Steam lock; logging, printing or committing an `-AUTH_PASSWORD` value or any token (the process command lines carry a live exchange code: redact it); `git push --force`;
  `--no-verify`; `git add -A`; deploy or a Steam restart without the lock; editing the user's Epic or Xbox files; running the experiments on the user's screen while they test achievements (ask first).
- Failure rule: run a failing command at most twice; on the second failure stop, append the command, its output (30 lines) and the experiment id to `TASK.md` § Active failures & blockers, and exit.
- Commit: add only the paths you changed; **no `Co-Authored-By` or "Generated with" line** (AGENTS.md Routine 6).

## 11. Acceptance for the investigation

§ 7 filled with evidence for every experiment that could run (and a stated reason for any that could not), a verdict and recommendation per option, § 8 answered by the user, and the handoff's D6 and D8 updated to match.
