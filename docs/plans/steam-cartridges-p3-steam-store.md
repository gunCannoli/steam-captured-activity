# steam-cartridges P3: Steam Store bucket

> Spec for the implementer. For shortcuts in the **Steam Store** bucket (P2),
> resolve the native Steam appid and borrow Steam's own art and Game Info.
> Source: [steam-cartridges.md § 3](../steam-cartridges.md#3-feature-steam-store-bucket-from-game-data-linker).
> Rules: exact normalised title only; near matches become suggestions and are
> never applied silently (ADR-0008 spirit); every result can be overridden; one
> click clears it. Network runs only for steam-store games (ADR-0032).
> Prerequisites: P2 merged; P0 **T2** (CDN/artwork), **T3** (native-app knowledge)
> and **T6** (fixtures) recorded. **P0-gated** items say which answer changes what.

Porting: logic from `research/game-data-linker/backend/main.lua` (MIT; keep a
one-line attribution comment where ported): `fetch_game_data` (L113),
`steam_search_appid` + `STEAM_EDITION_WORDS` (L1751), and the CDN list in
`save_artwork` (L644–651). **Do not** port its disk writes into `grid/`, its
localStorage markers, or any Epic/Xbox/news/community code (§ 3.3 of the parent
plan).

---

## 1. Resolution order (per shortcut, first hit wins, cached)

1. **Manual mapping** (`source: "manual"`), always first.
2. **Known native match** (`source: "owned"`): exact normalised match against
   native apps from `appStore.allApps` (frontend, zero network; P0 T3 names the
   accessor and whether it holds unowned apps). The match must be **unique**: two
   natives with the same normalised name → no match.
3. **Store search** (`source: "search"`): backend `storesearch`. An exact
   normalised match is saved; an edition-word or other near match goes to
   `suggestions`.

Skip steps 2–3 (not 1) when the shortcut exe basename is a known emulator
(`emulators.lua`: retroarch, dolphin, primehack, cemu, pcsx2, rpcs3, duckstation,
ppsspp, yuzu, ryujinx, xemu, xenia, mame, mednafen, flycast, melonds, citra,
vita3k). This is a guard against wrong matches, not bucket guessing. Any appid in
`rejected[shortcut]` is never auto-applied again.

## 2. Data files (in `<steam>/millennium/config/steam-cartridges/`, ADR-0032)

`steam_store.json`, which is user state and must never be auto-deleted:

```jsonc
{
  "version": 1,
  "mappings":    { "<shortcutAppid>": { "steam_appid": 435150, "name": "…", "source": "manual|owned|search", "at": 1790000000 } },
  "suggestions": { "<shortcutAppid>": [ { "steam_appid": 1, "name": "…", "reason": "edition|near" } ] },
  "rejected":    { "<shortcutAppid>": [ 1234 ] },
  "applied_artwork": { "<shortcutAppid>": { "steam_appid": 435150, "slots": [0, 1, 2, 3], "at": 1790000000 } },
  "negative":    { "<normalised title>": 1790000000 }      // no store hit; retry after 7 days
}
```

`appdetails_cache.json` is disposable: `{ "<steamAppid>": { "at": epoch, "metadata": ConsolidatedMetadata } }`
with a 7-day TTL.

## 3. Backend (flat `backend/steam_store_*.lua`; P0 T5 dotted require unverified)

| File | Contents |
| --- | --- |
| `normalize.lua` | `normalize(s)`: lowercase; strip `™®©`; strip bracketed tags (`(USA)`, `[!]`, `(v1.1)`); non-alphanumerics → space; collapse. `classify(query, name)` → `"exact"` \| `"edition"` \| `"none"`. Edition = the query followed only by edition words, a 4-digit year or roman numerals (linker rule). |
| `emulators.lua` | `is_emulator(exe)`: basename without extension, lowercased, in the list above. |
| `store.lua` | Load/save both files (atomic: write `*.tmp`, then rename). `get(appid)`, `set_mapping(appid, steam_appid, name, source)` (clears that shortcut's suggestions), `clear(appid, reject)` → returns `{ steam_appid, slots }`, `add_suggestions`, `record_artwork`, `is_rejected`, negative-cache helpers. |
| `search.lua` | `search(title, http_get?)`: `https://store.steampowered.com/api/storesearch/?term=…&cc=us&l=english`. Injectable `http_get` for tests. Checks the negative cache. Returns `{ exact = {appid,name}?, suggestions = {…} }`. |
| `appdetails.lua` | `fetch(steam_appid, http_get?)`: `…/api/appdetails?appids=<id>&l=english&cc=us`, TTL cache. `to_metadata(data)` → `ConsolidatedMetadata`: `title=name`, `description = strip_html(short_description)`, `developers`, `publishers`, `franchises = {}`, `release_date` parsed from `release_date.date` ("13 Sep, 2017" / "Sep 13, 2017"; unknown → 0), `genres` from descriptions. Categories map to the `GameCategories` flags (2 → single_player; 1/36/49 → multiplayer; 9/38 → coop; 24/37/39 → split_screen; 28 → full_controller; 18 → partial_controller; 44 → remote_play_together). **`achievements` is always false** (P5 owns achievements). Adds `source = "steam-store"` and `steam_appid`. |
| `throttle.lua` | One global gate: at most 1 request/second to `store.steampowered.com`, serial. `User-Agent: steam-cartridges (Millennium plugin)`. |
| `rpc.lua` | Handlers below, wrapped with core `rpc.lua`'s `method()`. Export it as `RPC.method` (do not assign it as a global). |

**RPCs** (payload JSON → JSON; all names new, prefixed to avoid generic globals):

| Name | Payload | Returns |
| --- | --- | --- |
| `SteamStoreGetState` | `{}` | `{ mappings, suggestions, rejected, applied_artwork }` |
| `SteamStoreGetMapping` | `{ appid }` | `{ mapping: {steam_appid,name,source} \| null, rejected: number[], applied: {steam_appid,slots} \| null }` |
| `SteamStoreSetMapping` | `{ appid, steam_appid, name? }` | `{ mapping }` (manual; removes `steam_appid` from `rejected`) |
| `SteamStoreSaveKnownMatch` | `{ appid, steam_appid, name }` | `{ mapping }` (source `owned`; refused if rejected) |
| `SteamStoreSearch` | `{ appid, title }` | `{ mapping }` \| `{ suggestions }` \| `{ skipped: "emulator" \| "negative" \| "rejected" }`. It reads the exe via `shortcuts.parse` for the emulator guard |
| `SteamStoreClearMapping` | `{ appid, reject }` | `{ steam_appid, slots }` (the slots the frontend must clear) |
| `SteamStoreGetAppDetails` | `{ steam_appid, force? }` | `{ metadata, cached }` \| `{ error }` |
| `SteamStoreRecordArtwork` | `{ appid, steam_appid, slots }` | `{ ok: true }` |
| `SteamStoreDownloadImage` | `{ url }` | `{ base64, ext }`. **Not needed for CDN paths (P0 T2: frontend fetch works); keep only as a fallback.** URL allowlist: `^https://[%w%.]*steamstatic%.com/` |

Register them as globals in `main.lua`.

**P0 T3 result (confirmed):** `StoreItemCache` returns name, description, credits, date and
categories for unowned apps through Steam's own transport; build
`features/steam-store/store-item.ts` producing the same `ConsolidatedMetadata`, and
use it **before** `SteamStoreGetAppDetails` (the ADR-0009 ladder). Keep
`appdetails` as the fallback.

## 4. Frontend

| File | Change |
| --- | --- |
| `frontend/steam/shortcut.ts` | **NEW.** Move `resolveShortcutTitle` out of `features/game-info/index.ts` (both features need it). |
| `frontend/features/source-view.ts` | **NEW.** Move the desktop `onPopupCreate`/`onLocationChange` and `watchGamepadAppid` wiring out of `features/game-info/index.ts`. `onSourceView(appid)`: `getBucket(appid)`. **web-scraping** → the game-info handler (unchanged). **steam-store** → `handleSteamStoreView`. **none** → `revertGameDetails` if enriched. Dedupe concurrent calls per appid (desktop and Big Picture can both fire). |
| `frontend/features/steam-store/resolve.ts` | **NEW, pure** (only `import type`): `normalizeTitle` (mirrors `normalize.lua`), `matchKnownApp(title, apps)` (unique exact match or undefined), `cdnArtworkUrls(steam_appid)` → `{ portrait, hero, logo, wide }` (unhashed CDN paths fetch fine for existing apps; prefer hashed URLs from `StoreItemCache` `GetAssets()` for newer apps). |
| `frontend/features/steam-store/known-apps.ts` | **NEW.** Native app list from `appStore` (`appStore.allApps`, `display_name`); `appid < 0x8000_0000`, games only. Normalised index built once, lazily; `refreshKnownApps()` rebuilds it when the settings panel opens. |
| `frontend/features/steam-store/index.ts` | **NEW.** `handleSteamStoreView(appid)`: (1) `SteamStoreGetMapping`; (2) none → `matchKnownApp` → `SteamStoreSaveKnownMatch`, else `SteamStoreSearch` (suggestions only → stop); (3) metadata → `enrichGameDetails(appid, metadata)` (same originals/revert as P2); (4) if `applied?.steam_appid !== mapping.steam_appid` → `applyCustomArtworkFromUrls(appid, cdnArtworkUrls(...))` → `SteamStoreRecordArtwork` with only the slots that succeeded (change `applyCustomArtworkFromUrls` to return them). User art in a slot is not detectable (P0 T2 q5): record and clear only slots this plugin wrote. `clearSteamStore(appid, reject)`: RPC, then `SteamClient.Apps.ClearCustomArtworkForApp(appid, slot)` per returned slot (called on `SteamClient.Apps`, never extracted), then `revertGameDetails`. One session-level `processed` set, as in the web path. |
| `frontend/features/artwork/artwork.ts` | Now used. `fetchImageAsBase64`'s wsrv.nl proxy stays **SGDB-only**; Steam CDN URLs never go through a third-party proxy. If P0 T2 says fetch fails, route through `SteamStoreDownloadImage`. |
| `frontend/settings/settings-panel.tsx` | **Steam Store** section: each steam-store shortcut with mapping (name, appid, source), a manual appid field + Set, **Clear** (reject), and suggestions with Accept/Reject. Stock components only. |
| `frontend/index.tsx` | Export `clearSteamStore` and `steamStoreState` for CDP tests. |

Leaving the bucket reverts in-memory Game Info on the next view; persisted art
stays until **Clear** (ADR-0033).

## 5. Steps

1. `normalize.lua` + `resolve.ts` against one shared fixture,
   `tests/fixtures/normalize-cases.json`, used by both Lua and TS tests (this
   stops the two implementations drifting).
2. `store.lua`, `throttle.lua`, `search.lua`, `appdetails.lua` with tests using
   captured fixtures: `tests/fixtures/storesearch-<term>.json` and
   `appdetails-435150.json`, recorded once with `curl` (public, no secrets).
3. `steam_store/rpc.lua` + `main.lua` globals.
4. `shortcut.ts`, `source-view.ts` (move only; re-run P2 tests), `known-apps.ts`, `steam-store/index.ts`.
5. Settings panel section. Docs: README "Steam Store bucket"; steam-components.md
   only for new Steam facts; CHANGELOGs.

## 6. Tests

- **`tests/test_steam_store.lua`**: normalize fixture; `classify` exact /
  edition ("Alan Wake 2" vs "Alan Wake 2 Deluxe Edition") / none ("Doom" vs
  "Doom Eternal"). `search` on fixture JSON (injected `http_get`; the harness
  `http` stub throws). `to_metadata` on the 435150 fixture: credits, date, and no
  achievements flag. `store` round trip in a temp dir: set → clear(reject) →
  `SaveKnownMatch` refused for the rejected id. Emulator guard.
- **`tests/steam-store.test.ts`**: normalize parity (same fixture);
  `matchKnownApp` uniqueness; `cdnArtworkUrls`.
- **`tests/steam-store.mjs`** (CDP, P0 T6 fixtures, `SC Test Steam` → steam-store, `SC Test Retro` → web-scraping):
  1. Open SC_STEAM_OWNED → the mapping `source: "owned"` equals its native appid;
     Game Info shows the native developer; `applied_artwork.slots.length >= 1`.
  2. Open SC_STEAM_UNOWNED → mapping `source: "search"` or suggestions, never a
     wrong silent match.
  3. Open SC_RETRO_A → no steam-store mapping, no applied artwork (the retro game is untouched).
  4. `clearSteamStore(SC_STEAM_OWNED, true)` → mapping gone, grey shortcut note back,
     `rejected` has the appid. Reopen → not re-applied. Then restore it via
     `SteamStoreSetMapping` (manual) so the fixture ends as it started.
- **Routines 1–3**: `check_all_tabs.js <SC_STEAM_OWNED>` and `<SC_RETRO_A>`,
  `test_nav_cycle.js <SC_STEAM_OWNED> 435150` (A → native B → A). Capture views on
  AM2R unchanged.

## 7. Exit criteria

- [ ] A shortcut copy of a known Steam game shows native portrait/hero/logo/wide art
      and native Game Info (description, developer/publisher, date, categories).
- [ ] The retro game is untouched: no mapping, no request, no art.
- [ ] Clear/undo per game works, and a rejected match is never re-applied.
- [ ] No request for `none` or web-scraping games (log check); requests are throttled and cached.
- [ ] Routines 1–3 PASS on desktop and Big Picture; check/build/test green.

## 8. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Wrong match copies another game's art | Exact + unique only; suggestions manual; `rejected`; Clear |
| Overwriting the user's own custom art | P0 T2 q5; otherwise only slots the plugin recorded are cleared, and README says art is replaced |
| Unhashed CDN paths 404 for newer apps | P0 T2 source; a failed slot is skipped and not recorded |
| Store rate limits (`appdetails`) | 1 req/s gate, 7-day caches, negative cache |
| Large base64 over IPC | Frontend fetch preferred; per P0 T2 limits |
| `source-view.ts` move regresses P2 | Re-run `tests/buckets.mjs` after step 4 |

**Rollback:** revert the P3 commits. On disk, `steam_store.json` and the cache
are ignored by a P2 build. Applied art stays on the shortcuts. Before reverting,
run `clearSteamStore` for the fixture games, or clear the art in Steam's UI.
