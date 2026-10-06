# Freshness and ingestion

**This doc's job:** when a part of a record is stale, which shortcuts are new, and how outgoing HTTP is limited.
Part of the steam-cartridges architecture (ADR-0039); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

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
function M.remember_error(appid, part, now_ms, part_value) end  -- M10: session memory, identity and artwork
function M.recent_error(appid, part, now_ms) end   -- the error part seen less than TTL.error ago, or nil
function M.forget_error(appid, part) end
-- backend/registry.lua
function M.shortcut(appid) end          -- M10: the shortcuts.vdf entry; the one lookup every service uses
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
| achievements `ok`, source `retroachievements` | 30 min | one profile plays on several devices: a page open asks the profile's unlocks again (ADR-0060 amendment), at most this often per game so RetroAchievements is not asked too much |
| achievements `ok`, source `epic` / `xbox` | 15 min | the store's unlocks, synced on open (ADR-0056) |
| media `ok` (igdb / screenscraper) | 7 days | trailers and art rarely change (features plan F2) |
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

**Recent errors (M10, ADR-0044).** An identity or artwork lookup that failed is answered from memory by `EnsureFresh`
for `TTL.error` (30 min), so the frontend keeps no retry timer (`app/session-memo.ts` remembers only `ok` and
`unsupported`). A saved mapping always wins over a remembered identity error; a Steam match always asks for artwork
again.

**Remembered statuses (ADR-0060).** `touch(appid, part, now, status)` also writes `<part>_status` in
`freshness.json` when the check was `unsupported` or `error` (an `ok` clears it). `fresh_policy.remembered(appid, part,
now)` answers that status while it has not come due (`unsupported`: `TTL.unsupported`, 24 h; `error`: `TTL.error`,
30 min). `EnsureFresh(["achievements"])` with nothing stored answers it instead of asking every source again (it used
to, on every view, ingest run and observer poll); `force` asks again. A failed refresh of a stored achievements part
keeps the stored part. A user's "no achievements" mark (`status = "none"`) is never stale.

**The paint (`noNetwork`, ADR-0060).** `EnsureFresh` with `context.noNetwork` never asks a source: metadata and
achievements answer what is stored, with `stale = true` when it is due (metadata: only when a source could refresh it)
or when nothing usable is stored (`pending`). A Steam match's metadata answers `pending`/`stale` (its Game Info is
Steam's own store item, never stored; `appdetails` is never asked here).

## Frontend (M7b)

- **`frontend/app/ingest.ts`** (`createIngest`, replaces `features/scraper/sync-manager.ts`). At start-up
  (`background-sync` switch, `triggerSync(3000)` as before; `ready()` waits for the auto-routing profiles, the collections
  and the start-up preloads, so `needsFetch` reads filled records) it calls `GetNewShortcuts()` and, for each new shortcut
  or one missing metadata or achievements, one at a time and 300 ms apart, `EnsureFresh` **one part per call** (ADR-0060:
  shorter host holds) with the route and the allowed services from `domain/routing`, then `MarkKnown`. Every ingest call
  uses the `background` lane.
  A `steam-store` shortcut asks identity first: a native match needs only achievements (its Game Info is read from Steam when
  its page opens, never persisted), no match asks metadata (IGDB, then ScreenScraper) and achievements. Route `none` fetches
  nothing (ADR-0035) and is still marked known. A backend `paused` answer for a source the job uses stops the run and leaves
  that shortcut unknown, so it is retried next time. `startSync({ forceAll, onlyAppids })` (the panel's "sync") walks the
  library instead of the registry, with `ctx.force = forceAll`; the backend never refreshes a manual edit. Progress keeps the
  `SyncProgress` shape (`isSyncing`, `total`, `current`, `currentGame`, `phase`). It writes **no records**: the backend
  persists what it fetches and a record picks it up on the shortcut's next view (writing a record per shortcut at start-up
  makes every record-driven surface render at once, knowledgebase Part 7).
