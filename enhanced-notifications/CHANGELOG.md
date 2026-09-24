# Changelog

All notable changes to **Enhanced Notifications**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Restyles Steam's own toast windows (no content replaced): popup background,
  border, glow, watermark, font, text, logo, header icon, from JSON themes with
  `default` -> category -> type inheritance. Rules come only from resolved CSS
  class maps (all modules per key) and are scoped to `body[data-en-type]`.
- Sound per type or category (custom file or `false` to mute), respecting
  Steam's own mute setting. Display time per type.
- Coexistence with Enhanced Achievements through its `claims()` export.
- Settings panel: theme, reload, open folder, per-category preview, toggles, reset.

### Verified live (desktop)

Downloads, recording, system and achievement toasts styled; sound mute,
replacement and fallback; display time; settings round-trips; achievement
toasts left to Enhanced Achievements.

### Known limits

- Friend and message toasts not verified (Steam did not show them with the
  current Friends notification settings).
- Big Picture and in-game overlay not yet verified.
