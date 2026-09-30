# Plan: steam-cartridges features after the migration

**Status:** Draft 2026-09-29, for an architecture agent to detail and an implementer agent to execute.
**Kind:** Umbrella feature plan. It fixes *what* each feature is, the user decisions already taken, and *which modules in
which layer* each one touches. It does not contain literal before/after blocks; the architect adds those (see
[the plan writing standard](README.md)).
**Builds on:** the migration plan (Complete). Layer rules:
[steam-architecture.md § 3](../steam-architecture.md), [README of the layer docs](../steam-cartridges/README.md),
[ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam).
**Replaces:** items 3–6 of the migration plan's § 7.10 unwired register.

## The layers, in one paragraph (for the reader who has not read the migration)

`sensors` see what the user does in Steam → `app` (thin use cases) asks the backend through `ports/backend.ts`
→ backend `services` resolve and fetch → one `GameRecord` per shortcut (`kernel/record.ts`) → `surfaces` are the **only**
code that writes into Steam. `domain` is pure logic (no Steam, no I/O). `settings` is our own UI and reaches the app only
through `settings/context.ts`. `index.tsx` composes everything. Every surface has a kill switch. New Steam writes need a
new surface with declared `touches` (disjoint from every other surface; a test enforces it).

## Decisions already taken (user, 2026-09-29)

1. **Media** appears in Steam's own **Community Content / Community tab** (Big Picture first, desktop where Steam's
   section allows it). Reuse Steam's section, do not build a custom tab (ADR-0022).
2. **Manual Game Info** is a **button that opens a popup panel**: pick a non-native game (text filter + dropdown of all
   shortcuts), see **all** its metadata, edit any field by hand.
3. The same panel offers **searching Steam's native games to link one manually**. A manual link replaces the "reject a
   suggestion" button (old § 7.10 item 6): once you link (or unlink with "never suggest again"), the suggestion problem
   is gone. The reject-suggestion UI is **not built** as a separate feature.

## Order

| # | Feature | Why this order |
| --- | --- | --- |
| F1 | Game Data editor: manual metadata and manual Steam link (settings popup) | Small, no new Steam write. Fixes wrong data and unwanted suggestions today. **Code done 2026-09-30 (rebuilt on top of M10; live verification pending)** ([F1 plan](steam-cartridges-f1-game-data-editor-plan.md)). |
| F2 | Media in the Community tab | Larger: new record part, new service, new surface. Needs live research first (see F2 open questions). |

Each feature ships separately (own commit series, own live verification, own CHANGELOG entry).

---

## F1: Game Data editor (manual Game Info and manual linking)

**Detailed, executable plan:** [steam-cartridges-f1-game-data-editor-plan.md](steam-cartridges-f1-game-data-editor-plan.md)
(five verified patches, preconditions, expected outputs, live checklist). This section keeps the scope and the decisions.

### What the user sees

Settings → a new section **"Game Data"** with a button **"Edit game data…"**. The button opens a modal
(`SettingsModal`, already in `settings/components.tsx`):

- Top: a **text filter** and a **dropdown** listing every non-Steam shortcut (filtered as you type).
- After choosing a game: a form with every field Steam's Game Info shows (title, description, developers, publishers,
  franchises, genres, release date, first release, player badges), each editable, with **Save** and
  **Revert to fetched data**. Controller support is not a field (it follows the emulator inference and the controller
  setting; the popup says so).
- A **"Steam link"** block: the current link (or "not linked"), a **search box over Steam's native games** with results
  to pick from and **Link**; **Unlink** and **Unlink and never suggest it again** (a plain Unlink can match the same
  game again by title).
- A saved edit is never overwritten by a refresh (`custom_override`, K15), and it beats a Steam link too: an edited game
  keeps its edited data after linking until **Revert**.

### Modules touched, by layer (as built in the detailed plan)

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | none (`GameMetadata`, `Identity` already cover it). |
| domain | `domain/metadata-edit.ts` (new, pure) | Field table, `MetadataDraft`, `draftOf`, `validate`, `diff`, `applyDraft` (also edits `store_category_ids`, which Game Info prefers over `categories`). |
| backend | `metadata_service.lua`, `record_rpc.lua`, `web_metadata_db.lua` | `save_custom`, `clear_custom`, `delete`; RPCs `SaveCustomMetadata`, `ClearCustomMetadata`. The unwired `SaveGameMetadata` is deleted (it took native appids and validated nothing). |
| backend | `steam_store_search.lua`, `steam_store_rpc.lua` | `candidates()` and `SteamStoreSearchCandidates`: read-only, raw store hits, never maps. |
| backend | `steam_store_store.lua` | none: `set_mapping` already clears pending suggestions and `clear(appid, true)` already remembers a rejection. |
| ports | `ports/backend.ts` | `saveCustomMetadata`, `clearCustomMetadata`, `steamStoreSearchCandidates`. |
| app | `app/game-editor.ts` (new) | `load`, `save`, `revert`, `search`, `link`, `unlink`; `link`/`unlink` reuse `app/steam-store.ts`. Writes only the record; the `game-info` surface re-renders from it. |
| settings | `settings/panels/game-data.tsx`, `settings/game-editor/*`, `settings/context.ts`, `settings/panel.tsx` | The section and the popup; reaches the app only through `ctx.editor`. |
| index | `index.tsx` | Builds the editor, passes it to `setPanelContext`, exports `gameData` for the live probe. |