- **`frontend/app/view.ts`** (`createView`, was `features/source-view.ts`), ADR-0060 "paint from disk, then refresh":
  (1) Game Info and achievements as stored (`noNetwork`, view lane); (2) the store copy, then (steam-store bucket) the
  Steam match; (3) a source is asked only for a part the paint marked `stale` or could not answer, Game Info first, then
  achievements (view lane), then artwork (`normal`) and community media (`media`). A Steam match always asks for its Game
  Info (Steam's store item). Route `none` asks nothing; a `pending` route paints local Game Info and stored achievements
  and is replayed when collections load. `features/scraper/on-update.ts`
  is gone: captures republish on every view (sensors), unlocks load through `app/achievements.ts`, metadata through the TTL.
- The settings panel reads progress and calls `triggerSync` through `settings.ts` (`setSyncSource`, `useSyncProgress`), a D3
  setter like routing. `steam_cartridges_sync_history_v1` in `localStorage` is now ignored, not deleted (M9 decides).

## Files

| File | Role |
| --- | --- |
| `backend/net.lua` | The one HTTP entry point, counters, breakers |
| `backend/fresh_policy.lua` | TTL table, `freshness.json` |
| `backend/registry.lua` | `known_shortcuts.json`, new shortcuts |
| `backend/record_rpc.lua` | `GetNewShortcuts`, `MarkKnown`, the freshness use in `EnsureFresh` |
| `backend/metadata_service.lua` | The refresh rule for local records |
| `frontend/app/ingest.ts`, `frontend/app/view.ts` | The background job and the view pipeline (M7b) |
| `backend/steam_store_throttle.lua`, `web_igdb.lua`, `web_sgdb.lua`, `retroachievements.lua`, `screenscraper_media.lua`, `achievements_store.lua`, `steam_store_rpc.lua` | Call `net` instead of `http` |
| `backend/bin_http.lua` (only through `net.get_binary`) | Binary bodies into memory (features plan F2) |

## Steam targets touched

None.

## May import / must never import

Nothing outside `backend/net.lua` may `require("http")` (`git grep -n 'require("http")' -- backend` lists only `net.lua` and
the SDK stub). A new network source picks a `source` id and calls `net`.

## Tests

Frontend: `tests/app-ingest.test.ts` (12: startup ingests only new shortcuts, pacing is sequential, a paused result stops the run,
a source the job does not use does not, force sets `ctx.force`, `onlyAppids`, routes decide the parts, steam-store identity first,
progress shape, no parallel runs) and `tests/app-view.test.ts` (6: order per route, pending replay, leaving steam-store, coalescing).
Backend: `tests/test_freshness.lua` (43 checks, hermetic, clock injected): each TTL row; custom override never forced (K15);
a stale record refreshes once and again at once adds no request; a refresh that finds nothing keeps the record and retries
after 30 min; `noNetwork` and no allowed source never refresh; first run seeds; a new shortcut is reported until marked
known; signed appids; 429 pauses 30 min; 5 failures pause 15 min; a paused source makes no request; `http_calls` counts
per source; a throwing transport is an error result.

Live (2026-09-29): the first start seeded `known_shortcuts.json` with all 220 shortcuts and `GetDiagnostics().http_calls` was empty; the
first open of a game whose metadata had never been checked refreshed it (`http_calls.igdb` +3: an IGDB lookup is a token
request, the search and a fallback query, so count *refreshes*, not requests); re-opening it, or opening it after another game,
added none. With Firestriker removed from `known_shortcuts.json` while Steam was closed, the next start fetched exactly that game
(`igdb` 2 requests, a `freshness.json` entry, back to 220 known) and nothing else. The 24 h expiry and `custom_override` are covered
by `tests/test_freshness.lua`; neither could be shown live without changing your data (no custom record exists; the clock cannot
be moved).

## How to add a source

1. Call `net.get` / `net.post` with a new `source` id (it gets a counter and breaker for free).
2. If its result is a record part, add its TTL row to `fresh_policy.TTL` and a test.

## History

- M7a (2026-09-29): created. `net.lua`, `fresh_policy.lua`, `registry.lua`; every `require("http")` in the backend moved to
  `net`; `GetNewShortcuts`, `MarkKnown`, `GetDiagnostics` `http_calls`/`paused`; K15 fixed (a forced refresh never
  overwrites a manual edit). Nothing calls the new RPCs until M7b.
- M7b (2026-09-29): `app/ingest.ts` and `app/view.ts` added; `features/scraper/` and `features/source-view.ts` deleted. The
  start-up job fetches only new shortcuts (user decision 2); a page open refreshes only stale parts. `EnsureFresh` reports
  `paused` sources and `metadata_service` writes no fallback record while IGDB or ScreenScraper is paused.
- M7 live verification (2026-09-29): see Tests. No defect found.
- M10 (2026-09-30): `fresh_policy` remembers recent identity and artwork errors; `registry.shortcut` is the one `shortcuts.vdf` lookup.
