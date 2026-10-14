# Provided games service

**This doc's job:** what extensions push about a shortcut, and how the core uses it. Part of the steam-cartridges
architecture (ADR-0039, ADR-0067); index: [steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

steam-cartridges knows no store. An extension that recognises a shortcut as one of its games (today
steam-cartridges-third-party: Epic Games Store and Xbox copies) finds the game's data itself and pushes it through the
extension API. How copies are found and the store APIs are read: [steam-cartridges-third-party.md](../steam-cartridges-third-party.md)
and [its stores doc](../steam-cartridges-third-party-stores.md).

## The extension API (1.2.0, `window.SteamCartridges`)

| Call | Core side | What it does |
| --- | --- | --- |
| `reportGame(appid, { source, title?, metadata?, media? }, { providerId })` | `app/provided.ts` → `ProvideGame` | Keeps the game in `provided_games.json`; the record's `provided` part becomes `ok`. A changed push re-reads Game Info and community media for that shortcut. |
| `reportAchievementSet(appid, { source, key, title?, achievements, unlocks }, { providerId })` | `app/achievements.ts` `ingestProvidedSet` → `ProvideAchievements` | Saves the set (`achievements_store.save_schema_and_sync`, schema id `<source>_<key>`); keeps Steam's own list when the Steam match covers every id. New unlocks: `achievements.synced` (Post-Game Summary and feed, never a toast). |
| `forgetGame(appid, { providerId })` | `app/provided.ts` → `ForgetProvidedGame` | Drops the pushed record; the `provided` part becomes `unsupported`. |
| `steam-cartridges:ready` (window event) | `index.tsx` | Fired once the API is installed, for an extension that loaded first. |

A push never throws into the extension (ADR-0014): a failure resolves to `{ ok: false }`.

## How the core uses it (backend, no network)

- **Game Info** (`metadata_service.lua`): after a Steam match and before IGDB / ScreenScraper, the pushed `metadata`
  (`store_source` = the push's `source`). A stored record another source wrote is replaced as soon as a push exists.
  Pushed Game Info needs no network, so the page's first paint can show it.
- **Community media** (`media_service.lua`): the pushed items first; a push newer than the stored list refreshes it at
  once. A Steam match keeps Steam's own community content.
- **Achievements** (`ach_service.lua`): source `provided`, first in the chain, answers the stored set when the shortcut
  was reported and the stored set is the pushed source's. The part's `source` is the pushed one ("epic", "xbox").
  `app/achievements.ts` treats a reported shortcut as synced: no in-game polling, not resettable from Steam Cartridges.
- **Steam match** (`resolve_identity.lua`): the pushed `title` is tried after the shortcut's name.
- `GetAllRecords` returns each `provided` part; `app/provided.ts` preloads them at start-up.

## Files

`backend/provided_store.lua` (data, `provided_games.json`), `backend/provided_rpc.lua` (the three RPCs),
`frontend/app/provided.ts`, `frontend/kernel/extensions.ts` (API types and the registry). Tests: `tests/test_ach_service.lua`
(pushed achievements), `tests/test_metadata_service.lua`, `tests/test_media_service.lua`, `tests/test_identity.lua`,
`tests/app-provided.test.ts`, `tests/app-achievements.test.ts`.
