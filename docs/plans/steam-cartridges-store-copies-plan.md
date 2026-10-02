# Plan: Epic and Xbox games in steam-cartridges (third-party stores)

**Status:** Draft 2026-10-02, research round 1 done (§ 4). For an architecture agent to detail and an implementer agent
to execute.
**Kind:** Umbrella feature plan, like [steam-cartridges-features-plan.md](steam-cartridges-features-plan.md). It fixes
*what* is built, the user's decisions, what we can get from each store and how, and *which modules in which layer* each
phase touches. It has no literal before/after blocks: each phase gets its own executable plan to
[the plan writing standard](README.md) once its open research (§ 5, Phase 0) is answered.
**Needs a new ADR before any code** (step 0.9): it amends
[ADR-0034](../decisions.md#adr-0034-achievement-sourcing-per-bucket-locked-only-for-unowned-steam-games) (unlocks come
only from Steam's caches), reverses "Epic/Xbox stay dropped" in
[ADR-0037](../decisions.md#adr-0037-a-mapped-shortcut-borrows-its-native-apps-steam-sections-the-p5-gate-is-native-parity),
replaces invariant 1 of [service-achievements.md](../steam-cartridges/service-achievements.md#core-invariants) ("never
requires Epic Games OAuth … or Xbox Live credentials"), and records that the plugin may add shortcuts to the user's
library (Phase 1b), which nothing in the suite does today.

## 1. Goal

Epic Games Store and Xbox (PC Game Pass / Microsoft Store) games get the same treatment as IGDB and ScreenScraper
games: found and filled **automatically**, with nothing for the user to link by hand.

- A shortcut that is an Epic or Xbox copy is recognised from files already on the PC.
- Optionally, every installed Epic and Xbox game is added to the Steam library as a shortcut (a toggle).
- The page shows **the Steam data when the game is on Steam** (as today), and **the store's own data when it is not**
  (Alan Wake 2 is Epic only): Game Info, artwork, community images.
- The user's unlocks from that store are synced through its web API into Steam's own achievement UI, Post-Game Summary
  and Activity feed. No toast from us: the store's overlay already notifies while the game runs.

## 2. Decisions (user, 2026-10-02)

1. **Nothing manual.** No pasting store links into Properties (game-data-linker's way). A copy is found from the
   shortcut and the store's local install data.
2. **Steam stays first** for every game on both stores: metadata, artwork and community content are still mirrored from
   the native Steam app.
3. **A game not on Steam** takes its data from its store first, then IGDB, then ScreenScraper, for **Game Info** and for
   the **Community tab** alike.
4. **Achievements are synced, not observed.** Fetched from the store's API when the page opens and when the game quits.
   No unlock toast or sound from steam-cartridges or enhanced-notifications for these games.
5. **Activity feed from every source** that knows an unlock time (stores, RetroAchievements, emulator files).
6. **A "Third-party" settings section** with an **auto-sync toggle** that adds every installed Epic and Xbox game to the
   library as a shortcut.
7. **Epic and Xbox games are not listed** in enhanced-notifications' Reset Achievements dropdown: their unlocks live on
   the store's account and cannot be reset in any form (a reset here would be undone by the next sync).
8. **Credentials stay local and safe**, like the RetroAchievements and ScreenScraper accounts today: tokens in the data
   folder through `web_config` (`<data dir>/.env`, `config.save_credentials`), never logged, never sent anywhere but the
   store's own hosts. The public client ids are constants in the code, not user data.
9. **Research first.** Before any code, find out what each store gives and how, preferring automated, sign-in-free paths
   the way IGDB and ScreenScraper work (§ 4 is round 1; Phase 0 lists what is left).
10. **Out of scope for now** (§ 9): enhanced-notifications noticing a store's unlock as it happens, to save a screenshot
    or a recording.

## 3. What we keep from game-data-linker, and what we drop

game-data-linker (MIT, licence checked in ADR-0034), read 2026-10-02. We take **data paths only**, never its rendering.
Round 1 (§ 4) found better paths than its own for most of them.

| game-data-linker | Ours | Why |
| --- | --- | --- |
| The user pastes a store link in Properties | **Dropped.** Found from local install data (§ 4.1, § 4.4) | Decision 1 |
| Shows the linked game's data in place of the shortcut's | **Dropped.** A copy keeps its own identity | ADR-0038 |
| Epic data and achievement list from egdata.app | **Replaced** by Epic's own store GraphQL (§ 4.2). egdata.app only for trailer files | Epic's own API answers without a sign-in |
| Epic sign-in posing as the Launcher's client; used only for friends | **Pending** step 0.1: needed only if unlocks require it | Decision 4 |
| Xbox device-code sign-in, Xbox Live tokens | **Kept**: the only way to read Xbox unlocks | Decision 4 |
| Xbox achievements with unlocked state | **Kept** | Decision 4 |
| Xbox store data from Microsoft's display catalog | **Kept**, plus lookup by package family name (§ 4.5) | Decision 3 |
| Friends who play; Google News; Reddit | **Dropped** | ADR-0037 |
| SteamGridDB logo for Xbox | **Already ours** (`web_sgdb.lua`) | — |
| Injected HTML copies of Steam's panels | **Dropped.** We feed Steam's stores | ADR-0022, ADR-0045 |
| Tokens as plain JSON in the plugin's folder | **Changed**: `web_config`, data folder | Decision 8 |

## 4. Research round 1: what each store gives, and how (2026-10-02)

Read-only, from this machine. Every network call was one anonymous GET or GraphQL query with a descriptive
`User-Agent`. The user's Epic account id was used once, read-only, and is not written here.

### 4.1 Epic, on disk (no network)

| File | What it gives |
| --- | --- |
| `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON, one per installed game) | `InstallLocation`, `LaunchExecutable`, `DisplayName`, `CatalogNamespace` (= the achievement sandbox), `CatalogItemId`, `AppName`; `MainGame*` set for an add-on |
| `%ProgramData%\Epic\UnrealEngineLauncher\LauncherInstalled.dat` (JSON) | The installed list: `InstallLocation`, `NamespaceId`, `ItemId`, `ArtifactId` (= `AppName`), `AppVersion` |
| `%ProgramData%\Epic\EpicGamesLauncher\Data\Catalog\catcache.bin` (base64 of a JSON array) | Catalog items for installed or recently used namespaces only (97 items, 4 namespaces here): `title`, `description`, `developer`, `keyImages` (`DieselGameBox` 2560x1440, `DieselGameBoxTall` 1200x1600), `releaseInfo`, `categories`. Offline Game Info for an installed game |
| `%LOCALAPPDATA%\EpicGamesLauncher\Saved\Data\<32 hex>.dat` | The file name is the signed-in Epic account id (its profile resolved through GraphQL). The file content was not read |

Shortcut shapes: the one Epic shortcut here (Jotunnslayer, 2315502503) runs
`"C:\Program Files\Epic Games\JotunnslayerHordesofrI2Zp\Jotunnslayer.exe"` directly; the launcher's own shortcuts use
`com.epicgames.launcher://apps/<AppName>?action=launch&silent=true`. Both must match (exe inside an `InstallLocation`,
or the `AppName` in the link).

### 4.2 Epic, store GraphQL without a sign-in (`POST https://store.epicgames.com/graphql`)

Answers anonymously (200). Introspection is off; field names were found by trial. `launcher.store.epicgames.com`
redirects to a captcha; `graphql.epicgames.com` is gone (404).

| Query | Gives |
| --- | --- |
| `Achievement.productAchievementsRecordBySandbox(sandboxId, locale)` | `productId`, `totalAchievements` (38), `totalProductXP`, sets, and per achievement `name` (the API name), `hidden`, `unlockedDisplayName`, `unlockedDescription`, `unlockedIconLink`, `lockedIconLink`, `XP`, `rarity.percent` |
| `Catalog.catalogOffers(namespace, locale, params)` | Every offer of a namespace with `offerType` (`BASE_GAME`, `EDITION`, `ADD_ON`): the way from an installed game to its store offer |
| `Catalog.catalogOffer(namespace, id, locale)` | `title`, `developerDisplayName`, `publisherDisplayName`, `releaseDate`, `pcReleaseDate`, `tags { name groupName }` (genres, features such as `Single Player`), `keyImages` (`DieselStoreFrontWide`, `OfferImageTall`, `Thumbnail`, 9 `featuredMedia` screenshots, 4 `heroCarouselVideo` as `com.epicgames.video://<uuid>?cover=…`) |
| `Catalog.catalogItem(namespace, id)` | `title`, `description`, `developer`, `keyImages` |
| `Catalog.searchStore(keywords, category, …)` | Title search (Alan Wake 2 → its offer); only for a game with no manifest |
| `PlayerProfile.playerProfile(epicAccountId)` | The profile resolves; `privacy` is null anonymously |
| `PlayerProfile.playerProfile.achievementsSummaries` / `productAchievements(productId)` | `ServiceError` with `status 403` ("Request failed with status code 403") for this account, anonymously |
| `PlayerAchievement.playerAchievementGameRecordsBySandbox(epicAccountId, sandboxId)` | `records: null` anonymously |

**Achievement ids match Steam's for Jotunnslayer**: Epic's `ACH_A_TROPHY_SPECIAL` is in our stored Steam schema for
native 2820820. One game is not a rule (step 0.4).

### 4.3 Epic, egdata.app (community service, no sign-in)

`/sandboxes/<ns>/achievements`, `/items/<id>`, `/offers/<id>`, `/offers/<id>/media`, `/autocomplete?query=`. Same data as
§ 4.2, plus one thing Epic's GraphQL does not give: `/offers/<id>/media` `videos[].outputs[]` resolves trailers to
files (`media-cdn.epicgames.com/…-high.webm`, 1920x1080, `video/webm`). Use it only for that, and only if Steam's viewer
can play a direct file (step 0.6).

### 4.4 Xbox, on disk (no network)

| File | What it gives |
| --- | --- |
| `<drive>:\.GamingRoot` | Where the Xbox app installs games: `RGBX`, a uint32 count, then NUL-terminated UTF-16 folder paths relative to the drive root. Here: `C:\` → `game\gamepass` (empty) |
| `<install folder>\<Game>\Content\MicrosoftGame.config` | Expected for GDK games: `<TitleId>`, `<StoreId>`, `<Identity Name=…>`, executables. **Not verified**: no Xbox game is installed here |
| `Get-AppxPackage` (or the registry) | Installed packages with `PackageFamilyName` and `InstallLocation`; 0 GDK game packages here |

The Xbox app and Gaming Services are installed. Shortcut shapes to check on a real install (step 0.2):
`shell:AppsFolder\<PackageFamilyName>!<AppId>`, `explorer.exe shell:AppsFolder\…`, an exe under the GamingRoot folder.

### 4.5 Xbox, Microsoft's display catalog without a sign-in (`https://displaycatalog.mp.microsoft.com/v7.0/`)

| Call | Gives |
| --- | --- |
| `products/lookup?alternateId=PackageFamilyName&value=<PFN>&market=US&languages=en-US,neutral&fieldsTemplate=details` | The product id (`Microsoft.SeaofThieves_8wekyb3d8bbwe` → `9P2N57MC619K`): from an installed package to its store entry |
| `products/lookup?alternateId=XboxTitleId&value=<id>…` | 200; from `MicrosoftGame.config`'s `TitleId` to the product |
| `products?bigIds=<id>…` | `ProductTitle`, `DeveloperName`, `PublisherName`, `OriginalReleaseDate`, `AlternateIds` (`XboxTitleId` 1717113201), images by purpose (7 `Screenshot`, `SuperHeroArt`, `TitledHeroArt`, `Poster`, `BoxArt`, `Logo`, `BrandedKeyArt`), `Properties.Category`, `Properties.Attributes` (`SinglePlayer`, `XblOnlineCoop`, `XblOnlineMultiPlayer`, `XblCrossPlatformCoop`, `XblAchievements`, `ConsoleKeyboardMouse` …, which map to Steam categories), `CMSVideos` (trailers as HLS and DASH streams with a caption and size), packages with their `PackageFamilyName` |

### 4.6 Signed-in APIs (from public sources and game-data-linker's code; not tested here)

| Store | Call | Gives |
| --- | --- | --- |
| Xbox | `achievements.xboxlive.com/users/xuid(<xuid>)/achievements?titleId=<id>` (contract 2) | Each achievement with `progressState`, `progression.timeUnlocked`, Gamerscore, rarity, icon. game-data-linker uses it |
| Xbox | `titlehub.xboxlive.com/users/xuid(<xuid>)/titles/titlehistory/decoration/achievement,image,detail` | Every played title with unlocked and total counts and last played time, in one call: lets a sync skip unchanged games |
| Xbox | `userstats.xboxlive.com` `MinutesPlayed` | Playtime per title (a possible later feature) |
| Xbox | Sign-in: device code at `login.live.com/oauth20_connect.srf` (client `00000000402b5328`, scope `service::user.auth.xboxlive.com::MBI_SSL`), then `user.auth.xboxlive.com` and `xsts.auth.xboxlive.com` | A user code shown in our settings, typed at microsoft.com/link: no password ever passes through the plugin |
| Epic | The same GraphQL queries with the user's bearer token | Unknown: whether that turns the 403 / `records: null` above into unlocks (step 0.1) |
| Epic | `library-service.live.use1a.on.epicgames.com/library/api/public/items`, `…/playtime/account/<id>/all` | Owned games and playtime (Legendary / Heroic use them) |

## 5. Phases

| # | Phase | Ships | Depends on |
| --- | --- | --- | --- |
| 0 | Research round 2 and the ADR (read-only, no code) | Answers, the ADR, executable plans | — |
| 1a | Store identity: recognise an Epic or Xbox shortcut | Identity only | 0 |
| 1b | Third-party section: auto-add installed games | Shortcuts in the library | 1a |
| 2 | Achievements: Xbox, then Epic | Synced unlocks in Steam's UI | 1a |
| 3 | Activity feed from every source | `AchievementUnlocked` days | 2 for stores; the other sources can go first |
| 4 | Store data for a game not on Steam | Game Info, artwork | 1a |
| 5 | Community tab for a game not on Steam | Store screenshots (and trailers if 0.6 allows) | 4 |

Each phase is its own commit series, live verification and CHANGELOG entry.

### Phase 0: research round 2 and the ADR

Everything here is read-only. 0.1 needs the user; 0.2 needs an installed Xbox game; 0.5-0.7 need the Steam lock.

- **0.1 Epic unlocks** (the user's question 1). Two paths, the cheapest first:
  1. **Public profile, no sign-in.** The user sets their Epic profile's achievements to public (Epic account → privacy)
     and we re-run the § 4.2 profile and player queries with the account id from § 4.1. If they answer, Epic unlocks need
     **no credentials at all**, only the id already on disk.
  2. **Signed in.** If the profile must stay private, the same queries with a bearer token. Find a sign-in flow without
     copying codes by hand (a device-code flow for a client we may use). Reading the Epic launcher's own saved session
     is **not** allowed: it is the launcher's secret, not ours. If neither works, Epic stays **locked-only** (list with
     rarity, no unlocks, like an unowned Steam game in ADR-0034) and no Epic sign-in is built.
- **0.2 Xbox on a real install**: the shortcut shapes, `MicrosoftGame.config` fields, PFN → product → title id, and the
  user's own sign-in and achievements call (with the user, device code).
- **0.3 Epic edge cases**: an add-on manifest (`MainGameCatalogNamespace` set) is never taken as a game; a game with
  several `BASE_GAME` offers; a launcher-link shortcut with no manifest (uninstalled).
- **0.4 Epic ids against Steam ids** for three or more games on both stores. Rule: all ids equal → the Steam schema plus
  the store's unlocks; any mismatch → the store's own schema for that game (never a match by display name).
- **0.5 Steam's activity event** (Steam lock, read-only probe): build one `AchievementUnlocked` event for a shortcut
  (`CActivityDay.AddAchievementEvent` or its constructor) and record the fields it needs; trace into
  `steam-components.md` § Activity feed.
- **0.6 Trailers in Steam's community viewer**: does it play a direct `.webm` or an HLS stream, or only YouTube ids
  (`MediaItem.youtube`)? If only YouTube, store trailers are left out.
- **0.7 `SteamClient.Apps.AddShortcut(appName, exe, dir, launchOptions)`** (in the SDK typings,
  `@steambrew/client` `App.d.ts`; also `RemoveShortcut`, `SetShortcutName`, `SetShortcutLaunchOptions`,
  `SetShortcutStartDir`, `SetShortcutIcon`): what it returns (the new appid?), whether `shortcuts.vdf` is written at once,
  and whether the new appid is stable across restarts. On a throwaway test shortcut, removed afterwards, with the user's
  go-ahead (it changes the library).
- **0.8 Limits and terms**: each API's rate limits (Xbox Live throttles per user), egdata.app's terms, the risk of the
  borrowed public client ids in a published plugin (decision 8 covers storage, not that risk; the ADR records it).
- **0.9 The ADR**, then one executable plan per phase.

### Phase 1a: store identity

A copy is a fact about the shortcut, found locally and saved, like the Steam match. A copy can have both.

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | `Identity` gains `store?: { kind: "epic" \| "xbox"; namespace?: string; itemId?: string; offerId?: string; appName?: string; productId?: string; titleId?: string; pfn?: string; source: "manifest" \| "launch-link" \| "config" \| "package" }` (additive). |
| backend | `store_epic_local.lua`, `store_xbox_local.lua` (new) | Pure readers of § 4.1 and § 4.4 (manifests, `LauncherInstalled.dat`, `catcache.bin`, `.GamingRoot`, `MicrosoftGame.config`); paths discovered, never hardcoded (ADR-0011). No network. |
| backend | `resolve_identity.lua` | A new step, gated by its own check, that adds `store`. It runs for every route, never ends resolution and never touches the Steam steps (service-resolver.md "How to add a source"). The only network calls: Epic `catalogOffers` (offer id) and Xbox PFN lookup (product and title id), cached with the identity. |
| tests | `tests/test_store_local.lua` (new), `tests/test_identity.lua` | Fixtures of each file shape (ids only), each shortcut shape, an add-on ignored. A census for the live install (plugins.md § 5): count manifests with a naive scan, never hardcode. |
| docs | `service-resolver.md`, `knowledgebase.md` (file formats of § 4.1 and § 4.4) | — |

### Phase 1b: Third-party section and auto-add

| Layer | Module | Change |
| --- | --- | --- |
| settings | `settings/panels/third-party.tsx` (new) | Section "Third-party": per store a block with what was found ("4 Epic games installed, 3 in your library"), the **Auto-add installed games** toggle, and the account (Xbox sign-in with the device code; Epic only if 0.1 needs it). Guardrail 18 layout, `CredentialsNote`. |
| backend | `store_installed.lua` (new) | The installed list per store (reuses Phase 1a's readers) and which are already shortcuts (by exe, install folder or launch link). |
| app | `app/store-sync.ts` (new) | With the toggle on, at start-up and when the section opens: add a shortcut for each installed game that has none. Launch through the store's own link (`com.epicgames.launcher://apps/<AppName>?action=launch&silent=true`; `shell:AppsFolder\<PFN>!<AppId>`) so the launcher handles updates and its overlay runs. Remembers what it added. |
| surfaces | `surfaces/library-shortcuts/` (new) | The only writer of `SteamClient.Apps.AddShortcut` / `SetShortcut*` (a new Steam target, its own kill switch and `touches`). |

Open, for the ADR: whether a game uninstalled from the store loses its shortcut (proposed: never remove automatically;
the section lists it), the default collection for added games (proposed: one per store, e.g. "Epic Games", so ADR-0036's
routing applies), and that the toggle is off by default.

### Phase 2: achievements (Xbox first, then Epic)

| Layer | Module | Change |
| --- | --- | --- |
| backend | `xbox_live.lua` (new) | Device-code sign-in, refresh, the token chain (§ 4.6), `achievements(titleId)` → schema and unlocks with `unlockedAt`; `titlehub` to skip unchanged games. Tokens through `web_config` (decision 8). |
| backend | `epic_store.lua` (new) | The schema from `productAchievementsRecordBySandbox`; unlocks by the path 0.1 found, or none (locked-only). |
| backend | `ach_service.lua` | `xbox` and `epic` rows in `SOURCES`, `supports` = `ctx.store.kind` (no request). A Steam-matched copy: the `steam` schema plus the store's unlocks when 0.4 allows, else the store's schema. |
| backend | `fresh_policy.lua` | A TTL for store unlocks (e.g. 15 min on page open; `force` at quit). Never polled while the game runs (ADR-0007). |
| backend | `achievements_reset.lua` | No source row for `xbox` / `epic`, and the shortcut is reported as **not resettable** (decision 7). |
| app | `app/achievements.ts` | Store copy: `ensure` on view and on `shortcut.quit`; no Flow C polling, no launch toast. New unlocks from a sync go into the record and the Post-Game Summary but never into a toast (a separate `achievements.synced` event, or a flag the `toasts` surface ignores; the architect picks, keeping `toasts` unchanged if possible). |
| ports | `ports/backend.ts` | The sign-in RPCs. |
| tests | `tests/test_ach_service.lua`, `tests/app-achievements.test.ts` | Source selection, the overlay by id, a sync never toasts, no Flow C for a store copy, not resettable. |
| docs | `service-achievements.md`, `settings.md`, `rpc.md` | The invariant replaced. |

**enhanced-notifications** (decision 7): its Reset Achievements dropdown leaves out a game that steam-cartridges reports
as a store copy. steam-cartridges exposes that through its public API (for example `achievementResetSources` answering
`{ resettable: false }`), and enhanced-notifications filters on it. That is a change in both plugins: the shared field
is decided in the ADR, and each plugin's architecture doc is updated.

### Phase 3: Activity feed from every source (decision 5)

| Layer | Module | Change |
| --- | --- | --- |
| domain | `domain/activity-achievements.ts` (new, pure) | Unlocks with a time → per-day groups (local midnight), newest first; tests. |
| surfaces | `surfaces/captures/activity.ts` | Adds the achievement events. The captures surface already owns `AppActivityStore.m_mapAppActivity` (one owner per target, no new surface); `touches` gains the event constructor from 0.5 if new. Idempotent (guardrail 17.2). |
| docs | `surfaces.md`, `steam-components.md` | — |

### Phase 4: store data for a game not on Steam (decisions 2 and 3)

Only when the resolver finds **no** Steam match.

| Layer | Module | Change |
| --- | --- | --- |
| backend | `metadata_service.lua` | A store tier after the Steam tier and **before IGDB**: `identity.store` and no native match → the store → persisted in `library_metadata.json` with `source = "epic"` / `"xbox"`; then IGDB, then ScreenScraper, as today. Epic: `catcache.bin` first when it has the namespace (offline), else `catalogOffer`. |
| backend | `epic_store.lua`, `xbox_catalog.lua` | `to_metadata`: description, developers, publishers, release date; player badges only from exact features (Epic tag `Single Player`; Xbox `SinglePlayer`, `XblOnlineCoop`, `XblOnlineMultiPlayer` …), never guessed. |
| backend | `art_service.lua` | Store art behind SteamGridDB where it fits the slot (Epic `DieselStoreFrontWide` / `DieselGameBox` hero, `OfferImageTall` / `DieselGameBoxTall` capsule; Xbox `SuperHeroArt`, `Poster`, `Logo` only as a last resort). |
| domain | `domain/routing` | The store tier is a fetch gate like the web tier (guardrail 14). |

### Phase 5: Community tab for a game not on Steam (decisions 2 and 3)

A Steam-matched copy keeps Steam's own community content (ADR-0038). For a store-only game: the store first, then IGDB,
then ScreenScraper.

| Layer | Module | Change |
| --- | --- | --- |
| kernel | `kernel/record.ts` | `MediaItem.source` gains `"epic"` and `"xbox"`. |
| backend | `media_service.lua` | A store source ahead of IGDB: Epic `featuredMedia`, Xbox `Screenshot` images as `screenshot` cards (public URLs). Trailers only if 0.6 says the viewer plays them (Epic `.webm` through egdata.app, Xbox HLS). |
| domain | `domain/community-media.ts` | The card order: store, IGDB, ScreenScraper. |

## 6. Tests and live verification (all phases)

- Offline: `npm run check`, `npm test`, `NSGA_STEAM_ROOT=C:/game/steam lua tests/test_backend.lua`, the new Lua tests;
  census, not hardcoded counts.
- Live, after `dev.ps1`, under the Steam lock: `node steam-health.mjs --wait 120`, `npm run test:live`, Routines 1-3 on
  Jotunnslayer (Epic, Steam-matched), a store-only Epic game, and an Xbox game when one is installed.
- By the user: the Third-party section (desktop and Big Picture), Xbox sign-in, an unlock in an Xbox game, quit, and
  the unlock in Steam's achievement panel, Post-Game Summary and Activity, with no toast from us; Reset Achievements does
  not list the game.

## 7. Rules for every phase

- plugins.md guardrails 2, 5, 14, 15, 17, 18, 20.
- A source fails silently (ADR-0014): no store data, no account, a 403 or 429 → the page as today.
- Credentials (decision 8): only `web_config` reads or writes them; never in a log line, a diagnostic or the record;
  sent only to the store's own hosts; removed on sign-out. A device code is shown, never logged.
- Respect the APIs (ADR-0007): cache, no polling while a game runs, a descriptive `User-Agent`.

## 8. Questions left for the user

1. **Epic profile privacy** (0.1): would you set your Epic profile's achievements to public for the test? If that works,
   Epic needs no sign-in at all.
2. **Auto-add** (Phase 1b): off by default; never remove a shortcut automatically; one collection per store. Agree?
3. **Xbox test game** (0.2): can you install one small Xbox PC game (Game Pass) for the detection and sign-in tests?

## 9. Future considerations (not scheduled)

- **Recording a store unlock as it happens** (enhanced-notifications). A sync learns of an unlock too late to capture the
  moment. To research later, passive only (no injection into games):
  - Xbox: Game Bar's unlock toast may go through Windows' notification platform; a `UserNotificationListener` reader
    could see it and ask Steam for a screenshot at once.
  - Epic: its overlay draws inside the game, not through Windows; a game's EOS log lines, if any, or a short sync loop
    while it runs (only if the API's limits allow; ADR-0007 forbids it today).
  - The capture goes into Steam's own screenshots for the shortcut, so the captures pipeline shows it. No toast.
- **Playtime** from Xbox `userstats` and Epic's library service.
- **GOG Galaxy** fits the same shape (identity and unlocks from Galaxy's local database, no network).
