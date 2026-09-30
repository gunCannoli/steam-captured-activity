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
- The library icon (icon plan, [steam-cartridges-icon-plan.md](../plans/steam-cartridges-icon-plan.md)):
  whether a shortcut's icon may be set (`data.iconEligible`, `M.icon_eligible`) and the record of the icon
  set, `steam_store.json` `applied_icon` (`path`, `previous`, `source`, `steam_appid?`, `released?`).

It does **not** write to Steam (the `artwork` surface does, `surfaces.md`) and does not decide
routing (ADR-0040): the evaluated route and `allowSgdb` arrive as context.

## Contract

```lua
-- backend/art_service.lua
M.deps = { api_key, search, fetch, grid_exists, shortcut_icon, now }   -- nil = the real dependency
function M.cdn_urls(steam_appid) end
--- ctx = { title, route = {bucket, via}, identity?, artUrls?, allowSgdb?, noNetwork? }
--- data = { urls, source = "steam-cdn" | "steamgriddb", steamAppid?, applied?, emptySlots, iconEligible }
function M.ensure(appid, ctx) end
--- icon plan: the shortcut's shortcuts.vdf `icon` value ("" = unset; nil = unknown)
function M.current_icon(appid) end
--- icon plan: eligible, previous (the value Clear puts back)
function M.icon_eligible(appid, source, steam_appid) end
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
7. The library icon (not a slot; `urls.icon`, `data.iconEligible`). Steam draws a shortcut's icon from the
   file its `shortcuts.vdf` `icon` field names, or from the exe (a 32×32 BMP) when that is `""` or an `.exe`
   ([knowledgebase](../knowledgebase.md#where-a-shortcuts-icon-comes-from-and-how-to-change-it-setshortcuticon)).
   `icon_eligible`: unknown field → no; no entry of ours → only while the field is the exe; ours still in the
   field → only for another source or native app; field back at `previous` (our write never landed) → as no
   entry; anything else → the user chose an icon: `released`, never touched again (until Clear). Steam CDN:
   `artUrls.icon` (StoreItemCache `GetCommunityIconURL_Full`, 184 px). SteamGridDB: the icons endpoint, asked
   only inside a slot lookup (`fetch(id, key, want_icon)`); an eligible icon alone never makes a request.

`app/artwork.ts` turns the part into an `ArtworkPlan` with the pure `domain/art-plan.ts`
(`artworkPlan` for `steam-cdn`, `sgdbPlan` for `steamgriddb`) and writes it to `record.artwork`;
the `artwork` surface executes it. `Clear` (`SteamStoreClearMapping`) returns the slots we wrote
(also for SteamGridDB) and resets `tried`; it also returns `icon_restore` (the icon value ours replaced)
while the shortcut still shows our icon, and forgets `applied_icon`.

The icon file: `SteamStoreSaveIcon` (`backend/shortcut_icon.lua`) stores the eligible URL's image, which `app/artwork.ts` fetched (`ports/image.ts`) and sent as `base64` (the backend's `http.get` cuts a binary body at its first NUL byte, so it cannot download one; the download below is only a fallback that a real image never reaches) (Steam CDN or
SteamGridDB CDN only, body sniffed as PNG/JPEG/ICO) to `<data dir>/icons/<appid>.<ext>` and returns that
path and `previous`; the surface calls `SetShortcutIcon`, then `SteamStoreRecordIcon` records it (refused,
and undone, when the match changed meanwhile). The backend never writes Steam's `config/grid/` files.

## Files

| File | Role |
| --- | --- |
| `backend/art_service.lua` | Selection order above |
| `backend/web_sgdb.lua` | SteamGridDB client (search, per-slot URLs, the icon when asked, `download_image`) |
| `backend/steam_store_store.lua` | `record_sgdb_artwork`, `slot_files`, `prune_missing_slots`, negative cache, `record_icon`, `release_icon` |
| `backend/shortcut_icon.lua` | The icon file: host allowlist, sniff, `<data dir>/icons/<appid>.<ext>` |
| `backend/record_rpc.lua` | `EnsureFresh(["artwork"])` |
| `backend/steam_store_rpc.lua` | `SteamStoreRecordArtwork` (`source: "steamgriddb"` records without a mapping), `SteamStoreSaveIcon`, `SteamStoreRecordIcon`, `icon_restore` on Clear |
| `frontend/domain/art-plan.ts` | Pure plans (moved from `features/steam-store/art-plan.ts`, D11) |
| `frontend/app/artwork.ts` | `createArtwork`: one ensure per shortcut per session, plan into the record |
| `frontend/surfaces/artwork/` | Executes the plan (`surfaces.md`) |

## Steam targets touched

None (the surface owns them).

## May import / must never import

`art_service.lua` may require `steam_paths`, `web_config`, `web_sgdb`, `steam_store_normalize`,
`steam_store_store`, `resolve_identity`, `shortcuts`, `fs`; it must never log or return the API key.

## Tests

- `tests/test_art_service.lua` (hermetic): route none / pending, needs-setup, disabled and offline
  make no request, SteamGridDB urls, only empty slots, attempted slots not offered again, Clear
  resets, negative cache, mapped game uses `steam-cdn` with no SteamGridDB request, saved match
  ignored on a web-scraping route, identity from context, thrown search is `error`, `EnsureFresh`,
  and **the credential never appears in a `logger:` call** (source grep of `art_service.lua`, `web_sgdb.lua`
  and `shortcut_icon.lua`). Icon plan: every `icon_eligible` row above, `record_icon` ownership, Clear's
  `icon_restore`, `SaveIcon` (not eligible, host, sniff, file, path form), `RecordIcon`, SteamGridDB icon only
  inside a slot lookup (30 checks).
- `tests/art-plan.test.ts` (`sgdbPlan`, `iconPlan`, `iconRestoreOf`), `tests/app-artwork.test.ts` (plan building,
  one call per session, needs-setup not memoised, error retry, `clearSlots`, icon plan and restore),
  `tests/artwork-icon.test.ts` (the surface's icon write, restore, kill switch, refusal, undo).
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
- Icon plan (2026-09-29): the library icon. A shortcut whose icon Steam draws from its exe (32×32 BMP) gets the
  mapped native app's 184 px community icon, or SteamGridDB's icon inside a slot lookup; `applied_icon` in
  `steam_store.json`; `shortcut_icon.lua`; Clear puts the replaced icon back. An icon the user chose is never touched.
