# steam-cartridges Extension System, Expansions & Universal Captured Activity Plan

**Status (2026-10-06):** Plan drafted for architectural review.
**Scope:** 
1. Decoupling `steam-cartridges` into a modular core with a typed Extension / Expansion API system.
2. Extracting local Steam API emulators (.ini/text files: CODEX, RUNE, GSE, Goldberg) into `steam-cartridges-local`.
3. Extracting third-party stores (Epic Games & Xbox: discovery, auto-add, achievements, metadata, launcher tracking) into `steam-cartridges-third-party`.
4. Extending Captured Activity (16:9 cards, clip players, `{Username} captured` headline) to work universally on **both native Steam games and non-Steam shortcuts**.

---

## 1. Context & Architectural Goals

### 1.1 The Problem
Today, `steam-cartridges` contains a growing set of specialized integrations bundled directly into the core plugin:
- **Local Steam emulator achievements**: parses `.ini` and `.json` files from `%PUBLIC%\Documents\Steam\...` and `%APPDATA%\...` for CODEX, RUNE, GSE, Goldberg, and engine logs (`achievements_observer.lua`, `achievement_files.lua`, `achievements_reset.lua`).
- **Third-party storefront integrations**: scans Epic manifests and Xbox UWP packages, manages Microsoft OAuth/tokens, calls Epic GraphQL and Xbox Live APIs, injects shortcuts into Steam, and monitors launch processes (`store_*.lua`, `epic_*.lua`, `xbox_*.lua`, `app/store-sync.ts`, `app/epic-launcher.ts`, `settings/panels/third-party.tsx`).
- **Captured Activity is restricted to non-Steam shortcuts**: the Activity Feed injection (`publishActivity`), custom 16:9 cards (`activity-cards.ts`), and headline refinement (`headline.ts`) gate strictly on `bIsNonSteam` or `isShortcutAppId`. Native Steam games with local screenshots or video clips do not show them in the Activity Feed unless uploaded to Steam Community (which displays UGC phrasing like "shared 2 screenshots").

### 1.2 Core Architectural Principles
1. **Core Works Standalone (ADR-0012):** `steam-cartridges` must remain 100% useful without any expansion plugin installed. It owns Steam app detail page restoration, Steam's native captures, the Extension Registry, and store feeding.
2. **Extensions Return Data; Core Renders (ADR-0013):** Expansion plugins contribute data through typed interfaces. The core renders into Steam's own stores (`AppDetailsStore`, `appActivityStore`, `AppSpotlightStore`, `StoreItemCache`).
3. **Fail-Silent Isolation (ADR-0014):** A broken, disabled, or hanging expansion must never degrade the Steam UI or cause host crashes (`0xC0000005`).
4. **Universal Library Consistency:** User-captured screenshots and clips should be treated as first-class activity events across the player's entire library, whether playing *Elden Ring* (native Steam) or *WUCHANG: Fallen Feathers* / *AM2R* (non-Steam).

```
                            ┌───────────────────────────────────────────────┐
                            │           steam-cartridges (CORE)             │
                            │                                               │
                            │  • Restores Steam app detail sections         │
                            │  • Feeds Steam's screenshots + video clips    │
                            │  • Universal Captured Activity (native + non) │
                            │  • Global Extension Registry (SharedJS)       │
                            │  • Dynamic Settings Panel Shell               │
                            └───────┬───────────────────────────────┬───────┘
                                    │ window.SteamCartridges        │
                  ┌─────────────────┴───────────────┐               │
                  ▼                                 ▼               ▼
        ┌───────────────────────┐       ┌───────────────────────┐  ┌───────────────────┐
        │ steam-cartridges-local│       │ steam-cartridges-     │  │ (Future:          │
        │                       │       │ third-party           │  │  retroachieve-    │
        │ • CODEX / RUNE / GSE  │       │                       │  │  ments,           │
        │   achievements.ini    │       │ • Epic / Xbox install │  │  screenscraper)   │
        │ • Goldberg saves      │       │   games discovery     │  └───────────────────┘
        │ • Reset & backup ini  │       │ • Auto-add shortcuts  │
        │ • Wuchang reference   │       │ • Store achievements  │
        └───────────────────────┘       │ • Epic overlay hook   │
                                        │ • Third-party setting │
                                        └───────────────────────┘
```

