# Fix plan: `enhanced-achievements` banner size, position, margin and key names

> Bugfix plan for the implementer. Fixes the five issues from the user's alpha
> smoke test (2026-09-25) in `enhanced-achievements` (EA). **No new features.**
>
> Written 2026-09-25 from live CDP probes of the running desktop client
> (`enhanced-achievements-dev` deployed, DPR 1.25, 2560×1440 monitor) plus
> source reading. Module ids (`48197`, `51582`, `78506`, `44846`) and minified
> names are **breadcrumbs from this build**. Code must never resolve by them.

---

## 1. The reported issues

| # | Reported | Root cause (section 2) |
| --- | --- | --- |
| 1 | `banner.scale` scales everything inside the banner, not only its width and height | 2.4 |
| 2 | With a larger `scale`, the banner loses its anchor and grows off-screen (e.g. at `bottomright`) | 2.1, 2.2 |
| 3 | Key values are inconsistent: `"topright"` should be `"top_right"` like every other value | 2.5 |
| 4 | Position flickers and is inconsistent: sometimes top, sometimes Steam's default spot, sometimes it starts bottom then jumps to top | 2.1, 2.3 |
| 5 | `margin` does not push the banner away from its anchor (margin 5 at top right should mean 5 px left and 5 px down from the corner) | 2.2 |

---

## 2. Root cause with evidence

### 2.1 Steam's desktop toast stack moves the window every frame, and we race it

Desktop toasts get **one popup per toast** (steam-components.md § Resolution
signatures & toast windows). The stack manager that owns these popups (module
`48197`, function `Q`) runs a `requestAnimationFrame` loop. For each toast it
computes a position from **Steam's** notification-position setting and a
**fixed width constant**, and calls
`toast.m_popup.SteamClient.Window.MoveTo(x, y, m_flDPI)` whenever that position
differs from its own cached `m_nLastX/m_nLastY`:

```js
const z=0, W=300 /*fade-in ms*/, U=300 /*fade-out ms*/, V=0, H=283 /*toast width*/;
// right-anchored:  n = right - H;   bottom-anchored: s = C + a  (a = slide offset)
n===e.toast.m_nLastX && s===e.toast.m_nLastY || (e.toast.m_popup.SteamClient.Window.MoveTo(n,s,t.m_flDPI), e.toast.m_nLastX=n, e.toast.m_nLastY=s)
```

During fade-in (300 ms) and fade-out (300 ms) the slide offset `a` changes every
frame, so Steam calls `MoveTo` about 18 times in each phase. It caches its own
last position, not the window's real one, so it never notices that we moved it.

EA's banner (`frontend/banner/themed-toast.tsx:137-208`) calls `ResizeTo` once
and `MoveTo` at 0, 100 and 300 ms. **Live capture of one `TestAchievement(480)`**
(every `MoveTo`/`ResizeTo`/`ShowWindow`/`HideWindow` on the popup, caller
from the stack; theme `ps5_example` from the user themes folder, `top_right`, margin 15):

```
t=201  ResizeTo [400,70,true]      EA
t=201  MoveTo   [1633,15,true]     EA      <- our target (wrong units, 2.2)
t=202  MoveTo   [1765,1174,1.25]   STEAM   <- bottom-right, slide-in start
t=202  ShowWindow                  STEAM
t=205…486  MoveTo [1765, 1172→1040, 1.25]  STEAM (every frame)
t=303  MoveTo   [1633,15,true]     EA      <- overwritten 17 ms later
t=502  MoveTo   [1633,15,true]     EA      <- same millisecond as ↓
t=502  MoveTo   [1765,1034,1.25]   STEAM   <- last write wins: bottom-right
t=4544…4802 MoveTo [1765, 1040→1172, 1.25] STEAM (fade-out slide)
t=4819 HideWindow                  STEAM
```

Whichever of EA's 502 ms timer and Steam's last fade-in frame runs last decides
where the banner rests. That is issue 4 exactly: sometimes top, sometimes
Steam's corner, sometimes bottom then a jump to top. The fade-out always
drags it back to Steam's corner.

### 2.2 Wrong coordinate units, and Steam anchors with its own fixed width

- `MoveTo`'s third argument is a **DPI number**. Steam's toast loop passes
  `m_flDPI` (1.25 here). Steam's own centred popup (module `51582`) does
  `ResizeTo(w, h, true); MoveTo(x, y, m_flDPI)`. EA passes `true` (= 1), so
  its CSS-pixel coordinates are applied as **physical** pixels: `1633, 15` lands at
  1306, 12 in CSS px. The banner is about 340 px short of the right edge and
  only about 12 px from the top. That is why margin looks wrong (issue 5).
- The coordinate space is the popup's `screen.avail*`. Live: `availWidth 2048`,
  Steam's `x = 1765 = 2048 − 283`. `ResizeTo(w, h, true)` (CSS px, scaled by the
  browser) is already correct: the popup measured `innerWidth 400 × innerHeight 71`.
- Steam computes `x = right − H` with `H = 283`, whatever size we resized the
  window to. A 400 px (or scaled 800 px) banner therefore starts at
  `right − 283`, and the extra width goes **off the right edge**. The same
  happens at the bottom: Steam uses its own `m_nToastHeight` (70). That is issue 2.

