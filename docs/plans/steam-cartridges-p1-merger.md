# steam-cartridges P1: plugin merger (refactor-only)

> Spec for the implementer. Merge `non-steam-games-activity` (base) and
> `steamgriddb-artwork` into `steam-cartridges/` with **no behaviour change**,
> except for the plugin name, the data folder (ADR-0032) and retiring the two
> old plugins. Decisions:
> [ADR-0032](../decisions.md#adr-0032-merge-non-steam-games-activity-and-steamgriddb-artwork-into-steam-cartridges).
> Prerequisite: P0 done ([p0-research](steam-cartridges-p0-research.md), T5 in
> particular). Guardrails: [plugins.md](../plugins.md) (all of them; 1, 2, 5 and 11
> are the ones this code already depends on).

---

## 1. Audit (verified in code, 2026-09-24)

| Item | Core (`non-steam-games-activity`) | Artwork (`steamgriddb-artwork`) | Merge action |
| --- | --- | --- | --- |
| `backend/_lib/*.lua` (7) | ✔ | identical | keep core copy |
| `backend/steam_paths.lua` | ✔ | identical | keep core copy |
| `backend/shortcuts.lua` | ✔ | **superset**: also fills `entry.tags` (L100–102) | take the **artwork** copy (igdb `detect_platform_hints` reads `tags`) |
| `backend/{captures,gameid,rpc}.lua` | ✔ | — | keep |
| `backend/{config,igdb,metadata_db,sgdb}.lua` | — | ✔ | move flat as `backend/web_<name>.lua` (P0 T5: dotted require unverified, flat chosen) |
| `backend/main.lua` | 2 globals via `rpc.lua` `method()` | 6 globals defined inline | merge (§ 3.1) |
| RPC names | `GetLibraryStats`, `GetDiagnostics` | `GetStatus`, `GetGameMetadata`, `RefreshGameMetadata`, `GetAllMetadata`, `SaveGameMetadata`, `GetArtworkForGame` | **no collision; no renames** |
| `frontend/steam/jsx-hook.ts` | ✔ | identical (also identical in `enhanced-achievements`) | keep core copy **byte-identical** |
| `frontend/steam/gamepad-appid.ts` | label `non-steam-games-activity` | same code, label `steamgriddb-artwork` | keep core copy; `watchGamepadAppid` already supports many listeners |
| `frontend/logger.ts` | `new Logger('Non-Steam Games Activity')` | console prefix object | one: `new Logger('Steam Cartridges')` |
| `frontend/rpc.ts` | `call()` + 2 methods | `call()` + 5 methods + types | one file (§ 3.3) |
| `frontend/index.tsx` | core boot | artwork boot | core stays; artwork body → `features/game-info/index.ts` |
| `NON_STEAM_APPID_MIN`, `appIdFromPath` | in `index.tsx` | duplicate in `index.tsx` | one copy in new `frontend/steam/route.ts` |
| `frontend/steam/{game-info-patch,metadata}.ts` | — | ✔ | → `frontend/features/game-info/` |
| `frontend/steam/artwork.ts` | — | ✔ **(dead: never imported)** | → `frontend/features/artwork/artwork.ts`, kept unused for P3 |
| `tests/` | `harness.lua`, `test_backend.lua` | none | keep; add web + tags checks |
| `dev.ps1` | parametrised Steam path | also hardcodes `C:\game\steam` (breaks ADR-0011) | keep core copy + legacy retirement (§ 3.5) |

**Known duplicates left for P4** (out of scope, since P1 must not change
behaviour): `game-info-patch.ts` has its own `getSteamRequire` (probe key
`__nsga_meta_probe_`) and `getAppDetailsStore`/`getAppStore`, which duplicate
`steam/modules.ts` and `steam/stores.ts`. `refreshGameInfoInstances` matches
minified fiber names (`"k"`, `"G"`, `"ct"`); record it as a P4 finding.

---

## 2. Target tree

```
steam-cartridges/
  plugin.json  package.json  tsconfig.json  dev.ps1  README.md  CHANGELOG.md
  pnpm-lock.yaml  pnpm-workspace.yaml          (moved as-is; no package-manager change)
  backend/
    main.lua  rpc.lua  captures.lua  gameid.lua  shortcuts.lua  steam_paths.lua
    data_dir.lua   migrate.lua                 (NEW)
    _lib/…
    web/  config.lua  igdb.lua  metadata_db.lua  sgdb.lua  rpc.lua (NEW: the 6 artwork handlers)
  frontend/
    index.tsx  logger.ts  rpc.ts
    renderers/  library-app.tsx  library-home.tsx
    steam/      (all core files) + route.ts (NEW)
    features/game-info/  index.ts (NEW, from artwork index.tsx)  game-info-patch.ts  metadata.ts
    features/artwork/    artwork.ts
  tests/  harness.lua  test_backend.lua
```

---

## 3. Steps (in order; one commit per step is fine)

### 3.1 Move files (keep history)

1. `git mv non-steam-games-activity steam-cartridges`.
2. `git mv steamgriddb-artwork/backend/{config,igdb,metadata_db,sgdb}.lua steam-cartridges/backend/web/`.
3. `git mv steamgriddb-artwork/frontend/steam/{game-info-patch,metadata}.ts steam-cartridges/frontend/features/game-info/`
   and `…/artwork.ts steam-cartridges/frontend/features/artwork/`.
4. Copy the artwork `shortcuts.lua` over the core one (the only change is the `tags` branch).
5. `git rm -r steamgriddb-artwork` (everything left is a duplicate, plus its `dev.ps1`/`package.json`/`tsconfig.json`/`plugin.json`).

### 3.2 Backend

- `plugin.json`: `name: "steam-cartridges"`, `common_name: "Steam Cartridges"`,
  description "Makes non-Steam games feel native: Steam's own activity page from
  your captures, plus optional metadata and artwork.", `version: "0.1.0"`.
- `web/*.lua`: change the `require("config")` / `require("metadata_db")` lines to
  flat `web_config` / `web_metadata_db` (P0 T5: dotted requires unverified; P1 adds a startup self-check logging `package.path` and cwd).
- **NEW `data_dir.lua`**: `data_dir.path()` returns
  `fs.join(millennium.steam_path(), "millennium", "config", "steam-cartridges")`,
  creating it on first use (hardcode the base name, as
  `enhanced-achievements/backend` does).
- `web/config.lua`: look in `data_dir.path()/.env` and `data_dir.path()/sgdb_key.txt`
  **first**. Keep the existing candidate list after that, unchanged, marked
  `-- LEGACY, removed in P4` (ADR-0011). `set_api_key` writes to the data dir.
- `web/metadata_db.lua` `get_db_path`: `data_dir.path()/library_metadata.json`.
- **NEW `migrate.lua`** `migrate.run()`, called from `on_load` before anything
  reads config. It runs once, guarded by `data_dir/.migrated-v1`:
  1. If `data_dir/.env` is absent: take the first legacy `.env` that `config.lua`'s
     old candidates find. Write only the keys `twitch_client_id`,
     `twitch_client_secret` and `steamgriddb_api` into `data_dir/.env`. If a legacy
     `sgdb_key.txt` exists, write it as `steamgriddb_api`.
  2. If `data_dir/library_metadata.json` is absent and `<steam>/library_metadata.json`
     exists, **copy** it (do not delete the original; that keeps rollback possible).
  3. Log only counts and booleans ("migrated twitch creds: yes"), **never values**.
- **NEW `web/rpc.lua`**: move the six artwork handler bodies from
  `steamgriddb-artwork/backend/main.lua` into a returned table, **keeping their
  raw `payload_json` signatures and return shapes byte-for-byte**. Move
  `get_shortcut_info` there too. Do not wrap them in `rpc.lua`'s `method()`; that
  would change error shapes.
- `main.lua`: assign all 8 globals (`GetLibraryStats`, `GetDiagnostics` from
  `rpc`; `GetStatus`, `GetGameMetadata`, `RefreshGameMetadata`, `GetAllMetadata`,
  `SaveGameMetadata`, `GetArtworkForGame` from `web.rpc`). `on_load`: resolve
  paths (core), then `migrate.run()` in `pcall`, then the artwork's two status
  log lines, then **one** `millennium.ready()`. A migration failure logs and
  continues.

### 3.3 Frontend

- `logger.ts`: label `'Steam Cartridges'`.
- `rpc.ts`: `candidatePlugins = ['steam-cartridges-dev', 'steam-cartridges']`.
  Append the artwork types (`ProviderStatus`, `GameCategories`,
  `ConsolidatedMetadata`, `MetadataResponse`, `ImageAsset`, `ArtworkBundle`,
  `ArtworkUrls`, `GameArtworkResponse`) and methods (`getStatus`,
  `getGameMetadata`, `getAllMetadata`, `saveGameMetadata`, `getArtworkForGame`)
  unchanged. Keep one `call()`.
- **NEW `steam/route.ts`**: export `NON_STEAM_APPID_MIN = 0x8000_0000` and
  `appIdFromPath(pathname)`, moved verbatim from `index.tsx`.
- **NEW `features/game-info/index.ts`**: `export async function initGameInfo(): Promise<void>`
  holding the artwork `OnPluginLoaded` body verbatim, plus its module-level
  `libraryCache`, `processedApps`, `resolveShortcutTitle` and `handleAppView`.
  Imports: `../../logger`, `../../rpc`, `../../steam/gamepad-appid`,
  `../../steam/route`, `./metadata`, `./game-info-patch`.
- `features/game-info/*.ts`, `features/artwork/artwork.ts`: fix relative imports
  only (`../logger` → `../../logger`, `../rpc` → `../../rpc`).
- jsx labels: `gamepad-appid.ts` → `'steam-cartridges'`, `headline-patch.ts` →
  `'steam-cartridges.headline'`, `activity-cards-patch.ts` →
  `'steam-cartridges.activity-cards'`. Do **not** edit `jsx-hook.ts` (it must stay
  identical to `enhanced-achievements`' copy).
- `index.tsx`: import from `./steam/route`. Right after
  `installActivityCardsPatch()`, start
  `void initGameInfo().catch((e) => logger.error('Game Info feature failed; activity is unaffected.', e));`
  **without awaiting**, so the two halves keep loading independently, as two
  plugins did (ADR-0010). Keep all existing named exports (`registerSummaryProvider`,
  `jsxDiagnostics`, `headlineJsxDiagnostics`, `activityCardsJsxDiagnostics`, the
  summary types).
- Legacy guard: in `OnPluginLoaded`, if
  `window.PLUGIN_LIST?.['non-steam-games-activity' | '-dev' | 'steamgriddb-artwork' | '-dev']`
  exists, `logger.error` which one to disable. Log only: never skip init.

### 3.4 Tests

- `tests/harness.lua`: it resolves `backend/?.lua`, and dotted `web.*` requires
  work under standard Lua. It stubs only `logger`, `millennium`, `fs`, `utils`
  and `json`, so the web modules will not load as-is. Add: an **`http` stub
  whose `get`/`post` throw `"network in test"`** (a test must never reach the
  network), `fs.remove`, `fs.create_directories` (via `mkdir`), and
  `utils.write_file`. These are the calls `web/*.lua`, `data_dir.lua` and
  `migrate.lua` make that the harness lacks. Keep the `NSGA_*` env names (the
  rename is not worth the churn).
- `tests/test_backend.lua` adds, as **invariant** checks that need no fixture:
  every shortcut entry's `tags` is `nil` or an array of strings;
  `require("web.metadata_db")`, `web.config` and `web.igdb` load without error
  under the harness; `data_dir.path()` ends in
  `millennium\config\steam-cartridges`; `migrate.run()` against a temp dir is
  idempotent (second run does nothing) and never prints a secret value (feed a fake
  `.env` with a sentinel value, capture stdout, assert the sentinel is absent).
- `package.json`: `name: "steam-cartridges"`; scripts unchanged (`test` =
  `lua tests/test_backend.lua`). Lua comes from `tools/lua/` (gitignored). If it
  is absent, say so in the report and do not skip silently.

### 3.5 `dev.ps1`

Keep the core script. After deploying, add a **legacy retirement** block:
`Set-PluginEnabled … $false` for `non-steam-games-activity`,
`non-steam-games-activity-dev`, `steamgriddb-artwork` and
`steamgriddb-artwork-dev`. Remove only the `-dev` folders of those two from
`$pluginsDir`; **never delete a released folder**. Print what was disabled.

### 3.6 Docs (same PR)

- `AGENTS.md`: product description and Routine 4 plugin list
  (`steam-cartridges`), and the test command (`NSGA_STEAM_ROOT=… lua tests/test_backend.lua`).
- `README.md` plugin table; `docs/millennium-architecture.md` "Shape of the
  system" diagram (core name, the added `features/`, data folder).
- `docs/plugins.md` § Sharing the jsx runtime: plugin names.
- `scratch/jsx_chain.js`: `PLUGINS = ['steam-cartridges-dev', 'enhanced-achievements-dev']`.
- `steam-cartridges/README.md`: merge in what the artwork plugin did and where
  credentials now live (`<Steam>/millennium/config/steam-cartridges/.env`, keys only).
- `steam-cartridges/CHANGELOG.md`: `[Unreleased]` "Merged steamgriddb-artwork; renamed".
- Leave history alone: old CHANGELOG entries and ADR texts keep the old names.

---

## 4. Verification

1. `npm install && npm run check && npm run build` in `steam-cartridges/`.
2. `lua tests/test_backend.lua` (fixtures on; this machine).
3. `powershell -ExecutionPolicy Bypass -File dev.ps1` (graceful restart). Then
   confirm `enabledPlugins` holds `steam-cartridges-dev` and none of the four
   legacy names.
4. Log check (SharedJSContext console, filtered): `Steam Cartridges` ready line,
   "Preloaded Game Info for N" with the same N as before the merge (note it before
   step 1), and no `plugin not running` errors.
5. **Routine 1** on AM2R (desktop, then Big Picture): Post-Game Summary, Activity,
   Your Stuff, Game Info (Game Info must still be enriched: no bucket gating yet).
6. **Routine 2/3**: `node scratch/test_nav_cycle.js`, `node scratch/check_all_tabs.js`, `node scratch/jsx_chain.js`.
   Expect one fewer jsx wrapper than before (steady depth, no growth).
7. `window.PLUGIN_LIST['steam-cartridges-dev'].jsxDiagnostics()` returns live entries.
8. Data folder has `.env` (keys present; **do not print values**),
   `library_metadata.json` and `.migrated-v1`. The original `<steam>/library_metadata.json` is untouched.

## 5. Exit criteria

- [ ] Everything both plugins did works from one plugin (§ 4 steps 4–7 PASS).
- [ ] The two old plugins are disabled, and their `-dev` folders are gone from the plugins dir.
- [ ] No RPC renamed; `GetGameMetadata` still returns `source: "local_db"` for a cached game.
- [ ] No secret in logs, repo or docs (`git grep -i -E "twitch_client_secret *=|steamgriddb_api *="` is empty).
- [ ] check/build/tests green; CHANGELOG + TASK updated.

## 6. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Old and new plugins both enabled: sections and prototype hooks installed twice | `dev.ps1` retirement + the frontend legacy guard |
| Startup order changes when two plugins become one | Game Info init is not awaited and is isolated in `catch`; both halves register their own watchers as before |
| Dotted `require` unsupported | P0 T5 unverified: the flat layout is the decision (no subfolders) |
| Migration misses the creds | Legacy candidates still read after the data dir (P1 keeps the old behaviour) |
| `jsx-hook.ts` drifts from `enhanced-achievements` | Not edited; `md5sum` both copies in verification |

**Rollback:** `git revert` the P1 commits. In `config.json`, re-enable
`non-steam-games-activity-dev` and `steamgriddb-artwork-dev` (re-deploy each with
its own `dev.ps1` from the reverted tree). Legacy data was copied, not moved, so
nothing is lost.
