# Plan: make Steam track Epic and Xbox games (launch tracking, drop-with-the-game, UWP) (investigation, then decision, then build)

**Status:** investigation plan, written 2026-10-03; **no code before the decision in § 8**. **Audience:** an agent that can run
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
| F7 | Xbox UWP games are started by COM activation: `Minesweeper.exe -ServerName:App...mca`, parent `svchost` (DcomLaunch, pid 1624 in the logs); their exe cannot be run directly from `WindowsApps`. Manifest `EntryPoint` is an app class. Our shortcut runs `explorer.exe shell:AppsFolder\<PFN>!App`. | watcher logs; AppxManifest |
| F8 | Fortress Merge is GDK: `MicrosoftGame.config`, manifest executable `GameLaunchHelper.exe`, `EntryPoint="Windows.FullTrustApplication"`; its package root `C:\Program Files\WindowsApps\QubicGames.FortressMerge_...` is a link to `C:\game\gamepass\Fortress Merge\Content\` which holds `Fortress Merge.exe`. | PowerShell listing |
| F9 | `csc.exe` (.NET Framework 4, `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`) exists on every Windows 10/11: a small exe can be compiled on the user's PC. | file listing |
| F10 | Outside sources: SteamedPass (MIT) activates Store apps through `IApplicationActivationManager` and blocks until the game exits (shortcut Exe = its own exe with the AUMID as arguments); steamRecord-for-nonSteam-games (C#, no licence) is a wrapper that starts the game as a child and stays alive, "recording attaches to the persistent parent session", no overlay; WSGM (GPLv3) injects the overlay into packaged Xbox games (ban risk); SISR (GPLv3, Go) and GlosSI (Apache-2.0, archived) give the overlay with a transparent topmost window the shortcut's own process owns, not by launching the game. Do not copy GPL code. | handoff § 2.3, § 4b |
| F11 | The unlock to Steam-toast path works (Xbox 1.0 s, Epic 4.3 s) but the toast is a desktop popup until the game is in the overlay's reach. | research note |

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

| Exp | Date | Result | Evidence |
| --- | --- | --- | --- |
| E0 | | | |
| E1 | | | |
| E2 | | | |
| E3 | | | |
| E4 | | | |
| E5 | | | |
| E6 | | | |
| E7 | | | |

Then write a verdict per option of § 4 (works, works with limits, fails, and the reason) and a recommendation, in this section, before asking for the decision.

## 8. Decisions for the user (ask after § 7, with the recommendation)

1. Ship **R** now (P2 only, no new file) or wait for **W**? Recommendation: R first, it is small and answers the stated priority.
2. Accept ending the Epic launcher by force when no download is pending, as a default-on setting (Epic has no exit switch)? Or keep it manual (K)?
3. Compile and run a plugin-built exe (W, U1, C)? It is a new kind of artifact for a Millennium plugin (antivirus, updates): yes or no, per route.
4. UWP: running state and playtime only (U1), or also the overlay carrier (C) if the tree route (U2) fails?
5. GDK: direct exe when it passes E5.
6. New shortcuts only (a different Exe changes the appid), or offer a "convert this shortcut" button (never silent), tied to decision D1/D2 of the handoff?

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