---

## 2. Pillar 1 — The Extension API System (`steam-cartridges` Core)

### 2.1 The Shared Frontend Registry (`window.SteamCartridges`)
In Millennium, all plugins execute frontend code within CEF's `SharedJSContext`. The core exposes an idempotent, typed API on `window.SteamCartridges`:

```typescript
// frontend/kernel/extensions.ts

export interface AppContext {
  appid: number;
  gameid: string;
  isShortcut: boolean;
  displayName: string;
  exe?: string;
  launchOptions?: string;
}

export interface AchievementSchemaItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedIcon?: string;
  hidden?: boolean;
}

export interface AchievementUnlockItem {
  id: string;
  unlockedAt: number; // unix timestamp
}

export interface AchievementSourceProvider {
  id: string;
  name: string;
  priority?: number;
  match(context: AppContext): Promise<boolean> | boolean;
  getSchema?(context: AppContext): Promise<AchievementSchemaItem[] | null>;
  getUnlocks(context: AppContext): Promise<AchievementUnlockItem[]>;
  reset?(context: AppContext): Promise<{ cleared: number; ok: boolean; backupPath?: string }>;
}

export interface InstalledGame {
  store: 'epic' | 'xbox';
  id: string;
  title: string;
  installPath: string;
  executable: string;
  launchUri?: string;
  iconUrl?: string;
}

export interface LibrarySourceProvider {
  id: string;
  name: string;
  getInstalledGames(): Promise<InstalledGame[]>;
  onBeforeLaunch?(context: AppContext): Promise<{ cancel?: boolean }>;
  onAfterQuit?(context: AppContext): Promise<void>;
}

export interface SettingsPanelExtension {
  id: string;
  title: string;
  order?: number;
  render: () => React.ReactElement;
}

export interface SteamCartridgesAPI {
  version: string;
  registerAchievementProvider(provider: AchievementSourceProvider): () => void;
  registerLibraryProvider(provider: LibrarySourceProvider): () => void;
  registerSettingsPanel(panel: SettingsPanelExtension): () => void;
  registerSummaryProvider(provider: SummaryProvider): () => void;
  
  // Querying providers (used by core app layer)
  getAchievementProviders(): AchievementSourceProvider[];
  getLibraryProviders(): LibrarySourceProvider[];
  getSettingsPanels(): SettingsPanelExtension[];
  
  // Navigation & Lifecycle signals
  onAppViewed(cb: (context: AppContext) => void): () => void;
  onAppQuit(cb: (context: AppContext) => void): () => void;
}
```

### 2.2 Safe Load-Order Handling
Millennium does not guarantee the initialization order of plugins. To avoid race conditions:
1. `window.SteamCartridges` is initialized immediately upon core startup.
2. If an extension loads *before* `steam-cartridges`, it registers into a queue: `window.__STEAM_CARTRIDGES_QUEUE__ = window.__STEAM_CARTRIDGES_QUEUE__ || []`.
3. When `steam-cartridges` initializes, it flushes the queue and dispatches `window.dispatchEvent(new CustomEvent('steam-cartridges:ready'))`.

### 2.3 Dynamic Settings Panel Integration
In `steam-cartridges/frontend/settings/panel.tsx`, replace the hardcoded `<ThirdPartySettings>` panel with dynamic rendering of contributed settings panels:
```tsx
// Inside SettingsModal:
{SteamCartridges.getSettingsPanels()
  .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
  .map(panel => (
    <PanelSection key={panel.id} title={panel.title}>
      {panel.render()}
    </PanelSection>
  ))}
```

---

## 3. Pillar 2 — `steam-cartridges-local` Expansion Plugin

