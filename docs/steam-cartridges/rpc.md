# RPC inventory

**This doc's job:** every backend RPC method registered as a global in
`backend/main.lua`, classified live / unwired / dead, so a future step never
has to re-derive which ones the frontend actually calls. Part of the
steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).
Created in M4.0; extended by M4b and M5a as the record facade RPCs
(`GetGameRecord`, `EnsureFresh`, `GetAllRecords`) are added.

## What it owns

The classification of every RPC method Millennium exposes as a global to
the frontend (`backend/main.lua`'s assignments), and the rule that keeps it
current: a step that adds, removes or rewires an RPC updates this table in
the same commit. Nothing else tracks which backend methods are actually
called.

## Contract

Not applicable — this doc is an inventory, not a layer with exported types.

## Classification (M4.0, verified 2026-09-28 against tree `06d00f8`)

**live**: the frontend calls it (`frontend/rpc.ts` after M3.0).
**unwired**: implemented and registered, no frontend caller, a feature the
user wants — stays registered (deleting a registered-but-uncalled method is
safe; the backend risk runs the other way: an unregistered method the
frontend calls crashes the host). See § 7.10 of the migration plan for the
step that connects each one.
**dead**: no caller and no feature behind it. None found — the inventory
below matches the migration plan § 4.0 (M4.0) expected table exactly.

| RPC | Backend module | Class | Note |
| --- | --- | --- | --- |
| `GetLibraryStats` | `rpc.lua` | live | library grid capture timestamps |
| `GetDiagnostics` | `rpc.lua` | live (debug) | no frontend caller; called directly from the SharedJSContext console. Documented in [millennium-architecture.md](../millennium-architecture.md); M7 adds `http_calls` |
| `GetStatus` | `web_rpc.lua` | live | provider status |
| `GetGameMetadata` | `web_rpc.lua` | live | Game Info fetch |
| `RefreshGameMetadata` | `web_rpc.lua` | live | forced Game Info re-fetch |
| `GetAllMetadata` | `web_rpc.lua` | live | bulk local Game Info cache |
| `SaveGameMetadata` | `web_rpc.lua` | unwired | § 7.10: manual Game Info editing (`custom_override`); no UI yet |
| `GetArtworkForGame` | `web_rpc.lua` (→ `web_sgdb.lua`) | unwired | § 7.10: SteamGridDB artwork (M5c) |
| `GetControllerInference` | `web_rpc.lua` | live | controller support badges |
| `GetAutoRoutingProfiles` | `web_rpc.lua` | live | auto-routing bucket profiles |
| `SaveServiceCredentials` | `web_rpc.lua` | live | settings panel service credentials |
| `SteamStoreGetState` | `steam_store_rpc.lua` | live | steam-store bucket state |
| `SteamStoreGetMapping` | `steam_store_rpc.lua` | live | shortcut → native appid lookup |
| `SteamStoreSetMapping` | `steam_store_rpc.lua` | live | manual mapping |
| `SteamStoreSaveKnownMatch` | `steam_store_rpc.lua` | live | accept a suggested match |
| `SteamStoreSearch` | `steam_store_rpc.lua` | live | store search |
| `SteamStoreClearMapping` | `steam_store_rpc.lua` | live | unmap / reject |
| `SteamStoreRejectSuggestion` | `steam_store_rpc.lua` | unwired | § 7.10: reject a suggestion in the Steam Store settings list; no UI yet (Lua-tested: `test_steam_store.lua` "rejecting a suggestion removes it and remembers it") |
| `SteamStoreGetAppDetails` | `steam_store_rpc.lua` | live | native app details for Game Info parity |
| `SteamStoreRecordArtwork` | `steam_store_rpc.lua` | live | records which artwork slots were applied |
| `SteamStoreDownloadImage` | `steam_store_rpc.lua` | live | artwork image fetch (allowlisted hosts) |
| `CartridgesAchievementsGet` | `achievements_rpc.lua` | live | achievement state for a shortcut |
| `CartridgesAchievementsUnlock` | `achievements_rpc.lua` | live | manual unlock |
| `CartridgesAchievementsReset` | `achievements_rpc.lua` | live | reset local achievements |
| `CartridgesAchievementsCheckUnlocks` | `achievements_rpc.lua` | live | poll for new unlocks |
| `CartridgesAchievementsGetRetroStatus` | `achievements_rpc.lua` | live | RetroAchievements connection status |
| `GetGameMedia` | `screenscraper_media.lua` | unwired | § 7.10: ScreenScraper media (Media service after M7) |
| `GetGameManual` | `screenscraper_media.lua` | unwired | § 7.10: ScreenScraper media (Media service after M7) |
| `GetGameTrailers` | `igdb_community.lua` | unwired | § 7.10: IGDB community (Media service after M7) |
| `GetGameCommunityLinks` | `igdb_community.lua` | unwired | § 7.10: IGDB community (Media service after M7) |
| `GetGameRecord` | `record_rpc.lua` | unwired | M4b: still no caller; M5a extends it with `metadata`. No frontend caller as of M5b either — `app/identity.ts` and `app/metadata.ts` both use `EnsureFresh`/`GetAllRecords` instead |
| `EnsureFresh` | `record_rpc.lua` | live | M4c: `app/identity.ts`'s `ensure()` calls it for `["identity"]`, once per appid per session; M5a extends it with `metadata`, wired by `app/metadata.ts`'s `ensure()` in M5b |
| `GetAllRecords` | `record_rpc.lua` | live | M5a: disk-only bulk read (every DB record + every saved mapping); M5b's `app/metadata.ts` `preload()` calls it once at start-up, replacing the frontend's old `getAllMetadata`/`initGameInfo` preload |

**Result:** 25 live (24 + 1 debug), 7 unwired, 0 dead (M4.0). M4b added 2 more
unwired (the record facade); M4c wires `EnsureFresh` (26 live, 6 unwired). M5a
adds `GetAllRecords` (unwired) and extends `EnsureFresh` with `metadata`
(26 live, 7 unwired); M5b wires `GetAllRecords` and the `metadata` part of
`EnsureFresh` (27 live, 6 unwired). `GetGameRecord` stays unwired throughout.

## Record facade (M4b)

`GetGameRecord(appid)` returns `{ appid, parts }` from disk only (no network).
`EnsureFresh(appid, parts, context)` runs the named parts through their
service and returns the updated record; unknown part names are ignored.
Both reject a native appid (`appid < 2^31`) with `{ error = "not a shortcut" }`.

```lua
-- backend/record_rpc.lua
RPC.GetGameRecord = method("GetGameRecord", function(d) --[[ {appid} ]] end)                -- -> { appid, parts }
RPC.EnsureFresh   = method("EnsureFresh",   function(d) --[[ {appid, parts, context} ]] end) -- -> { appid, parts }
```

As of M4b only `"identity"` is a resolvable part (`backend/resolve_identity.lua`).
`context.route = { bucket, via }` is the frontend's evaluated routing policy
(ADR-0040); `context.title` and `context.owned` (native candidates Steam
already knows) come from the frontend sensors. See
[service-resolver.md](service-resolver.md) for the resolution order.

## Metadata service (M5a)

`"metadata"` is now a resolvable part (`backend/metadata_service.lua`); `EnsureFresh(appid,
["identity","metadata"], ctx)` resolves identity first in the same call, so a caller with an
unknown identity never needs two round trips. `GetGameRecord` also returns `metadata` from disk
(`metadata_service.local_part`). New `GetAllRecords()` → `{ records = { ["<appid>"] = { identity?,
metadata? } } }` for every `library_metadata.json` record and every saved `steam_store.json`
mapping, disk only — the bulk read M5b's frontend uses instead of the old `getAllMetadata` preload.

```lua
-- backend/record_rpc.lua (extended)
RPC.GetAllRecords = method("GetAllRecords", function(_) end) -- -> { records }
```

`context.storeItem` (identity has a native match, frontend's StoreItemCache data — not persisted),
`context.allowWeb` (igdb enabled and allowed by routing) and `context.noNetwork` (disk and context
only, for bulk re-evaluation) are metadata-only context fields; see
[service-metadata.md](service-metadata.md) for the selection order. `app/metadata.ts` calls the
`metadata` part per view (M5b) and `GetAllRecords()` once at start-up.

## Ports (M4c)

`frontend/ports/transport.ts` — `call<R>(name, payload)`, moved verbatim from
`rpc.ts` (which now imports it; `[/^rpc$/, /^ports$/]` in `LAYER_RULES`,
temporary until M9 folds `rpc.ts` into `ports/`). `frontend/ports/backend.ts`
is the typed client for the record facade:

```ts
// frontend/ports/backend.ts
export interface OwnedCandidate { appid: number; name: string }
export interface FreshContext { title: string; route: {...}; owned?: OwnedCandidate[]; ... }
export interface RecordResponse { appid: number; parts: Partial<Record<RecordPart, Part<unknown>>>; error?: string }
export const backend: {
    getGameRecord(appid: number): Promise<RecordResponse>;
    ensureFresh(appid: number, parts: RecordPart[], ctx: FreshContext): Promise<RecordResponse>;
    getAllRecords(): Promise<{ records: Record<string, RecordResponse["parts"]> }>;
};
```

`app/identity.ts` calls `backend.ensureFresh` (M4c); `app/metadata.ts` calls
`backend.ensureFresh` and `backend.getAllRecords` (M5b). The RPC
registration test scans both `rpc.ts` and `ports/backend.ts` for method names
that must be registered in `backend/main.lua`.

## Files

| File | Role |
| --- | --- |
| `backend/main.lua` | The only place a backend method becomes a frontend-callable global |
| `frontend/rpc.ts` | Every live RPC's frontend wrapper (the source of truth for "the frontend calls it") |
| `tests/architecture.test.ts` | RPC registration check: every name `rpc.ts` calls must be assigned as a global in `main.lua`, or the call crashes the backend host |

## Steam targets touched

None. This doc only tracks backend↔frontend wiring.

## May import / must never import

Not applicable — an inventory doc, not a layer.

## Tests

`tests/architecture.test.ts`'s RPC registration check enforces the other
direction (every frontend call has a registered global); this table is the
inventory in the other direction (every registered global is classified).
Live: none — a docs-only step changes no runtime code path.

## How to keep this current

1. A step that adds an RPC: add its row here with its class, in the same
   commit that registers it in `main.lua`.
2. A step that wires an unwired RPC to a frontend caller: flip its class to
   live and update its Note to say which step did it (matches § 7.10's own
   "connects" column).
3. A step that finds a truly dead RPC (no caller, no feature behind it):
   delete it from `main.lua`, its Lua module if nothing else uses it, and
   its test lines — packaged per D10 — and move its row here to a short
   "removed" note instead of deleting the row outright, so the history stays
   legible.

## History

- M4.0 (2026-09-28): created. Full inventory of `backend/main.lua`'s 25
  registered globals: 25 live (incl. `GetDiagnostics`, debug-only), 7
  unwired (all previously logged in migration plan § 7.10), 0 dead. Matches
  the plan's expected table exactly — no deletions.
- M4b (2026-09-29): `GetGameRecord` and `EnsureFresh` added (`record_rpc.lua`),
  both unwired until M4c. `resolve_identity.lua`'s `launches_emulator` is now
  the one copy `steam_store_rpc.lua` shares (moved, not duplicated).
- M4c (2026-09-29): `EnsureFresh` wired — `frontend/ports/backend.ts` (new)
  calls it from `app/identity.ts`, which replaces the old up-to-three-round-trip
  `resolveMapping` in `features/steam-store/index.ts`. `frontend/ports/transport.ts`
  holds the `call()` function moved from `rpc.ts`. `GetGameRecord` stays unwired.
- M5a (2026-09-29): `backend/metadata_service.lua` added (a port of
  `features/game-info/policy.ts` `gameInfoPlan` + `features/steam-store/index.ts`
  `loadNative` + `web_rpc.lua` `GetGameMetadata`'s selection). `record_rpc.lua`'s
  `EnsureFresh` and `GetGameRecord` extended with `metadata`; new `GetAllRecords`.
  Nothing calls the `metadata` part or `GetAllRecords` yet — the frontend adopts
  them in M5b. `GetGameMetadata`/`RefreshGameMetadata`/`GetAllMetadata` stay
  registered as aliases (the settings panel and M7's sync still call them).
- M5b (2026-09-29): `metadata` part and `GetAllRecords` wired — `app/metadata.ts`
  (new) calls both from `ports/backend.ts` (extended with `getAllRecords`),
  replacing the old `getGameMetadata`/`getAllMetadata` frontend calls in the
  Game Info path. `main.lua` registers `GetAllRecords` (added in M5a but not
  yet wired as a global; fixed here). `GetGameRecord` stays unwired.
