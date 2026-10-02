# Plan: Epic and Xbox copies in steam-cartridges

**Status:** Draft 2026-10-02, for an architecture agent to detail and an implementer agent to execute.
**Kind:** Umbrella feature plan, like [steam-cartridges-features-plan.md](steam-cartridges-features-plan.md). It fixes
*what* is built, the user's decisions, what game-data-linker gave us and what we drop, and *which modules in which layer*
each phase touches. It has no literal before/after blocks: each phase gets its own executable plan to
[the plan writing standard](README.md) once Phase 0 has answered its questions.
**Needs a new ADR before any code** (Phase 0, step 0.6): it amends
[ADR-0034](../decisions.md#adr-0034-achievement-sourcing-per-bucket-locked-only-for-unowned-steam-games) (unlocks come
only from Steam's caches), reverses "Epic/Xbox stay dropped" in
[ADR-0037](../decisions.md#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity),
and replaces invariant 1 of [service-achievements.md](../steam-cartridges/service-achievements.md#core-invariants) ("never
requires Epic Games OAuth … or Xbox Live credentials").

## 1. Goal

A shortcut that is an **Epic Games Store** or **Xbox (PC Game Pass / Microsoft Store)** copy of a game is found
automatically from files already on the PC, with nothing for the user to link. Its page then shows:

- **The Steam data, when the game is on Steam** (as today: metadata, artwork, community content, news, friends from the
  native app; ADR-0036 to ADR-0038).
- **The store's own data, when it is not** (Alan Wake 2 is Epic only): Game Info, artwork, community images.
- **The user's real unlocks from that store**, synced through its web API, in Steam's own achievement UI, Post-Game
  Summary and Activity feed. There is no toast from us: the store's own overlay already shows the unlock while the game
  runs.

## 2. Decisions already taken (user, 2026-10-02)

1. **Nothing manual.** No pasting store links into Properties (game-data-linker's way). A copy is found from the
   shortcut and the store's local install data.
2. **Steam stays first** for every game that is on both stores: metadata, artwork and community content are still
   mirrored from the native Steam app.
3. **A game that is not on Steam** takes its data from the store it was bought on, whichever store is easier to fetch
   from. Phase 0 checks what each store gives.
4. **Achievements are synced, not observed.** They are fetched from the store's API when the page opens and when the game
   quits. No unlock toast or sound from steam-cartridges or enhanced-notifications for these games: the store's own
   overlay notifies.
5. **Out of scope for now, kept as a future consideration** (§ 9): enhanced-notifications noticing a store's unlock as
   it happens, to save a screenshot or a recording.

## 3. What we keep from game-data-linker, and what we drop

game-data-linker (MIT, licence checked in ADR-0034) was read on 2026-10-02 (`backend/main.lua`, about 1,900 lines). We
take its **data paths only**, never its rendering.

| game-data-linker | Ours | Why |
| --- | --- | --- |
| The user pastes a Steam, Epic or Xbox store link in Properties | **Dropped.** Found from the shortcut (§ 4) | Decision 1 |
| Shows the linked game's data in place of the shortcut's, with no record of where it came from | **Dropped.** A copy keeps its own identity; Steam data only through the existing Steam match | ADR-0038 |
| Epic game info, artwork, achievement list from egdata.app (no sign-in) | **Kept as a candidate** for an Epic-only game, behind a source; Phase 0 compares it with Epic's own catalog | Decision 3 |
| Epic sign-in posing as the Epic Launcher's public client; token used only for friends | **Kept only if** it gives the user's own unlocks (step 0.3). Friends dropped | Decision 4; ADR-0037 |
| Xbox device-code sign-in (`microsoft.com/link`) through Microsoft's old public client, then Xbox Live tokens | **Kept**: the only way to read the user's Xbox unlocks | Decision 4 |
| Xbox achievements with unlocked state, Gamerscore, rarity | **Kept**, mapped to our schema and unlocks | Decision 4 |
| Xbox store data from Microsoft's public catalog (`displaycatalog.mp.microsoft.com`) | **Kept** for an Xbox-only game | Decision 3 |
| Friends who play (Epic, Xbox) | **Dropped** | ADR-0037: no persona scraping. Steam's own Friends section still shows for a Steam-matched copy |
| News from a Google News search; community from Reddit | **Dropped** | ADR-0037: no scraping. A Steam-matched copy gets the native app's news and community already |
| SteamGridDB logo for Xbox | **Already ours** (`web_sgdb.lua`, artwork service) | Nothing to port |
| Injected HTML copies of Steam's panels (play bar stat, sidebar, activity) | **Dropped.** We feed Steam's stores | ADR-0022, ADR-0045; plugins.md ladder |
| Tokens as plain JSON in the plugin's own folder | **Changed**: our data dir, never logged, listed where accounts are shown | plugins.md guardrail 18.7; § 7 |

## 4. Evidence so far (read-only, this machine, 2026-10-02)

- **Epic shortcuts may launch the game's .exe directly, not the launcher's link.** The one Epic shortcut here,
  Jotunnslayer (shortcut 2315502503, native 2820820), runs
  `"C:\Program Files\Epic Games\JotunnslayerHordesofrI2Zp\Jotunnslayer.exe"`. Detection must cover both shapes:
  `com.epicgames.launcher://apps/<AppName>…` in the target or launch options, and an exe inside an Epic install folder.
- **Epic's install manifests identify the copy exactly.**
  `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\B3F2847BEE2735B7C9CC107C02D98D58.item` (JSON) has
  `InstallLocation` = the shortcut's folder, `LaunchExecutable` = `Jotunnslayer.exe`, `CatalogNamespace` =
  `d8a39ea2f35e49b58f18c2b96aec276a` (the sandbox), `CatalogItemId` = `193ae706e4ef468aa030326aa0781efe`, `AppName`,
  `DisplayName`. The path must come from the registry or `ProgramData` discovery, never hardcoded (ADR-0011).
- **egdata.app answers without a sign-in.** `GET https://api.egdata.app/sandboxes/<CatalogNamespace>/achievements`
  returned Jotunnslayer's sets (names, descriptions, locked and unlocked icons, XP, hidden); `GET /items/<CatalogItemId>`
  returned title, description and key images. It is a community service, not Epic's.
- **Epic achievement ids equal the Steam API names for this game.** egdata's `ACH_A_TROPHY_SPECIAL` is in our stored
  Steam schema (`<steam>/millennium/config/steam-cartridges/achievements.json`, with `ACH_RIGOR_MORTIS`,
  `ACH_THE_MORIA` …). So for a Steam-matched Epic copy, Epic's unlocks can be laid over the Steam schema by id. One game
  is not a rule: step 0.4 checks more.
- **No Xbox game is installed here** (no `C:\XboxGames`, no Xbox shortcut). Everything about Xbox detection is unverified.
- **The Activity feed shows only captures today.** `surfaces/captures` writes `AppActivityStore.m_mapAppActivity`; unlocks
  reach the Post-Game Summary (`addSessionAchievement`) but no `AchievementUnlocked` event is ever added.
  `steam-components.md` (the store-record blocker) notes that this event renders from `event.achievements` alone once the
  store stub is in place, which it now is (ADR-0030).
- **The Epic per-user unlock API is unverified.** game-data-linker never reads Epic unlocks (its Epic list is always
  locked). Epic's store GraphQL has `PlayerAchievement` / `playerAchievementGameRecordsBySandbox` (fields `unlocked`,
  `unlockDate`, `achievementName`), per [woctezuma's gist](https://gist.github.com/woctezuma/8ca464a276b15d7dfad475fd6b6cbee9);
  Epic closed one leak in that API in January 2025. Not tried.

## 5. Phases

| # | Phase | Ships | Depends on |
| --- | --- | --- | --- |
| 0 | Research and the ADR (read-only, no code) | Answers below, the ADR, the executable plans | — |
| 1 | Store identity: find the Epic or Xbox copy behind a shortcut | Identity only, nothing visible yet | 0 |
| 2 | Achievements from Xbox and Epic | Real unlocks in Steam's UI | 1 |
| 3 | Activity: unlock events in the feed | `AchievementUnlocked` days, every source | 2 |
| 4 | Store data for a game not on Steam (Game Info, artwork) | Alan Wake 2 gets a full page | 1 |
| 5 | Community tab for a game not on Steam | Store screenshots as cards | 4 |

Phases 2-3 and 4-5 are independent of each other. Each phase is its own commit series, live verification and CHANGELOG
entry.

### Phase 0: research (live, read-only) and decisions

Every step is a read or a probe outside Steam. No deploy and no Steam lock needed, except 0.5.

- **0.1 Epic detection.** Find the manifest folder without hardcoding (the launcher's registry key or
  `%ProgramData%`). Confirm the match rule: the shortcut's exe (or its start dir) is inside a manifest's
  `InstallLocation`, or the target or launch options carry `com.epicgames.launcher://apps/<AppName>`. Check a DLC or
  add-on manifest (`MainGameCatalogNamespace` not empty) is never taken as the game.
- **0.2 Xbox detection** (needs an installed Xbox PC game, the user's machine or a test install). Read the shapes an Xbox
  shortcut takes: `shell:AppsFolder\<PackageFamilyName>!<AppId>`, `explorer.exe shell:AppsFolder\…`, an exe under
  `<drive>\XboxGames\<Game>\Content\`. Check `MicrosoftGame.config` in `Content\` for `<TitleId>` and `<StoreId>`
  (expected for GDK games, not verified), and the catalog lookup from a package family name to a product id when there
  is no config file.
- **0.3 Epic unlocks.** With a test account the user signs in to: does the store GraphQL (or any Epic endpoint the
  launcher's client may call) return the user's unlocks for a sandbox? If not, Epic achievements are **locked-only**,
  like an unowned Steam game (ADR-0034), and Epic sign-in is not built at all.
- **0.4 Epic ids against Steam ids.** For three or more games on both stores, compare egdata achievement `name`s with the
  Steam schema's ids. Decide the overlay rule: same ids → Steam schema plus Epic unlocks; any mismatch → that game uses
  the Epic schema (never a guess by display name).
- **0.5 Steam's activity event** (needs the Steam lock, read-only probe): build one `AchievementUnlocked` event for a
  shortcut through `CActivityDay.AddAchievementEvent` (or its constructor) in the live client and record the fields it
  needs. Write the trace into `steam-components.md` § Activity feed.
- **0.6 Store data for a store-only game.** For Alan Wake 2 (Epic) and one Xbox-only game: what Epic's own catalog gives
  without a sign-in compared with egdata.app, and what Microsoft's display catalog gives (title, description, developer,
  publisher, release date, key art, logo, screenshots, trailers and their format). Pick the source per store (decision 3).
- **0.7 Rate limits and terms.** Note each API's limits (Xbox Live throttles per user) and the risk of using the Epic
  Launcher's and Microsoft's public client ids in a published plugin. The user accepts or refuses that risk in the ADR.
- **0.8 Write the ADR** (amends 0034, reverses the Epic/Xbox line of 0037, replaces the invariant) with the answers to
  § 8, then one executable plan per phase.

### Phase 1: store identity

A copy is a fact about the shortcut, found locally and saved, like the Steam match. It does not replace the Steam match:
a copy can have both.

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | `Identity` gains `store?: { kind: "epic" \| "xbox"; id: string; namespace?: string; titleId?: string; source: "manifest" \| "launch" \| "config" }` (additive). |
| backend | `store_copies.lua` (new) | Pure readers: Epic manifests, the Epic launch link, Xbox `MicrosoftGame.config` and `shell:AppsFolder` targets. No network. |
| backend | `resolve_identity.lua` | A new step, gated by its own check, that adds `store` to the part. It runs for every route, does not end resolution, and never touches the Steam match steps (service-resolver.md "How to add a source"). An Xbox package with no config file may need one catalog lookup (0.2): that is the only network call, cached. |
| backend | `steam_store_emulators.lua` / `launches_emulator` | None. A store copy is never an emulator. |
| tests | `tests/test_store_copies.lua` (new), `tests/test_identity.lua` | Fixtures copied from a real manifest (ids only), each launch shape, a DLC manifest ignored, no network. |
| docs | `service-resolver.md` | The new step and the `store` field. |

No surface and no Steam write in this phase.

### Phase 2: achievements from Xbox and Epic

| Layer | Module | Change |
| --- | --- | --- |
| backend | `xbox_live.lua` (new) | Device-code sign-in, token refresh, the Xbox Live token chain, `achievements(titleId)` → schema and unlocks with `unlockedAt` (`progression.timeUnlocked`). Tokens in `<data dir>/accounts/xbox.json`; no token or code in a log line. |
| backend | `epic_store.lua` (new) | egdata.app (or Epic's catalog, 0.6) schema by sandbox; unlocks only if 0.3 says yes. |
| backend | `ach_service.lua` | Two `SOURCES` rows, `xbox` and `epic`, `supports` = `ctx.store.kind` (cheap, no request). For a copy that is also Steam-matched: the `steam` row keeps the schema, and the store's unlocks are laid over it by id when 0.4 allows; otherwise the store's own schema. |
| backend | `fresh_policy.lua` | A TTL for store unlocks (e.g. 15 min on page open; `force` at quit). Never polled while the game runs (ADR-0007). |
| backend | `achievements_reset.lua` | `xbox` and `epic` listed as not resettable, with the store's page as the "reset by hand" link (like RetroAchievements, ADR-0054). |
| app | `app/achievements.ts` | For a store copy: `ensure` on view and on `shortcut.quit`; **no Flow C polling** and no launch toast (decision 4). New unlocks found by a sync go into the record and the Post-Game Summary, but emit no toast event: a separate event (`achievements.synced`) or a flag on `achievements.unlocked` that the `toasts` surface ignores (the architect picks one, keeping the `toasts` surface unchanged if possible). |
| settings | `settings/panels/achievements.tsx` | An "Xbox account" block (sign in: shows the code and `microsoft.com/link`, polls; sign out), and an Epic one only if 0.3 says yes. Guardrail 18: `ButtonRow`, `CredentialsNote`, no diagnostics. |
| ports | `ports/backend.ts` | The sign-in RPCs. |
| tests | `tests/test_ach_service.lua`, `tests/app-achievements.test.ts` | Source selection, the overlay by id, a sync emits no toast, no Flow C for a store copy. |
| docs | `service-achievements.md`, `settings.md`, `rpc.md` | Rows for both sources; the invariant replaced. |

Steam targets: none new. The `achievements` surface already fills `AppDetailsStore`, `AchievementsFullStore` and the
progress cache from the record.

enhanced-notifications: unchanged. Its achievement banner only answers our `achievements.unlocked` toasts, which a sync
does not send.

### Phase 3: Activity feed

Unlocks with a time become Steam's own `AchievementUnlocked` events, bucketed by day next to the captures. This applies to
**every** source that stores `unlockedAt` (RetroAchievements, the emulator files, Xbox, Epic), not only to store copies.

| Layer | Module | Change |
| --- | --- | --- |
| domain | `domain/activity-achievements.ts` (new, pure) | Unlocks → per-day groups (local midnight), newest first; tests. |
| surfaces | `surfaces/captures/activity.ts` | Adds the achievement events for the record. The captures surface already owns `AppActivityStore.m_mapAppActivity`; one owner per Steam target, so no new surface. Its `touches` gains the event constructor from 0.5 if it is new. Idempotent (guardrail 17.2). |
| docs | `surfaces.md`, `steam-components.md` | The new event, the trace from 0.5. |

A Steam-matched copy already shows the native app's activity (ADR-0037: friends' unlocks of the Steam game). The user's
own store unlocks join it, marked as the shortcut's.

### Phase 4: store data for a game not on Steam

Only when the resolver finds **no** Steam match (decision 2).

| Layer | Module | Change |
| --- | --- | --- |
| backend | `metadata_service.lua` | A new tier after the Steam tier and **before IGDB** (the store is the game's own publisher data): `ctx.identity.store` present, no native match → the store source → persisted in `library_metadata.json` with `source = "epic"` or `"xbox"`. The order is a user decision (§ 8 question 3). |
| backend | `epic_store.lua`, `xbox_catalog.lua` (new) | `to_metadata` for each store: description, developers, publishers, release date; Xbox `Categories` / Epic tags to player badges only when exact. |
| backend | `art_service.lua` | Store key art as a source behind SteamGridDB for hero, capsule and logo where the store's image fits the slot (Epic `DieselStoreFrontWide`, `OfferImageTall`, `DieselGameBoxLogo`; Xbox `SuperHeroArt`, `Poster`). |
| domain | `domain/routing` | The store tier is a fetch gate like the web tier (guardrail 14: it never hides local data). |
| docs | `service-metadata.md`, `service-artwork.md` | The tier and the image mapping. |

### Phase 5: Community tab for a game not on Steam

A Steam-matched copy keeps Steam's own community content (ADR-0038, unchanged). For a store-only game:

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | `MediaItem.source` gains `"epic"` and `"xbox"`. |
| backend | `media_service.lua` | A store source: the store's screenshots as `screenshot` cards (public URLs, like IGDB's). Order with IGDB is § 8 question 4. |
| — | Videos | Steam's viewer plays YouTube ids (`MediaItem.youtube`). Store trailers are MP4 files, so they are **not** shown unless 0.6 finds a YouTube id or the viewer plays a direct URL (a separate probe). |
| docs | `service-media.md` | The source. |

## 6. Tests and live verification (all phases)

- Offline: `npm run check`, `npm test`, `NSGA_STEAM_ROOT=C:/game/steam lua tests/test_backend.lua`, the new Lua tests.
  The census rule applies: no hardcoded count of Epic manifests or Xbox games (plugins.md § 5).
- Live, after `dev.ps1`, under the Steam lock: `node steam-health.mjs --wait 120`, `npm run test:live`, Routines 1-3 on
  Jotunnslayer (Epic, Steam-matched) and on a store-only Epic game, and on an Xbox game when one is installed. Each
  phase's plan lists its exact PASS lines.
- By the user: sign in to Xbox from the settings panel (desktop and Big Picture), unlock an achievement in an Xbox game,
  quit, and see it in Steam's achievement panel, the Post-Game Summary and the Activity feed, with no toast from us.

## 7. Rules for every phase (the architect re-checks each)

- Guardrails 2 (hot paths O(1)), 5 (store stubs kept), 14 (a gate never hides what was shown), 15 (no check weakened),
  17 (no work from a render; idempotent writes), 18 (settings layout), 20 (`require` every module) of
  [plugins.md](../plugins.md).
- A source fails silently (ADR-0014): no store data, no account, a 429 → the page as today.
- Tokens: written only by the account module, never logged, never sent anywhere but the store's own hosts; removed by
  sign-out. Device codes are shown to the user, never logged.
- Respect the APIs (ADR-0007): cache, no polling while a game runs, a descriptive `User-Agent` where the API allows.

## 8. Questions for the user (answer before step 0.8)

1. **Epic sign-in.** If Epic gives the user's unlocks (0.3), its sign-in is, in game-data-linker's way, a code copied from a
   browser page (whether Epic offers a device-code flow to a client we may use is part of 0.3). Is that acceptable as the one manual step, or should Epic stay
   locked-only?
2. **Client-id risk** (0.7). Accept borrowing the Epic Launcher's and Microsoft's public client ids in a published plugin?
3. **Game Info order for a store-only game:** the store first, then IGDB, then ScreenScraper (proposed), or IGDB first?
4. **Community order for a store-only game:** IGDB (it has YouTube trailers) then the store's screenshots (proposed), or
   the store first?
5. **Activity for every source** (Phase 3): also show RetroAchievements and emulator unlocks in the feed (proposed), or
   only store copies?

## 9. Future considerations (not scheduled)

- **Recording a store unlock as it happens** (enhanced-notifications). Decision 4 means we learn about Xbox and Epic
  unlocks only after a sync, too late to capture the moment. Ideas to research later, each read-only and passive
  (service-achievements.md invariant 2: no injection into games):
  - Xbox: Game Bar's unlock toast may go through Windows' notification platform; a `UserNotificationListener` reader
    (the "Windows Notification Listen" channel in service-achievements.md § 1) could see it and ask Steam for a
    screenshot (`SteamClient.Screenshots` / the recording API) at once.
  - Epic: the overlay draws inside the game, not through Windows. A game's EOS log lines, if any, or a short sync loop
    while the game runs (only if the API's limits allow it, which ADR-0007 currently forbids).
  - Either way the capture goes into Steam's own screenshots for the shortcut, so the existing captures pipeline shows
    it. A toast stays off (decision 4).
- **GOG Galaxy** fits the same shape (identity from Galaxy's local database, unlocks from its `UserAchievements` table,
  no network). service-achievements.md § 1 already names the table.