### 2.3 A second, competing mechanism: `applyPosition()` rewrites Steam's global setting

`frontend/steam/notifications.ts:263-286`, `applyPosition()`, calls
`ActiveWindowInstance.SetNotificationPosition(enum, marginX, marginY)`. It runs
at init, on theme change, on `banner.enabled` change, **on every unlock inside the
`PlayNotificationSound` hook** (line 142), on preview (293, 320) and on test
unlock (354).

- It writes **Steam's** in-memory position for every toast in that window
  instance (friends, downloads, enhanced-notifications), not only ours.
  Steam's `SetNotificationPosition(e,t,r)` (module `78506`) sets
  `m_notificationPosition` directly. It is never restored on dispose.
- It has no reliable effect. Live, after init and several unlocks with
  `top_right`/15, the active instance still read
  `{"position":3,"horizontalInset":0,"verticalInset":0}` (bottom right, no
  inset), and Steam's loop kept anchoring bottom-right. Something resets it,
  or it writes an instance the desktop stack does not read. It also runs inside
  `PlayNotificationSound`, which Steam calls **after** the first `MoveTo`
  (`ShowWindow(); PlayNotificationSound(n)`), so it is always one toast late.
- `topcenter`/`bottomcenter` are mapped to the right corners
  (`POSITION_ENUM`). Steam's enum (module `44846`) has only the four corners:
  `TopLeft=0, TopRight=1, BottomLeft=2, BottomRight=3`.

When this write does land, Steam's loop and EA's timers agree on the top. When
it does not, they disagree. That makes issue 4 intermittent rather than constant.

### 2.4 Content scales with the box (issue 1)

`frontend/banner/styles.ts` and `themed-toast.tsx`:

- Title and description font sizes include the box scale:
  `--ea-title-size: calc(sizePct/100 * 14px * var(--ea-scale-y, 1))` (themed-toast.tsx:218, 224).
- Both are then clamped to the box height by a container query:
  `font-size: min(var(--ea-title-size), 24cqh)` / `18cqh` (styles.ts:170, 175)
  with `container-type: size` on `.ea-banner` (styles.ts:26). **Live:** the
  theme asks for a 120 % title (16.8 px), and it renders at **9.885 px** in a
  400×71 banner. The clamp is what sizes the text, so any taller box gives
  larger text even without the scale factor.
- Icons are sized as a percentage of the box height: `.ea-zone-left .ea-icon { height: 100% }`,
  `.ea-zone-right .ea-icon { height: 60% }`, `.ea-system { height: 48% }`
  (styles.ts:125-128, 190-197, 204-208). They are capped by
  `56px/34px × icon scale`, so they grow with the box until the cap.

### 2.5 Key values are inconsistent (issue 3)

Every multi-word **value** in the schema is `snake_case` (`default_steam`,
`compact_pill`, `default_system_right`, `title_left`, `achievement_right`),
and so is every multi-word **key** (`display_time_ms`, `gradient_angle`,
`background_color`). There are two exceptions:

- `settings.position` values are run together: `topright`, `bottomcenter`, …
  (`theme.ts:14`, `themes.md:26`, every bundled theme).
- `settings["text-align"]` is kebab-case (`theme.ts:329`, `themes.md:29`, `themes/ps5_example.json:7`).

### 2.6 Ruled out

- **ResizeTo units**: `ResizeTo(w, h, true)` matches Steam's own usage and
  measured exactly 400×71 CSS px. It is not a cause, so keep the call and its units.
- **Theme file mix-up**: the loaded theme is the user copy
  `<steam>/millennium/config/enhanced-achievements/themes/ps5_example.json`
  (margin 15), which overrides the bundled one (margin 5). Both say `topright`.
  The redeploy on 2026-09-25 did not touch the user copy.
- **Two plugin copies**: only `enhanced-achievements-dev` is deployed and enabled (2026-09-25).
- **Big Picture**: not part of these reports. Its toast is one persistent
  BrowserView popup that Steam places with CSS. See 3.4.

---

## 3. The fix (design)

### 3.1 One owner for the window's position: our banner, per popup

Steam's loop stays in charge of **timing**: fade-in, show, fade-out, `HideWindow`
and dismissal. For our themed popups only, the banner takes over **where** the
window goes. It replaces that popup's own `SteamClient.Window.MoveTo` with a
function that ignores Steam's `(x, y)` and moves to our target, using the DPI
Steam passes in.

- **Verified live:** `SteamClient.Window` on the toast popup is an own object,
  and `MoveTo` is an own property with `writable: true, configurable: true`.
  The replacement is scoped to one popup that Steam destroys after the toast.
  Nothing global is patched.
- **Install it in `useLayoutEffect`.** The banner is a descendant of Steam's
  `Y` component, whose passive `useEffect` registers the popup with the stack.
  Layout effects run before passive effects in the same commit, so the replacement is in
  place **before** Steam's first `MoveTo` + `ShowWindow`. The first visible
  frame is already at the target. There are no timers and no race.
- **Only per-toast popups** are pinned. The popup's `window.name` must match
  `^notificationtoasts_(\d+_desktop|uid\d+-\d+)$`. Live, `window.name` equals
  the CDP title (`notificationtoasts_10037_desktop`). That covers desktop and the
  in-game overlay (`notificationtoasts_uid<appid>-<id>`). Big Picture's
  persistent popup has no `-<id>`, so it is left alone (3.4).
