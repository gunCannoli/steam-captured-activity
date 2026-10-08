/**
 * Theme schema and CSS generation for enhanced-notifications.
 *
 * Pure logic with no Steam or SDK imports, so tests/theme.test.ts runs it under
 * plain Node. The user-facing schema is themes.md; keep the two in step.
 *
 * One style for every notification, so toasts stay consistent: a theme is
 * `settings` (position, animation, display time, text alignment) plus the style keys at the top
 * level. Anything a theme does not set stays Steam's own: a resolved field of
 * `null` means "leave it stock", so the generated CSS only touches what the
 * theme asks for. Icons, logos and text content are never replaced.
 *
 * The optional `achievements` block (./achievements.ts) replaces achievement
 * toasts with a themed banner per rarity tier, built from the same `settings`,
 * `popup` and `text`. Without it, achievement toasts get this same style, like
 * every other toast.
 */

import type { ToastSelectors } from '../kernel/toast-selectors.ts';
import { ANIMATIONS, POSITIONS, TEXT_ALIGNS, type Animation, type AnimationPair, type Edges, type FontStyle, type HoverSpec, type SoundSpec, type TextAlign, type ToastPosition } from './schema.ts';
import { resolveAchievementTheme, type AchievementTheme, type Inherited } from './achievements.ts';

/** Re-exported: theme.test.ts and active-theme.ts read it from here. */
export type { ToastSelectors };
/** Re-exported: placement.ts and the surfaces read them from here. */
export { ANIMATIONS, POSITIONS };
export type { Animation, AnimationPair, Edges, FontStyle, SoundSpec, TextAlign, ToastPosition };

// --- placement and animation (the same names and values as the achievement banner's) ---------

/** [entrance, exit] ms, the achievement banner's lengths (banner/timing.ts). */
export const ANIMATION_MS: Record<Animation, [number, number]> = {
    fade: [400, 300],
    slide: [350, 300],
    up: [350, 300],
    down: [350, 300],
    ps5: [450, 400],
    none: [0, 0],
};

/**
 * Steam's desktop toast lifetime (verified live 2026-10-01, docs/steam-components.md § Desktop toast stack):
 * a 300 ms slide in, the type's `toastDurationMS` shown, a 300 ms slide out, then the popup closes.
 * A theme animation has to fit inside that, so its exit ends when Steam closes the popup.
 */
export const STEAM_IN_MS = 300;
export const STEAM_OUT_MS = 300;

// --- resolved style ---------------------------------------------------------------

export interface TextStyle {
    color: string | null;
    sizePct: number | null;
    style: FontStyle | null;
}

/** Every field `null` = keep Steam's own. */
export interface ResolvedStyle {
    background: string[] | null;
    gradientAngle: number;
    border: { width: number; color: string; radius: number } | null;
    glow: { color: string; spread: number; pulseMs: number } | null;
    watermark: boolean | null;
    fontFamily: string | null;
    text: { title: TextStyle; body: TextStyle; subtext: TextStyle };
    /** `settings.text_align`, for the title, body and subtext. `null` = Steam's left. */
    textAlign: TextAlign | null;
    /** `game_icon`: the game's icon on the left of the toast. */
    gameIcon: { visible: boolean | null; radius: number | null };
    headerIcon: boolean | null;
    /** `false` mutes every notification; `null` keeps Steam's sound. */
    sound: SoundSpec | false | null;
    /** `settings.hover`: the mouse-over highlight (Steam's own when unset). */
    hover: HoverSpec;
    /** Distance from the anchor corner; only the sides the toast is anchored to count. `null` = Steam's place. */
    margin: Edges | null;
    /** Space inside the toast, around its logo and text. `null` = Steam's 10 px. */
    padding: Edges | null;
    /** [logo to text, between text rows] px; a `null` side keeps Steam's own. */
    gap: [number | null, number | null];
}

