# Resolver service

**This doc's job:** identity resolution — is this shortcut a Steam game? Part
of the steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

- Whether a shortcut has a native Steam match (`identity` part of the record),
  and where that match came from: a saved mapping, an owned-app candidate, or
  a store search.
- The one place `steam_store.json`'s mapping is read or written for
  resolution (`steam_store_store.lua`, unchanged format, § 4.3).
- `launches_emulator(appid)`: the emulator check every identity lookup and
  the Steam Store RPCs share (moved here from `steam_store_rpc.lua` in M4b;
  it is one copy, not two).

It does **not** own routing policy (`frontend/domain/routing`, ADR-0040) or
metadata/artwork (`service-metadata.md`, M5a): it takes the evaluated route
as opaque context and never re-derives it.

## Contract

```lua
-- backend/resolve_identity.lua
local M = {}
M.deps = {
  http_get = nil,          -- nil = steam_store_throttle.http_get (search.search's default)
  is_emulator = nil,       -- nil = launches_emulator(appid)
  now = function() return os.time() end,
}
--- Disk only: the saved mapping as an identity part, or nil. Never touches the network.
function M.saved(appid) end
--- Full resolution: saved mapping -> owned candidates -> store search. Returns a Part (table).
--- ctx = { title = string, owned = { {appid=, name=}, ... } | nil, route = { bucket=, via= } }
function M.ensure(appid, ctx) end
--- Is this shortcut launched through a known emulator? False when unknown.
function M.launches_emulator(appid) end
return M
```

```lua
-- backend/record_rpc.lua (M4b; M5a adds "metadata" and GetAllRecords)
RPC.EnsureFresh   = method("EnsureFresh",   function(d) --[[ {appid, parts, context} ]] end) -- -> { appid, parts }
```

**Resolution order** (`M.ensure`, each line is one test in `tests/test_identity.lua`):

1. `route.bucket ~= "steam-store"` → `{ status = "unsupported" }`. No disk write, no network.
2. A saved mapping exists (`M.saved`) → return it. No network.
3. `is_emulator(appid)` → `{ status = "unsupported" }` (same rule as the old `skipped = "emulator"`).
4. `title == ""` → `{ status = "pending" }`.
5. A unique owned candidate (`ctx.owned`) whose normalized name equals the
   normalized title, and is not rejected → `store.set_mapping(..., "owned")` →
   `ok` with `source = "owned"`. Two candidates with the same normalized name
   is no match (mirrors the frontend's `matchKnownIndex`, now retired in M4c).
6. Store search (`steam_store_search.search`): an exact hit not rejected →
   `set_mapping(..., "search")` + `remove_suggestion` → `ok` with
   `source = "search"`; exact but rejected, suggestions-only, or a negative
   cache hit → `ok` with no `native` in `data`; a transport/HTTP error →
   `{ status = "error", message }`.
7. Every returned part gets `checkedAt = now() * 1000` (ms).

## Files

| File | Role |
| --- | --- |
| `backend/resolve_identity.lua` | Resolution order above; `launches_emulator` (shared) |
| `backend/record_rpc.lua` | `EnsureFresh` — the record facade (M5a extends it; `GetGameRecord` removed in M10) |
| `backend/steam_store_store.lua` | Persisted mapping/suggestion/rejection state (`steam_store.json`, unchanged) |
| `backend/steam_store_search.lua` | Store search + classification (`exact` / `edition` / suggestions) |
| `backend/steam_store_normalize.lua` | Title normalization shared with the frontend's (now retired) `matchKnownIndex` |
| `backend/steam_store_rpc.lua` | The pre-M4b RPCs (`SteamStoreGetMapping` etc.), kept as aliases until M9; `launches_emulator` now required from here |

## Steam targets touched

None. This is a backend service; only surfaces write to Steam.

## May import / must never import

Backend Lua modules are not covered by `tests/architecture.test.ts` (frontend
only). By convention: `resolve_identity.lua` may require `steam_paths`,
`shortcuts`, `steam_store_emulators`, `steam_store_normalize`,
`steam_store_search`, `steam_store_store`, `steam_store_throttle`; it must
never require a frontend module (there are none to require) or duplicate
`launches_emulator`.

## Tests

`tests/test_identity.lua` (hermetic; no network, no Steam install), 16 checks:
the resolution order above, `GetGameRecord is disk only`, `EnsureFresh
ignores unknown parts`, `EnsureFresh rejects a native appid`. Add to
`package.json` `test:lua`. `tests/test_steam_store.lua`'s existing RPC checks
(`SteamStoreSaveKnownMatch` emulator skip, etc.) cover the shared
`launches_emulator` from the other side.

Live: none required by M4b (nothing calls the new RPCs yet); § 0.5's full
baseline still applies since `steam_store_rpc.lua` changed (backend loads:
the log shows `Backend loaded.`).

## How to add a source

Identity has exactly one path today (Steam Store). A future native-match
source (e.g. a different storefront) would add a step between 5 and 6 above,
gated by its own `ctx` field — never inline in `M.ensure`'s existing branches.

## History

- M4b (2026-09-29): created. `resolve_identity.lua` (a port of
  `features/steam-store/index.ts` `resolveMapping` plus the
  `SteamStoreSaveKnownMatch`/`SteamStoreSearch` RPC bodies) and
  `record_rpc.lua` (`GetGameRecord`, `EnsureFresh`), registered in `main.lua`.
  Nothing calls the new RPCs yet — the frontend adopts them in M4c.
- M10 (2026-09-30): `GetGameRecord` removed (never called); `launches_emulator` reads the shortcut through `registry.shortcut`.
