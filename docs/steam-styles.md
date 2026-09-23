# Steam UI Styling — Reuse Over Reimplementation

> **Status: The previous "Style Bible" approach (hand-measuring pixel values) is superseded.**
> Per [ADR-0022](decisions.md#adr-0022-render-through-steams-own-app-detail-sections-instead-of-rebuilding-them),
> [ADR-0029](decisions.md#adr-0029-big-picture-runs-in-sharedjscontext-via-react-portal-native-component-rendering-and-store-feeding-supersede-dom-cloning),
> and [ADR-0030](decisions.md#adr-0030-native-activity-feed-restored-via-appactivitystore-injection-and-storeitemcache-stubbing),
> **Steam's own components and stores are reused directly**.
> Hand-measuring CSS properties, pixel padding, and box-shadows was the wrong rung of the ladder and was completely deleted (~1200 lines).

---

## The Golden Rule: Clone Native Blocks, Don't Author CSS

When building custom panels or tabs for homebrew plugins (Rungs 2 & 3 of the ladder in [AGENTS.md](../AGENTS.md)):

1. **Never hand-code custom CSS to imitate Steam.** Steam's CSS modules use hashed class names (`_1OMmVJ… GamePlaySummaryContainer`) that change across client builds. Hand-written styles break on client updates, miss responsive breakpoints, and fail Big Picture controller navigation.
2. **Resolve existing Steam components or clone existing block structures:**
    - On Desktop: mount Steam's native components or use resolved CSS module classes via `findClassModule`.
    - On Big Picture: use Steam's native `<Focusable>` components, `DialogButton`, `Carousel`, and modal containers. Controller focus rings, D-pad navigation, and sound effects are handled automatically.
3. **If injecting custom markup, mirror existing native elements verbatim:** Inspect the native element in CEF DevTools (`http://localhost:8080`), copy the DOM hierarchy, and apply Steam's resolved classes directly.

---

## Global Steam UI Foundations (For Reference Only)

If you must apply basic styling to container boundaries or text wrappers:

### Typography

```css
font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
```

- Headers: `font-size: 14px; font-weight: 400; letter-spacing: 1px; text-transform: uppercase;`
  _(Note: Steam headers use normal weight 400 with uppercase + letter-spacing, NOT bold)._
- Body / Details: `font-size: 13px; font-weight: 400;`

### Colors & Themes

Steam exposes theme CSS variables in `SharedJSContext` and popup documents:

- Text primary: `var(--color-text-primary, #e6e6e6)`
- Text secondary / muted: `var(--color-text-secondary, #8f98a0)`
- Background dark: `var(--color-background-dark, #101216)`
- Focus highlight / Accent: `var(--color-highlight, #1a9fff)`

### Controller Focus in Big Picture

Never build custom focus rings with CSS `:hover` or `:focus`. Big Picture uses Steam's gamepad focus tree. Wrap elements in Steam's `<Focusable>` or add `FocusRingRoot` / `Panel` classes resolved from Steam's modules.
