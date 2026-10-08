# steam-cartridges-local — plugin architecture

**This doc's job:** the architecture, file layout, formats, discovery, watcher and integration contract of the
`steam-cartridges-local` extension plugin.

`steam-cartridges-local` is an optional Millennium plugin that extends `steam-cartridges`. It owns **everything about
Steam API emulators and local PC games** (ADR-0063): it finds, reads, watches and resets the achievement files those
emulators write (CODEX, RUNE, RELOADED, GSE, Goldberg, SOVEREIGN, Online-Fix, Tenoke, SkidRow, EMPRESS, SmartSteamEmu,
UniverseLAN) and the unlocks Unity, Godot and Unreal games write to their logs. `steam-cartridges` reads none of these and
names none of them (a test in its `architecture.test.ts` enforces it). Format and folder knowledge partly comes from
[PSerban93/Achievements](https://github.com/PSerban93/Achievements) (MIT, read at `a43eaf3`).

---

## 1. Role in the suite

```
  steam-cartridges (core)                                  steam-cartridges-local (extension)
  ─────────────────────────                                ───────────────────────────────────
  schema: Steam (mapped app), RA, RPCS3, shadPS4           discovery: game folder + global roots
  own observer: console-emulator logs + trophy files       formats: INI (A/B/Type 1 hex), Tenoke, Goldberg JSON,
  record + Steam stores + toasts + Post-Game Summary                stats.bin, engine logs
                                                           watcher: per-game session, mtime/size polls, late files
         window.SteamCartridges (kernel/extensions.ts, 1.1.0)
    core ──notifyAppViewed / notifyAppLaunched / notifyAppQuit(AppContext)──► local
    core ◄──reportUnlocks(appid, [{ id, unlockedAt }], { providerId, silent })── local
    core ──match / getUnlocks / reset(AppContext)  (Reset dialog only)───────► local
```

The core works fully without this plugin (ADR-0012). With it, the core never polls for unlocks: this plugin pushes them,
and the core matches the ids to the schema, persists them, and shows Steam's toast (or, `silent`, only the Post-Game
Summary). `AppContext` carries the shortcut's exe, the mapped Steam app (`nativeAppid`) and the schema ids
(`achievementIds`), so this plugin never reads Steam's shortcut list or the core's files.

---

## 2. Layout

```
steam-cartridges-local/
├── plugin.json · package.json · tsconfig.json · dev.ps1 · README.md · CHANGELOG.md
├── backend/
│   ├── main.lua             RPCs (below); every payload is AppContext-shaped
│   ├── data_dir.lua         <Steam>/millennium/config/steam-cartridges-local (log_offsets.json)
│   ├── text.lua             bytes -> UTF-8 (UTF-8, UTF-8 BOM, UTF-16LE with or without BOM, UTF-16BE); encode_like
│   ├── ini_parser.lua       achievements.ini / SOVEREIGN.ini reader and reset editor
│   ├── tenoke.lua           user_stats.ini reader and editor; tenoke.ini AppID
│   ├── goldberg_parser.lua  achievements.json reader and editor
│   ├── stats_bin.lua        SmartSteamEmu stats.bin reader (CRC32 of the API name; read only)
│   ├── appid_discovery.lua  the AppID a game folder names
│   ├── file_search.lua      candidates(ctx): game folder walk + global roots x shared layouts; 60 s cache
│   ├── engine_logs.lua      Unity / Godot / Unreal logs: folder-name guesses, tailing, offsets
│   ├── watcher.lua          per-game session: start / poll / stop
│   ├── file_reset.lua       backup, then clear in the file's own encoding
│   └── _lib/                Millennium type stubs
├── frontend/
│   ├── index.tsx            registers the provider (Reset dialog) and the settings panel; starts the observer
│   ├── observer.ts          view / launch / quit -> read or watch -> reportUnlocks
│   ├── backend.ts           callLocalBackend (the -dev copy first), list coercion (guardrail 21)
│   └── settings/            "Watch while a game runs" (watchWhilePlaying, default on)
└── tests/                   one Lua suite per module (npm test), check.lua helper, harness.lua stubs
```

