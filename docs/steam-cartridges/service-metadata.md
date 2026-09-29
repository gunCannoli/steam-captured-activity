# Metadata service

**This doc's job:** metadata resolution — which Game Info to show for a
shortcut? Part of the steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

- Selecting Game Info for a shortcut (`metadata` part of the record): the
  local `library_metadata.json` record, the mapped native app's Steam Store
  data, or an IGDB fetch — in that order, per the routing policy's evaluated
  bucket (`frontend/domain/routing`, ADR-0040, taken as opaque context).
- The one place `library_metadata.json` is read or written for selection
  (`web_metadata_db.lua`, unchanged format, § 4.3). Native Steam metadata
  (a mapped app's Store data) is **never** persisted (steam_store_store.lua
  rule, extended here).
- Manual edits (`custom_override = true`) always win, whatever the route.

It does **not** own identity resolution (`service-resolver.md`, M4b) or
artwork (M5c): it reads the saved identity (`resolve_identity.saved`) and
takes the evaluated route as opaque context, never re-deriving either.

## Contract

```lua
-- backend/metadata_service.lua
local M = {}
M.deps = {
  igdb_fetch = nil,       -- nil = igdb.fetch_game_metadata (backend/web_igdb.lua)
  appdetails_fetch = nil, -- nil = appdetails.fetch (backend/steam_store_appdetails.lua)
  shortcut_info = nil,    -- nil = web_rpc.get_shortcut_info
  now = function() return os.time() end,
}
--- Disk only: the local library_metadata.json record as a metadata part, or nil.
function M.local_part(appid) end
--- Full resolution: custom override -> local db -> steam appdetails/storeItem
--- -> igdb -> fallback. Returns a Part (table).
--- ctx = { title=, route={bucket=,via=}, storeItem=?, allowWeb=?, noNetwork=? }
function M.ensure(appid, ctx) end
return M
```

```lua
-- backend/record_rpc.lua (M4b; extended here with "metadata" and GetAllRecords)
RPC.GetGameRecord  = method("GetGameRecord",  function(d) --[[ {appid} ]] end)                -- -> { appid, parts }
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
   "local_db"`; none, `ctx.allowWeb` and not `ctx.noNetwork` → `igdb_fetch` →
   persist → `ok` `source = "igdb"`; IGDB no match → persist the fallback
   record exactly as the old `GetGameMetadata` did → `ok` `source =
   "fallback"`; not allowed → `pending`.
5. `route.bucket == "none"` → a local record → `ok` `source = "local_db"`;
   none → `unsupported`.
6. Every returned part gets `checkedAt = now() * 1000` (ms).

The service reads identity from disk only (`resolve_identity.saved`); it
never triggers an identity resolution itself. A caller that needs both fresh
calls `EnsureFresh(appid, ["identity", "metadata"], ctx)`, which resolves
identity first in the same round trip (`record_rpc.lua`'s part loop runs in
request order).

## Files

| File | Role |
| --- | --- |
| `backend/metadata_service.lua` | Selection order above |
| `backend/record_rpc.lua` | `GetGameRecord`, `EnsureFresh`, `GetAllRecords` — the record facade |
| `backend/web_metadata_db.lua` | Persisted `library_metadata.json` (unchanged format, `custom_override` rule) |
| `backend/steam_store_appdetails.lua` | Store appdetails fetch + `to_metadata` (mapped native apps, in-memory 7-day TTL cache) |
| `backend/web_igdb.lua` | IGDB search + match scoring (`fetch_game_metadata`) |
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
24 checks: the selection order above (including the six cases ported by name
from the now-deleted `tests/game-info-policy.test.ts`), `steam-store metadata
is never written to library_metadata.json`, `GetAllRecords is disk only`. Add
to `package.json` `test:lua`.

Live: none required by M5a (nothing calls the `metadata` part or
`GetAllRecords` yet); § 0.5's full baseline still applies since
`record_rpc.lua` changed (backend loads: the log shows `Backend loaded.`).

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
