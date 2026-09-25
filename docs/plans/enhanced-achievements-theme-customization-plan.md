# Enhanced Achievements: Theme Customization & PS5 Layout Engine Plan

> **Specification & Step-by-Step Implementation Plan:**
> Extends `enhanced-achievements` with semantic `banner` styling, outline glow with pulsing fade, blurry water ripple, icon scaling, geometry controls (`margin`, `padding`, `gap`), the authentic PS5 trophy layout, a flexbox-style anchor layout engine, and strict decoupling of capture settings from themes into plugin settings.
>
> Follows the plan writing standard in [docs/plans/README.md](README.md).

---

## 1. Context & Feature Objectives

Through user feedback, real-world PS5 trophy asset analysis (`media_1790304005869.png`), and theme experimentation, several areas of the `enhanced-achievements` theme architecture require significant enhancements:

1. **Semantic Rename (`box` ➔ `banner`):** Renaming the `"box"` configuration block to `"banner"`, maintaining backward-compatibility for legacy themes.
2. **Banner Scaling (`scale: [width_pct, height_pct]`):** Controlling horizontal and vertical banner dimensions relative to base size (`100` = 100%).
3. **Outline Glow & Pulsing Fade:** Moving from an internal inset shadow to an authentic exterior outline glow (`box-shadow: 0 0 <spread> <color>`) with a smooth breathing/pulsing animation that fades in and out.
4. **Authentic PS5 Blurry Water Ripple:** Upgrading the icon ripple effect from a solid CSS border circle to a soft, radial-gradient blurred ring that expands and dissipates like a water ripple.
5. **Icon Scaling (`scale_pct`):** Adding scaling support to icons: `[source, scale_pct, ripple_speed_ms]` (e.g. `["C:/auto/res/trophies/Steam_icon_logo-white.png", 50, 2000]`), allowing icons to be reduced or enlarged.
6. **Geometry Controls (`margin`, `padding`, `gap`):**
   - `margin`: Screen offset pushing the banner away from its fixed anchor point (e.g. `10` or `[vert_px, horiz_px]`).
   - `padding`: Inward breathing room for the banner content (`[vert_px, horiz_px]`).
   - `gap`: Space between layout zones, columns, and text rows (`[col_gap_px, row_gap_px]`).
7. **PS5 Trophy Layout & Custom Anchor Layout Engine:**
   - **Preset `"ps5"`:**
     - **Left Anchor:** Game achievement icon.
     - **Central Content:**
       - **Row 1:** Rarity trophy icon (anchored left of the title, matched to title line-height) + Trophy Title.
       - **Row 2:** Trophy description below title.
     - **Right Anchor:** Platform / system circular icon (e.g. PlayStation icon).
   - **Custom Anchor Mapping (`"layout": "custom"`):** Declarative placement of items (`achievement`, `system`, `rarity`, `exceptional`, `text`) to fixed zones (`left`, `right`, `center`) or relative sub-element anchors (`title_left`, `title_right`, `desc_left`, `desc_right`), where anchored elements inherit the reference element's size.
8. **Theme & Capture Separation:** Theme files specify purely visual and sound presentation. Auto-capture options (`screenshot`, `recording`) are completely removed from themes and reside strictly in plugin settings (`settings.json`).

---

## 2. Preconditions

Before beginning implementation, verify the repository state:

```powershell
cd c:\game\millennium\enhanced-achievements
npm run check
```
Expected output: Exits 0 with no TypeScript errors.

```powershell
npm test
```
Expected output: Pure logic tests run.

---

## 3. Ordered Implementation Steps

### Step 1: Update Theme Types and Schema Normalizer in `frontend/theme/theme.ts`

**Target File:** `c:\game\millennium\enhanced-achievements\frontend\theme\theme.ts`  
**Goal:** Add `'ps5'` and `'custom'` layout variants, define anchor positioning types, rename `box` to `banner` with backward compatibility, parse `scale: [x, y]`, `margin`, `padding`, `gap`, support 3-tuple icon slots `[source, scalePct, rippleMs]`, and remove `screenshot`/`recording` capture overrides from theme tiers.

