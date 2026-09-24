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

> **Module ids and minified names below (`60917`, `11374`, `ht`, `u.uM.ok`, `80026`, `xM`) are breadcrumbs from one Steam build, not lookup keys.**
> They reshuffle between builds. Code must resolve every one of them by a stable signature
> (prototype method names, or strings inside a function's source) — see
> [plugins.md § Rules that apply on every rung](../plugins.md#rules-that-apply-on-every-rung) and
> the signature table in [§ 5, Step 0](#step-0-live-re-verification-no-code).

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

Capture defaults (`screenshot`, `recording`) and the active theme live in the plugin's
[`settings.json`](../../enhanced-achievements/settings.json), not in the theme; a tier may still
override captures for itself. Full reference: [themes.md](../../enhanced-achievements/themes.md).

```json
{
  "settings": {
    "layout": "default_system_right",
    "position": "topright",
    "display_time_ms": 4000,
    "animation": "slide"
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
├── settings.json                  # Shipped defaults for the plugin settings (bundled into the frontend)
├── themes/                        # Bundled themes (read by the backend)
│   ├── steam_ps_exemple.json      # Canonical PlayStation 5 theme
│   ├── xbox_achievement.json      # Xbox 360 / Series X theme
│   └── retro_achievements.json    # Retro pixel banner theme
├── backend/
│   ├── main.lua                   # Theme discovery and asset loading (no settings storage)
│   └── _lib/                      # Millennium Lua runtime stubs
└── frontend/
    ├── index.tsx                  # Plugin entry point; definePlugin({ content }) = settings panel
    ├── settings/
    │   ├── settings.ts            # pluginConfig read/subscribe, falling back to settings.json defaults
    │   └── settings-panel.tsx     # Steam-native ToggleField / Dropdown / SliderField controls
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

## 5. Phase 6 Execution Plan — Themed Banner & Sound

> **Status (2026-09-24): implemented and verified live** on desktop and Big
> Picture, except the in-game overlay with a real unlock (code path shared,
> untested). Step 0 signatures are in [steam-components.md § 11B](../steam-components.md#b-native-achievement-notifications-notificationstore).
> Deviations from this plan, found live:
> - `ProcessNotification` cannot be wrapped (bound, non-writable). `display_time_ms`
>   is applied through the achievement type's config `toastDurationMS` instead.
> - `position` is not applied: Steam places the toast window from its own setting.
>   The desktop frame is a fixed 284×71, so `scale` enlarges content, capped to the frame.
> - Millennium v3.4.1's Configuration API is partly broken (writes persist but
>   error, reads fail: [Millennium#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)),
>   and frontend writes raise no change events by design. Settings use a workaround instead of
>   `subscribePluginConfig` / `usePluginConfig`
>   ([knowledgebase.md](../knowledgebase.md#plugin-settings--the-configuration-api-verified-installed-millennium--steambrewclient-585)).
> - Tests: `npm test` (logic), `tests/*.mjs` (live CDP), `scratch/test_nav_cycle.js`
>   and `scratch/check_all_tabs.js` (core regression, Routines 1–2).

Phase 6 ships the banner and the sound. Captures (screenshot, clip, timeline
marker) are Phase 7 and reuse this phase's dispatch hook, config loader and
tier resolver.

### Scope boundaries (what Phase 6 must never touch)

`enhanced-achievements` is a **separate plugin** that shares `SharedJSContext`
with `non-steam-games-activity`. Both run in the same React runtime and see the
same store singletons, so a careless hook here breaks the core's views.

- It hooks **only** `NotificationStore` (sound) and the achievement toast renderer (banner).
- It never touches `AppOverview`, `StoreItemCache`, `CAppDetailsSections`,
  `appActivityStore` or `appSpotlightStore` — the objects the core's guardrails
  1, 5, 7 and 8 protect.
- It never imports from `non-steam-games-activity`. When Phase 5 dispatches
  synthetic toasts for non-Steam games through `NotificationStore.OnNotification`,
  they flow through the same hooks with no coupling between the plugins.
- Every notification that is not an achievement passes through untouched.

### Step 0: Live re-verification (no code)

The findings in § 2 come from one CDP session. Re-verify against the running
client before writing hooks, and record the **signatures** (not ids) in
[steam-components.md § 11B](../steam-components.md#b-native-achievement-notifications-notificationstore):

| Target | Resolve by (signature) | To confirm |
| --- | --- | --- |
| `NotificationStore` | `window.NotificationStore`; fallback: singleton with `PlayNotificationSound` + `ChooseSound` + `DispatchNextToast` | Exists in Desktop and Big Picture at plugin load |
| Achievement type enum | Read `eType` off a live `TestAchievement` notification | Never hardcode the number |
| Toast renderer | Function whose source contains `global_achieved_pct()` and `achievement_id()` | Unique match; props it receives (`group`, `onActivate`, `onDismiss`?) |
| Toast container | Where `--toast-duration` is set | Whether `display_time_ms` can be honoured without rebuilding the container |
| Rendering context | Which window paints the toast | **Desktop**, **Big Picture** and the **in-game overlay** — is the overlay toast rendered from `SharedJSContext`? If not, Phase 6 cannot theme in-game toasts and scope must say so |
| Completion data | `appAchievementProgressCache`, or `nAchieved`/`nTotal` from `AppDetailsStore.GetAchievements` | Whether "this unlock completes the game" is knowable at toast time (needed for `exceptional`) |
| `TestAchievement(appid)` | Call it live | Fires a real toast with sound; payload carries `global_achieved_pct` |

Exit criterion: every row resolves by signature to exactly one match, or the
plan is amended before Step 4.

### Step 1: Scaffold

Per [plugins.md § 1](../plugins.md#1-scaffold) and its checklist.

- `plugin.json` with `"name": "enhanced-achievements"`, `"backendType": "lua"`.
- `backend/_lib/` stubs copied; `backend/main.lua` calls `millennium.ready()`.
  The vendored stubs predate `millennium.config`; that is fine, because settings are frontend-only.
- `package.json`, `tsconfig.json` mirroring `non-steam-games-activity`.
- `dev.ps1` copied from the core — Steam path discovered, never hardcoded
  ([ADR-0011](../decisions.md#adr-0011-do-not-hardcode-steam-or-retroarch-paths)) —
  and extended to deploy `themes/` (the backend reads it). `settings.json` is
  bundled into the frontend at build time, so it needs no deploy step.
- Move `steam_ps_exemple.json` and `theme_exemple.json` into `themes/`; move
  `research/` out of the published folder (it contains a local SAN install path).

### Step 2: Settings (Millennium Configuration API)

Defaults ship **in the plugin**; the user changes them from the plugin's
settings panel in Millennium's sidebar. No settings file is written or read at
runtime. API facts: [knowledgebase.md § Plugin settings](../knowledgebase.md#plugin-settings--the-configuration-api-verified-installed-millennium--steambrewclient-585).

- **Defaults:** [`settings.json`](../../enhanced-achievements/settings.json) is imported
  into the frontend bundle (`resolveJsonModule`). If `millennium-ttc` will not bundle
  JSON, mirror it in `settings/defaults.ts`; `settings.json` stays the documented source.
- **Storage:** one flat config key per setting (table below). Millennium has no
  default declaration: an unset key reads `undefined`, so every read is
  `stored ?? default`. Nothing is written until the user changes a value, so
  shipping new defaults in an update reaches every user who never changed that setting.
- **Reads:** `pluginConfig.getAll()` once at load into a module-scoped object, then
  `subscribePluginConfig` keeps it current. Hooks read that object, never the
  config API per toast (it is an IPC round trip). Changes apply live, with no reload.
- **Validation:** a stored value of the wrong type or out of range is ignored
  (the default is used) and logged, never thrown.
- **Panel:** `definePlugin(() => ({ icon, content: <SettingsPanel/> }))`, built from
  the SDK's own `ToggleField`, `Dropdown`, `SliderField` and `DialogButton`, with no custom CSS.

| Config key | Control | Default (`settings.json`) |
| --- | --- | --- |
| `theme` | Dropdown, filled from `ListThemes()` | `"steam_ps_exemple"` |
| `banner.enabled` | Toggle | `true` |
| `sound.enabled` | Toggle | `true` |
| `screenshot.enabled` | Toggle | `true` |
| `screenshot.delay_ms` | Slider 0–5000 ms | `500` |
| `recording.enabled` | Toggle | `true` |
| `recording.duration_s` | Slider 5–60 s | `15` |
| `recording.delay_ms` | Slider 0–5000 ms | `0` |
| `recording.add_timeline_marker` | Toggle | `true` |

Capture keys are shown in Phase 6 but disabled ("Phase 7") until captures ship.

**Panel actions** (buttons, no stored value):

- **Preview** per tier (`normal` / `magic` / `rare` / `exceptional`): fires
  `NotificationStore.TestAchievement` with that tier forced. This makes editing a
  theme's JSON a quick edit → reload → preview loop.
- **Reload themes:** re-runs `ListThemes` / `LoadTheme` after a JSON edit, with no Steam restart.
- **Open themes folder:** opens the user themes folder in Explorer.

**No theme builder.** Themes stay hand-edited JSON files: one file (plus its
`assets/`) is the unit users share, and it diffs and versions cleanly. A visual
builder would duplicate the schema in UI code and can come later if there is demand.

### Step 3: Themes (backend + frontend)

**Backend (`main.lua`)** exposes two RPCs, each JSON in / JSON out, never bare `nil`:

- `ListThemes()` — names of `*.json` in the bundled `themes/` folder and the user
  themes folder. A user theme with the same name overrides the bundled one.
- `LoadTheme({ name })` — parsed theme plus every referenced asset as a data
  URL (`utils.base64_encode` over `fs` reads). Relative paths resolve against
  the theme's folder. A missing asset is logged and returned as `null`, not an error.

**Frontend (`theme/`)**:

- `theme-types.ts` — types matching [themes.md](../../enhanced-achievements/themes.md).
- `theme-loader.ts` — validates, normalises shorthand (`icons: true` → `[true, 0]`),
  merges each tier over `normal`, and returns four **fully resolved** tier objects.
  Resolution happens once per theme load. Toast-time work is only picking one of the four.
- Sounds are decoded once into `AudioBuffer`s (or kept as `Audio` elements) at load, not per unlock.
- Any validation failure logs and falls back to **stock Steam** for that part, never a half-styled banner.

**Pure-logic tests** (tier selection, inheritance merge, shorthand
normalisation) run outside Steam, per [plugins.md § 5](../plugins.md#5-test).

### Step 4: Sound hook

Wrap `PlayNotificationSound` on the `NotificationStore` instance's prototype once, at load:

```ts
proto.PlayNotificationSound = function (n) {
    try {
        if (n?.eType === achievementType && settings.sound.enabled) {
            const clip = soundFor(n);          // O(1): tier lookup into pre-resolved theme
            if (clip && play(clip)) return;    // played ours: skip Steam's chime
        }
    } catch (e) { logger.warn(...); }
    return orig.apply(this, arguments);         // everything else: untouched
};
```

- Non-achievement types, disabled sound, missing asset and playback errors all
  fall through to the original. The failure mode is always "Steam's chime".
- Respect Steam's own "play sound on notification" preference: if `ChooseSound`
  returns nothing (user muted toasts), stay silent too.
- `OnPluginUnload` (or a guard flag) restores the original.

### Step 5: Banner replacement

Rung check ([plugins.md § Build nothing Steam already builds](../plugins.md#build-nothing-steam-already-builds)):
Steam's toast is the thing being replaced, so rungs 1–3 do not apply to the
**inner** banner. Everything around it stays Steam's: the toast container,
queueing, timing, click-to-open and dismissal.

- Resolve the toast renderer by signature (Step 0) **once at startup** and keep
  the reference module-scoped (guardrail 3). Never walk `req.m` in a render path.
- Substitute it in one of two ways, in order of preference:
    1. Replace the export if the module object allows it (webpack getters may not).
    2. `react/jsx-runtime` `beforePatch`, as `gamepad-appid.ts` already does
       ([ADR-0027](../decisions.md#adr-0027-patch-reactjsx-runtime-to-reach-big-pictures-real-render-pipeline)): an **identity compare**
       `type === steamAchievementToast` and nothing else. `jsx` runs for every
       element in the client, so this check must stay O(1) (guardrail 2).
- `AchievementBanner` receives Steam's original props and forwards
  `onActivate` / `onDismiss` unchanged. If the theme failed to load or
  `banner.enabled` is false, it renders Steam's original component.
- Wrap it in an error boundary that renders Steam's original on any throw.
- Styling is our own by definition (the theme *is* custom visuals), but it is
  scoped under one root class of our own. No rule may target Steam's hashed
  classes or leak outside the banner.
- `position` / `display_time_ms`: apply only what Step 0 shows is possible
  without rebuilding Steam's toast container. Anything that is not goes to a
  follow-up, not into a container rewrite.

### Step 6: Verification

1. `npm run check` and `npm run build` pass; the backend tests pass.
2. **Desktop:** `NotificationStore.TestAchievement(<appid>)` for each tier. To
   force a tier, temporarily set thresholds to `100` / `0` in a test theme.
3. **Big Picture:** the same, plus controller focus is not stolen by the banner.
4. **In-game overlay:** a real unlock in a native Steam game, if Step 0 shows the overlay is themeable.
5. **Settings:** each toggle takes effect live from the panel; clearing the
   plugin's config restores every default; a Steam restart keeps changed values.
6. **Fallbacks:** delete a sound file → Steam chime; corrupt the theme JSON →
   stock toast; disable the plugin → stock toast, stock chime.
7. **Non-achievement toasts** (friend online, download complete) are unchanged.
8. **Core regression pass**, because both plugins share one context: Routine 1
   (all four views), Routine 2 (A → B → A) and Routine 3 (`scratch/test_nav_cycle.js`,
   `scratch/check_all_tabs.js`) with `enhanced-achievements` enabled.
9. Add `scratch/test_achievement_toast.js`: dispatch `TestAchievement` over CDP
   and assert the banner root and the resolved tier.

### Regression guardrails for this plugin

| # | Rule | Why |
| --- | --- | --- |
| 1 | Resolve by signature, never by module id or minified name | Ids reshuffle between builds |
| 2 | Hot-path checks are O(1): identity compare in `jsx`, `eType` compare in the sound hook | `jsx` runs for every element; guardrail 2 |
| 3 | One module scan at startup, references cached | Guardrail 3 |
| 4 | Every hook falls through to Steam's original on any failure | A failed resolve degrades to stock, never crashes |
| 5 | No per-toast disk, RPC or network work | Assets are preloaded at theme load |
| 6 | Never touch the core plugin's objects (see Scope boundaries) | Guardrails 1, 5, 7, 8 |
| 7 | No imports across plugin folders | [plugins.md § Layout](../plugins.md#layout) |
| 8 | Core regression pass with both plugins enabled | Routines 1–3 |

### Open decisions

- ~~**User themes folder.**~~ Decided and shipped:
  `<steam>/millennium/config/enhanced-achievements/themes/`, created on first load.
- **In-game overlay:** Step 0 showed overlay toasts use the same dispatcher from
  `SharedJSContext`, so they should be themed. Still to verify with a real
  in-game unlock.

---

## 6. Phase 7 Outline — Auto-Captures

Builds on Phase 6's dispatch hook and tier resolver.

- **Trigger:** observe achievement notifications once (in `OnNotification` or
  the sound hook), resolve the tier, and merge the tier's `screenshot` / `recording`
  over the plugin settings (Configuration API).
- **Screenshot:** after `delay_ms`, `GameRecording.TakeScreenshot` (or `SteamClient.Screenshots`).
- **Clip:** after `delay_ms`, `GameRecording.SaveClip` covering the last `duration_s`.
- **Timeline marker:** `GameRecording.UserAddTimelineEntry` at the unlock time.
- Only while a game is running and Game Recording is on; otherwise a no-op, never an error.
- Captures land in Steam's own folders, so `non-steam-games-activity` picks them up
  with no coupling between the plugins.
