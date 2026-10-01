# enhanced-notifications architecture

**This doc's job:** how `enhanced-notifications` is built today: its layers, who owns each Steam target, its safety
net, how it shares Steam's notification hook with `enhanced-achievements`, and how to add a feature without breaking
another. Decision: [ADR-0047](../decisions.md#adr-0047-enhanced-notifications-uses-enhanced-achievements-architecture-and-shares-its-notification-hook)
(the architecture of [ADR-0043](../decisions.md#adr-0043-enhanced-achievements-has-one-owner-per-steam-target-and-a-safety-net),
without the parts only achievements need). Sibling doc: [enhanced-achievements/architecture.md](../enhanced-achievements/architecture.md).

## Layers

| Layer | Folder | Job |
| --- | --- | --- |
| Safety | `frontend/safety/` | Kill switches, error budget, boot sentinel / safe mode (copies of enhanced-achievements', this plugin's ids and key) |
| Kernel | `frontend/kernel/` | The `Surface` contract (identical copy), the notification shape, the toast selector type |
| Pure domain | `theme/theme.ts`, `theme/jsonc.ts`, `theme/placement.ts`, `surfaces/*/{sound,duration}.ts`, `surfaces/preview/pick.ts` | Themes (one style for every notification) and their CSS (with the entrance/exit animation and Big Picture's placeholder); where a desktop toast goes; the sound decision; the duration plan; the random preview pick. No Steam, SDK, React or logger |
| Steam access | `frontend/steam/` | Finding Steam's objects (`notification-store.ts`, `selectors.ts`, `webpack.ts`), the one `PlayNotificationSound` hook (`notification-hook.ts`, identical copy), the read-only enhanced-achievements `claims()` reader (`coexistence.ts`), the toasts-off flag |
| Surfaces | `frontend/surfaces/` | The only code that writes into Steam: `style` (with `style/toast-window.ts`, each desktop toast popup's type and place), `sound`, `duration`, `preview`. `surfaceStatus()` shows which installed |
| Composition root | `frontend/index.tsx` | Start-up order, wiring, the public exports |
| Settings panel | `frontend/settings/` | `settings-panel.tsx` (this plugin's sections), `rows.tsx` (rows and spacing, identical copy) |

Not adopted from enhanced-achievements: the event bus and sensors (nothing here reacts to a toast after the fact), the
banner scheduler (Steam draws every toast; we only restyle it) and the jsx runtime hook (verified 2026-09-24: for these
toasts the wrapped element was not the one React committed).

## Safety net

| Id | What it switches | Off means |
| --- | --- | --- |
| `style` | The scoped `<style>` and `body[data-en-type]` in toast windows | No toast gets the attribute, so no rule matches: Steam's look. Uninstall also removes the `<style>` |
| `sound` | The theme's sound or mute, for every type it handles | Steam's chime |
| `duration` | Writing each type's toast duration | Nothing written (a value already written stays until the next theme change or restart); uninstall restores Steam's value for the types it wrote |
| `preview` | The settings panel's Preview: a random one of Steam's test toasts each press | The button does nothing |
| `placement` | Moving toasts to the theme's `position` / `margin` (desktop and overlay popups; Big Picture's placeholder), and holding desktop popups still during a theme `animation` | Steam places every toast (desktop: checked on each of Steam's moves; Big Picture: the placeholder style is removed on the change). Part of the `style` surface: `style` off also turns it off |

- **User switch:** `disabledFeatures` setting, comma-separated ids, no panel control. From the SharedJSContext console:
  `PLUGIN_LIST['enhanced-notifications-dev'].setSetting('disabledFeatures', 'style,sound')`. Read live.
- **Error budget:** 5 errors in one session switch a feature off until Steam restarts, and its surface is uninstalled.
  Counted by: the shared hook's sound-handler catch (`sound`), the injector's per-window and Big Picture scan catches
  (`style`), the per-popup `MoveTo` wrapper (`placement`), `apply()` in the duration surface (`duration`), `preview` (`preview`), and an install that throws.
- **Safe mode:** the boot sentinel (`enhanced-notifications.boot` in SharedJSContext `localStorage`) counts starts that did
  not end cleanly. Two in a row: the next start hooks nothing, and 60 error-free seconds clear it.
- **Big Picture debug trace** (`surfaces/style/bp-debug.ts`, off by default, not persisted):
  `debugBigPicture({ enabled: true, echo: true })` records what the style surface saw and did for Big Picture's toast
  view (each type signal and whether it was used, every `data-en-type` change, the placement `<style>` added, changed
  or removed, each placeholder scan); `bigPictureTrace()` reads it. `debugBigPicture({ typeSource })` switches where the
  Big Picture toast type comes from, to compare alternatives live; `tests/probes/bp-toast-trace.mjs` drives both and
  merges them with what Steam does ([steam-debug.md Trap 13](../steam-debug.md)).
- **Diagnostics:** `PLUGIN_LIST['enhanced-notifications-dev'].safetyDiagnostics()` → `{ safeMode, disabled, tripped, errors }`;
  `surfaceStatus()` → which surfaces installed and why one did not.

## Sharing Steam's notification hook with enhanced-achievements

Both plugins wrap `NotificationStore.prototype.PlayNotificationSound`, in whichever order Millennium loads them. They do
it with the **same file**, `steam/notification-hook.ts` (a test fails in either plugin when the copies differ), and that
file is written to compose:

- Each wrapper passes a call on any object but the store straight through, so either plugin's stand-in calls (type
  discovery) reach Steam untouched.
- Each wrapper runs its own `onShown` listeners once per toast, then its one sound handler. A handler that does not want
  a type calls `playSteam()`, which calls whatever it wrapped: the other plugin's wrapper, or Steam's.
- Achievement toasts: this plugin's handler hands them over while `claims('sound')` is true (`steam/coexistence.ts`,
  O(1)), so exactly one plugin decides their sound. `tests/notifications.test.ts` proves both load orders.
- `uninstall()` restores Steam's method only when its wrapper is on top; otherwise it stays in the chain with no sound
  handler and passes everything through.

The toast duration uses the shared `pristineDuration` helper (identical in both plugins) so whichever plugin loads
second still restores Steam's value.

## Shared with enhanced-achievements (sibling plugins)

Plugins may not import each other, so shared code is a copy, and each plugin's `tests/architecture.test.ts` fails when
a copy drifts. Change a shared file in both plugins in one commit.

| Shared | What it is |
| --- | --- |
| `steam/notification-hook.ts` | The one `PlayNotificationSound` wrapper (above) |
| `kernel/surface.ts` | The `Surface` contract and its install runner |
| `theme/jsonc.ts` | JSONC parsing: `.jsonc` and `.json` themes accept comments and trailing commas |
| `settings/rows.tsx` | Settings rows and the spacing system ([guardrail 18](../plugins.md#18-settings-panel-layout-reference-enhanced-achievements)) |
| `pristineDuration` (in `steam/notification-store.ts`) | Steam's own toast duration, recorded once for both plugins |
| `backend/main.lua` | Theme lookup (`.jsonc` before `.json`, user folder before bundled) and asset loading (relative or absolute paths); identical but for the plugin name |
| `backend/_lib/**` | Millennium stubs (already identical; not drift-checked) |

## Settings panel spacing

The same system as enhanced-achievements ([its doc](../enhanced-achievements/architecture.md#settings-panel-spacing)):
a **block** is a group of rows that read as one card; blocks in a section are `BLOCK_GAP` (22 px) apart, set only by
`<Blocks>`; a dropdown gets the full row (label, description, control). Rows come from `settings/rows.tsx`. A new option
goes inside an existing block or becomes a new child of `<Blocks>`; never add spacing on a row.

## Toast position and animation

Desktop and the in-game overlay open one popup per toast; Steam's stack moves each one every frame of its slide
in, slide out and restack through the popup's own `SteamClient.Window.MoveTo` ([steam-components.md § Desktop
toast stack](../steam-components.md)). `surfaces/style/toast-window.ts` wraps that property on each popup, nothing
global:

- **Type per window.** At Steam's first move the popup has rendered its toast; the notification is read once from
  a fiber above its content, and the window gets its own `data-en-type` and `--en-display-ms` (its type's toast
  duration). Several toasts show at once, so one shared current type would restyle the older ones. Until then,
  and for Big Picture's one window, the current toast's type is used, as before.
- **Place.** Steam's move is turned into an offset from Steam's corner and applied from the theme's corner
  (`theme/placement.ts`), so Steam keeps its timing and stacking. With a theme `animation`, the offset never goes
  past the slot (no slide), and is held once Steam's slide out starts.
- **Animation.** One CSS block for every type (`buildAnimationCss`, cached as `animationCss()`), on the popup's
  wrapper so a pulsing glow on the popup keeps running. The exit is timed from `--en-display-ms` to end when
  Steam closes the popup (300 ms in + duration + 300 ms out, verified live 2026-10-01).
- **enhanced-achievements.** Its banner pins achievement popups by wrapping the same property after ours; its pin
  calls our wrapper with its own position, which we pass through while `claims('banner')` is true. Verified live:
  an achievement toast stays at enhanced-achievements' place with an enhanced-notifications `position` set.

**Big Picture** (verified live 2026-10-01, [steam-components.md § Toast windows](../steam-components.md)) has one
toast view that follows a `position: fixed` `GamepadToastPlaceholder` div in the Big Picture window, re-measured
when a toast shows. The injector puts `<style id=enhanced-notifications-placement>` (`buildPlaceholderCss`) in each
window holding a placeholder, found by the same scan that finds the toast view. One place for every toast there,
achievement toasts included (enhanced-achievements has no Big Picture position). Steam animates
`.GamepadToastPopup > *` (rebuilt per toast; 300 ms slide in, 300 ms fade out from its own `--toast-duration`); the
theme animation replaces both on that element, timed from the same variable.

**Unnamed types.** Steam has toast types the SDK's `EClientNotificationType` lacks (the firmware update toast is
eType 61; the enum ends at 58). Start-up asks Steam for a config up to 32 past the enum's end and names those
`Type<n>`, so they get the style, sound and display time like any other.

## Steam targets and their one owner

| Steam target | Owner (file) | Guardrail |
| --- | --- | --- |
| `NotificationStore.prototype.PlayNotificationSound` (wrapper) | `steam/notification-hook.ts` | [2](../plugins.md#2-zero-expensive-operations-in-hot-prototype-methods-o1-strictly-enforced) |
| `NotificationStore` instance `ChooseSound` (for one call) | `steam/notification-hook.ts` | 2 |
| The hook's sound slot | `surfaces/sound/index.ts` | 2 |
| Each type config's `toastDurationMS` (not the one enhanced-achievements claims) | `surfaces/duration/index.ts` | — |
| Toast windows: `<style id=enhanced-notifications-theme>` and `body[data-en-type]`; `Millennium.AddWindowCreateHook` | `surfaces/style/injector.ts` | [12](../plugins.md#12-popup-hooks-do-not-see-every-window) |
| Big Picture window: `<style id=enhanced-notifications-placement>` (the toast placeholder's position) | `surfaces/style/injector.ts` | — |
| Each desktop / overlay toast popup's own `SteamClient.Window.MoveTo` (wrapped per popup) | `surfaces/style/toast-window.ts` | 2 |
| `NotificationStore.Test*` (previews) | `surfaces/preview/index.ts` | — |

## Tests

| Command | What it proves |
| --- | --- |
| `npm test` | Pure modules: themes, JSONC and CSS (`theme.test.ts`), safety (`safety.test.ts`), the hook, its composition with a second copy in both orders, the sound decision, the duration plan, the surface runner (`notifications.test.ts`) |
| `npm test` → `tests/architecture.test.ts` | No new cross-area import (ratchet on `tests/architecture-allowlist.json`, empty and staying empty); pure files stay pure; one owner per Steam target (the table above, as `OWNERS`); no two surfaces declare the same target; every RPC is registered in `backend/main.lua`; the shared files (table above) match enhanced-achievements' copies; every live script is in `tests/run-live.mjs` |
| `npm test` → `tests/placement.test.ts` | Where a toast goes: Steam's corner, the stack offset, the theme's corner and margin, the animated offset |
| `npm run test:live` | Every live check against the running client, settings snapshotted and restored: `safety`, `previews` (random previews, each a new type, all restyled), `sound-duration`, `placement` (desktop: position, stacking, padding, gap, animation names, the `placement` kill switch), `bigpicture` (Big Picture: position, animation, padding, kill switch; SKIP unless Big Picture is open) |

## How to add a feature

1. If it writes into Steam, give it a feature id (append to `FEATURE_IDS`; never rename one), put it in a surface with
   its `touches`, check `isEnabled(id)` before every write and `reportError(id, err)` in its catch.
2. Put its decisions in a pure module with a unit test.
3. Add a row to "Steam targets and their one owner" and to `OWNERS`. A target already owned by another row is not
   yours: extend that owner.
4. Never edit a shared file (see "Shared with enhanced-achievements") in one plugin only: change both copies in one commit.

## History

- 2026-10-01 One style for every notification: `default`, `categories` and `types` removed (warned and ignored),
  `display_time_ms` moved to `settings`; `ResolvedTheme.style` replaces `styleFor(type)`, one cached CSS scoped to
  `body[data-en-type]`. Preview is one button showing a random test toast (`surfaces/preview/pick.ts`); `previewCategory`
  replaced by `preview(id?)` and `previewIds()`. `margin` / `padding` use CSS's clockwise order (both plugins). Big
  Picture position and animation (placeholder style; `.GamepadToastPopup > *`). Types beyond the SDK enum named `Type<n>`.

- 2026-10-01 Theme `settings.position` and `settings.animation`, `popup.margin`, `popup.padding`, `popup.gap`, with
  enhanced-achievements' names and values: `theme/placement.ts` (pure), `surfaces/style/toast-window.ts` (per-popup
  `MoveTo`), feature id `placement`; desktop toast windows now carry their own type instead of the current toast's.

- 2026-09-30 ADR-0047: ported enhanced-achievements' architecture. `steam/notifications.ts` split into
  `steam/notification-store.ts` (discovery), `steam/notification-hook.ts` (the shared wrapper), `steam/coexistence.ts`
  and surfaces `sound`, `duration`, `preview`; `style/injector.ts` became the `style` surface; safety net and
  architecture test added; `ToastSelectors` moved to the kernel so the Steam layer never imports the theme.
- 2026-09-30 ADR-0047 (siblings): JSONC themes (`theme/jsonc.ts`, `.jsonc` lookup in the backend), absolute sound paths
  documented (the backend already allowed them), the settings panel rebuilt on enhanced-achievements' rows and spacing
  (`settings/rows.tsx`, shared); the unused `toastWarning()` removed.