#### Before Block (around line 14):
```typescript
export const LAYOUTS = ['default_steam', 'default_system_right', 'compact_pill'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const ANIMATIONS = ['slide', 'fade', 'up', 'down'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export type FontStyle = 'bold' | 'regular' | 'italic';

/** `true` = Steam's own asset, `false` = hidden, string = custom asset path. */
export type IconSource = boolean | string;

export interface IconSlot {
    source: IconSource;
    rippleMs: number;
}

export interface TextStyle {
    color: string;
    sizePct: number;
    style: FontStyle;
}

export interface SoundSpec {
    path: string;
    volumePct: number;
}

export interface CaptureOverrides {
    screenshot?: Record<string, unknown>;
    recording?: Record<string, unknown>;
}

/** One fully resolved tier: every field present, inheritance already applied. */
export interface ResolvedTier extends CaptureOverrides {
    tier: Tier;
    threshold: number | null;
    box: {
        scale: [number, number];
        background: string[];
        gradientAngle: number;
        border: { width: number; color: string; radius: number };
        glow: { color: string; spread: number; pulseMs: number };
    };
    text: { title: TextStyle; desc: TextStyle };
    icons: { achievement: IconSlot; system: IconSlot; rarity: IconSlot; exceptional: IconSlot };
    /** `null` keeps Steam's own chime. */
    sound: SoundSpec | null;
}

export interface ResolvedTheme {
    layout: Layout;
    animation: Animation;
    /** `null` keeps Steam's own toast duration. */
    displayTimeMs: number | null;
    tiers: Record<Tier, ResolvedTier>;
    /** Every custom asset path the theme references, for the backend to load. */
    assetPaths: string[];
    warnings: string[];
}
```

#### After Block:
```typescript
export const LAYOUTS = ['default_steam', 'default_system_right', 'compact_pill', 'ps5', 'custom'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const ANIMATIONS = ['slide', 'fade', 'up', 'down'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export type FontStyle = 'bold' | 'regular' | 'italic';

/** `true` = Steam's own asset, `false` = hidden, string = custom asset path. */
export type IconSource = boolean | string;

export interface IconSlot {
    source: IconSource;
    scalePct: number;
    rippleMs: number;
}

export interface TextStyle {
    color: string;
    sizePct: number;
    style: FontStyle;
}

export interface SoundSpec {
    path: string;
    volumePct: number;
}

export type AnchorPosition =
    | 'left'
    | 'right'
    | 'center'
    | 'title_left'
    | 'title_right'
    | 'desc_left'
    | 'desc_right';

export interface CustomLayoutMap {
    achievement?: AnchorPosition;
    system?: AnchorPosition;
    rarity?: AnchorPosition;
    exceptional?: AnchorPosition;
    text?: AnchorPosition;
}

export interface BannerStyle {
    scale: [number, number];
    background: string[];
    gradientAngle: number;
    border: { width: number; color: string; radius: number };
    glow: { color: string; spread: number; pulseMs: number };
    margin: [number, number];
    padding: [number, number];
    gap: [number, number];
}

/** One fully resolved tier: every field present, inheritance already applied. */
export interface ResolvedTier {
    tier: Tier;
    threshold: number | null;
    banner: BannerStyle;
    /** Backward compatibility alias for banner. */
    box: BannerStyle;
    text: { title: TextStyle; desc: TextStyle };
    icons: { achievement: IconSlot; system: IconSlot; rarity: IconSlot; exceptional: IconSlot };
    /** `null` keeps Steam's own chime. */
    sound: SoundSpec | null;
}

export interface ResolvedTheme {
    layout: Layout;
    customLayout?: CustomLayoutMap;
    animation: Animation;
    /** `null` keeps Steam's own toast duration. */
    displayTimeMs: number | null;
    tiers: Record<Tier, ResolvedTier>;
    /** Every custom asset path the theme references, for the backend to load. */
    assetPaths: string[];
    warnings: string[];
}
```