- **Stacking:** two themed banners at once would share one target. A
  module-level slot list gives each live pinned popup the lowest free slot.
  Slot `k` is offset by `k × (height + 8)` away from the anchor edge. Slots free on unmount.
- **Exit animation:** Steam's fade-out used to be a window slide. The window
  now stays put, so the banner fades itself out. `--toast-duration`
  (`nToastDurationMS`, set by Steam on the parent div) is inherited. Live it read `4000ms`.
  Steam fades out after `300 ms + duration`, over 300 ms, then hides the window.
  So `.ea-banner` gets an `ea-exit` opacity animation with delay
  `calc(var(--toast-duration, 5000ms) + 300ms)` and duration `300ms`.

### 3.2 Pure geometry, unit tested

New `frontend/banner/geometry.ts`, with no Steam or SDK imports, so it runs under `npm test`:

- `bannerSize(layout, banner)` returns `{ baseW, baseH, width, height, innerH }`.
  - The base size keeps today's defaults: 400 wide for `ps5`, `custom` and
    `default_system_right`, otherwise 283; 70 tall, or 48 for `compact_pill`;
    `banner.width` and `banner.height` override.
  - `width` and `height` are `round(base × scale / 100)`.
  - `innerH` is `baseH − 2 × padding[0] − 2 × border.width`. It uses the
    **unscaled** base, so the content size never depends on `scale`.
- `placeBanner(position, margin, size, avail, slot)` returns `{ x, y }` in the popup's CSS px:
  - `*_right: x = avail.left + avail.width − width − margin[1]`
  - `*_left: x = avail.left + margin[1]`
  - `*_center: x = avail.left + round((avail.width − width) / 2)` (the horizontal margin is ignored)
  - `top_*: y = avail.top + margin[0] + slot × (height + 8)`
  - `bottom_*: y = avail.top + avail.height − height − margin[0] − slot × (height + 8)`
  - Finally both are clamped into the avail rect, so a large `scale` or a
    negative margin can never push the banner off-screen (issue 2).

### 3.3 Content no longer scales with the box

- Font sizes are `sizePct/100 × 14px` (title) and `× 12px` (description). The
  `--ea-scale-*` factors, the `cqh` clamps and `container-type: size` are removed.
- Icon sizes are derived from `--ea-inner-h` (the unscaled content height) and
  the icon's own `scale_pct`, never from the scaled box:
  - achievement: `min(56px, inner-h) × icon scale`;
  - right-zone icons: `min(34px, 0.6 × inner-h) × icon scale`;
  - system icon: `min(34px, 0.48 × inner-h) × icon scale`.
- `scale` then only changes the window and banner box. Content stays at the
  size the theme's `text` and `icons` ask for, vertically centred as now.

### 3.4 Out of scope, recorded

- **Big Picture** keeps Steam's 300×80 frame and placement. Scale and position
  do not apply there. The current code calls `ResizeTo`/`MoveTo` on that
  persistent popup too, and the fix stops that. Add it to themes.md
  § Known limitations.
- **In-game overlay:** covered by the same code path, but the overlay popup's
  `screen.avail*` space is unverified. User test U7 checks it.
- **Overlap with Steam's other toasts:** our banner is no longer part of
  Steam's stack arithmetic, which still reserves `m_nToastHeight` (70) for it
  in Steam's own corner. A non-achievement toast at the same moment can sit
  where Steam thinks our toast is. That was already true before this fix, which
  also fought the stack. Recorded as a known limitation.

---

## 4. Preconditions

Run in `enhanced-achievements/`:

| Command | Expected |
| --- | --- |
| `git status --short` | empty (clean tree) |
| `npm run check` | only the npm banner (`> tsc --noEmit`), exit 0 |
| `npm test` | ends `ℹ tests 34` / `ℹ pass 34` / `ℹ fail 0` |

---

## 5. Ordered steps

Baseline counts are in section 4. After every step run
`npm run check && npm test` unless the step names a different command.

### Phase 1: key names (issue 3)

**Step 1.1: `frontend/theme/theme.ts`, `POSITIONS`.**

Before:
```ts
export const POSITIONS = ['topright', 'topleft', 'bottomright', 'bottomleft', 'topcenter', 'bottomcenter'] as const;
export type ToastPosition = (typeof POSITIONS)[number];
```
After:
```ts
export const POSITIONS = ['top_right', 'top_left', 'bottom_right', 'bottom_left', 'top_center', 'bottom_center'] as const;
export type ToastPosition = (typeof POSITIONS)[number];

/** Pre-0.1.0-alpha.2 spellings: still accepted, with a deprecation warning. */
const LEGACY_POSITIONS: Record<string, ToastPosition> = {
    topright: 'top_right',
    topleft: 'top_left',
    bottomright: 'bottom_right',
    bottomleft: 'bottom_left',
    topcenter: 'top_center',
    bottomcenter: 'bottom_center',
};
```

**Step 1.2: `frontend/theme/theme.ts`, `resolveTheme`, text alignment.**

