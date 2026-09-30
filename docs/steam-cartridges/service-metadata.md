# Metadata service

**This doc's job:** metadata resolution — which Game Info to show for a
shortcut? Part of the steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

- Selecting Game Info for a shortcut (`metadata` part of the record): the
  local `library_metadata.json` record, the mapped native app's Steam Store
  data, or an IGDB fetch — in that order, per the routing policy's evaluated
  bucket (`frontend/domain/routing`, ADR-0040, taken as opaque context).
- The one place `library_metadata.json` is read or written for selection
  (`web_metadata_db.lua`, unchanged format, § 4.3). Native Steam metadata
  (a mapped app's Store data) is **never** persisted (steam_store_store.lua
  rule, extended here).
- Manual edits (`custom_override = true`) always win, whatever the route. `save_custom` / `clear_custom` store and drop one (the Game Data editor, F1); `clear_custom` only removes a record that is a manual edit.

It does **not** own identity resolution (`service-resolver.md`, M4b) or
artwork (M5c): it reads the saved identity (`resolve_identity.saved`) and
takes the evaluated route as opaque context, never re-deriving either.

## Contract

```lua
-- backend/metadata_service.lua
local M = {}
M.deps = {
  screenscraper_fetch = nil, -- nil = ScreenScraper jeuInfos via screenscraper_media.fetch_jeu, mapped
                             -- by M.screenscraper_to_metadata; fun(appid, title, shortcut_info)
  igdb_fetch = nil,       -- nil = igdb.fetch_game_metadata (backend/web_igdb.lua)
  appdetails_fetch = nil, -- nil = appdetails.fetch (backend/steam_store_appdetails.lua)
  shortcut_info = nil,    -- nil = web_rpc.get_shortcut_info
  now = function() return os.time() end,
}
--- Disk only: the local library_metadata.json record as a metadata part, or nil.
function M.local_part(appid) end
--- Full resolution: custom override -> local db -> steam appdetails/storeItem
--- -> igdb -> fallback. Returns a Part (table).
--- ctx = { title=, route={bucket=,via=}, identity=?, storeItem=?, allowWeb=?, allowScreenscraper=?, noNetwork=? }
function M.ensure(appid, ctx) end
--- A ScreenScraper `jeu` record -> our metadata (the M5d field mapping below).
function M.screenscraper_to_metadata(jeu, appid, title) end
return M
```

```lua
-- backend/record_rpc.lua (M4b; extended here with "metadata" and GetAllRecords)
RPC.EnsureFresh    = method("EnsureFresh",    function(d) --[[ {appid, parts, context} ]] end) -- -> { appid, parts }
RPC.GetAllRecords  = method("GetAllRecords",  function(_) end)                                  -- -> { records }
```

**Selection order** (`M.ensure`, each line is one test in
`tests/test_metadata_service.lua`):

1. A local record with `custom_override = true` → `ok`, `source = "custom"`,
   whatever the route (user edits win).
2. `route.via == "pending"` → a local record → `ok` `source = "local_db"`;
   none → `pending`. No network.
3. `route.bucket == "steam-store"` and the saved identity has a native match:
   `ctx.storeItem` present → `ok` with it, `source = "steam-store"`, **not
   persisted**; else `appdetails_fetch(native.appid)` → `to_metadata` → `ok`,
   `source = "steam-appdetails"`, not persisted; an appdetails error → the
   local record if any (unchanged `source`) with `status = "error"`, else
   `{ status = "error" }` with no data.
