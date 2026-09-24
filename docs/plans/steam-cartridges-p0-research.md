# steam-cartridges P0: research closure

> Spec for the implementer. **No plugin code in this phase.** Output is facts
> recorded in the docs named below, probe scripts under `scratch/cartridges/`,
> and ADR-0034 flipped to Accepted. P1–P3 plans have **P0-gated** notes; this
> phase resolves each one.
>
> Parent plan: [docs/steam-cartridges.md](../steam-cartridges.md) (§ 9 decisions
> are final). ADRs 0032–0034 are already written in
> [decisions.md](../decisions.md#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges).

---

## 0. Already settled while writing this plan (do not re-check)

| Fact | Evidence |
| --- | --- |
| No RPC name collides between the two plugins. Core: `GetLibraryStats`, `GetDiagnostics`. Artwork: `GetStatus`, `GetGameMetadata`, `RefreshGameMetadata`, `GetAllMetadata`, `SaveGameMetadata`, `GetArtworkForGame` | `non-steam-games-activity/backend/main.lua`, `steamgriddb-artwork/backend/main.lua` |
| Byte-identical: `backend/_lib/*` (7 files), `steam_paths.lua`, `frontend/steam/jsx-hook.ts`. `gamepad-appid.ts` differs only in formatting and its jsx `label` | `diff` |
| `shortcuts.lua` diverged: the artwork copy also collects numeric-key strings into `entry.tags` (lines 100–102), which `igdb.lua` `detect_platform_hints` reads | `diff` |
| `steamgriddb-artwork/frontend/steam/artwork.ts` (`applyCustomArtworkFromUrls`, `applyCustomArtwork`, `fetchImageAsBase64`) is **dead code**: nothing imports it. The artwork plugin applies no artwork today | `grep` |
| Artwork secrets: `config.lua` reads `sgdb_key.txt` and `.env` **relative to the Lua cwd**, plus a hardcoded `c:/game/millennium/.env` (breaks ADR-0011). Twitch creds come only from `.env`. On this machine only `C:\game\millennium\.env` exists | `config.lua` `get_env_map` |
| `metadata_db.lua` stores `<steam>/library_metadata.json` (24 KB here) | `get_db_path` |
| `dev.ps1` deletes the deployed plugin folder on every deploy, so the linker's "mappings.json next to the backend" would be wiped | `dev.ps1` `Remove-Item $target` |
| Licenses: `game-data-linker` MIT, `PlayniteAchievements` MIT, `Playnite-LocalAchievements-Plugin` GPLv3 | `research/*/LICENSE` |
| This machine has 219 shortcuts, almost all RetroArch, plus AM2R, Cemu and Dolphin. **No shortcut is a copy of a Steam game**, so P3 needs a test shortcut (T6) | `shortcuts.vdf` |
| The linker's `steam_search_appid` also accepts `<title> + edition words`. The plan allows exact normalised matches only, so edition matches must become suggestions (P3) | `research/game-data-linker/backend/main.lua:1751` |

---

## 1. Method

Follow [steam-debug.md § 3](../steam-debug.md#3-the-inspection-method) and
**§ 7 (cheapest method first)**. Start Steam with `.\start-steam-dev.ps1`.
Every probe is a `Runtime.evaluate` in `SharedJSContext` with
`returnByValue: true` and capped output. Reuse the connect helper pattern from
`enhanced-achievements/tests/cdp.mjs`. Save each probe as
`scratch/cartridges/p0-<trace>.mjs` so later phases can re-run it. Never commit
a numeric module id as a signature. Compare a native app with a shortcut every
time (`435150` native, `4263274102` AM2R, `2788628389` ActRaiser).

**Mutations** (creating a shortcut or collection, setting artwork) need the
user's OK first. Use only the throwaway objects from T6, and remove them at the
end.

---

## 2. Traces

### T1: Collections (gates P2)

Questions:

1. How are user collections enumerated? Expected: `window.collectionStore.userCollections`.
   Record the exact accessor, and whether `collectionStore` is a class instance
   (it is for `OnAppOverviewChange`, ADR-0018).
2. Per collection: stable **id** field (e.g. `id`/`m_strId`), display name,
   dynamic vs static flag, and the membership accessor (`apps: Map`?
   `allApps: AppOverview[]`?). Can `apps.has(appid)` be checked in O(1)?
3. Do **shortcuts** appear in membership, for both static and dynamic collections?
   Test with a collection that contains AM2R.
4. Is membership ready at plugin load, or only after a store init? What should
   code wait on (a `waitFor` predicate)?
5. Change signal: which observable or method changes when a game is added or
   removed (MobX observable on the collection? a `Save`/`AddApps` method)? P2 does
   not need an observer (ADR-0033). Record it anyway for the settings panel.
6. Are shortcut `tags` in `shortcuts.vdf` still written by Steam, or are
   collections only in cloud storage (`userdata/<id>/config/cloudstorage/`)? This
   decides whether the backend `tags` field is trustworthy (answer: trust
   `collectionStore` only).

Record: new section **"Collections (`collectionStore`)"** in
[steam-components.md](../steam-components.md). Add a stable-signature row in
[steam-architecture.md § 3](../steam-architecture.md#3-stable-resolution-signatures).
Add the `tags` finding to [knowledgebase.md](../knowledgebase.md) under the
shortcuts file format.

### T2: Custom artwork from Steam's CDN (gates P3)

1. From `SharedJSContext`, does `fetch()` of
   `https://cdn.akamai.steamstatic.com/steam/apps/435150/library_hero.jpg` (and
   `library_600x900.jpg`, `logo.png`, `header.jpg`) succeed (CORS), and how many
   bytes come back?
2. Are unhashed CDN paths still valid for **new** apps, or do some need the
   hashed asset path? Find how the client itself builds hero/logo URLs for a native
   `AppOverview` (search factory source for `library_hero`), and whether
   `StoreItemCache` / `GetAssets()` exposes asset URLs for an app the user does not
   own. The source that works is P3's URL source.
3. On the T6 throwaway shortcut only: `SteamClient.Apps.SetCustomArtworkForApp(appid, b64, 'jpg', 1)`
   with the largest hero found. Does it succeed at ~3–5 MB base64? Does a file
   appear in `userdata/<id>/config/grid/`? Does
   `ClearCustomArtworkForApp(appid, 1)` remove it? The method must be called
   on `SteamClient.Apps` (extracting it breaks the IPC proxy, per the linker's
   note).
4. If the frontend fetch fails: can the backend download it (`http.get`) and
   return base64 (`utils.base64_encode`, as `sgdb.download_image_base64` does)
   over RPC? What is the largest RPC string that works?
5. Can code tell whether a shortcut **already has user-set custom artwork** in a
   slot (e.g. an `AppOverview` field, or a `SteamClient.Apps` getter)? If it can,
   P3 skips those slots instead of overwriting the user's own art.

Record: extend **"Custom artwork API"** in steam-components.md (limits,
extension format `jpg`/`png` without dot, persistence, clear).

### T3: Native-app knowledge without network (gates P3 resolver step 2)

1. What does `appStore.allApps` contain: owned only, or also family-shared and
   known-but-unowned? Record the count here and the fields usable for matching
   (`display_name`, `sort_as`, `app_type`).
2. Can `StoreItemCache` (Steam's own CM transport) load an **unowned** app by
   appid, returning name, short description, developers, publishers, release date,
   categories and assets? If yes, that is Steam's own data with no scraping.
   ADR-0009's ladder prefers it over `store.steampowered.com/api/appdetails`.
   Record the request method and the fields.
3. Is there any client-side title → appid search (no network beyond the CM)?
   Expected: no. If none, `storesearch` stays the step-3 source.

Record: steam-components.md, new subsection "Store item data for arbitrary apps"
next to "Game Info tab & metadata".

### T4: Achievement schema without an API key (gates ADR-0034, P5)

For an owned native app (`435150`) and an **unowned** one (T6 pick):

1. `appAchievementProgressCache.m_achievementProgress.mapCache.get(appid)`:
   present for unowned? (Expected: owned only.)
2. `appDetailsStore.GetAchievements(appid)` after `RequestAppDetails(appid)`: shape
   for owned vs unowned.
3. Any `SteamClient.Apps.*Achievement*` method that returns a schema (list all by name).
4. Keyless web: `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2?gameid=`
   and store `appdetails` `achievements.{total,highlighted}`. Is a keyless source
   of display names and icons available at all?

Record: [knowledgebase.md](../knowledgebase.md), new section "Steam achievement
schema sources". Then set ADR-0034 **Status: Accepted** and name the chosen source
in its Decision (edit only the status line and that one bullet; anything more
needs a new ADR).

### T5: Backend runtime facts (gates P1)

1. Does `require("web.igdb")` resolve `backend/web/igdb.lua` under Millennium's
   Lua `package.path`? Test with a two-line probe module in a throwaway
   `-dev` deploy, or read `package.path` via a temporary log line. **P1 uses
   `backend/web/` and `backend/steam_store/` only if this is ✅, otherwise flat
   files.**
2. The Lua process cwd (`io.popen('cd')` or `os.getenv('CD')`). This decides
   which legacy `.env` candidates the migration must scan.
3. Does `MILLENNIUM_PLUGIN_SECRET_BACKEND_ABSOLUTE` exist (the linker relies on it)?
   Informational only: ADR-0032 puts data in `<steam>/millennium/config/steam-cartridges/`.
4. Do Lua `millennium.config.get/set` work on v3.4.1, or does #903 affect them too?

Record: [knowledgebase.md § Part 1](../knowledgebase.md) (backend facts).

### T6: Fixtures for P2/P3 (user action)

Ask the user to create, or approve creating via `SteamClient.Apps.AddShortcut`:

- Collection **`SC Test Steam`**: a throwaway shortcut named exactly after an
  **owned** native game (e.g. "Divinity: Original Sin 2 - Definitive Edition",
  exe `C:\Windows\System32\notepad.exe`), plus one named after an **unowned**
  Steam game (pick from `storesearch`).
- Collection **`SC Test Retro`**: ActRaiser (`2788628389`) and one more RetroArch game.
- AM2R stays in no test collection (the `none` case). Put one RetroArch game in
  **both** test collections (the conflict case).

Record the appids in a `FIXTURE` block at the top of this plan (§ 4) and in
P2/P3 tests. Removal steps go in the same block.

---

## 3. Exit criteria

- [ ] T1–T5 each answered ✅/❌ with evidence, in the named doc sections; probes in `scratch/cartridges/`.
- [ ] Every **P0-gated** note in the P1, P2 and P3 plans is replaced by the finding (edit the plans).
- [ ] ADR-0034 is Accepted, with the source named.
- [ ] Fixtures from T6 exist and are listed in § 4.
- [ ] No plugin code changed; the client is left as found (artwork cleared,
      probes unpatched, `-dev` probe deploy removed).
- [ ] CHANGELOG line; TASK.md P0 box ticked.

**Risks.** Probing mutates the live client: use only the T6 throwaway objects.
Do not `location.reload()` SharedJSContext (plugins.md § 4). If Big Picture state
looks wrong, clean restart (steam-debug Trap 6). **Rollback:** docs only; revert
the commit.

---

## 4. Fixture block (fill in during T6)

```
SC_STEAM_OWNED   = <appid>   # shortcut named after owned native <native appid>
SC_STEAM_UNOWNED = <appid>   # shortcut named after unowned native <native appid>
SC_RETRO_A       = 2788628389  # ActRaiser
SC_RETRO_BOTH    = <appid>   # in both collections (conflict case)
SC_NONE          = 4263274102  # AM2R, no bucket
COLLECTION_STEAM = <id> "SC Test Steam"
COLLECTION_RETRO = <id> "SC Test Retro"
Removal: <steps>
```
