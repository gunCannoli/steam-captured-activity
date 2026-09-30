# Changelog

All notable changes to **Enhanced Achievements**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Reset Achievements** in the settings panel's Reset group: a games filter, a dropdown of games with unlocked achievements and a **Reset** button that warns first that the game will lose all its achievements. Its own kill switch, `reset` in `disabledFeatures`.
- **Kill switches, error budget and safe mode** (migration E0a, ADR-0043). Each part that writes into
  Steam (`banner`, `sound`, `duration`, `completion`, `captures`) can be switched off with the
  `disabledFeatures` setting and switches itself off after 5 errors in a session; Steam's own toast,
  chime or duration returns for it, and `claims()` hands it to enhanced-notifications. Two starts in a
  row that do not end cleanly start the next one in safe mode (nothing hooked). `safetyDiagnostics()`
  shows the state. See docs/enhanced-achievements/architecture.md.
- `npm run test:live` runs every live check with the stored settings snapshotted and restored; `tests/architecture.test.ts` enforces one owner per Steam target, the import ratchet, pure files, RPC registration and the copies shared with steam-cartridges and enhanced-notifications (migration E0b).

- Internal: the notification types, the event bus and the surface contract moved into `frontend/kernel/`; the rarity tier of a toast is now a pure, unit-tested function (migration E1a). No behaviour change; new feature id `toasts` for the later synthetic-toast switch.

### Fixed