Before:
```ts
    const rawTextAlign = settings['text-align'] ?? settings.textAlign ?? settings.text_align;
    let textAlign = oneOf(rawTextAlign, TEXT_ALIGNS);
    if (rawTextAlign !== undefined && !textAlign) {
        warnings.push(`settings.text-align "${String(rawTextAlign)}" is not supported; using left.`);
        textAlign = 'left';
    }
```
After:
```ts
    if (settings['text-align'] !== undefined || settings.textAlign !== undefined) {
        warnings.push('settings "text-align" is deprecated; use "text_align".');
    }
    const rawTextAlign = settings.text_align ?? settings['text-align'] ?? settings.textAlign;
    let textAlign = oneOf(rawTextAlign, TEXT_ALIGNS);
    if (rawTextAlign !== undefined && !textAlign) {
        warnings.push(`settings.text_align "${String(rawTextAlign)}" is not supported; using left.`);
        textAlign = 'left';
    }
```

**Step 1.3: `frontend/theme/theme.ts`, `resolveTheme`, position.**

Before:
```ts
    let position = oneOf(settings.position, POSITIONS);
    if (settings.position !== undefined && !position) {
        warnings.push(`settings.position "${String(settings.position)}" is not supported; using bottomright.`);
        position = 'bottomright';
    }
```
After:
```ts
    let position = oneOf(settings.position, POSITIONS);
    const legacy = typeof settings.position === 'string' ? LEGACY_POSITIONS[settings.position] : undefined;
    if (!position && legacy) {
        warnings.push(`settings.position "${String(settings.position)}" is deprecated; use "${legacy}".`);
        position = legacy;
    }
    if (settings.position !== undefined && !position) {
        warnings.push(`settings.position "${String(settings.position)}" is not supported; using bottom_right.`);
        position = 'bottom_right';
    }
```

And in the returned object, before: `        position: position ?? 'bottomright',`,
after: `        position: position ?? 'bottom_right',`.

Run: `npm run check`. Expected: **errors** in `frontend/banner/themed-toast.tsx`
(`case 'topleft'` etc.) and `frontend/steam/notifications.ts`. Both are
removed in Phase 3. Do not fix them here. Go to step 1.4 and run only `npm test` for this phase.

**Step 1.4: `tests/theme.test.ts`.**

Before:
```ts
test('settings: position parses supported values and falls back', () => {
    const t1 = resolveTheme({ settings: { position: 'topright' }, themes: { normal: {} } });
    assert.equal(t1.position, 'topright');
    const t2 = resolveTheme({ settings: { position: 'invalid' }, themes: { normal: {} } });
    assert.equal(t2.position, 'bottomright');
    assert.ok(t2.warnings.some((w) => w.includes('settings.position')));
});
```
After:
```ts
test('settings: position parses supported values and falls back', () => {
    const t1 = resolveTheme({ settings: { position: 'top_right' }, themes: { normal: {} } });
    assert.equal(t1.position, 'top_right');
    assert.equal(t1.warnings.length, 0);
    const t2 = resolveTheme({ settings: { position: 'invalid' }, themes: { normal: {} } });
    assert.equal(t2.position, 'bottom_right');
    assert.ok(t2.warnings.some((w) => w.includes('settings.position')));
});

test('settings: legacy run-together positions still load, with a deprecation warning', () => {
    const t = resolveTheme({ settings: { position: 'bottomcenter' }, themes: { normal: {} } });
    assert.equal(t.position, 'bottom_center');
    assert.ok(t.warnings.some((w) => w.includes('deprecated') && w.includes('bottom_center')));
});
```

In `'settings and tier text-align parse and inherit correctly'`, replace both
`settings: { 'text-align': ... }` with `settings: { text_align: ... }`, and
replace `w.includes('text-align')` with `w.includes('text_align')`. Then append:
```ts
test('settings: legacy "text-align" still loads, with a deprecation warning', () => {
    const t = resolveTheme({ settings: { 'text-align': 'right' }, themes: { normal: {} } });
    assert.equal(t.textAlign, 'right');
    assert.ok(t.warnings.some((w) => w.includes('deprecated') && w.includes('text_align')));
});
```

Run: `npm test`. Expected: `ℹ tests 36` / `ℹ pass 36` / `ℹ fail 0`.

**Step 1.5: bundled themes and docs.**
- `themes/ps5_example.json`: `"position": "topright"` becomes `"position": "top_right"`;
  `"text-align": "left"` becomes `"text_align": "left"`.
- `themes/steam_tiers.json`, `examples/steam_ps_exemple.json`, `examples/theme_exemple.json`:
  `"position": "topright"` becomes `"position": "top_right"`.
- `themes.md` line 26: list `"top_right"`, `"top_left"`, `"bottom_right"`,
  `"bottom_left"`, `"top_center"`, `"bottom_center"`, and add the sentence: "The
  pre-alpha.2 spellings (`"topright"`, …) still load, with a warning."
- `themes.md` line 29: `` **`text-align`** `` becomes `` **`text_align`** ``, and add
  "(`"text-align"` still loads, with a warning)".

Run: `npm test`. Expected: 36/36 (the bundled-asset test still passes).

### Phase 2: pure geometry (issues 1, 2 and 5, math only)

