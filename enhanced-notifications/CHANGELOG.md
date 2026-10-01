# Changelog

All notable changes to **Enhanced Notifications**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Big Picture position and Enhanced Achievements.** This theme's `position` still decides Big Picture's one toast place, achievements included, unless Enhanced Achievements' new "Force achievement position in Big Picture" is on (ADR-0049).
- **Big Picture: a toast no longer flickers when another one arrives behind it.** The style followed the newest toast to arrive, not the one on screen, so a queued toast changed the showing one's look and restarted Steam's slide-in, and an achievement drawn by Enhanced Achievements could get this theme's look. The style now follows the toast Steam actually puts on screen, and is in place before it is drawn.

### Changed

- **One style for every notification.** A theme is `settings` plus the style keys at the top level; `default`, `categories` and `types` are gone (a theme that still has them loads with a warning and they are ignored), and `display_time_ms` moved into `settings`. The bundled `steam_midnight` theme is one style now.
- **Preview is one button** that shows a random one of Steam's test toasts, a different type each press (downloads, clips, recording, cloud sync, battery, firmware update, playtime; achievements too when Enhanced Achievements does not draw them). Exports `preview(id?)` and `previewIds()` replace `previewCategory`.
- **`margin` and `padding` use CSS's clockwise order** (same as Enhanced Achievements): `[10, 5, 4, 7]` is 10 top, 5 right, 4 bottom, 7 left.

- Internals rebuilt on Enhanced Achievements' architecture (ADR-0047, docs/enhanced-notifications/architecture.md): one surface per thing written into Steam (`style`, `sound`, `duration`, `preview`), the same notification hook file as Enhanced Achievements (checked by a test, and proven to work with it in either load order), and an architecture test. No change to themes or settings.
- Settings panel laid out like Enhanced Achievements' (same rows and spacing): Theme, Preview notifications, General and Reset sections; the theme dropdown takes the full row; a theme problem shows under it instead of a status line. The controls are disabled while Steam's toasts are off.

### Added

- **Toast position, animation and spacing**, with Enhanced Achievements' names and values (themes.md): `settings.position` (`top_right`, `top_left`, `bottom_right`, `bottom_left`, `top_center`, `bottom_center`), `settings.animation` (`slide`, `fade`, `up`, `down`, `ps5`, `none`, or `{ "in", "out" }`), and `popup.margin`, `popup.padding`, `popup.gap`. On desktop and in the in-game overlay Steam's stacking is kept; in Big Picture the toast moves through Steam's own toast placeholder and the animation replaces Steam's. Achievement toasts drawn by Enhanced Achievements keep that plugin's style (and, on desktop, its position). New kill switch `placement`. Live checks `tests/placement.mjs` (desktop) and `tests/bigpicture.mjs`.
- **Safety net:** each feature can be switched off without uninstalling (`disabledFeatures` setting, e.g. `style,sound`; no panel control), a feature that fails 5 times in a session switches itself off until Steam restarts, and two unclean starts in a row start the plugin in safe mode (Steam's own toasts). `safetyDiagnostics()` and `surfaceStatus()` exports.
- `npm run test:live` runs every live check with settings snapshotted and restored; new live check `tests/safety.mjs`.
- **JSONC themes:** themes can be `.jsonc` (or `.json`) with `//` and `/* */` comments and trailing commas; `name.jsonc` wins over `name.json` in the same folder. Same rules as Enhanced Achievements.
- Sound paths may be absolute (`C:/...`) for personal themes; this worked before and is now documented in themes.md.
- README: Troubleshooting (kill switches, safe mode).

### Fixed

- Toast types Steam has but the SDK does not name (the firmware update toast, type 61) were left unstyled; they get the theme now.
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
