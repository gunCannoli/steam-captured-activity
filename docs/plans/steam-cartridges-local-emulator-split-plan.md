# Plan: steam-cartridges-local owns every Steam API emulator and local-game source (ideas from PSerban93/Achievements)

**Status:** written 2026-10-08, nothing implemented. **Baseline commit:** `6661a21`. **ADR to write:** ADR-0063 (text in § 5).
**Executor:** an implementing agent, phase by phase. Each phase ends green and is committed on its own; stop after any phase and the
tree still works.

**Goal (the user's words, 2026-10-08):** `steam-cartridges-local` holds everything about Steam API emulators and local PC games,
including any background observer of local achievement files. `steam-cartridges` stays pure: RetroAchievements, console emulators
(RetroArch, DuckStation, PCSX2, Dolphin, PPSSPP, RPCS3, shadPS4) and metadata fetching. **No mention of RUNE, CODEX, SkidRow,
EMPRESS, RELOADED, SOVEREIGN (nor Goldberg, GSE, SmartSteamEmu, Online-Fix, Tenoke, UniverseLAN) anywhere in the core plugin
folder**, enforced by a test. Along the way, port the parts of [PSerban93/Achievements](https://github.com/PSerban93/Achievements)
(MIT, © 2025 JokerVerse, read at `a43eaf3`, 2026-10-04) that make our local reader more correct.

---

## 1. What PSerban93/Achievements is, and what we take from it

An Electron desktop app (Windows) that watches save folders and processes, builds achievement schemas (Steam appcache, Exophase
scraping, Playwright), and shows its own notification overlay. ~17,000 lines in `utils/watched-folders.js` alone. We take
**file-format knowledge and watcher policy only**: no Electron, overlay, scraping, process polling or notification presets
(enhanced-notifications already owns toasts).

| # | Finding in their repo (file) | What we have today | Goes to |
| --- | --- | --- | --- |
| F1 | INI "Type 1" sections: `State`, `Time`, `CurProgress`, `MaxProgress` written as **little-endian 32-bit hex** (`hexLE32FromAny`, `achievement-data.js:51`, needs ≥ 8 hex chars). Earned when `State > 0` | `ini_parser.lua` reads them as decimal: a hex `Time` is dropped, a hex `State` of `00000000` reads 0 by luck | local |
| F2 | INI "Type 2" precedence: a section with `Achieved`/`Unlocked`/`Unlock`/`UnlockTime`/`UnlockedTime` is Type 2 even when Type 1 keys are also there (`parseAchievementIniSection`, :204) | mixed in one loop | local |
| F3 | Encoding: UTF-16LE **without BOM** is detected by NUL bytes (UniverseLAN), `parseIniWithEncoding` :23 | BOM only; and our UTF-16 decoder drops every non-ASCII character (`ini_parser.lua:13`, keeps `c2 == 0` only) | local |
| F4 | Unknown unlock time stays **0**, and a known earlier time is kept over a later read (`mergeEarnedTimeFromCached`, :816) | parsers write `os.time()` when the time is unknown, so an old unlock gets "now" | local (+ core accepts 0 as "unknown") |
| F5 | **Tenoke** `user_stats.ini`: `[ACHIEVEMENTS]` lines `"ID" = {unlocked = true, time = 1700000000}`, `[STATS]` `"STAT" = 12`; folders `SteamData\user_stats.ini`, `user_stats.ini`; appid from `tenoke.ini` `id=` (`parseTenokeAchievementsIni` :710, `findTenokeAppId` watched-folders.js:9320) | the doc claims Tenoke support; the parser cannot read this line shape (quoted key, brace value): **Tenoke never unlocks today** | local |
| F6 | **Online-Fix**: unlocks come from `Stats\achievements.ini`; `Stats.ini` holds **progress only and never unlocks** (README "Steam Emulator Progress Files") | `file_search.lua` lists `Stats.ini` as an unlock file and never looks in `Stats\` | local |
| F7 | `stats.bin` (SmartSteamEmu): int32 count, then 24-byte records: bytes 0-3 = CRC32 of the API name (LE), 8-11 = unlock time, 20-23 = achieved (0/1; > 1 means a stat) (`parseStatsBin.js`) | not read | local |
| F8 | Section titles may be **display names** or carry an `ach_` prefix; mapped to the API name through the schema (`buildNameOnlyIndex`, `buildDisplayToNameIndex`, :404) | the provider's ids go into the record **as is** (`app/achievements.ts` load and checkNow): a display-name section never matches | core (generic, no emulator names) |
| F9 | Per-appid layouts shared by many emulators: `<id>\achievements.{ini,json}`, `steam_settings\<id>\achievements.json`, `remote\<id>\achievements.json`, `<id>\Stats\achievements.ini`, `SteamData\user_stats.ini`, `<id>\stats.bin`, `UniverseLANData\Achievements.ini` (watched-folders.js:8070) | a fixed list per emulator name | local |
| F10 | Default roots: `%PUBLIC%\Documents\Steam\{CODEX,RUNE}`, `%PUBLIC%\Documents\{OnlineFix,EMPRESS}`, `%APPDATA%\{Goldberg SteamEmu Saves,GSE Saves,EMPRESS,SmartSteamEmu}`, `%APPDATA%\Steam\CODEX`, `%LOCALAPPDATA%\SKIDROW`, `%LOCALAPPDATA%\UniverseLAN` (watched-folders.js:619) | most of them; not `%LOCALAPPDATA%\SKIDROW`, not `%APPDATA%\EMPRESS` | local |
| F11 | AppID found inside the game folder: `UniverseLAN.ini` `[GameSettings] AppID`, `tenoke.ini` `id=` (:9191, :9320) | `SOVEREIGN.ini` `[Game] AppID` only | local |
| F12 | **Adaptive path watcher**: a save file created after the game starts is picked up without a restart (poll fallback 1 s, write-settle 300 ms, `adaptive-path-watcher.js`) | candidates resolved on every call, no session state | local |
| F13 | First snapshot of a game is applied **without notifications** (onboarding / "suppressing achievement notifications during migration") | the core's 2 s poll toasts any unlock not yet in the record: a first run with an old save file toasts every old unlock | core contract (`silent`) + local |
| F14 | Steam's own `appcache\stats\UserGameStatsSchema_<appid>.bin` (binary KeyValues) holds the **exact API names**, localized names, descriptions, icon hashes, hidden flags, progress rules (`steam-appcache.js`) | core `steam_schema.lua` pairs WebAPI percentages with Community HTML **by list index** (`merge_schema`, :58): a wrong pairing is possible | core, optional (§ 6 phase 6) |
| F15 | Xenia GPD, newer shadPS4 layout (`%APPDATA%\shadPS4\home\<userId>\trophy\<NPWR>.xml`, schema in `trophy\<NPWR>\Xml`) | no Xenia; shadPS4 reader exists, layouts untested on real files (TASK.md) | core, optional (§ 6 phase 6) |

Verified on this machine (2026-10-08): `C:\game\steam\appcache\stats` has 267 `UserGameStatsSchema_*.bin` files, **none for
2277560** (Wuchang), so F14 helps owned/viewed games only. Wuchang's `SOVEREIGN.ini` (path in TASK.md) has sections `[Game]`,
`[Profile]`, `[DownloadableContent]`, `[Achievements]`, `[Experimental]`, and each key under `[Achievements]` is preceded by a
`; <Display name>: <description>` comment (an offline schema; § 6 phase 7). `C:\Users\Public\Documents\Steam\RUNE\2277560` no
longer exists.

Not taken: Uplay/GOG/Epic emulators (Goldberg UplayEmu, R1, NemirtingasEpicEmu, anadius LSX) need non-Steam schemas the core
does not have; Exophase/Playwright scraping (network, fragile); their process poller (Steam already reports launch and quit);
XLiveLessNess, MarkerPatch, MadnessPatch, FF7 `achievement.dat` (single games, later if asked).

---

## 2. Root cause: why the core is not pure today (evidence at `6661a21`)

1. **The core still reads emulator saves itself**, duplicating the local plugin:
   - `steam-cartridges/backend/achievements_observer.lua`: header lines 4-6; `parse_ini_achievements` (Format A/B);
     `parse_goldberg_achievements`; `emulator_files(n_appid)` (7 hardcoded CODEX/RUNE/GSE/Goldberg paths); step "1. Steam
     emulator INI / JSON files" in `check_unlocks`.
   - `steam-cartridges/backend/achievement_files.lua`: `emu_ini_lock_all`, `goldberg_lock_all`, header lines 6-9.
   - `steam-cartridges/backend/achievements_reset.lua`: the `local` reset source (`emu_unlocked`, the "Steam emulator saves"
     block in `M.sources`, the `source_id == "local"` branch of `clear_file`), header line 6.
   - `steam-cartridges/frontend/settings/panels/achievements.tsx:37`: "Reads local emulator saves (Goldberg, CODEX, RUNE, GSE)
     and engine logs (Unity, Godot, Unreal)."
   - Tests: `tests/test_achievements_reset.lua` (Goldberg/RUNE cases), `tests/app-achievements.test.ts:41-44` (a `local` /
     `RUNE` fixture).
2. **PC-game engine logs live in the core**: `get_possible_folder_names`, `exe_basename`, `strip_shipping_suffix`, the
   "Engine logs" block of `log_paths` (Unity `Player.log`, Godot `godot.log`, Unreal `Saved\Logs`), and the generic
   `achievement=` / `unlock=` / `SetAchievement(` / `UnlockAchievement(` patterns of `scan_log_for_unlocks`. These are "local
   games", not console emulators. Tests: `tests/test_backend.lua:326-360`, `tests/test_ach_service.lua:380-386`.
3. **The extension contract is pull-per-poll.** `app/achievements.ts` calls every provider's `match` + `getUnlocks` in `load`
   (each page view) and in `checkNow` (every 2 s while a game runs). For the local plugin each call is a full
   `find_candidates` (parse `shortcuts.vdf`, walk up to the drive root, stat ~40 Steamworks-version paths per level, stat ~27
   global paths), twice per poll (`LocalDetectFiles`, then `LocalReadUnlocks`). Provider unlocks are never persisted by the core
   (only `trigger` and the backend observer call `store.unlock`), ids are not canonicalized (F8), and a first run toasts old
   unlocks (F13).
4. **The local plugin depends on the core's files and on this machine.** `steam-cartridges-local/backend/file_search.lua`
   reads `<steam>/millennium/config/steam-cartridges/steam_store.json` (the core's mapping store; plugins.md § Layout: a plugin
   never reaches into another's folder), falls back to `C:/game/steam` and user `83513586` (ADR-0011, publish checklist "no
   absolute paths, user ids").
5. **The reset contract special-cases the word "local"**: `resetSources` and `reset` match `p.id.includes("local")` against
   the backend's `local` source.

Ruled out: moving RPCS3/shadPS4 trophy files and RetroArch/DuckStation/PCSX2/Dolphin/PPSSPP logs (console emulators: the core
keeps them, the user's split); moving the `steam_store` achievements source (Steam's schema for a mapped app: metadata, stays).

---

## 3. Target architecture

```
 steam-cartridges (core)                                  steam-cartridges-local (extension)
 ─────────────────────────                                ───────────────────────────────────
 schema: Steam (mapped app), RA, RPCS3, shadPS4           discovery: game folder + global roots (F9-F11)
 own observer: console-emulator logs + trophy files       formats: INI A/B/Type1-hex, Tenoke, Goldberg JSON,
 record + Steam stores + toasts + Post-Game Summary                stats.bin, engine logs (moved from core)
                                                          watcher: session state, mtime/size polls, late files
        window.SteamCartridges (kernel/extensions.ts v1.1.0)
   core ──notifyAppViewed / notifyAppLaunched / notifyAppQuit(ctx)──► local
   core ◄──reportUnlocks(appid, [{id, unlockedAt}], {providerId, silent})── local
   core ──match / getUnlocks / reset(ctx)  (reset dialog only)──────► local
```

Contract changes (all additive to the registry; the API version becomes `"1.1.0"`):

- `AppContext` gains `nativeAppid?: number` (the mapped Steam app, 0/absent = none) and `achievementIds?: string[]` (the
  record's schema ids; lets a provider decode CRC-keyed files, F7). The local plugin stops reading the core's
  `steam_store.json` (root cause 4).
- `onAppLaunched(cb)` / `notifyAppLaunched(ctx)`, mirroring the existing view/quit pair.
- `reportUnlocks(appid, unlocks, opts)`: the core canonicalizes each id against the record's schema (F8, generic), drops ids it
  cannot name or already has, persists each through the existing `CartridgesAchievementsUnlock` RPC, updates the record, then
  emits `achievements.unlocked` (toast, timeline) or, when `opts.silent`, `achievements.synced` (Post-Game Summary, no toast;
  the event syncAfterQuit already uses). `unlockedAt <= 0` means unknown: the core uses now. Returns `{ accepted: string[] }`.
- The core **no longer calls providers from `load` or `checkNow`**. `match`/`getUnlocks`/`reset` are used only by the Reset
  dialog (`resetSources`, `reset`), keyed by the provider's own id, with no `"local"` special case.

Ownership after the change:

| Thing | Owner |
| --- | --- |
| Steam API emulator files (any format), their discovery, reset and backup | local |
| Unity / Godot / Unreal log tailing, their offsets file, the project-codename guesses | local |
| The 2 s watch while a shortcut runs, for the above | local |
| Console-emulator logs and RPCS3 / shadPS4 trophy files, their offsets, the core's 2 s `CheckUnlocks` poll | core |
| Canonical ids, persistence, toasts, timeline, Post-Game Summary | core |

---

## 4. Preconditions (run before phase 1; all must hold)

| Command (from the workspace root unless noted) | Expected |
| --- | --- |
| `git status --short` | empty |
| `git log -1 --format=%h` | `6661a21` or a descendant; if a descendant touched any file in § 6, re-check that step's **before** block first |
| `cd steam-cartridges && npm run check` | only the npm banner, exit 0 |
| `cd steam-cartridges && npm run test:ts` | ends `ℹ pass 334` / `ℹ fail 0` |
| `cd steam-cartridges && NSGA_STEAM_ROOT=C:/game/steam npm run test:lua` | every suite prints `ALL PASS` |
| `cd steam-cartridges && NSGA_STEAM_ROOT=C:/game/steam lua tests/test_achievements_reset.lua` | `34 passed, 0 failed` (not in `test:lua`) |
| `cd steam-cartridges-local && npm run check && npm test` | exit 0; `ALL PASS (steam-cartridges-local)` and `ALL PASS (file_search tests)` |
| `node steam-lock.mjs status` | read only; no lock is needed until § 9 |

**Dry run (plans/README rule 11): not done by the architect.** Every **before** block below was copied from the files at
`6661a21`. Step 0 of each phase is: open the file and confirm the before block matches; a mismatch means the plan is stale:
stop and apply the failure rule.

---

## 5. ADR-0063 (append to docs/decisions.md in phase 5, verbatim)

```markdown
## ADR-0063: Steam API emulator and local-game achievements live only in steam-cartridges-local; extensions push unlocks

**Status:** Accepted · 2026-10-08 (the user's decision) · **Supersedes [ADR-0054](#adr-0054-reset-achievements-also-clears-the-files-a-non-steam-games-unlocks-come-back-from) in part** (decision 1's `local` source and decision 5 for engine logs move to the extension)

### Context

steam-cartridges read Steam API emulator saves (CODEX, RUNE, GSE, Goldberg) and Unity/Godot/Unreal logs itself, while
steam-cartridges-local read the same saves and more. The core asked every extension for unlocks on each page view and every
2 s while a game ran, with a full file search per call, kept nothing it was given, and toasted every old unlock on a first run.

### Decision

1. steam-cartridges-local owns every Steam API emulator format, the local-game engine logs, their discovery, reset and backups,
   and the watch while a game runs. The core plugin folder names no emulator or release group; a test enforces it.
2. The core keeps RetroAchievements, console emulators (logs and RPCS3/shadPS4 trophy files) and metadata.
3. Extensions push unlocks with `window.SteamCartridges.reportUnlocks`; the core canonicalizes ids against the schema, persists
   them and announces them (`silent` = Post-Game Summary only, no toast). The core never polls an extension for unlocks.
4. The core passes `nativeAppid` and `achievementIds` in `AppContext`, and calls `notifyAppLaunched`. Extensions never read the
   core's data files.
5. A log the extension sees for the first time is read from its end, so moving the offsets never replays history (ADR-0054's
   promise that a reset stays reset).

### Consequences

- One reader per format; the local plugin's tests own the format cases. Without steam-cartridges-local, emulator saves are not
  read (they were partly read before): installing it is the way to get them (the README says so).
- The Reset dialog lists `steam-cartridges-local` under the provider's own id and label.
- Engine-log unlocks detected before the move are kept (they are in `achievements.json`); their old offsets in the core's
  `log_offsets.json` become unused.
```

---

## 6. Phases and steps

Rules for every step: edit only the named file; after the step, run the named command and compare with the expected output.
Line numbers are at `6661a21`, for orientation only; the before blocks are the authority.

### Phase 1 — core: the contract (additive; nothing removed yet)

**1.1 `steam-cartridges/frontend/kernel/extensions.ts`, interface `AppContext`.**

Before:
```ts
export interface AppContext {
    appid: number;
    gameid: string;
    isShortcut: boolean;
    displayName: string;
    exe?: string;
    launchOptions?: string;
}
```
After:
```ts
export interface AppContext {
    appid: number;
    gameid: string;
    isShortcut: boolean;
    displayName: string;
    exe?: string;
    launchOptions?: string;
    /** The Steam app this shortcut maps to (0 or absent = none). Extensions never read the core's files for it (ADR-0063). */
    nativeAppid?: number;
    /** The ids of the record's achievement schema, when it has one (lets a provider decode CRC-keyed files). */
    achievementIds?: string[];
}

export interface ReportUnlocksOptions {
    /** The reporting provider's id, for the log. */
    providerId: string;
    /** true: record and show in the Post-Game Summary, no toast (a first snapshot of old unlocks). */
    silent?: boolean;
}
```

**1.2 Same file, interface `SteamCartridgesAPI`.** Before:
```ts
    onAppViewed(cb: (context: AppContext) => void): () => void;
    onAppQuit(cb: (context: AppContext) => void): () => void;
    notifyAppViewed(context: AppContext): void;
    notifyAppQuit(context: AppContext): void;
}
```
After:
```ts
    onAppViewed(cb: (context: AppContext) => void): () => void;
    onAppLaunched(cb: (context: AppContext) => void): () => void;
    onAppQuit(cb: (context: AppContext) => void): () => void;
    notifyAppViewed(context: AppContext): void;
    notifyAppLaunched(context: AppContext): void;
    notifyAppQuit(context: AppContext): void;
    /** Extensions push unlocks; the core canonicalizes, persists and announces them (ADR-0063). */
    reportUnlocks(appid: number, unlocks: AchievementUnlockItem[], opts: ReportUnlocksOptions): Promise<{ accepted: string[] }>;
}
```

**1.3 Same file, `createExtensionRegistry`.** Change the signature and body:

Before:
```ts
export function createExtensionRegistry(): SteamCartridgesAPI {
```
After:
```ts
export function createExtensionRegistry(
    sink: { reportUnlocks: SteamCartridgesAPI["reportUnlocks"] } = { reportUnlocks: async () => ({ accepted: [] }) },
): SteamCartridgesAPI {
```
Before:
```ts
    const viewListeners: ((context: AppContext) => void)[] = [];
    const quitListeners: ((context: AppContext) => void)[] = [];
```
After:
```ts
    const viewListeners: ((context: AppContext) => void)[] = [];
    const launchListeners: ((context: AppContext) => void)[] = [];
    const quitListeners: ((context: AppContext) => void)[] = [];
```
Before:
```ts
        version: "1.0.0",
```
After:
```ts
        version: "1.1.0",
```
Before:
```ts
        onAppQuit(cb) {
            quitListeners.push(cb);
```
After:
```ts
        onAppLaunched(cb) {
            launchListeners.push(cb);
            return () => {
                const idx = launchListeners.indexOf(cb);
                if (idx >= 0) launchListeners.splice(idx, 1);
            };
        },
        onAppQuit(cb) {
            quitListeners.push(cb);
```
Before:
```ts
        notifyAppQuit(ctx) {
```
After:
```ts
        notifyAppLaunched(ctx) {
            for (const cb of launchListeners) {
                try {
                    cb(ctx);
                } catch {
                    // Fail-silent isolation (ADR-0014)
                }
            }
        },
        reportUnlocks(appid, unlocks, opts) {
            try {
                return sink.reportUnlocks(appid, Array.isArray(unlocks) ? unlocks : [], opts).catch(() => ({ accepted: [] }));
            } catch {
                return Promise.resolve({ accepted: [] });
            }
        },
        notifyAppQuit(ctx) {
```
Command: `npm run check` (in `steam-cartridges`) → exit 0.

**1.4 New file `steam-cartridges/frontend/domain/achievement-ids.ts`** (pure; F8 and the Lua `resolve_canonical_item` order,
plus the `ach_` alias):
```ts
// domain/achievement-ids: map a token an extension or a file reports to the schema's id (ADR-0063). Pure.
// Order: exact id, id ignoring case, `ach_` prefix added or removed, display name ignoring case, then letters and digits only.

export interface NamedAchievement {
    id: string;
    name: string;
}

const alnum = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function canonicalAchievementId(token: unknown, schema: readonly NamedAchievement[]): string | undefined {
    if (typeof token !== "string" && typeof token !== "number") return undefined;
    const t = String(token).trim();
    if (!t || !Array.isArray(schema) || schema.length === 0) return undefined;
    const lower = t.toLowerCase();
    for (const a of schema) if (a.id === t) return a.id;
    for (const a of schema) if (a.id.toLowerCase() === lower) return a.id;
    const swapped = lower.startsWith("ach_") ? lower.slice(4) : `ach_${lower}`;
    for (const a of schema) if (a.id.toLowerCase() === swapped) return a.id;
    for (const a of schema) if ((a.name ?? "").trim().toLowerCase() === lower) return a.id;
    const key = alnum(t);
    if (!key) return undefined;
    for (const a of schema) if (alnum(a.id) === key || alnum(a.name ?? "") === key) return a.id;
    return undefined;
}
```
**1.5 New file `steam-cartridges/tests/achievement-ids.test.ts`** with exactly these 6 tests (copy the import style of
`tests/category-policy.test.ts`, which tests a `domain/` module):
1. exact id wins over a case-insensitive name match (`schema=[{id:'Kill',name:'kill'},{id:'kill',name:'X'}]`, token `kill` → `kill`);
2. `ACH_WIN` ↔ schema id `WIN` and `WIN` ↔ schema id `ACH_WIN`;
3. display name `"Fallen Feathers"` → its id;
4. `"fallen-feathers!"` → the id of name `"Fallen Feathers"`;
5. unknown token, empty token, number `0` with no match, empty schema → `undefined`;
6. a non-ASCII name (`"Été"`) matches `"ÉTÉ"`.
Command: `npm run test:ts` → `ℹ pass 340` / `ℹ fail 0`.

**1.6 `steam-cartridges/frontend/app/achievements.ts`: add `ingestExternal` and `context`.**

(a) Import. Before:
```ts
import type { AppContext, AchievementSourceProvider } from "../kernel/extensions.ts";
```
After:
```ts
import type { AppContext, AchievementSourceProvider, AchievementUnlockItem, ReportUnlocksOptions } from "../kernel/extensions.ts";
import { canonicalAchievementId } from "../domain/achievement-ids.ts";
```
(If `tests/architecture.test.ts` rejects `app → domain` with a `.ts` suffix, use the suffix style the other `app/*` files use
for `domain` imports; do not touch the allowlist: `app → domain` is an allowed edge, steam-cartridges.md § 4.1 item 5.)

(b) Interface `AchievementsService`. Before:
```ts
    /** Unlocked and total count from the record, for the settings panel's audit. */
    summary(appid: number): { nAchieved: number; nTotal: number } | undefined;
```
After:
```ts
    /** Unlocked and total count from the record, for the settings panel's audit. */
    summary(appid: number): { nAchieved: number; nTotal: number } | undefined;
    /** Unlocks an extension reports (ADR-0063): canonical ids, persisted, then announced (silent: no toast). */
    ingestExternal(appid: number, unlocks: AchievementUnlockItem[], opts: ReportUnlocksOptions): Promise<{ accepted: string[] }>;
    /** What an extension is told about a shortcut: exe, launch options, mapped app, schema ids. */
    context(appid: ShortcutId): Promise<AppContext>;
```

(c) `makeAppContext`. Before:
```ts
    function makeAppContext(appid: ShortcutId): AppContext {
        const sc = deps.shortcutData?.(appid);
        return {
            appid,
            gameid: String(appid),
            isShortcut: true,
            displayName: deps.titleOf(appid) ?? sc?.strAppName ?? "",
            exe: sc?.szExe,
            launchOptions: sc?.szArguments,
        };
    }
```
After:
```ts
    function makeAppContext(appid: ShortcutId, nativeAppid?: number): AppContext {
        const sc = deps.shortcutData?.(appid);
        const ids = current(appid)?.data?.schema.achievements.map((a) => String(a.id));
        return {
            appid,
            gameid: String(appid),
            isShortcut: true,
            displayName: deps.titleOf(appid) ?? sc?.strAppName ?? "",
            exe: sc?.szExe,
            launchOptions: sc?.szArguments,
            nativeAppid,
            achievementIds: ids && ids.length > 0 ? ids : undefined,
        };
    }

    /** One ingest at a time per shortcut, so two reports never persist the same id twice. */
    const ingestChain = new Map<ShortcutId, Promise<unknown>>();

    async function ingestOnce(appid: ShortcutId, unlocks: AchievementUnlockItem[], opts: ReportUnlocksOptions): Promise<{ accepted: string[] }> {
        let set = current(appid)?.data;
        if (!set) {
            await ensure(appid, deps.routeOf(appid), { lane: "normal" });
            set = current(appid)?.data;
        }
        if (!set) return { accepted: [] };
        const fresh = new Map<string, number>();
        for (const u of unlocks) {
            const id = canonicalAchievementId(u?.id, set.schema.achievements);
            if (!id || set.unlocks[id] || fresh.has(id)) continue;
            const at = Number(u.unlockedAt) > 0 ? Math.floor(Number(u.unlockedAt)) : Math.floor(deps.now() / 1000);
            fresh.set(id, at);
        }
        if (fresh.size === 0) return { accepted: [] };
        const accepted: string[] = [];
        for (const [id, at] of fresh) {
            const res = await deps.backend.unlockAchievement(appid, id, at).catch((e) => ({ error: String(e) }) as { error: string });
            if ((res as { error?: string }).error) {
                logger.warn(`${opts.providerId}: could not record ${id} for shortcut ${appid}: ${(res as { error?: string }).error}`);
                continue;
            }
            accepted.push(id);
        }
        if (accepted.length === 0) return { accepted };
        const latest = current(appid)?.data ?? set;
        const merged: Record<string, AchievementUnlockRecord> = { ...latest.unlocks };
        for (const id of accepted) merged[id] = { unlocked_time: fresh.get(id)! };
        deps.records.update(appid, { achievements: { ...current(appid)!, data: { ...latest, unlocks: merged } } });
        logger.info(`${opts.providerId} reported ${accepted.length} new unlock(s) for shortcut ${appid}: ${accepted.join(", ")}`);
        if (opts.silent || !deps.observerEnabled()) {
            const items: UnlockedAchievement[] = [];
            for (const id of accepted) {
                const a = latest.schema.achievements.find((x) => x.id === id);
                if (a) items.push({ id, name: a.name, description: a.description, icon: a.icon, global_pct: a.global_pct, unlockedAt: fresh.get(id)! });
            }
            if (items.length > 0) deps.bus.emit("achievements.synced", { appid, items });
        } else {
            announce(appid, accepted);
        }
        return { accepted };
    }
```
(`ensure` is a `function` declaration further down: hoisted, callable here.)

(d) The returned object. Before:
```ts
        ensure,
        checkNow,
        startSession,
```
After:
```ts
        ensure,
        checkNow,
        startSession,
        ingestExternal(appid, unlocks, opts) {
            const id = toShortcutId(Number(appid));
            if (id === undefined) return Promise.resolve({ accepted: [] });
            const prev = ingestChain.get(id) ?? Promise.resolve();
            const next = prev.then(() => ingestOnce(id, Array.isArray(unlocks) ? unlocks : [], opts));
            ingestChain.set(id, next.catch(() => undefined));
            return next.catch((e) => {
                logger.warn(`Ingest from ${opts?.providerId} failed for ${id}:`, e);
                return { accepted: [] };
            });
        },
        async context(appid) {
            return makeAppContext(appid, await resolveNative(appid));
        },
```
(e) Add `"unlockAchievement"` is already in `AchievementsDeps.backend`'s `Pick` list: confirm; if absent, add it to the union.

Command: `npm run check` → exit 0.

**1.7 `steam-cartridges/frontend/index.tsx`: wire the sink and the context.**

The registry is created in `initGlobalExtensionAPI()`. Before:
```ts
    const api = createExtensionRegistry();
```
After:
```ts
    const api = createExtensionRegistry({
        reportUnlocks: (appid, unlocks, opts) => achievements.ingestExternal(appid, unlocks, opts),
    });
```
View notification. Before:
```ts
        extensionApi.notifyAppViewed({
            appid,
            gameid: String(appid),
            isShortcut: true,
            displayName: shortcutTitle(appid) ?? "",
        });
```
After:
```ts
        void achievements.context(appid).then((ctx) => extensionApi.notifyAppViewed(ctx));
```
Quit notification. Before:
```ts
        extensionApi.notifyAppQuit({
            appid,
            gameid: String(appid),
            isShortcut: true,
            displayName: name ?? shortcutTitle(appid) ?? "",
        });
```
After:
```ts
        void achievements.context(appid).then((ctx) => extensionApi.notifyAppQuit({ ...ctx, displayName: name ?? ctx.displayName }));
```
Launch notification: directly after the `bus.on("shortcut.quit", ...)` block that contains the quit notification, add:
```ts
    bus.on("shortcut.launched", ({ appid }) => {
        void achievements.context(appid).then((ctx) => extensionApi.notifyAppLaunched(ctx));
    });
```
Command: `npm run check` → exit 0.

**1.8 `steam-cartridges/tests/app-achievements.test.ts`: add exactly 5 tests** using the file's existing `setup` helper
(add `unlockAchievement` call recording to it: push `{appid, id, time}` to a new `calls.unlock` array and return
`{ ok: true, unlocks: {} }`):
1. `ingestExternal` with `[{id:'A', unlockedAt: 50}]` → `accepted ['A']`, `calls.unlock` has `A` at 50, record has `A`, one
   `achievements.unlocked` with ids `['A']`.
2. `silent: true` → no `achievements.unlocked`; one `achievements.synced` with one item.
3. an id the schema lacks, and an id already unlocked, are dropped (`accepted []`, no RPC).
4. `unlockedAt: 0` → recorded at `now()/1000` (the helper's `now` is 1000 → 1).
5. two concurrent `ingestExternal` calls with the same id → exactly one `unlockAchievement` call.
Command: `npm run test:ts` → `ℹ pass 345` / `ℹ fail 0`.

Commit phase 1 (§ 10).

### Phase 2 — local backend: correct readers, no core files, session watcher

Layout after this phase (new files marked +):

```
steam-cartridges-local/backend/
  main.lua            RPCs (rewritten registration, same method() wrapper)
  data_dir.lua      + <steam>/millennium/config/steam-cartridges-local (copy of core data_dir.lua, folder name changed)
  text.lua          + read file, decode UTF-8 / UTF-8 BOM / UTF-16LE (BOM or NUL-detected) / UTF-16BE to UTF-8, full code points
  ini_parser.lua      parse_ini (A, B, Type1-hex, Type2 precedence, [SteamAchievements]), lock_all (unchanged behaviour + Tenoke)
  tenoke.lua        + parse(text) / lock_all(text) for user_stats.ini; appid_from_ini(text) for tenoke.ini
  goldberg_parser.lua  unknown time -> 0 (was os.time())
  stats_bin.lua     + crc32(s); parse(bytes, ids) -> unlocks (read only)
  appid_discovery.lua + steam_appid.txt, SOVEREIGN [Game] AppID, UniverseLAN [GameSettings] AppID, tenoke.ini id=
  file_search.lua     candidates(ctx): game folder walk + global roots x shared per-appid layouts; no shortcuts.vdf, no core files
  engine_logs.lua   + moved from the core (folder-name guesses, Unity/Godot/Unreal paths, generic patterns, offsets in data_dir)
  watcher.lua       + per-appid session: files with mtime/size, last snapshot, engine-log tokens, late-file re-resolve
  file_reset.lua      dispatch per format; Online-Fix Stats.ini and stats.bin never reset (read only)
```

Rules for every new Lua file: `require` every Millennium module (guardrail 20); no global reads (copy
`steam-cartridges/tests/test_globals.lua` into `steam-cartridges-local/tests/` and point it at this backend, step 2.10); every
list returned over RPC goes through an `as_array` helper (guardrail 21; copy the one in the core observer); no `os.time()` as an
unknown unlock time (F4); paths built with forward slashes.

**2.1 `text.lua`.** `M.decode(bytes)`: BOM `FF FE` → UTF-16LE; `FE FF` → UTF-16BE; `EF BB BF` → strip; else if the first
4096 bytes contain a `\0` → UTF-16LE (F3); else as is. UTF-16 decoding converts surrogate pairs and writes 1-4 byte UTF-8 (no
character dropped). `M.read(path)` → decoded text or nil.

**2.2 `ini_parser.lua` `parse_ini(text)`** returns `{ [id] = { unlocked_time = n } }` where `n` is a Unix second or **0 when
unknown**. Per section (case-insensitive name):
- `[achievements]` (Format B): `v` numeric `> 1` → time `v` (ms → `/1000` when `> 1e10`); `1`/`true`/`yes` → time 0; else locked.
- `[steamachievements]`: every key that is a non-negative integer → its value is an unlocked id, time 0. `Count` ignored.
- `[game]`, `[profile]`, `[downloadablecontent]`, `[experimental]`, `[stats]`, `[gamesettings]`: ignored.
- any other section = one achievement. Collect its keys first, then decide (F2): Type 2 when any of `achieved`, `unlocked`,
  `unlock`, `earned`, `unlocktime`, `unlockedtime` is present: earned when that flag is `1`/`true`/`yes`, or when an unlock
  time `> 0` and no flag key is present; time from `unlocktime`/`unlockedtime`/`time`/`timestamp`/`earned_time`. Otherwise
  Type 1: values of `state`, `time`, `curprogress`, `maxprogress` with ≥ 8 hex digits (after stripping non-hex) decode as
  little-endian uint32 of the first 8 (F1), else as decimal; earned when `state > 0` or `curprogress >= maxprogress > 0`.
`lock_all(text)` keeps its behaviour (and its existing tests) and also zeroes Type 1 hex `State`/`Time` (`00000000`).

**2.3 `tenoke.lua`.** `parse(text)`: sections uppercased; in `ACHIEVEMENTS`, lines `"ID" = {k = v, ...}`: earned when
`unlocked` is `true`/`1`/`yes`, time from `time`; `STATS` ignored (progress is phase 7). `lock_all(text)`: inside the braces
of each `ACHIEVEMENTS` line set `unlocked = false` and `time = 0`, every other byte kept; returns text, cleared count.
`appid_from_ini(text)`: first `^%s*id%s*=%s*(%d+)` (case-insensitive).

**2.4 `stats_bin.lua`.** `crc32(s)` (IEEE, reflected, poly `0xEDB88320`, via LuaJIT `bit`; must give `0xCBF43926` for
`"123456789"`). `parse(bytes, ids)`: `count = int32le(1)`; require `#bytes == 4 + 24*count`, else `{}`; build
`crc32(id) -> id` for the given ids; for each record: `crc = uint32le(off)`, `time = int32le(off+8)`, `achieved =
int32le(off+20)`; keep `achieved == 1` with a known crc; time `> 0` else 0.

**2.5 `appid_discovery.lua`.** `from_folder(dir)` checks, in this order, and returns the first positive integer: `steam_appid.txt`
(first integer in it), `steam_settings/steam_appid.txt`, `SOVEREIGN.ini` `[Game] AppID`, `UniverseLAN.ini` `[GameSettings]
AppID`, `tenoke.ini` `id=`. Text through `text.read` (UTF-16 safe).

**2.6 `file_search.lua` `candidates(ctx)`** where `ctx = { appid, exe, start_dir, native, ids }` (from `AppContext`; no
`shortcuts.vdf` parse, no `steam_store.json`, no `C:/game/steam`, no `83513586`: delete `find_steam_root`,
`find_user_config_dir`, `parse_shortcuts_vdf`, `read_steam_store_mappings`). Returns `{ { path, format, label } }` that exist,
deduplicated case-insensitively. `format` ∈ `ini`, `tenoke`, `goldberg`, `stats_bin`. `label` is the emulator's display name
(only this plugin may name them).
- **Ids to try:** `native` when `> 0`, plus every `from_folder` result met in the game-folder walk.
- **Game folder:** from `exe` (quotes stripped) or `start_dir`; walk up at most 4 levels, stop at a drive root. In each level
  `d` check: `SOVEREIGN.ini` (label SOVEREIGN), `achievements.ini`, `Stats/achievements.ini` (Online-Fix), `user_stats.ini`
  and `SteamData/user_stats.ini` (Tenoke), `UniverseLANData/Achievements.ini` (UniverseLAN), `steam_settings/<id>/achievements.json`,
  `Binaries/Win64/` and `Engine/Binaries/ThirdParty/Steamworks/*/Win64/` for `SOVEREIGN.ini` (list the `Steamworks` folder's
  children with `fs.list` once instead of the 11 hardcoded versions). Keep today's `[Game] AppID` acceptance rule.
- **Global roots** (F10, env vars, never hardcoded drives): `%PUBLIC%/Documents/Steam/CODEX`, `.../Steam/RUNE`,
  `.../Steam/RLD!`, `.../Steam/SOVEREIGN`, `.../Steam` (GSE), `%PUBLIC%/Documents/OnlineFix`, `.../EMPRESS`, `.../SkidRow`,
  `.../SmartSteamEmu`, `%APPDATA%/Steam/CODEX`, `/Steam/RUNE`, `/Steam/RLD!`, `/Steam/SOVEREIGN`, `/Steam`, `%APPDATA%/GSE Saves`,
  `/Goldberg SteamEmu Saves`, `/OnlineFix`, `/SkidRow`, `/EMPRESS`, `/SmartSteamEmu`, `/SOVEREIGN/Storage/SOVEREIGN`,
  `/SOVEREIGN`, `%LOCALAPPDATA%/SKIDROW`. For each root `R` and id: the shared layouts (F9) `R/<id>/achievements.ini`,
  `R/<id>/achievements.json`, `R/<id>/SOVEREIGN.ini`, `R/<id>/Stats/achievements.ini`, `R/<id>/SteamData/user_stats.ini`,
  `R/<id>/user_stats.ini`, `R/<id>/stats.bin`, `R/<id>/remote/<id>/achievements.json`, `R/<id>/steam_settings/<id>/achievements.json`.
- **Never a candidate:** `Stats.ini` / `stats.ini` (Online-Fix progress, F6).
- Format from the file name: `.json` → goldberg, `stats.bin` → stats_bin, `user_stats.ini` → tenoke, else ini.
- `M._cache`: results kept 60 s per `appid|native|exe` key; `M.invalidate(appid)`.

**2.7 `engine_logs.lua`** (moved, root cause 2). Copy from `steam-cartridges/backend/achievements_observer.lua` at `6661a21`,
unchanged except as noted: `strip_shipping_suffix`, `exe_basename`, `get_possible_folder_names`, the "Engine logs" block of
`log_paths` (Unity, Godot, Unreal, and the newest-`*.log` fallback) as `M.paths(title, exe)`, the five generic patterns of
`scan_log_for_unlocks` as `M.scan(path)`:
```lua
line:match("[aA]chievement%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
or line:match("[aA]ward%a*%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
or line:match("[uU]nlock%a*%s*[:=]+%s*['\"]?([%w_%-]+)['\"]?")
or line:match("[uU]nlock[aA]chievement%s*%(%s*['\"]([^'\"]+)['\"]")
or line:match("[sS]et[aA]chievement%s*%(%s*['\"]([^'\"]+)['\"]")
```
Offsets in `data_dir.file("log_offsets.json")` (same load/save code). **Change (ADR-0063 decision 5):** a path with no stored
offset is set to its current end and returns nothing on that first scan. `M.mark_read(title, exe)` = the core's
`mark_logs_read` for these paths. Tokens found get time `os.time()` (a log line is seen as it happens; this is the one place
"now" is right).

**2.8 `watcher.lua`.** State per appid: `{ ctx, files = { [path] = { mtime, size, format, label } }, snapshot = { [id] =
time }, polls = 0 }`.
- `start(ctx)`: `file_search.invalidate`, resolve, read every file, `snapshot` = union; returns `{ files, unlocks }`.
- `poll(appid)`: `polls += 1`; for each file compare `fs.last_write_time` and `fs.file_size` (both in `_lib/fs.lua`); re-read
  only changed ones; scan engine logs (`engine_logs.scan` on `engine_logs.paths`); when no file is watched and
  `polls % 8 == 0`, re-resolve (late-created files, F12). Returns `{ changed, unlocks }`, `unlocks` = the whole snapshot when
  `changed`, else `{}`. A file that disappears is dropped (its unlocks stay in the snapshot: the core keeps them anyway).
- `stop(appid)`: final `poll`, save offsets, drop state; returns the last `poll` result.

**2.9 `main.lua` RPCs** (keep the existing `method` wrapper and lifecycle table). Every payload is `AppContext`-shaped:
`{ appid, exe, launchOptions, nativeAppid, achievementIds }`, mapped to `ctx = { appid, exe, start_dir = nil, native =
nativeAppid, ids = achievementIds }`.
- `LocalDetectFiles(ctx)` → `{ files = as_array([{ path, label, format }]) }` (cached search).
- `LocalReadUnlocks(ctx)` → `{ unlocks = as_array([{ id, unlockedAt }]) }` (files only, no engine logs).
- `LocalResetUnlocks(ctx)` → per file `file_reset.reset_file(path, format)`, then `engine_logs.mark_read`, `file_search.invalidate`;
  `{ ok, cleared, backupPath, errors = as_array(...) }`. `stats_bin` files are skipped with an error line "read only".
- `LocalWatchStart(ctx)`, `LocalWatchPoll({ appid })`, `LocalWatchStop({ appid })` → `{ files?, changed?, unlocks }`.

**2.10 Tests** (`steam-cartridges-local/tests/`; harness stays `harness.lua`). Add to `package.json` `"test"` every new file, in
this order: `test_text.lua`, `test_ini_parser.lua`, `test_tenoke.lua`, `test_stats_bin.lua`, `test_file_search.lua`,
`test_engine_logs.lua`, `test_watcher.lua`, `test_globals.lua`. Required cases (each one `check(...)`):
- text: UTF-16LE with BOM containing `ÉTÉ` decodes to the UTF-8 bytes `C3 89 54 C3 89`; UTF-16LE without BOM detected; a
  surrogate pair (U+1F3C6) becomes 4 UTF-8 bytes.
- ini: Type 2 CODEX `[ACH_A] Achieved=1 UnlockTime=1700000000`; Type 1 `[ACH_B] State=01000000 Time=00f15365` → time
  1700000000; Type 1 `State=00000000` locked; Format B `ACH_C=1750000000` and `ACH_D=1` (time 0); `[SteamAchievements] Count=1
  0=ACH_E`; `Achieved=1` with no time → time **0**; a millisecond time `1700000000000` → 1700000000; existing lock_all cases still pass.
- tenoke: `"ACH_A" = {unlocked = true, time = 1700000000}` and `"ACH_B" = {unlocked = false, time = 0}` → only `ACH_A`;
  `lock_all` turns the first into `unlocked = false, time = 0` and returns 1; `appid_from_ini("[TENOKE]\nid = 2277560")` → 2277560.
- stats_bin: `crc32("123456789") == 0xCBF43926`; a 52-byte file built in the test (count 2; `ACH_A` achieved 1 time
  1700000000; `ACH_B` achieved 0) with `ids {"ACH_A","ACH_B"}` → `{ ACH_A = 1700000000 }`; a wrong length → `{}`.
- file_search (temp folders under `os.getenv("TEMP")`): Online-Fix `Stats/achievements.ini` found, `Stats.ini` never; a
  Tenoke game folder with `tenoke.ini id=123` and `SteamData/user_stats.ini` found with format `tenoke`; a `steam_appid.txt`
  id is tried; **a grep of `backend/*.lua` finds no `83513586`, no `C:/game`, no `steam_store.json`** (read the files in the test).
- engine_logs: the moved `get_possible_folder_names` cases from `steam-cartridges/tests/test_backend.lua:326-360` and
  `tests/test_ach_service.lua:380-386` (copy them verbatim, change only the `require`); first scan of a new log returns nothing,
  an appended `SetAchievement("ACH_X")` line returns `ACH_X`; a shorter (rotated) log is read from the start.
- watcher: start on a temp `achievements.ini` with one unlock → `unlocks` has it; poll without change → `changed == false`;
  append a second unlock and bump the file → `changed == true`, both ids; start with no file, create it, 8 polls later it is watched.
- Wuchang census (skip with a printed `SKIP` when the file at the TASK.md path is absent): count lines matching
  `^ACH_[%w_]+=` under `[Achievements]` with a naive scan; `parse_ini` returns exactly the ones whose value is not `0`.
Command (in `steam-cartridges-local`): `npm test` → every suite prints its `ALL PASS` line, exit 0.

Commit phase 2.

### Phase 3 — local frontend: the observer, the provider, one settings toggle

**3.1 `steam-cartridges-local/frontend/index.tsx`** (rewrite; keep `callLocalBackend` and the queue/ready-event registration).
- Provider (Reset dialog only): `match(ctx)` → `LocalDetectFiles` has files; `getUnlocks(ctx)` → `LocalReadUnlocks`;
  `reset(ctx)` → `LocalResetUnlocks`. `name` becomes the found labels, e.g. `"Local achievements (SOVEREIGN)"`; compute it in
  `match` and keep the last value per appid. Coerce every list with `Array.isArray(x) ? x : []` (guardrail 21).
- Observer (new `frontend/observer.ts`), registered only when `typeof api.reportUnlocks === "function"` (core ≥ 1.1.0; else
  log once and do nothing):
  - `onAppViewed(ctx)`: `LocalReadUnlocks(ctx)` → if non-empty, `api.reportUnlocks(ctx.appid, unlocks, { providerId:
    "steam-cartridges-local", silent: true })`.
  - `onAppLaunched(ctx)`: if the setting is off, return. `LocalWatchStart(ctx)` → report its unlocks `silent: true` (F13: the
    first snapshot never toasts); then arm a 2 s timer that re-arms only after `LocalWatchPoll` settles (ADR-0060 pattern);
    each `changed` result is reported with `silent: false`.
  - `onAppQuit(ctx)`: stop the timer, `LocalWatchStop` → report its unlocks `silent: false`.
  - One session per appid; a second launch stops the first.
- Settings: `api.registerSettingsPanel({ id: "steam-cartridges-local", title: "Local achievements", render })` with one
  `Toggle` row "Watch while a game runs" (`watchWhilePlaying`, default `true`), built from Steam's `Field`/`Toggle` per
  guardrail 18, its own plugin config with an explicit default (guardrail 22.4).
Command: `npm run check` → exit 0; `npm run build` → exit 0 (ignore the `@steambrew/ttc` update nag).

**3.2 `steam-cartridges-local/plugin.json` `description`:** "Reads, watches and resets achievements saved by Steam API
emulators (CODEX, RUNE, GSE, Goldberg, SOVEREIGN, Online-Fix, Tenoke, SkidRow, EMPRESS, RELOADED, SmartSteamEmu, UniverseLAN)
and by Unity, Godot and Unreal game logs, for steam-cartridges." Bump `version` to `0.2.0`; add a `CHANGELOG.md` entry; README
credits PSerban93/Achievements (MIT) for the format knowledge.

Commit phase 3.

### Phase 4 — core: remove every emulator and local-game reader, then lock it

Do phase 4 only after phases 1-3 are committed (the local plugin must already cover what is removed).

**4.1 `steam-cartridges/backend/achievements_observer.lua`.**
- Header. Before:
```lua
--- Detects unlocks out-of-process from:
---   1. Local emulator saves:
---      - Goldberg (achievements.json)
---      - CODEX / RUNE / GSE (.ini formats)
---   2. Engine runtime logs:
---      - Unity (Player.log in %USERPROFILE%\AppData\LocalLow\...)
---      - Godot (godot.log in %APPDATA%\Godot\app_userdata\...)
---      - Unreal (Saved\Logs\*.log in %LOCALAPPDATA%\...)
```
  After:
```lua
--- Detects unlocks out-of-process from console emulators: their logs (RetroArch, DuckStation, PCSX2,
--- Dolphin, PPSSPP, RPCS3, shadPS4) and RPCS3 / shadPS4 trophy files. Steam API emulator saves and
--- PC-game engine logs belong to the steam-cartridges-local extension (ADR-0063).
```
- Delete, whole: `strip_shipping_suffix`, `exe_basename`, `M.get_possible_folder_names`, `M.parse_ini_achievements`,
  `M.parse_goldberg_achievements`, `M.emulator_files` (each from its `---` doc comment to its closing `end`).
- In `scan_log_for_unlocks`, delete exactly the five pattern lines quoted in step 2.7 (the line after them, `or
  line:match("[tT]rophy [uU]nlocked:...`, must still follow the `%[Achievements%]` / `[aA]chievement%s*(%d+)%s*unlocked` lines).
- In `M.log_paths`, delete from the comment line `-- Engine logs. Unreal Engine games are often shipped under an internal
  project name distinct` through the `end` that closes `if (game_title and #game_title > 0 or exe_path) and #userprofile > 0 then`.
- In `M.check_unlocks`, delete this block, and renumber the following comments 2→1, 3→2, 4→3:
```lua
  -- 1. Steam emulator INI / JSON files (if native_appid > 0)
  for _, f in ipairs(M.emulator_files(n_appid)) do
    if file_exists(f.path) then
      local content = read_file(f.path)
      if content then
        local parsed = f.path:match("%.json$")
          and M.parse_goldberg_achievements(content)
          or M.parse_ini_achievements(content)
        for id, info in pairs(parsed) do
          candidate_unlocks[id] = info
        end
      end
    end
  end
```
- `trim` stays only if still used (`resolve_canonical_item` uses `normalize`; `trim` was used by the deleted functions):
  delete it when `luajit -bl` / `test_globals.lua` reports it unused, else keep.

**4.2 `steam-cartridges/backend/achievement_files.lua`.** Header before:
```lua
---   Steam emulators  CODEX / RUNE / GSE achievements.ini: `[ACH_ID]` sections with
---                    `Achieved=1` / `UnlockTime=...`, plus a `[SteamAchievements]` list;
---                    or one `[Achievements]` map (`ACH_ID=1`).
---                    Goldberg achievements.json: an array of ids, or `{ "ID": { "earned": true, ... } }`.
```
After: (nothing; delete the four lines). Delete the sections `-- ---------- Steam emulator INI ----------` (with
`M.emu_ini_lock_all`) and `-- ---------- Goldberg JSON ----------` (with `M.goldberg_lock_all`), each through its closing `end`.

**4.3 `steam-cartridges/backend/achievements_reset.lua`.** Header line before:
```lua
---   local      Steam emulator saves (CODEX / RUNE / GSE achievements.ini, Goldberg achievements.json)
```
After: (deleted). Delete `local function emu_unlocked(path, text) ... end`. In `M.sources`, delete from `-- Steam emulator
saves: one source, named after the emulators found.` through the `end` closing `if #paths > 0 then`. In `clear_file`,
before:
```lua
  if source_id == "local" then
    if p:match("%.json$") then
      next_content, cleared, why = files.goldberg_lock_all(content, json)
    else
      next_content, cleared = files.emu_ini_lock_all(content)
    end
  elseif source_id == "rpcs3" then
```
After:
```lua
  if source_id == "rpcs3" then
```
Remove `local json = require("json")` only if nothing else in the file uses `json`.

**4.4 `steam-cartridges/backend/achievements_rpc.lua`.** Before:
```lua
--- data = { shortcut_appid, native_appid?, sources? = { "local" | "rpcs3" | "shadps4" }, title? }
```
After:
```lua
--- data = { shortcut_appid, native_appid?, sources? = { "rpcs3" | "shadps4" }, title? }
```
**4.5 `steam-cartridges/frontend/ports/backend.ts:11`.** Before:
```ts
    /** "local" (Steam emulator saves), "rpcs3", "shadps4" or "retroachievements". */
```
After:
```ts
    /** "rpcs3", "shadps4" or "retroachievements"; extension sources use the provider's id (ADR-0063). */
```
**4.6 `steam-cartridges/frontend/settings/panels/achievements.tsx:37`.** Before:
```ts
    steam_store: "Reads local emulator saves (Goldberg, CODEX, RUNE, GSE) and engine logs (Unity, Godot, Unreal).",
```
After:
```ts
    steam_store: "The achievement list and rarity of the Steam game a shortcut maps to.",
```
**4.7 `steam-cartridges/frontend/app/achievements.ts`.**
- In `load`, delete from `// Extension providers (steam-cartridges-local, etc.)` through the closing `}` of `if (part.data &&
  providers.length > 0) { ... }`, and change `let part: Part<AchievementSet> =` to `const part: Part<AchievementSet> =`.
- In `checkNow`, delete from `// Extension achievement providers (steam-cartridges-local, etc.)` through the closing `}` of
  `if (providers.length > 0) { ... }`; change `const fresh = asList<NewUnlock>(...)` stays `const` (it is no longer pushed to).
- In `resetSources`, before:
```ts
                            const existingIdx = backendSources.findIndex((s) => s.id === p.id || (s.id === "local" && p.id.includes("local")));
                            const existingSource = existingIdx >= 0 ? backendSources[existingIdx] : undefined;
                            if (existingSource) {
                                backendSources[existingIdx] = {
                                    id: "local",
                                    label: p.name || existingSource.label,
                                    resettable: true,
                                    unlocked: Math.max(existingSource.unlocked, unlocks.length),
                                };
                            } else {
                                backendSources.push({
                                    id: p.id,
                                    label: p.name,
                                    resettable: true,
                                    unlocked: unlocks.length,
                                });
                            }
```
  After:
```ts
                            if (!backendSources.some((s) => s.id === p.id)) {
                                backendSources.push({ id: p.id, label: p.name, resettable: true, unlocked: unlocks.length });
                            }
```
  and pass the native app: change `const ctx = makeAppContext(appid);` in `resetSources` and in `reset` to
  `const ctx = makeAppContext(appid, await resolveNative(appid));`.
- In `reset`, before:
```ts
                        if ((sources.includes(p.id) || (sources.includes("local") && p.id.includes("local"))) && typeof p.reset === "function") {
```
  After:
```ts
                        if (sources.includes(p.id) && typeof p.reset === "function") {
```
- Doc comment of `resetSources` in `AchievementsService`: replace "(Steam emulator saves, trophy files, RetroAchievements)"
  with "(trophy files, RetroAchievements, extensions)".
- `kernel/record.ts:78` and `domain/category-policy.ts:58`: replace "local emulator saves" with "achievement extensions".

**4.8 Tests.**
- `tests/test_achievements_reset.lua`: delete the Goldberg JSON section (`-- ---------- Goldberg JSON ----------` through the
  `goldberg object` check), any `emu_ini_lock_all` cases, and the block from `local emu_ini = TMP .. "/achievements.ini"` through
  the checks that use `{ "local" }`. Record the new count it prints (`N passed, 0 failed`, N < 34) in the commit message.
- `tests/test_backend.lua:326-360` and `tests/test_ach_service.lua:380-386`: delete the `get_possible_folder_names` sections
  (moved in 2.10).
- `tests/app-achievements.test.ts`: in the `setup` helper, the fixtures `{ id: 'local', ok: true, cleared: 2 }` and
  `{ id: 'local', label: 'local achievements (RUNE)', resettable: true, unlocked: 2 }` become `{ id: 'rpcs3', ... }` and
  `{ id: 'rpcs3', label: 'RPCS3 achievements', resettable: true, unlocked: 2 }`; the test at :171 expects `['rpcs3']`.
  Rewrite the test at :376 ("extension achievement provider contributes unlocks…") under ADR-0063: part 1 asserts `ensure`
  does **not** call `getUnlocks` (record unlocks `{}`); part 2 asserts `checkNow` does not call it either (count calls), then
  that `ach.ingestExternal(SC, [{id:'B', unlockedAt: 67890}], {providerId:'x'})` records `B` at 67890 and emits ids `['B']`;
  parts 3-4 keep their assertions. Same test count.
- New, `tests/architecture.test.ts`, one test **"core names no Steam API emulator (ADR-0063)"**: read every file under
  `frontend/`, `backend/`, `tests/` (skip `node_modules`, `.millennium`, `_lib`), plus `README.md` and `plugin.json`; fail on
  `/\b(rune|codex|skid ?row|empress|reloaded|rld!|sovereign|goldberg|gse|smartsteamemu|online-?fix|tenoke|universelan)\b/i`,
  listing `file:line`. The regex has no hit at `6661a21` outside the code this phase removes (checked 2026-10-08). The test
  file itself must hold the words only inside that one regex literal: exclude `tests/architecture.test.ts` from the scan.

Commands (in `steam-cartridges`):
- `npm run check` → exit 0.
- `npm run test:ts` → `ℹ pass 346` / `ℹ fail 0` (345 + the architecture test).
- `NSGA_STEAM_ROOT=C:/game/steam npm run test:lua` → every suite `ALL PASS` (including `test_globals.lua`: no global read).
- `NSGA_STEAM_ROOT=C:/game/steam lua tests/test_achievements_reset.lua` → `N passed, 0 failed`.
- `grep -rniE "\b(rune|codex|skid ?row|empress|reloaded|rld!|sovereign|goldberg|gse|smartsteamemu|online-?fix|tenoke|universelan)\b" frontend backend tests README.md plugin.json | grep -v node_modules | grep -v architecture.test.ts` → no output.

Commit phase 4.

### Phase 5 — docs

- `docs/decisions.md`: append § 5's ADR-0063; in ADR-0054's status line add "· **Superseded in part by ADR-0063**".
- `docs/steam-cartridges-local.md`: rewrite §§ 2-5 for the layout of phase 2, the formats table (F1-F7 with one example each),
  discovery (game folder, ids, roots, layouts), the watcher (start / poll / stop, late files, silent first snapshot), the
  push contract, the RPC list, credits to PSerban93/Achievements.
- `docs/steam-cartridges.md:42`: "Steam API emulator saves and PC-game logs: discovery, watching, reset (ADR-0063)."; § 1
  extension list gains the `reportUnlocks` / `onAppLaunched` line.
- `docs/steam-cartridges/service-achievements.md`: line 88 drops "Steam emulator INI / Goldberg JSON"; the `local` row of
  the reset-sources table (line 125) becomes "extension sources: the provider's id, its own reset (ADR-0063)"; the section at
  lines 299-301 and the test line 427 are removed or pointed at steam-cartridges-local.md.
- `docs/steam-cartridges/kernel.md` (Extension API): `AppContext` fields, `onAppLaunched`, `reportUnlocks`, version 1.1.0.
- `CHANGELOG.md` (workspace) and both plugins' `CHANGELOG.md`; `TASK.md`: move the entry from *Next* to *Now* with the state.

Commit phase 5.

### Phase 6 (optional, own plan each) — core improvements from the repo, console emulators and metadata only

- **6a Steam appcache schema** (F14): read `<steam>/appcache/stats/UserGameStatsSchema_<native>.bin` (binary KeyValues: types
  `0x00` map, `0x01` string, `0x02` int32, `0x08` end; port `parseKVBinary` and `extractSchemaAchievements` from
  `utils/steam-appcache.js`) as the first tier of `steam_schema.get_or_fetch`, giving exact API ids, names and descriptions;
  WebAPI still supplies `global_pct`, joined **by id**, not by index. Census test against this machine's 267 files.
- **6b Xenia GPD** (F15, `utils/xenia-gpd.js`) as a new achievements source behind `ach_service`.
- **6c shadPS4 modern layout** (F15): check `ps4_trophies.find_save_files` against `%APPDATA%/shadPS4/home/<userId>/trophy/<NPWR>.xml`
  and `trophy/<NPWR>/Xml`; closes the TASK.md "untested on real files" item when a real file exists.

### Phase 7 (optional, own plan each) — local plugin follow-ups

- **7a Progress**: Online-Fix `Stats.ini` and Tenoke `[STATS]` mapped through the schema's progress rules; needs a core record
  field for progress first (a core plan; Steam renders progress bars itself).
- **7b SOVEREIGN comment schema**: the `; Name: Description` comments as `getSchema` when the core has no Steam mapping; needs
  the core to read `getSchema` (today unused).
- **7c Suggest a mapping**: an appid found in the game folder (2.5) while the shortcut has none, shown in the Review panel.
- **7d** Uplay / GOG / Epic emulators: only with a non-Steam schema source.

---

## 7. Do not touch

- `steam-cartridges/backend/ps3_trophies.lua`, `ps4_trophies.lua`, `retroachievements.lua`, `ra_cache.lua`,
  `steam_schema.lua` (until phase 6), `store_achievements.lua`, `ach_service.lua`, `achievements_store.lua`.
- The RetroArch / DuckStation / PCSX2 / Dolphin / PPSSPP / RPCS3 / shadPS4 parts of `achievements_observer.lua`
  (`newest_retroarch_log`, `retroarch_log_dirs`, the emulator paths in `log_paths`, `trophy_files`, `mark_logs_read`,
  `resolve_canonical_item`, the RCHEEVOS / trophy patterns).
- `steam-cartridges/frontend/surfaces/**` (the `"local"` in `surfaces/achievements/core.ts` / `store.ts` means "ours", not an
  emulator), `tests/architecture.test.ts` allowlists, `settings-defaults.ts` (no provider keys, guardrail 22.3).
- `steam-cartridges-third-party/**`, `steam-captured-activity/**`, `enhanced-notifications/**`.
- The user's `SOVEREIGN.ini` and every real save file: tests use copies in `%TEMP%` only.

## 8. Banned actions

No deploy or Steam restart (`dev.ps1`, `start-steam-dev.ps1`) before § 9; no SharedJSContext reload; no probe or throwaway
plugins; no edits to Millennium's `config.json` or plugin config; no changes to the user's library, collections or shortcuts;
no writes to any real emulator save (only `%TEMP%` copies); no `npm install`/upgrade (ignore the `@steambrew/ttc` nag); no
`git push --force`; no `--no-verify`; never widen an architecture allowlist; never weaken a test to pass (guardrail 15: the
only test whose expectation changes is the one ADR-0063 changes, step 4.8).

**Failure rule:** run a failing command at most twice. On the second failure stop, append the command, its output (30 lines
max) and the step number to `TASK.md` § Active failures & blockers, commit nothing of the failing phase, and exit.

## 9. Guardrail checklist (re-read each, tick "not violated" with one line of proof)

- [ ] 14 — no gate hides data that was shown: emulator unlocks already in `achievements.json` stay; new ones arrive by push.
- [ ] 15 — the only changed expectation is the provider test, under ADR-0063.
- [ ] 17 — nothing in a render starts work: notifications come from the bus (`shortcut.viewed/launched/quit`), never a render.
- [ ] 20 — every new Lua module `require`s `fs`/`json`/`logger`/`millennium`; `test_globals.lua` passes in both plugins.
- [ ] 21 — every RPC list goes through `as_array`; every frontend list through `Array.isArray`; empty-list tests exist.
- [ ] 22 — the local settings panel has defaults and optional chaining; the core panel is untouched.
- [ ] plugins.md § Layout — no plugin reads another's folder or data file (the `steam_store.json` read is gone).
- [ ] ADR-0011 — no hardcoded Steam path or user id in `steam-cartridges-local`.

## 10. Commits

One commit per phase, from the workspace root, adding only that phase's files, for example phase 1:
```bash
git add steam-cartridges/frontend/kernel/extensions.ts steam-cartridges/frontend/domain/achievement-ids.ts \
        steam-cartridges/frontend/app/achievements.ts steam-cartridges/frontend/index.tsx \
        steam-cartridges/tests/achievement-ids.test.ts steam-cartridges/tests/app-achievements.test.ts
git commit -m "steam-cartridges: extensions push unlocks (reportUnlocks, onAppLaunched, AppContext native and ids)"
```
Messages: phase 2 `steam-cartridges-local: correct emulator readers, own discovery and session watcher`; phase 3
`steam-cartridges-local: background observer and settings toggle`; phase 4 `steam-cartridges: remove Steam API emulator and
engine-log readers (ADR-0063)`; phase 5 `docs: ADR-0063 and the local plugin's architecture`. **No AI attribution line of any
kind** (AGENTS.md Routine 6). Push with `git push origin main` after phase 5 (Routine 5).

## 11. Live verification (after phase 5; the verifier holds the Steam lock for the whole sequence)

```bash
node steam-lock.mjs acquire --owner local-split-<hhmm> --purpose "steam-cartridges + -local: deploy + verify ADR-0063"
STEAM_LOCK_OWNER=local-split-<hhmm> powershell -ExecutionPolicy Bypass -File steam-cartridges/dev.ps1 -NoRestart
STEAM_LOCK_OWNER=local-split-<hhmm> powershell -ExecutionPolicy Bypass -File steam-cartridges-local/dev.ps1
```
Expected PASS lines:
1. `node steam-health.mjs --wait 120` → PASS, both plugins in `PLUGIN_LIST`.
2. `cd steam-cartridges && npm run test:live` → all pass (Routines 1-3: four views, A → B → A, `count_cycle.mjs` `PASS render loop`).
3. Over CDP in SharedJSContext: `window.SteamCartridges.version === "1.1.0"` and `typeof window.SteamCartridges.reportUnlocks === "function"`.
4. Wuchang (shortcut `3135033888`): open its page; the Millennium log shows one `LocalReadUnlocks` and, when the file has
   unlocks, `steam-cartridges-local reported N new unlock(s)` once, then never again on a second view (dedup).
5. Reset dialog for Wuchang lists `Local achievements (SOVEREIGN)` under id `steam-cartridges-local`; a reset with it on
   leaves `SOVEREIGN.ini.bak-<time>` next to the file. **Ask the user before running a real reset.**
6. By the user (real play): launch Wuchang from Steam, earn one achievement; within ~4 s Steam's toast shows it once; quit;
   the Post-Game Summary lists it. No toast for unlocks that were already in the file at launch.
7. Disable `steam-cartridges-local`, restart: Wuchang's page still shows the achievements already recorded (guardrail 14).
Then `node steam-lock.mjs release --owner local-split-<hhmm>`.