**Step 2.1: new file `frontend/banner/geometry.ts`.**
```ts
import type { BannerStyle, Layout, ToastPosition } from '../theme/theme';

/**
 * Banner window geometry. Pure: no Steam or SDK imports (tests/geometry.test.ts).
 *
 * All values are CSS px in the toast popup's `screen.avail*` space, the space
 * Steam's own toast loop uses (docs/plans/enhanced-achievements-banner-geometry-fix.md § 2.2).
 */

export const STACK_GAP_PX = 8;

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface BannerSize {
    baseW: number;
    baseH: number;
    /** Window and box size: base × scale. */
    width: number;
    height: number;
    /** Content height of the unscaled box; content is sized from this, never from `scale`. */
    innerH: number;
}

export function bannerSize(layout: Layout, banner: BannerStyle): BannerSize {
    const wide = layout === 'ps5' || layout === 'custom' || layout === 'default_system_right';
    const baseW = banner.width ?? (wide ? 400 : 283);
    const baseH = banner.height ?? (layout === 'compact_pill' ? 48 : 70);
    return {
        baseW,
        baseH,
        width: Math.round((baseW * banner.scale[0]) / 100),
        height: Math.round((baseH * banner.scale[1]) / 100),
        innerH: Math.max(0, baseH - 2 * banner.padding[0] - 2 * banner.border.width),
    };
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/** `margin` is `[vertical, horizontal]`; it pushes the banner inward from its anchor corner. */
export function placeBanner(
    position: ToastPosition,
    margin: [number, number],
    size: { width: number; height: number },
    avail: Rect,
    slot = 0,
): { x: number; y: number } {
    const [mv, mh] = margin;
    const { width: w, height: h } = size;
    const step = slot * (h + STACK_GAP_PX);

    let x: number;
    if (position.endsWith('_left')) x = avail.left + mh;
    else if (position.endsWith('_right')) x = avail.left + avail.width - w - mh;
    else x = avail.left + Math.round((avail.width - w) / 2);

    let y = position.startsWith('top_') ? avail.top + mv + step : avail.top + avail.height - h - mv - step;

    x = clamp(x, avail.left, avail.left + Math.max(0, avail.width - w));
    y = clamp(y, avail.top, avail.top + Math.max(0, avail.height - h));
    return { x: Math.round(x), y: Math.round(y) };
}
```

**Step 2.2: new file `tests/geometry.test.ts`.** It uses the live screen from
section 2.2 (avail 2048×1104) and a 400×70 banner:
```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerSize, placeBanner } from '../frontend/banner/geometry.ts';

const avail = { left: 0, top: 0, width: 2048, height: 1104 };
const size = { width: 400, height: 70 };
const banner = (scale: [number, number]) => ({
    scale,
    background: ['#000'],
    gradientAngle: 90,
    border: { width: 0, color: '#fff', radius: 0 },
    glow: { color: '#000', spread: 0, pulseMs: 0 },
    margin: [5, 5] as [number, number],
    padding: [8, 8] as [number, number],
    gap: [5, 5] as [number, number],
});

test('placeBanner: every anchor with margin 5 is 5 px in from its corner', () => {
    assert.deepEqual(placeBanner('top_right', [5, 5], size, avail), { x: 1643, y: 5 });
    assert.deepEqual(placeBanner('top_left', [5, 5], size, avail), { x: 5, y: 5 });
    assert.deepEqual(placeBanner('bottom_right', [5, 5], size, avail), { x: 1643, y: 1029 });
    assert.deepEqual(placeBanner('bottom_left', [5, 5], size, avail), { x: 5, y: 1029 });
    assert.deepEqual(placeBanner('top_center', [5, 5], size, avail), { x: 824, y: 5 });
    assert.deepEqual(placeBanner('bottom_center', [5, 5], size, avail), { x: 824, y: 1029 });
});

test('placeBanner: a scaled banner stays anchored and on screen', () => {
    assert.deepEqual(placeBanner('bottom_right', [5, 5], { width: 800, height: 140 }, avail), { x: 1243, y: 959 });
    assert.deepEqual(placeBanner('top_right', [0, 0], { width: 3000, height: 70 }, avail), { x: 0, y: 0 });
});

test('placeBanner: negative margins are clamped to the screen edge', () => {
    assert.deepEqual(placeBanner('top_left', [-50, -50], size, avail), { x: 0, y: 0 });
    assert.deepEqual(placeBanner('bottom_right', [-50, -50], size, avail), { x: 1648, y: 1034 });
});

test('placeBanner: stack slots move away from the anchor edge', () => {
    assert.deepEqual(placeBanner('top_right', [5, 5], size, avail, 1), { x: 1643, y: 83 });
    assert.deepEqual(placeBanner('bottom_right', [5, 5], size, avail, 1), { x: 1643, y: 951 });
});

test('bannerSize: scale changes the box, never the content height', () => {
    const a = bannerSize('ps5', banner([100, 100]));
    const b = bannerSize('ps5', banner([200, 150]));
    assert.deepEqual([a.width, a.height, a.innerH], [400, 70, 54]);
    assert.deepEqual([b.width, b.height, b.innerH], [800, 105, 54]);
    assert.equal(bannerSize('compact_pill', banner([100, 100])).height, 48);
    assert.equal(bannerSize('default_steam', banner([100, 100])).width, 283);
});
```

