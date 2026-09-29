# Artwork service

**This doc's job:** artwork resolution — which art may a shortcut get, and from where? Part of
the steam-cartridges architecture (ADR-0039); index:
[steam-architecture.md § 3](../steam-architecture.md#3-steam-cartridges-architecture-layers).

## What it owns

- The `artwork` part of a record: the source (Steam CDN for a shortcut with a Steam match,
  SteamGridDB for one without) and the URLs, plus the slots that are **empty** and eligible.
- The SteamGridDB lookup: search by title, fetch portrait / hero / logo / wide, negative-cache a miss.
- The record of what was written: `steam_store.json` `applied_artwork` (unchanged file, § 4.3),
  now also for shortcuts with no Steam match (`source = "steamgriddb"`, `slots`, `tried`).

It does **not** write to Steam (the `artwork` surface does, `surfaces.md`) and does not decide
routing (ADR-0040): the evaluated route and `allowSgdb` arrive as context.

## Contract

```lua
-- backend/art_service.lua
M.deps = { api_key, search, fetch, grid_exists, now }   -- nil = the real dependency
function M.cdn_urls(steam_appid) end
--- ctx = { title, route = {bucket, via}, identity?, artUrls?, allowSgdb?, noNetwork? }
--- data = { urls, source = "steam-cdn" | "steamgriddb", steamAppid?, applied?, emptySlots }
function M.ensure(appid, ctx) end
```

**Selection order** (`M.ensure`, one test each in `tests/test_art_service.lua`):

1. `route.via == "pending"` → `pending`. `route.bucket == "none"` → `unsupported`, no request (ADR-0035).
2. Only a `steam-store` route uses a Steam match (`ctx.identity`, else the saved mapping): its
   native app gives `steam-cdn` (CDN URLs; the frontend's hashed StoreItemCache URLs in `ctx.artUrls`
   win). A shortcut moved to `web-scraping` is treated as unmatched here and keeps the art it has (ADR-0033).
3. `steam-store` with identity `pending`/`error` → `pending`.
4. No match → SteamGridDB, **empty slots only**. A slot is empty when none of its grid files exists in
   `<user>/config/grid/` (`steam_store_store.slot_files`); a slot this plugin already attempted
   (`applied_artwork.tried`) is never offered again, so art the user set — or cleared after we
   filled it — is never touched. No empty slot, `allowSgdb == false` or `noNetwork` → `ok` with no
   URLs and no request.
5. No key → `needs-setup`, no request. Search miss or no art → `ok` with no URLs and a negative
   cache entry (`sgdb:<title>`, 7 days). A thrown search/fetch → `error` (retried after 5 min by
   the frontend), never a crash (ADR-0014).
6. Every part gets `checkedAt` in ms.

`app/artwork.ts` turns the part into an `ArtworkPlan` with the pure `domain/art-plan.ts`
(`artworkPlan` for `steam-cdn`, `sgdbPlan` for `steamgriddb`) and writes it to `record.artwork`;
the `artwork` surface executes it. `Clear` (`SteamStoreClearMapping`) returns the slots we wrote
(also for SteamGridDB) and resets `tried`.

## Files

| File | Role |
| --- | --- |
| `backend/art_service.lua` | Selection order above |
| `backend/web_sgdb.lua` | SteamGridDB client (search, per-slot URLs), unchanged |
| `backend/steam_store_store.lua` | `record_sgdb_artwork`, `slot_files`, `prune_missing_slots`, negative cache |
| `backend/record_rpc.lua` | `EnsureFresh(["artwork"])` |
| `backend/steam_store_rpc.lua` | `SteamStoreRecordArtwork` (`source: "steamgriddb"` records without a mapping) |
| `frontend/domain/art-plan.ts` | Pure plans (moved from `features/steam-store/art-plan.ts`, D11) |
| `frontend/app/artwork.ts` | `createArtwork`: one ensure per shortcut per session, plan into the record |
| `frontend/surfaces/artwork/` | Executes the plan (`surfaces.md`) |

## Steam targets touched

None (the surface owns them).

## May import / must never import

`art_service.lua` may require `steam_paths`, `web_config`, `web_sgdb`, `steam_store_normalize`,
`steam_store_store`, `resolve_identity`, `fs`; it must never log or return the API key.

## Tests

- `tests/test_art_service.lua` (hermetic): route none / pending, needs-setup, disabled and offline
  make no request, SteamGridDB urls, only empty slots, attempted slots not offered again, Clear
  resets, negative cache, mapped game uses `steam-cdn` with no SteamGridDB request, saved match
  ignored on a web-scraping route, identity from context, thrown search is `error`, `EnsureFresh`,
  and **the credential never appears in a `logger:` call** (source grep of `art_service.lua` and `web_sgdb.lua`).
- `tests/art-plan.test.ts` (`sgdbPlan`), `tests/app-artwork.test.ts` (plan building, one call per session,
  needs-setup not memoised, error retry, `clearSlots`).
- Live: an unmatched web-scraping shortcut with no custom art gets all four slots; a shortcut whose
  portrait the user set keeps it; Clear removes only our slots; AM2R (bucket `none`) makes no
  SteamGridDB request; migration plan § 0.5.

## How to add an artwork source

1. Add a branch in `M.ensure` after step 4's key check, gated by its own `ctx` flag and routing
   service; return the same `data` shape.
2. Add its plan rule to `domain/art-plan.ts` (pure, tested); `app/artwork.ts` `buildPlan` picks it by `source`.

## History

- M5c (2026-09-29): created. `art_service.lua` (SteamGridDB for shortcuts with no Steam match, empty slots
  only; Steam CDN for mapped ones), `artwork` surface record-driven, `services.steamgriddbEnabled`, SteamGridDB
  key entry in the settings panel.
- M5c live verification (2026-09-29): Firestriker (only its hero empty) got `3381982601_hero.jpg` from SteamGridDB and
  nothing else changed; the backend recorded `source = "steamgriddb"`, `slots = [1]`, `tried = [1]`. Clear removed
  only that file. Note for testers: Clear resets `tried`, so the next view of that shortcut refills the slot (a Big
  Picture view fires one immediately). AM2R and 218 of 220 shortcuts already had all four slots: no request is made.