4. `route.bucket == "steam-store"` and the saved identity has no native match
   (or is not known — `resolve_identity.saved` returned nil), or
   `route.bucket == "web-scraping"`: a local record → `ok` `source =
   "local_db"`; none, and (`ctx.allowWeb` or `ctx.allowScreenscraper`) and not
   `ctx.noNetwork` → **IGDB first** (`igdb_fetch`, when `allowWeb`) → persist →
   `ok` `source = "igdb"`; **IGDB not configured, not allowed, or no match →
   ScreenScraper** (`allowScreenscraper`, M5d) → persist → `ok` `source =
   "screenscraper"`; neither finds anything → persist the fallback record
   exactly as the old `GetGameMetadata` did → `ok` `source = "fallback"`; no
   source allowed → `pending`. A throwing provider is silent (ADR-0014): the
   next tier runs.
5. `route.bucket == "none"` → a local record → `ok` `source = "local_db"`;
   none → `unsupported`.
6. Every returned part gets `checkedAt = now() * 1000` (ms).

The service reads identity from disk only (`resolve_identity.saved`); it
never triggers an identity resolution itself. A caller that needs both fresh
calls `EnsureFresh(appid, ["identity", "metadata"], ctx)`, which resolves
identity first in the same round trip (`record_rpc.lua`'s part loop runs in
request order).

**ScreenScraper mapping** (M5d, decided with the user): `synopsis` → `description` (English
first, else the first language available); `developpeur` → `developers`; `editeur` → `publishers`;
`familles` → `franchises`; `dates` → `release_date` = the **earliest** regional date (Steam shows one original
release date); `joueurs` → `categories.single_player` (min players is 1) and `categories.multiplayer` (max players
> 1); `genres` → `genres` (stored, not displayed by Steam). Co-op, split screen and controller flags are not
provided by ScreenScraper and are left unset (controller support keeps coming from the emulator inference,
ADR-0038). The lookup reuses `screenscraper_media.fetch_jeu` (jeuInfos.php, the ROM name/CRC/MD5 and console id
from the shortcut, or the title as the search name when there is no ROM); the media source shares the same client
and cache. Credentials are read only by `web_config` and sent only to `api.screenscraper.fr`; the request URL,
which carries them, is never logged.

## Files

| File | Role |
| --- | --- |
| `backend/metadata_service.lua` | Selection order above |
| `backend/record_rpc.lua` | `EnsureFresh`, `GetAllRecords` — the record facade (`GetGameRecord` removed in M10) |
| `backend/web_metadata_db.lua` | Persisted `library_metadata.json` (unchanged format, `custom_override` rule) |
| `backend/steam_store_appdetails.lua` | Store appdetails fetch + `to_metadata` (mapped native apps, in-memory 7-day TTL cache) |
| `backend/web_igdb.lua` | IGDB search + match scoring (`fetch_game_metadata`) |
| `backend/screenscraper_media.lua` | `fetch_jeu` and `jeu_for` (the jeuInfos client, shared with the media service, [service-media.md](service-media.md)) — the ScreenScraper metadata source |
| `backend/web_rpc.lua` | `get_shortcut_info`; pre-M5a `GetGameMetadata`/`RefreshGameMetadata`/`GetAllMetadata` (kept as aliases until M9) |

## Steam targets touched

None. This is a backend service; only surfaces write to Steam.

## May import / must never import

Backend Lua modules are not covered by `tests/architecture.test.ts` (frontend
only). By convention: `metadata_service.lua` may require `resolve_identity`,
`web_metadata_db`, `steam_store_appdetails`, `web_igdb`, `web_rpc`; it must
never require a frontend module (there are none to require) or write native
Steam Store data to `library_metadata.json`.

## Tests

`tests/test_metadata_service.lua` (hermetic; no network, no Steam install),
the selection order above (including the six cases ported by name
from the now-deleted `tests/game-info-policy.test.ts`), `steam-store metadata
is never written to library_metadata.json`, `GetAllRecords is disk only`. Add
to `package.json` `test:lua`.

Live: M5b's exit checks — `steam-cartridges/tests/live/audit_missing_metadata.mjs` (`0 missing`), AM2R Game Info intact
with route `none`, WUCHANG Game Info from the Steam store, a web-scraping game shows its IGDB data,
`count_cycle.mjs` PASS, § 0.5 full baseline, switch-off `game-info`.

