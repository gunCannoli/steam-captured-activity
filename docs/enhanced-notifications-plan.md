# Enhanced Notifications: Architecture & Implementation Plan

> A standalone Millennium plugin that restyles **every** Steam notification toast
> (friends, messages, downloads, recordings, system, achievements) and changes
> its sound, while keeping Steam's own content: icons, app logos, text,
> buttons and click behaviour. It complements `enhanced-achievements`, which
> replaces the achievement toast entirely with rarity tiers and custom art.

---

## 1. Scope

| | `enhanced-notifications` | `enhanced-achievements` |
| --- | --- | --- |
| Toast types | All ~60 | Achievement unlocks only |
| Approach | **Restyle Steam's own toast in place** (scoped CSS) | **Replace** the toast content with a themed banner |
| Changes | Popup background, border, glow, watermark, font, text colours and sizes, logo shape, header icon, display time, sound (per type or category) | Everything, plus rarity tiers, custom icons, 100% badge, captures (Phase 7) |
| Icons and content | Steam's own, always | Custom or Steam's, per theme |

Each plugin works alone. Neither imports the other ([plugins.md § Layout](plugins.md#layout)).

## 2. Step 0 findings (verified live 2026-09-24)

- **Type names:** the SDK enum `EClientNotificationType` (exported by `@steambrew/client`)
  matches `notification.eType` 1:1 (`1 = DownloadComplete`, `4 = FriendOnline`,
  `5 = Achievement`, …, `58 = GameRecordingInstantClip`). Themes key types by
  these names, never by number. About 20 server-item types (`Comment`,
  `TradeOffer`, `Wishlist`, …) have no protobuf class but do have enum names.
- **Per-type config:** the stand-in `PlayNotificationSound` trick
  ([steam-components.md § 11B](steam-components.md#b-native-achievement-notifications-notificationstore))
  yields each type's config (`sound`, `playSound`, `toastDurationMS`, `showToast`).
- **Toast DOM (desktop):** `DesktopToastPopup` (gradient background) >
  `DesktopToastBackground` (Steam-logo watermark) + the dispatcher's output:
  `StandardTemplateContainer` > `DesktopToastTemplate` > `StandardLogoDimensions`/`AppLogo`
  + `Content` > `Header` (`Icon`, `Title`) + `StandardNotificationDescription` + `StandardNotificationSubText`.
- **Toast DOM (Big Picture):** `GamepadToastPopup` > `ShortTemplate` (carries the
  background) > `ShortLogoDimensions`/`AppLogo` + `Content` > `Header` (`Icon`, `Title`) + `Body`.
- **Class-module trap:** `StandardTemplateContainer` / `Title` / `Body` exist in
  **four** CSS modules with different hashes. Different toast types use
  different modules. `DesktopToastPopup` and `GamepadToastPopup` are two more
  modules. So the plugin collects each key's classes from **every** module that
  has it and targets `:is(...)` of all of them. Never one probe, never a
  hardcoded hash ([knowledgebase.md § classes seen together](knowledgebase.md#classes-seen-together-in-one-element-are-not-necessarily-one-css-module-verified-the-hard-way-building-non-steam-games-activity)).

## 3. How it works (as built)

> **Changed from the first design.** Wrapping the dispatcher element through
> `react/jsx-runtime` (as `enhanced-achievements` does) did not work here:
> verified live, the traced `jsx` call returned the wrapper, but React committed
> a different, unwrapped element for these toasts (cause not found). The shipped
> design needs no React interception.

1. **Resolve once at startup:** each type's config (stand-in `PlayNotificationSound`
   call), type names from `EClientNotificationType`, and class selectors from
   **every** CSS module per key.
2. **Scoped CSS:** built once per theme load, as one `<style>` injected into every toast
   window (`Millennium.AddWindowCreateHook`, plus a popup scan per toast for windows
   created before they had a `window`). Every rule starts with `body[data-en-type="<Type>"]`.
3. **Type marking:** when a toast is shown, the toast windows' `<body>` gets
   `data-en-type`. The signal is Steam's own `PlayNotificationSound(n)` call, which every
   toast container makes on display (desktop has no current-toast value), plus
   `CurrentToastSubscribableValue` (Big Picture).
4. **Sound and display time:** as in `enhanced-achievements`. Hooks ignore calls whose
   `this` is not the store (stand-in config reads by either plugin).
5. **Coexistence:** `enhanced-achievements` exports `claims(feature)`, and achievement
   toasts are left to it for each feature it claims.
6. **Fallbacks:** no attribute means no rule matches, so the toast stays stock.

## 4. Theme schema (summary; full reference in `enhanced-notifications/themes.md`)

```json
{
  "default":    { "popup": {...}, "text": {...}, "logo": {...}, "header_icon": true, "font_family": "...", "sound": ["assets/x.mp3", 60], "display_time_ms": 5000 },
  "categories": { "friends": {...}, "messages": {...}, "downloads": {...}, "recording": {...}, "achievement": {...}, "system": {...} },
  "types":      { "FriendOnline": {...}, "DownloadComplete": {...} }
}
```

Resolution: `default` → category → type. Objects merge key by key, and tuples
and arrays replace whole (same rule as `enhanced-achievements`).

## 5. Settings (Millennium Configuration API, same workaround as `enhanced-achievements`)

`theme`, `style.enabled`, `sound.enabled`, `duration.enabled`, plus panel
actions: preview per category (Steam's own `Test*` functions), Reload themes,
Open themes folder, Reset. User themes live in
`<steam>/millennium/config/enhanced-notifications/themes/`.

## 6. Guardrails

Same table as [enhanced-achievements-plan.md § 5](enhanced-achievements-plan.md#regression-guardrails-for-this-plugin),
plus: **CSS is generated only from resolved class maps, and every rule starts
with `body[data-en-type="<Type>"]`**, so no rule can match a toast window that
is not currently showing a styled type, or any non-toast window.

## 7. Verification

Logic tests (`npm test`); live: per-category preview renders styled; stock
toasts when disabled; sound per type and mute; display time; achievement
coexistence both ways (EA on → EA banner; EA off → EN styles the achievement
toast); Big Picture; core Routines 1–2 (`scratch/`).
