# enhanced-notifications architecture

**This doc's job:** how `enhanced-notifications` is built today: its layers, who owns each Steam target, its safety
net, the achievement banner it carries, and how to add a feature without breaking another. Decisions:
[ADR-0043](decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net) (the
architecture), [ADR-0047](decisions.md#adr-0047-enhanced-notifications-uses-enhanced-achievements-architecture-and-shares-its-notification-hook)
(applied here) and [ADR-0050](decisions.md#adr-0050-enhanced-achievements-merges-into-enhanced-notifications) (enhanced-achievements
merged into this plugin; its history is in git, `git log -- enhanced-achievements`).

## Layers

| Layer | Folder | Job |
| --- | --- | --- |
| Safety | `frontend/safety/` | Kill switches, error budget, boot sentinel / safe mode |
| Kernel | `frontend/kernel/` | The `Surface` contract, the notification shape and the synthetic achievement ids, the event bus, the toast selector type, the Reset Achievements types |
| Pure domain | `theme/{theme,achievements,schema,placement,jsonc,draft}.ts`, `banner/{geometry,timing,queue,styles}.ts`, `capture/plan.ts`, `surfaces/*/{sound,duration}.ts`, `surfaces/preview/pick.ts`, `surfaces/style/type-source.ts`, `surfaces/toasts/completion.ts`, `surfaces/reset/reset.ts`, `sensors/unlock/unlock.ts` | Themes (one style for every notification, plus the optional `achievements` block) and their CSS; where a desktop toast goes; the banner's geometry, timing and scheduler; capture planning; the sound decision; the duration plan; the random preview pick; the Theme Creator's theme document (`draft.ts`). No Steam, SDK, React or logger |
| Steam access | `frontend/steam/` | Finding Steam's objects (`notification-store.ts`, `selectors.ts`, `webpack.ts`, `modal.ts`), the one `PlayNotificationSound` hook (`notification-hook.ts`), the `PopNextToastNotification` wrapper (`toast-pop.ts`), the jsx runtime hook shared with steam-cartridges (`jsx-hook.ts`), the toasts-off flag, Steam's UI mode (`ui-mode.ts`) |
| Sensor | `frontend/sensors/unlock/` | Sees an achievement toast shown and emits `achievement.unlocked` once, one macrotask later |
| Surfaces | `frontend/surfaces/` | The only code that writes into Steam: `style` (with `style/toast-window.ts`), `sound`, `duration`, `preview`, `banner`, `toasts`, `captures`, `reset`. `surfaceStatus()` shows which installed |
| Composition root | `frontend/index.tsx` | Start-up order, wiring, `bannerDraws`, the public exports |
| Settings panel | `frontend/settings/` | `settings-panel.tsx` (the sections), `rows.tsx` (rows and spacing, [guardrail 18](plugins.md#18-settings-panel-layout-reference-enhanced-notifications)), `creator/` (the Theme Creator modal; `creator/model.ts` is pure) |

## One theme, two looks

A theme is the notification style (`settings`, `popup`, `text`, `popup_icon`, `sound`, ...; `theme/theme.ts`) and an
optional `achievements` block (`theme/achievements.ts`). `resolveTheme` resolves both, the block inheriting the rest
([ADR-0052](decisions.md#adr-0052-one-theme-one-look-achievements-inherit-the-themes-settings-popup-and-text)): the
theme's `settings` are the banner's, its card is layered (`popup`, the block's popup keys, `normal`, the tier), and its
text styles are `text.title` / `text.body`. A block that cannot be used is a warning (achievement toasts then get the
notification style), never a failed theme. `theme/schema.ts` holds the names both halves share (positions, animations,
edges, text alignments).

`theme/active-theme.ts` loads the theme once per change: `activeTheme()` (the whole theme, its CSS cached),
`achievementTheme()` (the block, with its icons as data URLs and each tier's decoded sound; null without the block),
`tierFor(n)` (memoised per notification) and `themeIssues()` (shown in a popup after a load the user started).

**Who draws an achievement toast.** `bannerDraws(eType)` in `index.tsx` is true when the eType is the achievement type,
the theme has an `achievements` block, the jsx patch is live and the `banner` switch is on. Then
the banner draws it (`surfaces/banner`); the style surface gives its window no `data-en-type`, its desktop remap passes
the popup through, and in Big Picture the placeholder takes the banner's corner. Otherwise the achievement toast is
styled like every other toast. The surfaces get `bannerDraws` injected: a surface never imports another.

**Desktop and Big Picture** ([ADR-0068](decisions.md#adr-0068-a-theme-can-have-its-own-big-picture-look-bigpicture-block-enhanced-notifications)).
A theme's optional `bigpicture` block is merged over the rest in Big Picture (`mergeOverride`: objects key by key, other
values whole, `null` removes); `resolveTheme` returns it as `ResolvedTheme.bigPicture`. Every read in
`active-theme.ts` takes a mode, defaulting to Steam's current one (`steam/ui-mode.ts`, injected by `index.tsx` through
`setModeSource`), and caches per mode; both looks share one asset load. The style surface picks per window: Big Picture's
toast views get the Big Picture CSS and placement, every other window the desktop CSS. A mode switch re-runs the
theme's listeners only when the theme has the block.

## Safety net

| Id | What it switches | Off means |
| --- | --- | --- |
| `style` | The scoped `<style>` and `body[data-en-type]` in toast windows | No toast gets the attribute, so no rule matches: Steam's look. Uninstall also removes the `<style>` |
| `sound` | The theme's sounds (a tier's for an unlock) or mute, and a queued banner's sound timing | Steam's chime |
| `duration` | Writing each type's toast duration (the achievement type's from the banner's lifetime) | Nothing written (a value already written stays until the next theme change or restart); uninstall restores Steam's value for the types it wrote |
| `preview` | The settings panel's random Preview | The button does nothing |
| `placement` | Moving toasts to the theme's place (desktop and overlay popups; Big Picture's placeholder, the banner's corner while it shows), and holding desktop popups still during a theme `animation` | Steam places every toast that is not a banner. Part of the `style` surface: `style` off also turns it off |
| `banner` | The themed achievement banner (jsx replacement of Steam's toast dispatcher, popup hold and pin) | Steam's achievement toast, with the notification style |
| `completion` | The synthetic 100% toast after a game-completing unlock | No 100% toast |
| `captures` | Screenshot and clip on unlock | No captures |
| `toasts` | Posting synthetic achievement toasts (tier previews, the 100% toast, the capture test) | None posted |
| `reset` | The settings panel's Reset Achievements | The section is disabled and `reset()` refuses |
| `queue` | The notifications queue: `displayToastAlone` on every type config while `queue.enabled` is on | Steam's own value for every type (restored at once, also on uninstall) |

- **User switch:** `disabledFeatures` setting, comma-separated ids, no panel control. From the SharedJSContext console:
  `PLUGIN_LIST['enhanced-notifications-dev'].setSetting('disabledFeatures', 'style,sound')`. Read live.
- **Error budget:** 5 errors in one session switch a feature off until Steam restarts, and its surface is uninstalled.
  Counted by the fail-open catch blocks: the hook's sound-handler catch (`sound`), the injector's per-window and Big
  Picture scan catches (`style`, `placement`), the per-popup `MoveTo` wrapper (`placement`), `apply()` in the duration
  surface (`duration`), `preview`, the jsx handler and the banner's error boundary (`banner`), the completion check,
  `onUnlock` (`captures`), Reset Achievements (`reset`), and an install that throws.
- **Safe mode:** the boot sentinel (`enhanced-notifications.boot` in SharedJSContext `localStorage`) counts starts that did
  not end cleanly. Two in a row: the next start hooks nothing, and 60 error-free seconds clear it.
- **Big Picture debug trace** (`surfaces/style/bp-debug.ts`, off by default, not persisted):
  `debugBigPicture({ enabled: true, echo: true })` records what the style surface saw and did for Big Picture's toast
  view; `bigPictureTrace()` reads it; `debugBigPicture({ typeSource })` switches where the toast type comes from;
  `tests/probes/bp-toast-trace.mjs` drives both ([steam-debug.md Trap 13](steam-debug.md)).
- **Diagnostics:** `PLUGIN_LIST['enhanced-notifications-dev'].safetyDiagnostics()` → `{ safeMode, disabled, tripped, errors }`;
  `surfaceStatus()` → which surfaces installed and why one did not.

## The notification hook and the unlock event

`steam/notification-hook.ts` is the one wrapper of `NotificationStore.prototype.PlayNotificationSound`. It decides
nothing: it tells `onShown` listeners that Steam showed a toast and hands the sound to the one sound handler
(`surfaces/sound`). It composes with a second copy of itself (another plugin, or the released and the `-dev` copy
loaded together): calls on any object but the store pass straight through, a handler that does not want a toast calls
`playSteam()`, which reaches whatever it wrapped, and `uninstall()` restores Steam's method only when it is on top
(`tests/notifications.test.ts`).

The unlock sensor (`sensors/unlock`) is an `onShown` listener: one `achievement.unlocked` per real (or test) unlock,
emitted one macrotask after Steam's call, never for a tier preview or the 100% toast. The 100% toast
(`surfaces/toasts`) and captures (`surfaces/captures`) subscribe to it; nothing else runs inside Steam's call.

**Sound.** One decision (`surfaces/sound/sound.ts`): an unlock whose banner is queued is silent until its turn; an
unlock plays its tier's clip; otherwise the theme's notification sound (`false` mutes), else Steam's chime.

## Banner lifetime

`banner/queue.ts` (pure) is the only owner of when a banner starts, waits, shows and ends.

- **Start:** `ThemedBanner` renders an invisible shell (`peek(key) ?? 'waiting'`) and admits the toast in its mount
  `useLayoutEffect`. A render never starts work ([guardrail 17](plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components)).
- **Turn:** with the queue on, one banner shows at a time; the next starts 100 ms after the previous ends.
- **Sound:** the sound surface asks the scheduler: `peek`, then `whenShowing(key, onShow)`.
- **End:** the scheduler's own timer, a click, or the banner unmounting; the popup is held open until then
  (`fnNotificationResolved`, desktop only). The achievement type's `toastDurationMS` is the banner's whole lifetime, so
  where Steam times the toast (Big Picture) the exit is never cut short.

## Banner look: CSS in `frontend/banner/styles.ts`

The banner's fixed styling (`BANNER_CSS`) travels with the banner into whichever toast window renders it. Values a
theme sets arrive as CSS variables on `.ea-banner` (`--ea-pad`, `--ea-gap-x`, `--ea-in-ms`, `--ea-hover-bg`, ...);
the rest is fixed there:

| What | Where | Value |
| --- | --- | --- |
| Icon ripple distance (the PS5 water ripple a theme turns on with an icon's `ripple ms`) | `@keyframes ea-ripple`, the `100%` frame: `transform: scale(...)` | `1.4` (the icon's size times 1.4; it starts at `0.92`). Higher spreads further toward the text |
| Ripple ring | `.ea-ripple`: `border`, `filter: blur(...)`, easing in `animation` | 1.5 px white at 85%, 0.65 px blur, both scaled with the icon |
| Hover highlight | `.ea-banner::after`; `.ea-banner:hover::after { opacity }` | 0.5 opacity, Steam's gradient unless the theme sets `settings.hover` |

A change here is a frontend change: rebuild and deploy with `dev.ps1` (Steam restarts).

## Notifications queue

`queue.enabled` ("Notifications queue") shows one toast at a time, of every kind. Steam already has the rule: the
desktop and in-game overlay toast stack (module `48197`) pops the next toast only while no toast on screen is
`displayToastAlone`, and holds a `displayToastAlone` toast until the stack is empty (`NotificationStore`
`BAnyToastDisplayAlone` / `BNextToastDisplayAlone`, `_e(t) = typeConfig[t.eType].displayToastAlone === true`). The
`queue` surface writes `true` on every type config while the setting is on and Steam's own value otherwise (pristine
values kept in a global WeakMap, so a second copy of the plugin restores Steam's, not the first copy's). Steam sets it
on types 33-35 itself. Verified live 2026-10-02: three test toasts at once opened 3 windows stock and never more than
1 with the queue on (`tests/notifications-queue.mjs`). The achievement banner's own scheduler (`banner/queue.ts`)
still orders banners and their sounds; with Steam serializing toasts it rarely has a second banner waiting.

**The stall, and the watchdog.** Steam's stack pops only while its 5 s cache of
`DefaultMonitorHasFullscreenWindow` is fresh, and refetches it only when an input flips; with toasts shown one at a
time nothing flips, so a toast longer than 5 s left the next one waiting forever (found live 2026-10-02, 49 toasts
stuck; steam-components.md). While the queue is on, the `queue` surface refetches that query through its own observer
(`steam/toast-stack.ts`) the moment the stack's on-screen list empties with toasts still waiting: Steam signals it with
`NotificationStore.SetContextRenderingToast(context, false)`, wrapped as an own property of the store like
`PopNextToastNotification`. So queued toasts follow each other with almost no gap (achievement banners ~5.4 s apart,
their lifetime). A watchdog looking once a second does the same if that signal is ever missed; turning the queue off
with toasts waiting refetches once too. The live test runs with Steam default (5.6 s per toast) so it
would catch a stall.

## Toast position and animation

Desktop and the in-game overlay open one popup per toast; Steam's stack moves each one every frame of its slide
in, slide out and restack through the popup's own `SteamClient.Window.MoveTo` ([steam-components.md § Desktop
toast stack](steam-components.md)). Two writers wrap that property, in a fixed order (ADR-0050):

1. **The remap** (`surfaces/style/toast-window.ts`) wraps it when the popup opens. At Steam's first move it reads the
   popup's notification type from a fiber, gives the window its own `data-en-type` and `--en-display-ms`, and turns
   each of Steam's moves into an offset from Steam's corner applied from the theme's corner (`theme/placement.ts`).
   With a theme `animation` the offset never goes past the slot and is held once Steam's slide out starts.
2. **The banner's pin** (`surfaces/banner/window-pin.ts`) wraps on top of it, for the banner's own popups only, when
   the banner mounts: every move lands on the banner's computed place. The remap passes those popups through
   (`bannerDraws`), so the pin's calls reach Steam unchanged.

`tests/architecture.test.ts` checks that these two files, and no others, assign a popup's `MoveTo`.

**Big Picture** (verified live 2026-10-01, [steam-components.md § Toast windows](steam-components.md)) has one
toast view that follows a `position: fixed` `GamepadToastPlaceholder` div in the Big Picture window, re-measured
when a toast shows. The injector puts `<style id=enhanced-notifications-placement>` (`buildPlaceholderCss`) in each
window holding a placeholder: the theme's `position` and `popup.margin`, or, while the banner draws the toast on
screen, the theme's position and the tier's `margin`. It is rewritten at each pop, before Steam measures.

**The type of the toast on screen** (Big Picture's one window, and a desktop popup before its own type is read)
comes from `NotificationStore.PopNextToastNotification`, wrapped as an own property of the store instance
(`steam/toast-pop.ts`): Steam calls it when it hands a toast to a toast view, inside a React state updater, so the
type and the placement `<style>` are in place before that toast renders. Without that method the type follows
`onShown`, a frame late. Never the store's current-toast value: it changes when a toast **arrives**, so a toast queued
behind the one on screen restyled it ([steam-components.md § Big Picture toast view](steam-components.md#big-picture-toast-view-how-steam-places-and-shows-it)).
Which signal is taken is a pure decision (`surfaces/style/type-source.ts`); `arrival` survives only as a debug switch.

**Unnamed types.** Steam has toast types the SDK's `EClientNotificationType` lacks (the firmware update toast is
eType 61; the enum ends at 58). Start-up asks Steam for a config up to 32 past the enum's end and names those
`Type<n>`. The achievement type is found among the configs by its protobuf class (`CClientNotificationAchievement`).

## Steam targets and their one owner

| Steam target | Owner (file) | Guardrail |
| --- | --- | --- |
| `NotificationStore.prototype.PlayNotificationSound` (wrapper) | `steam/notification-hook.ts` | [2](plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced), [17](plugins.md#17-a-render-never-starts-work-a-refresh-never-leaves-its-own-components) |
| `NotificationStore` instance `ChooseSound` (for one call) | `steam/notification-hook.ts` | 2 |
| The hook's sound slot | `surfaces/sound/index.ts` | 2 |
| `NotificationStore.OnNotification` (synthetic achievement toasts) | `surfaces/toasts/post.ts` | — |
| Each type config's `toastDurationMS` | `surfaces/duration/index.ts` | — |
| Each type config's `displayToastAlone` (notifications queue) | `surfaces/queue/index.ts` | — |
| The desktop toast stack's fullscreen query (`refetch` through its observer, only when stuck) | `steam/toast-stack.ts`, called by `surfaces/queue/index.ts` | — |
| `NotificationStore` instance `SetContextRenderingToast` (own property: the stack went idle) | `steam/toast-stack.ts`, installed by `surfaces/queue/index.ts` while the queue is on | 2 |
| Toast windows: `<style id=enhanced-notifications-theme>` and `body[data-en-type]`; `Millennium.AddWindowCreateHook` | `surfaces/style/injector.ts` | [12](plugins.md#12-popup-hooks-do-not-see-every-window) |
| Big Picture window: `<style id=enhanced-notifications-placement>` | `surfaces/style/injector.ts` | — |
| `NotificationStore` instance `PopNextToastNotification` (own property) | `steam/toast-pop.ts` | 2 |
| Each desktop / overlay toast popup's own `SteamClient.Window.MoveTo`: the remap | `surfaces/style/toast-window.ts` | 2 |
| The same, for a banner popup: the pin (wraps the remap) | `surfaces/banner/window-pin.ts` | — |
| `react/jsx-runtime` `jsx`/`jsxs` (toast dispatcher) | `surfaces/banner/toast-patch.ts` via `steam/jsx-hook.ts` | 2, [Sharing the jsx runtime](plugins.md#sharing-the-jsx-runtime-between-plugins) |
| Notification `fnNotificationResolved` (banner popup hold) | `surfaces/banner/themed-toast.tsx` | 17 |
| `NotificationStore.Test*` (previews) | `surfaces/preview/index.ts` | — |
| Game Recording RPCs; `g_GRS.StartRecording` / `StopRecording` / `DeleteClip` (manual recording on unlock, ADR-0061) | `surfaces/captures/recording.ts` | — |
| `SteamClient.Console.ExecCommand` (`achievement_clear`) and steam-cartridges' `resetAchievements` / `achievementResetSources` / `resetAchievementsWithSources` / `achievementsResettable` | `surfaces/reset/index.ts` | — |

## Settings panel

Sections: Theme (dropdown across the full row, "Steam default" first; Reload, Themes folder; load problems in a
popup), Preview Notifications (a random notification; "Select Notification": a dropdown of the preview types and a
Preview button on one card), Achievements Preview (one row per tier, only with an `achievements` block; then a random
preview leaves achievements out), Achievements (queue, screenshot, clip), Reset (defaults, Reset
Achievements: a non-Steam game's confirm popup lists where its unlocks also live, with an "Also reset ..." toggle per
resettable source and a warning built by `resetWarning` in `kernel/reset.ts`, ADR-0054). There are no style, sound or display-time switches: a theme that leaves a key out gets Steam's own, and
"Steam default" (`theme` = `STEAM_DEFAULT_THEME`, `theme/schema.ts`) loads no theme at all
([ADR-0053](decisions.md#adr-0053-enhanced-notifications-has-no-style-sound-or-display-time-switches-steam-default-is-a-theme)).
`onPreview`, `previewOptions`, `onPreviewTier`, `achievementReset` and `creator` are injected by `index.tsx`. A random preview's achievement is the banner's own
synthetic preview (`previewTier`), never Steam's `TestAchievement`, whose real achievement id the sensor would take
for an unlock.

**Theme Creator** (`settings/creator/`, the plan (built and removed: `git show ee3e9a0:docs/plans/enhanced-notifications-theme-creator-plan.md`)). A button in the Theme
section opens a popout: navigation, the preview (a sticky stage that never remounts, with a Desktop / Big Picture
switch) and the editor, then one action row (undo/redo, Save as, Save, Close). It edits a draft (`theme/draft.ts`: the
raw theme by path, so the preview runs the plugin's own `resolveTheme`); in Big Picture mode every control writes the
`bigpicture.*` key and shows "From desktop" until set. Notification toasts on the stage are a mock styled by the
plugin's own `buildCss` through a selector set for the mock (`root` parameter), so the stage needs nothing from Steam's
stylesheets; achievement banners are the real markup, `BannerCard` (`surfaces/banner/banner-card.tsx`), injected by
`index.tsx` with the rest of `CreatorDeps` (previews, a sample game, can-test). Bundled themes are templates (Save as
only); saving copies every file the theme names (and library cues) into `<user themes>/<name>/` (`copyPlan`). The
creator's dialogs open over its own window (`showDialog(..., parent)`). Two writers that are not Steam targets: theme
files, only through the backend's `SaveTheme` / `DeleteTheme` (user folder only, every copy checked before anything is
written, the theme file through a temp file); and "Test on screen", only through `active-theme.ts` `loadDraft` /
`clearDraft` (memory, at most 2 minutes, ended by any theme reload; an architecture test keeps every other file off
`loadDraft`). Files from the PC come through Steam's file dialog (`steam/file-dialog.ts`) and are copied into the theme's folder on
Save; "Steam's chime" rows play Steam's own sound through the preview surface's `previewChime`. Every dialog is wrapped
in Steam's `ConfigContextRoot` (`steam/modal.ts`). The sound library is `themes/sounds/` (17 packs x Subtle / Distinct / Grand WAV, `library.json`,
`tools/import-sfx.mjs`, the `SoundLibrary` RPC). No feature id: the creator writes nothing into Steam.

Spacing: a **block** is a group of rows that read as one card; blocks in a section are `BLOCK_GAP` (22 px) apart, set
only by `<Blocks>`. Steam's `SliderField` and `TextField` end with 22 px of blank space of their own, which `ItemRow
trailing` cancels. A new option goes inside an existing block or becomes a new child of `<Blocks>`; never add spacing
on a row.

## Shared with other plugins

| Shared | With | What it is |
| --- | --- | --- |
| `steam/jsx-hook.ts` | steam-cartridges | The self-healing jsx runtime patch (`tests/architecture.test.ts` fails when the copies differ) |
| `backend/_lib/**` | every plugin | Millennium stubs (not drift-checked) |

## Tests

| Command | What it proves |
| --- | --- |
| `npm test` | Pure modules: themes, JSONC and CSS (`theme.test.ts`), the `achievements` block and its inheritance (`achievements-theme.test.ts`), safety, the hook and its composition with a second copy, the sound decision, the duration plan, the surface runner (`notifications.test.ts`), the unlock sensor, queued banner sounds, the 100% toast and the banner lifetime (`achievements.test.ts`), the scheduler, timing, geometry, capture plan, kernel, Reset Achievements, placement, the Big Picture type source, the Big Picture look (`theme.test.ts`), the creator's draft and model (`draft.test.ts`, `creator.test.ts`) |
| `npm test` → `tests/architecture.test.ts` | No new cross-area import (ratchet on `tests/architecture-allowlist.json`, empty and staying empty); pure files stay pure; one owner per Steam target (the table above, as `OWNERS`), and a popup's `MoveTo` has exactly its two writers; no two surfaces declare the same target; every RPC is registered in `backend/main.lua` (the whole list); only `active-theme.ts` and `settings/creator/` touch `loadDraft`; `steam/jsx-hook.ts` matches steam-cartridges' copy; every live script is in `tests/run-live.mjs` |
| `npm run test:lua` | The backend (`tests/test_backend.lua`, its own stubs): SaveTheme's name and path rules, refused copies, atomic write, overwrite and backup; DeleteTheme only in the user folder; ListThemeAssets' roots; ListThemes never lists the sound library |
| `npm run test:live` | Every live check against the running client, settings snapshotted and restored; fails at once if enhanced-achievements is still loaded. Notification style: `safety`, `previews`, `sound-duration`, `notifications-queue`, `placement` (turns the queue off: it checks stacking), `bigpicture`, `bigpicture-look` (ADR-0068). Theme Creator: `creator` (template hover preview, Steam's chime, a warning's Go, template, Big Picture edit, Save as, its files, Test on screen, Delete, through the UI). Achievement banner (theme `ps5`): `achievements-smoke`, `-tiers`, `-safety`, `-queue`, `-captures`, `-settings` (SKIP without a theme with tier sounds), `-reset`, `-bigpicture`. The Big Picture checks SKIP unless Big Picture is open; run them with Big Picture in front |

## How to add a feature

1. If it writes into Steam, give it a feature id (append to `FEATURE_IDS`; never rename one), put it in a surface with
   its `touches`, check `isEnabled(id)` before every write and `reportError(id, err)` in its catch.
2. Put its decisions in a pure module with a unit test.
3. Add a row to "Steam targets and their one owner" and to `OWNERS`. A target already owned by another row is not
   yours: extend that owner.
4. Something that should happen after an achievement toast: subscribe to `achievement.unlocked`, never add work to the hook.
5. A new theme key: `theme/theme.ts` (or `theme/achievements.ts` inside the block), `themes.md` and `themes/theme_example.jsonc`
   in the same change.

## History

- 2026-10-07 ADR-0061: with no Steam recording running, an unlock starts a manual recording (the existing clip length
  and delays), takes the screenshot from it after the stop, and keeps the clip only when "Record clip on unlock" is on.
- 2026-10-02 Toast hover: Steam's overlay is the card's `::before` on a static card, so it covered the whole window
  (square, outside the margin, and, under a banner, left on screen until the popup closed). Themed cards are
  positioned and clip it; banner popups hide it and the banner draws its own (`.ea-banner::after`). New theme key
  `settings.hover` (`true` / `false` / `[true, "#hex"]`), inherited by the banner.
- 2026-10-02 ADR-0055: the achievement queue became the notifications queue (`queue` surface, Steam's
  `displayToastAlone` on every type); a theme's `padding` keeps Steam's toast height (content-box, the height set to
  what is left; `border-box` had shrunk the desktop toast from 70 to 50 px and cropped its text).
- 2026-10-02 The timeline marker on unlock is removed (`recording.add_timeline_marker`, the `UserAddTimelineEntry`
  call, the plan's `marker` action): a Steam-native feature for non-Steam games belongs in steam-cartridges (TASK.md).
- 2026-10-02 ADR-0053: the "Themed style / sounds / display time" switches removed; "Steam default" theme (the
  default); a `.json` / `.jsonc` pair both listed; "Select Notification" and "Achievements Preview" in the panel.
- 2026-10-01 ADR-0050: enhanced-achievements merged into this plugin. Its theme became the optional `achievements`
  block (`theme/achievements.ts`, inheriting the theme's position, animation and display time); its banner, sensor,
  captures, 100% toast and Reset Achievements moved in as they were; one sound surface and one duration surface for
  every toast; `bannerDraws` replaced the `claims()` / `steam/coexistence.ts` handshake; Big Picture's achievement
  position follows the theme (the "Force achievement position in Big Picture" setting is gone, ADR-0049 superseded);
  the drift checks against enhanced-achievements are gone.
- 2026-10-01 Big Picture flicker fixed: the toast type comes from `PopNextToastNotification` (`steam/toast-pop.ts`,
  decision in `surfaces/style/type-source.ts`), not the store's current-toast value.
- 2026-10-01 One style for every notification: `default`, `categories` and `types` removed (warned and ignored),
  `display_time_ms` moved to `settings`; random Preview; `margin` / `padding` in CSS's clockwise order; Big Picture
  position and animation; types beyond the SDK enum named `Type<n>`.
- 2026-10-01 Theme `settings.position` and `settings.animation`, `popup.margin`, `popup.padding`, `popup.gap`:
  `theme/placement.ts`, `surfaces/style/toast-window.ts`, feature id `placement`.
- 2026-09-30 ADR-0047: enhanced-achievements' architecture ported (safety net, surfaces, architecture test), JSONC
  themes, the settings panel on its rows and spacing.

**Reset Achievements and store copies (steam-cartridges ADR-0056):** a non-Steam game is offered only when steam-cartridges
does not answer `achievementsResettable(appid) === false` (`surfaces/reset/reset.ts` `shortcutOffered`): an Epic or Xbox
copy's unlocks live on the store's account and come back with the next sync. An older steam-cartridges without that
function keeps offering every shortcut.