#### Helper and Resolution Normalization Updates:

Update `iconSlot` helper:
```typescript
/** `[source, scale, ripple]` or `[source, ripple]` or bare `source`. */
function iconSlot(raw: unknown, fallback: IconSlot): IconSlot {
    if (raw === undefined) return fallback;
    if (typeof raw === 'boolean' || typeof raw === 'string') {
        return { source: raw || fallback.source, scalePct: fallback.scalePct, rippleMs: fallback.rippleMs };
    }
    if (Array.isArray(raw)) {
        const src = typeof raw[0] === 'boolean' || (typeof raw[0] === 'string' && raw[0].length > 0) ? raw[0] : fallback.source;
        if (raw.length >= 3) {
            return {
                source: src,
                scalePct: num(raw[1], 10, 300) ?? 100,
                rippleMs: num(raw[2], 0, 60_000) ?? 0,
            };
        }
        if (raw.length === 2) {
            const second = typeof raw[1] === 'number' ? raw[1] : 0;
            // If second value is <= 100 and > 0, interpret as scalePct unless it is 0 (disable ripple).
            // A value > 100 is rippleMs duration.
            if (second > 100) {
                return { source: src, scalePct: 100, rippleMs: second };
            }
            if (second === 0) {
                return { source: src, scalePct: 100, rippleMs: 0 };
            }
            return { source: src, scalePct: num(second, 10, 300) ?? 100, rippleMs: 0 };
        }
        return { source: src, scalePct: 100, rippleMs: 0 };
    }
    return fallback;
}
```

Update `parsePair` helper for geometry (`scale`, `margin`, `padding`, `gap`):
```typescript
function pair(raw: unknown, fallback: [number, number], min: number, max: number): [number, number] {
    if (typeof raw === 'number') {
        const v = num(raw, min, max) ?? fallback[0];
        return [v, v];
    }
    if (Array.isArray(raw)) {
        return [
            num(raw[0], min, max) ?? fallback[0],
            num(raw[1], min, max) ?? fallback[1],
        ];
    }
    return fallback;
}
```