## How to add a source

Metadata has two fetch sources today (Steam Store appdetails, IGDB) tried in
a fixed order after the local-db tier. A future source (e.g. ScreenScraper,
M5d) adds a step in the same tier, gated by its own `ctx` field and a routing
service check — never inline in `M.ensure`'s existing branches, and never
ahead of a configured, allowed higher-priority source without an explicit
decision (M5d: IGDB first when configured, ScreenScraper fills in).

## History

- M5a (2026-09-29): created. `metadata_service.lua` (a port of
  `features/game-info/policy.ts` `gameInfoPlan` + `features/steam-store/index.ts`
  `loadNative` + `web_rpc.lua` `GetGameMetadata`'s selection) and
  `record_rpc.lua` extended with `metadata` and `GetAllRecords`. Nothing calls
  the new part or RPC yet — the frontend adopts them in M5b.
- M5b (2026-09-29): wired. `app/metadata.ts` calls `EnsureFresh(["metadata"])` per view and
  `GetAllRecords()` once at start-up (replacing the old `getAllMetadata`/`initGameInfo` preload).
  `frontend/surfaces/game-info` is now record-driven for `metadata` (`surfaces.md`); the old push
  pipeline (`features/game-info/index.ts`, `policy.ts`, `tests/game-info-policy.test.ts`) is deleted.
- M5c (2026-09-29): two fixes to the M5b wiring. `app/metadata.ts` now sends the shortcut's real title (it sent
  `""`, so IGDB would have searched for nothing), and passes the identity it knows as `ctx.identity`:
  an `ok` identity with no native match is never persisted, so a `steam-store` shortcut with no Steam
  match could not reach the IGDB tier (ADR-0036 fallback). `metadata_service.lua` reads `ctx.identity` first,
  then the saved mapping; identity `ok` or `unsupported` (emulator launcher) falls through to the web tier,
  `pending`/`error` stays local-only. Two Lua checks added.
- M5d (2026-09-29): ScreenScraper metadata source. `metadata_service.lua` gains `screenscraper_to_metadata` and the
  IGDB → ScreenScraper → fallback order (`ctx.allowScreenscraper`, from `services.screenscraperEnabled` and the routing
  service `screenscraper`); `screenscraper_media.lua` exposes `fetch_jeu` (`fetch_media` now builds on it, behaviour
  unchanged). Tests use a hand-shaped `tests/fixtures/screenscraper-jeu.json` (no network in the test environment):
  compare it with a real `jeuInfos.php` response during live verification.
- M5b fix (2026-09-29, found in live verification): `app/metadata.ts` `preload()` wrote `identity` as well as
  `metadata` for every mapped shortcut at start-up. Every record-driven surface then rendered for all of them, and
  `captures` requested Steam's `GetAppActivity` for each mapped native app before Steam was ready, which left those
  fetches stuck (knowledgebase Part 7). `preload()` now writes `metadata` only; identity resolves on first view.
- M5d live check (2026-09-29): real `jeuInfos.php` responses (Sonic The Hedgehog, Streets of Rage 2) fetched with the
  `.env` credentials matched the hand-shaped fixture's field shapes and mapped correctly through
  `screenscraper_to_metadata` (English synopsis, `{id,text}` credits, `noms`-list genres and families, earliest date,
  `joueurs` `{"text":"1-2"}` -> single and multiplayer). Test-harness note: the stub JSON decoder in the Lua suites has no
  `utf8`, so a raw response with `\u` escapes must be re-serialized before use; the backend uses Millennium's own JSON.
- M10 (2026-09-30): `metadata_service` no longer requires `web_rpc` (the shortcut comes from `registry.shortcut`);
  the frontend adds `badge_category_ids` to the part (`app/metadata`, `domain/category-policy`); `GetGameRecord` removed.
