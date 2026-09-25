# steam-cartridges — research & implementation plan

**Status:** 📝 Plan only. No code written. Implementation tasks move into
[TASK.md](../TASK.md) one phase at a time; decisions get ADRs in
[decisions.md](decisions.md) when a phase starts.
Phase plans: [P0](plans/steam-cartridges-p0-research.md) ·
[P1](plans/steam-cartridges-p1-merger.md) · [P2](plans/steam-cartridges-p2-buckets.md) ·
[P3](plans/steam-cartridges-p3-steam-store.md). ADRs 0032–0034 are written; where
they refine this doc (config shape, frontend-only bucket resolution, data folder),
the ADRs win.

`steam-cartridges` merges [`non-steam-games-activity`](../non-steam-games-activity/)
and [`steamgriddb-artwork`](../steamgriddb-artwork/) into one plugin that owns
**everything about making a non-Steam library feel native**. It also absorbs the
useful half of [`research/game-data-linker`](../research/game-data-linker/) and adds
achievements, informed by `research/PlayniteAchievements` and
`research/Playnite-LocalAchievements-Plugin`.

---

## 1. Goals and non-goals

**Goals**

1. One plugin, one settings page, one backend, one frontend bundle.
2. Every non-Steam shortcut is routed to exactly one **source bucket** (§4) that decides
   where its metadata and artwork come from.
3. Games that _are_ on Steam (Epic/GOG copies, launchers) borrow Steam's own data — no scraping.
4. Achievements where a source exists (Steam native, RetroAchievements). Otherwise none.
5. The core stays useful with zero accounts, zero keys and zero network (existing rule,
   [ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them)).

**Non-goals (for now)**

- User-created/manual achievements.
- Epic/Xbox sign-in, friends, news, community hub (linker features; see §3.3 — dropped).
- Achievements for games with no source (old Windows games, uncovered ROMs): nothing shown.
- Replacing SteamGridDB tooling users already have; artwork scraping is the **last, optional** phase.

`enhanced-achievements` and `enhanced-notifications` stay separate plugins (toast theming).
They may later consume the achievement data this plugin produces (§7.5).

---

## 2. Audit of what exists