No new surface, no new Steam write, no kill switch (the editor writes only our own files; the Steam side stays behind
`game-info`'s switch).

### Answers to the earlier open questions

- Editable fields: the ones `enrichGameDetails` reads (`description`, credits, `release_date`, `original_release_date`) plus title, genres
  and the four player badges. `short_description`/`summary` are dropped by the DB on every write, so they are not fields.
- `SaveCustomMetadata` returns the `custom` part, so the app updates the record without `EnsureFresh`; only Revert re-resolves.
- The shortcut list is `ctx.routing.listShortcuts()`.
- No kill switch (see above).

### Tests and live verification

- Unit: `tests/metadata-edit.test.ts` (9), `tests/game-editor.test.ts` (8); Lua: `test_metadata_service.lua` 49 → 64, `test_steam_store.lua` 84 → 91.
- Live: `tests/live/probes/game_editor.mjs` (save → Game Info shows it → revert → search), `check_settings_panel.mjs` (9 titles),
  `npm run test:live`, plus the by-hand checklist in the detailed plan § 7 (filter, edit, link, unlink, Big Picture).

---

## F2: Media in the Community tab

### What the user sees

On a shortcut's page, in Big Picture's **Community** tab (and the desktop Community Content section where Steam's own
component can show it): **trailers/videos**, **extra artwork/fanart**, **links**, and a **manual** link, taken from
IGDB (community: trailers, links, official artwork) and ScreenScraper (videos, fanart, manuals). Shortcuts mapped to a
Steam native app keep Steam's own community content (unchanged); this feature is for the rest.

### Modules touched, by layer

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | New record part `media` (`Part<Media>`: `trailers[]`, `videos[]`, `artworks[]`, `links[]`, `manual?`), added to `RecordPart` and to the record store. |
| backend | `media_service.lua` (new) | Resolves the `media` part like `metadata_service.lua`: sources IGDB community + ScreenScraper, respecting the service toggles and routing (`allowWeb`, `allowScreenscraper`). |
| backend | `igdb_community.lua`, `screenscraper_media.lua` (exist) | Become the service's sources (no rewrite). Their RPCs `GetGameTrailers`, `GetGameCommunityLinks`, `GetGameMedia`, `GetGameManual` stay registered until the service replaces them, then are deleted (dead-code rule D13). |
| backend | `fresh_policy.lua`, `record_rpc.lua` | TTL for `media`; `EnsureFresh` accepts `parts: ["media"]`. |
| ports | `ports/backend.ts` | `RecordPart` already flows through `ensureFresh`; add nothing unless the payload needs a type. |
| app | `app/media.ts` (new) | Like `app/metadata.ts`: `ensure(appid, route, identity)`, writes `record.media`. Only for shortcuts without a native Steam match. |
| app | `app/view.ts` | Call `media.ensure` in the view pipeline after metadata (lazy: only when the Community tab or section is shown, to keep first open cheap; the architect decides). |
| surface | `surfaces/community/` (new) | The **only** writer. Feeds Steam's own Community Content component from `record.media`. New kill switch id `community` in `safety/features.ts`; declared `touches` disjoint from `native-links` and `captures`. |
| settings | `settings/panels/community.tsx` (exists) | Already has the help line "applies when the Media service is connected"; add per-source toggles if the architect wants them. |
| index | `index.tsx` | Register the surface, wire `media` into the record store and the render queue. |

### Open questions for the architect (research first, live, read-only)

1. **What renders Big Picture's Community tab and the desktop Community Content section, and what store or props feed
   it?** The old custom tab (never mounted) and its store wrote `CWorkshopStore.m_mapPublishedFiles` (removed in M3.0;
   `git show 5b6b2c8:steam-cartridges/frontend/renderers/community-tab.tsx`). Verify against the current Steam build
   with the [inspection method](../steam-debug.md#3-the-inspection-method) before designing.
2. Can Steam's component show **video** items (trailers) or only images/screenshots? If videos are impossible, decide
   between thumbnails that open the video externally, or a link row.
3. How does the section behave for an **unmapped** shortcut (`native-links` currently redirects only mapped ones)?
4. Image/video **hosts** and the CORS/allowlist story (`SteamStoreDownloadImage` has an allowlist).
5. Credentials: ScreenScraper needs the user's account; IGDB uses the Twitch keys already in settings.

### Tests and live verification

- Lua tests for `media_service` (fake sources), `tests/app-media.test.ts`, a pure-logic test for any mapping in `domain/`.
- Live: `check_all_tabs.js`-style check that the Community tab shows the media items for a chosen unmapped shortcut,
  navigation cycle A → B → A stays intact, and `npm run test:live` all PASS. Render-loop guard (`count_cycle`) must not
  regress: the surface writes from `record.updated` on a timer, never inside a Steam render.

---

## Rules for both features (from the migration; the architect re-checks each)

- A new Steam write needs a **surface** with a kill switch and fail-open hooks; nothing else may write to Steam.
- No import of `app/` from `settings/` or `surfaces/`; the settings panels use `settings/context.ts` only.
- `index.tsx` only composes. No hooks with `keepJsxPatched` beyond the three sites of [ADR-0041](../decisions.md).
- Never write to Steam from inside a Steam render (D5, ADR-0042).
- Each step ends with `npm run check`, `npm run test:ts`, the Lua suites and, after a deploy, `npm run test:live`
  (needs Steam on the desktop; `check_all_tabs.js` opens Big Picture by itself).
- Docs per step: the layer docs the change touches (`settings.md`, `rpc.md`, `surfaces.md`, `service-*.md`),
  [CHANGELOG.md](../../CHANGELOG.md), [TASK.md](../../TASK.md).