Run: `npm test`. Expected: `ℹ tests 41` / `ℹ pass 41` / `ℹ fail 0`.

### Phase 3: window placement and content sizing (issues 1, 2, 4, 5)

**Step 3.1: remove `applyPosition` from `frontend/steam/notifications.ts`.**
- Delete `interface ActiveWindowInstance`, `let activeWindowInstance`,
  `function getActiveWindowInstance`, `const POSITION_ENUM` and
  `export function applyPosition` (lines 238-286, from
  `interface ActiveWindowInstance {` through the closing `}` of `applyPosition`).
- Delete each call line `applyPosition();`. There are 7, at lines 142, 293,
  320, 354, 395, 398 and 403 (before this step). After deleting, the blocks read:
  - `onThemeChange(() => {\n        applyDuration();\n    });`
  - `if (key === 'banner.enabled') {\n            applyDuration();\n        }`
- Check that `findExports` is still used in the file
  (`grep -n findExports frontend/steam/notifications.ts`). If the only
  remaining hit is the import line, remove it from the import.

Run: `grep -rn "applyPosition\|SetNotificationPosition\|ActiveWindowInstance" frontend`. Expected: no output.

**Step 3.2: new file `frontend/banner/window-pin.ts`.**
```ts
import { logger } from '../logger';

/**
 * Pins one desktop / in-game overlay toast popup to our computed position.
 *
 * Steam's toast stack moves every toast popup each frame of its fade-in and
 * fade-out, anchored with its own position setting and a fixed 283 px width
 * (docs/plans/enhanced-achievements-banner-geometry-fix.md § 2.1). Instead of
 * racing it, this replaces **that popup's own** `SteamClient.Window.MoveTo`
 * (an own, writable property; verified live) so Steam keeps the timing and we
 * decide the place. Nothing global is patched, and the popup is destroyed with the toast.
 *
 * Big Picture's single persistent toast popup is never pinned (§ 3.4).
 */

type MoveTo = (x: number, y: number, dpi?: number | boolean) => void;
interface WindowApi {
    MoveTo: MoveTo;
    ResizeTo(width: number, height: number, applyBrowserScale: boolean): void;
}

const PER_TOAST_POPUP = /^notificationtoasts_(\d+_desktop|uid\d+-\d+)$/;

/** Live pinned popups by stack slot; `null` is a free slot. */
const slots: (Window | null)[] = [];

export interface PinTarget {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Returns an unpin function, or null when this window is not a per-toast popup. */
export function pinToastWindow(win: Window, targetFor: (slot: number) => PinTarget): (() => void) | null {
    if (!PER_TOAST_POPUP.test(win.name)) return null;
    const api = (win as unknown as { SteamClient?: { Window?: WindowApi } }).SteamClient?.Window;
    if (!api || typeof api.MoveTo !== 'function' || typeof api.ResizeTo !== 'function') return null;

    let slot = slots.indexOf(null);
    if (slot < 0) slot = slots.length;
    slots[slot] = win;

    const target = targetFor(slot);
    const original = api.MoveTo;
    const dpiOf = (dpi: unknown) => (typeof dpi === 'number' && dpi > 0 ? dpi : win.devicePixelRatio || 1);
    const pinned: MoveTo = (_x, _y, dpi) => original.call(api, target.x, target.y, dpiOf(dpi));

    try {
        api.ResizeTo(target.width, target.height, true);
        api.MoveTo = pinned;
        original.call(api, target.x, target.y, dpiOf(undefined));
    } catch (error) {
        logger.warn('Could not pin the toast window; Steam places it.', error);
        api.MoveTo = original;
        slots[slot] = null;
        return null;
    }

    return () => {
        if (api.MoveTo === pinned) api.MoveTo = original;
        slots[slot] = null;
        while (slots.length && slots[slots.length - 1] === null) slots.pop();
    };
}
```

**Step 3.3: `frontend/banner/themed-toast.tsx`, replace the placement effect.**

- Imports. Before:
  `import React, { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';`
  After:
  `import React, { Component, useLayoutEffect, useRef, type ErrorInfo, type ReactNode } from 'react';`
  Add:
  `import { bannerSize, placeBanner } from './geometry';`
  `import { pinToastWindow } from './window-pin';`
- In `Banner`, delete `const scaleX = …;` and `const scaleY = …;` (lines 105-106).
  After `const banner = tier.banner ?? tier.box;`, add
  `const size = bannerSize(theme.layout, banner);`.
- In `rootStyle`, delete the five lines `'--ea-scale-x'`, `'--ea-scale-y'`,
  `'--ea-scale'`, `'--ea-margin-y'` and `'--ea-margin-x'`, and add
  `'--ea-inner-h': \`${size.innerH}px\`,`.
- Replace the whole `useEffect(() => { … }, [banner.scale, banner.margin, banner.width, banner.height, theme.position, theme.layout]);`
  block (lines 137-208) with:
