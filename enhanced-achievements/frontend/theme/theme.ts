/**
 * Theme schema, normalisation, inheritance and tier selection.
 *
 * Pure logic, no Steam or SDK imports, so tests/theme.test.ts runs it under
 * plain Node. The schema is documented for users in themes.md; keep the two in step.
 *
 * Everything here runs once per theme load. At toast time the hooks only pick
 * one of four pre-resolved tiers (docs/plans/enhanced-achievements-plan.md, guardrail 5).
 */

export const TIERS = ['normal', 'magic', 'rare', 'exceptional'] as const;
export type Tier = (typeof TIERS)[number];

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
    | 'desc_right'
    | 'achievement_left'
    | 'achievement_right';

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

// --- defaults ----------------------------------------------------------------

const DEFAULT_BANNER: BannerStyle = {
    scale: [100, 100],
    background: ['#1b2838', '#2a475e'],
    gradientAngle: 90,
    border: { width: 0, color: '#ffffff', radius: 4 },
    glow: { color: '#000000', spread: 0, pulseMs: 0 },
    margin: [0, 0],
    padding: [6, 10],
    gap: [10, 2],
};

const DEFAULT_TIER: Omit<ResolvedTier, 'tier' | 'threshold'> = {
    banner: DEFAULT_BANNER,
    box: DEFAULT_BANNER,
    text: {
        title: { color: '#ffffff', sizePct: 100, style: 'bold' },
        desc: { color: '#c7d5e0', sizePct: 100, style: 'regular' },
    },
    icons: {
        achievement: { source: true, scalePct: 100, rippleMs: 0 },
        system: { source: false, scalePct: 100, rippleMs: 0 },
        rarity: { source: false, scalePct: 100, rippleMs: 0 },
        exceptional: { source: false, scalePct: 100, rippleMs: 0 },
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
        return [
            num(raw[0], min, max) ?? fallback[0],
            num(raw[1], min, max) ?? fallback[1],
        ];
    }
    return fallback;
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
    const normal = raw.themes.normal;

    const tiers = {} as Record<Tier, ResolvedTier>;
    for (const tier of TIERS) {
        const own = raw.themes[tier];
        if (own !== undefined && !isObject(own)) warnings.push(`themes.${tier} is not an object; inheriting normal.`);
        const merged = tier === 'normal' ? normal : mergeTier(normal, isObject(own) ? own : {});
        // `threshold` is per tier and never inherited from normal.
        if (tier !== 'normal') merged.threshold = isObject(own) ? own.threshold : undefined;
        tiers[tier] = resolveTier(tier, merged, warnings);
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
            exceptional: 'title_left',
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
            exceptional: oneOf(rawMap.exceptional, validAnchors) ?? 'title_left',
            text: oneOf(rawMap.text, validAnchors) ?? 'center',
        };
    }

    const assetPaths = new Set<string>();
    for (const t of Object.values(tiers)) {
        if (t.sound) assetPaths.add(t.sound.path);
        for (const slot of Object.values(t.icons)) if (typeof slot.source === 'string') assetPaths.add(slot.source);
    }

    return {
        layout: layout ?? 'default_steam',
        customLayout,
        animation: oneOf(settings.animation, ANIMATIONS) ?? 'slide',
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