### 3.1 Scope & Purpose
Carries all offline/local Steam API emulator achievement parsing, monitoring, and reset capabilities:
- **Formats supported:**
  - CODEX: `achievements.ini` (Format A & B) in `%PUBLIC%\Documents\Steam\CODEX\<appid>\` and `%APPDATA%\Steam\CODEX\<appid>\`.
  - RUNE: `achievements.ini` in `%PUBLIC%\Documents\Steam\RUNE\<appid>\` and `%APPDATA%\Steam\RUNE\<appid>\`.
  - GSE (GreenLuma / SmartSteamEmu / generic): `achievements.ini` in `%PUBLIC%\Documents\Steam\<appid>\` and `%APPDATA%\Steam\<appid>\`.
  - Goldberg SteamEmu: `achievements.json` in `%APPDATA%\Goldberg SteamEmu Saves\<appid>\`.
- **Reference Game:**
  - *WUCHANG: Fallen Feathers* (`Project_Plague`, Steam AppID 2811880, RUNE/CODEX local `.ini`).
- **Reset functionality:**
  - Supports zeroing unlocks in `.ini`/`.json` with automatic backup file creation (`.bak-<timestamp>`).

### 3.2 Structure
```
steam-cartridges-local/
├── plugin.json
├── dev.ps1
├── package.json
├── tsconfig.json
├── backend/
│   ├── main.lua                 # RPC endpoints: Detect, ReadUnlocks, Reset
│   ├── ini_parser.lua           # Format A & B ini parser
│   ├── goldberg_parser.lua      # JSON save parser
│   ├── file_search.lua          # Path resolution (Public/AppData)
│   └── file_reset.lua           # Safe file rewrite with backup
├── frontend/
│   ├── index.tsx                # Registers with window.SteamCartridges
│   └── adapter.ts               # Calls local backend RPC via Millennium.callServerMethod
└── tests/
    ├── test_ini_parser.lua
    └── adapter.test.ts