```tsx
    useLayoutEffect(() => {
        const win = rootRef.current?.ownerDocument?.defaultView;
        if (!win) return undefined;
        const s = win.screen as Screen & { availLeft?: number; availTop?: number };
        const avail = { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
        const unpin = pinToastWindow(win, (slot) => ({
            ...placeBanner(theme.position, banner.margin, size, avail, slot),
            width: size.width,
            height: size.height,
        }));
        return unpin ?? undefined;
        // Pinned once per toast: a toast's theme does not change while it is shown.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
```
  (There is no ESLint in this repo, and the comment is harmless. The empty
  dependency list is deliberate: re-pinning mid-toast would take a new slot.)
- `titleStyle`: `calc(${text.title.sizePct / 100} * 14px * var(--ea-scale-y, 1))`
  becomes `calc(${text.title.sizePct / 100} * 14px)`.
- `descStyle`: `calc(${text.desc.sizePct / 100} * 12px * var(--ea-scale-y, 1))`
  becomes `calc(${text.desc.sizePct / 100} * 12px)`.

Run: `npm run check`. Expected: exit 0, no errors (the Phase 1 errors are gone).

**Step 3.4: `frontend/banner/styles.ts`.**
- `.ea-banner`: delete `    container-type: size;`.
- `.ea-title`: `font-size: min(var(--ea-title-size), 24cqh);` becomes `font-size: var(--ea-title-size);`.
- `.ea-desc`: `font-size: min(var(--ea-desc-size), 18cqh);` becomes `font-size: var(--ea-desc-size);`.
- `.ea-zone-left .ea-icon`: replace
  `height: 100%;\n    max-height: calc(56px * var(--ea-icon-scale, 1));` with
  `height: calc(min(56px, var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1));`
- `.ea-zone-right .ea-icon`: replace
  `height: 60%;\n    max-height: calc(34px * var(--ea-icon-scale, 1));` with
  `height: calc(min(34px, 0.6 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1));`
- `.ea-zone-right .ea-system { height: 48%; }` becomes
  `.ea-zone-right .ea-system { height: calc(min(34px, 0.48 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); }`
- Classic classes (the last block):
  - `.ea-achievement { height: 100%; max-height: calc(56px * var(--ea-icon-scale, 1)); aspect-ratio: 1; }`
    becomes `.ea-achievement { height: calc(min(56px, var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); aspect-ratio: 1; }`
  - `.ea-badges .ea-icon { height: 60%; max-height: calc(34px * var(--ea-icon-scale, 1)); aspect-ratio: 1; }`
    becomes `.ea-badges .ea-icon { height: calc(min(34px, 0.6 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); aspect-ratio: 1; }`
  - `.ea-badges .ea-system { height: 48%; }` becomes
    `.ea-badges .ea-system { height: calc(min(34px, 0.48 * var(--ea-inner-h, 56px)) * var(--ea-icon-scale, 1)); }`
- Exit animation. After the four `.ea-anim-*` rules, add:
```css
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
```
  and **delete** the four original one-line `.ea-anim-*` rules, so each
  animation is defined in one place.
  > Chromium does not accept `var()` inside `animation-name` lists in every
  > version. If the live check (section 8, P3) shows no entrance animation,
  > replace the block above with four explicit rules, e.g.
  > `.ea-banner.ea-anim-fade { animation: ea-anim-fade 400ms cubic-bezier(0.16, 1, 0.3, 1) both, ea-exit 300ms ease-in calc(var(--toast-duration, 5000ms) + 300ms) forwards; }`.
  > Do this once; do not iterate.

Run: `npm run check && npm test && npm run build`. Expected: exit 0,
`ℹ pass 41` / `ℹ fail 0`, and the build line `build Succeeded passing all tests`.

### Phase 4: docs

- `themes.md`:
  - § `banner.scale`: "Size of the banner **box** relative to the base size.
    Text and icons keep their own sizes (`text.*` size %, icon `scale_pct`)."
  - § `margin`: "`[vertical_px, horizontal_px]` or one number: distance from the
    anchor corner. With `top_right` and `5`, the banner sits 5 px left of the right
    edge and 5 px below the top. The horizontal margin is ignored for `*_center`."
  - Add a Known limitations note: Big Picture uses Steam's own 300×80 frame and
    placement, so `scale` and `position` do not apply there.
- `enhanced-achievements/CHANGELOG.md` `[Unreleased]` → `### Fixed`: the five
  issues, one line each, plus `### Changed`: snake_case positions and
  `text_align`, with the legacy spellings deprecated.
- `docs/steam-components.md` § Resolution signatures & toast windows, add a row
  "Desktop toast stack" with the section 2.1 facts: the rAF loop, `W=300`,
  `U=300`, `H=283`, `MoveTo(x, y, m_flDPI)` in `screen.avail` CSS px,
  moves only when its cached `m_nLastX/Y` changes, and the per-popup
  `SteamClient.Window.MoveTo` is own and writable. Add the
  `SetNotificationPosition` finding from section 2.3 as "do not use: global, not persistent".

Run: `npm run check && npm test`. Expected: unchanged (41/41).

---

## 6. Do not touch

- `frontend/steam/toast-patch.ts`, `frontend/steam/jsx-hook.ts` (dispatcher
  swap and the shared jsx chain).
- `frontend/capture/**`, `frontend/steam/recording.ts` (captures).
- The sound path in `frontend/steam/notifications.ts` (`installSoundHook`
  apart from the one deleted `applyPosition();` line, `ChooseSound`, `playClip`).
