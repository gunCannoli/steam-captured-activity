# Media service

**This doc's job:** community media: which videos, screenshots and artworks Steam's own Community section shows for a
shortcut with no Steam match, and from where. Part of the steam-cartridges architecture (ADR-0039, ADR-0046); index:
[steam-cartridges.md § 3](../steam-cartridges.md#3-layer-docs).

## What it owns

- The `media` part of a record (`CommunityMedia`, [kernel.md](kernel.md)): a list of items, each a `video` (a YouTube
  id), a `screenshot` or an `artwork`, from `igdb` (public URLs) or `screenscraper` (a key such as `ss(wor)`, never a
  URL), plus the `igdb_id` / `ss_id` it came from.
- The store `<data dir>/community_media.json` (`media_store.lua`): keys and public URLs only, never image bytes and
  never a ScreenScraper URL.
- The ScreenScraper image bytes, on demand: `GetMediaImage` downloads one image into memory (`net.get_binary` →
  `bin_http.lua`, WinINet through LuaJIT's FFI) and answers base64. Nothing is written to disk; the frontend turns the
  bytes into a `blob:` URL (`ports/image.ts` `objectUrl`) held in `kernel/media-bin.ts` (8 shortcuts, released on
  eviction).

It does **not** write to Steam (the `community` surface does, [surfaces.md](surfaces.md)), does not search IGDB by title
(it asks for the game Game Info already shows, `ctx.igdb_id`), and does not decide routing (ADR-0040): `allowWeb` and
`allowScreenscraper` arrive as context, like metadata's.

## Finding the game on ScreenScraper without a ROM

A shortcut with a ROM file is looked up by its file name and checksum (`jeuInfos.php`). A shortcut with no ROM (a PC game, a fan
game) has nothing to match on, so `jeu_for` goes to a name search (`screenscraper_media.search_jeu`, `jeuRecherche.php`):

1. Queries, simplest last: the title as plain words (`am2r another metroid 2 remake`), then the part before a dash or colon
   (`am2r`). ScreenScraper's search wants plain words and returned nothing for the title with its dash.
2. Every candidate list is scored against the full title (`name_score`: shared words over the longer title's words; 1 for the
   same words; leading "the", brackets and punctuation ignored). A score of at least `MIN_NAME_SCORE` (0.8) matches.
3. A part of the title (before or after the dash) equal to the candidate's name or a part of it matches at `PART_SCORE`
   (0.85), **only** for a candidate on the shortcut's console or, with no console, on a PC platform. That is how
   "AM2R - Another Metroid 2 Remake" finds ScreenScraper's PC entry "AM2R - Return of Samus" (game 273188) and not the
   Android port "AM2R", and why "Metroid - Zero Mission" never matches the NES "Metroid".
4. The game's record is fetched by id (`jeuInfos.php?gameid=`). No match is remembered for the session (no repeated search);
   the media is stored for 7 days like any other.

`GetDiagnostics` carries `ss_search`: the last search's title, HTTP statuses, each query with its candidate count, the first
three candidates (names and system) and the match with its score. No account, no address. A shortcut with a console but no ROM
file tries its ROM-name lookup first and falls back to the search on any failure but missing credentials.

**Routing.** Auto Mode keeps ScreenScraper off a PC game for Game Info (its metadata comes from the Steam store and IGDB). For
the community media alone that exclusion is lifted (`domain/routing/policy.isMediaServiceAllowed`, wired as the media's
`allowScreenscraper`); the user's own routing rules are still evaluated first and win.

## ScreenScraper image types

`media_items` takes, per type, the best region (wor, us, eu, ss, jp): `sstitle` (title screen) and `ss` (screenshot) as
screenshot cards; `fanart`, `mixrbv2` and `mixrbv1` (Recalbox mixes), `box-2D` (box: front), `box-3D`, `support-2D`
(cartridge / disc), `flyer` and `themehs` (HyperSpin theme) as artwork cards, the box, support, flyer, mix and theme ones
with a caption (`MEDIA_TITLES`). A video and a manual are not taken. Only images can be shown: a type whose bytes are not an
image (the HyperSpin theme may be an archive) is dropped when downloaded (`image_type`), like any failed download. No size
filter: a 150 KB minimum was tried and removed at the user's request (2026-09-30). The cards are ordered after the trailers
and before IGDB's (`domain/community-media.visibleMedia`); Steam's own row layout may leave out a card that fits no row.

## Contract

```lua
-- backend/media_service.lua
M.deps = { igdb_query, ss_jeu, shortcut_info, download, fresh, now }   -- nil = the real dependency
--- One IGDB game -> items (pure).
function M.igdb_items(game) end
--- ctx = { title, route = {bucket, via}, identity?, igdb_id?, allowWeb?, allowScreenscraper?, noNetwork?, force? }
--- data = { items = { {kind, source, youtube?, url?, thumb?, key?, width?, height?, title?} }, igdb_id?, ss_id? }
function M.ensure(appid, ctx) end
--- { base64, ext, width?, height? } | nil, err. The URL never leaves this function.
function M.image(appid, key, title) end

-- backend/screenscraper_media.lua (the ScreenScraper client, shared with the metadata source)
function M.fetch_jeu(appid, rom_path, system_id, crc, md5, name) end   -- unchanged (M5d)
function M.jeu_for(appid, title, info) end   -- ROM name, console, MD5 from the shortcuts.vdf entry, then fetch_jeu
function M.media_items(jeu) end              -- one item per type, best region, keys only (below)
function M.media_url(jeu, key) end
function M.download(url) end                 -- body, ext, width, height (maxwidth=1280, image bytes checked)
```

**Selection order** (`M.ensure`, one test each in `tests/test_media_service.lua`):

1. `route.bucket == "none"` → `unsupported`, no request. A Steam match (`ctx.identity.data.native`) → `unsupported`
   (`message = "steam"`): Steam shows the native app's community content (native-links, ADR-0038).
2. `route.via == "pending"` → the stored media, else `pending`.
3. Stored media younger than `fresh_policy.TTL.media_ok` (7 days) → `ok`, source `local`, no request. `force` or an
   older record asks again when a source may be asked.
4. IGDB when `allowWeb` and `ctx.igdb_id`: one query by id (videos, screenshots, artworks). No igdb_id → no IGDB media.
5. ScreenScraper when `allowScreenscraper`: `jeu_for` (memory-cached per session). `not-found` is a definite "no
   media"; `no-credentials` alone → `needs-setup`.
6. No source answered: the stored media (freshness touched as `error`, due again in 30 min), else `pending` for a
   paused source, else `error` (`EnsureFresh` answers a repeat within 30 min from memory, as for artwork).

## Files

| File | Role |
| --- | --- |
| `backend/media_service.lua` | The service: `ensure`, `image`, `igdb_items` |
| `backend/media_store.lua` | `community_media.json` (a store: never fetches) |
| `backend/screenscraper_media.lua` | The ScreenScraper client: `fetch_jeu` (metadata and media), `jeu_for`, the media half |
| `backend/bin_http.lua` | Binary GET into memory (WinINet via FFI); only `net.get_binary` calls it |
| `backend/net.lua` | `get_binary`: the same per-source breakers as `get`/`post` |
| `backend/web_igdb.lua` | `igdb.query`: the one IGDB client (Twitch token) |
| `backend/record_rpc.lua` | `EnsureFresh` `media` branch; `GetMediaImage` |
| `frontend/app/media.ts` | The use case: one `EnsureFresh(["media"])`, the toggles, the ScreenScraper images into the bin |
| `frontend/domain/community-media.ts` | `visibleMedia`: toggles, at most 12 cards per kind, ScreenScraper images ahead of IGDB's (so a larger IGDB set cannot crowd them out of the cap, and Steam's row layout drops an IGDB card, not theirs) |
| `frontend/kernel/media-bin.ts` | Object URLs of ScreenScraper images, 8 shortcuts |

## Steam targets touched

None. The `community` surface writes Steam ([surfaces.md § community](surfaces.md#community)).

## Tests

`tests/test_media_service.lua` (45: mapping, selection order, the ScreenScraper keys, image size parsing, the
breakers of `get_binary`, the RPC facade, no URL or account in the store or a log line), `tests/app-media.test.ts` (7),
`tests/community-media.test.ts` (4), `tests/media-bin.test.ts` (3). Live: `tests/live/probes/community_media.mjs`.

## History

- F2 (features plan, [the F2 plan](../plans/steam-cartridges-f2-community-media-plan.md)): created. Replaces the
  unwired `igdb_community.lua` (deleted: its own Twitch token and title search) and the unwired half of
  `screenscraper_media.lua` (`GetGameMedia`, `GetGameManual`, a disk media folder that was never written).
