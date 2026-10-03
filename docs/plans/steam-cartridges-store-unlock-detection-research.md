# Research: seeing an Epic or Xbox unlock as it happens (ADR-0056 follow-up)

**Status:** research done for both stores (2026-10-03); no design committed yet. **Goal:** steam-cartridges notices a store
unlock within a second or two and tells enhanced-notifications as if Steam raised an achievement, so it can take a screenshot
or recording. **Tool:** `steam-cartridges/tests/live/probes/unlock_watcher.mjs` (+ `unlock_report.mjs`, `unlock_mark.mjs`).
Logs go to `scratch/unlock-watch-*.jsonl` (UTC); the user marks with F8, Enter or `unlock_mark.mjs`; the report also marks
each unlock at the store's own time.

## Xbox: Windows hands us the whole achievement (verified 2026-10-03 13:30 local, Microsoft Jigsaw)

Windows' own log `Microsoft-Windows-PushNotification-Platform/Operational` (enabled, circular 1 MB, **readable without admin**:
its access list includes interactive users) records every push it receives, with the payload as hex. Xbox sends each
achievement as a `wns/raw` push to the Xbox app's widgets (`Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.WidgetsApp`):

| Time (local) | What |
| --- | --- |
| 13:30:08.337 | `unlockTime` in the payload |
| 13:30:08.883 | `timestamp` in the payload |
| 13:30:08.934 | event 1225 "WNP Transport Layer received command: NFY ... payload: 0x..." (the push); 1010 "Raw Notification received"; 2033 "A raw notification has activated a background task" |
| +1.2 s to +2.3 s | `XboxGameBarWidgets.exe`, `GameBar.exe`, `GameBarFTServer.exe` start; Game Bar trace files appear |