| Source | Size | What it gives us | Verdict |
| --- | --- | --- | --- |
| `non-steam-games-activity` | Lua: captures, gameid, rpc, shortcuts, steam_paths. TS: sections, stores, summary, activity, jsx-hook, renderers | Restores Steam's app-detail sections for shortcuts; feeds Steam's own stores from captured screenshots/clips | **Becomes the core of `steam-cartridges`**, moved as-is |
| `steamgriddb-artwork` | `sgdb.lua` (search, grids/heroes/logos), `igdb.lua` (489 lines, Twitch creds), `metadata_db.lua`, `config.lua`; TS `artwork.ts` (`SetCustomArtworkForApp`), `game-info-patch.ts`, `metadata.ts` | Web metadata (IGDB) + artwork (SGDB) for shortcuts; Game Info tab patch | **Becomes the "Web Scraping" bucket.** SGDB part is demoted to the optional last phase |
| `research/game-data-linker` | 1944-line `main.lua`, 3544-line `index.tsx` | `save_mapping(non_steam_id, steam_id)`, `fetch_game_data` (store `appdetails`), `save_artwork` (Steam CDN → `userdata/<acct>/config/grid`), `steam_search_appid` (storesearch), activity/achievements feed | **Mine for the Steam Store bucket** (§3). Epic/Xbox/news/community: drop |
| `research/PlayniteAchievements` | Provider-per-source design (`IDataProvider`, `ProviderRegistry`) incl. `RetroAchievements/`, `Steam/`, `RPCS3/`, `ShadPS4/`, `Xenia/` | Best reference for provider shape, RA hash→game resolution, RA API calls, Steam schema/stat parsing | **Design reference**; port the ideas, not code (C#/GPL-adjacent, see §9) |
| `research/Playnite-LocalAchievements-Plugin` | `Readers/` (Codex/Rune/Goldberg ini), `SteamSchemaFetcher`, `SchemaCacheService`, `AppIdResolver`, `FileWatcherService` | Local emulator achievement files + schema cache + file watching | **Out of scope now** (games with a Steam emu); note for later. **GPLv3 – do not copy code** |

Shared code already duplicated between the two plugins (`_lib/*`, `shortcuts.lua`,
`steam_paths.lua`, `gamepad-appid.ts`, `jsx-hook.ts`) collapses to one copy in the merge.

---

## 3. Feature: Steam Store bucket (from `game-data-linker`)

**Idea.** A shortcut that is really a Steam game (Epic copy of *Alan Wake 2*, GOG install, a
launcher stub) should copy from the native app rather than scrape anything. The native
AppID is the only fact needed; Steam already has the data.

### 3.1 Resolution: shortcut → native appid

Ordered, first hit wins, result cached per shortcut and **always user-overridable**:

1. **Manual mapping** — `mappings.json` `{ shortcutAppid → steamAppid }`
   (linker's `save_mapping`/`remove_mapping`/`get_all_mappings`).
2. **Owned/known native match** — exact normalised-title match against
   `appStore.allApps` (native apps the client already knows). Zero network.
3. **Store search** — `store.steampowered.com/api/storesearch` by cleaned title
   (linker's `steam_search_appid`, with its cache). Accept only an exact
   normalised match; near-matches go to a "suggestions" list, never applied silently
   (same rule as [ADR-0008](decisions.md#adr-0008-resolve-romgameid-by-cached-history-first-manual-override-last)).

Do not resolve at all when the shortcut's exe is an emulator (RetroArch etc.); those belong
to Web Scraping by default (§4).

### 3.2 What gets copied

| Piece | Source | Applied via |
| --- | --- | --- |
| Portrait / hero / logo / wide capsule | Steam CDN `library_600x900`, `library_hero`, `logo`, `header` | `SetCustomArtworkForApp` (frontend; already used) — preferred over the linker's disk write into `grid/` |
| Description, developers, publishers, release date, categories, genres | `appdetails` | Existing `game-info-patch.ts` path |
| Achievements schema | Steam (see Phase 5) | Steam's own achievement stores |
| Friends, news, community, reviews | — | **Not copied.** Out of scope |

Reuse the linker's `fetch_game_data` (10 lines of real logic) and its CDN image list;
do not port its 3.5k-line UI — `steam-cartridges` renders through Steam's own sections.

### 3.3 Dropped from the linker

Epic and Xbox auth, friends-who-play, partner-event/news scraping, community hub
scraping, status-update posting. They need accounts and network, fight the "core needs
nothing" rule, and overlap what Steam already shows once artwork/ids resolve.

---

## 4. Feature: exclusive source buckets

Two buckets decide **where a game's info comes from**:

| Bucket | Sources | Needs |
| --- | --- | --- |
| **Steam Store** | Native appid → Steam CDN + `appdetails` (§3) | nothing |
| **Web Scraping** | IGDB metadata (existing `igdb.lua`); SteamGridDB artwork (optional, off by default, Phase 6) | Twitch creds (IGDB), SGDB key |

**Rules**

- **Exclusive:** a shortcut belongs to at most one bucket. A **collection** is assigned
  to one bucket; the UI refuses to add a collection to both (and shows where it already lives).
- The user picks collections per bucket: *include* list per bucket. Convenience: an
  **exclude** on one bucket is shown as "everything else goes to the other" — stored
  canonically as include lists plus a `default` bucket (`steam-store` | `web-scraping` | `none`)
  for shortcuts in no listed collection.
- A game in several collections resolves by a fixed precedence (explicit per-game override →
  first matching collection in user-defined order → `default`). Conflicts are reported in
  settings, not silently resolved.
- Example from the request: exclude all retro collections from **Steam Store**, include them
  only in **Web Scraping**.
- **Decided:** shortcuts in no listed collection are **ignored** (`default = none`); the plugin
  touches only games the user has put in a bucket. No automatic emulator guessing.

**Config shape** (`config.json`, read through the Millennium config API; keep the
workaround from Blocked-upstream #903 in one `settings.ts`):

```jsonc
{
  "buckets": {
    "default": "none",
    "steamStore": { "collections": ["My Epic Games"] },
    "webScraping": { "collections": ["Retro", "SNES", "GBA"] },
    "overrides": { "2890139989": "web-scraping" }
  }
}
```

**Frontend facts to verify in Phase 1** (do not assume): how to enumerate collections and
their members from `collectionStore` (see [decisions.md ADR near L710](decisions.md)) and
observe changes. Record in `steam-components.md` once traced.

---

## 5. Feature: achievements (Phase 5, own phase)

Builds on the already-verified hook points in [TASK.md Phase 5](../TASK.md): re-enable the
`"achievements"` section, feed `AppDetailsStore.GetAchievements`, `CGamePlaySession.AddAchievement`,
and `appAchievementProgressCache` (Big Picture).

### 5.1 Sources (no sources → no achievements, nothing rendered)

| Source | Applies to | Data path |
| --- | --- | --- |
| **Steam native list** | Steam Store bucket games with a resolved native appid | Schema + global percentages: public `ISteamUserStats/GetSchemaForGame` / `GetGlobalAchievementPercentagesForApp` (Web API key, optional) or Steam client's own stores for the native app. Unlock state: **only if the user owns the native game** (Steam knows it); otherwise show the list as locked/total. Mirrors linker "achievements" behaviour |
| **RetroAchievements** | Web Scraping bucket, RetroArch games | ROM → RA GameID (existing ADR-0008 logic), `API_GetGameInfoAndUserProgress`; icons from RA `Badge` CDN. Credentials from `retroarch.cfg` (`cheevos_*`), read at runtime, never copied to repo/logs |
| _(later)_ Local emulator files | Goldberg/CODEX/RUNE ini, RPCS3 `TROPUSR.DAT` | Reference: Playnite-LocalAchievements `Readers/`. **Not in v1** |

Decision 2 above applies. Steam-native achievement schema is **not** the same as the user's unlocks for a shortcut:
document clearly in UI that a Steam Store game not owned on Steam shows locked-only state.

### 5.2 Internal provider shape

Adopt PlayniteAchievements' idea (one interface, registry) but in Lua/TS, **inside** the plugin,
not as separate plugins:

```
achievements/
  provider.ts     // { id, supports(ctx) , load(ctx) → { total, unlocked, items[] } }
  steam.ts
  retroachievements.ts
  registry.ts     // picks the provider from the game's bucket + identity
```

Output normalised to what the Steam stores expect (`nAchieved`, `nTotal`, `vecHighlight`,
`vecUnachieved`; Big Picture `{ unlocked, total }`). Failure/`unsupported` is silent
([ADR-0014](decisions.md#adr-0014-providers-are-isolated-and-fail-silently)).

### 5.3 Things to steal / avoid from the research repos

- PlayniteAchievements: provider registry, per-provider settings + capability flags,
  RA hash cache/index stores (cache ROM hashes, don't rehash), rarity calculation from
  global percentages, refresh throttling.
- LocalAchievements: schema cache on disk, file watcher for change-driven refresh.
- **Avoid:** Exophase/HoYoverse/etc. providers, friends data, notification UI (that is
  `enhanced-achievements`), custom icons.

---

## 6. Feature: optional SteamGridDB artwork (last phase)

Web Scraping bucket only. **Off by default.** Needs the existing SGDB key.

Query flow already exists in `sgdb.lua` (`search_game`, `fetch_artwork_urls`). New: a
user **filter rule** applied to SGDB results before choosing one.

**Rule syntax** — one rule per artwork type, small and forgiving instead of a full regex UI:

```
g{ElGrid24:1024}      grid by author "ElGrid24", max 1024 KB
h{*:2048}             hero, any author, max 2048 KB
l{Foo}                logo by author Foo, any size
g{/^El.*/i:1024}      author matches regex, max 1024 KB
```

Grammar: `<type>{<author>[:<maxKB>]}` with `type ∈ g|h|l|w` (grid-portrait, hero, logo, wide);
`author` is `*`, a literal, or a `/regex/flags`. Multiple rules separated by `;` or newline,
tried in order, first SGDB hit that matches wins; none match → fall back to the first result
(setting: *strict* = apply nothing). Format is unrestricted (png/jpg/webp/gif).

Implementation notes: SGDB responses carry `author.name`, `style`, `mime`, dimensions and
(`width*height`) but not always file size — size must come from a `HEAD`/`Content-Length`
check before download; add a cost note in settings. Validate the rule in the settings UI
(show parsed result) and never `eval` user text; compile regexes with a length cap and
timeout guard.

Lower priority than everything else because Steam-game artwork comes from the CDN and
existing SGDB tools already do this well.

---

## 7. Architecture of the merged plugin

### 7.1 Layout

```
steam-cartridges/
  plugin.json                (name: steam-cartridges)
  backend/
    main.lua                 // RPC surface only
    _lib/…                   // one copy of fs/http/json/logger/…
    steam_paths.lua  shortcuts.lua  gameid.lua
    captures.lua             // from non-steam-games-activity
    buckets.lua              // NEW: collection→bucket resolution helpers, config
    steam_store/{resolve,appdetails,cdn}.lua     // NEW (linker-derived)
    web/{igdb,metadata_db}.lua                    // from steamgriddb-artwork
    web/sgdb.lua                                  // Phase 6, gated
    achievements/{steam,retroachievements}.lua    // Phase 5
  frontend/
    steam/…                  // merged: sections, stores, summary, activity, jsx-hook, gamepad-appid
    features/{artwork,game-info,buckets,achievements}/
    settings.ts
```

Merge rule: **`non-steam-games-activity` is the base** (more mature, has tests), the
artwork plugin's modules are moved into `features/` and `web/`. Do not rewrite either.

### 7.2 Naming/ids

New plugin `name: steam-cartridges`, common name "Steam Cartridges". Dev deploys as
`steam-cartridges-dev` via `dev.ps1` (parametrised Steam path). Old plugins are removed
from the plugins dir on deploy of the release; a one-time migration copies
`steamgriddb-artwork` API key/Twitch creds and `metadata_db.json` into the new plugin's data
folder (only if the key exists; never log it).

### 7.3 Provider contract

The planned external-provider contract in
[millennium-architecture.md](millennium-architecture.md#the-provider-contract) is
**unchanged** and stays for third-party providers (`retroarch` etc.). The Phase 5 achievement
providers are *internal* modules, not plugin discovery. Reconcile in an ADR when Phase 5
starts: either RA becomes internal only, or exposes `Collect()` too.

### 7.4 Settings UX (single page)

1. Buckets: table of collections × {Steam Store, Web Scraping, Neither}, default bucket,
   per-game override list, conflict warnings.
2. Steam Store: mappings editor (shortcut ↔ native appid, "suggestions" list).
3. Web Scraping: IGDB creds status; SGDB toggle (default off) + rule field with live parse.
4. Achievements: source toggles, RA status (read from `retroarch.cfg`), Steam Web API key (optional).

### 7.5 Interaction with the other plugins

`enhanced-achievements` keeps theming Steam's toasts, independent. Optional later: export
normalised achievement data through the provider contract so toasts/captures can key off it.

---

## 8. Phases

Each phase ships independently and ends green on `npm run check`, `npm run build`, and
Routines 1–3 in [AGENTS.md](../AGENTS.md). Phases 0–2 are prerequisites; 3+ can reorder.

### Phase 0 — Research closure (small)

- Trace collection enumeration/membership/observers in the live client → `steam-components.md`.
- Confirm `SetCustomArtworkForApp` handles Steam-CDN downloads from the frontend (base64 size limits).
- Confirm Steam schema sources for achievements without an API key (client stores vs Web API).
- Write ADRs: 0032 merge decision, 0033 exclusive buckets, 0034 achievement sourcing.

### Phase 1 — Plugin merger (no behaviour change)

- Create `steam-cartridges/` from `non-steam-games-activity`; move `steamgriddb-artwork`
  modules in; dedupe `_lib`, `shortcuts.lua`, `steam_paths.lua`, `gamepad-appid.ts`, `jsx-hook.ts`.
- Single `index.tsx` boots both feature sets. Rename RPC namespaces only where they collide.
- `dev.ps1`, tests (`tests/`), README, CHANGELOG, plugin.json, docs links updated.
- One-time settings migration (§7.2).
- **Exit:** everything the two plugins did still works, from one plugin; old two removed from dev deploy.

### Phase 2 — Bucket engine

- `buckets.lua` + `settings.ts` config, collection picker, exclusivity validation, resolve API
  `getBucket(appid)` used by every feature (metadata/artwork gated on it).
- Existing IGDB metadata + game-info patch run **only** for Web Scraping bucket games.
- **Exit:** with a fixture of two collections, each game gets exactly one bucket; changing a
  collection reflects without restart.

### Phase 3 — Steam Store bucket

- Resolver (§3.1), `mappings.json`, suggestions list, `appdetails` metadata, CDN artwork via
  `SetCustomArtworkForApp`, Game Info tab fed from native data. Clear/undo per game.
- **Exit:** an Epic copy of a known Steam game shows full native art/info; retro game untouched.

### Phase 4 — Hardening

- Two-way navigation test (Routine 2) across both buckets; negative cache for failed
  resolves; rate limits; offline behaviour (core still works).

### Phase 5 — Achievements

- 5a: Steam-native list for Steam Store games (locked-only if unowned).
- 5b: RetroAchievements for RetroArch games (reuse ADR-0008 resolution + `retroarch.cfg`).
- 5c: normalisation layer + the four store feeds + Big Picture; games without a source render nothing.
- **Exit:** owned Steam game and a mapped ROM both show progress on desktop and Big Picture;
  an unsupported old Windows game shows no achievements section and no errors.

### Phase 6 — SteamGridDB artwork (optional, last)

- Toggle (off by default), rule parser + tests, `HEAD` size check, per-type fallback policy.
- **Exit:** `g{ElGrid24:1024}` selects only that author's grids ≤1 MB; invalid rules
  report parse errors and change nothing.

### Later / parked

Local emulator achievement readers (Goldberg/RPCS3), external provider contract for
achievements, user-created achievements.

---

## 9. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| Millennium config API bug [#903](https://github.com/SteamClientHomebrew/Millennium/issues/903) | Keep workaround isolated in `settings.ts` |
| Wrong Steam match copies another game's art | Exact normalised title only; suggestions never auto-applied; one-click undo |
| Merging breaks two mature plugins at once | Phase 1 is refactor-only, behaviour frozen by existing tests + smoke Routines |
| `LocalAchievements` is GPLv3 | Read for ideas only; no copied code. Check `PlayniteAchievements` license before any port |
| SGDB size filtering needs extra requests | Opt-in, HEAD-only, cached |
| Steam Web API key requirement for schema | Prefer client stores; key optional |
| IGDB creds burden | Already optional; Steam Store bucket needs none |

**Decisions (user)**

1. Apps in no collection are ignored (`default = none`). "Ignored" means nothing is fetched or
   sourced for them. Game Info already saved locally still shows, as it did before the merge
   ([ADR-0035](decisions.md#adr-0035-local-game-info-is-a-capture-tier-feature-buckets-gate-only-fetching)).
2. A Steam-listed game added from another store (e.g. Xbox) shows Steam's achievement list
   **locked-only**, labelled "no unlock tracking": Steam has no unlock state for a copy it does
   not own, and Xbox unlocks would need Xbox sign-in (parked, "Later").
3. `enhanced-achievements` / `enhanced-notifications` (existing toast-theming plugins) stay
   separate; unrelated to this merger.

---

## 10. Where each doc changes when work starts

- [TASK.md](../TASK.md): replace Phase 5 roadmap with these phases as checklist items.
- [CHANGELOG.md](../CHANGELOG.md): merger decision + milestones.
- [decisions.md](decisions.md): ADRs listed in Phase 0.
- [millennium-architecture.md](millennium-architecture.md): core/provider split, module layout.
- [AGENTS.md](../AGENTS.md): plugin names in Routine 4.

## Addendum: confirmations after the P0–P3 plans

1. ADR-0032's change to ADR-0012 ("no bucket, no network") is approved.
2. P0 test subject: the existing non-Steam shortcut **Jotunnslayer: Hordes of Hel** (Epic copy, also on Steam). No throwaway shortcuts needed.
3. ADR-0033 keeps the single ordered list of collections, but it stores **only non-Steam game info** (shortcut ids and their bucket); native Steam data is never persisted there. Implementers: reconcile this in P2 before writing `buckets.lua`.
