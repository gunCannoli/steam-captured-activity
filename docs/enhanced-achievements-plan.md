# Enhanced Achievements: Architecture & Implementation Plan

> **Phase 6 & 7 Specification:** Custom achievement notification banners, audio per rarity, auto-screenshots, and auto-game-recordings driven by a lightweight JSON theme engine.

---

## 1. Overview & Vision

Currently, Steam provides a single static achievement notification banner with a fixed sound chime and no native auto-capture options. External tools like *Steam Achievement Notifier (SAN)* require running a separate, resource-heavy Electron application outside Steam that polls memory or web APIs and manages transparent overlay windows.

**`enhanced-achievements`** is a native **Millennium plugin** that runs directly inside Steam's own React and CEF environment. It:
1. **Customizes Notification Banners:** Replaces or restyles Steam's achievement toast using a responsive, customizable banner with custom layouts, gradients, borders, glows, fonts, and animations.
2. **Customizes Audio:** Hooks Steam's notification sound engine to silence the stock chime and play custom, high-fidelity audio assets (e.g. PlayStation 5 trophy chimes, Xbox rare achievement sounds, RetroAchievements chimes) with per-tier volume control.
3. **Automates Captures (Screenshots & Replays):** Automatically captures a screenshot with a configurable delay (so the screen is clear) and saves a replay video clip (e.g. 15s or 30s) with timeline markers using Steam's native 2024 Game Recording subsystem.
4. **Supports Themes (`themes.md` & `steam_ps_exemple.json`):** Easy, declarative JSON theme configuration with inheritance across achievement rarity tiers (Normal/Bronze, Magic/Silver, Rare/Gold, Exceptional/Platinum 100%).

---

## 2. Live Steam Client Investigation Findings

Through live Chrome DevTools Protocol (CDP) probing against Steam (`127.0.0.1:8080`), we mapped the exact internal modules and components responsible for achievement dispatch, sound, rendering, and capture.

### A. Notification Dispatch Engine (`window.NotificationStore`)
- **Singleton:** `window.NotificationStore` (instantiated in webpack module `60917`).
- **Achievement Enum:** `u.uM.ok` (corresponds to `NotificationType.Achievement`).
- **Protobuf Schema:** `CAchievementNotification` (`u.R8`).
  - Fields: `achievement_id`, `appid`, `name`, `description`, `image_url`, `achieved`, `rtime_unlocked`, `global_achieved_pct`, `current_progress`, `max_progress`.
- **Built-in Test Dispatcher:** `window.NotificationStore.TestAchievement(appid)` can be invoked at runtime for immediate live debugging!
- **State Pipeline:**
  - `NotificationStore.DispatchNextToast()` sets `m_valueCurrentToast` (`SubscribableValue`).
  - React components subscribe via hook `useSubscribableValue(NotificationStore.CurrentToastSubscribableValue)` (module `60917`, export `lf`).

### B. Sound Interception Point
In `NotificationStore`:
```javascript
ChooseSound(config, notification) { ... }
PlayNotificationSound(notification) {
  const eType = notification.eType, r = Q[eType];
  let soundId = this.ChooseSound(r, notification);
  if (soundId) PlayNavSound(soundId);
}
```
- For achievement notifications (`notification.eType === u.uM.ok`), `notification.data.achieved()` evaluates to `true`, and Steam plays `j.PN.ToastAchievement`.
- **The Hook:** We can hook `NotificationStore.prototype.PlayNotificationSound`:
  - If the incoming notification is an achievement (`u.uM.ok`):
    - Check if the active theme defines a custom sound for the achievement's rarity.
    - If defined: **suppress** `PlayNavSound` and play the custom audio file using HTML5 `new Audio(soundUrl)` with the configured volume.
    - If undefined or disabled: delegate to the original `PlayNotificationSound`.

### C. Toast Banner Rendering (`module 11374`, component `ht`)
- Module `48197` manages the container toast popup (`function M(e)`), injecting `--toast-duration` and rendering `C.Tm` (module `11374`).
- Inside module `11374`, `function ht(e)` is the dedicated achievement notification renderer:
  ```javascript
  function ht(e) {
    let n = mr(e.group);
    let o = {
      strID: n.data.achievement_id(),
      strName: n.data.name(),
      strDescription: n.data.description(),
      strImage: n.data.image_url(),
      bAchieved: n.data.achieved(),
      flAchieved: n.data.global_achieved_pct(),
      ...
    };
    ...
  }
  ```
- **The Banner Hook:** Wrapping or patching `ht` (or using `react/jsx-runtime` interception) allows substituting Steam's default toast markup with our themed banner component, while preserving Steam's click-to-open and dismissal callbacks (`onActivate`, `onDismiss`).

### D. Game Recording & Screenshot Services (`module 80026`)
Steam's 2024 Game Recording architecture exposes `CGameRecordingService` (module `80026`, export `xM`):
1. **Instant Replay Clips (`SaveClip`):**
   - RPC: `GameRecording.SaveClip#1` (`CGameRecording_SaveClip_Request`).
   - Parameters: `{ game_id, start, end, name, temporary, force_thumbnail }`.
   - Allows capturing a clip of the past 15 to 30 seconds when an achievement unlocks.
2. **Timeline Markers (`UserAddTimelineEntry`):**
   - RPC: `GameRecording.UserAddTimelineEntry#1` (`CGameRecording_UserAddTimelineEntry_Request`).
   - Inserts a golden trophy marker on the game recording timeline at the exact moment of unlock.
