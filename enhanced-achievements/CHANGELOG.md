# Changelog

All notable changes to **Enhanced Achievements**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The settings panel now warns and greys out when Steam's toast
  notifications are off entirely** (Steam Settings -> Notifications),
  reactively — the whole panel disables itself (checked every 2s while the
  panel is open; cheap, no new webpack scan) as soon as it detects Steam's
  toasts are off, and clears automatically once they're back on. Previously
  this was a static one-line disclaimer shown regardless of relevance;
  that's now replaced by this always-current state, hidden entirely when
  toasts are on or when the state can't be detected on this Steam build.

### Changed

- **Every settings-panel row now uses `bottomSeparator="none"` except the
  last row in its group**, instead of each component's own default
  separator/spacing. This fixes two things: the group header no longer sits
  flush against the row above it (each group's gap now comes only from
  `DialogControlsSection`'s own margin, not stacked with per-row spacing),
  and every group's rows are now evenly spaced instead of some groups (e.g.
  Screenshots & Recordings, mostly sliders) looking more spread out than
  others (e.g. Theme, mostly buttons).
- **The shipped default is now "Steam default" (`theme: ""`), not a bundled
  theme.** A fresh install shows Steam's own stock toast and chime until a
  theme is picked. The settings panel's Theme dropdown lists "Steam default"
  as its first option, above every theme file. Screenshot/recording captures
  are unaffected — they're independent of whether a theme is selected. This
  also clarifies the modularity a theme's own fields already had: a theme
  file can set only `sound` (or only `icons`, etc.) and leave the rest at our
  defaults, but "Steam default" is the only way to keep Steam's *own* native
  banner rendering — selecting any theme file always replaces the banner
  with ours, styled by whatever fields that theme sets.
- **Themed banner and sound are no longer separate on/off settings.** They now
  follow the active theme automatically: the banner is themed whenever a
  theme is loaded, and sound is themed per tier only if the theme defines a
  clip for it (falling back to Steam's own chime otherwise, same as before
  for a missing/undecodable sound). `banner.enabled` / `sound.enabled` are
  removed from the settings schema.
- **"One achievement at a time" renamed to "Achievement queue"**, with a
  shorter description.
- **"Preview a tier" renamed to "Preview Achievements".**
- **"Captures on unlock" renamed to "Screenshots & Recordings".**
- **Settings panel now groups every row under a section header** (Theme,
  Preview Achievements, General, Screenshots & Recordings), using Steam's own
  `DialogControlsSectionHeader` for consistent (uppercase, spaced) styling —
  no custom CSS.
- **Tier preview labels and rules are now theme-driven, not hardcoded.** The
  bronze/silver/gold names were a specific theme's icon choice, not part of
  the schema, so labels are generic (Normal/Magic/Rare/Exceptional); the
  "Normal" rule now reads "Everything below Magic's N%" when the active
  theme sets a magic threshold, instead of always saying "everything else".
- Shortened several settings descriptions (theme reload/open, capture
  toggles) and dropped the theme dropdown's "(yours)" suffix on user themes.

### Removed

- **The static Steam-toast-notifications-disabled disclaimer** in the settings
  panel (superseded by the reactive warning+greyout above — same information,
  now only shown when actually relevant).
- **The "no game is being recorded right now" capture status line.** It added
  a `recordingDiagnostics()` call for information the settings panel doesn't
  need to police; `recordingDiagnostics` remains exported for diagnostics/CDP
  use.
- **The "Test captures" button.** `fireTestUnlock`/`runningGameAppid` remain
  as exports for the live regression test (`tests/captures.mjs`); there is no
  longer a settings-panel control for it.

### Added

- **`animation.in` / `animation.out`**, independently settable entrance and
  exit transitions (`"animation": {"in": "slide", "out": "fade"}`), instead of
  one name that had to cover both. A bare string (`"fade"`) still means both
  states use it — no behaviour change for existing themes.
- **`"ps5"` animation preset**: slides in from the screen edge the banner is
  anchored to (and back out the same way) plus a fade, like a PS5 trophy
  popup. `top_center`/`bottom_center` slide vertically instead.
- **One-at-a-time achievement toast queue.** Only one themed banner is ever
  visible; a second (or later) unlock waits for the current one's exit
  animation to finish, then shows 100ms later — not the theme's configured
  delay. Bounded to 5 queued toasts; past that, a new unlock shows immediately
  rather than risking Steam auto-hiding an unshown popup on its own timer.
  **Off by default** — new setting **"One achievement at a time"**
  (`queue.enabled`); off falls back to Steam's own default (toasts can show
  side by side, as before).

### Changed

- **The `recording.duration_s` (clip length) slider now starts at 0 s**, was 5 s.
- **Every settings-panel row now shows its control above its description**
  (SDK `layout="below"`, no custom CSS) instead of the two overlapping on one
  line.

### Removed

- **The outline glow effect** (`banner.glow`'s `spread`/`pulseMs`). It rendered
  clipped by the banner's own `overflow: hidden` (looking like an inner
  effect, not an outline), and the toast popup window is resized to exactly
  the banner's size, leaving no room for a glow to visibly bleed past the
  banner's edge without a larger, separate change to that resize/placement
  math. `glow` is still parsed (no warning, no theme-file changes needed) but
  has no visual effect.

### Fixed

- **The ripple now starts at the icon's own edge and expands outward**,
  instead of already 35% inflated and drifting further — a ring collapsed
  onto the icon's outline, like an object breaking the surface of water.
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
