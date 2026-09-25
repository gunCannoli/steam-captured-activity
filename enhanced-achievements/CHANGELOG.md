# Changelog

All notable changes to **Enhanced Achievements**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`banner.scale` no longer scales title, description and icon sizes** — only
  the banner box. Text now renders at the size its `text.*` percentage and the
  base font (14px title, 12px desc) ask for; icons at their own `scale_pct`
  against the unscaled box height.
- **A scaled banner no longer loses its anchor and grows off-screen.** Window
  placement is computed from the actual (scaled) banner size and clamped to
  the screen, so a large `scale` or a negative margin can never push the
  banner past the screen edge.
- **The banner position no longer flickers between the configured anchor and
  Steam's own corner.** Steam's desktop toast stack re-positions every toast
  popup on every animation frame of its fade-in/fade-out, anchored at its own
  corner with a fixed 283px width; our old timer-based `MoveTo` calls raced it
  and whichever wrote last "won" for that frame. The fix pins that popup's own
  `SteamClient.Window.MoveTo` (an own, writable property) before Steam's first
  move, so our position is never overwritten.
- **`margin` now correctly offsets from the anchor corner.** The previous code
  passed CSS-pixel coordinates as if they were physical pixels (`MoveTo`'s
  third argument is a DPI multiplier, not a boolean), so at DPR 1.25 the
  banner landed about 20% short of its intended offset.

### Changed

- **`position` values are now snake_case** (`top_right`, `bottom_center`, …)
  for consistency with every other multi-word value in the schema. Pre-alpha,
  so the old run-together spellings (`topright`, …) are a breaking change, not
  deprecated — update your theme files.
- **`text-align` is now `text_align`**, for the same reason and with the same
  breaking change.
- **`applyPosition()` / `SetNotificationPosition` removed.** It rewrote
  Steam's global (all-toasts) notification position and did not reliably take
  effect; window placement is now done per-toast-popup only (see Fixed, above).

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