- `applyDuration` and `toastDurationMS` handling.
- The user's theme files under `<steam>/millennium/config/enhanced-achievements/themes/`.
  They load with a deprecation warning. The **user** updates them (section 9).

## 7. Banned actions

No deploy or Steam restart (`dev.ps1`); the user deploys. No SharedJSContext
reload. No probe or throwaway plugins. No edits to Millennium's `config.json`,
the plugin config, or the user's theme files. No `npm install` or upgrade
(ignore the `@steambrew/ttc` update nag). No `git push --force`, no `--no-verify`.
Never call `SetNotificationPosition` or change any Steam setting.

**Failure rule:** run a failing command at most twice. On the second failure,
stop. Append the command, its output (at most 30 lines) and the step number to
`TASK.md` § Active Failures & Blockers, then exit.

## 8. Guardrail checklist (plugins.md)

| Guardrail | Proof it is not violated |
| --- | --- |
| 2. O(1) in hot methods | The pinned `MoveTo` is one closure call per Steam frame, only on our own popup. No `jsx` hook work is added. |
| 3. Single-pass webpack pre-caching | No new module scans: `getActiveWindowInstance`'s `findExports` is **removed**. |
| 12. Popup hooks do not see every window | No popup hook. The window is reached from our own rendered element (`ownerDocument.defaultView`). |
| 14. A new gate must never remove working behaviour | Big Picture and unknown windows fall through to Steam's placement (`pinToastWindow` returns null). |
| Rules on every rung: graceful fallback | Any throw restores `MoveTo`, frees the slot and leaves Steam in charge. The banner still renders. |

## 9. Commit

```
git add enhanced-achievements/frontend enhanced-achievements/tests/theme.test.ts enhanced-achievements/tests/geometry.test.ts enhanced-achievements/themes enhanced-achievements/examples enhanced-achievements/themes.md enhanced-achievements/CHANGELOG.md docs/steam-components.md
git commit -m "fix(enhanced-achievements): pin toast window per popup, scale sizes box only, snake_case positions" -m "Co-Authored-By: <attribution line from the session>"
```

## 10. Live verification (user or verifier, after `dev.ps1` deploy)

**P1, automated placement probe.** Add `tests/placement.mjs`, adapted from
the session probe (section 2.1): it wraps `MoveTo`/`ResizeTo` on new
`notificationtoasts_*_desktop` popups via
`g_PopupManager.AddPopupCreatedCallback`, fires `TestAchievement(480)` **5 times**
(waiting for `HideWindow` between runs), then removes its callback from
`g_PopupManager.m_rgPopupCreatedCallbacks`. For each run it prints
`PASS placement run <n>` when:

- every `MoveTo` that reaches Steam has the same `(x, y)`, equal to
  `placeBanner(theme.position, margin, size, screen.avail)`;
- its third argument is a number equal to `devicePixelRatio`;
- `ResizeTo` was called once, with `(width, height, true)`;
- no `MoveTo` carries Steam's own coordinates (`x = availWidth − 283`).

Expected: `5 PASS / 0 FAIL`.

**P2, content size.** In the toast window, the computed `.ea-title` font size
is `14 × title% / 100` px (16.8 px for 120 %). It must be the same with the
theme's `scale` at `[100, 100]` and at `[200, 200]`.

**P3, manual (user).** Edit your user theme (`position` and `margin`),
click Preview in the plugin panel for 10 toasts per setting, and watch for any
jump:

| Setting | Expected |
| --- | --- |
| `top_right`, margin 5 | 5 px from the top-right corner, from the first frame to the fade-out. No jump. |
| `bottom_right`, margin 5, `scale [150,150]` | Fully on screen, grows up and left from the corner, content the same size as at 100 |
| `bottom_left`, `top_center`, `bottom_center` | Correct anchor. `*_center` is horizontally centred |
| Two previews less than 1 s apart | The second banner stacks below (`top_*`) or above (`bottom_*`) the first. No overlap. |
| Theme still says `"topright"` | Works, and the Millennium log shows the deprecation warning |
| Friends/download toast afterwards | Still in **Steam's** own corner (nothing global changed) |

Then run the standing Routines 3 checks: `node scratch/test_nav_cycle.js`,
`node scratch/check_all_tabs.js`, and EA `tests/smoke.mjs`, `tests/tiers.mjs`.
All PASS.

---

## 11. Open questions (defaults applied unless the user says otherwise)

1. **Legacy spellings** (`"topright"`, `"text-align"`): accepted with a
   deprecation warning (default), or rejected outright?
2. **Horizontal margin on `*_center`**: ignored (default), or used as a
   sideways offset?
3. **Window slide:** Steam's slide-in/out of the window is replaced by the
   theme's own entrance animation plus a 300 ms fade-out (default). OK?

**Dry-run (2026-09-25, commit `a77bab9`):**
- **Phases 1–2: done** on a scratch copy, with the plan's fenced blocks applied verbatim.
  Every before block matched. `npm test` (unit files) gave `ℹ tests 41` / `ℹ pass 41` / `ℹ fail 0`.
- **Phase 3: not dry-run** (it needs `tsc` with `node_modules` and a live
  toast). Its before snippets were copied from the files at `a77bab9`. Its
  runtime behaviour is covered only by section 10 (P1–P3).
