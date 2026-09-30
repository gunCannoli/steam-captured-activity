# Plan: F2 Community media in Steam's own Community section

**Status:** Ready, dry-run 2026-09-30 on `64e3350` (§ 11; the same tree as `7ff6fc9` before the history rewrite; all seven patches also apply in order on `c3cf503`). Execute **after** the achievements preload plan and after
F1's live verification ([TASK.md](../../TASK.md) order). Not started.
**Kind:** Feature plan, written for the weak implementer ([the plan writing standard](README.md)). The literal
before/after blocks are the seven patch files in [steam-cartridges-f2-community-media/](steam-cartridges-f2-community-media/);
each step applies one and checks it. Step 8 (docs) gives its literal edits here.
**Parent:** [steam-cartridges-features-plan.md § F2](steam-cartridges-features-plan.md#f2-media-in-the-community-tab).
**Layer rules:** [steam-cartridges.md § 4](../steam-cartridges.md#4-adding-a-feature),
[README of the layer docs](../steam-cartridges/README.md), ADR-0039, ADR-0044. **New ADR:** ADR-0046 (§ 2.3; ADR-0045 is
the achievements preload plan's).
**Replaces:** the deleted `steam-cartridges-community-plan.md` (`git show be8b76e^:docs/plans/steam-cartridges-community-plan.md`),
whose Steam-side design (loopback files, stubs in `CWorkshopStore`) was never true (finding 1).

## 1. What ships, and what the research found

A shortcut with **no Steam match** gets Steam's own **Community** section (desktop) and **COMMUNITY** tab (Big
Picture), filled with Steam's own cards:

- **Trailers** from IGDB, played inline by Steam's own YouTube player.
- **Screenshots and artwork** from IGDB (public URLs), opened in Steam's own fullscreen viewer.
- **Screenshot, title screen and fanart** from ScreenScraper (with the user's ScreenScraper account), downloaded by
  the backend **into memory** on demand and shown through an in-memory `blob:` URL. Nothing is written to disk.

A shortcut **with** a Steam match keeps Steam's own community content, unchanged (native-links, ADR-0038).
Manuals and links (IGDB websites, ScreenScraper manuals) are **not** in this plan: Steam has no card for them (§ 12).

User decisions (2026-09-30): use Steam's native card components as far as possible and feed them our data; if the
live test shows the cards misbehave, reconsider then (§ 9.3 is that test). ScreenScraper must not fill the disk on a
big library and its URL must stay hidden: hence the in-memory download and `blob:` URLs.

Research, live and in code (steam-components.md § Community media, knowledgebase.md § Image hosts, § Lua binary downloads):

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| 1 | The Community section is **not** fed from `CWorkshopStore`. Its loader (class `ae`, module `77163`, not exported) fetches `library/appcommunityfeed/<appid>` itself in `LoadCommunityContentAndVotes(appid, page)`, then asks vote summaries. | Module 77163 source (dumped live); `f.uc` in module 14688 | The deleted plan's store stubs could never work. The surface patches that one prototype method. |
| 2 | Desktop and Big Picture render the **same** `wb({ appid })`, only when `"community"` is in the section set. An unmapped shortcut never has it. | Module 3375 `lt`; `surfaces/sections/index.ts` `NATIVE_SECTIONS` only for a Steam match | `sections` adds `"community"` for a shortcut with media. One patch serves both UIs. |
| 3 | The section class `oe` is the jsx element type (props `{ appid, labelId }`, prototype has `BindInnerContainer`, `AutoLoadAdditionalContent`, `CheckAndLoadInitialContent`). `new oe({ appid: 0, labelId: "" })` builds a loader that shares the mounted one's prototype, with no request. | Live on 435150's page: `typeIsCtor: true`, `construct: ok, same proto: true` | A learn-once jsx observer finds the class, a timer patches the prototype, the observer is disposed. |
| 4 | The first page loads ≥ 1 s after the section is bound and on screen. | `DelayCheckAndLoadInitialContent` (1000 ms) + IntersectionObserver | Patching on the next tick after the first sighting is in time (D5: never inside the render). |
| 5 | Card types: 3 Artwork, 4 Video (YouTube id only), 5 Screenshot, 9/10 Guide (opens a Community page by id). | Enum module 44846; card switch in 77163 | Our items become types 3, 4, 5 only. No MP4 (ScreenScraper videos) and no manual/link cards. |
| 6 | An image without `image_width`/`image_height` is dropped (no row template matches size 0). `content_descriptorids` must be an array. Counts show only when not `null`. | `pe()`, `ge()`, `Ce.render` in 77163 | `core.toFeedItems` always sets a size (or leaves the item out), `[]`, and `null` counts. |
| 7 | Clicking an image calls `PublishedFile.GetDetails` for the card's id and loads its comment thread; every card has Report, and images/videos have award and vote buttons (Valve endpoints). | `Se`, `xe`, `Ie` in 77163; `F.GU`, `F.RE` in 20414 | Our ids are 15-digit numbers from 9e14 (no Valve id is near). These calls fail harmlessly server-side; § 9.3 checks each one live. This is the "reconsider" trigger. |
| 8 | `new SteamID("0")` is valid. | Live, module 8573 | `creator.steamid = "0"`; the author name is the source ("IGDB", "ScreenScraper"). |
| 9 | `images.igdb.com` and `img.youtube.com` load in Steam's UI (no CSP; IGDB fetch is CORS-readable). ScreenScraper refuses a cross-origin fetch. | Live `Image()` / `fetch` from SharedJSContext | IGDB items carry URLs. ScreenScraper bytes must come from the backend. |
| 10 | Millennium's Lua `http.get` cuts a binary body at the first NUL; WinINet through LuaJIT FFI returns it whole, in memory. | Icon plan § 11; spike 2026-09-30: 21,797 bytes, JPEG magic, NULs kept | New `bin_http.lua`, reached only through `net.get_binary` (the per-source breakers). |
| 11 | ScreenScraper media URLs carry the developer and user accounts; an error is text with HTTP 200. | Live request without an account: `Erreur de login ...` | Items store a **key** (`ss(wor)`), never a URL; the URL is looked up and used inside `media_service.image` only; bytes are checked (`image_type`). |
| 12 | `igdb_community.lua` did its own IGDB title search and took `results[1]`, with its own Twitch token copy; both media modules parsed `shortcuts.vdf` themselves; four RPCs were registered and never called. | `backend/igdb_community.lua`, `screenscraper_media.lua` (before), `tests/architecture-unwired-rpcs.json` | Deleted/rewritten: IGDB media is asked **by the igdb_id Game Info already shows** (never a title search), through `web_igdb.query`; `registry.shortcut` is the one lookup; the four RPCs go. |
| 13 | `tests/live/run.mjs` is CRLF in the working tree, LF in git. | `git ls-files --eol` | Only `git apply` touches it (step 6). |
| 14 | The achievements preload plan (ADR-0045) edits `record_rpc.lua` `GetAllRecords`, one line of `surfaces/sections/index.ts` `render` and two regions of `index.tsx`. | Its steps 3, 6, 8 | No hunk here touches those lines; `GetMediaImage` is added at the end of `record_rpc.lua`. If a patch still does not apply, § 6's `-3` rule decides. |

## 2. The design, by layer

### 2.1 Data flow

```
view sensor → app/view (after metadata, artwork) → app/media.ensure
   │  one EnsureFresh(["media"], { igdb_id from record.metadata, allowWeb, allowScreenscraper })
   ▼
backend record_rpc → media_service.ensure → igdb (web_igdb.query, by id)  +  screenscraper (jeu_for → media_items: keys)
                                        → media_store (community_media.json), fresh_policy (7 days)
   │  part { items: [video | screenshot | artwork] }
   ▼
app/media: domain/community-media.visibleMedia (toggles, 12 per kind)
           ScreenScraper items: backend.getMediaImage → base64 → ports/image.objectUrl → kernel/media-bin
           records.update(media)
   ▼
render queue → surfaces/sections: + "community" (unmapped, media ok, switch on)
             → surfaces/community: feeds[appid] = core.toFeedItems(items, bin)
   ▼
Steam renders wb → loader.LoadCommunityContentAndVotes(appid, 1) → patched: { vecContent: feed, mapVotes: new Map() }
```

### 2.2 Modules touched, by layer

| Layer | Module | Change | Step |
| --- | --- | --- | --- |
| backend, source | `web_igdb.lua` | `igdb.query(apicalypse)`: the one IGDB client, exported | 1 |
| backend, net | `net.lua`, `bin_http.lua` (new) | `net.get_binary` (same breakers as `get`); `bin_http.get` (WinINet via FFI, 8 MB cap, 15 s timeouts, system proxy) | 1 |
| backend, source | `screenscraper_media.lua` | Keeps `fetch_jeu` byte for byte. Adds `jeu_for`, `media_items` (keys only), `media_url`, `image_type`, `image_size`, `download`. Deletes `GetGameMedia`, `GetGameManual`, `fetch_media` and the disk folder code. | 1 |
| backend, store | `media_store.lua` (new) | `community_media.json`: get / set / delete; never fetches | 1 |
| backend, service | `media_service.lua` (new) | `ensure` (selection order in service-media.md), `image`, `igdb_items` | 1 |
| backend, service | `metadata_service.lua` | The ScreenScraper fetch calls `jeu_for` (the same `jeu` as media) | 1 |
| backend, freshness | `fresh_policy.lua` | `TTL.media_ok = 7 days`; `media` in `ttl_for` and `touch` | 1 |
| backend, facade | `record_rpc.lua`, `main.lua` | `EnsureFresh` `media` branch (30-min error memo like artwork); `GetMediaImage`; the four old RPCs unregistered; `igdb_community.lua` deleted | 1 |
| kernel | `record.ts`, `media-bin.ts` (new) | `MediaItem`, `CommunityMedia` typed; the bounded bin of object URLs (releases on eviction) | 2 |
| domain | `community-media.ts` (new) | `isShowable`, `visibleMedia` (toggles, `MAX_PER_KIND = 12`) | 2 |
| ports | `backend.ts`, `image.ts` | `getMediaImage`, `FreshContext.igdb_id`, `MediaImageResponse`; `objectUrl`, `releaseObjectUrl` | 3 |
| app | `media.ts` (new) | `createMedia({ backend, records, bin, titleOf, allowWeb, allowScreenscraper, toggles, objectUrl })` | 3 |
| surface | `community/` (new: `core.ts`, `index.ts`) | The only writer: the learn-once jsx observer and the loader prototype patch; touches `CommunityContentLoader.LoadCommunityContentAndVotes`, `jsx:community-section`; reads `media`; kill switch `community` | 4 |
| surface | `sections/index.ts` | reads `media`; adds `["community"]` for an unmapped shortcut with media while `community` is on | 4 |
| safety | `features.ts` | `"community"` appended to `FEATURE_IDS` (not in safe mode) | 4 |
| app | `view.ts` | `media.ensure` after artwork, not awaited (like achievements) | 5 |
| settings | `panels/community.tsx` | Accurate help line; the two toggles that work (trailers, screenshots and artwork). `communityShowManuals` / `communityShowExternalLinks` keep their keys and defaults for F2c but lose their rows | 5 |
| index | `index.tsx` | `mediaBin`, `media`, `view` gets `media`, register the community surface after native-links, export `communityDiagnostics` | 5 |

Not touched: `native-links` (a Steam match still redirects the section's appid to the native app, so our feed map
never answers for it), `captures` (still the only writer of `CWorkshopStore`), every other surface and service.

### 2.3 ADR-0046 (step 8 appends it to decisions.md)

```markdown
## ADR-0046: Community media feeds Steam's own Community Content loader; ScreenScraper bytes stay in memory

**Status:** Accepted · 2026-09-30 (user decision, features plan F2) · **Amends [ADR-0041](#adr-0041-jsx-runtime-hooks-stay-one-per-concern)** (a fourth, learn-once jsx site)

### Context

A shortcut with no Steam match has an empty Community section and COMMUNITY tab. Steam's Community Content section
(module 77163, desktop and Big Picture) does not read a store we can fill: its loader fetches
`library/appcommunityfeed/<appid>` itself (verified live 2026-09-30). The deleted community plan's loopback files and
`CWorkshopStore` stubs could not have worked. ScreenScraper media URLs carry the user's account, the frontend cannot
fetch them (no CORS), and Millennium's Lua `http.get` cuts binary bodies.

### Decision

- Feed Steam's own cards: the `community` surface patches the loader's `LoadCommunityContentAndVotes` prototype
  method to return our items (types 3 Artwork, 4 Video, 5 Screenshot) for a shortcut with a feed, and Steam's own
  loader for anything else. The class is reached by a jsx observer that disposes itself once the section class is
  seen (`surfaces/community`, a fourth `keepJsxPatched` site, transient).
- The `sections` surface adds `community` to an unmapped shortcut's sections only when it has media and `community`
  is on.
- Our cards use published file ids from 9e14 (15 digits), creator `{ name: source, steamid: "0" }`, null counts.
- IGDB media is asked by the igdb_id Game Info shows, never by title. ScreenScraper items are keys; the backend
  downloads an image into memory (`net.get_binary`, WinINet via FFI) on request; the frontend holds it as a `blob:`
  URL in a bounded bin. No media file on disk; no ScreenScraper URL outside the backend.

### Consequences

- Steam's own grid, viewer and YouTube player; nothing of ours is drawn.
- Each card keeps Steam's Report, vote, award, comment and author controls, which act on Valve's servers with our ids
  (they fail server-side). If the live check (F2 plan § 9.3) shows a visible fault, the fallback is to render our own
  grid from Steam's exported parts (`kB` YouTube player, the viewer module, the section CSS), which needs a new ADR.
- A Steam update that renames the loader method or its class's prototype methods leaves the section stock (the
  learn fails, reported to the `community` switch), never a crash.
```

## 3. Preconditions

Run from `c:\game\millennium` in PowerShell unless a line says otherwise. Every line must hold before step 1.

| # | Command | Expected |
| --- | --- | --- |
| P1 | `git status --short -- steam-cartridges` | prints nothing |
| P2 | `git merge-base --is-ancestor 64e3350 HEAD; $LASTEXITCODE` | `0` |
| P3 | `cd steam-cartridges; npm run check; cd ..` | after the npm banner and `> tsc --noEmit`: nothing; exit 0 |
| P4 | `cd steam-cartridges; npm run test:ts 2>&1 \| Select-String '^ℹ (pass\|fail)'; cd ..` | `ℹ pass B` and `ℹ fail 0`. **Write B down.** On `64e3350` B = 202; after the preload plan B = 204. |
| P5 | the Lua block below | every suite as on the base commit; write each count down (`L_<suite>`). On `64e3350`: backend 77 (last line `3 FAILURE(S)`: a known fixture drift, not this plan), steam_store 90, migrate 7, identity 17, metadata_service 63, art_service 59, ach_service 21, freshness 46; all others `ALL PASS`. |
| P6 | `git apply --check docs/plans/steam-cartridges-f2-community-media/s1-backend.patch` | prints nothing, exit 0 (else § 6 rule R) |

The Lua block (run from `c:\game\millennium\steam-cartridges`; `test_media_service` appears after step 1):

```powershell
$env:NSGA_STEAM_ROOT = 'C:/game/steam'
foreach ($t in 'test_backend','test_steam_store','test_migrate','test_identity','test_metadata_service','test_art_service','test_ach_service','test_freshness','test_media_service') {
  if (-not (Test-Path "tests/$t.lua")) { continue }
  $o = lua "tests/$t.lua" 2>&1
  '{0}: {1} PASS, last line: {2}' -f $t, ($o | Select-String '  PASS').Count, ($o | Select-Object -Last 1)
}
```

## 4. Do-not-touch list

- `frontend/surfaces/native-links/**`, `frontend/surfaces/captures/**` and every surface other than `community` and
  `sections` (whose only change is in the patch).
- `frontend/steam/jsx-hook.ts` (shared by identical copy with enhanced-achievements).
- `frontend/settings/defaults.ts`, `tests/fixtures/settings-defaults.json` (the four `community*` keys and defaults stay).
- `backend/screenscraper_media.lua` `M.fetch_jeu` (the patch keeps it byte for byte; do not "tidy" it).
- `backend/web_igdb.lua` beyond the added `igdb.query`; `backend/art_service.lua`, `resolve_identity.lua`.
- `tests/architecture-allowlist.json`, `tests/architecture-capabilities-allowlist.json` (must not change: a new
  entry means the code broke a layer rule).
- `docs/millennium-architecture.md` § Module layout (a dated snapshot from M9b; not regenerated here).

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`); no SharedJSContext reload; no probe or throwaway
plugins; no edits to Millennium's `config.json`, the plugin's config or `.env` (never read or print the ScreenScraper
or Twitch credentials); no changes to the user's library, collections or shortcuts; no `npm install`/upgrade (ignore
the `@steambrew/ttc` update nag); no `git push --force`; no `--no-verify`; no editing a patch file or the files it
creates "to make it fit"; no Edit tool on `tests/live/run.mjs` (finding 13). **No AI attribution** in any commit
(AGENTS.md Routine 6): no `Co-Authored-By` line, no "Generated with" footer.

## 6. Steps

Each step: check the patch, apply it, run the commands, compare with the expected output, commit. All `git` commands
run from `c:\game\millennium`; test commands from `c:\game\millennium\steam-cartridges`.

**Rule R (a patch that does not apply).** If `git apply --check <patch>` fails, run `git apply -3 <patch>` once. If it
prints `Applied patch ... cleanly` for every file, go on to the step's checks. If it reports a conflict, stop (§ 10);
the plan is stale.

### Step 1: backend (Lua)

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s1-backend.patch   # expected: no output
git apply docs/plans/steam-cartridges-f2-community-media/s1-backend.patch
git status --short -- steam-cartridges
```

Expected `git status`: 14 lines. `D` for `backend/igdb_community.lua`; ` M` for `backend/fresh_policy.lua`, `main.lua`,
`metadata_service.lua`, `net.lua`, `record_rpc.lua`, `screenscraper_media.lua`, `web_igdb.lua`, `package.json`,
`tests/architecture-unwired-rpcs.json`; `??` for `backend/bin_http.lua`, `media_service.lua`, `media_store.lua`,
`tests/test_media_service.lua`.

Checks (from `steam-cartridges`):
- The Lua block (§ 3): every suite equals its P5 count and last line, plus `test_media_service: 45 PASS, last line: ALL PASS`.
- `npm run check` → nothing, exit 0. `npm run test:ts` → `ℹ pass B`, `ℹ fail 0` (the architecture test sees
  `GetMediaImage` registered and listed as unwired until step 3).

Commit:
```powershell
git add -A steam-cartridges/backend steam-cartridges/tests/test_media_service.lua steam-cartridges/package.json steam-cartridges/tests/architecture-unwired-rpcs.json
git commit -m "feat(steam-cartridges): F2 backend, media service, ScreenScraper images downloaded into memory"
```

### Step 2: kernel and domain

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s2-kernel-domain.patch
git apply docs/plans/steam-cartridges-f2-community-media/s2-kernel-domain.patch
```

Modifies `frontend/kernel/record.ts` (`MediaItem`, `CommunityMedia`); creates `frontend/kernel/media-bin.ts`,
`frontend/domain/community-media.ts`, `tests/community-media.test.ts` (4), `tests/media-bin.test.ts` (3).

Checks: `npm run check` → nothing; `npm run test:ts` → `ℹ pass B+7`, `ℹ fail 0` (209 on `64e3350`).

Commit: `git add steam-cartridges/frontend/kernel steam-cartridges/frontend/domain/community-media.ts steam-cartridges/tests/community-media.test.ts steam-cartridges/tests/media-bin.test.ts`,
`git commit -m "feat(steam-cartridges): F2 kernel media shapes, media bin, community media rules"`.

### Step 3: ports and app

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s3-ports-app.patch
git apply docs/plans/steam-cartridges-f2-community-media/s3-ports-app.patch
```

Modifies `frontend/ports/backend.ts`, `frontend/ports/image.ts`, `tests/architecture-unwired-rpcs.json` (drops
`GetMediaImage`: now called); creates `frontend/app/media.ts`, `tests/app-media.test.ts` (7).

Checks: `npm run check` → nothing; `npm run test:ts` → `ℹ pass B+14`, `ℹ fail 0` (216).

Commit: `git add steam-cartridges/frontend/ports steam-cartridges/frontend/app/media.ts steam-cartridges/tests/app-media.test.ts steam-cartridges/tests/architecture-unwired-rpcs.json`,
`git commit -m "feat(steam-cartridges): F2 app/media and the media ports"`.

### Step 4: the community surface, sections and the kill switch

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s4-surface.patch
git apply docs/plans/steam-cartridges-f2-community-media/s4-surface.patch
```

Creates `frontend/surfaces/community/core.ts`, `frontend/surfaces/community/index.ts`, `tests/community-core.test.ts`
(8); modifies `frontend/surfaces/sections/index.ts`, `frontend/safety/features.ts`, `tests/architecture.test.ts`
(the ADR-0041 site list gains `surfaces/community`).

Checks: `npm run check` → nothing; `npm run test:ts` → `ℹ pass B+22`, `ℹ fail 0` (224). The surface is not registered
yet; nothing calls it.

Commit: `git add steam-cartridges/frontend/surfaces steam-cartridges/frontend/safety/features.ts steam-cartridges/tests/community-core.test.ts steam-cartridges/tests/architecture.test.ts`,
`git commit -m "feat(steam-cartridges): F2 community surface feeds Steam's Community Content loader"`.

### Step 5: wiring (view, settings, composition)

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s5-wiring.patch
git apply docs/plans/steam-cartridges-f2-community-media/s5-wiring.patch
```

Modifies `frontend/index.tsx`, `frontend/app/view.ts`, `frontend/settings/panels/community.tsx`, `tests/app-view.test.ts`
(three order checks gain the `media` step; no check is removed).

Checks: `npm run check` → nothing; `npm run test:ts` → `ℹ pass B+22`, `ℹ fail 0`;
`npm run build 2>&1 | Select-String 'Succeeded|TS[0-9]+'` → `build Succeeded passing all tests in …` (a `TS5096` line is
the known warning, not this plan).

Commit: `git add steam-cartridges/frontend/index.tsx steam-cartridges/frontend/app/view.ts steam-cartridges/frontend/settings/panels/community.tsx steam-cartridges/tests/app-view.test.ts`,
`git commit -m "feat(steam-cartridges): F2 wire community media into the view and the settings"`.

### Step 6: live check files (the implementer does not run them)

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s6-live.patch
git apply docs/plans/steam-cartridges-f2-community-media/s6-live.patch
node --check steam-cartridges/tests/live/probes/community_media.mjs
```

`node --check` prints nothing. Adds `tests/live/probes/community_media.mjs` and one `run.mjs` line,
`F2: community media in Steam's Community section (AM2R)` (must match `^PASS F2 cards`).

Commit: `git add steam-cartridges/tests/live`, `git commit -m "test(steam-cartridges): F2 live probe"`.

### Step 7: the new layer doc

```powershell
git apply --check docs/plans/steam-cartridges-f2-community-media/s7-docs-new.patch
git apply docs/plans/steam-cartridges-f2-community-media/s7-docs-new.patch
```

Creates `docs/steam-cartridges/service-media.md`. Committed with step 8.

### Step 8: docs (Edit tool; all files are LF)

Each **before** block below is the exact text to find (it must be found exactly once; if not, stop, § 10) and the
**after** block replaces it. Copy them from the fences, not from rendered markdown.

**8.1** `docs/decisions.md`: append the ADR-0046 block of § 2.3 (the lines inside the fence) at the end of the file,
after ADR-0045.

**8.2** `docs/steam-cartridges/rpc.md`. Before:

```
| `GetGameMedia` | `screenscraper_media.lua` | unwired | § 7.10: ScreenScraper media (Media service after M7) |
| `GetGameManual` | `screenscraper_media.lua` | unwired | § 7.10: ScreenScraper media (Media service after M7) |
| `GetGameTrailers` | `igdb_community.lua` | unwired | § 7.10: IGDB community (Media service after M7) |
| `GetGameCommunityLinks` | `igdb_community.lua` | unwired | § 7.10: IGDB community (Media service after M7) |
```

After:

```
| `GetMediaImage` | `record_rpc.lua` (→ `media_service.image`) | live | F2: `app/media.ts` fetches one ScreenScraper image as base64 (never the URL). Replaced the unwired `GetGameMedia`, `GetGameManual`, `GetGameTrailers`, `GetGameCommunityLinks` (deleted) |
```

Before:

```
wired by `app/metadata.ts`'s `ensure()` in M5b |
```

After:

```
wired by `app/metadata.ts`'s `ensure()` in M5b; F2 adds `media` (`app/media.ts`, context `igdb_id`) |
```

Then append this line at the end of the file:

```
- F2 (features plan): `GetMediaImage` added; `GetGameMedia`, `GetGameManual`, `GetGameTrailers`, `GetGameCommunityLinks` deleted with `igdb_community.lua`.
```

**8.3** `docs/steam-cartridges/service-freshness.md`. Before:

```
| achievements `ok` | 24 h (the schema; unlocks are read by their own channels, Flow C) | |
```

After:

```
| achievements `ok` | 24 h (the schema; unlocks are read by their own channels, Flow C) | |
| media `ok` (igdb / screenscraper) | 7 days | trailers and art rarely change (features plan F2) |
```

Before:

```
| `backend/steam_store_throttle.lua`, `web_igdb.lua`, `igdb_community.lua`, `web_sgdb.lua`, `retroachievements.lua`, `screenscraper_media.lua`, `achievements_store.lua`, `steam_store_rpc.lua` | Call `net` instead of `http` |
```

After:

```
| `backend/steam_store_throttle.lua`, `web_igdb.lua`, `web_sgdb.lua`, `retroachievements.lua`, `screenscraper_media.lua`, `achievements_store.lua`, `steam_store_rpc.lua` | Call `net` instead of `http` |
| `backend/bin_http.lua` (only through `net.get_binary`) | Binary bodies into memory (features plan F2) |
```

**8.4** `docs/steam-cartridges/service-metadata.md`. Before:

```
| `backend/screenscraper_media.lua` | `fetch_jeu` (the jeuInfos client, shared with media) — the ScreenScraper metadata source |
```

After:

```
| `backend/screenscraper_media.lua` | `fetch_jeu` and `jeu_for` (the jeuInfos client, shared with the media service, [service-media.md](service-media.md)) — the ScreenScraper metadata source |
```

**8.5** `docs/steam-cartridges/surfaces.md`. Before:

```
`setExtraSections(appid, record?.identity?.data?.native ? NATIVE_SECTIONS : undefined)`
```

After:

```
`setExtraSections(appid, native ? NATIVE_SECTIONS : isEnabled("community") && media ok with items ? ["community"] : undefined)`
```

Before:

```
**Record-driven in:** M4c (`identity`); M5b (`metadata`); M6 (`achievements`).
```

After:

```
**Record-driven in:** M4c (`identity`); M5b (`metadata`); M6 (`achievements`); F2 (`media`, the Community section for an unmapped shortcut).
```

Before (the heading line of the artwork section):

```
## artwork
```

After:

````
## community

Feeds Steam's own Community Content section (desktop section `community`, Big Picture COMMUNITY tab) with a
shortcut's community media: IGDB trailers (Steam's YouTube card), IGDB and ScreenScraper screenshots and artwork
(Steam's image cards and viewer). Features plan F2, ADR-0046. Pure logic in `core.ts`.

**touches:**

| Target | Guardrail |
| --- | --- |
| `CommunityContentLoader.LoadCommunityContentAndVotes` (the loader class's prototype) | 2 (one Map lookup per page), 12 (one class for every window) |
| `jsx:community-section` | 2, 17 (learn-once: property checks until the section class is seen, then disposed; the patch runs on a timer, never in the render) |

**reads:** `media`. **Injected deps:** `SurfaceDeps` + `imageOf(appid, key)` (the media bin, a pure read).

**Kill switch:** `community`. Off: the loader patch calls Steam's own loader and `sections` does not add the section.
Fail-open: a throw in the patch returns Steam's own loader and counts against `community`; a failed learn leaves the
section stock.

**API:** `communityDiagnostics()` (`patched`, `feeds`, `served`, `jsx`), exported by `index.tsx` for the live probe.

**Record-driven in:** F2.

## artwork
````

**8.6** `docs/steam-cartridges/kernel.md`. Before:

```
export type CommunityMedia = Record<string, unknown>;
```

After:

```
export interface MediaItem { kind: "video" | "screenshot" | "artwork"; source: "igdb" | "screenscraper"; youtube?; url?; thumb?; key?; width?; height?; title? }  // F2
export interface CommunityMedia { items: MediaItem[]; igdb_id?: number; ss_id?: number }   // F2; items may arrive as {} (asList)
// kernel/media-bin.ts (F2): createMediaBin(release) -> { put(appid, key, { url, width?, height? }), get(appid, key) }; 8 shortcuts
```

**8.7** `docs/steam-cartridges/safety.md`. Before:

```
    "library-home", "background-sync", "playbar", "toasts", "artwork",
```

After:

```
    "library-home", "background-sync", "playbar", "toasts", "artwork", "community",
```

Before:

```
  and `features/steam-store/logo.ts`).
```

After:

```
  and `features/steam-store/logo.ts`).
- F2: `community` appended to `FEATURE_IDS` (new surface: the Community Content loader, features plan F2).
```

**8.8** `docs/steam-cartridges/settings.md`. Before:

```
  Shared rows are in `components.tsx`.
```

After:

```
  Shared rows are in `components.tsx`.
- **Community & Media** (`panels/community.tsx`, F2): two toggles, `communityShowTrailers` and `communityShowArtworks`;
  `communityShowManuals` and `communityShowExternalLinks` keep their keys and defaults with no row until F2c.
```

**8.9** `docs/steam-cartridges.md`. Before:

```
| Metadata service and its sources | [service-metadata.md](steam-cartridges/service-metadata.md) |
```

After:

```
| Metadata service and its sources | [service-metadata.md](steam-cartridges/service-metadata.md) |
| Media service (community media) and its sources | [service-media.md](steam-cartridges/service-media.md) |
```

`docs/steam-cartridges/README.md`. Before:

```
| Artwork service (SteamGridDB, Steam CDN) | done (M5c) — [service-artwork.md](service-artwork.md) |
```

After:

```
| Artwork service (SteamGridDB, Steam CDN) | done (M5c) — [service-artwork.md](service-artwork.md) |
| Media service (IGDB, ScreenScraper) + community surface | done (F2) — [service-media.md](service-media.md), [surfaces.md](surfaces.md#community) |
```

**8.10** `docs/plans/steam-cartridges-features-plan.md`, the Order table's F2 row. Before:

```
| F2 | Media in the Community tab | Larger: new record part, new service, new surface. Needs live research first (see F2 open questions). |
```

After (write the real date):

```
| F2 | Media in the Community tab | Larger: new record part, new service, new surface. **Code done <YYYY-MM-DD> (live verification pending)** ([F2 plan](steam-cartridges-f2-community-media-plan.md)). |
```

**8.11** [CHANGELOG.md](../../CHANGELOG.md): one entry at the top, dated the day of execution: **steam-cartridges: F2
Community media (code done, live verification pending)**; facts: findings 1, 3, 7, 10, 11, 12 of § 1; ADR-0046; test
counts (TS B+22, `test_media_service` 45).

**8.12** [TASK.md](../../TASK.md) § Now: add the line "**F2 Community media:** code committed, waiting for the live
verification in [the F2 plan § 9](docs/plans/steam-cartridges-f2-community-media-plan.md)." and remove the
"execute the F2 plan" line from § Next.

Commit: `git add docs CHANGELOG.md TASK.md`, `git commit -m "docs: F2 Community media (service-media.md, ADR-0046)"`.
Do not push (Routine 5 pushes at the end of the session, after the user's § 9).

## 7. What each layer may do: the proof

`npm run test:ts` includes `tests/architecture.test.ts`. After step 5 it passes with both allowlists unchanged, which
proves: `surfaces/community` imports only `kernel`, `steam` and its own folder, fetches nothing and gets no backend call
(`imageOf` is a bin read); `app/media` touches no Steam and no `window` and keeps no module state; `ports/image` is the
only place with `URL.createObjectURL`; `domain/community-media` is pure; the backend store does not require `net`; every
registered RPC is called. `git status --short -- steam-cartridges/tests/architecture-allowlist.json steam-cartridges/tests/architecture-capabilities-allowlist.json`
must print nothing.

## 8. Guardrail checklist

Re-read each guardrail in [plugins.md](../plugins.md) and tick it with the one-line proof.

- [ ] **2 (O(1) hot paths):** the jsx observer does a flag check, then property checks, and is disposed after the class
  is learned; the loader patch is one Map lookup. Proof: `surfaces/community/core.ts` `isContentSection` and `loaderAnswer`.
- [ ] **3 (one webpack scan):** the surface resolves nothing by webpack; it learns the class from jsx. Proof:
  `git grep -n "steamRequire\|webpackChunk" -- steam-cartridges/frontend/surfaces/community` prints nothing.
- [ ] **5 (negative cache):** no `StoreItemCache` write. Proof: `git grep -n "StoreItemCache\|m_setUnavailableApps" -- steam-cartridges/frontend/surfaces/community` prints nothing.
- [ ] **10 (section memo):** the new section goes through `setExtraSections` → `refreshInstances`, which clears the memo.
  Proof: `sections/index.ts` diff touches only `render`, `reads` and two new constants.
- [ ] **11 (every window):** one prototype patch serves desktop and Big Picture (finding 2); `refreshInstances` re-renders every live sections instance.
- [ ] **12 (popups):** nothing is installed per window. Proof: no `onPopupCreate` in `surfaces/community`.
- [ ] **13 (MobX computed):** the throwaway section's constructor reads no computed (it builds a loader). Proof: `patchLoader` reads `probe.m_loader` only.
- [ ] **15 (never weaken a check):** `tests/app-view.test.ts` gains `media` entries in three order lists, no assertion removed;
  `run.mjs` gains one line. Proof: `git log -p --grep "F2" -- steam-cartridges/tests/app-view.test.ts steam-cartridges/tests/live` shows only added lines and the three replaced order lists.
- [ ] **17 (a render never starts work):** the jsx observer schedules the patch on a timer; `app/media` runs from the view
  pipeline (sensors), never from a render. Proof: `setTimeout` in `installCommunity`; `media.ensure` called only in `app/view.ts`.
- [ ] **ADR-0039/0044:** § 7's allowlists unchanged.

## 9. Live verification (the user, or a verifier the user names)

The implementer stops after step 8. After `powershell -ExecutionPolicy Bypass -File dev.ps1` (deploy and restart
Steam), from `steam-cartridges`, **desktop mode**:

### 9.1 Scripts

1. `node tests/live/probes/community_media.mjs 4263274102`: prints `PASS F2 feed: <n> cards ready for 4263274102`,
   `PASS F2 loader: Steam's loader patched, served <k> time(s)`, `PASS F2 cards: <m> of our cards in <s> Community
   section(s), 0 stock cards`, and `PASS F2 video: …` or `INFO F2 video: …`. Exit 0. (AM2R is IGDB 27238.)
2. `npm run test:live`: every line `PASS` (the parity line may `SKIP` in Big Picture), including the new F2 line and
   `render loop`.
3. Backend in Millennium's own LuaJIT: with a ScreenScraper account configured, open a RetroArch shortcut ScreenScraper
   knows; `PLUGIN_LIST['steam-cartridges-dev'].communityDiagnostics().feeds` lists it, and a card's image `src` starts
   with `blob:`. Without an account this is `needs-setup` (no ScreenScraper cards), which is correct.

### 9.2 Routines 1 and 2 (AGENTS.md)

Open AM2R: the four views of Routine 1 are unchanged, plus a **Community** section with trailer and image cards. Go to
native game B (435150), then back to AM2R: B shows its own Steam community content; AM2R's cards are intact. Repeat in
**Big Picture**: AM2R's COMMUNITY tab shows the same cards. Open a mapped shortcut (Jotunnslayer 2315502503): its
Community section still shows the native game's content (native-links).

### 9.3 The card interaction audit (the "reconsider" test)

On one IGDB trailer, one IGDB screenshot and one ScreenScraper image, desktop and Big Picture, record for each:

| Action | Expected | If not |
| --- | --- | --- |
| Play the trailer | plays inline in Steam's player | stop: record it |
| Click an image | Steam's fullscreen viewer with the image; the comments pane is empty or shows an error | a stuck viewer or an error dialog → reconsider |
| Right-click an image → Save screenshot | a download of the image (a `blob:` one may fail: note it) | note only |
| Author name/avatar | shows "IGDB" / "ScreenScraper"; a click opens a profile page for id 0 (an error page) | note: fixable by hiding the author row only through a new decision |
| Vote, award, comments, Report | fail without effect (Valve rejects the id) | any dialog that could spend Steam Points or file a real report → reconsider |
| Scroll to the end | Steam's own "no more content" line | a spinner forever → reconsider |
| `communityDiagnostics().served` after A → B → A | grows by the loads, no errors in `safetyDiagnostics().errors.community` | errors → reconsider |

"Reconsider" means: set `disabledFeatures` to include `community` (the section disappears, everything else stays),
record the observation in TASK.md, and decide with the user between hiding controls and the fallback in ADR-0046.

Only after 9.1 to 9.3: mark F2 done in the features plan's Order table and add the live results to the CHANGELOG entry.

## 10. Failure rule

Run a failing command at most twice. On the second failure stop: append the command, its output (trimmed to 30 lines)
and the step number to [TASK.md](../../TASK.md) § Active Failures & Blockers, then exit. Do not retry, edit a patch,
edit around the failure or skip ahead. A `git apply` that fails after Rule R is a failure of that step.

## 11. Dry-run record (2026-09-30)

- The code was written in a scratch worktree of `64e3350`, then replayed as six step commits in a second clean
  worktree; the replay equals the written tree (`git diff` identical, 35 files, +1686/−508).
- A third clean worktree of `64e3350`: each patch `git apply --check` exit 0, then applied in order, with these results:

  | After | `git status` lines | Checks |
  | --- | --- | --- |
  | s1 | 14 | Lua: backend 77 (3 FAILURE(S), as the base), steam_store 90, migrate 7, identity 17, metadata_service 63, art_service 59, ach_service 21, freshness 46, media_service 45 ALL PASS; tsc exit 0; test:ts 202/0 |
  | s2 | 19 | tsc 0; test:ts 209/0 |
  | s3 | 23 | tsc 0; test:ts 216/0 |
  | s4 | 28 | tsc 0; test:ts 224/0 |
  | s5 | 32 | tsc 0; test:ts 224/0 |
  | s6 | 34 | `node --check` ok; `npm run build` Succeeded (TS5096 warning only) |
  | s7 | — | `git apply --check` exit 0 |

  (Counts are cumulative because the dry run did not commit between steps; with the step commits, each step's
  `git status` shows only its own files, as § 6 lists.)
- Live, before any code (read-only CDP, 2026-09-30): findings 1 to 9 and 11. The WinINet download (finding 10) was run
  in standalone LuaJIT 2.1, not inside Millennium.
- **Not dry-run** (needs the deployed client): the loader patch taking effect, the cards in both UIs, the interaction
  audit, WinINet inside Millennium. § 9 is where they are first exercised.

## 12. Not in this plan (follow-ups)

- **F2c, links and manuals.** No Steam card fits: a Guide card (type 9) shows a title and a BBCode description with
  `[url]` links, but activating the card opens a Community page by id. Candidates to research live first: IGDB website
  links and a manual link in Steam's own links bar (`links` prop, rendered for an enriched shortcut; the jsx target
  belongs to `native-links`, so it would be that surface's change), or Guide cards if a click on a BBCode link can be
  kept from reaching the card. ScreenScraper manuals are PDFs behind the credentialed URL: they need the same
  in-memory path plus a viewer. The settings keys `communityShowManuals` / `communityShowExternalLinks` wait for this.
- **ScreenScraper videos** (MP4): Steam's video card plays YouTube ids only.
- **Controls on our cards** (finding 7): whatever § 9.3 shows.
- **Provider extraction** (TASK.md Next): `media_service`'s two sources are the shape a provider plugin would take over.