---

## 3. Formats

Every reader returns `{ [id] = { unlocked_time } }`; **an unknown time is 0, never "now"** (the core records it at the
time it sees it). Ids may be API names or display names: the core matches them to the schema.

| Format | Shape | Notes |
| --- | --- | --- |
| INI map (SOVEREIGN, RUNE, UniverseLAN) | `[Achievements]` `ACH_ID=0 \| 1 \| true \| <unix time>` | `;` / `#` comments skipped and kept on reset; a key-less `=1` line is ignored |
| INI list (CODEX) | `[SteamAchievements]` `Count=1`, `0=ACH_ID` | |
| INI section, Type 2 (CODEX, RELOADED, SkidRow, Online-Fix) | `[ACH_ID]` `Achieved=1` `UnlockTime=…` | any of `Achieved`/`Unlocked`/`Unlock`/`Earned`/`UnlockTime`/`UnlockedTime` makes it Type 2; ms times divided down |
| INI section, Type 1 | `[ACH_ID]` `State=01000000` `Time=00f15365` | 8-digit (or multiple of 8) values are little-endian 32-bit hex; a 10-digit decimal is never read as hex; earned when `State > 0` or `CurProgress >= MaxProgress > 0` |
| Tenoke `user_stats.ini` | `[ACHIEVEMENTS]` `"ACH_ID" = {unlocked = true, time = 1700000000}` | `[STATS]` is progress, never an unlock |
| Goldberg / GSE `achievements.json` | `["ID", …]` or `{ "ID": { "earned": true, "earned_time": … } }` | |
| SmartSteamEmu `stats.bin` | int32 count, 24-byte records: CRC32(name) at 0, time at 8, achieved at 20 (LE) | needs `achievementIds`; read only |
| Online-Fix `Stats.ini` | progress | never a candidate |

Ignored INI sections: `[Game]`, `[Profile]`, `[DownloadableContent]`, `[Experimental]`, `[Stats]`, `[GameSettings]`,
`[Settings]`, `[User]`.

---

## 4. Discovery (`file_search.candidates(ctx)`)

1. **AppIDs:** `nativeAppid` when the shortcut is mapped, plus every AppID the game folder names (`appid_discovery`:
   `steam_appid.txt`, `steam_settings/steam_appid.txt`, `SOVEREIGN.ini [Game] AppID`, `UniverseLAN.ini [GameSettings]
   AppID`, `tenoke.ini id=`).
2. **Game folder:** from the exe (or start folder), up to 4 parents: `SOVEREIGN.ini`, `Binaries/Win64/SOVEREIGN.ini`,
   `Engine/Binaries/ThirdParty/Steamworks/<every version folder>/Win64/SOVEREIGN.ini` (Unreal, e.g. Wuchang),
   `achievements.ini`, `Stats/achievements.ini`, `user_stats.ini`, `SteamData/user_stats.ini`,
   `UniverseLANData/Achievements.ini`, `steam_settings/<id>/achievements.json`. A `SOVEREIGN.ini` naming another AppID
   than the mapped one is skipped.
3. **Global roots** (from `%PUBLIC%`, `%APPDATA%`, `%LOCALAPPDATA%`; nothing hardcoded): `Documents/Steam/{CODEX,RUNE,RLD!,SOVEREIGN}`,
   `Documents/Steam` (GSE), `Documents/{OnlineFix,EMPRESS,SkidRow,SmartSteamEmu}`, `%APPDATA%/Steam/{CODEX,RUNE,RLD!,SOVEREIGN}`,
   `%APPDATA%/Steam`, `%APPDATA%/{GSE Saves,Goldberg SteamEmu Saves,OnlineFix,SkidRow,EMPRESS,SmartSteamEmu}`,
   `%APPDATA%/SOVEREIGN/Storage/SOVEREIGN`, `%APPDATA%/SOVEREIGN`, `%LOCALAPPDATA%/SKIDROW`. Under each, for each AppID:
   `<id>/achievements.ini`, `<id>/achievements.json`, `<id>/SOVEREIGN.ini`, `<id>/Stats/achievements.ini`,
   `<id>/SteamData/user_stats.ini`, `<id>/user_stats.ini`, `<id>/stats.bin`, `<id>/remote/<id>/achievements.json`,
   `<id>/steam_settings/<id>/achievements.json`.