3. **Screenshots (`TakeScreenshot` & SteamClient):**
   - RPC: `GameRecording.TakeScreenshot#1` (`CGameRecording_TakeScreenshot_Request`).
   - Alternatively: Trigger screenshot via Millennium backend keyboard synthesis (F12) or `SteamClient.Screenshots`.
   - Delayed capture: Executed via `setTimeout(() => takeScreenshot(), delay_ms)` so the on-screen action is captured cleanly without UI occlusion.

---

## 3. Theme Architecture (`themes.md` & `steam_ps_exemple.json`)

Themes are defined as clean, declarative JSON files stored in `enhanced-achievements/themes/`.

### Rarity Tiers & Inheritance
1. **`normal` (Bronze):** Base fallback tier. Defines base dimensions, scale, typography, and default sound.
2. **`magic` (Silver):** Unlocks when global unlock percentage $\le$ `magic.threshold` (e.g. 25%).
3. **`rare` (Gold):** Unlocks when global unlock percentage $\le$ `rare.threshold` (e.g. 10%).
4. **`exceptional` (Platinum):** Unlocks when the player reaches 100% completion for the game.

> **Inheritance Rule:** Tiers only define fields that override `normal`. All omitted properties inherit from `normal`.

### Configuration Schema Highlights
```json
{
  "settings": {
    "layout": "default_system_right",
    "position": "topright",
    "display_time_ms": 4000,
    "animation": "slide",
    "screenshot": {
      "enabled": true,
      "delay_ms": 500
    },
    "recording": {
      "enabled": true,
      "duration_s": 15,
      "delay_ms": 1000,
      "add_timeline_marker": true
    }
  },
  "themes": {
    "normal": {
      "box": { "scale": [150, 150], "background_color": ["#2f2f2f", "#1f1f1f"], "border": [0, "#8a2be2", 25], "glow": ["#363636", 50, 0] },
      "text": { "title": ["#ffffff", 100, "bold"], "desc": ["#ffffff", 100, "regular"] },
      "icons": { "achievement": [true, 0], "system": [".../Steam_icon_logo-white.png", 0], "rarity": [".../bronze.png", 0] },
      "sound": [".../ps5_trophy.mp3", 40]
    },
    "magic": { "threshold": 25.0, "icons": { "rarity": [".../silver.png", 0] } },
    "rare": { "threshold": 10.0, "icons": { "rarity": [".../gold.png", 0] }, "sound": [".../ps4-trophy-get.mp3", 40] },
    "exceptional": { "icons": { "rarity": [".../steam_100_game-badge.png", 0] }, "sound": [".../platinum-trophy-ps5.mp3", 50] }
  }
}
```

---

## 4. Plugin Structural Layout

```
enhanced-achievements/
├── plugin.json                    # Manifest: name, version, backendType: lua
├── package.json                   # Dependencies: @steambrew/client, typescript
├── tsconfig.json
├── dev.ps1                        # Hot-deploy script with Steam path parameter
├── themes.md                      # Canonical theme schema documentation
├── themes/
│   ├── steam_ps_exemple.json      # Canonical PlayStation 5 theme
│   ├── xbox_achievement.json      # Xbox 360 / Series X theme
│   └── retro_achievements.json    # Retro pixel banner theme
├── backend/
│   ├── main.lua                   # Theme discovery, settings storage, file server
│   └── _lib/                      # Millennium Lua runtime stubs
└── frontend/
    ├── index.tsx                  # Plugin entry point (OnPluginLoaded)
    ├── theme/
    │   ├── theme-types.ts         # TypeScript interfaces matching themes.md
    │   ├── theme-loader.ts        # Theme resolver and inheritance calculator
    │   └── theme-context.tsx      # React context for active theme state
    ├── audio/
    │   └── sound-interceptor.ts   # NotificationStore.PlayNotificationSound hook
    ├── banner/
    │   ├── achievement-banner.tsx # Custom themed banner component
    │   ├── banner-patch.ts        # Hook on module 11374 (ht) / jsx-runtime
    │   └── banner.module.css      # Base layout, transitions, and glow styles
    └── capture/
        ├── screenshot-trigger.ts  # Delayed screenshot capture handler
        └── recording-service.ts   # CGameRecordingService clip saver & markers
```

---

## 5. Execution Roadmap

### Step 1: Plugin Scaffolding
- Set up `plugin.json` (`"name": "enhanced-achievements"`, `"backendType": "lua"`).
- Copy `backend/_lib/` stubs and create `backend/main.lua` calling `millennium.ready()`.
- Set up `package.json`, `tsconfig.json`, and parameterized `dev.ps1`.

### Step 2: Theme Management & Schema Validation
- Implement `theme-loader.ts` to read JSON themes, validate against schema, and calculate inheritance.
- Expose theme selection via Millennium settings or configuration JSON.

### Step 3: Sound Interception Hook
- Install hook on `NotificationStore.prototype.PlayNotificationSound`.
- Detect achievement type (`u.uM.ok`), read unlock payload, determine rarity tier.
- Play custom sound at configured volume via HTML5 `AudioContext` and suppress native chime.

### Step 4: Banner Replacement
- Hook `ht` in module `11374` or intercept JSX creation for achievement toasts.
- Render `AchievementBanner` respecting box styling, borders, gradients, glows, and icons.

### Step 5: Auto-Captures Integration
- Ingest `screenshot` settings and execute delayed capture via `takeScreenshot()`.
- Ingest `recording` settings, invoke `CGameRecordingService.SaveClip` and `UserAddTimelineEntry`.

### Step 6: Multi-Mode Verification
- Verify in Desktop Mode using `window.NotificationStore.TestAchievement(480)`.
- Verify in Big Picture Mode with controller focus and overlay positioning.
- Run automated CDP verification harness.