Update `resolveTier` to extract `banner`:
```typescript
function resolveTier(tier: Tier, raw: Json, warnings: string[]): ResolvedTier {
    const d = DEFAULT_TIER;
    const bannerRaw = isObject(raw.banner) ? raw.banner : isObject(raw.box) ? raw.box : {};
    const text = isObject(raw.text) ? raw.text : {};
    const icons = isObject(raw.icons) ? raw.icons : {};

    const scale = pair(bannerRaw.scale, [100, 100], 25, 400);
    const margin = pair(bannerRaw.margin, [0, 0], -100, 200);
    const padding = pair(bannerRaw.padding, [6, 10], 0, 100);
    const gap = pair(bannerRaw.gap, [10, 2], 0, 100);

    const border = Array.isArray(bannerRaw.border) ? bannerRaw.border : [];
    const glow = Array.isArray(bannerRaw.glow) ? bannerRaw.glow : [];
    const background = Array.isArray(bannerRaw.background_color)
        ? bannerRaw.background_color.map(color).filter((c): c is string => !!c)
        : [];

    let sound: SoundSpec | null = null;
    if (Array.isArray(raw.sound) && typeof raw.sound[0] === 'string' && raw.sound[0]) {
        sound = { path: raw.sound[0], volumePct: num(raw.sound[1], 0, 100) ?? 100 };
    } else if (raw.sound !== undefined) {
        warnings.push(`${tier}.sound is not ["path", volume]; using Steam's chime.`);
    }

    const resolvedBanner: BannerStyle = {
        scale,
        margin,
        padding,
        gap,
        background: background.length ? background : d.banner.background,
        gradientAngle: num(bannerRaw.gradient_angle, -360, 360) ?? d.banner.gradientAngle,
        border: {
            width: num(border[0], 0, 20) ?? d.banner.border.width,
            color: color(border[1]) ?? d.banner.border.color,
            radius: num(border[2], 0, 100) ?? d.banner.border.radius,
        },
        glow: {
            color: color(glow[0]) ?? d.banner.glow.color,
            spread: num(glow[1], 0, 200) ?? d.banner.glow.spread,
            pulseMs: num(glow[2], 0, 60_000) ?? d.banner.glow.pulseMs,
        },
    };

    return {
        tier,
        threshold: tier === 'magic' || tier === 'rare' ? (num(raw.threshold, 0, 100) ?? null) : null,
        banner: resolvedBanner,
        box: resolvedBanner,
        text: {
            title: textStyle(text.title, d.text.title),
            desc: textStyle(text.desc, d.text.desc),
        },
        icons: {
            achievement: iconSlot(icons.achievement, d.icons.achievement),
            system: iconSlot(icons.system, d.icons.system),
            rarity: iconSlot(icons.rarity, d.icons.rarity),
            exceptional: iconSlot(icons.exceptional, d.icons.exceptional),
        },
        sound,
    };
}
```

Update `resolveTheme` to parse layout mapping:
```typescript
    let layout = oneOf(settings.layout, LAYOUTS);
    if (settings.layout !== undefined && !layout) {
        warnings.push(`settings.layout "${String(settings.layout)}" is not supported; using default_steam.`);
        layout = 'default_steam';
    }

    let customLayout: CustomLayoutMap | undefined = undefined;
    if (layout === 'custom' || isObject(raw.layout)) {
        const rawMap = isObject(raw.layout) ? raw.layout : {};
        const validAnchors: readonly AnchorPosition[] = ['left', 'right', 'center', 'title_left', 'title_right', 'desc_left', 'desc_right'];
        customLayout = {
            achievement: oneOf(rawMap.achievement, validAnchors) ?? 'left',
            system: oneOf(rawMap.system, validAnchors) ?? 'right',
            rarity: oneOf(rawMap.rarity, validAnchors) ?? 'title_left',
            exceptional: oneOf(rawMap.exceptional, validAnchors) ?? 'title_left',
            text: oneOf(rawMap.text, validAnchors) ?? 'center',
        };
    }
