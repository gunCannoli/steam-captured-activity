# steam-cartridges-local — plugin architecture

**This doc's job:** the architecture, file layout, format specifications, and integration contract for the `steam-cartridges-local` expansion plugin.

`steam-cartridges-local` is an optional Millennium plugin that extends `steam-cartridges`. It parses, monitors, and safely resets local achievements from Steam API emulator saves (`achievements.ini`, `SOVEREIGN.ini`, `Stats.ini`, `user_stats.ini`, and `achievements.json`) used by offline and standalone setups (CODEX, RUNE, GSE, Goldberg, SOVEREIGN, OnlineFix, Tenoke, SkidRow, EMPRESS, RELOADED, UniverseLAN).

---

## 1. Role in the Suite

```
  ┌────────────────────────────────────────────────────────┐
  │                 steam-cartridges (CORE)                │
  │                                                        │
  │  • Restores Steam app detail sections                  │
  │  • Feeds Steam's achievement stores & notification UI   │
  │  • Exposes window.SteamCartridges Extension Registry   │
  └───────────────────────────▲────────────────────────────┘
                              │ registers LocalAchievementProvider
  ┌───────────────────────────┴────────────────────────────┐
  │              steam-cartridges-local                    │
  │                                                        │
  │  • Parses CODEX, RUNE, GSE, Goldberg, SOVEREIGN saves  │
  │  • Supports OnlineFix, Tenoke, SkidRow, UniverseLAN    │
  │  • Scans game folders, %PUBLIC% and %APPDATA% saves    │
  │  • Handles UTF-16LE, UTF-8 BOM, and comments           │
  │  • Safe reset with automatic timestamped .bak backups  │
  │  • Test reference game: WUCHANG: Fallen Feathers       │
  └────────────────────────────────────────────────────────┘
```

The core `steam-cartridges` functions fully without this plugin (ADR-0012). When installed, `steam-cartridges-local` contributes achievement unlocks and safe file reset capabilities into core's unified achievement pipeline.

---

## 2. Directory Structure

```
steam-cartridges-local/
├── plugin.json                 # Millennium manifest ("steam-cartridges-local")
├── package.json                # Dependencies (@steambrew/client, @steambrew/ttc)
├── tsconfig.json               # TypeScript configuration
├── dev.ps1                     # Local deployment script
├── backend/
│   ├── main.lua                # RPC endpoints: LocalDetectFiles, LocalReadUnlocks, LocalResetUnlocks
│   ├── ini_parser.lua          # Format A & Format B parser with UTF-16LE, timestamps & comments
│   ├── goldberg_parser.lua     # Goldberg achievements.json parser
│   ├── file_search.lua         # Candidate paths search across game trees, %PUBLIC%, %APPDATA% & shortcuts.vdf
│   ├── file_reset.lua          # Safe rewrite & backup creation
│   └── _lib/                   # Millennium runtime type stubs
├── frontend/
│   └── index.tsx               # Registers with window.SteamCartridges
└── tests/
    ├── harness.lua             # Lightweight Lua test harness
    ├── test_ini_parser.lua     # Unit tests for INI, SOVEREIGN, and Goldberg parsing
    └── test_file_search.lua    # Unit tests for game tree and shortcut path discovery
```

---

## 3. Supported File Formats & Path Discovery

### 3.1 Path Discovery (`backend/file_search.lua`)

#### A. In-Game Directory Traversal (SOVEREIGN / Tenoke / OnlineFix / UniverseLAN)
When passed an executable path or shortcut AppID, the plugin inspects `shortcuts.vdf` and traverses upward from the executable directory across parent folders up to the game root, scanning:
- `<game_root>\SOVEREIGN.ini` / `<exe_dir>\SOVEREIGN.ini`
- `<game_root>\Engine\Binaries\ThirdParty\Steamworks\<version>\Win64\SOVEREIGN.ini` (Unreal Engine Steamworks layout, e.g. WUCHANG)
- `<game_root>\Binaries\Win64\SOVEREIGN.ini` / `user_stats.ini` / `Stats.ini`
- `<game_root>\user_stats.ini` (Tenoke)
- `<game_root>\Stats.ini` / `<game_root>\achievements.ini` (Online-Fix)
- `<game_root>\UniverseLANData\Achievements.ini` (UniverseLAN)

Discovered INIs are validated by checking `[Game] AppID` against the requested Steam AppID or shortcut mapping.

#### B. Global User Profile Directories
Searches by numeric Steam AppID across `%PUBLIC%\Documents` and `%APPDATA%`:
- `%PUBLIC%\Documents\Steam\CODEX\<appid>\achievements.ini` (CODEX)
- `%APPDATA%\Steam\CODEX\<appid>\achievements.ini` (CODEX)
- `%PUBLIC%\Documents\Steam\RUNE\<appid>\achievements.ini` (RUNE)
- `%APPDATA%\Steam\RUNE\<appid>\achievements.ini` (RUNE)
- `%PUBLIC%\Documents\Steam\RLD!\<appid>\achievements.ini` (RELOADED)
- `%APPDATA%\Steam\RLD!\<appid>\achievements.ini` (RELOADED)
- `%PUBLIC%\Documents\Steam\<appid>\achievements.ini` (GSE / SmartSteamEmu)
- `%APPDATA%\Steam\<appid>\achievements.ini` (GSE / SmartSteamEmu)
- `%PUBLIC%\Documents\SmartSteamEmu\<appid>\achievements.ini` (SmartSteamEmu)
- `%APPDATA%\GSE Saves\<appid>\achievements.ini` (GSE)
- `%APPDATA%\Goldberg SteamEmu Saves\<appid>\achievements.json` (Goldberg)
- `%PUBLIC%\Documents\OnlineFix\<appid>\achievements.ini` & `Stats.ini` (OnlineFix)
- `%APPDATA%\OnlineFix\<appid>\achievements.ini` & `Stats.ini` (OnlineFix)
- `%APPDATA%\SkidRow\<appid>\achievements.ini` (SkidRow)
- `%PUBLIC%\Documents\EMPRESS\<appid>\achievements.ini` (EMPRESS)
- `%APPDATA%\SOVEREIGN\Storage\SOVEREIGN\<appid>\SOVEREIGN.ini` (SOVEREIGN)

