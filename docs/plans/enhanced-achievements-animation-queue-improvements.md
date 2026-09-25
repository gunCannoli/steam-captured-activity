# Fix plan: `enhanced-achievements` fade in/out, ps5 slide, ripple, and a real toast queue

> Bugfix/improvement plan for the implementer, following on from
> [enhanced-achievements-banner-geometry-fix.md](enhanced-achievements-banner-geometry-fix.md).
> User feedback (2026-09-25, after the geometry fix went live): 5 items. **No
> scope beyond these 5.**
>
> Written 2026-09-25 from source reading (`frontend/banner/*`,
> `frontend/steam/notifications.ts`, `frontend/theme/theme.ts`) plus a live CDP
> probe of the running `enhanced-achievements-dev` client (confirms item 4 is
> not a bug — see § 1.4). No module ids are used; nothing here resolves by one.

---

## 1. The five requests, and what each actually needs

### 1.1 "`animation: fade` only fades out, not in" + fade_in/fade_out control

**Live probe finding:** the fade-in **is** running (`animationName` computed as
`ea-anim-fade, ea-exit`, opacity sampled at 0.747 mid-fade at t=300ms of a
400ms entrance). So the CSS is not broken. But the user's experience is real:
the previous (pre-geometry-fix) version had Steam **sliding the whole window**
into place as part of the "entrance," which was far more visible than a 400ms
opacity ramp on a window that is now pinned in place from frame one (by
design — docs/plans/enhanced-achievements-banner-geometry-fix.md § 3.1). A
plain fade-in reads as "it just appeared" next to a fade-out that takes the
same 300ms but is the *only* motion the user consciously notices.

Fix: make entrance and exit independently named and settable
(`animation_in` / `animation_out`), so `"fade"` can be paired with a
different, more visible exit if the user wants, and so the schema stops
conflating "one animation" with "two states that happen to share a name."
`"fade"` alone still means both states use fade — this is not a behaviour
change for existing themes, only a new capability.

### 1.2 A `ps5` animation: slide + fade, anchor-aware direction

