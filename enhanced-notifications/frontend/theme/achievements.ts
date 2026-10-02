/**
 * A theme's optional `achievements` block: the themed banner that replaces Steam's achievement toast, one look per
 * rarity tier. Normalisation, inheritance and tier selection.
 *
 * Pure logic, no Steam or SDK imports, so tests/achievements-theme.test.ts runs it under plain Node. The schema is
 * documented for users in themes.md § achievements; keep the two in step. ./theme.ts resolves the whole theme and
 * calls `resolveAchievementTheme` with the block and what it inherits: the theme's (already validated) `settings`, its
 * `popup` and its `text`.
 *
 * One look, layered: the banner starts from the theme's `popup`, then the block's own popup keys, then `normal`, then
 * the tier. Text styles are the theme's `text.title` / `text.body`; a tier's `text` only sets the words.
 *
 * Everything here runs once per theme load. At toast time the hooks only pick
 * one of four pre-resolved tiers (docs/plugins.md guardrails).
 */

import { COMPLETION_ID, PREVIEW_ID_PREFIX } from '../kernel/notification.ts';
import {
    ANIMATIONS,
    POSITIONS,
    TEXT_ALIGNS,
    type Animation,
    type AnimationPair,
    type Edges,
    type FontStyle,
    type SoundSpec,
    type TextAlign,
    type ToastPosition,
} from './schema.ts';

/** Re-exported: the banner modules read them from here. */
export { ANIMATIONS, POSITIONS, TEXT_ALIGNS };
export type { Animation, AnimationPair, Edges, FontStyle, SoundSpec, TextAlign, ToastPosition };

export const TIERS = ['normal', 'magic', 'rare', 'exceptional'] as const;
export type Tier = (typeof TIERS)[number];

/** The named layouts a theme may pick; an object instead is a custom layout. */
export const LAYOUT_PRESETS = ['default_steam', 'default_system_right', 'compact_pill', 'ps5'] as const;
export type Layout = (typeof LAYOUT_PRESETS)[number] | 'custom';

/** The `popup` keys the banner reads. The theme's `popup`, the block and each tier may set any of them. */
export const BANNER_KEYS = ['background', 'gradient_angle', 'border', 'glow', 'margin', 'padding', 'gap', 'scale', 'width', 'height'] as const;

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

const ANCHORS: readonly AnchorPosition[] = [
    'left', 'right', 'center', 'title_left', 'title_right', 'desc_left', 'desc_right', 'achievement_left', 'achievement_right',
];

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

/** One fully resolved tier: every field present, inheritance already applied. */
export interface ResolvedTier {
    tier: Tier;
    threshold: number | null;
    banner: BannerStyle;
    text: { title: TextStyle; desc: TextStyle; titleText?: string; descText?: string };
    icons: { achievement: IconSlot; system: IconSlot; rarity: IconSlot };
    /** `null`: the theme's notification sound (`sound` at its top level), or Steam's chime without one. */
    sound: SoundSpec | null;
}

