# steam-cartridges-third-party — plugin architecture

**This doc's job:** the architecture, file layout, storefront integration mechanics, and extension contracts for the `steam-cartridges-third-party` expansion plugin.

`steam-cartridges-third-party` is an optional Millennium plugin that extends `steam-cartridges`. It integrates external PC storefronts—**Epic Games Store** and **Xbox / Microsoft Store / Game Pass**—discovering installed games, automatically creating Steam library shortcuts, syncing store achievements, and managing launcher processes.

---

## 1. Role in the Suite

```
  ┌────────────────────────────────────────────────────────┐
  │                 steam-cartridges (CORE)                │
  │                                                        │
  │  • Restores Steam app detail sections                  │
  │  • Feeds Steam's AppOverview & AppDetailsStore         │
  │  • Exposes window.SteamCartridges Extension Registry   │
  │  • Dynamically hosts settings panels from extensions   │
  └───────────────────────────▲────────────────────────────┘
                              │ registers LibraryProvider & SettingsPanel
  ┌───────────────────────────┴────────────────────────────┐
  │           steam-cartridges-third-party                 │
  │                                                        │
  │  • Discovers Epic manifests & Xbox UWP packages        │
  │  • Auto-adds shortcuts into "Epic Games" / "Xbox" tabs │
  │  • Syncs Epic & Xbox Live profile achievements         │
  │  • Epic Steam Overlay Workaround process reaper        │
  │  • Microsoft OAuth device code sign-in flow            │
  └────────────────────────────────────────────────────────┘
```

The core `steam-cartridges` functions fully without this plugin (ADR-0012). When installed, `steam-cartridges-third-party` contributes installed game entries, store metadata, and its dedicated settings interface into the Steam Cartridges environment.

---

## 2. Directory Structure

```
steam-cartridges-third-party/
├── plugin.json                 # Millennium manifest ("steam-cartridges-third-party")
├── package.json                # Dependencies (@steambrew/client, @steambrew/ttc)
├── tsconfig.json               # TypeScript configuration
├── dev.ps1                     # Local deployment script
├── bin/                        # Deployed standalone binaries
│   └── uwp_presenter.exe       # Zero-copy WinRT D3D11 presentation wrapper for UWP overlay
├── tools/
│   └── uwp_presenter/          # Standalone presenter source (.NET 8 WinRT D3D11)
│       ├── Program.cs          # Windows.Graphics.Capture compositing into DXGI swapchain
│       ├── uwp_presenter.csproj
│       └── build.ps1           # Single-file win-x64 build script
├── backend/
│   ├── main.lua                # RPC endpoints
│   ├── store_service.lua       # Unified store scanning and cache manager
│   ├── store_epic_local.lua    # Epic .item manifest reader & dashed launch link builder
│   ├── epic_graphql.lua        # Epic GraphQL API (catalog metadata, public achievements)
│   ├── store_xbox_local.lua    # Registry & UWP package reader (shell:AppsFolder, MicrosoftGame.config, presenter wrapper)
│   ├── xbox_catalog.lua        # Microsoft Display Catalog API
│   ├── xbox_live.lua           # Xbox Live OAuth device flow & achievements API
│   ├── store_achievements.lua  # Store unlock aggregation
│   ├── store_launch.lua        # Epic Steam Overlay reaper & Xbox UWP repairs
│   ├── store_copies_store.lua  # Local storage for store copy identities
│   └── _lib/                   # Millennium runtime type stubs
├── frontend/
│   ├── index.tsx               # Registers with window.SteamCartridges
│   ├── backend.ts              # Frontend RPC client to third-party backend
│   └── settings/
│       ├── third-party.tsx     # Third-party settings section and Xbox sign-in modal
│       ├── components.tsx      # Shared settings UI components
│       └── settings.ts         # Settings accessor hooks
└── tests/
    ├── harness.lua             # Lightweight Lua test harness
    ├── test_store.lua          # Manifest parsing, store scanning, presenter specs, and catalog tests
    └── test_store_launch.lua   # Prelaunch hold, process detection, and reaper tests
```