```

### 3.3 Backend RPC Endpoints
- `LocalDetectFiles(appid: number)`: Returns existing `.ini`/`.json` file paths and detected emulator type (`"RUNE"`, `"CODEX"`, `"GSE"`, `"Goldberg"`).
- `LocalReadUnlocks(appid: number)`: Reads the file and returns `{ id: string, unlockedAt: number }[]`.
- `LocalResetUnlocks(appid: number, targetPath: string)`: Creates backup and locks all achievements.

---

## 4. Pillar 3 — `steam-cartridges-third-party` Expansion Plugin

### 4.1 Scope & Purpose
Carries all external storefront integrations:
- **Epic Games Store:**
  - Reads `.item` manifests in `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\`.
  - Fetches Epic GraphQL catalog metadata and artwork.
  - Epic user achievements and unlock timestamps synchronization.
  - Epic Steam Overlay Workaround (dashed launch URLs, launcher process reaper, ADR-0057).
- **Xbox / Microsoft Store / Game Pass:**
  - Discovers installed UWP packages (`shell:AppsFolder\...`) and WindowsApps.
  - Xbox Live authentication (MS code flow popup) and Gamertag profile.
  - Xbox Live achievements and unlock timestamps synchronization.
  - Xbox UWP launcher tracking (ADR-0058).
- **Library Sync & Auto-Add:**
  - Periodically detects newly installed games and invokes Steam shortcut creation (`AddShortcut`).
  - Title and executable matching to prevent duplicate shortcuts.
- **Third-Party Settings Panel:**
  - Contributes the "Third-party" tab to Steam Cartridges settings dialog.

### 4.2 Structure
```
steam-cartridges-third-party/
├── plugin.json
├── dev.ps1
├── package.json
├── tsconfig.json
├── backend/
│   ├── main.lua                 # RPC endpoints for Epic & Xbox
│   ├── store_service.lua        # Unified store scanning
│   ├── store_epic_local.lua     # Epic manifest reader
│   ├── epic_graphql.lua         # Epic GraphQL API
│   ├── store_xbox_local.lua     # Xbox UWP registry & manifest reader
│   ├── xbox_live.lua            # Xbox Live OAuth & achievements API
│   ├── xbox_catalog.lua         # Xbox store catalog
│   ├── store_achievements.lua   # Achievement syncing
│   └── store_launch.lua         # Launcher process hooks & tracking
├── frontend/
│   ├── index.tsx                # Registers LibraryProvider, AchievementProvider, SettingsPanel
│   ├── epic-launcher.ts         # Overlay workaround watcher
│   ├── store-sync.ts            # 60s background install scanner
│   └── settings/
│       └── third-party.tsx      # Third-party settings UI
└── tests/
```

---

## 5. Pillar 4 — Universal Captured Activity (Native & Non-Steam Games)

### 5.1 The Vision
Steam's native Activity Feed only shows community announcements, friend uploads, and developer patch notes. Local screenshots and game recordings captured by the player are hidden from the native game's Activity Feed unless manually uploaded to Steam Community (which displays "shared X screenshots").

We generalize the "Captured" Activity Feed feature:
- Works on **both native Steam games and non-Steam shortcuts**.
- Aggregates the player's genuine local captures (screenshots from `userdata/<id>/760/remote/<appid>/` and clips from `userdata/<id>/gamerecordings/`).
- Groups them into daily chronological cards.
- Displays Steam's native 16:9 thumbnail cards with inline clip playback.
- Sets the headline to `{Username} captured` across the entire library.

### 5.2 Technical Changes

#### A. View Sensor Generalization (`frontend/sensors/view/`)
Currently, `sensors/view/core.ts` rejects native appids:
```typescript
// BEFORE:
toShortcutId: (raw: unknown) => ShortcutId | undefined;
// If raw is a native appid (e.g. 435150), it returns undefined!
```

**After:**
Track viewed games generally:
```typescript
export interface AppViewPayload {
  appid: number;
  gameid: string;
  isShortcut: boolean;
  mode: ViewMode;
}
```
- For shortcuts: `gameid = (appid << 32) | 0x02000000`.
- For native Steam games: `gameid = appid.toString()`.
- Emits `app.viewed` and `app.left` on the EventBus for ALL library games.

#### B. Universal Capture Feed Publisher (`frontend/surfaces/captures/activity.ts`)
Update `publishActivity(appid: number, gameid: string, isShortcut: boolean)`:
1. **Query captures:**
   - `screenshotsSince(appid, 0)`: works identically for native games and shortcuts.
   - `clipsSince(gameid, 0)`: works for native games using plain `appid.toString()`.
2. **If captures exist:**
   - **For Shortcuts:** Continue injecting lightweight `StoreItemCache` stub (needed because Steam skips shortcut store items) and creating new `CAppActivity`.
   - **For Native Games:**
     - DO NOT inject fake `StoreItemCache` (native game already has a genuine entry in Steam).
     - Fetch or create the game's activity entry from `actStore.GetAppActivity(appid)`.
     - Group the local captures by local midnight.
     - Inject native screenshot events (`eEventType = 13`) with `m_mediaItems` for each capture day, blending smoothly with existing developer news and friend activity.
3. **Headline Patch (`frontend/surfaces/captures/headline.ts`):**
   Remove the shortcut-only gating:
   ```typescript
   // BEFORE:
   if (p.event.bIsNonSteam || (typeof appid === 'number' && isShortcutAppId(appid))) {
     if (p.event.eEventType === 13 || p.event.eEventType === undefined) {
       Object.assign(p, { children: ' captured' });
     }
   }
   
   // AFTER:
   // Apply to our capture events (or current user's screenshot events) across all games:
   if (p.event.eEventType === 13 || p.event.eEventType === undefined) {
     if (p.event.bIsNonSteam || p.event.steamIDActor === currentSteamID || Array.isArray(p.event.m_mediaItems)) {
       Object.assign(p, { children: ' captured' });
     }
   }
   ```
4. **Activity Cards Patch (`frontend/surfaces/captures/activity-cards.ts`):**
   Update replacement check:
   ```typescript
   // BEFORE:
   if (p?.event?.bIsNonSteam && Array.isArray(p.event.m_mediaItems) && p.onScreenshotChanged)
   
   // AFTER:
   // Any capture event with our mediaItems renders the 16:9 carousel card row:
   if (Array.isArray(p?.event?.m_mediaItems) && p.onScreenshotChanged)
   ```

---

## 6. Execution Phases

### Phase 1: Core Extension API Implementation
- Define `frontend/kernel/extensions.ts` with typed interfaces.
- Expose `window.SteamCartridges` global registry and handle load-order queueing.
- Refactor `app/achievements.ts` to query `ExtensionRegistry.getAchievementProviders()`.
- Refactor `frontend/settings/panel.tsx` to dynamically query contributed settings panels.
- Add unit tests for extension registry (`tests/extensions.test.ts`).

### Phase 2: Universal Captured Activity
- Generalize `sensors/view/core.ts` and `sensors/view/index.ts` to emit `app.viewed` for native and shortcut games.
- Update `surfaces/captures/publish.ts` and `activity.ts` to support native game capture ingestion.
- Update `headline.ts` and `activity-cards.ts` to format captures on native games without `bIsNonSteam` restrictions.
- Verify live via CDP: open native Steam game with captures, confirm `{Username} captured` and 16:9 card strip render cleanly. Verify two-way navigation (Game A -> Game B -> Game A).

### Phase 3: Scaffold & Build `steam-cartridges-local`
- Scaffold `steam-cartridges-local` plugin directory (`backend/`, `frontend/`, `tests/`, `plugin.json`, `dev.ps1`).
- Port `.ini` / Goldberg parsing and reset logic from `steam-cartridges` into `steam-cartridges-local`.
- Wire `index.tsx` to register `LocalAchievementProvider` with `window.SteamCartridges`.
- Clean up extracted modules from `steam-cartridges` backend (`achievements_observer.lua` delegates to extension or handles fallback).
- Verify with *WUCHANG: Fallen Feathers*.

### Phase 4: Scaffold & Build `steam-cartridges-third-party`
- Scaffold `steam-cartridges-third-party` plugin directory.
- Move Epic & Xbox backend modules (`store_*.lua`, `epic_*.lua`, `xbox_*.lua`) to the expansion plugin.
- Move frontend sync and settings modules (`epic-launcher.ts`, `store-sync.ts`, `third-party.tsx`) to the expansion plugin.
- Wire `index.tsx` to register `LibraryProvider`, `AchievementProvider`, and `SettingsPanelExtension`.
- Clean up third-party dependencies from `steam-cartridges` core.
- Verify Epic & Xbox detection, auto-add, and achievement sync.

---

## 7. Preconditions & Banned Actions

### 7.1 Preconditions
- Clean git working tree in `c:\game\millennium`.
- Steam running in dev mode (`http://127.0.0.1:8080`).
- Steam lock available (`node steam-lock.mjs status`).
- Baseline tests pass: `npm run check` and `npm test` exit 0 in `steam-cartridges`.