export interface AchievementTheme {
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

/** What the block takes from the rest of the theme. Settings arrive validated: `null` = the theme does not set it. */
export interface Inherited {
    position?: ToastPosition | null;
    animation?: AnimationPair | null;
    displayTimeMs?: number | null;
    textAlign?: TextAlign | null;
    /** The theme's raw `popup`. */
    popup?: unknown;
    /** The theme's raw `text`. */
    text?: unknown;
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

const DEFAULT_TEXT = {
    title: { color: '#ffffff', sizePct: 100, style: 'bold' } as TextStyle,
    desc: { color: '#c7d5e0', sizePct: 100, style: 'regular' } as TextStyle,
};

const DEFAULT_ICONS: ResolvedTier['icons'] = {
    achievement: { source: true, scalePct: 100, rippleMs: 0 },
    system: { source: false, scalePct: 100, rippleMs: 0 },
    rarity: { source: false, scalePct: 100, rippleMs: 0 },
};

/** Banner animation without a theme `animation`. */
const DEFAULT_ANIMATION: AnimationPair = { in: 'slide', out: 'fade' };

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

/** Only the banner's popup keys of `raw` (the rest of a popup, such as `watermark`, is not the banner's). */
function bannerKeys(raw: unknown): Json {
    const out: Json = {};
    if (isObject(raw)) for (const key of BANNER_KEYS) if (raw[key] !== undefined) out[key] = raw[key];
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
 * `margin` / `padding`, in CSS's shorthand order (clockwise, same as the notification style): a bare `v` or `[v]` sets
 * all four sides; `[vertical, horizontal]`; `[top, horizontal, bottom]`; `[top, right, bottom, left]`.
 * A side that is missing or out of range keeps its default.
 */
function edges(raw: unknown, fallback: Edges, min: number, max: number): Edges {
    const list = typeof raw === 'number' ? [raw] : raw;
    if (!Array.isArray(list) || list.length === 0) return fallback;
    const [top, right = top, bottom = top, left = right] = list as unknown[];
    const side = (v: unknown, d: number) => num(v, min, max) ?? d;
    return { top: side(top, fallback.top), right: side(right, fallback.right), bottom: side(bottom, fallback.bottom), left: side(left, fallback.left) };
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

function resolveBanner(raw: Json): BannerStyle {
    const d = DEFAULT_BANNER;
    const border = Array.isArray(raw.border) ? raw.border : [];
    const glow = Array.isArray(raw.glow) ? raw.glow : [];
    const background = Array.isArray(raw.background) ? raw.background.map(color).filter((c): c is string => !!c) : [];
    return {
        scale: pair(raw.scale, d.scale, 25, 400),
        width: num(raw.width, 100, 2000),
        height: num(raw.height, 30, 1000),
        margin: edges(raw.margin, d.margin, -100, 200),
        padding: edges(raw.padding, d.padding, 0, 100),
        gap: pair(raw.gap, d.gap, 0, 100),
        background: background.length ? background : d.background,
        gradientAngle: num(raw.gradient_angle, -360, 360) ?? d.gradientAngle,
        border: {
            width: num(border[0], 0, 20) ?? d.border.width,
            color: color(border[1]) ?? d.border.color,
            radius: num(border[2], 0, 100) ?? d.border.radius,
        },
        glow: {
            color: color(glow[0]) ?? d.glow.color,
            spread: num(glow[1], 0, 200) ?? d.glow.spread,
            pulseMs: num(glow[2], 0, 60_000) ?? d.glow.pulseMs,
        },
    };
}

/** A tier's `text.title` / `text.desc`: the words only. A style there is a warning (styles are the theme's `text`). */
function words(raw: unknown, part: 'title' | 'desc', tier: Tier, warnings: string[]): string | undefined {
    if (typeof raw === 'string') return raw.trim() || undefined;
    if (raw !== undefined && raw !== null) {
        warnings.push(`${tier}.text.${part} is the words only; its style is the theme's text.${part === 'title' ? 'title' : 'body'}.`);
    }
    return undefined;
}

function resolveTier(tier: Tier, raw: Json, text: ResolvedTier['text'], warnings: string[]): ResolvedTier {
    const ownText = isObject(raw.text) ? raw.text : {};
    const icons = isObject(raw.icons) ? raw.icons : {};

    let sound: SoundSpec | null = null;
    if (Array.isArray(raw.sound) && typeof raw.sound[0] === 'string' && raw.sound[0]) {
        sound = { path: raw.sound[0], volumePct: num(raw.sound[1], 0, 100) ?? 100 };
    } else if (raw.sound !== undefined && raw.sound !== null) {
        // null is an explicit "the notification sound"; anything else unusable is a typo.
        warnings.push(`${tier}.sound is not ["path", volume]; using the notification sound.`);
    }

    let titleText = words(ownText.title, 'title', tier, warnings);
    let descText = words(ownText.desc, 'desc', tier, warnings);
    if (tier === 'exceptional') {
        titleText ??= '100% Complete';
        descText ??= "You've unlocked all achievements!";
    }

    return {
        tier,
        threshold: tier === 'magic' || tier === 'rare' ? (num(raw.threshold, 0, 100) ?? null) : null,
        banner: resolveBanner(raw),
        text: { ...text, titleText, descText },
        icons: {
            achievement: iconSlot(icons.achievement, DEFAULT_ICONS.achievement),
            system: iconSlot(icons.system, DEFAULT_ICONS.system),
            rarity: iconSlot(icons.rarity, DEFAULT_ICONS.rarity),
        },
        sound,
    };
}

/**
 * `layout`: a preset name, or an object placing each icon (a custom layout). The block's own wins over the theme's
 * `popup.layout`. Unset: `default_steam`.
 */
function resolveLayout(raw: unknown, warnings: string[]): { layout: Layout; customLayout?: CustomLayoutMap } {
    if (raw === undefined || raw === null) return { layout: 'default_steam' };
    if (isObject(raw)) {
        return {
            layout: 'custom',
            customLayout: {
                achievement: oneOf(raw.achievement, ANCHORS) ?? 'left',
                system: oneOf(raw.system, ANCHORS) ?? 'right',
                rarity: oneOf(raw.rarity, ANCHORS) ?? 'title_left',
                text: oneOf(raw.text, ANCHORS) ?? 'center',
            },
        };
    }
    const preset = oneOf(raw, LAYOUT_PRESETS);
    if (!preset) {
        warnings.push(`layout "${String(raw)}" is not one of ${LAYOUT_PRESETS.join(', ')} or an object; using default_steam.`);
        return { layout: 'default_steam' };
    }
    if (preset === 'ps5') return { layout: 'ps5', customLayout: { achievement: 'left', system: 'right', rarity: 'title_left', text: 'center' } };
    return { layout: preset };
}

/** Keys of the old format, each with where its value lives now. A theme that has them loads with a warning. */
const GONE_IN_BLOCK: Record<string, string> = {
    settings: 'achievements.settings is gone: position, animation, display_time_ms and text_align are the theme\'s "settings", and the layout is achievements.layout; ignored.',
    tiers: 'achievements.tiers is gone: the tiers sit directly in achievements (achievements.normal, .magic, ...); ignored.',
    themes: 'achievements.themes is gone: the tiers sit directly in achievements (achievements.normal, .magic, ...); ignored.',
};
const GONE_IN_TIER: Record<string, string> = {
    banner: 'banner is gone: put its keys on the tier itself ("background", "border", ...); ignored.',
    box: 'box is gone: put its keys on the tier itself ("background", "border", ...); ignored.',
    background_color: 'background_color is now "background"; ignored.',
};

/**
 * Validate a theme's `achievements` block and resolve all four tiers. Throws only when the block is not an object;
 * every other problem is a warning plus a default, so a typo degrades one field, not the banner.
 */
export function resolveAchievementTheme(raw: unknown, inherited: Inherited = {}): AchievementTheme {
    if (!isObject(raw)) throw new Error('it is not an object.');
    const warnings: string[] = [];
    for (const [key, message] of Object.entries(GONE_IN_BLOCK)) if (raw[key] !== undefined) warnings.push(message);

    const themeText = isObject(inherited.text) ? inherited.text : {};
    const text: ResolvedTier['text'] = {
        title: textStyle(themeText.title, DEFAULT_TEXT.title),
        desc: textStyle(themeText.body, DEFAULT_TEXT.desc),
    };

    // One look, layered: the theme's popup, the block's own popup keys, normal, then the tier.
    const base = { ...bannerKeys(inherited.popup), ...bannerKeys(raw) };
    const normal = isObject(raw.normal) ? raw.normal : {};
    const tiers = {} as Record<Tier, ResolvedTier>;
    for (const tier of TIERS) {
        const own = raw[tier];
        if (own !== undefined && !isObject(own)) warnings.push(`${tier} is not an object; inheriting normal.`);
        const ownJson = isObject(own) ? own : {};
        for (const [key, message] of Object.entries(GONE_IN_TIER)) if (ownJson[key] !== undefined) warnings.push(`${tier}.${message}`);
        const merged = mergeTier(mergeTier(base, normal), tier === 'normal' ? {} : ownJson);
        // `threshold` is per tier and never inherited from normal.
        merged.threshold = ownJson.threshold;
        tiers[tier] = resolveTier(tier, merged, text, warnings);
    }

    const popup = isObject(inherited.popup) ? inherited.popup : {};
    const { layout, customLayout } = resolveLayout(raw.layout ?? popup.layout, warnings);

    const assetPaths = new Set<string>();
    for (const t of Object.values(tiers)) {
        if (t.sound) assetPaths.add(t.sound.path);
        for (const slot of Object.values(t.icons)) if (typeof slot.source === 'string') assetPaths.add(slot.source);
    }

    return {
        position: inherited.position ?? 'bottom_right',
        layout,
        customLayout,
        animation: inherited.animation ?? DEFAULT_ANIMATION,
        textAlign: inherited.textAlign ?? 'left',
        displayTimeMs: inherited.displayTimeMs ?? null,
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

/** First match wins: exceptional → rare → magic → normal (themes.md § achievements). */
export function selectTier(theme: Pick<AchievementTheme, 'tiers'>, facts: UnlockFacts): Tier {
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
    theme: Pick<AchievementTheme, 'tiers'> | null,
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

