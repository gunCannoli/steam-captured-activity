# Store copies (Epic, Xbox)

> **Moved from steam-cartridges (ADR-0067, 2026-10-14).** Every module named here now lives in
> `steam-cartridges-third-party/` (backend and frontend). The core keeps none of it: this plugin pushes each copy's Game
> Info, media and achievements to the core ([service-provided.md](steam-cartridges/service-provided.md)). Where this doc
> says "the `store` part" or "app/store-sync", read: third-party's `store_service` and `store-sync.ts`.

**This doc's job:** is a shortcut an Epic Games Store or Xbox copy of a game, and which one; and the sources that read
those stores. Part of the steam-cartridges architecture (ADR-0039, ADR-0056); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

- The `store` part of a record: `Part<StoreCopy>` (`kernel/record.ts`). `ok` = the shortcut is a copy (`kind` "epic" or
  "xbox", its store ids, how it was found); `unsupported` = it is not.
- Finding a copy from the store's own install data on this PC, never from anything the user types (decision 1):
  Epic's install manifests, the installed Store packages and their Xbox game config.
- The store ids named by the store's API once per game (Epic offer and achievement product; Xbox Store product and
  title id), kept in `<data dir>/store_copies.json` (`store_copies_store.lua`).
- The list of installed games of both stores, for the Third-party settings section and auto-add.
- The sources the other services use for a copy: `epic_graphql.lua` (Epic's public GraphQL), `xbox_catalog.lua`
  (Microsoft's public display catalog), `xbox_live.lua` (the player's Xbox Live achievements, after a device-code
  sign-in), `store_achievements.lua` (the achievements service's `epic` and `xbox` rows).

It does **not** decide routing, write to Steam, or own Game Info, media or achievements: those services ask for the copy
(`store_service.saved`, or this call's part as `ctx.store`) and pick their tier themselves.

## Contract

```lua
-- backend/store_service.lua
M.deps = { entry, entries, epic_local, xbox_local, epic, xbox_catalog, now }   -- nil = the real dependency
function M.detect(entry) end          -- StoreCopy without API fields, from local data only, or nil
function M.saved(appid) end           -- disk only: the saved copy as a part, or nil
function M.ensure(appid, ctx) end     -- the `store` part; ctx = { allowEpic?, allowXbox?, noNetwork? }
function M.installed_games(ctx) end   -- { epic = { {key, title, inLibrary?, launch?} }, xbox = {...}, epicLauncher }
```

```lua
-- backend/record_rpc.lua
EnsureFresh(appid, {"store", ...}, ctx)   -- "store" first: later parts of the same call see ctx.store
-- backend/store_rpc.lua (registered in main.lua)
StoreInstalledGames { allowXbox }  StoreAccounts  XboxSignInStart  XboxSignInPoll { device_code }  XboxSignOut
```

**Detection** (`detect`, local only):

| Store | Shortcut shape | Matched by |
| --- | --- | --- |
| Epic | runs the game's exe (Jotunnslayer here) | the exe is inside a manifest's `InstallLocation` (`via = "manifest"`) |
| Epic | runs `com.epicgames.launcher://apps/<AppName>` or `apps/<ns>%3A<item>%3A<AppName>` | the manifest's `AppName` (`via = "launch-link"`) |
| Xbox | `explorer.exe shell:AppsFolder\<family name>!<app>` | the package family name (`via = "launch-link"`) |
| Xbox | runs an exe inside a package folder | the package's `PackageRootFolder` (`via = "package"`) |

An Epic add-on manifest (`MainGameAppName` or `MainGameCatalogNamespace` naming another game) is never a game. An Xbox
package is a game when it ships `xboxservices.config` (UWP, `TitleId` decimal) or `MicrosoftGame.config` (GDK,
`<TitleId>` hex, `<StoreId>`; not yet seen on a real install).

**Filling** (`ensure`): Epic's offer (`catalogOffers`, the `BASE_GAME`) and achievement product
(`productAchievementsRecordBySandbox`), Xbox's Store product and title (`products/lookup` by family name, or `bigIds`
by Store id); each asked once per game (`lookups` in `store_copies.json`), only when that store is enabled
(`ctx.allowEpic` / `ctx.allowXbox`, settings `services.epicEnabled` / `xboxEnabled`). A failing store keeps the local
copy (ADR-0014).

## What each service does with a copy

| Service | Tier | Doc |
| --- | --- | --- |
| Achievements | `epic` / `xbox` rows first; the player's unlocks synced; Steam's list when it covers the store's ids | [service-achievements.md](service-achievements.md) |
| Metadata | no Steam match: the store before IGDB and ScreenScraper | [service-metadata.md](service-metadata.md) |
| Media | no Steam match: the store's screenshots before IGDB and ScreenScraper | [service-media.md](service-media.md) |
| Artwork | unchanged: SteamGridDB (it has Epic and Xbox games); store art is not used (ADR-0056) | [service-artwork.md](service-artwork.md) |

## Credentials

Epic needs none: the account id is the name of the launcher's `Saved\Data\<32 hex>.dat`, and a profile whose
achievements are public answers anonymously (a private one answers 403: the panel says how to change it). Xbox stores
only the Microsoft refresh token, the xuid and the gamertag in the data folder's `.env` through `web_config` (keys
`xbox_refresh_token`, `xbox_xuid`, `xbox_gamertag`; a gamertag's spaces as `%20`); the access and XSTS tokens stay in
memory and nothing logs a token or a device code. The public client ids are constants in the code.

## Files

| File | Role |
| --- | --- |
| `backend/store_service.lua` | Detection, filling, `saved`, `installed_games` |
| `backend/store_copies_store.lua` | `store_copies.json`: copies and per-game lookups (no network) |
| `backend/store_epic_local.lua` | Epic manifests, launcher URL handler (`reg query`), account id, launch spec |
| `backend/store_xbox_local.lua` | Store packages (`reg query`), game configs, AppxManifest, launch spec |
| `backend/epic_graphql.lua` | Source `epic`: offers, game data, achievement list, player unlocks (net source `epic`) |
| `backend/xbox_catalog.lua` | Source `xbox` game data: catalog lookups (net source `xbox-catalog`) |
| `backend/xbox_live.lua` | Source `xbox` achievements: device-code sign-in, token chain, achievements, title history (net source `xbox-live`) |
| `backend/store_achievements.lua` | The achievements service's `epic` and `xbox` rows |
| `backend/iso_date.lua` | Store dates to Unix seconds |
| `backend/store_rpc.lua` | The Third-party section's RPCs |
| `frontend/app/store-copy.ts` | `EnsureFresh(["store"])` once per shortcut per session (first in `app/view`) |
| `frontend/app/store-sync.ts` | Auto-add: which installed games get a shortcut, in which collection; the U0 repair of Xbox UWP shortcuts after an app update (ADR-0058) |
| `frontend/sensors/installs/index.ts` | The 60 s tick that re-runs auto-add, so a game installed while Steam runs needs no restart |
| `backend/store_launch.lua` | Epic Steam Overlay Workaround (ADR-0057): `prelaunch` closes a running Epic launcher before Steam launches an Epic launcher-link copy; `reap` ends the launcher after the game and Epic's cloud sync |
| `frontend/app/epic-launcher.ts` | Sends the `launch-hold` surface the Epic launcher-link copies to hold (`StoreEpicLaunchShortcuts`, read at start-up, when the setting turns on, after an Epic auto-add and after each launch), answers held launches after `StoreEpicPrelaunch`, ticks `StoreEpicReap` every 3 s while such a game runs |

**When auto-add runs:** once at start-up (after the collections are ready), when a toggle changes, and every 60 s
(`sensors/installs`). A game is requested once per session (`requested` in `store-sync`): a shortcut the user deletes is not
added again until Steam restarts, and a game whose add failed is not retried in a loop. An Epic manifest with
`bIsIncompleteInstall: true` (a download in progress) is not an installed game yet (`store_epic_local.installed`).

## Steam targets touched

None here. Auto-add writes through the `library-shortcuts` surface ([surfaces.md](surfaces.md#library-shortcuts)); the Epic
workaround holds Steam's Play through the `launch-hold` surface ([surfaces.md](surfaces.md#launch-hold)).

**Xbox UWP shortcuts (ADR-0058, U0):** `store_xbox_local.launch_spec` gives a UWP game (manifest `EntryPoint` is an app class)
its own exe in the package folder (`u0_spec`); GDK/Win32 packages keep `explorer.exe shell:AppsFolder\<pfn>!<app>`. After an app
update the folder name changes: `store_service.xbox_repairs` lists every shortcut whose exe is in a `WindowsApps` folder of an
installed UWP game (`pfn_from_path`, any version) but is not the current exe; `app/store-sync.repair` (start-up and the 60 s
install tick, while the Xbox store is on) has the `library-shortcuts` surface repoint it. `match` also accepts an older
version's folder, so an outdated shortcut is never a missing game.

**The Epic Steam Overlay Workaround (ADR-0057)** takes part only for a shortcut that is an Epic copy started through the
launcher link (`detect` says `via = "launch-link"`; `store_service.epic_launcher_shortcuts` lists them). Prelaunch closes nothing
for a request older than 3 s (`LATE`: the frontend lets Steam go on after 10 s). Else `tasklist` for `EpicGamesLauncher.exe`; with no download
pending, `taskkill /T /F /IM EpicGamesLauncher.exe` and up to 4 s for it to go. The reaper's phases: `waiting` (up to 180 s for the
manifest's `LaunchExecutable` image; then it gives up and leaves the launcher alone), `running`, `gone` after 5 s without the
image (back to `running` if the image comes back), then Epic's `Cloud Sync: Upload Complete <ns>:<item>:<AppName>` line in
`%LOCALAPPDATA%\EpicGamesLauncher\Saved\Logs\EpicGamesLauncher.log` written after the game was last seen (cap 30 s), then
`taskkill /T /F /PID` of each launcher started at or after the launch (PowerShell `Get-Process` start times, UTC; 15 s of slack
when the launch was not held). A pending download stops both steps. No command line is logged.

## Tests

`tests/test_store.lua` (hermetic, fixtures copied from live answers on 2026-10-02, plus a census of this PC's Epic
manifests): the local readers, each source over injected HTTP, the service's once-per-game lookups and `installed_games`.
`tests/test_ach_service.lua` (store rows, `store_achievements`), `tests/test_metadata_service.lua` and
`tests/test_media_service.lua` (store tiers). Frontend: `tests/app-store-copy.test.ts`, `tests/store-sync.test.ts`,
`tests/library-shortcuts.test.ts`, `tests/app-achievements.test.ts` (synced copies). Epic workaround: `tests/test_store_launch.lua`
(parsers, prelaunch, every reaper phase, pending, slack), `tests/launch-hold.test.ts`, `tests/epic-launcher.test.ts`. U0: `test_store.lua`
(entry point, `pfn_from_path`, older-version match, UWP vs GDK launch spec, `xbox_repairs`), `tests/store-sync.test.ts`, `tests/library-shortcuts.test.ts`.

## How to add a store

1. A local reader (`store_<name>_local.lua`): installed games and `match(entry, games)`, disk and registry only.
2. A `detect` branch in `store_service.lua` and its `kind` in `StoreKind` (`kernel/record.ts`).
3. Sources for what the store can give (game data, achievements), each through `net` with its own source id.
4. A row per service that uses it, after the services' own decisions (Steam first).
5. A block in the Third-party settings section.
GOG Galaxy fits this shape (its local database holds the games and the unlocks).

## History

- 2026-10-02 (ADR-0056): created, with research rounds 1 and 2 in [the plan](https://github.com/gunCannoli/millennium-plugins/blob/9a7df2b/docs/plans/steam-cartridges-store-copies-plan.md).