```

**Verification Command:**
```powershell
npm run check
```
*Expected Output:* Exits 0 without TypeScript compilation errors.

---

### Step 2: Implement PS5 Layout, Outline Glow, Water Ripple, and Flexbox CSS in `frontend/banner/styles.ts`

**Target File:** `c:\game\millennium\enhanced-achievements\frontend\banner\styles.ts`  
**Goal:** Rewrite CSS to support exterior outline glow with pulsing fade, blurry water ripple, geometry variables (`--ea-margin-y`, `--ea-pad-y`, `--ea-gap-x`), and 3-zone flexbox layout (`.ea-zone-left`, `.ea-zone-center`, `.ea-zone-right`, `.ea-row-title`, `.ea-row-desc`, `.ea-anchored-icon`).

#### Content for `BANNER_CSS`:
```typescript
export const BANNER_CSS = `
.ea-banner {
    position: absolute;
    inset: var(--ea-margin-y, 0px) var(--ea-margin-x, 0px);
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--ea-gap-x, 10px);
    padding: var(--ea-pad-y, 6px) var(--ea-pad-x, 10px);
    box-sizing: border-box;
    overflow: hidden;
    font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    cursor: pointer;
    user-select: none;
    container-type: size;
    transform-origin: top right;
    transform: scale(var(--ea-scale-x, 1), var(--ea-scale-y, 1));
}

/* Exterior outline glow */
.ea-banner.ea-glow {
    box-shadow: 0 0 var(--ea-glow-spread) var(--ea-glow);
}
.ea-banner.ea-pulse {
    animation: ea-enter 300ms ease-out both, ea-pulse var(--ea-glow-pulse) ease-in-out infinite alternate;
}

.ea-banner.ea-layout-compact_pill {
    border-radius: 999px !important;
    padding: 4px 16px 4px 4px;
}

/* Entrance Animations */
.ea-anim-slide { animation: ea-enter 300ms ease-out both; --ea-from: translateX(100%); }
.ea-anim-fade  { animation: ea-enter 300ms ease-out both; --ea-from: none; }
.ea-anim-up    { animation: ea-enter 300ms ease-out both; --ea-from: translateY(100%); }
.ea-anim-down  { animation: ea-enter 300ms ease-out both; --ea-from: translateY(-100%); }

@keyframes ea-enter {
    from { opacity: 0; transform: var(--ea-from) scale(var(--ea-scale-x, 1), var(--ea-scale-y, 1)); }
    to { opacity: 1; transform: none scale(var(--ea-scale-x, 1), var(--ea-scale-y, 1)); }
}

/* Pulsing outline glow fade */
@keyframes ea-pulse {
    0%, 100% {
        box-shadow: 0 0 calc(var(--ea-glow-spread) * 0.4) var(--ea-glow);
        opacity: 0.9;
    }
    50% {
        box-shadow: 0 0 var(--ea-glow-spread) var(--ea-glow);
        opacity: 1;
    }
}

/* Base Icon and Scaling */
.ea-icon {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.ea-icon img, .ea-icon svg {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

/* PS5-Style Blurry Water Ripple */
.ea-ripple {
    position: absolute;
    inset: -35%;
    border-radius: 50%;
    background: radial-gradient(circle, transparent 40%, rgba(255, 255, 255, 0.4) 55%, rgba(255, 255, 255, 0.8) 70%, transparent 80%);
    filter: blur(4px);
    pointer-events: none;
    animation: ea-ripple var(--ea-ripple) cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
}
@keyframes ea-ripple {
    0% { transform: scale(0.6); opacity: 1; }
    70% { opacity: 0.6; }
    100% { transform: scale(1.8); opacity: 0; }
}

/* 3-Zone Flexbox Architecture */
.ea-zone-left {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
}
.ea-zone-left .ea-icon {
    height: 100%;
    max-height: calc(56px * var(--ea-icon-scale, 1));
    aspect-ratio: 1;
}
.ea-zone-left img {
    border-radius: 4px;
}

.ea-zone-center {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--ea-gap-y, 2px);
    line-height: 1.2;
}

.ea-row-title, .ea-row-desc {
    display: flex;
    align-items: center;
    gap: var(--ea-gap-x, 6px);
    min-width: 0;
}

.ea-anchored-icon {
    height: 1.15em;
    width: 1.15em;
    aspect-ratio: 1;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.ea-title, .ea-desc {
    overflow: hidden;
    text-overflow: ellipsis;
}
.ea-title {
    white-space: nowrap;
    font-size: min(var(--ea-title-size), 24cqh);
}
.ea-desc {
    font-size: min(var(--ea-desc-size), 18cqh);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}

.ea-zone-right {
    flex: none;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--ea-gap-x, 6px);
    height: 100%;
}
.ea-zone-right .ea-icon {
    height: 60%;
    max-height: calc(34px * var(--ea-icon-scale, 1));
    aspect-ratio: 1;
}
.ea-zone-right .ea-system {
    height: 48%;
}
.ea-zone-right .ea-system svg {
    fill: currentColor;
    color: #ffffff;
}
`;
```

**Verification Command:**
```powershell
npm run check
```
*Expected Output:* Exits 0 without TypeScript compilation errors.

---

### Step 3: Implement 3-Zone Flexbox & Sub-element Anchor Rendering in `frontend/banner/themed-toast.tsx`

**Target File:** `c:\game\millennium\enhanced-achievements\frontend\banner\themed-toast.tsx`  
**Goal:** Render the 3-zone flexbox structure. Map icons (`achievement`, `system`, `rarity`, `exceptional`) into their resolved slots:
- For layout `"ps5"`:
  - Left Zone: `achievement` icon (game capture icon).
  - Center Zone:
    - Title Row: `rarity` icon (anchored left of title) + `title` text.
    - Desc Row: `desc` text.
  - Right Zone: `system` icon (PlayStation or platform icon).
- For custom layout (`layout: "custom"`): Evaluate the configured `CustomLayoutMap`.
- For classic layouts: Maintain existing layout behavior seamlessly.

#### Detailed Code Changes:
Replace lines 61-69 (the `Icon` helper) with scale-aware rendering:
```tsx
function Icon({
    url,
    scalePct = 100,
    rippleMs = 0,
    className,
    fallback,
    style,
}: {
    url: string | null;
    scalePct?: number;
    rippleMs?: number;
    className: string;
    fallback?: ReactNode;
    style?: React.CSSProperties;
}) {
    if (!url && !fallback) return null;
    const combinedStyle = {
        '--ea-icon-scale': String(scalePct / 100),
        '--ea-ripple': rippleMs > 0 ? `${rippleMs}ms` : undefined,
        ...style,
    } as React.CSSProperties;

    return (
        <div className={`ea-icon ${className}`} style={combinedStyle}>
            {rippleMs > 0 && <span className="ea-ripple" />}
            {url ? <img src={url} alt="" draggable={false} /> : fallback}
        </div>
    );
}
```

In `Banner({ toast })`:
- Compute all `--ea-*` CSS custom properties from `banner`:
  ```tsx
  const scaleX = banner.scale[0] / 100;
  const scaleY = banner.scale[1] / 100;
  const rootStyle = {
      '--ea-scale-x': String(scaleX),
      '--ea-scale-y': String(scaleY),
      '--ea-margin-y': `${banner.margin[0]}px`,
      '--ea-margin-x': `${banner.margin[1]}px`,
      '--ea-pad-y': `${banner.padding[0]}px`,
      '--ea-pad-x': `${banner.padding[1]}px`,
      '--ea-gap-x': `${banner.gap[0]}px`,
      '--ea-gap-y': `${banner.gap[1]}px`,
      '--ea-glow': banner.glow.color,
      '--ea-glow-spread': `${banner.glow.spread}px`,
      '--ea-glow-pulse': `${banner.glow.pulseMs}ms`,
      background,
      border: banner.border.width > 0 ? `${banner.border.width}px solid ${banner.border.color}` : 'none',
      borderRadius: `${banner.border.radius}px`,
  } as React.CSSProperties;
  ```
- Render the 3-zone layout according to `theme.layout`:
  - PS5 Layout:
    ```tsx
    <div className="ea-zone-left">
        <Icon
            url={iconUrl(icons.achievement, data.image_url() || null, assets)}
            scalePct={icons.achievement.scalePct}
            rippleMs={icons.achievement.rippleMs}
            className="ea-achievement"
        />
    </div>
    <div className="ea-zone-center">
        <div className="ea-row-title">
            <Icon
                url={iconUrl(icons.rarity, null, assets)}
                scalePct={icons.rarity.scalePct}
                rippleMs={icons.rarity.rippleMs}
                className="ea-anchored-icon ea-rarity"
            />
            {tier.tier === 'exceptional' && (
                <Icon
                    url={iconUrl(icons.exceptional, null, assets)}
                    scalePct={icons.exceptional.scalePct}
                    rippleMs={icons.exceptional.rippleMs}
                    className="ea-anchored-icon ea-exceptional"
                />
            )}
            <div className="ea-title" style={titleStyle}>{data.name()}</div>
        </div>
        <div className="ea-row-desc">
            <div className="ea-desc" style={descStyle}>{data.description()}</div>
        </div>
    </div>
    <div className="ea-zone-right">
        <Icon
            url={iconUrl(icons.system, null, assets)}
            scalePct={icons.system.scalePct}
            rippleMs={icons.system.rippleMs}
            className="ea-system"
            fallback={icons.system.source === true && SteamLogo ? <SteamLogo /> : undefined}
        />
    </div>
    ```

**Verification Command:**
```powershell
npm run check
```
*Expected Output:* Exits 0 without TypeScript compilation errors.

---

### Step 4: Decouple Captures from Themes in `frontend/capture/captures.ts` and `frontend/capture/plan.ts`

**Target Files:**
- `c:\game\millennium\enhanced-achievements\frontend\capture\captures.ts`
- `c:\game\millennium\enhanced-achievements\frontend\capture\plan.ts`

**Goal:** Decouple capture scheduling from theme overrides. Capture settings (`screenshot`, `recording`) are read directly from plugin configuration (`baseSettings()`), keeping themes purely focused on visual and audio styling.

In `frontend/capture/captures.ts`:
#### Before Block (around line 140):
```typescript
        const { settings, warnings } = resolveCaptureSettings(baseSettings(), activeTheme()?.theme.tiers[tier]);
        for (const w of warnings) logger.warn(`Capture override for tier "${tier}": ${w}`);

        const appid = n.data.appid();
        const nowMs = Date.now();
        const candidates = gameIdCandidates(appid);
        const { snap, reason } = snapshotTimeline(candidates);

        const timelineSnap: TimelineSnapshot | null = snap;
        const plan = planCaptures(
            settings,
            { appid, name: n.data.name(), description: n.data.description(), nowMs, rtCreatedS: n.rtCreated },
            timelineSnap,
        );
