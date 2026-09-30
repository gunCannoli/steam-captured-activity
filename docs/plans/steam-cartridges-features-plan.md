# Plan: steam-cartridges features after the migration

**Status:** Draft 2026-09-29, for an architecture agent to detail and an implementer agent to execute.
**Kind:** Umbrella feature plan. It fixes *what* each feature is, the user decisions already taken, and *which modules in
which layer* each one touches. It does not contain literal before/after blocks; the architect adds those (see
[the plan writing standard](README.md)).
**Builds on:** [the migration plan](steam-cartridges-architecture-migration-plan.md) (Complete). Layer rules:
[steam-architecture.md § 3](../steam-architecture.md), [README of the layer docs](../steam-cartridges/README.md),
[ADR-0039](../decisions.md#adr-0039-steam-cartridges-is-a-ports-and-adapters-modular-monolith-only-surfaces-write-to-steam).
**Replaces:** items 3–6 of the migration plan's [§ 7.10 unwired register](steam-cartridges-architecture-migration-plan.md#710-unwired-features-register-11-item-7).

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
| F1 | Game Data editor: manual metadata and manual Steam link (settings popup) | Small, no new Steam write, backend mostly done. Fixes wrong data and unwanted suggestions today. |
| F2 | Media in the Community tab | Larger: new record part, new service, new surface. Needs live research first (see F2 open questions). |

Each feature ships separately (own commit series, own live verification, own CHANGELOG entry).

---

## F1: Game Data editor (manual Game Info and manual linking)

### What the user sees

Settings → a new section **"Game Data"** with a button **"Edit game data…"**. The button opens a modal
(`SettingsModal`, already in `settings/components.tsx`):

- Top: a **text filter** and a **dropdown** listing every non-Steam shortcut (filtered as you type).
- After choosing a game: a form with **every field of the game's metadata** (title, summary/description, developers,
  publishers, franchises, genres, release date, categories/modes, controller support, …), each editable, with **Save**
  and **Revert to fetched data**.
- A **"Steam link"** block: the current link (or "not linked"), a **search box over Steam's native games** with results
  to pick from, **Link**, and **Unlink** (with a "never suggest again" choice).
- A saved edit is never overwritten by a refresh (the backend already guarantees it through `custom_override`, K15).

### Modules touched, by layer

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | none expected (`GameMetadata`, `Identity`, `StoreApplied` exist). Architect: confirm the editable field list against `GameMetadata`. |
| domain | `domain/metadata-edit.ts` (new, pure) | The editable-field table (key, label, type), `parseDraft(form) -> GameMetadata`, `validate`, `diff(original, draft)`. Unit tests, no imports beyond `kernel/`. |
| backend | `web_rpc.lua` `SaveGameMetadata` (exists, unwired) | Verify payload shape and that it sets `custom_override`; add a way to **clear** the override (revert), if missing. |
| backend | `steam_store_rpc.lua` (+ `steam_store_search.lua`, exists) | New read-only RPC `SteamStoreSearchCandidates(title)` returning native candidates **without writing anything**. (`SteamStoreSearch` was deleted in M9a because it auto-mapped; this one never maps.) Register in `main.lua`; Lua test. |
| backend | `steam_store_store.lua` (exists) | `SteamStoreClearMapping(appid, reject)` already supports "never suggest again". Confirm `set_mapping` clears the appid's pending suggestions (that is what makes reject unnecessary). |
| ports | `ports/backend.ts` | Add `saveGameMetadata`, `clearMetadataOverride` (if added), `steamStoreSearchCandidates`. The registration test then checks them against `main.lua`. |
| app | `app/game-editor.ts` (new) | Use case: `load(appid)` (record + native link state), `save(appid, draft)`, `revert(appid)`, `search(title)`, `link(appid, steamAppid)` (reuses `app/steam-store.ts` `setSteamStoreMapping`), `unlink(appid, reject)` (reuses `clearSteamStore`). After a write it invalidates and re-ensures the record so surfaces re-render (D5: never on a Steam render stack). |
| settings | `settings/panels/game-data.tsx` (new) | The section with the button. |
| settings | `settings/game-editor/` (new folder: `modal.tsx`, `game-picker.tsx`, `metadata-form.tsx`, `steam-link.tsx`) | The popup. Reads the app only through `usePanelContext()`. |
| settings | `settings/context.ts`, `settings/panel.tsx` | Add `ctx.editor` (structural type of `app/game-editor.ts`), add the section. |
| index | `index.tsx` | Build the editor from `createGameEditor(...)` and pass it to `setPanelContext`. |

No new surface and no new Steam write: the existing `game-info` surface re-renders from the changed `record.metadata`.

### Open questions for the architect

- Which `GameMetadata` fields exist today and which does Steam's Game Info actually show (description, developers, …)?
- Is `SaveGameMetadata`'s response enough for the app to update `record.metadata` directly, or must it call
  `EnsureFresh`? (A `custom_override` record must come back as `ok` and must not trigger network.)
- The shortcut list: reuse `ctx.routing.listShortcuts()` (already in the context).
- Do we need a kill switch for the editor? (It writes only our own files; probably not.)

### Tests and live verification

- `tests/metadata-edit.test.ts` (domain), `tests/game-editor.test.ts` (app, fake ports), one Lua test per new RPC.
- Live (extend `tests/live/click_settings_panel.mjs`): open the modal, pick AM2R, change the description, Save, open the
  game's page and read the new description; Revert restores it. Link a shortcut to a native app by search, then Unlink.
- `npm run test:live` stays all PASS; the migration's architecture tests stay green.

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