Each result is `{ path, label, format }`; `label` names the emulator (only this plugin may). Results are kept 60 s per
shortcut / mapping / exe; `invalidate(appid)` forgets them (a watch start, a reset).

---

## 5. Watcher and engine logs

- `LocalWatchStart(ctx)`: resolve the files, read them all, note each file's size and write time, mark first-seen engine
  logs at their end; returns the snapshot. The frontend reports it with `silent: true` (old unlocks never toast).
- `LocalWatchPoll({ appid })`, every 2 s after the previous poll settles: re-read only a file whose size or write time
  changed; tail the engine logs; while no file is watched, search again every 8th poll (a file the emulator creates
  after launch). Returns `{ changed, unlocks }`, the whole snapshot when changed. Reported with `silent: false`.
- `LocalWatchStop({ appid })`: a final poll, then the session is dropped.
- Engine logs (`engine_logs.lua`): candidates from the exe's project codename (Unreal `-Win64-Shipping` stripped) and the
  title's variants; `Player.log` (LocalLow), `godot.log` (app_userdata), `Saved/Logs/<name>.log` or the newest `*.log`
  there; lines matching `achievement=`, `award=`, `unlock=`, `UnlockAchievement("…")`, `SetAchievement("…")`. Read
  positions in `log_offsets.json`; a log seen for the first time is read from its end; a shorter log from the start.
- Page view: `LocalReadUnlocks(ctx)` (files only), reported `silent: true`, so unlocks earned before the plugin are
  recorded without a toast.
- The "Watch while a game runs" setting off: no session; page views still report.

---

## 6. Reset (`LocalResetUnlocks`)

For each candidate: copy to `<file>.bak-<unix time>`, clear (`Achieved=0` / `UnlockTime=0`, hex `00000000`, map values
`0`, `[SteamAchievements] Count=0`, Tenoke `unlocked = false, time = 0`, Goldberg `earned=false`), write back in the
file's own encoding (`text.encode_like`). `stats.bin` is never changed (reported as read only). Then every engine log of
the game is marked read to its end, so an old line never brings an unlock back. Returns `{ ok, cleared, backupPath,
errors }`. The core's Reset dialog lists the source as `steam-cartridges-local`, labelled with the emulators found.

---

## 7. RPCs

| RPC | Payload | Returns |
| --- | --- | --- |
| `LocalDetectFiles` | AppContext | `{ files: [{ path, label, format }] }` |
| `LocalReadUnlocks` | AppContext | `{ unlocks: [{ id, unlockedAt }] }` |
| `LocalResetUnlocks` | AppContext | `{ ok, cleared, backupPath, errors }` |
| `LocalWatchStart` | AppContext | `{ files, unlocks, changed }` |
| `LocalWatchPoll` | `{ appid }` | `{ changed, unlocks }` |
| `LocalWatchStop` | `{ appid }` | `{ changed, unlocks }` |

---

## 8. Testing & building

- Backend: `npm test` (in the plugin folder) runs `test_text`, `test_ini_parser` (with a census of the real Wuchang
  `SOVEREIGN.ini` when present), `test_tenoke`, `test_stats_bin`, `test_file_search` (also checks that no user id, Steam
  path or core file appears in the backend), `test_engine_logs`, `test_watcher`, `test_globals`. Temp files only.
- Frontend: `npm run check`, `npm run build`.
- Deploy: `powershell -ExecutionPolicy Bypass -File dev.ps1` (take the Steam lock, AGENTS.md Routine 0).
