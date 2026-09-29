# Freshness and ingestion

**This doc's job:** when a part of a record is stale, which shortcuts are new, and how outgoing HTTP is limited.
Part of the steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

- **Freshness:** per `(appid, part)` the time of the last check, and the one TTL table that decides what is stale
  (`backend/fresh_policy.lua`, `<data dir>/freshness.json`, a new file).
- **New shortcuts:** which shortcuts the plugin has not seen yet (`backend/registry.lua`,
  `<data dir>/known_shortcuts.json`, a new file).
- **Outgoing HTTP:** the one entry point, per-source call counters and circuit breakers (`backend/net.lua`).
- **Ingestion** (frontend, M7b): the loop that fetches only new shortcuts in the background.

## Contract

```lua
-- backend/fresh_policy.lua
M.TTL                                   -- the table below
function M.is_stale(appid, part, info, now_ms) end   -- info: a status string or a Part { status, source, data }
function M.touch(appid, part, now_ms, status) end    -- status "error" is back-dated so it comes due after 30 min
function M.checked_at(appid, part) end
-- backend/registry.lua
function M.new_shortcuts() end          -- [{ appid, name, exe }] not seen before; first run seeds and returns []
function M.mark_known(appids) end
-- backend/net.lua
function M.get(url, opts) end           -- opts.source; returns the response, or nil, "paused" (no request)
function M.post(url, body, opts) end
function M.stats() end                  -- { http_calls = { [source] = n }, paused = { [source] = until } }
```

RPCs (`record_rpc.lua`): `GetNewShortcuts()` → `{ shortcuts }`; `MarkKnown({ appids })`. `GetDiagnostics()` gains
`http_calls` and `paused`.

**TTLs** (one table, `fresh_policy.TTL`; each row is a check in `tests/test_freshness.lua`):

| Part / status | TTL | Why |
| --- | --- | --- |
| any part, source `custom` | never | a user's manual edit is never refreshed (K15) |
| identity `ok` with a native match | never | a Steam match is sticky; the user clears it in settings |
| identity `ok` without a native match | 7 days | same as the store search's negative cache |
| metadata `ok` (igdb / screenscraper / fallback) | 24 h | Flow B |
| achievements `ok` | 24 h (the schema; unlocks are read by their own channels, Flow C) | |
| any part, `error` | 30 min | retry soon, never in a loop |
| `unsupported` | 24 h | a route, setting or credential may change |
| `pending`, `needs-setup` | always | cheap to ask again |

**How `EnsureFresh` uses it.** Metadata: a local record that is fresh is returned with no source call; a stale one is
refreshed (IGDB, then ScreenScraper) only when a source is allowed and the call is not `noNetwork`; a refresh that
finds nothing **keeps the old record** and retries after 30 min (it never replaces good data with the fallback);
`ctx.force` ignores the TTL but **never** a `custom_override` record (K15; `RefreshGameMetadata(force)` no longer
overwrites one either). Achievements: a stored schema younger than 24 h is returned from disk. Identity: the saved
match is sticky, and a check is recorded. A freshness write that fails costs only a later refetch, never a failed call.

**The registry rule.** The first call (no `known_shortcuts.json`) writes every current shortcut as known and returns
none, so an existing library is never fetched in one storm. After that a shortcut is reported until `MarkKnown`.
Appids are compared unsigned. The backend has no timer; the frontend drives the loop.

**Breakers.** HTTP 429 pauses that source for 30 min; 5 consecutive failures (a transport error or HTTP >= 500) pause it
for 15 min; a success resets the count; while paused a call returns `nil, "paused"` without a request. Sources:
`steam-store`, `igdb`, `retroachievements`, `steam-web`, `sgdb`, `screenscraper`. `steam_store_throttle` keeps its rate
limit and offline detection and calls `net`.

## Files

| File | Role |
| --- | --- |
| `backend/net.lua` | The one HTTP entry point, counters, breakers |
| `backend/fresh_policy.lua` | TTL table, `freshness.json` |
| `backend/registry.lua` | `known_shortcuts.json`, new shortcuts |
| `backend/record_rpc.lua` | `GetNewShortcuts`, `MarkKnown`, the freshness use in `EnsureFresh` |
| `backend/metadata_service.lua` | The refresh rule for local records |
| `backend/steam_store_throttle.lua`, `web_igdb.lua`, `igdb_community.lua`, `web_sgdb.lua`, `retroachievements.lua`, `screenscraper_media.lua`, `achievements_store.lua`, `steam_store_rpc.lua` | Call `net` instead of `http` |

## Steam targets touched

None.

## May import / must never import

Nothing outside `backend/net.lua` may `require("http")` (`git grep -n 'require("http")' -- backend` lists only `net.lua` and
the SDK stub). A new network source picks a `source` id and calls `net`.

## Tests

`tests/test_freshness.lua` (39 checks, hermetic, clock injected): each TTL row; custom override never forced (K15);
a stale record refreshes once and again at once adds no request; a refresh that finds nothing keeps the record and retries
after 30 min; `noNetwork` and no allowed source never refresh; first run seeds; a new shortcut is reported until marked
known; signed appids; 429 pauses 30 min; 5 failures pause 15 min; a paused source makes no request; `http_calls` counts
per source; a throwing transport is an error result.

## How to add a source

1. Call `net.get` / `net.post` with a new `source` id (it gets a counter and breaker for free).
2. If its result is a record part, add its TTL row to `fresh_policy.TTL` and a test.

## History

- M7a (2026-09-29): created. `net.lua`, `fresh_policy.lua`, `registry.lua`; every `require("http")` in the backend moved to
  `net`; `GetNewShortcuts`, `MarkKnown`, `GetDiagnostics` `http_calls`/`paused`; K15 fixed (a forced refresh never
  overwrites a manual edit). Nothing calls the new RPCs until M7b.