### 3.2 INI Formats & Encoding (`backend/ini_parser.lua`)

- **Encoding Support:** UTF-8, UTF-8 with BOM, UTF-16LE with BOM (`0xFF 0xFE`), UTF-16BE with BOM (`0xFE 0xFF`).
- **Format A (Section per achievement — CODEX / OnlineFix / Tenoke):**
  ```ini
  [ACHIEVEMENT_01]
  Achieved=1
  UnlockTime=1720000000
  CurProgress=10
  MaxProgress=10
  ```
  Accepts `Achieved`, `Earned`, `Unlocked`, `State` (`1`, `true`, `yes`). Progress completion (`CurProgress >= MaxProgress`) also unlocks the achievement.
- **Format B (Map within section — SOVEREIGN / RUNE / UniverseLAN):**
  ```ini
  [Game]
  AppID=2277560

  [Achievements]
  ; Fallen Feathers: Earn all achievements
  ACH_PLATINUM_01_F=0
  ACH_GOLDEN_01_F=1
  ACH_SILVER_01_F=1750000000
  ```
  Values can be `0` (locked), `1` / `true` / `yes` (unlocked), or an explicit Unix timestamp integer (`> 1`). Comments starting with `;` or `#` are safely skipped during parsing and preserved during resets.
- **SteamAchievements section:**
  ```ini
  [SteamAchievements]
  Count=1
  0=ACHIEVEMENT_01
  ```

### 3.3 Goldberg JSON (`backend/goldberg_parser.lua`)
- **Array form:**
  ```json
  [ "ACHIEVEMENT_01", "ACHIEVEMENT_02" ]
  ```
- **Object form:**
  ```json
  {
    "ACHIEVEMENT_01": { "earned": true, "earned_time": 1720000000 }
  }
  ```

---

## 4. Reset & Backup Mechanism (`backend/file_reset.lua`)

When the user requests an achievement reset:
1. The target file is verified and read into memory.
2. A backup file is created in the same directory: `<filename>.bak-<timestamp>` (e.g. `SOVEREIGN.ini.bak-1791433053`).
3. Unlock flags are zeroed (`Achieved=0`, `UnlockTime=0`, `ACH_ID=0`, or `earned: false`). Sections, comments, DLC definitions, and custom keys remain intact.
4. The file is atomically rewritten.
5. Returns `{ ok: true, cleared: <count>, backupPath: <path> }`.

---

## 5. Extension API Registration (`frontend/index.tsx`)

`steam-cartridges-local` connects to `steam-cartridges` through CEF `SharedJSContext`:

```typescript
const localProvider = {
    id: "steam-cartridges-local",
    name: "Local Steam Emulators (.ini / .json)",
    priority: 15,
    async match(ctx: AppContext): Promise<boolean> {
        if (!ctx.isShortcut) return false;
        const res = await callLocalBackend<{ files: any[] }>("LocalDetectFiles", {
            appid: ctx.appid,
            exe: ctx.exe,
            displayName: ctx.displayName,
        });
        return Array.isArray(res?.files) && res.files.length > 0;
    },
    async getUnlocks(ctx: AppContext): Promise<AchievementUnlockItem[]> {
        const res = await callLocalBackend<{ unlocks: any[] }>("LocalReadUnlocks", {
            appid: ctx.appid,
            exe: ctx.exe,
            displayName: ctx.displayName,
        });
        if (!res || !Array.isArray(res.unlocks)) return [];
        return res.unlocks.map((u: any) => ({
            id: String(u.id),
            unlockedAt: Number(u.unlockedAt) || Math.floor(Date.now() / 1000),
        }));
    },
    async reset(ctx: AppContext): Promise<{ cleared: number; ok: boolean; backupPath?: string }> {
        const res = await callLocalBackend<{ ok: boolean; cleared: number; backupPath?: string }>("LocalResetUnlocks", {
            appid: ctx.appid,
            exe: ctx.exe,
            displayName: ctx.displayName,
        });
        return {
            ok: res?.ok ?? false,
            cleared: res?.cleared ?? 0,
            backupPath: res?.backupPath,
        };
    },
};
```

If `window.SteamCartridges` is not yet available, registrations are pushed to `window.__STEAM_CARTRIDGES_QUEUE__` and finalized when core boots.

---

## 6. Testing & Building

- **Backend tests:**
  ```bash
  lua tests/test_ini_parser.lua
  lua tests/test_file_search.lua
  ```
- **Frontend check & build:**
  ```bash
  npm run check
  npm run build
  ```
- **Live deploy:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File dev.ps1 -NoRestart
  ```
