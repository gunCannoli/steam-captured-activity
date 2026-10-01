/**
 * Theme schema, normalisation, inheritance and tier selection.
 *
 * Pure logic, no Steam or SDK imports, so tests/theme.test.ts runs it under
 * plain Node. The schema is documented for users in themes.md; keep the two in step.
 *
 * Everything here runs once per theme load. At toast time the hooks only pick
 * one of four pre-resolved tiers (docs/plugins.md guardrails).
 */

import { COMPLETION_ID, PREVIEW_ID_PREFIX } from '../kernel/notification.ts';

export const TIERS = ['normal', 'magic', 'rare', 'exceptional'] as const;
export type Tier = (typeof TIERS)[number];

export const POSITIONS = ['top_right', 'top_left', 'bottom_right', 'bottom_left', 'top_center', 'bottom_center'] as const;
export type ToastPosition = (typeof POSITIONS)[number];

export const LAYOUTS = ['default_steam', 'default_system_right', 'compact_pill', 'ps5', 'custom'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const ANIMATIONS = ['slide', 'fade', 'up', 'down', 'ps5', 'none'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export interface AnimationPair {
    in: Animation;
    out: Animation;
}

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
    | 'desc_right'
    | 'achievement_left'
    | 'achievement_right';

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export interface CustomLayoutMap {
    achievement?: AnchorPosition;
    system?: AnchorPosition;
    rarity?: AnchorPosition;
    text?: AnchorPosition;
}

export interface BannerStyle {
    scale: [number, number];
    width?: number;
    height?: number;
    background: string[];
    gradientAngle: number;
    border: { width: number; color: string; radius: number };
    glow: { color: string; spread: number; pulseMs: number };
    margin: Edges;
    padding: Edges;
    gap: [number, number];
}

/** One px value per side, for `margin` and `padding`. */
export interface Edges {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/** One fully resolved tier: every field present, inheritance already applied. */
export interface ResolvedTier {
    tier: Tier;
    threshold: number | null;
    banner: BannerStyle;
    /** Backward compatibility alias for banner. */
    box: BannerStyle;
    text: { align: TextAlign; title: TextStyle; desc: TextStyle; titleText?: string; descText?: string };
    icons: { achievement: IconSlot; system: IconSlot; rarity: IconSlot };
    /** `null` keeps Steam's own chime. */
    sound: SoundSpec | null;
}

export interface ResolvedTheme {
    position: ToastPosition;
    layout: Layout;
    customLayout?: CustomLayoutMap;
    animation: AnimationPair;
    textAlign: TextAlign;
    /** `null` keeps Steam's own toast duration. */
    displayTimeMs: number | null;
    tiers: Record<Tier, ResolvedTier>;
    /** Every custom asset path the theme references, for the backend to load. */
    assetPaths: string[];
    warnings: string[];
}

// --- defaults ----------------------------------------------------------------

const DEFAULT_BANNER: BannerStyle = {
    scale: [100, 100],
    background: ['#1b2838', '#2a475e'],
    gradientAngle: 90,
    border: { width: 0, color: '#ffffff', radius: 4 },
    glow: { color: '#000000', spread: 0, pulseMs: 0 },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    padding: { top: 6, bottom: 6, left: 10, right: 10 },
    gap: [10, 2],
};

const DEFAULT_TIER: Omit<ResolvedTier, 'tier' | 'threshold'> = {
    banner: DEFAULT_BANNER,
    box: DEFAULT_BANNER,
    text: {
        align: 'left',
        title: { color: '#ffffff', sizePct: 100, style: 'bold' },
        desc: { color: '#c7d5e0', sizePct: 100, style: 'regular' },
    },
    icons: {
        achievement: { source: true, scalePct: 100, rippleMs: 0 },
        system: { source: false, scalePct: 100, rippleMs: 0 },
        rarity: { source: false, scalePct: 100, rippleMs: 0 },
    },
    sound: null,
};

// --- validation helpers ------------------------------------------------------

type Json = Record<string, unknown>;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isObject(v: unknown): v is Json {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}

function color(v: unknown): string | undefined {
    return typeof v === 'string' && HEX.test(v) ? v : undefined;
}

function oneOf<T extends string>(v: unknown, options: readonly T[]): T | undefined {
    return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * Deep merge for inheritance: objects merge key by key, arrays and scalars are
 * replaced whole (themes.md § Inheritance).
 */
export function mergeTier(base: Json, override: Json): Json {
    const out: Json = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const prev = out[key];
        out[key] = isObject(prev) && isObject(value) ? mergeTier(prev, value) : value;
    }
    return out;
}

function pair(raw: unknown, fallback: [number, number], min: number, max: number): [number, number] {
    if (typeof raw === 'number') {
        const v = num(raw, min, max) ?? fallback[0];
        return [v, v];
    }
    if (Array.isArray(raw)) {
        // `[v]` means both values, like a bare `v`; `[a, b]` sets each.
        const first = num(raw[0], min, max) ?? fallback[0];
        return [first, raw.length === 1 ? first : (num(raw[1], min, max) ?? fallback[1])];
    }
    return fallback;
}

/**
 * `margin` / `padding`: a bare `v` or `[v]` sets all four sides; `[vertical, horizontal]` sets top and bottom, then left
 * and right; `[top, bottom, left, right]` sets each (the order is top, bottom, left, right, not CSS's clockwise order).
 * A side that is missing or out of range keeps its default.
 */
function edges(raw: unknown, fallback: Edges, min: number, max: number): Edges {
    const side = (v: unknown, d: number) => num(v, min, max) ?? d;
    if (typeof raw === 'number') {
        const v = side(raw, fallback.top);
        return { top: v, bottom: v, left: v, right: v };
    }
    if (!Array.isArray(raw)) return fallback;
    if (raw.length === 1) {
        const v = side(raw[0], fallback.top);
        return { top: v, bottom: v, left: v, right: v };
    }
    if (raw.length < 4) {
        const v = side(raw[0], fallback.top);
        const h = side(raw[1], fallback.left);
        return { top: v, bottom: v, left: h, right: h };
    }
    return {
        top: side(raw[0], fallback.top),
        bottom: side(raw[1], fallback.bottom),
        left: side(raw[2], fallback.left),
        right: side(raw[3], fallback.right),
    };
}

/**
 * `text.title` / `text.desc` may be a style array or, as a shorthand, the
 * replacement text itself. Move the text form to `title_text` / `desc_text`
 * *before* inheritance, so a tier that only overrides the words (the usual
 * `exceptional: { text: { title: "100% Complete" } }`) keeps normal's title
 * style instead of replacing the style array with a string.
 */
function normalizeTextShorthand(raw: Json): Json {
    if (!isObject(raw.text)) return raw;
    const text: Json = { ...raw.text };
    for (const part of ['title', 'desc'] as const) {
        if (typeof text[part] === 'string') {
            text[`${part}_text`] ??= text[part];
            delete text[part];
        }
    }
    return { ...raw, text };
}

/** `[source, scale, ripple]` or `[source, ripple]` or bare `source` shorthand. */
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

function textStyle(raw: unknown, fallback: TextStyle): TextStyle {
    if (!Array.isArray(raw)) return fallback;
    return {
        color: color(raw[0]) ?? fallback.color,
        sizePct: num(raw[1], 25, 400) ?? fallback.sizePct,
        style: oneOf(raw[2], ['bold', 'regular', 'italic'] as const) ?? fallback.style,
    };
}

function resolveTier(tier: Tier, raw: Json, warnings: string[], defaultAlign: TextAlign = 'left'): ResolvedTier {
    const d = DEFAULT_TIER;
    const bannerRaw = isObject(raw.banner) ? raw.banner : isObject(raw.box) ? raw.box : {};
    const text = isObject(raw.text) ? raw.text : {};
    const icons = isObject(raw.icons) ? raw.icons : {};

    const scale = pair(bannerRaw.scale, [100, 100], 25, 400);
    const width = num(bannerRaw.width, 100, 2000) ?? undefined;
    const height = num(bannerRaw.height, 30, 1000) ?? undefined;
    const margin = edges(bannerRaw.margin, DEFAULT_BANNER.margin, -100, 200);
    const padding = edges(bannerRaw.padding, DEFAULT_BANNER.padding, 0, 100);
    const gap = pair(bannerRaw.gap, [10, 2], 0, 100);

    const border = Array.isArray(bannerRaw.border) ? bannerRaw.border : [];
    const glow = Array.isArray(bannerRaw.glow) ? bannerRaw.glow : [];
    const background = Array.isArray(bannerRaw.background_color)
        ? bannerRaw.background_color.map(color).filter((c): c is string => !!c)
        : [];

    let sound: SoundSpec | null = null;
    if (Array.isArray(raw.sound) && typeof raw.sound[0] === 'string' && raw.sound[0]) {
        sound = { path: raw.sound[0], volumePct: num(raw.sound[1], 0, 100) ?? 100 };
    } else if (raw.sound !== undefined && raw.sound !== null) {
        // null is an explicit "Steam's chime"; anything else unusable is a typo.
        warnings.push(`${tier}.sound is not ["path", volume]; using Steam's chime.`);
    }

    const resolvedBanner: BannerStyle = {
        scale,
        width,
        height,
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

    let titleText: string | undefined = undefined;
    let descText: string | undefined = undefined;

    if (typeof text.title === 'string' && text.title.trim()) {
        titleText = text.title.trim();
    } else if (typeof text.title_text === 'string' && text.title_text.trim()) {
        titleText = text.title_text.trim();
    }

    if (typeof text.desc === 'string' && text.desc.trim()) {
        descText = text.desc.trim();
    } else if (typeof text.desc_text === 'string' && text.desc_text.trim()) {
        descText = text.desc_text.trim();
    }

    if (tier === 'exceptional') {
        if (!titleText) titleText = '100% Complete';
        if (!descText) descText = "You've unlocked all achievements!";
    }

    const align: TextAlign = oneOf(text.align, TEXT_ALIGNS) ?? defaultAlign;

    return {
        tier,
        threshold: tier === 'magic' || tier === 'rare' ? (num(raw.threshold, 0, 100) ?? null) : null,
        banner: resolvedBanner,
        box: resolvedBanner,
        text: {
            align,
            title: textStyle(text.title, d.text.title),
            desc: textStyle(text.desc, d.text.desc),
            titleText,
            descText,
        },
        icons: {
            achievement: iconSlot(icons.achievement, d.icons.achievement),
            system: iconSlot(icons.system, d.icons.system),
            rarity: iconSlot(icons.rarity, d.icons.rarity),
        },
        sound,
    };
}

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

/**
 * Validate a parsed theme file and resolve all four tiers.
 *
 * Throws only when the file is unusable as a theme (no `themes.normal`); every
 * other problem is a warning plus a default, so a typo degrades one field, not the banner.
 */
export function resolveTheme(raw: unknown): ResolvedTheme {
    if (!isObject(raw) || !isObject(raw.themes) || !isObject(raw.themes.normal)) {
        throw new Error('Theme must have a "themes.normal" object.');
    }

    const warnings: string[] = [];
    const settings = isObject(raw.settings) ? raw.settings : {};
    const normal = normalizeTextShorthand(raw.themes.normal);

    let textAlign = oneOf(settings.text_align, TEXT_ALIGNS);
    if (settings.text_align !== undefined && !textAlign) {
        warnings.push(`settings.text_align "${String(settings.text_align)}" is not supported; using left.`);
        textAlign = 'left';
    }
    const themeTextAlign = textAlign ?? 'left';

    const tiers = {} as Record<Tier, ResolvedTier>;
    for (const tier of TIERS) {
        const own = raw.themes[tier];
        if (own !== undefined && !isObject(own)) warnings.push(`themes.${tier} is not an object; inheriting normal.`);
        const merged = tier === 'normal' ? { ...normal } : mergeTier(normal, isObject(own) ? normalizeTextShorthand(own) : {});
        // `threshold` is per tier and never inherited from normal.
        if (tier !== 'normal') merged.threshold = isObject(own) ? own.threshold : undefined;
        tiers[tier] = resolveTier(tier, merged, warnings, themeTextAlign);
    }

    let position = oneOf(settings.position, POSITIONS);
    if (settings.position !== undefined && !position) {
        warnings.push(`settings.position "${String(settings.position)}" is not supported; using bottom_right.`);
        position = 'bottom_right';
    }

    let layout = oneOf(settings.layout, LAYOUTS);
    if (settings.layout !== undefined && !layout) {
        warnings.push(`settings.layout "${String(settings.layout)}" is not supported; using default_steam.`);
        layout = 'default_steam';
    }

    let customLayout: CustomLayoutMap | undefined = undefined;
    if (layout === 'ps5') {
        customLayout = {
            achievement: 'left',
            system: 'right',
            rarity: 'title_left',
            text: 'center',
        };
    } else if (layout === 'custom' || isObject(raw.layout)) {
        const rawMap = isObject(raw.layout) ? raw.layout : {};
        const validAnchors: readonly AnchorPosition[] = [
            'left', 'right', 'center', 'title_left', 'title_right', 'desc_left', 'desc_right', 'achievement_left', 'achievement_right'
        ];
        customLayout = {
            achievement: oneOf(rawMap.achievement, validAnchors) ?? 'left',
            system: oneOf(rawMap.system, validAnchors) ?? 'right',
            rarity: oneOf(rawMap.rarity, validAnchors) ?? 'title_left',
            text: oneOf(rawMap.text, validAnchors) ?? 'center',
        };
    }

    const assetPaths = new Set<string>();
    for (const t of Object.values(tiers)) {
        if (t.sound) assetPaths.add(t.sound.path);
        for (const slot of Object.values(t.icons)) if (typeof slot.source === 'string') assetPaths.add(slot.source);
    }

    const animation = resolveAnimation(settings.animation, warnings);

    return {
        position: position ?? 'bottom_right',
        layout: layout ?? 'default_steam',
        customLayout,
        animation,
        textAlign: themeTextAlign,
        displayTimeMs: num(settings.display_time_ms, 1000, 60_000) ?? null,
        tiers,
        assetPaths: [...assetPaths],
        warnings,
    };
}

// --- tier selection ----------------------------------------------------------

export interface UnlockFacts {
    /** Global unlock percentage, or null/undefined when Steam has none. */
    globalPct: number | null | undefined;
    /** True when this unlock brings the game to 100%. */
    completesGame: boolean;
}

/** First match wins: exceptional → rare → magic → normal (themes.md § themes). */
export function selectTier(theme: Pick<ResolvedTheme, 'tiers'>, facts: UnlockFacts): Tier {
    if (facts.completesGame) return 'exceptional';
    const pct = facts.globalPct;
    // Steam reports 0 when it has no rarity data (non-Steam games); treat as unknown.
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return 'normal';
    const rare = theme.tiers.rare.threshold;
    if (rare !== null && pct <= rare) return 'rare';
    const magic = theme.tiers.magic.threshold;
    if (magic !== null && pct <= magic) return 'magic';
    return 'normal';
}

/** The tier a settings-panel preview was posted for (`EA_PREVIEW_<tier>`), or null. */
export function previewTierOfId(id: string | undefined): Tier | null {
    if (typeof id !== 'string' || !id.startsWith(PREVIEW_ID_PREFIX)) return null;
    const tier = id.slice(PREVIEW_ID_PREFIX.length) as Tier;
    return TIERS.includes(tier) ? tier : null;
}

/**
 * The tier of one shown toast. A preview carries its own tier in its id, so rapid clicks can never hand one
 * preview's tier to another toast; the synthetic 100% toast is exceptional; a real unlock is chosen by rarity
 * under `theme` ('normal' without one). Never throws.
 */
export function tierOfNotification(
    facts: { id: string | undefined; globalPct: number | null | undefined },
    theme: Pick<ResolvedTheme, 'tiers'> | null,
): Tier {
    try {
        const preview = previewTierOfId(facts.id);
        if (preview) return preview;
        if (facts.id === COMPLETION_ID) return 'exceptional';
        if (theme) return selectTier(theme, { globalPct: facts.globalPct, completesGame: false });
    } catch {
        /* fall through to normal */
    }
    return 'normal';
}

/**
 * Does this unlock complete the game?
 *
 * `progress` is Steam's achievement progress cache entry for the app, read at
 * toast time. Steam only queues a refresh of that cache when the notification
 * arrives (verified live), so the entry still reflects the state *before* this
 * unlock. A missing or stale entry answers false, never a false platinum.
 */
export function completesGame(progress: { unlocked?: unknown; total?: unknown; all_unlocked?: unknown } | undefined): boolean {
    if (!progress || progress.all_unlocked === true) return false;
    const unlocked = progress.unlocked, total = progress.total;
    if (typeof unlocked !== 'number' || typeof total !== 'number' || total <= 0) return false;
    return unlocked + 1 >= total;
}