```

#### After Block:
```typescript
        const settings = baseSettings();
        const appid = n.data.appid();
        const nowMs = Date.now();
        const candidates = gameIdCandidates(appid);
        const { snap, reason } = snapshotTimeline(candidates);

        const timelineSnap: TimelineSnapshot | null = snap;
        const plan = planCaptures(
            settings,
            { appid, name: n.data.name(), description: n.data.description(), nowMs, rtCreatedS: n.rtCreated },
            timelineSnap,
        );
```

**Verification Command:**
```powershell
npm run check
```
*Expected Output:* Exits 0 without TypeScript compilation errors.

---

### Step 5: Update Bundled and Example Theme Files

**Target Files:**
- `enhanced-achievements/themes/ps5_example.json`
- `enhanced-achievements/examples/steam_ps_exemple.json`
- `enhanced-achievements/themes/steam_tiers.json`

**Goal:** Convert `"box"` to `"banner"`, remove `screenshot` and `recording` blocks from themes, add `scale`, `margin`, `padding`, `gap`, and set layout to `"ps5"` or custom anchors.

#### Content for `enhanced-achievements/themes/ps5_example.json`:
```json
{
    "settings": {
        "layout": "ps5",
        "position": "topright",
        "display_time_ms": 4000,
        "animation": "fade"
    },
    "layout": {
        "achievement": "left",
        "system": "right",
        "text": "center",
        "rarity": "title_left"
    },
    "themes": {
        "normal": {
            "banner": {
                "scale": [100, 100],
                "background_color": ["#1F1F1F", "#0F0F0F"],
                "gradient_angle": 90,
                "border": [0, "#8a2be2", 15],
                "glow": ["#363636", 0, 0],
                "margin": [5, 5],
                "padding": [6, 12],
                "gap": [10, 2]
            },
            "text": {
                "title": ["#ffffff", 120, "bold"],
                "desc": ["#ffffff", 100, "regular"]
            },
            "icons": {
                "achievement": [true, 100, 0],
                "system": ["assets/trophy_bronze.svg", 60, 2000],
                "rarity": ["assets/trophy_bronze.svg", 100, 0]
            },
            "sound": null
        },
        "magic": {
            "threshold": 25.0,
            "banner": {
                "glow": ["#505050", 60, 1500]
            },
            "icons": {
                "rarity": ["assets/trophy_silver.svg", 100, 0]
            }
        },
        "rare": {
            "threshold": 10.0,
            "banner": {
                "glow": ["#e5a93c", 80, 1200]
            },
            "icons": {
                "rarity": ["assets/trophy_gold.svg", 100, 0]
            }
        },
        "exceptional": {
            "banner": {
                "glow": ["#40c4ff", 90, 800]
            },
            "icons": {
                "rarity": ["assets/trophy_platinum.svg", 100, 0],
                "exceptional": ["assets/trophy_platinum.svg", 100, 0]
            }
        }
    }
}
```

---

### Step 6: Update Theme Specification Documentation in `enhanced-achievements/themes.md`

**Target File:** `c:\game\millennium\enhanced-achievements\themes.md`  
**Goal:** Document the new schema features:
- `banner` replacing `box`.
- Geometry options (`margin`, `padding`, `gap`).
- Outline glow with breathing pulse.
- Blurry water ripple.
- Icon scaling (`[source, scale_pct, ripple_speed_ms]`).
- PS5 layout preset and custom anchor layout mappings.
- Clean separation notice indicating that auto-captures and recordings live in plugin `settings.json`.

---

### Step 7: Update Tests in `tests/theme.test.ts`

**Target File:** `c:\game\millennium\enhanced-achievements\tests\theme.test.ts`  
**Goal:** Add test coverage for:
- `banner` resolution and backward-compatibility with `box`.
- `margin`, `padding`, `gap` parsing (scalars and pairs).
- Icon 3-tuple `[source, scalePct, rippleMs]`.
- PS5 layout and custom layout anchor resolution.
- Verify all bundled and example themes pass without errors.

**Verification Command:**
```powershell
npm test
```
*Expected Output:*
```
ℹ tests 27+
ℹ suites 0
ℹ pass 27+
ℹ fail 0
```

---

## 4. Do-Not-Touch List

- **Backend Lua:** `backend/main.lua` and `backend/_lib/*` must remain untouched.
- **Hook Signatures:** `steam/notifications.ts`, `steam/toast-patch.ts`, and `steam/jsx-hook.ts` must maintain their $O(1)$ signature and error boundaries.
- **Recording Service RPCs:** `steam/recording.ts` remains unchanged.
- **Other Plugins:** `steam-cartridges/` and `enhanced-notifications/` must not be modified.

---

## 5. Banned Actions

- **NO** live Steam restart or deploy (`dev.ps1`) during plan writing.
- **NO** reloading `SharedJSContext` via DevTools (`Ctrl+R` / `location.reload()`).
- **NO** `--no-verify` or `git push --force`.
- **NO** changes to Steam's core files or shortcuts.

---

## 6. Failure Rule

If any test or type check fails during execution:
1. Re-read the failure output carefully.
2. Attempt a fix at most twice.
3. If still failing on the second attempt, stop, document the command and failure log in `TASK.md` § Active Failures & Blockers, and seek user confirmation.

---

## 7. Guardrail Checklist

- [ ] **Guardrail 1 (Build nothing Steam already builds):** We theme Steam's achievement toast through our lightweight JSX overlay, preserving Steam's dismissal and queue.
- [ ] **Guardrail 2 (No hardcoded Steam CSS classes):** All styling is strictly scoped under `.ea-banner` and `.ea-*`.
- [ ] **Guardrail 3 (Hook signatures O(1)):** All layout and geometry parsing happens at theme load time; toast rendering is $O(1)$.
- [ ] **Guardrail 4 (Big Picture & Desktop parity):** The flexbox structure renders cleanly in both Desktop toast popups and Big Picture overlay frames.
- [ ] **Guardrail 5 (Zero external network dependencies):** All styling, animations, and assets are 100% local.
- [ ] **Guardrail 6 (Graceful fallback):** Any rendering failure triggers the React `Fallback` error boundary, displaying Steam's native toast.

---

## 8. Commit Instructions

```bash
git add docs/plans/enhanced-achievements-theme-customization-plan.md
git commit -m "docs(plans): author enhanced-achievements theme customization and PS5 layout plan"
```
