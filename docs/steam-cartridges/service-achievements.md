# Achievements service

**This doc's job:** which source answers a shortcut's achievements, how unlocks are detected, and how
Steam's native UI is fed. Part of the steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs). The
[Reference](#reference-channels-stores-and-toasts-pre-migration-doc-kept) at the end is the earlier
"Native Achievements" doc (Phase 5), kept for the observer channels, Steam's native sinks and the emulator
notes; the sections before it are the migration's layer doc (M6a backend, M6b frontend).

## What it owns

- The `achievements` part of a record: `Part<{ schema, unlocks }>` and which source produced it.
- The **source order** and each source's `supports` rule (below), so a source is only asked about a shortcut
  that can be one of its games.
- Reading unlocks the observer detects while a game runs (`CheckUnlocks`).

It does **not** write to Steam (the `achievements`, `toasts` and `captures` surfaces do, `surfaces.md`).

## Contract

```lua
-- backend/ach_service.lua (M6a)
M.deps = { entry, steam, ps3, ps4, ra, ps3_dir, ps4_dir, rom_path, now }   -- nil = the real dependency
--- ctx = { native = number|nil, hardcore = boolean|nil, title = string }
--- Returns Part<{ schema, unlocks }>, source = "steam" | "rpcs3" | "shadps4" | "retroachievements".
function M.ensure(appid, ctx) end
--- Disk only: the stored schema and unlocks as a part, or nil. Never writes, never fetches.
function M.local_part(appid) end
--- The part plus the raw source result (the response shape of the old CartridgesAchievementsGet).
function M._resolve(appid, ctx) end
```

```lua
-- backend/record_rpc.lua
EnsureFresh(appid, {"achievements"}, ctx)   -- ctx.native from the identity (this call's, the frontend's, else saved)
                                            -- ctx.hardcore = setting raHardcoreMode
GetGameRecord / GetAllRecords               -- add achievements = local_part(appid)
CheckUnlocks({ appid, native?, title? })    -- -> { new_unlocks = [...] }  (always a list, K1)
```

`CartridgesAchievementsGet` is now a thin alias over `M._resolve` (same response: `{ schema, unlocks }` or
`{ error }`); `CartridgesAchievementsCheckUnlocks` stays as an alias of `CheckUnlocks`.

**Sources, in this order** (the chain `CartridgesAchievementsGet` used to hard-code):

| Source | `supports` | Fetch |
| --- | --- | --- |
| `steam` | `ctx.native > 0` | `steam_schema.get_or_fetch(appid, native)` (M10: moved out of the store) |
| `rpcs3` | `ps3_trophies.find_trophy_dir(exe, launch_options)` is not nil | `ps3_trophies.get_or_fetch(appid)` |
| `shadps4` | `ps4_trophies.find_trophy_dir(exe, launch_options)` is not nil | `ps4_trophies.get_or_fetch(appid)` |
| `retroachievements` | `retroachievements.extract_rom_path(exe, launch_options)` is not nil | `retroachievements.get_or_fetch(appid, hardcore)` |

**Outcomes:** the first supporting source that returns a schema is `ok`; a supporting source that returns
`nil, err` (or throws) falls through to the next; no source supports the shortcut → `unsupported`, with **no log
line and no request** (K2: AM2R has no ROM path, so RetroAchievements is never asked); every supporting source
failed → `error` with the last message. `achievements_observer.check_unlocks` resolves through the same function,
so a PC game stays silent there too.

## Files

| File | Role |
| --- | --- |
| `backend/ach_service.lua` | Source order, `supports` rules, `ensure`, `local_part` |
| `backend/record_rpc.lua` | `EnsureFresh` `achievements`, `CheckUnlocks`, local parts |
| `backend/achievements_rpc.lua` | The old RPC names, as aliases |
| `backend/achievements_observer.lua` | `check_unlocks` and the unlock channels; `get_possible_folder_names` (K7 fixed) |
| `backend/steam_schema.lua`, `ps3_trophies.lua`, `ps4_trophies.lua`, `retroachievements.lua` | The sources |
| `backend/achievements_store.lua` | The store (`achievements.json`); no network since M10 |

## Frontend (M6b)

`frontend/app/achievements.ts` (`createAchievements`) is the use case; the record's `achievements` part is
its only output, plus the `achievements.unlocked` event:

- `ensure(appid, route)`: `EnsureFresh(["achievements"])` with the record's identity, the title and the hardcore
  setting, then `records.update`. Called by the view pipeline (`features/source-view.ts`) for every route except
  `none` (route `none` makes no backend call) and on `shortcut.quit`.
- **Flow C** (`install()`): on `shortcut.launched`, the launch toast policy (`off` / `first_run` / `all_runs`, only
  when the record has achievements with a total > 0), then `CheckUnlocks` every 2000 ms until `shortcut.quit`, plus
  one final check at quit. A quit while the mapping is still loading starts no session. Both are gated by the
  `achievements-observer` kill switch.
- Each poll result is normalized to a list (`{}` from Millennium's cjson becomes `[]`, K1). New unlocks are merged
  into the record and announced with `bus.emit("achievements.unlocked", { appid, ids })`.
- `trigger` / `reset` / `checkNow` / `startSession` back the public API (`triggerAchievement`, `resetAchievements`,
  `checkObserverUnlocks`, `startAchievementsObserver`; same names and signatures, D8).
- `preload()` (ADR-0045): at start-up every stored `ok` part from `GetAllRecords` goes into the record of a shortcut,
  unless the record already has one (no library check: Steam's `appStore` is empty at start-up, verified live
  2026-09-30). Only the `achievements` part (never `identity`, knowledgebase Part 7). The `achievements` surface then
  fills Steam's progress cache for every shortcut, so other plugins read a shortcut's progress from Steam as for an
  owned game. `GetAllRecords` also returns a shortcut that has stored achievements but no metadata and no mapping
  (`ach_service.stored_appids`).
- `rerenderAll()` (ADR-0045): Steam's `LoadCacheFile` (after login) replaces `m_achievementProgress` with a map built
  from its own file, dropping what was written before. `sensors/progress-cache` watches the map's identity (1 s, at
  most 10 min) and `index.tsx` calls `rerenderAll()` on the first map and on each replacement; it re-emits
  `record.updated(achievements)` for every record with an `ok` part, and the existing render queue does the rest.

Subscribers (in `index.tsx`): the `toasts` surface shows one toast per id and the `captures` surface adds the
Post-Game Summary line, both reading name, description and icon from the record's schema. The `achievements`
surface renders the record into Steam's stores. `features/achievements/` no longer exists.

## Steam targets touched

None (backend and `app/`). The frontend surfaces are in `surfaces.md`.

## May import / must never import

`ach_service.lua` may require `steam_paths`, `shortcuts`, `achievements_store` and, lazily, the three other
source modules; it must not require the observer (the observer requires it).

## Tests

`tests/test_ach_service.lua` (hermetic, `deps` injected, no files read): PC game without a ROM path is
unsupported and silent · native schema wins · rpcs3 / shadps4 / retroachievements selection (hardcore flag) ·
a failing source falls through · all failing is error · `local_part` is disk only · `CheckUnlocks` returns a list
(K1, array metatable) · `EnsureFresh` uses the saved identity · `GetAllRecords` adds stored achievements · K7
(colon and em dash). `tests/test_backend.lua` `get_possible_folder_names` checks pass (K7). Frontend: `tests/app-achievements.test.ts` (10): poll
result object normalized to an array (K1) · launch toast off / first_run / all_runs · unlock emits `achievements.unlocked`
with the new ids · quit stops polling and runs one final check · observer kill switch · route `none` makes no call · one
backend call in flight · trigger and reset. `tests/achievements.test.ts` still tests `surfaces/achievements/core.ts`.

## How to add a source

1. Add a `{ name, supports, fetch }` row to `SOURCES` in `ach_service.lua`, in the position it should win.
2. `supports` must be cheap and side-effect free (a path check, not a request); `fetch` returns `res, err`.
3. Add its `deps` name (nil = the real module) and a test in `tests/test_ach_service.lua`.
For a new emulator family or engine log reader see the Reference section "How to Add Support".

## History

- 2026-09-30 (ADR-0045): `preload()`, `rerenderAll()`; `GetAllRecords` covers every stored shortcut
  (`achievements_store.shortcut_keys`, `ach_service.stored_appids`); `storedAchievementSummaries()` deleted from the public
  API; `buildSteamAchievements` accepts the `{}` form of an empty list (K1).
- M6a (2026-09-29): created (this doc replaces `docs/steam-cartridges-achievements.md`, kept below as the
  Reference). `ach_service.lua`, `CheckUnlocks`, the `achievements` part. Fixes K1 (backend half: arrays), K2, K7.
  Nothing calls the new part until M6b.

## Reference: channels, stores and toasts (pre-migration doc, kept)

---

## 1. System Overview & Invariants

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │               NON-STEAM GAME SHORTCUT                  │
                                    │    (e.g. Jotunnslayer from Epic, GOG, or DRM-free)     │
                                    └──────────────────────────┬─────────────────────────────┘
                                                               │
                                         Mapped via Steam Store Search / Mapping
                                                               │
                                                               ▼
                                    ┌────────────────────────────────────────────────────────┐
                                    │              NATIVE STEAM APPID SCHEMA                 │
                                    │       Keyless fetch from Steam CDN / AppDetails        │
                                    │ (API names, display titles, descriptions, icons, %)    │
                                    └──────────────────────────┬─────────────────────────────┘
                                                               │
                                       ┌───────────────────────┴───────────────────────┐
                                       │                                               │
                                       ▼                                               ▼
                        ┌───────────────────────────────┐               ┌───────────────────────────────┐
                        │       IN-GAME OBSERVER        │               │       STEAM NATIVE SINKS      │
                        │                               │               │                               │
                        │ 1. Steamworks Relay / Shim    │   Dispatches  │ 1. NotificationStore.OnToast  │
                        │ 2. Windows Notification Listen│ ────────────► │ 2. Desktop Sidebar Section    │
                        │ 3. Multi-Engine Log Tailers   │     Unlock    │ 3. Post-Game Summary Banner   │
                        │ 4. Local Emulator Saves       │     Event     │ 4. Big Picture Play Bar       │
                        │ 5. Local Test Mock RPC        │               │ 5. enhanced-notifications Hook│
                        └───────────────────────────────┘               └───────────────────────────────┘
```

### Core Invariants
1. **Zero Third-Party Storefront APIs in Core:** `steam-cartridges` core never requires Epic Games OAuth, EA App tokens, or Xbox Live credentials. All detection is strictly local and out-of-process.
2. **Never Inject into Game Binaries:** We never hook game memory, inject DLLs into running games, or create remote threads. All detection is passive (file watching, directory checks, engine log tailing, OS-level notifications).
3. **Steam Native Components Only (ADR-0009 & ADR-0022):** We never render custom HTML recreation of achievements. We restore Steam's native `"achievements"` section in `CAppDetailsSections` and feed `AppDetailsStore.GetAchievements` so Steam's own React components render the UI.
4. **Offline Resilience:** Local unlocks and cached schemas are saved in `<steam>/millennium/config/steam-cartridges/achievements.json`. Once fetched, achievements work completely offline.

---

## 2. Schema Mirroring & Storage

When a non-Steam shortcut is added to Steam:
1. `steam-cartridges` resolves the shortcut to its Steam Store counterpart (e.g. *Jotunnslayer: Hordes of Hel* shortcut `2315502503` $	o$ native AppID `2820820`).
2. The schema fetcher queries Steam's public CDN / Community data for the native AppID:
   - Schema fields: `api_name`, `name`, `description`, `icon_unlocked`, `icon_locked`, `global_pct`.
   - Source 1 (in-client): `appDetailsStore.RequestAppDetails(nativeAppId)`.
   - Source 2 (public CDN): `https://steamcommunity.com/stats/<nativeAppId>/achievements/` and `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=<nativeAppId>`.
3. The schema and player's unlock status are persisted locally:
   ```json
   {
     "shortcuts": {
       "2315502503": {
         "schema_appid": 2820820,
         "unlocked": {
           "ACH_FIRST_KILL": { "rtime_unlocked": 1727364800 },
           "ACH_WIN_RUN": { "rtime_unlocked": 1727368400 }
         },
         "first_launch_notified": true
       }
     }
   }
   ```

---

## 3. The In-Game Observer Architecture

When a game is launched from Steam, `steam-cartridges` launches an out-of-process observer session. The observer monitors active local channels for achievement events:

### Channel 1: Local Steamworks Relay (`steam_api64.dll` Local Relay)
- **Target:** Games containing `steam_api64.dll` or using a local Steam wrapper.
- **Protocol:** When the game invokes `SteamUserStats()->SetAchievement("ACH_NAME")`, the local DLL relays the event to a local loopback port (`127.0.0.1:42421`) or writes to a local file.
- **Latency:** $< 1$ ms.

### Channel 2: Windows OS Notification Listener (Storefront Toast Observer)
- **Target:** Legitimate storefront versions (Epic Games Store, EA App, Xbox App, GOG Galaxy).
- **Mechanism:** Uses the Windows 10/11 `Windows.UI.Notifications.Management.UserNotificationListener` API.
- **Operation:** When the storefront launcher displays a toast on Windows (*"Achievement Unlocked: Master of Hel"*), the listener captures the title text, matches it against the mirrored Steam schema, and passes it to the Steam sink pipeline.
- **Epic Suppression Strategy:** Disabling in-game overlay notifications (`Shift + F3`) prevents Epic from drawing over the game, while Windows notification settings can be muted, allowing **only** Steam's toast and chime to sound.

### Channel 3: Multi-Engine Runtime Log & Data Tailers
- **Target:** Games built on Unity, Unreal Engine, Godot, GameMaker, or Ren'Py.
- **Operation:** When the game boots, `steam-cartridges` identifies the engine from folder signatures and tails the engine's active runtime log:
  - **Unity:** `%USERPROFILE%\AppData\LocalLow\[Company]\[Product]\Player.log`
  - **Unreal Engine:** `%LOCALAPPDATA%\[Project]\Saved\Logs\[Project].log`
  - **Godot Engine:** `%APPDATA%\Godot\app_userdata\[Project]\logs\godot.log`
  - **GameMaker:** `%LOCALAPPDATA%\[Project]\` (sandboxed `.ini` / `.json` saves & `debug.log`)
  - **Ren'Py:** `%APPDATA%\RenPy\[Project]\log.txt` and `persistent`
- **`[Project]` folder name derivation:** the folder Unreal/Unity/Godot actually
  write to is often the *internal project codename*, not the Steam Store title
  (e.g. `"WUCHANG: Fallen Feathers"` ships as `Project_Plague.exe`, writing logs
  to `%LOCALAPPDATA%\Project_Plague\Saved\Logs\Project_Plague.log`). Title-only
  lookups miss this. `achievements_observer.get_possible_folder_names(game_title,
  exe_path)` derives a deduplicated candidate list — checked in this order:
  1. The shortcut's executable base name (directories, `.exe`, and Unreal
     shipping/test/debug suffixes like `-Win64-Shipping` stripped).
  2. The exact Steam title.
  3. Punctuation-normalized variants (colon/en dash/em dash → `" - "` or
     stripped, spaces collapsed or removed).
  4. `snake_case` of the title.
  5. The prefix before the first colon/dash (e.g. `"Wuchang"`).

  Each candidate is checked against `Player.log`, `godot.log`, and
  `Saved\Logs\<Candidate>.log`. If a candidate's `Saved\Logs\` directory exists
  but no file matches `<Candidate>.log` exactly, the most recently modified
  `*.log` in that directory is tailed instead.

### Channel 4: Local Save & Emulator Watcher
- **Target:** Steam emulators (Goldberg, CODEX, RUNE, GSE, DarkSiders) and GOG Galaxy SQLite database.
- **Goldberg:** Monitors `%appdata%\Goldberg SteamEmu Saves\<AppID>\achievements.json`.
- **CODEX / RUNE:** Monitors `%PUBLIC%\Documents\Steam\<Emu>\<AppID>\achievements.ini`.
- **GOG Galaxy:** Monitors `C:\ProgramData\GOG.com\Galaxy\storage\galaxy-2.0.db` table `UserAchievements` in read-only WAL mode.

---

## 4. The Steam Native Sinks

Once an unlock event is detected, `steam-cartridges` feeds Steam's native subsystems:

### 1. Toast Notification & Audio (`NotificationStore`)
Dispatched via `window.NotificationStore.OnNotification(id, eType, binaryPayload)`:
- Steam opens its native desktop popup (`notificationtoasts_<n>_desktop`) or Big Picture portal.
- Steam plays navigation sound 5 (the achievement chime).
- If `enhanced-notifications` is active with a theme that has an `achievements` block, it intercepts the toast, selects the theme tier (Bronze/Silver/Gold/Platinum), and renders the styled banner.
- If Steam Game Recording is active, Steam places an `Achievement` marker on the timeline.

### 2. Desktop Right-Column "Achievements" Section
- In `steam-cartridges/frontend/steam/sections.ts`, `"achievements"` is re-enabled in `CAppDetailsSections.GetSections()` for shortcuts that have achievement data.
- `AppDetailsStore.GetAchievements(shortcutAppId)` is wrapped to return:
  ```ts
  {
      nTotal: totalAchievements,
      nAchieved: unlockedCount,
      vecHighlight: unlockedList.slice(0, 5),
      vecAchieved: unlockedList,
      vecUnachieved: lockedList
  }
  ```
- Steam natively renders the completion percentage bar, badge cards, and locked list.

### 3. Post-Game Summary Banner
- In `CAppSpotlightStore` (module `74827`), achievements unlocked during the current session are added via `m_session.AddAchievement(achievement, unlockTimestamp)`.
- When the game process exits, Steam renders the achievement card in the hero card strip beside screenshots and clips.

### 4. Big Picture Play Bar Progress
- Updated via `window.appAchievementProgressCache.m_achievementProgress.mapCache.set(shortcutAppId, { unlocked, total, all_unlocked })`.
- Big Picture immediately renders the quick stats (e.g. `5 / 25 Achievements`) under the "Play" button.

### 5. Big Picture & Desktop Individual Achievements Full-Page Screen
- **Route:** `/routes/library/app/<shortcutAppId>/achievements/my/individual`.
- **Component & Fetcher:** Component `re` (module `10709`) invokes `(0, _.hj)(appid, accountid)` (module `32179`), querying the singleton store `p6` (`AchievementsFullStore`).
- **The Shortcut Trap:** By default, Steam's `LoadMyAchievements` calls `SteamClient.Apps.GetMyAchievementsForApp(shortcutAppId)`, which fails with result `8` (`k_EResultFail`) for non-Steam shortcuts (`appid >= 0x80000000`), caching `{ error: 8 }` and throwing the `"Failed to load achievement data"` screen.
- **Hook & Feed:** `ensureAchievementsFullStoreHooked()` wraps `LoadMyAchievements`, `GetMyAchievements`, `GetGlobalAchievements`, and `GetPlayerAchievements` on `AchievementsFullStore.prototype`. It populates `m_mapMyAchievements` and `m_mapGlobalAchievements` directly from local state (`achieved`, `unachieved`, and `globalPcts`), completely bypassing the failing RPC call. Steam then renders its full native achievements screen with capsule artwork, header progress bar, search, and rarity tiers.

---

## 5. "Local Achievements Enabled" Game-Launch Notification

When a non-Steam game launches and `steam-cartridges` confirms achievement tracking is active:
- Steam displays a custom native launch toast:
  - **Header:** `{steam-cartridges icon} Local Achievements Enabled`
  - **Body:** `Enjoy your game!`
  - **Audio:** Steam navigation chime.
- **Settings (`settings.ts`):** `localAchievementsNotifyOnLaunch`:
  - `off`: Never show the startup toast.
  - `first_run`: Show only on the first boot of that game with achievements enabled.
  - `all_runs`: Show on every launch (default).

---

## 6. RetroAchievements & Emulators (RetroArch / DuckStation / PCSX2)

For retro games launched through emulators (e.g. SNES, Genesis, PS1, PS2) where achievements exist on [RetroAchievements.org](https://retroachievements.org):

### 1. Zero-Friction Credential Discovery
- Reads `cheevos_username` and `cheevos_token` dynamically from `C:\emu\RetroArch\retroarch.cfg` (or `%APPDATA%\RetroArch\retroarch.cfg`).
- Never asks the user to enter credentials, and never commits or logs tokens.
- Communicates directly with `retroachievements.org/dorequest.php` with `User-Agent: RetroArch/1.19.0`.

### 2. ROM Hashing & Game Identification (`ra_hasher.js`)
- Given a shortcut command line (`retroarch.exe -L cores\<core>.dll "<rom>"`), extracts the target ROM path.
- Handles both plain ROMs and `.zip` archives (extracts raw uncompressed stream in-memory).
- Detects and strips 512-byte copier/SMC headers (`fileSize % 1024 == 512`) to produce the canonical MD5 recognized by RetroAchievements.
- Queries `dorequest.php?r=gameid&m=<md5>` to retrieve the canonical `GameID`.

### 3. Schema Ingestion & Persistence
- Fetches full patch data (`r=patch&g=<id>&u=<u>&t=<t>`) including titles, descriptions, points, and official badge URLs (`https://media.retroachievements.org/Badge/<badge>.png`).
- Fetches existing user unlocks (`r=unlocks&g=<id>&h=0&u=<u>&t=<t>`).
- Persists schema under key `ra_<game_id>` and records shortcut binding in `achievements.json`.
- Feeds Steam's Big Picture individual achievements page, progress bar, and desktop sidebar.

### 4. Real-Time In-Game Observer
- RetroArch logs achievements in real time to `C:\emu\RetroArch\logs\retroarch.log` (when `log_to_file = "true"` and `cheevos_verbose_enable = "true"`).
- Observer incrementally tails `retroarch.log`, `duckstation.log`, and PCSX2 `emulog.txt` from last byte offset.
- Regex pattern detects:
  `[INFO] [RCHEEVOS] Awarded achievement <ID>: "<Title>"`
- Matches `<ID>` to schema item, records unlock timestamp, dispatches native Steam toast (`NotificationStore.OnNotification`), and updates Steam's store caches live.

---

## 7. How to Add Support for a New Engine or Emulator

To support a new game engine, local emulator, or save format, follow this recipe:

### Adding an Emulator or Save Format (File-Based Reader)
1. Add the path resolver in `backend/achievements_readers.lua`:
   ```lua
   function readers.check_my_emulator(appid, game_dir)
       local p = utils.expand_path("%APPDATA%/MyEmu/" .. appid .. "/achievements.json")
       if fs.exists(p) then return p end
       return nil
   end
   ```
2. Implement the parser function returning a list of `{ api_name = string, earned = boolean, rtime = number }`.
3. Register the path with the active file watcher pool.

### Adding a Game Engine (Log Tailer)
1. Define the identifying signature in `backend/achievements_engines.lua`:
   ```lua
   {
       name = "MyEngine",
       detect = function(game_dir) return fs.exists(game_dir .. "/myengine.dll") end,
       log_path = function(company, title)
           return utils.expand_path("%LOCALAPPDATA%/" .. title .. "/logs/game.log")
       end,
       pattern = "Achievement Granted: ([A-Za-z0-9_]+)"
   }
   ```
2. When the shortcut launches, if `detect` is true, the observer spawns a file tailer on `log_path`.

---

## 7. Testing & Verification

1. **Automated Unit Tests:**
   - `steam-cartridges/tests/achievements-schema.test.ts`: Verifies keyless schema ingestion and local JSON persistence.
   - `steam-cartridges/tests/test_achievements.lua`: Hermetic Lua tests for file parsers (Goldberg, CODEX, GOG DB query logic).
2. **Automated CDP Live Tests (`scratch/test_fake_achievement.mjs`):**
   - Connects to Steam DevTools on `127.0.0.1:8080`.
   - Triggers `cartridges:trigger_fake_achievement(shortcutAppId, "ACH_WIN_RUN")`.
   - Asserts:
     - Steam toast popup window opens.
     - `AppDetailsStore.GetAchievements().nAchieved` increments.
     - `appAchievementProgressCache` updates.
     - Navigation cycle (Game A $	o$ Game B $	o$ Game A) maintains unlocked state.
- M10 (2026-09-30): the keyless Steam schema fetch moved from `achievements_store.lua` to the source `steam_schema.lua`
  (a store stores, a source fetches); `ach_service` finds the shortcut through `registry.shortcut`.