export interface ResolvedTheme {
    /** Screen corner for desktop and overlay toasts. `null` = Steam's own corner. */
    position: ToastPosition | null;
    /** Entrance and exit. `null` = Steam's own slide. */
    animation: AnimationPair | null;
    /** How long every toast shows. `null` = Steam's own duration per type. */
    displayTimeMs: number | null;
    /** The one style every notification gets. */
    style: ResolvedStyle;
    /** The achievement banner (the `achievements` block), or `null`: achievement toasts get `style` like every other toast. */
    achievements: AchievementTheme | null;
    /** Every custom asset path the theme references (sounds and the banner's icons), for the backend to load. */
    assetPaths: string[];
    warnings: string[];
}

// --- validation helpers -------------------------------------------------------------

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
function bool(v: unknown): boolean | null {
    return typeof v === 'boolean' ? v : null;
}
function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
    return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * `margin` / `padding`, in CSS's shorthand order (clockwise, the same in the achievement banner): a bare `v` or `[v]` sets
 * all four sides; `[vertical, horizontal]`; `[top, horizontal, bottom]`; `[top, right, bottom, left]`.
 * A side that is missing or out of range takes `fallback`. Unset: `null` (Steam's own).
 */
function edges(raw: unknown, fallback: number, min: number, max: number): Edges | null {
    const list = typeof raw === 'number' ? [raw] : raw;
    if (!Array.isArray(list) || list.length === 0) return null;
    const [top, right = top, bottom = top, left = right] = list as unknown[];
    const side = (v: unknown) => num(v, min, max) ?? fallback;
    return { top: side(top), right: side(right), bottom: side(bottom), left: side(left) };
}

/** `gap`: a bare `v` or `[v]` sets both; `[x, y]` sets each. */
function gapPair(raw: unknown): [number | null, number | null] {
    if (typeof raw === 'number') {
        const v = num(raw, 0, 100) ?? null;
        return [v, v];
    }
    if (!Array.isArray(raw)) return [null, null];
    const x = num(raw[0], 0, 100) ?? null;
    return [x, raw.length === 1 ? x : (num(raw[1], 0, 100) ?? null)];
}

/**
 * `settings.animation` is a bare string (both states use it) or `{ "in": ..., "out": ... }`; an unset side of the
 * object keeps the achievement banner's default (slide in, fade out). Unset or invalid as a whole: `null`, Steam's slide.
 */
function resolveAnimation(raw: unknown, warnings: string[]): AnimationPair | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') {
        const a = oneOf(raw, ANIMATIONS);
        if (!a) warnings.push(`settings.animation "${raw}" is not one of ${ANIMATIONS.join(', ')}; keeping Steam's slide.`);
        return a ? { in: a, out: a } : null;
    }
    if (isObject(raw)) {
        const inAnim = oneOf(raw.in, ANIMATIONS);
        const outAnim = oneOf(raw.out, ANIMATIONS);
        if (raw.in !== undefined && !inAnim) warnings.push(`settings.animation.in "${String(raw.in)}" is not supported; using slide.`);
        if (raw.out !== undefined && !outAnim) warnings.push(`settings.animation.out "${String(raw.out)}" is not supported; using fade.`);
        return { in: inAnim ?? 'slide', out: outAnim ?? 'fade' };
    }
    warnings.push("settings.animation is not a string or {in, out} object; keeping Steam's slide.");
    return null;
}

function textStyle(raw: unknown): TextStyle {
    if (!Array.isArray(raw)) return { color: null, sizePct: null, style: null };
    const style = raw[2] === 'bold' || raw[2] === 'regular' || raw[2] === 'italic' ? raw[2] : null;
    return { color: color(raw[0]) ?? null, sizePct: num(raw[1], 25, 400) ?? null, style };
}

