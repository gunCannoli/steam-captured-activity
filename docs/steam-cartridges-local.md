# steam-cartridges-local — plugin architecture

**This doc's job:** the architecture, file layout, format specifications, and integration contract for the `steam-cartridges-local` expansion plugin.

`steam-cartridges-local` is an optional Millennium plugin that extends `steam-cartridges`. It parses, monitors, and safely resets local achievements from Steam API emulator saves (`achievements.ini` and `achievements.json`) used by offline and standalone setups (CODEX, RUNE, GSE, Goldberg).

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
  │  • Parses CODEX / RUNE / GSE / Goldberg local files    │
  │  • Scans %PUBLIC% and %APPDATA% for target saves       │
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
│   ├── ini_parser.lua          # Format A & Format B achievements.ini parser
│   ├── goldberg_parser.lua     # Goldberg achievements.json parser
│   ├── file_search.lua         # Candidate paths search across %PUBLIC% and %APPDATA%
│   ├── file_reset.lua          # Safe rewrite & backup creation
│   └── _lib/                   # Millennium runtime type stubs
├── frontend/
│   └── index.tsx               # Registers with window.SteamCartridges
└── tests/
    ├── harness.lua             # Lightweight Lua test harness
    └── test_ini_parser.lua     # Unit tests for INI and Goldberg parsing
```

---

## 3. Supported File Formats & Path Discovery

### 3.1 Path Discovery (`backend/file_search.lua`)
For a numeric Steam AppID, searches:
- `%PUBLIC%\Documents\Steam\CODEX\<appid>\achievements.ini` (CODEX)
- `%APPDATA%\Steam\CODEX\<appid>\achievements.ini` (CODEX)
- `%PUBLIC%\Documents\Steam\RUNE\<appid>\achievements.ini` (RUNE)
- `%APPDATA%\Steam\RUNE\<appid>\achievements.ini` (RUNE)
- `%PUBLIC%\Documents\Steam\<appid>\achievements.ini` (GSE / SmartSteamEmu)
- `%APPDATA%\Steam\<appid>\achievements.ini` (GSE / SmartSteamEmu)
- `%APPDATA%\Goldberg SteamEmu Saves\<appid>\achievements.json` (Goldberg)

### 3.2 INI Formats (`backend/ini_parser.lua`)
- **Format A (Section per achievement):**
  ```ini
  [ACHIEVEMENT_01]
  Achieved=1
  UnlockTime=1720000000
  ```
- **Format B (Map within section):**
  ```ini
  [Achievements]
  ACHIEVEMENT_01=1
  ACHIEVEMENT_02=0
  ```
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
2. A backup file is created in the same directory: `<filename>.bak-<YYYYmmdd-HHMMSS>`.
3. Unlock flags are zeroed (`Achieved=0`, `UnlockTime=0`, or `earned: false`). Sections and custom keys remain intact.
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
        const res = await callLocalBackend<{ files: any[] }>("LocalDetectFiles", { appid: ctx.appid });
        return Array.isArray(res?.files) && res.files.length > 0;
    },
    async getUnlocks(ctx: AppContext): Promise<AchievementUnlockItem[]> {
        const res = await callLocalBackend<{ unlocks: any[] }>("LocalReadUnlocks", { appid: ctx.appid });
        if (!res || !Array.isArray(res.unlocks)) return [];
        return res.unlocks.map((u: any) => ({
            id: String(u.id),
            unlockedAt: Number(u.unlockedAt) || Math.floor(Date.now() / 1000),
        }));
    },
    async reset(ctx: AppContext): Promise<{ cleared: number; ok: boolean; backupPath?: string }> {
        const res = await callLocalBackend<{ ok: boolean; cleared: number; backupPath?: string }>("LocalResetUnlocks", { appid: ctx.appid });
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
  luajit tests/test_ini_parser.lua
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