- The first achievement banner after opening Big Picture was invisible (its toast window's animation clock had not started, so the entrance and exit both finished at once); banner animations that start on that frozen clock are now restarted once the window paints. `tests/bigpicture.mjs` now requires the banner to reach full opacity, and `tests/captures.mjs` no longer fails once the capture log is full.
- `claims()` is O(1) again: it no longer walks the jsx wrapper chain (and could call the jsx runtime)
  on every call, which enhanced-notifications makes on every toast.
- `tests/queue-stress.mjs` no longer resets your theme to "Steam default" when it ends.
- Live tests no longer disturb each other: `settings-sound.mjs` restores the audio wrappers it installs and checks the toast duration against the banner's full lifetime, `queue-stress.mjs` uses its own globals, and `npm run test:live` waits for the previous check's toasts to close.

## [1.0.0] - 2026-09-25

### Added

- **JSONC themes.** Theme files may be `.jsonc` or `.json`, and both accept
  `//` and `/* */` comments and trailing commas (`theme/jsonc.ts`; parse
  errors still point at the right line). With both `name.jsonc` and
  `name.json` in one folder, the `.jsonc` wins.
- **`themes/theme.jsonc`**: every option, with a comment explaining each
  array position, range and default, in a working theme ("theme" in the dropdown).
- **`themes/ps5.jsonc`** replaces `ps5.json`: commented, explicit pairs,
  resolves identically (the no-op `glow` and unused `layout.text` dropped).
- Theme load failures and theme warnings show under the theme dropdown
  (only when there is a problem; nothing surfaced them since the status line
  was removed).


- **The settings panel now warns and greys out when Steam's toast
  notifications are off entirely** (Steam Settings -> Notifications),
  reactively — the whole panel disables itself (checked every 2s while the
  panel is open; cheap, no new webpack scan) as soon as it detects Steam's
  toasts are off, and clears automatically once they're back on. Previously
  this was a static one-line disclaimer shown regardless of relevance;
  that's now replaced by this always-current state, hidden entirely when
  toasts are on or when the state can't be detected on this Steam build.


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

- The 100% completion toast and the unlock captures now run one macrotask after the toast is shown, never inside Steam's own call; the sound, duration and synthetic-toast code sit behind their own switches, and a feature that trips its error budget has its Steam patch removed, not only gated (migration E1b).
- The banner and the capture code are surfaces too: `frontend/surfaces/banner/` and `frontend/surfaces/captures/` (files moved, behaviour unchanged); `surfaceStatus()` reports which installed (migration E1c).
- A banner is admitted to the toast scheduler from its mount effect, not from a render, and a queued toast's sound waits on the scheduler through `whenShowing` (migration E2).
- README: a Troubleshooting section for `disabledFeatures`, `safetyDiagnostics()`, `surfaceStatus()` and safe mode (migration E3).
- Removed the unused `toastWarning()`; `tests/settings-sound.mjs` restores the user's stored settings when run alone.

- **`[v]` in `scale`, `margin`, `padding` and `gap` now means both values**,
  like a bare `v` (`[5]` = `[5, 5]`); `[a, b]` still sets each. Previously
  `[5]` padding was `[5, 10]`.
- **Theme dropdown is three rows**: "Available themes", the description,
  then the dropdown across the full row width.
- With a theme loaded, Steam's achievement toast duration is the banner's
  whole lifetime (entrance + `display_time_ms` + exit), so Big Picture, where
  Steam times the toast, no longer cuts the exit animation short (verified live).


- **Settings panel rebuilt on `PanelSection`/`PanelSectionRow`, not
  `DialogControlsSection`/`DialogControlsSectionHeader`.** Two earlier
  attempts to fix the boxed-card look and uneven group spacing by tweaking
  `Field` props (`bottomSeparator="none"`, then also `transparentBackground`)
  while keeping `DialogControlsSection` did **not** work — confirmed live by
  screenshot both times, despite each being individually plausible from
  reading the SDK's resolved component source. The actual issue was the
  container: `DialogControlsSection` is Steam's full Settings-*dialog*
  layout; this repo's own docs/knowledgebase.md already documented `Panel`
  (`PanelSection`/`PanelSectionRow`) as "the titled-section container used
  in Settings and Quick Access" — the sidebar context a Millennium plugin
  panel actually renders in. Each row is now a plain `Field` (label +
  description) wrapping a bare `Toggle`/`Dropdown`/`DialogButton`, matching
  Millennium's own settings UI for themes (`ThemeEditor.tsx`) instead of the
  combined `ToggleField`/`ButtonItem`/`DropdownItem` wrappers. Sliders keep
  `SliderField` (no bare `Slider` component exists). No more per-row
  `bottomSeparator`/`transparentBackground` hacks.
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


- **The `recording.duration_s` (clip length) slider now starts at 0 s**, was 5 s.
- **Every settings-panel row now shows its control above its description**
  (SDK `layout="below"`, no custom CSS) instead of the two overlapping on one
  line.


- **`position` values are now snake_case** (`top_right`, `bottom_center`, …)
  for consistency with every other multi-word value in the schema. Pre-alpha,
  so the old run-together spellings (`topright`, …) are a breaking change, not
  deprecated — update your theme files.
- **`text-align` is now `text_align`**, for the same reason and with the same
  breaking change.
- **`applyPosition()` / `SetNotificationPosition` removed.** It rewrote
  Steam's global (all-toasts) notification position and did not reliably take
  effect; window placement is now done per-toast-popup only (see Fixed, above).

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


- **The outline glow effect** (`banner.glow`'s `spread`/`pulseMs`). It rendered
  clipped by the banner's own `overflow: hidden` (looking like an inner
  effect, not an outline), and the toast popup window is resized to exactly
  the banner's size, leaving no room for a glow to visibly bleed past the
  banner's edge without a larger, separate change to that resize/placement
  math. `glow` is still parsed (no warning, no theme-file changes needed) but
  has no visual effect.

### Fixed

- **Themed banners randomly fell back to Steam's toast** when any other toast
  appeared (worst with the queue, whose toasts live longer). Millennium core
  restores a stale `jsx` whenever a toast window renders, dropping every
  plugin's jsx patch until the 5 s re-check. `steam/jsx-hook.ts` now heals
  within a microtask of any write (docs/plugins.md § Sharing the jsx runtime).
  Same fix shipped to steam-cartridges.
- A game-completing unlock no longer captures twice (the synthetic 100% toast
  skipped captures).
- "Steam default" restores Steam's own toast duration even when
  enhanced-notifications wrote it first (shared pristine-duration record).
- `"sound": null` no longer warns; it means Steam's chime.
- A tier that overrides only `text.title`/`text.desc` words (`exceptional`)
  keeps the style inherited from `normal` instead of the default style.
- `npm run check` passes again (unused `status` in the settings panel).
- Tests: `captures.mjs` restores exactly the settings stored before it ran
  (it used to wipe them); `tiers.mjs` waits for a clear screen per case;
  `bigpicture.mjs` also checks the exit animation completes.

- **Achievement queue fell apart under rapid unlocks/previews** (lost
  position and style). Root causes: `Banner` returned `null` for a queued
  toast *before* its remaining hooks, so when its turn came React threw
  ("rendered more hooks") and the error boundary showed Steam's unpinned
  stock toast; a queued popup sat empty at Steam's stack position showing
  Steam's bare gradient box; a toast promoted while the previous popup was
  still closing was pinned to stack slot 1; Steam's own timer closed queued
  popups before their turn; and an `animation.out: "none"` theme never
  released the queue (no `animationend`). Rebuilt on a toast scheduler
  (`banner/queue.ts`, `waiting → showing → done`, own timers) that is the
  single owner of banner lifetime. The banner holds its desktop popup open
  through Steam's own `fnNotificationResolved` until it is done (with a cap),
  so the entrance, `display_time_ms` and exit are exact. A waiting popup is
  pinned as an invisible 1×1 window with Steam's chrome hidden. With the queue
  on, every banner uses the anchor slot. Animation lengths now come from one
  table (`banner/timing.ts`) shared by the CSS and the scheduler.
- **Queued toasts' sounds all played at once on arrival**; each now plays
  when its banner appears.
- **Rapid tier previews could swap tiers** (a single time-window `forced`
  tier was consumed by whichever toast rendered first). Previews now post
  their own payload with the tier in the id (`EA_PREVIEW_<tier>`), dressed in
  one of the game's real highlighted achievements (cached per app). Captures
  skip previews by id, replacing a 10 s suppression window that could also
  swallow a real unlock right after a preview.
- **"Steam default" did not look like Steam's toast** when
  enhanced-notifications is installed: `claims()` returned false for every
  feature with no theme loaded, so enhanced-notifications painted its own
  border, radius and glow on achievement toasts. While this plugin's hooks
  are live it now owns achievement toasts: "Steam default", a failed theme,
  and a theme without a sound or `display_time_ms` all mean "Steam's own".
  Only the banner is handed back, and only if a theme is loaded but the
  toast patch is not live.
- A theme reload while a toast is on screen no longer changes that toast
  mid-flight (theme snapshotted per toast).
- The synthetic 100% toast is scheduled at most once per unlock (Steam can
  call `PlayNotificationSound` more than once per toast).


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

### Tests

- `tests/queue-stress.mjs` (new, live): "Steam default" stays stock with
  enhanced-notifications installed; a 5-preview burst with the queue on
  shows exactly one banner at a time, at one spot, in order, with its own
  tier, never Steam's fallback, one sound per toast about 5 s apart; with the queue off
  every toast keeps its own tier.
- `tests/queue.test.ts` rewritten for the scheduler (FIFO under bursts,
  idempotent remounts, timer-driven end, gap, overflow).
- `tests/tiers.mjs`: the completion case updated to the synthetic-100%
  design (since `fe25714`): the completing unlock keeps its rarity tier,
  then a separate exceptional toast must appear.

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