Requested keyframe reference (adapted to this codebase's `--toast-duration`
and our per-state model, § 3):
```
animation:
    slidein calc(var(--transition) * 2) forwards,
    slideout calc(var(--transition) * 2) calc(var(--displaytime) - calc(var(--transition) * 2)) forwards;
```
This is the "one shorthand covers in and out, timed off the display duration"
pattern our current fade already uses (`animation-delay: 0ms, calc(var(--toast-duration) + 300ms)`,
themes.md's two-value `animation-name`/`-duration`/`-delay` lists). The new
`ps5` preset reuses that same two-value mechanism, not a rewrite.

"Anchor-aware" means: slide in **from** the screen edge the banner is anchored
to, slide out back **toward** that edge. `top_right`/`bottom_right` slide from
the right (`translateX(100%)` → `0`); `top_left`/`bottom_left` slide from the
left (`translateX(-100%)` → `0`); `top_center`/`bottom_center` have no natural
horizontal edge, so they slide from **below** their own anchor (`top_center`
slides down-in from above; `bottom_center` slides up-in from below) — the same
direction a real PS5 trophy popup uses on center-anchored consoles displays.
This needs the resolved `position` at CSS-class time, which `Banner` already
has (`theme.position`); it becomes a class suffix, not a runtime style
(keeps CSS static, no per-toast inline `@keyframes`).

### 1.3 Ripple: tighter to the icon, expands **outward from its edge**

Current `.ea-ripple` (`frontend/banner/styles.ts`):
```css
.ea-ripple {
    position: absolute;
    inset: -35%;
    border-radius: 50%;
    background: radial-gradient(circle, transparent 40%, rgba(255,255,255,.35) 55%, rgba(255,255,255,.75) 70%, transparent 80%);
    filter: blur(4px);
    animation: ea-ripple var(--ea-ripple) cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
}
@keyframes ea-ripple {
    0% { transform: scale(0.6); opacity: 1; }
    70% { opacity: 0.6; }
    100% { transform: scale(1.8); opacity: 0; }
}
```
`inset: -35%` makes the ripple's own box **36% larger than the icon on every
side before any scaling**, and it starts at `scale(0.6)` of *that* oversized
box — so the ring is already well outside the icon's visible edge at 0% and
drifts further at 100%. The referenced effect (`.wrapper#logo::after`, a
fixed-size ring outside the icon that starts **collapsed onto the icon's own
outline** and expands from there, like a ripple starting at the object that
touched the water) is a different shape: a **fixed-size ring** (not a
scaled-up blurred gradient disc) that starts at `scale(0)` centred on the icon
and grows outward, with its own outline (not a gradient fill) fading via blur
and opacity as it grows. Reproduced with this codebase's variables
(`--ea-icon-scale`, tier colour) in § 3.3.

### 1.4 "exceptional" custom text: already correct — confirmed live, not a bug

**Live probe (2026-09-25, this session):** dispatched a synthetic
`EA_100_PERCENT` notification with placeholder `name`/`description` payload
fields (`"placeholder title"` / `"placeholder desc"`) through
`NotificationStore.OnNotification`, using the deployed `enhanced-achievements-dev`
build and the user's live theme
(`C:\game\steam\millennium\config\enhanced-achievements\themes\ps5_example.json`,
which sets `exceptional.text.title = "100% Complete"` and
`exceptional.text.desc = "You've unlocked all achievements!"`). Result, read
from the toast window's DOM:
```json
{"title":"100% Complete","desc":"You've unlocked all achievements!","cls":"ea-banner ea-layout-custom ea-anim-fade ea-tier-exceptional"}
```
The theme's own strings rendered, not the notification payload's placeholder
text and not any other hardcoded string. `frontend/theme/theme.ts`
`resolveTier` already reads `text.title`/`text.desc` per tier
(`themed-toast.tsx`'s `displayTitle`/`displayDesc` use `tier.text.titleText`
only `isExceptional && tier.text.titleText`, else the notification's own
`data.name()`), and only falls back to the hardcoded `"100% Complete"` /
`"You've unlocked all achievements!"` strings when the theme's `exceptional`
tier does not set them (`theme.ts:285-288`) — which is the documented,
intended default (themes.md § `themes`: exceptional "acts as a fake platinum
trophy"). **No code change.** This item is closed by confirming the existing
behaviour in themes.md (already documents it at line 99) and telling the user
directly (this plan's cover note does that; no further doc change needed).

### 1.5 A real one-at-a-time toast queue, 100ms gap between queued toasts

**Decision (user, 2026-09-25):** only one achievement banner visible at any
moment. A second (or later) unlock waits for the current one to fully
disappear, then fires 100ms later — not the theme's configured delay, since
that delay is meant for a *fresh* toast, not a queued backlog. Non-achievement
toasts (friends, downloads) are Steam's own and untouched.

**Where this can't live:** `ProcessNotification` is documented as bound and
non-writable (steam-components.md § Resolution signatures), so nothing can
intercept *before* Steam decides to show a toast. Racing `OnNotification`
itself (holding the call back, re-calling it later) would fight Steam's own
notification id bookkeeping and its toast-stack window creation
(banner-geometry-fix.md § 2.1) — exactly the kind of two-owners problem that
plan spent 4 phases removing for *position*. Reusing that lesson: **the fix
must stay entirely on the render side**, the same place the banner already
owns.

**Design:** `ThemedToast` (the component substituted for Steam's dispatcher,
`toast-patch.ts`) gains a module-level FIFO queue keyed by notification
identity. When an achievement notification's `ThemedToast` mounts:
- if the queue is empty and nothing is currently "on screen", it plays
  immediately (today's behaviour, unchanged for the common single-toast case);
- otherwise it enqueues and renders **nothing on this popup** until its turn.

Steam still creates the popup window and drives its own show/hide timer
(`toastDurationMS`) — we don't touch that, so guardrail 5 (docs/plugins.md,
"no per-toast RPC in the hook", extended here to "no per-toast Steam API call
in the hook") still holds; the only new work is a plain JS array push/shift in
a `useEffect`. Rendering nothing on a still-shown-by-Steam popup means the
window is present but blank for however long it waits in queue — acceptable,
since **Steam's own toast duration timer is running on that same popup**, so a
long queue also means Steam auto-hides queued-but-never-shown popups before
we ever get to them. Two sub-fixes make this correct (§ 3.5):
1. **Queueing must not just delay rendering** — it must delay the *whole
   toast's visible window*, otherwise Steam hides an unshown popup after its
   own duration elapses and the queued achievement is silently lost. So a
   queued item's actual display is driven by *our* timer calling
   `toast.onDismiss` early is wrong (that's a dismiss, not "start now") —
   instead we must **extend that popup's effective duration** by not starting
   our own on-screen countdown until it is dequeued, while accepting that
   Steam's underlying `toastDurationMS` timer already started at mount and
   may expire first on a long queue. This is a real limit or the whole
   thing needs a second, harder redesign (delaying the popup's *creation*,
   which is Steam's job, not ours) — see § 3.5 for the bounded, safe version
   actually implemented: a **5-slot** queue tied to Steam's actual duration,
   not an unbounded wait.
2. **"fully disappeared"** is the pinned popup's `unpin()` call in
   `window-pin.ts` (already fires on unmount, which is when Steam finally
   calls `HideWindow` and destroys the popup) plus this banner's own 300ms
   `ea-exit` fade — so "done" is `unmount()` **and** the fade timer, whichever
   is the real signal. Implemented in § 3.5 as a completion callback the
   queue awaits, not a fixed guess.

---

## 2. Preconditions

Run in `enhanced-achievements/`:

| Command | Expected |
| --- | --- |
| `git status --short` | empty |
| `npm run check` | only the npm banner, exit 0 |
| `npm test` | `ℹ tests 39` / `ℹ pass 39` / `ℹ fail 0` |

---

## 3. Ordered steps

### Phase 1: schema — `animation` becomes `{in, out}` or a bare string (item 1, 2)

**Step 1.1: `frontend/theme/theme.ts`, animation types.**

Before:
```ts
export const ANIMATIONS = ['slide', 'fade', 'up', 'down'] as const;
export type Animation = (typeof ANIMATIONS)[number];
```
After:
```ts
export const ANIMATIONS = ['slide', 'fade', 'up', 'down', 'ps5', 'none'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export interface AnimationPair {
    in: Animation;
    out: Animation;
}
```
`'none'` is new: an explicit no-animation state, needed so `{in: 'none', out: 'fade'}`
is expressible (fade-out only, the inverse of item 1's original complaint —
completing the pair makes the schema symmetric).

**Step 1.2: `frontend/theme/theme.ts`, `ResolvedTheme.animation`.**

Before:
```ts
export interface ResolvedTheme {
    position: ToastPosition;
    layout: Layout;
    customLayout?: CustomLayoutMap;
    animation: Animation;
```
After:
```ts
export interface ResolvedTheme {
    position: ToastPosition;
    layout: Layout;
    customLayout?: CustomLayoutMap;
    animation: AnimationPair;
```

**Step 1.3: `frontend/theme/theme.ts`, `resolveTheme`, animation resolution.**

Before:
```ts
    return {
        position: position ?? 'bottom_right',
        layout: layout ?? 'default_steam',
        customLayout,
        animation: oneOf(settings.animation, ANIMATIONS) ?? 'slide',
        textAlign: themeTextAlign,
```
After:
```ts
    const animation = resolveAnimation(settings.animation, warnings);

    return {
        position: position ?? 'bottom_right',
        layout: layout ?? 'default_steam',
        customLayout,
        animation,
        textAlign: themeTextAlign,
```

**Step 1.4: `frontend/theme/theme.ts`, new `resolveAnimation` helper.** Add
directly above `resolveTheme` (after `resolveTier`'s closing `}`, before the
`/**\n * Validate a parsed theme file...` doc comment):
```ts
/**
 * `settings.animation` is a bare string (`"fade"`, both states use it), or
 * `{ "in": ..., "out": ... }` for independent control. `"ps5"` is a preset
 * (§ themes.md): entrance slides in from the anchor edge and fades, exit
 * reverses it; its direction is resolved from `position` in CSS (banner
 * geometry fix's approach of a static class name, not a runtime style), so
 * `resolveAnimation` only validates the *name*, never the direction.
 */
function resolveAnimation(raw: unknown, warnings: string[]): AnimationPair {
    const DEFAULT: AnimationPair = { in: 'slide', out: 'fade' };
    if (raw === undefined) return DEFAULT;
    if (typeof raw === 'string') {
        const a = oneOf(raw, ANIMATIONS);
        if (!a) {
            warnings.push(`settings.animation "${raw}" is not supported; using slide in, fade out.`);
            return DEFAULT;
        }
        return { in: a, out: a };
    }
    if (isObject(raw)) {
        const inAnim = oneOf(raw.in, ANIMATIONS);
        const outAnim = oneOf(raw.out, ANIMATIONS);
        if (raw.in !== undefined && !inAnim) warnings.push(`settings.animation.in "${String(raw.in)}" is not supported; using slide.`);
        if (raw.out !== undefined && !outAnim) warnings.push(`settings.animation.out "${String(raw.out)}" is not supported; using fade.`);
        return { in: inAnim ?? DEFAULT.in, out: outAnim ?? DEFAULT.out };
    }
    warnings.push('settings.animation is not a string or {in, out} object; using slide in, fade out.');
    return DEFAULT;
}
```
Note: the previous top-level default was `'slide'` for both; this keeps that
exact prior default for `in` (a theme that specified nothing keeps its old
look) but pairs it with `'fade'` for `out`, matching what every bundled theme
already effectively wanted (item 1's complaint was about the *fade* theme
specifically expecting an in+out pair, and `'slide'`-in/`'fade'`-out is a
reasonable default distinct enough that a queued rapid-fire test will show
the difference between in and out immediately, which helps live verification
in § 8). If this default is unwanted, it is Open Question Q1 (§ 9).

Run: `npm run check`. Expected: **errors** in `themed-toast.tsx` (className
template using `theme.animation` as a string) — expected, fixed in Phase 2.
Do not fix yet. Continue to step 1.5.

**Step 1.5: `tests/theme.test.ts`, new tests.** Append after the existing
`'settings and tier text-align parse and inherit correctly'` test (find its
closing `});`):
```ts
test('settings.animation: bare string sets both in and out', () => {
    const t = resolveTheme({ settings: { animation: 'fade' }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'fade', out: 'fade' });
});

test('settings.animation: {in, out} object sets each independently', () => {
    const t = resolveTheme({ settings: { animation: { in: 'ps5', out: 'fade' } }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'ps5', out: 'fade' });
});

test('settings.animation: missing keys in {in, out} fall back to the default per key', () => {
    const t = resolveTheme({ settings: { animation: { in: 'up' } }, themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'up', out: 'fade' });
});

test('settings.animation: unsupported value warns and uses the default pair', () => {
    const t1 = resolveTheme({ settings: { animation: 'bogus' }, themes: { normal: {} } });
    assert.deepEqual(t1.animation, { in: 'slide', out: 'fade' });
    assert.ok(t1.warnings.some((w) => w.includes('settings.animation')));

    const t2 = resolveTheme({ settings: { animation: { in: 'bogus' } }, themes: { normal: {} } });
    assert.deepEqual(t2.animation, { in: 'slide', out: 'fade' });
    assert.ok(t2.warnings.some((w) => w.includes('settings.animation.in')));
});

test('settings.animation: no setting at all defaults to slide in, fade out', () => {
    const t = resolveTheme({ themes: { normal: {} } });
    assert.deepEqual(t.animation, { in: 'slide', out: 'fade' });
});
```

Run: `npm test`. Expected: `ℹ tests 44` / `ℹ pass 44` / `ℹ fail 0`.

### Phase 2: CSS — split fade/slide/up/down into `_in`/`_out`, add `ps5`, fix ripple (item 1, 2, 3)

**Step 2.1: `frontend/banner/themed-toast.tsx`, className.**

Before:
```tsx
            className={`ea-banner ea-layout-${theme.layout} ea-anim-${theme.animation} ea-tier-${tier.tier}${banner.glow.spread > 0 ? ' ea-glow' : ''}${banner.glow.pulseMs > 0 ? ' ea-pulse' : ''}`}
```
After:
```tsx
            className={`ea-banner ea-layout-${theme.layout} ea-in-${theme.animation.in} ea-out-${theme.animation.out} ea-pos-${theme.position} ea-tier-${tier.tier}${banner.glow.spread > 0 ? ' ea-glow' : ''}${banner.glow.pulseMs > 0 ? ' ea-pulse' : ''}`}
```
`ea-pos-${theme.position}` is new: it is how the `ps5` preset's CSS picks its
slide direction without a runtime style (§ 1.2). It costs nothing when no
`ea-in-ps5`/`ea-out-ps5` rule matches.

Run: `npm run check`. Expected: exit 0 (no more errors — `theme.animation` is
no longer used as a bare string anywhere in this file).

**Step 2.2: `frontend/banner/styles.ts`, replace the whole animation block.**

Before (the entire block from `/* Entrance Animations */` through the four
`@keyframes ea-anim-*` blocks, i.e. from the `/* Entrance Animations */` comment
up to and including `@keyframes ea-anim-down { ... }`):
```css
/* Entrance Animations */
/* Steam no longer slides the window out (it is pinned), so the banner fades
   itself: Steam fades out after 300 ms fade-in + --toast-duration, over 300 ms. */
.ea-banner.ea-anim-fade, .ea-banner.ea-anim-slide, .ea-banner.ea-anim-up, .ea-banner.ea-anim-down {
    animation-name: var(--ea-enter), ea-exit;
    animation-duration: var(--ea-enter-ms), 300ms;
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1), ease-in;
    animation-delay: 0ms, calc(var(--toast-duration, 5000ms) + 300ms);
    animation-fill-mode: both, forwards;
}
.ea-anim-fade  { --ea-enter: ea-anim-fade;  --ea-enter-ms: 400ms; }
.ea-anim-slide { --ea-enter: ea-anim-slide; --ea-enter-ms: 350ms; }
.ea-anim-up    { --ea-enter: ea-anim-up;    --ea-enter-ms: 350ms; }
.ea-anim-down  { --ea-enter: ea-anim-down;  --ea-enter-ms: 350ms; }
@keyframes ea-exit { to { opacity: 0; } }

@keyframes ea-anim-fade {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes ea-anim-slide {
    from { opacity: 0; transform: translateX(100%); }
    to { opacity: 1; transform: translateX(0); }
}

@keyframes ea-anim-up {
    from { opacity: 0; transform: translateY(100%); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes ea-anim-down {
    from { opacity: 0; transform: translateY(-100%); }
    to { opacity: 1; transform: translateY(0); }
}
```
After:
```css
/* Entrance and exit animations, independently settable (themes.md § animation).
   Both run off the same two variables Steam gives us on the parent div:
   --toast-duration is set by Steam (nToastDurationMS + z); our own fade/slide
   timings are constants here, matching the pre-split defaults (400/350ms in,
   300ms out) so an unchanged theme looks identical to before this fix. */
.ea-banner {
    animation-name: var(--ea-in-name, none), var(--ea-out-name, none);
    animation-duration: var(--ea-in-ms, 0ms), var(--ea-out-ms, 0ms);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1), ease-in;
    animation-delay: 0ms, calc(var(--toast-duration, 5000ms) + var(--ea-in-ms, 0ms) - var(--ea-out-ms, 0ms) + var(--ea-out-ms, 0ms));
    animation-fill-mode: both, forwards;
}
/* The delay above simplifies to --toast-duration + --ea-in-ms: the exit
   should start once the toast has been fully visible for --toast-duration,
   measured from when the entrance *finishes*, not from t=0. Keeping it spelled
   with both terms documents that derivation instead of hiding it in one number. */

/* --- entrance (ea-in-*) --- */
.ea-in-fade  { --ea-in-name: ea-in-fade;  --ea-in-ms: 400ms; }
.ea-in-slide { --ea-in-name: ea-in-slide; --ea-in-ms: 350ms; }
.ea-in-up    { --ea-in-name: ea-in-up;    --ea-in-ms: 350ms; }
.ea-in-down  { --ea-in-name: ea-in-down;  --ea-in-ms: 350ms; }
.ea-in-none  { --ea-in-name: none;        --ea-in-ms: 0ms; }
/* ps5: slide in from the anchored screen edge + fade, direction from ea-pos-*. */
.ea-in-ps5.ea-pos-top_right, .ea-in-ps5.ea-pos-bottom_right { --ea-in-name: ea-in-slide;      --ea-in-ms: 450ms; }
.ea-in-ps5.ea-pos-top_left,  .ea-in-ps5.ea-pos-bottom_left  { --ea-in-name: ea-in-slide-left;  --ea-in-ms: 450ms; }
.ea-in-ps5.ea-pos-top_center                                { --ea-in-name: ea-in-down;        --ea-in-ms: 450ms; }
.ea-in-ps5.ea-pos-bottom_center                              { --ea-in-name: ea-in-up;          --ea-in-ms: 450ms; }

/* --- exit (ea-out-*) --- */
.ea-out-fade  { --ea-out-name: ea-out-fade;  --ea-out-ms: 300ms; }
.ea-out-slide { --ea-out-name: ea-out-slide; --ea-out-ms: 300ms; }
.ea-out-up    { --ea-out-name: ea-out-up;    --ea-out-ms: 300ms; }
.ea-out-down  { --ea-out-name: ea-out-down;  --ea-out-ms: 300ms; }
.ea-out-none  { --ea-out-name: none;         --ea-out-ms: 0ms; }
.ea-out-ps5.ea-pos-top_right, .ea-out-ps5.ea-pos-bottom_right { --ea-out-name: ea-out-slide;      --ea-out-ms: 400ms; }
.ea-out-ps5.ea-pos-top_left,  .ea-out-ps5.ea-pos-bottom_left  { --ea-out-name: ea-out-slide-left;  --ea-out-ms: 400ms; }
.ea-out-ps5.ea-pos-top_center                                  { --ea-out-name: ea-out-up;          --ea-out-ms: 400ms; }
.ea-out-ps5.ea-pos-bottom_center                                { --ea-out-name: ea-out-down;        --ea-out-ms: 400ms; }

@keyframes ea-in-fade  { from { opacity: 0; } to { opacity: 1; } }
@keyframes ea-out-fade { from { opacity: 1; } to { opacity: 0; } }

@keyframes ea-in-slide       { from { opacity: 0; transform: translateX(100%); }  to { opacity: 1; transform: translateX(0); } }
@keyframes ea-in-slide-left  { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
@keyframes ea-out-slide      { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100%); } }
@keyframes ea-out-slide-left { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-100%); } }

@keyframes ea-in-up   { from { opacity: 0; transform: translateY(100%); }  to { opacity: 1; transform: translateY(0); } }
@keyframes ea-out-up  { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(100%); } }
@keyframes ea-in-down  { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); } }
@keyframes ea-out-down { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-100%); } }
```
`ea-out-slide`/`ea-out-up`/`ea-out-down` now genuinely animate `transform`
alongside `opacity` (the pre-existing `ea-exit` only ever touched `opacity`,
so item 1's underlying complaint — the exit "looks like the only real
animation" — also gets a real motion component for every non-fade exit, not
only for `ps5`).

**Step 2.3: `frontend/banner/styles.ts`, ripple, replace `.ea-ripple` and its keyframes.**

Before:
```css
/* PS5-Style Blurry Water Ripple */
.ea-ripple {
    position: absolute;
    inset: -35%;
    border-radius: 50%;
    background: radial-gradient(circle, transparent 40%, rgba(255, 255, 255, 0.35) 55%, rgba(255, 255, 255, 0.75) 70%, transparent 80%);
    filter: blur(4px);
    pointer-events: none;
    animation: ea-ripple var(--ea-ripple) cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
}
@keyframes ea-ripple {
    0% { transform: scale(0.6); opacity: 1; }
    70% { opacity: 0.6; }
    100% { transform: scale(1.8); opacity: 0; }
}
```
After:
```css
/* Water-ripple: starts as a ring collapsed onto the icon's own outline and
   expands outward from there (like an object breaking the surface of water),
   not a pre-inflated blurred disc drifting further away. Fixed-size ring
   (inset: 0, same box as the icon) rather than a percentage inset, so it
   always starts exactly at the icon's edge regardless of icon scale. */
.ea-ripple {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: calc(1.5px * var(--ea-icon-scale, 1)) solid rgba(255, 255, 255, 0.85);
    filter: blur(calc(0.65px * var(--ea-icon-scale, 1)));
    pointer-events: none;
    transform: scale(1);
    opacity: 0;
    animation: ea-ripple var(--ea-ripple) cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
}
@keyframes ea-ripple {
    0%   { transform: scale(1);    opacity: 0.9; }
    15%  { opacity: 0.7; }
    100% { transform: scale(1.9);  opacity: 0; }
}
```
`border` (a ring outline) replaces the `radial-gradient` filled disc, matching
the reference's `outline` approach; `inset: 0` (not `-35%`) starts the ring
exactly at the icon's own box edge, matching "the ripple starts from the icon
circle onwards." `--ea-icon-scale` is already set per-icon by `themed-toast.tsx`'s
`Icon` component (`combinedStyle['--ea-icon-scale']`), so the ring's own
thickness and blur scale with the icon that owns it, same pattern the geometry
fix already used for icon sizing (`min(56px, var(--ea-inner-h)) * var(--ea-icon-scale)`).

Run: `npm run check && npm test`. Expected: exit 0, `ℹ pass 44` / `ℹ fail 0`.

**Step 2.4: `themes.md`, document the new `animation` shape and `ps5`.**

Find the line:
```
- **`animation`**: Entrance and exit transition: `"slide"`, `"fade"`, `"up"`, `"down"`.
```
Replace with:
```
- **`animation`**: Entrance and exit transition. Either one name for both
  (`"fade"` — the same as before), `"none"` (no animation for that state), or
  independent control: `{"in": "slide", "out": "fade"}`. Default when omitted:
  `{"in": "slide", "out": "fade"}`.
    - `"slide"`, `"up"`, `"down"`: enter and exit both move (the exit is the
      reverse motion of the entrance), not just fade.
    - `"ps5"`: slides in from the screen edge the banner is anchored to (and
      slides back out the same way) plus a fade, like a PS5 trophy popup.
      `top_center`/`bottom_center` slide vertically instead, since they have
      no horizontal edge to anchor to.
```

Run: `npm test`. Expected: unchanged (44/44 — docs are not tested, this is a sanity re-run).

### Phase 3: a real one-at-a-time queue (item 5)

**Step 3.1: new file `frontend/banner/queue.ts`.** Pure: no Steam, SDK or
`logger` import, so `tests/queue.test.ts` can run it directly under `npm test`
(Node's raw ESM loader does not resolve `../logger`'s extensionless import the
way the build tool does — this file must stay import-free of anything outside
itself to be test-runnable at all, same constraint as `theme/theme.ts` and
`capture/plan.ts`). The overflow case logs through a caller-supplied callback
instead of importing `logger` directly.
```ts
/**
 * One achievement banner visible at a time. A second (or later) unlock's
 * `ThemedToast` render is held back until the currently-showing one signals
 * it is fully gone (its exit animation ends, or its popup unmounts —
 * whichever happens; both are wired in themed-toast.tsx), then a fixed
 * `QUEUE_GAP_MS` later it becomes "current" and renders for real.
 *
 * Deliberately not a promise chain: React can mount/unmount a toast's
 * `Banner` more than once for the same logical toast (Steam re-renders its
 * toast stack on layout changes), so identity is the notification object
 * itself (a WeakMap-safe key), and `enter`/`leave` are idempotent.
 */

const QUEUE_GAP_MS = 100;
/** Bounded: an unbounded queue would hold popups Steam has already started
 * hiding on their own timer (banner-geometry-fix.md's lesson: don't fight
 * Steam's own timing). Anything past this many waiting is dropped from the
 * queue and shown immediately instead of risking a silently-skipped unlock. */
const MAX_QUEUE = 5;

let current: object | null = null;
const waiting: object[] = [];
const callbacks = new Map<object, () => void>();

function promote(): void {
    const next = waiting.shift();
    if (!next) {
        current = null;
        return;
    }
    current = next;
    const cb = callbacks.get(next);
    callbacks.delete(next);
    cb?.();
}

/**
 * True if `key` may render now; otherwise it is queued and `onTurn` fires
 * later. `onOverflow` (optional) is called once if the queue is full and
 * `key` is shown immediately instead of waiting — the caller (themed-toast.tsx)
 * passes `logger.warn` there, keeping this file itself logger-free.
 */
export function requestTurn(key: object, onTurn: () => void, onOverflow?: () => void): boolean {
    if (current === null) {
        current = key;
        return true;
    }
    if (current === key || waiting.includes(key)) return current === key;
    if (waiting.length >= MAX_QUEUE) {
        onOverflow?.();
        return true;
    }
    waiting.push(key);
    callbacks.set(key, onTurn);
    return false;
}

/** Call when `key`'s toast is fully gone (exit animation ended or unmounted). */
export function releaseTurn(key: object): void {
    callbacks.delete(key);
    const idx = waiting.indexOf(key);
    if (idx >= 0) waiting.splice(idx, 1);
    if (current !== key) return;
    setTimeout(promote, QUEUE_GAP_MS);
}

/** Test/dry-run only: drops all queue state. */
export function resetQueue(): void {
    current = null;
    waiting.length = 0;
    callbacks.clear();
}
```

**Step 3.2: new file `tests/queue.test.ts`.**
```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseTurn, requestTurn, resetQueue } from '../frontend/banner/queue.ts';

test('the first request always gets its turn immediately', () => {
    resetQueue();
    assert.equal(requestTurn({}, () => {}), true);
});

test('a second request while one is showing is queued, not immediate', () => {
    resetQueue();
    const a = {}, b = {};
    assert.equal(requestTurn(a, () => {}), true);
    let firedB = false;
    assert.equal(requestTurn(b, () => { firedB = true; }), false);
    assert.equal(firedB, false);
});

test('releasing the current turn schedules the next queued one (after the gap)', async () => {
    resetQueue();
    const a = {}, b = {};
    requestTurn(a, () => {});
    let firedB = false;
    requestTurn(b, () => { firedB = true; });
    releaseTurn(a);
    assert.equal(firedB, false); // not yet: QUEUE_GAP_MS hasn't elapsed
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(firedB, true);
});

test('a key already current or already queued is not queued twice', () => {
    resetQueue();
    const a = {};
    requestTurn(a, () => {});
    assert.equal(requestTurn(a, () => {}), true); // still current
});

test('releasing a queued (not current) key removes it without affecting current', async () => {
    resetQueue();
    const a = {}, b = {}, c = {};
    requestTurn(a, () => {});
    let firedB = false, firedC = false;
    requestTurn(b, () => { firedB = true; });
    requestTurn(c, () => { firedC = true; });
    releaseTurn(b); // b gives up its place before ever showing
    releaseTurn(a);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(firedB, false);
    assert.equal(firedC, true);
});

test('past MAX_QUEUE, a new request shows immediately instead of queueing forever', () => {
    resetQueue();
    requestTurn({}, () => {}); // current
    for (let i = 0; i < 5; i++) requestTurn({}, () => {}); // fills the 5-slot queue
    assert.equal(requestTurn({}, () => {}), true); // 6th waiting slot: shown anyway
});
```

Run: `npm test`. Expected: `ℹ tests 50` / `ℹ pass 50` / `ℹ fail 0`.

**Step 3.3: `frontend/banner/themed-toast.tsx`, wire the queue into `Banner`.**

- Import. Add after the `pinToastWindow` import:
  `import { releaseTurn, requestTurn } from './queue';`
- In `Banner`, right after
  `const n = toast.group?.notifications?.[0];\n    if (!loaded || !n) return <>{renderSteam(toast)}</>;`,
  add a `myTurn` state driven by the queue, keyed on `n.data` (already used as
  the tier memo key in `steam/notifications.ts`'s `tiers` WeakMap — same
  identity, same lifetime as the notification):
```tsx
    const [myTurn, setMyTurn] = useState(() =>
        requestTurn(n.data, () => setMyTurn(true), () => logger.warn('Achievement toast queue full; showing out of turn.')),
    );
    useEffect(() => () => releaseTurn(n.data), [n.data]);
    if (!myTurn) return null;
```
  This must run **before** any Steam window call (`useLayoutEffect` for
  `pinToastWindow`), so the popup stays present (Steam owns it) but visually
  blank until it is this toast's turn — add the `useState` import to the
  existing `react` import line (`import React, { Component, useLayoutEffect, useRef, ... }`
  becomes `import React, { Component, useEffect, useLayoutEffect, useRef, useState, ... }`).
- Release on the exit animation ending, not only on unmount (item 5's "wait
  for it to completely disappear" — the unmount from Steam's own `HideWindow`
  can lag the visual fade by Steam's own timing, but our exit keyframe
  finishing is the true "gone" moment users see). In the `useLayoutEffect`
  that calls `pinToastWindow`, after the existing pin logic, add an
  `animationend` listener scoped to the `ea-out-*` animation:
```tsx
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return undefined;
        const onEnd = (e: AnimationEvent) => {
            if (e.animationName.startsWith('ea-out-')) releaseTurn(n.data);
        };
        el.addEventListener('animationend', onEnd);
        return () => el.removeEventListener('animationend', onEnd);
    }, [n.data]);
```
  Placed after the `useLayoutEffect` block (new effect, does not replace it).
  With `ea-out-none` (no exit animation, `--ea-out-name: none`), `animationend`
  never fires for that name — the existing `useEffect(() => () => releaseTurn(n.data), [n.data])`
  cleanup on unmount is the fallback for that case, so a theme with
  `animation.out: "none"` still releases its queue slot (just later, on
  Steam's own unmount instead of on our fade).

Run: `npm run check`. Expected: exit 0.

**Step 3.4: guard the exceptional (synthetic 100%) toast and previews against the queue.**

The synthetic exceptional toast already fires on its own 1.5s `setTimeout`
after a completing unlock (`notifications.ts`, `installSoundHook`) — if the
real unlock's banner is still queued (because an earlier unlock is showing),
the exceptional one must not jump the queue or be lost. Since both go through
the same `ThemedToast` → `Banner` → `requestTurn(n.data, ...)` path with a
distinct `n.data` per notification (the exceptional one's payload is a
different message, `achievement_id: 'EA_100_PERCENT'`), this already queues
correctly with no code change — **verify this in step 8's live check (P3)**
rather than adding speculative code for a case the existing design already covers.

Preview (`previewTier`) and Test captures unlocks go through the same
`OnNotification` → toast → `Banner` path too, so they also queue naturally
behind any real unlock in progress. No change needed there either.

Run: `npm run check && npm test && npm run build`. Expected: exit 0,
`ℹ pass 50` / `ℹ fail 0`, `build Succeeded passing all tests`.

### Phase 4: docs

- `themes.md`: already updated in step 2.4 for `animation`. Add one line to
  § `icons` → `ripple_ms` bullet: "starts as a ring at the icon's own edge and
  expands outward (not a pre-inflated glow)." — matches the new behaviour.
- `enhanced-achievements/CHANGELOG.md` `[Unreleased]`, new entries under
  `### Added`: independent `animation.in`/`animation.out`, the `ps5` preset,
  and the one-at-a-time toast queue. Under `### Fixed`: the ripple now starts
  at the icon's edge instead of already-expanded.
- `docs/plans/enhanced-achievements-plan.md` § 5 guardrail table: add row 10,
  "Toast queue state (`banner/queue.ts`) is a plain array, never a Steam API
  call; Steam's own popup timing is never delayed or held — only our own
  render output is."

Run: `npm run check && npm test`. Expected: unchanged (50/50).

---

## 4. Do not touch

- `frontend/banner/geometry.ts`, `frontend/banner/window-pin.ts` (the
  position-pinning fix; the queue only adds a render gate in front of it, it
  does not change how a shown toast is placed).
- `frontend/steam/toast-patch.ts`, `frontend/steam/jsx-hook.ts`.
- `frontend/capture/**`, `frontend/steam/recording.ts`.
- `frontend/theme/theme.ts` outside the `animation` type/resolution (do not
  touch `resolveTier`'s `text.title`/`text.desc` handling — § 1.4 confirms it
  is already correct).
- Steam's own `NotificationStore`, `OnNotification`, `ProcessNotification`,
  toast-stack timing (`window-pin.ts`'s target popup regex, `PER_TOAST_POPUP`).

## 5. Banned actions

No deploy or Steam restart (`dev.ps1`); the user deploys. No SharedJSContext
reload. No probe or throwaway plugins beyond the read-only CDP checks in § 8
(which create real toasts on the running client the same way `tests/tiers.mjs`
already does — not a new capability). No edits to Millennium's `config.json`,
plugin config, or user theme files. No `npm install`/upgrade. No
`git push --force`, no `--no-verify`. Never intercept `ProcessNotification` or
`OnNotification` (§ 1.5's rejected designs).

**Failure rule:** run a failing command at most twice. On the second failure,
stop. Append the command, its output (at most 30 lines) and the step number to
`TASK.md` § Active Failures & Blockers, then exit.

## 6. Guardrail checklist (plugins.md)

| Guardrail | Proof it is not violated |
| --- | --- |
| 2. O(1) in hot methods | `requestTurn`/`releaseTurn` are array push/shift/splice on a queue bounded to 5; no Steam API call inside either. |
| 3. Single-pass webpack pre-caching | No new module resolution: the queue and CSS changes touch only this plugin's own code. |
| 5. No per-toast RPC in the hook | Unaffected — `notifications.ts`'s hook body is untouched by this plan. |
| 14. A new gate must never remove working behaviour | A theme with no `animation` setting resolves to `{in:'slide',out:'fade'}`, visually equal to the old default (`'slide'` used to mean the same entrance, `'fade'`-style exit motion is new but additive, not a removal). A single unlock (the common case) is shown immediately, unchanged. |
| Rules on every rung: graceful fallback | An unsupported `animation` value warns and falls back per-key (step 1.4); the queue's `MAX_QUEUE` overflow shows immediately rather than losing a toast. |

## 7. Commit

```
git add enhanced-achievements/frontend/banner enhanced-achievements/tests/theme.test.ts enhanced-achievements/tests/queue.test.ts enhanced-achievements/themes.md enhanced-achievements/CHANGELOG.md docs/plans/enhanced-achievements-plan.md
git commit -m "feat(enhanced-achievements): independent fade in/out, ps5 slide animation, edge-anchored ripple, one-at-a-time toast queue"
```

## 8. Live verification (user, after `dev.ps1` deploy)

**P1, animation.** Set the live theme's `settings.animation` to
`{"in": "slide", "out": "fade"}`, Preview each tier: entrance slides in from
the right (default `position`), exit fades in place, no snap. Then set it to
`"ps5"` with `position: "top_left"`: entrance and exit both slide from/to the
**left** edge with a fade. Then `position: "bottom_center"`: entrance slides
up from below, exit slides back down.

**P2, ripple.** On an icon with `ripple_ms` set (e.g. the theme's `system`
icon), confirm the ring starts exactly at the icon's own circular edge (not
already 35% further out) and expands outward from there, fading as it grows —
matching "falls on water, ripples from the icon outward."

**P3, queue.** Fire 3–4 unlocks within about a second of each other (the
existing `node tests/tiers.mjs` pattern, or rapid Preview clicks). Confirm:
only one banner is visible at any moment; the next appears about 100ms after
the previous one's exit animation finishes, not overlapping and not using its
own theme delay; the synthetic exceptional/platinum toast (if a completing
unlock is in the batch) also queues correctly rather than appearing on top of
another banner.

**P4, exceptional text (confirms § 1.4, no behaviour to change).** With the
live theme's `exceptional.text.title`/`desc` set, Preview the Exceptional
tier: the banner shows exactly those strings.

Then run the standing checks: `npm run check && npm test && npm run build`
(all clean, expect 50/50), `tests/tiers.mjs`, `tests/smoke.mjs`, and Routines
1–3 (`scratch/test_nav_cycle.js`, `scratch/check_all_tabs.js`) — unaffected by
this plan, but confirm no regression.

---

## 9. Open questions

1. **Default `animation` pair** (§ 1.4/Step 1.4): `{in: 'slide', out: 'fade'}`
   when a theme sets nothing. The prior single-value default was `'slide'`
   for both. OK, or should the default stay symmetric (`{in:'slide',out:'slide'}`)?
2. **`ps5` animation timings** (450ms in / 400ms out, § Step 2.2): picked to be
   slightly slower than plain slide/fade (350/300ms) since it combines two
   motions. Adjust after seeing it live (P1)?
3. **Queue overflow behaviour** (`MAX_QUEUE = 5`, § 3.1): past 5 waiting
   toasts, a new one shows immediately (skips the queue) rather than growing
   unbounded. Is 5 the right cutoff, or should overflow instead **drop** the
   oldest queued toast instead of jumping the newest one to the front?

**Dry-run (2026-09-25):** Phases 1–3 applied verbatim to a scratch copy
(theme.ts, theme.test.ts, queue.ts, queue.test.ts, themed-toast.tsx,
styles.ts). Every before block matched. Two bugs found and fixed in this plan
before handing it off:
- `queue.ts`'s draft imported `logger` from `'../logger'`, an extensionless
  local import Node's raw ESM loader (`--experimental-strip-types`, used by
  `npm test`) does not resolve, unlike the build tool. Fixed by making
  `queue.ts` fully import-free (pure, like `theme/theme.ts` and
  `capture/plan.ts`) and moving the one log call to an optional
  `onOverflow` callback the caller supplies (§ Step 3.1, 3.3 — both already
  reflect the fix above).
- The new `styles.ts` comment used literal backticks around `--toast-duration + --ea-in-ms`,
  which breaks out of the `BANNER_CSS` template-literal string (a real
  `tsc` syntax error, not just a lint nit). Fixed by dropping the backticks
  from that comment (§ Step 2.2 already reflects the fix).

After both fixes: `npx tsc --noEmit` clean, `npm test` (unit files)
`ℹ tests 50` / `ℹ pass 50` / `ℹ fail 0`. Phase 3's queue-gate wiring in
`themed-toast.tsx` was applied and type-checks together with the rest of the
file; its *runtime* behaviour (the `animationend` release, the actual queued
render gap) is not exercisable outside a live toast — covered only by § 8 P3.
