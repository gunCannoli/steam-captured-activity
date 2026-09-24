# Changelog

All notable changes to **Enhanced Achievements**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.1] - 2026-09-24

### Added

- **Auto-captures on unlock (Phase 7):** an optional screenshot, clip and
  timeline marker on achievement unlock, driven by Steam's own Game Recording
  RPCs. Off by default (opt-in per settings panel). Needs a running recording
  for the screenshot/clip; the marker only applies to non-Steam games (Steam
  already marks its own games' timelines). A **Test captures** button runs the
  full pipeline for real, on the game currently being recorded. See
  [themes.md § Capture overrides](themes.md#capture-overrides-screenshot-recording).
- **Default theme `steam_tiers`**, colour-coded per rarity tier with original
  SVG trophy icons, no local asset paths — works out of the box on any
  machine. The previous PS5-style example moved to [examples/](examples/).
- **Settings-panel warning** when Steam's own toast notifications are off
  (detected once from Steam's client settings, no polling): banners, sounds
  and captures cannot trigger until they are turned back on.
- **`LICENSE`** (MIT).
- **Themed achievement banner** replacing Steam's toast content for unlocked
  achievements (not progress toasts), on desktop and in Big Picture. Steam
  keeps the toast window, queue, timing and dismissal. Any render error shows
  Steam's own toast.
- **Themed sound per rarity tier**, replacing Steam's chime only when Steam
  itself would have played one. A missing or undecodable sound falls back to
  Steam's chime.
- **Rarity tiers** from Steam's global unlock percentage (`magic` / `rare`
  thresholds), plus `exceptional` for the unlock that completes the game.
- **`display_time_ms`** applied to Steam's own achievement toast duration.
- **JSON themes** with per-tier inheritance, bundled and user folders
  (`<Steam>/millennium/config/enhanced-achievements/themes/`), assets loaded
  once per theme load.
- **Settings panel** in Millennium's sidebar: theme, banner and sound toggles,
  per-tier preview, reload, open themes folder, reset. Defaults ship in
  `settings.json`; changes are stored by Millennium.

### Known limits

- The desktop toast window is a fixed 284×71; `scale` enlarges text and icons
  within it, and `position` follows Steam's own notification setting.
- The in-game overlay uses the same toast code path, but has not yet been
  verified with a real in-game unlock.
- Banners, sounds and captures never trigger when Steam's own toast
  notifications are off (Steam Settings -> Notifications). The settings panel
  warns about this when it can detect the setting.
- Captures need Game Recording on (background or manual). Steam already marks
  achievements on its own games' timelines, so the plugin's marker only
  applies to non-Steam shortcuts.
- On Millennium v3.4.1 the Configuration API only partly works: writes persist
  but report an error, and reads fail
  ([Millennium#903](https://github.com/SteamClientHomebrew/Millennium/issues/903)).
  The plugin works around it (see `frontend/settings/settings.ts`).