### 7.2 Banned Actions
- **No SharedJSContext reload** (`location.reload()`, `Ctrl+R`) — opens blocking "Save as" modal.
- **Never stop Steam outside scripts** — use `dev.ps1` or `start-steam-dev.ps1`.
- **Never add AI attribution** (Routine 6) in any commit message, trailer, or PR description.
- **Never hardcode paths** — always resolve via `millennium.steam_path()`.

---

## 8. Verification & Acceptance Criteria

| Area | Check | Expected Result |
| :--- | :--- | :--- |
| **Core Standalone** | Core running with 0 extensions | AM2R / native games render full capture feeds; 0 errors; settings panel opens cleanly |
| **Universal Captures** | Open native game with screenshots | Activity Feed renders `{Username} captured` with 16:9 cards; no community UGC phrasing |
| **Universal Captures** | Two-way navigation lifecycle | Native Game A ➔ Non-Steam B ➔ Native Game A; feeds remain 100% intact |
| **Local Expansion** | *WUCHANG: Fallen Feathers* | `steam-cartridges-local` detects RUNE `.ini`, populates achievements in Steam UI |
| **Local Reset** | Reset achievements on Wuchang | Backup `.bak` created; `.ini` unlock flags zeroed; UI reflects reset |
| **Third-Party Expansion**| Epic & Xbox installed detection | Installed games appear in Third-Party settings; shortcuts created with correct links |
| **Isolation Test** | Disable `steam-cartridges-third-party` | Core continues running smoothly; third-party tab cleanly absent; no errors |
