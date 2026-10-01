# Changelog

All notable changes to **Enhanced Notifications**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Internals rebuilt on Enhanced Achievements' architecture (ADR-0047, docs/enhanced-notifications/architecture.md): one surface per thing written into Steam (`style`, `sound`, `duration`, `preview`), the same notification hook file as Enhanced Achievements (checked by a test, and proven to work with it in either load order), and an architecture test. No change to themes or settings.
- Settings panel laid out like Enhanced Achievements' (same rows and spacing): Theme, Preview notifications, General and Reset sections; the theme dropdown takes the full row; a theme problem shows under it instead of a status line. The controls are disabled while Steam's toasts are off.

### Added

- **Toast position, animation and spacing**, with Enhanced Achievements' names and values (themes.md): `settings.position` (`top_right`, `top_left`, `bottom_right`, `bottom_left`, `top_center`, `bottom_center`), `settings.animation` (`slide`, `fade`, `up`, `down`, `ps5`, `none`, or `{ "in", "out" }`), and per style `popup.margin`, `popup.padding`, `popup.gap`. Position and animation apply to desktop and in-game overlay toasts and keep Steam's stacking; Big Picture keeps Steam's place and motion; achievement toasts drawn by Enhanced Achievements keep that plugin's. New kill switch `placement`. Live check `tests/placement.mjs`.
- **Safety net:** each feature can be switched off without uninstalling (`disabledFeatures` setting, e.g. `style,sound`; no panel control), a feature that fails 5 times in a session switches itself off until Steam restarts, and two unclean starts in a row start the plugin in safe mode (Steam's own toasts). `safetyDiagnostics()` and `surfaceStatus()` exports.
- `npm run test:live` runs every live check with settings snapshotted and restored; new live check `tests/safety.mjs`.
- **JSONC themes:** themes can be `.jsonc` (or `.json`) with `//` and `/* */` comments and trailing commas; `name.jsonc` wins over `name.json` in the same folder. Same rules as Enhanced Achievements.
- Sound paths may be absolute (`C:/...`) for personal themes; this worked before and is now documented in themes.md.
- README: Troubleshooting (kill switches, safe mode).

### Fixed

- With several desktop toasts on screen, each keeps its own type's style: every toast window now carries its own notification type instead of the newest toast's (an older toast used to be restyled, or lose its style, when a new one arrived).
- Toast durations are restored to Steam's own value even when enhanced-achievements wrote a type's duration first: both plugins record the pristine value in one shared place (`pristineDuration`, same helper in each).

## [0.1.0-alpha.1] - 2026-09-24

### Added

- Restyles Steam's own toast windows (no content replaced): popup background,
  border, glow, watermark, font, text, logo, header icon, from JSON themes with
  `default` -> category -> type inheritance. Rules come only from resolved CSS
  class maps (all modules per key) and are scoped to `body[data-en-type]`.
- Sound per type or category (custom file or `false` to mute), respecting
  Steam's own mute setting. Display time per type.
- Coexistence with Enhanced Achievements through its `claims()` export.
- Settings panel: theme, reload, open folder, per-category preview, toggles, reset.
- **Settings-panel warning** when Steam's own toast notifications are off
  (detected once from Steam's client settings, no polling): styling, sounds and
  display time cannot show until they are turned back on.
- **`LICENSE`** (MIT).

### Fixed

- Big Picture toasts are now styled too. They are shown on an unregistered
  `BrowserView` popup that Millennium's window hooks never see; fixed by
  finding the popup handle through the `GamepadToastPlaceholder` fiber in a
  registered window instead (see the root repo CHANGELOG for the
  investigation).

### Verified live (desktop + Big Picture)

Downloads, recording, system and achievement toasts styled; sound mute,
replacement and fallback; display time; settings round-trips; achievement
toasts left to Enhanced Achievements; Big Picture toast window styled.

### Known limits

- Friend and message toasts not verified (Steam did not show them with the
  current Friends notification settings).
- The in-game overlay is not yet verified.
- Styling, sounds and display time do nothing while Steam's own toast
  notifications are turned off entirely (Steam Settings -> Notifications).
  The settings panel shows a warning when it can detect this.
