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
