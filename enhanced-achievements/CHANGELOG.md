# Changelog

All notable changes to **Enhanced Achievements**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- On Millennium 1.1.2 (loader 2026-08-18) the Configuration API only partly
  works: writes persist but report an error, reads fail, and no change events
  arrive. The plugin works around it (see `frontend/settings/settings.ts`).