---

## 3. Storefront Capabilities

### 3.1 Epic Games Store
- **Local Manifest Discovery:** Scans `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item`. Extracts `InstallLocation`, `LaunchExecutable`, `AppName`, and install state.
- **Dashed Launch Links:** Builds `com.epicgames.launcher://apps/<AppName>?action=launch&silent=true` with leading `-` so Steam tracks the game executable rather than the launcher (ADR-0057).
- **Public Achievements:** Queries Epic GraphQL endpoint for public profile unlocks. No credentials required on PC; reads account ID from launcher's `.dat` token file.
- **Overlay Workaround Reaper:** When launching an Epic shortcut from Steam, closes any idle launcher first, allows Steam to start the launcher with its overlay hooked, and automatically reaps the launcher process once game exits and cloud synchronization completes.

### 3.2 Xbox / Microsoft Store / Game Pass
- **UWP & WindowsApps Discovery:** Reads Windows registry `HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Families`. Reads `MicrosoftGame.config` and `xboxservices.config` for title IDs and store IDs.
- **UWP Direct Exe Launch (U0):** Bypasses `explorer.exe shell:AppsFolder\...` for UWP titles by executing the game binary directly, enabling native Steam playtime tracking.
- **Steam Overlay & Recording Workaround (`uwp_presenter`):** UWP games run inside an isolated `AppContainer` sandbox where COM activation, integrity levels, named IPC redirection, and window focus prevent Steam from injecting `GameOverlayRenderer64.dll` or capturing video frames. When the "Xbox Steam Overlay Workaround" setting is enabled, shortcuts launch via `uwp_presenter.exe --aumid "<PFN>!<AppId>"`:
  - Steam tracks `uwp_presenter.exe` as the child process, injects `GameOverlayRenderer64.dll`, spawns `gameoverlayui64.exe`, and hooks its DXGI swapchain.
  - The presenter activates the UWP game via WinRT `IApplicationActivationManager`, captures its frame stream using `Windows.Graphics.Capture` (zero-copy D3D11 texture copy), and renders to its own swapchain.
  - As the active foreground window, in-game achievement notifications, Shift+Tab overlay, and Steam Game Recording all function seamlessly without AppContainer isolation barriers.
- **UWP Auto-Repair:** Automatically detects package version directory shifts after Windows Store updates and patches the shortcut executable without duplicate entries (ADR-0058).
- **Xbox Live Authentication:** Device code flow via `login.live.com/oauth20_connect.srf`. Displays verification URL and short code for player authentication.
- **Xbox Live Achievements:** Fetches user unlock history using user XUID and XBL3.0 authorization headers.

---

## 4. Extension API Registration (`frontend/index.tsx`)

`steam-cartridges-third-party` registers two extensions with `window.SteamCartridges`:

```typescript
// 1. Library Provider for auto-add
const libraryProvider = {
    id: "steam-cartridges-third-party",
    name: "Third-Party Stores (Epic Games & Xbox)",
    async getInstalledGames() {
        const res = await backend.storeInstalledGames(true);
        const list = [...(res.epic ?? []), ...(res.xbox ?? [])];
        return list.map((g) => ({
            store: g.store,
            id: g.id,
            title: g.title,
            installPath: g.installPath || "",
            executable: g.executable || "",
            launchUri: g.launchUri,
        }));
    },
};

// 2. Settings Panel Extension
const settingsExtension = {
    id: "third-party",
    title: "Third-party",
    order: 30, // Rendered between Achievements and Notifications
    render: () => React.createElement(ThirdPartySection, null),
};
```

---

## 5. Testing & Building

- **Backend tests:**
  ```bash
  luajit tests/test_store.lua
  luajit tests/test_store_launch.lua
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