/** A family name only: letters, digits, spaces, commas, quotes and hyphens (no CSS injection). */
function fontFamily(v: unknown): string | null {
    return typeof v === 'string' && /^[\w\s,"'-]{1,120}$/.test(v) ? v : null;
}

/** `game_icon`: `[visible, radius px]`, or a bare `visible`. */
function gameIcon(raw: unknown, warnings: string[]): ResolvedStyle['gameIcon'] {
    if (raw === undefined || raw === null) return { visible: null, radius: null };
    if (typeof raw === 'boolean') return { visible: raw, radius: null };
    if (Array.isArray(raw)) return { visible: bool(raw[0]), radius: num(raw[1], 0, 100) ?? null };
    warnings.push('game_icon must be [visible, radius] or true / false; ignored.');
    return { visible: null, radius: null };
}

/** `settings.hover`: `true` / `false`, `[enabled]` or `[enabled, "#hex"]`. Unset or unreadable: Steam's own. */
export function resolveHover(raw: unknown, warnings: string[]): HoverSpec {
    const steam: HoverSpec = { enabled: true, color: null };
    if (raw === undefined) return steam;
    if (typeof raw === 'boolean') return { enabled: raw, color: null };
    if (Array.isArray(raw) && typeof raw[0] === 'boolean') {
        if (raw[1] === undefined) return { enabled: raw[0], color: null };
        const c = color(raw[1]);
        if (c) return { enabled: raw[0], color: c };
        warnings.push(`settings.hover colour "${String(raw[1])}" is not #rgb, #rrggbb or #rrggbbaa; using Steam's.`);
        return { enabled: raw[0], color: null };
    }
    warnings.push('settings.hover must be true, false or [true, "#hex"]; using Steam\'s.');
    return steam;
}

function resolveStyle(raw: Json, textAlign: TextAlign | null, warnings: string[]): ResolvedStyle {
    const popup = isObject(raw.popup) ? raw.popup : {};
    const text = isObject(raw.text) ? raw.text : {};

    const background = Array.isArray(popup.background)
        ? popup.background.map(color).filter((c): c is string => !!c)
        : [];
    const border = Array.isArray(popup.border) ? popup.border : null;
    const glow = Array.isArray(popup.glow) ? popup.glow : null;

    let sound: ResolvedStyle['sound'] = null;
    if (raw.sound === false) sound = false;
    else if (Array.isArray(raw.sound) && typeof raw.sound[0] === 'string' && raw.sound[0]) {
        sound = { path: raw.sound[0], volumePct: num(raw.sound[1], 0, 100) ?? 100 };
    } else if (raw.sound !== undefined && raw.sound !== null) {
        warnings.push(`sound must be ["path", volume] or false; keeping Steam's sound.`);
    }

    if (raw.font_family !== undefined && fontFamily(raw.font_family) === null) {
        warnings.push(`font_family is not a plain font name; ignored.`);
    }

    return {
        background: background.length ? background : null,
        gradientAngle: num(popup.gradient_angle, -360, 360) ?? 135,
        border: border
            ? { width: num(border[0], 0, 20) ?? 1, color: color(border[1]) ?? '#ffffff33', radius: num(border[2], 0, 100) ?? 4 }
            : null,
        glow: glow ? { color: color(glow[0]) ?? '#000000', spread: num(glow[1], 0, 200) ?? 0, pulseMs: num(glow[2], 0, 60_000) ?? 0 } : null,
        watermark: bool(popup.watermark),
        fontFamily: fontFamily(raw.font_family),
        text: { title: textStyle(text.title), body: textStyle(text.body), subtext: textStyle(text.subtext) },
        textAlign,
        hover: resolveHover(isObject(raw.settings) ? raw.settings.hover : undefined, warnings),
        gameIcon: gameIcon(raw.game_icon, warnings),
        headerIcon: bool(raw.header_icon),
        sound,
        margin: edges(popup.margin, 0, -100, 200),
        padding: edges(popup.padding, 10, 0, 100),
        gap: gapPair(popup.gap),
    };
}

/** Top-level keys of older formats, each with where its value lives now. A theme that has them loads with a warning. */
const GONE: Record<string, string> = {
    default: '"default" is gone: one style for every notification, with its keys at the top level; ignored.',
    categories: '"categories" is gone: one style for every notification, with its keys at the top level; ignored.',
    types: '"types" is gone: one style for every notification, with its keys at the top level; ignored.',
    display_time_ms: 'display_time_ms moved into "settings"; ignored here.',
    logo: '"logo" is now "game_icon": [visible, radius]; ignored.',
    themes: '"themes" (an Enhanced Achievements theme) is gone: put its tiers in "achievements" (achievements.normal, ...); ignored.',
};

/**
 * Validate a theme file. Throws only when it is unusable (not an object);
 * everything else is a warning plus "keep Steam's own".
 */
export function resolveTheme(raw: unknown): ResolvedTheme {
    if (!isObject(raw)) throw new Error('Theme must be a JSON object.');
    const warnings: string[] = [];
    const settings = isObject(raw.settings) ? raw.settings : {};
    const position = settings.position === undefined ? null : (oneOf(settings.position, POSITIONS) ?? null);
    if (settings.position !== undefined && !position) {
        warnings.push(`settings.position "${String(settings.position)}" is not one of ${POSITIONS.join(', ')}; keeping Steam's corner.`);
    }
    const animation = resolveAnimation(settings.animation, warnings);
    const displayTimeMs = num(settings.display_time_ms, 1000, 60_000) ?? null;
    const textAlign = settings.text_align === undefined ? null : (oneOf(settings.text_align, TEXT_ALIGNS) ?? null);
    if (settings.text_align !== undefined && !textAlign) {
        warnings.push(`settings.text_align "${String(settings.text_align)}" is not one of ${TEXT_ALIGNS.join(', ')}; keeping Steam's left.`);
    }
    for (const [key, message] of Object.entries(GONE)) if (raw[key] !== undefined) warnings.push(message);

    const style = resolveStyle(raw, textAlign, warnings);
    const achievements = resolveAchievements(raw.achievements, { position, animation, displayTimeMs, textAlign, hover: style.hover, popup: raw.popup, text: raw.text }, warnings);
    const assetPaths = new Set<string>(style.sound ? [style.sound.path] : []);
    for (const path of achievements?.assetPaths ?? []) assetPaths.add(path);
    return { position, animation, displayTimeMs, style, achievements, assetPaths: [...assetPaths], warnings };
}

/**
 * The optional `achievements` block. It inherits the theme's settings, `popup` and `text` (achievements.ts), so one
 * theme reads as one look. A block that cannot be used is a warning, never a failed theme: achievement toasts then get
 * the notification style.
 */
function resolveAchievements(raw: unknown, inherited: Inherited, warnings: string[]): AchievementTheme | null {
    if (raw === undefined || raw === null) return null;
    try {
        const theme = resolveAchievementTheme(raw, inherited);
        for (const warning of theme.warnings) warnings.push(`achievements: ${warning}`);
        return theme;
    } catch (error) {
        warnings.push(`achievements: ${error instanceof Error ? error.message : String(error)} Achievement toasts get the notification style.`);
        return null;
    }
}

// --- CSS generation -------------------------------------------------------------------

/** Steam's default font sizes for the three text parts (px), which size_pct scales. */
const BASE_PX = { title: 11, body: 12, subtext: 11 };

function textRule(sel: string | undefined, root: string, t: TextStyle, basePx: number, align: TextAlign | null): string {
    if (!sel) return '';
    const decls = [
        align ? `text-align: ${align} !important;` : '',
        t.color ? `color: ${t.color} !important;` : '',
        t.sizePct !== null && t.sizePct !== 100 ? `font-size: ${((basePx * t.sizePct) / 100).toFixed(1)}px !important;` : '',
        t.style === 'bold' ? 'font-weight: 700 !important;' : t.style === 'regular' ? 'font-weight: 400 !important;' : '',
        t.style === 'italic' ? 'font-style: italic !important;' : '',
    ].join('');
    return decls ? `${root} ${sel} { ${decls} }\n` : '';
}

/**
 * The theme's CSS, the same for every notification. Every rule starts with
 * `body[data-en-type]`, the attribute the injector sets on a toast window while
 * it shows a toast this plugin styles (surfaces/style/injector.ts; never an
 * achievement toast the banner draws), so nothing can match any other
 * window. Returns '' when the style is all stock.
 */
/**
 * The toast box's total height in Steam's own CSS (verified live 2026-10-02 from the toast window's stylesheets):
 * DesktopToastTemplate (desktop and the overlay, the same class in four modules) is `padding: 10px; height: 50px`,
 * so 70; Big Picture's ShortTemplate is `padding: 0; height: 40px`. A theme's `padding` is laid out inside that height
 * (content-box, the height set to what is left), so the toast keeps Steam's size and its window (284x71 on desktop)
 * never crops it. `box-sizing: border-box` shrank it to 50 and cut the text off at the top and bottom.
 */
export const STEAM_TEMPLATE_HEIGHT = { desktop: 70, short: 40 } as const;

export function buildCss(s: ResolvedStyle, sel: ToastSelectors): string {
    const root = 'body[data-en-type]';
    const desktopCard = sel.desktopPopup ? `${root} ${sel.desktopPopup}` : '';
    // Big Picture and the in-game overlay animate the popup's child (`.GamepadToastPopup > *`, where Steam paints its own
    // card), not the popup: a card on the popup stayed opaque after the exit, so the text slid out over a card that
    // stayed, and in the game overlay (which moves its view to 0,0 before hiding it) flashed top-left (found live
    // 2026-10-08, docs/plans/enhanced-notifications-consistency-plan.md H1d). So the card goes on that child.
    const gamepadCard = sel.gamepadPopup ? `${root} ${sel.gamepadPopup} > *` : '';
    let css = '';

    const cardDecls: string[] = [];
    if (s.background) {
        const bg = s.background.length > 1 ? `linear-gradient(${s.gradientAngle}deg, ${s.background.join(', ')})` : s.background[0];
        cardDecls.push(`background: ${bg} !important;`);
        // A template nested inside Big Picture's card paints Steam's colour over ours.
        if (gamepadCard && sel.shortTemplate) css += `${gamepadCard} ${sel.shortTemplate} { background: transparent !important; }\n`;
    }
    if (s.border) {
        cardDecls.push(
            s.border.width > 0 ? `border: ${s.border.width}px solid ${s.border.color} !important;` : 'border: none !important;',
            `border-radius: ${s.border.radius}px !important;`,
            'overflow: hidden !important;',
        );
    }
    const pulse = s.glow && s.glow.spread > 0 && s.glow.pulseMs > 0 ? s.glow : null;
    if (s.glow && s.glow.spread > 0) {
        cardDecls.push(`box-shadow: inset 0 0 ${s.glow.spread}px ${s.glow.color} !important;`);
        if (pulse) {
            css += `@keyframes en-pulse { from { box-shadow: inset 0 0 0 ${pulse.color}; } to { box-shadow: inset 0 0 ${pulse.spread}px ${pulse.color}; } }\n`;
        }
    }
    if (s.fontFamily) cardDecls.push(`font-family: ${s.fontFamily} !important;`);
    if (cardDecls.length) {
        const pulseDecl = pulse ? ` animation: en-pulse ${pulse.pulseMs}ms ease-in-out infinite alternate;` : '';
        // Desktop: the popup is the card, and the theme's entrance and exit run on its wrapper, so the pulse can run here.
        if (desktopCard) css += `${desktopCard} { ${cardDecls.join(' ')}${pulseDecl} }\n`;
        if (gamepadCard) {
            css += `${gamepadCard} { ${cardDecls.join(' ')}${pulse ? ' position: relative !important;' : ''} }\n`;
            // Big Picture's card runs the entrance and exit itself, so the pulse is a layer of its own on top.
            if (pulse) {
                css += `${gamepadCard}::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;${pulseDecl} }\n`;
            }
        }
    }
    if (s.fontFamily && sel.templates) css += `${root} ${sel.templates}, ${root} ${sel.templates} * { font-family: ${s.fontFamily} !important; }\n`;

    if (s.watermark === false && sel.watermark) css += `${root} ${sel.watermark} { display: none !important; }\n`;

    // Steam's hover is the card's ::before (`position: absolute; inset: 0`), but the card is `position: static`, so the
    // overlay covered the whole toast window: square over a rounded card, outside its margin, and only following an
    // animation while its transform ran. Positioned and clipping, the card holds its own overlay and watermark. Only
    // when the card differs from the window (rounded corners) or the hover is the theme's: otherwise stock is right.
    if (sel.desktopPopup && (s.border || !s.hover.enabled || s.hover.color)) {
        const card = `${root} ${sel.desktopPopup}`;
        css += `${card} { position: relative !important; overflow: hidden !important; }\n`;
        if (!s.hover.enabled) {
            css += `${card}::before { display: none !important; }\n`;
            if (sel.watermark) css += `${card}:hover ${sel.watermark} { color: inherit !important; opacity: 0.05 !important; }\n`;
        } else if (s.hover.color) {
            css += `${card}::before { background: ${s.hover.color} !important; }\n`;
            if (sel.watermark) css += `${card}:hover ${sel.watermark} { color: ${s.hover.color} !important; }\n`;
        }
    }

    css += textRule(sel.title, root, s.text.title, BASE_PX.title, s.textAlign);
    css += textRule(sel.body, root, s.text.body, BASE_PX.body, s.textAlign);
    css += textRule(sel.subtext, root, s.text.subtext, BASE_PX.subtext, s.textAlign);

    if (s.gameIcon.visible === false && sel.logoBox) css += `${root} ${sel.logoBox} { display: none !important; }\n`;
    if (s.gameIcon.radius !== null && sel.appLogo) {
        css += `${root} ${sel.appLogo}, ${root} ${sel.appLogo} img { border-radius: ${s.gameIcon.radius}px !important; overflow: hidden; }\n`;
    }
    if (s.headerIcon === false && sel.headerIcon) css += `${root} ${sel.headerIcon} { display: none !important; }\n`;

    if (s.padding) {
        const p = s.padding;
        const box = (selector: string | undefined, total: number) => {
            if (!selector) return;
            const height = Math.max(0, total - p.top - p.bottom);
            css += `${root} ${selector} { padding: ${p.top}px ${p.right}px ${p.bottom}px ${p.left}px !important; box-sizing: content-box !important; height: ${height}px !important; }\n`;
        };
        box(sel.desktopTemplate, STEAM_TEMPLATE_HEIGHT.desktop);
        box(sel.shortTemplate, STEAM_TEMPLATE_HEIGHT.short);
    }
    const [gapX, gapY] = s.gap;
    if (sel.content && (gapX !== null || gapY !== null)) {
        const decls = [gapX !== null ? `margin-left: ${gapX}px !important;` : '', gapY !== null ? `gap: ${gapY}px !important;` : ''].filter(Boolean).join(' ');
        css += `${root} ${sel.content} { ${decls} }\n`;
    }

    return css;
}

const KEYFRAMES: Record<string, string> = {
    'en-in-fade': 'from { opacity: 0; } to { opacity: 1; }',
    'en-out-fade': 'from { opacity: 1; } to { opacity: 0; }',
    'en-in-slide': 'from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); }',
    'en-in-slide-left': 'from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); }',
    'en-out-slide': 'from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100%); }',
    'en-out-slide-left': 'from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-100%); }',
    'en-in-ps5-right': 'from { opacity: 0; transform: translateX(25%); } to { opacity: 1; transform: none; }',
    'en-in-ps5-left': 'from { opacity: 0; transform: translateX(-25%); } to { opacity: 1; transform: none; }',
    'en-in-ps5-top': 'from { opacity: 0; transform: translateY(-40%); } to { opacity: 1; transform: none; }',
    'en-in-ps5-bottom': 'from { opacity: 0; transform: translateY(40%); } to { opacity: 1; transform: none; }',
    'en-out-ps5-right': 'from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(25%); }',
    'en-out-ps5-left': 'from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-25%); }',
    'en-out-ps5-top': 'from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-40%); }',
    'en-out-ps5-bottom': 'from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(40%); }',
    'en-in-up': 'from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: translateY(0); }',
    'en-out-up': 'from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(100%); }',
    'en-in-down': 'from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); }',
    'en-out-down': 'from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-100%); }',
};

/** The keyframe for one state; slide and ps5 take their direction from the corner, as in the achievement banner. */
export function keyframeName(state: 'in' | 'out', a: Animation, position: ToastPosition): string | null {
    if (a === 'none') return null;
    const left = position.endsWith('_left');
    if (a === 'slide') return `en-${state}-slide${left ? '-left' : ''}`;
    if (a === 'ps5') {
        const dir = left ? 'left' : position.endsWith('_right') ? 'right' : position.startsWith('top_') ? 'top' : 'bottom';
        return `en-${state}-ps5-${dir}`;
    }
    return `en-${state}-${a}`;
}

/**
 * The theme's entrance and exit, for every toast window. On desktop and in the overlay it runs on the popup's
 * wrapper, not the popup, so a pulsing glow (an animation on the popup) keeps running. The exit is timed to end when
 * Steam closes the popup: Steam's slide in, then `--en-display-ms` (the type's own toast duration, set on the toast
 * window's body by the style surface), then Steam's slide out. '' when the theme sets no animation.
 */
export function buildAnimationCss(theme: Pick<ResolvedTheme, 'animation' | 'position'>, sel: ToastSelectors): string {
    const anim = theme.animation;
    if (!anim || !sel.desktopPopup) return '';
    const corner = theme.position ?? 'bottom_right'; // Steam's default corner
    const inName = keyframeName('in', anim.in, corner);
    const outName = keyframeName('out', anim.out, corner);
    const inMs = ANIMATION_MS[anim.in][0];
    const outMs = ANIMATION_MS[anim.out][1];
    const inEase = anim.in === 'ps5' ? 'cubic-bezier(0.25, 0.6, 0.3, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)';
    const outEase = anim.out === 'ps5' ? 'ease-in-out' : 'ease-in';
    const lead = STEAM_IN_MS + STEAM_OUT_MS - outMs;
    const rule = (selector: string, exitDelay: string) =>
        `${selector} {` +
        ` animation-name: ${inName ?? 'none'}, ${outName ?? 'none'};` +
        ` animation-duration: ${inMs}ms, ${outMs}ms;` +
        ` animation-timing-function: ${inEase}, ${outEase};` +
        ` animation-delay: 0ms, ${exitDelay};` +
        ' animation-fill-mode: both, forwards; }\n';
    let css = '';
    for (const name of [inName, outName]) if (name) css += `@keyframes ${name} { ${KEYFRAMES[name]} }\n`;
    css += rule(`body[data-en-type] > :has(> ${sel.desktopPopup})`, `calc(var(--en-display-ms, 5000ms) + ${lead}ms)`);
    // Big Picture (verified live 2026-10-01): Steam animates `.GamepadToastPopup > *`, rebuilt for each toast, with a
    // 300 ms slide in and a 300 ms fade out starting at its own `--toast-duration`; ours replaces both and ends when it would.
    if (sel.gamepadPopup) css += rule(`body[data-en-type] ${sel.gamepadPopup} > *`, `calc(var(--toast-duration, 5000ms) + ${STEAM_OUT_MS - outMs}ms)`);
    return css;
}

/**
 * Big Picture's toast position (verified live 2026-10-01): its one toast view follows a `position: fixed` placeholder
 * div Steam renders into the Big Picture window (bottom right by default), re-measured when a toast shows. So the
 * theme's corner and margin are CSS on that placeholder; while the achievement banner shows, its own corner and its
 * tier's margin (surfaces/style/injector.ts). `null` position with a margin: Steam's bottom-right corner.
 * '' when the theme sets neither.
 */
export function buildPlaceholderCss(position: ToastPosition | null, margin: Edges | null, placeholder: string | undefined): string {
    if (!placeholder || (!position && !margin)) return '';
    const corner = position ?? 'bottom_right';
    const m = margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const decls = [
        corner.startsWith('top_') ? `top: ${m.top}px !important; bottom: auto !important;` : `bottom: ${m.bottom}px !important; top: auto !important;`,
        corner.endsWith('_left')
            ? `left: ${m.left}px !important; right: auto !important;`
            : corner.endsWith('_right')
              ? `right: ${m.right}px !important; left: auto !important;`
              : 'left: 0 !important; right: 0 !important; margin-left: auto !important; margin-right: auto !important;',
    ];
    return `${placeholder} { ${decls.join(' ')} }\n`;
}