The payload (after CRLF headers) is JSON: `service: "achievements"`, `xuid`, `titleId` (the same id the store copy records),
`titleName`, `achievementId`, `achievementName`, `achievementDescription`, `achievementIcon` (URL), `unlockTime`,
`gamerscore`, `rarityPercentage`, `rarityCategory`, `extendedInfoUrl`. **No toast window exists for the plugin to read:** the
unlock showed no new visible window, no UI Automation text, and only a `badge` row in the toast database. The Xbox API (the
plugin's poll) told us 5.3 s later.

Caveats: needs the Xbox app / Game Bar installed and the account signed in (Windows delivers the push to that app); a
console or another device's unlock sends the same push (filter by `titleId` of a local game); the log is circular, so a sensor
polls it (every second) and remembers the last `RecordId`. The game itself posted its own local toast 10 s earlier
("Processing of Local Notification has failed", Jigsaw's app id): not the achievement.

## Epic: only a trigger, the API names the achievement (verified 2026-10-03 13:09 local, Jotunnslayer)

Epic's overlay (EOS) draws the toast inside the game: no window, no toast-database row, no launcher log line. What is local
and deterministic:

- The store records the unlock (`unlocked_time`) at 13:09:42. The game process opens a new HTTPS connection to
  `api.epicgames.dev` in that second (found through the DNS cache, `Get-DnsClientCache`).
- `%LOCALAPPDATA%\Epic Games\EOSOverlay\` (note the folder name): a 178x178 animated GIF is written to
  `BrowserCache\2\Default\Cache\Cache_Data\f_<n>` at 13:09:42.4 (a generic toast asset: it is **not** the achievement icon,
  checked by md5 against the three unlocked icons); `cef.log` gets one `ffmpeg_common.cc ... Unsupported pixel format: -1` line
  per toast shown (13:09:43.2 and 13:09:46.6 for two trophies), and one at game launch. The overlay also fetches
  `api.epicgames.dev/epic/achievements/v1/public/achievements/product/<deployment>/locale/en` (visible in the cache index).
- So the local signal says "a toast was shown", not which achievement: ask the Epic API at 1.5 s for 20 s after a trigger
  (the watcher's burst) and diff the unlocked ids.

## Samples of 2026-10-03 17:55 (Xbox, Microsoft Sudoku) and 17:58 (Epic, BURIED STARS), UTC-3

**Xbox, three unlocks in one puzzle** (Good Start, Good Memory, Speed Demon; the store's unlock time 17:55:48.317 for all three).
The pushes reached Windows at 17:55:49.77 / .78 / .85 (1.5 s after the unlock), but the push watcher printed them at +2.4 s, +3.4 s
and +6.4 s: the platform delivers them one by one, about a second apart, and the event-driven PowerShell action added up to
0.9 s of its own. So "about 1 s" holds for the first push, not for a burst. The watcher found no Steam shortcut (Sudoku had none).
Reason, fixed the same day: Sudoku ships **no** `XboxServices.config` / `MicrosoftGame.config` (Minesweeper and Wordament do), only
the manifest protocol `xboxliveapp-<n>`; detection now accepts that, and the title id comes from the catalog by package name
(`Microsoft.MicrosoftSudoku_8wekyb3d8bbwe` is 1703086168, the push's `titleId`). Auto-add then added it within seconds of the restart,
its record shows 45 achievements, and the unlocked ids (2, 16, 17) are exactly the three pushed.

**Epic, one unlock** ("The Beginning", `NEW_ACHIEVEMENT_1_1`, the API's unlock time 17:58:48.000):

| Local time | What |
| --- | --- |
| 17:57:47 | the launcher starts the game; one `cef.log` ffmpeg line (the launch toast) |
| 17:57:53 | the game's one connection to `api.epicgames.dev` (**at launch only**: it did not recur at the unlock) |
| 17:58:48.97 | `EOSOverlayRenderer` opens new connections (about 1 s after the unlock) |
| 17:58:49.17 | `cef.log` ffmpeg line "Unsupported pixel format" (the toast being drawn; the timestamp is inside the line) |
| 17:58:59 | the file watcher sees `cef.log` grow: the overlay **buffers** its log and wrote it 10 s late, with its shutdown line |

So of the Epic triggers: the overlay renderer's new connections are timely (about 1 s); `cef.log` is late (read the timestamp in each
line instead of the file's write time); the game's `api.epicgames.dev` connection is a launch event, not an unlock one. The API
polling in that run sat in `status: error` for the whole run (the first lookup of the new game's store product failed and was
never repeated), so no API unlock was seen; the watcher now asks for the store part again until it answers, picks up shortcuts
added while it runs, and treats the renderer's connections as a trigger.

## First end-to-end runs: unlock to Steam toast (2026-10-03 18:13 and 18:15, `--steam`, both verified on screen by the user)

| | Xbox, Microsoft Minesweeper "Happens to Everybody" | Epic, BURIED STARS "Basics of Conversation" |
| --- | --- | --- |
| Detected by | Windows push log (event-driven watcher) | overlay renderer's new connections (+1.3 s), then the API burst |
| Unlock to detection | 0.94 s | 4.3 s (the API showed the unlock on its third check; Epic's own propagation is part of it) |
| Detection to post | 0.04 s | 0 s |
| Post to Steam showing the toast | 6 ms | 1 ms |
| **Unlock to Steam toast** | **1.0 s** | **4.3 s** |
| What the plugin's own API poll alone would have given | 5 s | up to 10 s (its periodic poll) |

enhanced-notifications received both as real unlocks, but its captures were skipped for both: `Unlock captures skipped for appid ...:
no-running-timeline`. Neither game was running under Steam's recording (not started from the Steam shortcut, or Steam has no timeline
for a launcher-started game): open check 8 of the list below. Epic's polling floor can be lowered by checking every 0.5 s during
the burst (a faster burst), at more requests to Epic; the 1.3 s trigger leaves about 3 s that only Epic's side explains.

## Posting the unlock to Steam as a native toast (verified 2026-10-03, `--steam --simulate`)

`NotificationStore.OnNotification(id, achievementType, protobuf)` with the store's real achievement id is Steam's own toast
(the call enhanced-notifications uses for its previews). Measured with a simulated unlock (Microsoft Jigsaw's shortcut):
the CDP call took 9 ms and Steam showed the toast (its sound handler ran) **183 ms** after the call. enhanced-notifications
treated it as a real unlock (its sensor ignores only `EA_` ids) and tried its captures: "Unlock captures skipped for appid
2366742765: no-running-timeline", because no game was running through Steam: captures need Steam's running recording
timeline for that appid (`g_GRS.m_mapActiveTimelines`), so the game must be started from its Steam shortcut with background
recording on. Fields: `appid` (normalise with `>>> 0`: shortcut appids pass 0x7FFFFFFF), `achievement_id`, `name`,
`description`, `image_url`, `achieved: true`, `rtime_unlocked`, `global_achieved_pct`. Names and icons: Xbox from the push
itself; Epic from the plugin's schema (`EnsureFresh` achievements part). Expected end to end: Xbox unlock + ~1 s (push) +
0.2 s; Epic unlock + overlay trigger + the API burst (1.5 s steps).

## Muting Epic's own toast (to show Steam's alone) (2026-10-03, untested on the real files)

The overlay renderer is `EOSOverlayRenderer-Win64-Shipping.exe` / `-Win32-Shipping.exe` in
`C:\Program Files (x86)\Epic Games\Epic Online Services\managedArtifacts\<id>\` (not the launcher's `Portal\Extras\Overlay`).
`unlock_watcher.mjs --mute-epic-overlay` (module and CLI: `epic_overlay.mjs status|mute|restore`) renames those two files to
`.bak` and puts them back on exit; it needs an elevated PowerShell and must start before the game. Unmuted, Epic's overlay
triggers (`cef.log`, the toast GIF, the renderer's connections) exist; muted they cannot, and the detector rests on the game's
own connection to `api.epicgames.dev` (which came first in the sample) and the API poll. To be checked live.

## Xbox without our own sign-in: what we lose (checked 2026-10-03)

The unlock push (above) reaches Windows through the Xbox app's own sign-in, so **detecting an unlock and its toast needs no
account link in our plugin**. What the plugin's device-code sign-in adds is everything that is not "an unlock happening now":

| | Windows push only | With our sign-in |
| --- | --- | --- |
| An unlock as it happens (game, id, name, description, icon, gamerscore, rarity, time) | yes, about 1 s | yes, 5 s or more later (poll) |
| The Steam toast, captures, Post-Game Summary line, Activity feed day | yes | yes |
| The full list: names, icons and descriptions of **locked** achievements | no | yes |
| Totals: "1 of 20", the progress bar, game completion (100% toast), total gamerscore | no (a list built from pushes is only the unlocked ones) | yes |
| Unlocks from before the listener ran, while Windows was off or the Xbox app signed out (the log is circular, 1 MB) | no | yes |
| Rarity of a locked achievement, secret achievements | no | partly |

No anonymous source fills the gap (all probed read-only): `profile.xboxlive.com` and `titlehub.xboxlive.com` answer 401,
`achievements.xboxlive.com` answers 400 "No valid claims were found on the request"; `xbox.com/play/user/<gamertag>` answers 200
but is a client-rendered shell with no profile or achievement data in it; the third-party mirrors block us (xboxgamertag.com 503,
trueachievements.com 403, and scraping them is not acceptable anyway); the Xbox app, Gaming Services and Game Bar cache nothing
about achievements on disk; Microsoft's display catalog (anonymous) only says a title has Xbox Live achievements
(`XblAchievements`), with no list or count. Whether Windows' own Xbox identity could hand a plugin a token (the GDK `XUser` API)
was not checked and would need a registered title.

**Option:** Xbox runs in two modes. *Lite* (default, no link): push-only notifications, captures and feed entries, and the
Achievements page lists only what the push has told us (stored per title, never "x of N"). *Full* (the existing sign-in, now
optional): the whole list, totals, completion and history. The settings row says what the sign-in adds. Epic needs nothing
either way (a public profile). Separate issue: Microsoft's sign-in page names the borrowed client id "Minecraft Launcher"
(`00000000402b5328`); a registered app would show our name.

## To test, and to finish (the end-of-session list, 2026-10-03)

**Auto-add of games installed while Steam runs** (built, `sensors/installs`, the tick verified live at 60.0 s):
1. Install an Epic game and an Xbox game while Steam runs, with the toggles on: the shortcut appears within a minute, in
   "Epic Games" / "Xbox", named correctly, launches.
2. Start an Epic download and watch it: no shortcut while it downloads (`bIsIncompleteInstall`), one when it finishes.
3. Uninstall a game: its shortcut stays (never removed automatically). Delete a shortcut by hand: it is not re-added until
   Steam restarts (once per session).
4. Not covered: an Xbox game still installing (the package list may show it early): see what the registry shows mid-install.

**Seeing a store unlock live and showing Steam's toast** (probe only, `unlock_watcher.mjs --steam`):
5. Xbox: a real unlock with `--steam` running (Fortress Merge or Minesweeper are installed; Jigsaw was uninstalled): the
   event-driven push watcher decodes it (only the polling decoder has seen a real push), the toast shows, and the log gives
   `unlockToShownSec`. Also: Xbox app closed; Game Bar off; a console unlock on the same account (must not toast, no shortcut).
6. Epic, overlay muted (elevated PowerShell, `--mute-epic-overlay`, start before the game): Epic's toast is gone, the Steam
   toast shows, and the detector still fires on the game's `api.epicgames.dev` connection and the API burst; files restored.
7. Epic, overlay on, a second sample: do the toast GIF and the `cef.log` line recur every time; is the launch toast
   distinguishable (one `cef.log` line at game start).
8. Captures: start the game from its Steam shortcut with background recording on, unlock, and see whether
   enhanced-notifications takes a screenshot and a clip. Unknown: whether Steam has a recording timeline for a game started by a
   launcher link (`com.epicgames.launcher://`) or `shell:AppsFolder`; if not, find how to get one.
9. Two unlocks in one second (Epic gave two in the same second), two stores at once, a shortcut-less game (no toast, logged).
10. No duplicate toasts: a re-sync of the same unlock must not post twice (dedupe by appid and achievement id; the probe has it).

**To build (not started)**: each step needs a plan, an ADR amendment and tests.
- ADR: supersede ADR-0056 decision 3 ("no toast": store unlocks now post Steam's native toast, with a per-store setting).
- Backend (Lua): a push-log reader (`wevtutil`/PowerShell, decode hex, parse JSON) and an Epic trigger (overlay `cef.log` growth,
  and the burst of API checks). ADR-0007: nothing on a timer while no store game runs; start on `shortcut.launched`, stop on
  `quit` (then the existing forced sync). A persistent event-driven PowerShell child would be better than polling if the
  backend can hold one; else poll once a second while a store game runs.
- Frontend: a `store-unlock` sensor, an `achievements.unlocked`-style event, and the `toasts` surface posting through
  `NotificationStore.OnNotification` (the existing launch toast calls it wrongly: TASK.md). `appid` normalised with `>>> 0`.
- Xbox lite and full modes (above), the settings rows and their explanation; Epic overlay muting stays a documented manual step
  (it edits Program Files and needs admin), or a button with a clear warning: decide.
- Tests: unit (push payload, id mapping, dedupe, appid signedness), Lua (hex decode, parser), live (the steps above); then the
  four views of Routine 1 and Game A, B, A (Routine 2).

## Both: what the watcher does today

Sensors: windows and processes (with UI Automation text, own timestamps), toast database, files (store folders, the
overlay, game folders), event logs (push payload decoded), TCP connections with DNS names, DNS lookups, and the API.
`candidate` events (`overlay-cef-log`, `overlay-toast-image`, `game-epic-api`, `xbox-live-host`, `xbox-push`) start the burst.

## Open

- A second Epic sample (an icon not yet cached; does the GIF and the `cef.log` line recur for every toast?).
- Whether the Xbox push arrives with the Xbox app closed (the widgets background task is activated by it) and without Game Bar.
- Design: a `sensors/store-unlock` in steam-cartridges (Xbox: poll the push log through a backend call that reads it; Epic:
  watch `cef.log` and run the burst), and how enhanced-notifications is told (it listens to Steam's own notification store:
  read `enhanced-notifications` first; see the earlier plan).
