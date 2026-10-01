/**
 * Theme schema, inheritance, and CSS generation for enhanced-notifications.
 *
 * Pure logic with no Steam or SDK imports, so tests/theme.test.ts runs it under
 * plain Node. The user-facing schema is themes.md; keep the two in step.
 *
 * Principle: anything a theme does not set stays Steam's own. A resolved field
 * of `null` means "leave it stock", so the generated CSS only touches what the
 * theme asks for. Icons, logos and text content are never replaced.
 */

import type { ToastSelectors } from '../kernel/toast-selectors.ts';

/** Re-exported: theme.test.ts and active-theme.ts read it from here. */
export type { ToastSelectors };

// --- notification types ---------------------------------------------------------

export const CATEGORIES = ['friends', 'messages', 'downloads', 'recording', 'achievement', 'system'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Steam's EClientNotificationType names (from the SDK enum, verified 1:1 with
 * `notification.eType`) grouped into categories. Anything unlisted is `system`.
 */
const CATEGORY_OF: Record<string, Category> = {
    FriendOnline: 'friends',
    FriendInGame: 'friends',
    FriendInvite: 'friends',
    FriendInviteRollup: 'friends',
    IncomingVoiceChat: 'friends',
    FamilyInvite: 'friends',
    FriendMessage: 'messages',
    GroupChatMessage: 'messages',
    Comment: 'messages',
    TradeOffer: 'messages',
    AsyncGame: 'messages',
    DownloadComplete: 'downloads',
    ClipDownloaded: 'downloads',
    RequestedGameAdded: 'downloads',
    GiftReceived: 'downloads',
    Screenshot: 'recording',
    GameRecordingStart: 'recording',
    GameRecordingStop: 'recording',
    GameRecordingUserMarkerAdded: 'recording',
    GameRecordingInstantClip: 'recording',
    GameRecordingError: 'recording',
    Achievement: 'achievement',
};

export function categoryOf(typeName: string): Category {
    return CATEGORY_OF[typeName] ?? 'system';
}

// --- resolved style ---------------------------------------------------------------

export type FontStyle = 'bold' | 'regular' | 'italic';

export interface TextStyle {
    color: string | null;
    sizePct: number | null;
    style: FontStyle | null;
}

export interface SoundSpec {
    path: string;
    volumePct: number;
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
    logo: { visible: boolean | null; radius: number | null };
    headerIcon: boolean | null;
    /** `false` mutes the type; `null` keeps Steam's sound. */
    sound: SoundSpec | false | null;
    displayTimeMs: number | null;
}

export interface ResolvedTheme {
    /** Style for a type name; resolved lazily per type and cached. */
    styleFor(typeName: string): ResolvedStyle;
    /** Every custom asset path the theme references (sounds), for the backend to load. */
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

/** Objects merge key by key; arrays and scalars replace whole (same rule as enhanced-achievements). */
export function merge(base: Json, override: Json): Json {
    const out: Json = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const prev = out[key];
        out[key] = isObject(prev) && isObject(value) ? merge(prev, value) : value;
    }
    return out;
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

function resolveStyle(raw: Json, where: string, warnings: string[]): ResolvedStyle {
    const popup = isObject(raw.popup) ? raw.popup : {};
    const text = isObject(raw.text) ? raw.text : {};
    const logo = isObject(raw.logo) ? raw.logo : {};

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
        warnings.push(`${where}.sound must be ["path", volume] or false; keeping Steam's sound.`);
    }

    if (raw.font_family !== undefined && fontFamily(raw.font_family) === null) {
        warnings.push(`${where}.font_family is not a plain font name; ignored.`);
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
        logo: { visible: bool(logo.visible), radius: num(logo.radius, 0, 100) ?? null },
        headerIcon: bool(raw.header_icon),
        sound,
        displayTimeMs: num(raw.display_time_ms, 1000, 60_000) ?? null,
    };
}

/**
 * Validate a theme file. Throws only when it is unusable (not an object);
 * everything else is a warning plus "keep Steam's own".
 */
export function resolveTheme(raw: unknown): ResolvedTheme {
    if (!isObject(raw)) throw new Error('Theme must be a JSON object.');
    const warnings: string[] = [];
    const base = isObject(raw.default) ? raw.default : {};
    const categories = isObject(raw.categories) ? raw.categories : {};
    const types = isObject(raw.types) ? raw.types : {};

    for (const name of Object.keys(categories)) {
        if (!(CATEGORIES as readonly string[]).includes(name)) warnings.push(`categories.${name} is not a category (${CATEGORIES.join(', ')}); ignored.`);
    }

    const cache = new Map<string, ResolvedStyle>();
    const styleFor = (typeName: string): ResolvedStyle => {
        let style = cache.get(typeName);
        if (!style) {
            const cat = categories[categoryOf(typeName)];
            const own = types[typeName];
            const merged = merge(merge(base, isObject(cat) ? cat : {}), isObject(own) ? own : {});
            style = resolveStyle(merged, `types.${typeName}`, quiet); // already validated above
            cache.set(typeName, style);
        }
        return style;
    };

    // Validate every block once now, so all warnings exist at load time (the
    // per-type styles below resolve lazily and would otherwise warn late).
    resolveStyle(base, 'default', warnings);
    for (const [name, block] of Object.entries(categories)) if (isObject(block)) resolveStyle(block, `categories.${name}`, warnings);
    for (const [name, block] of Object.entries(types)) if (isObject(block)) resolveStyle(block, `types.${name}`, warnings);
    const quiet: string[] = [];

    // Sounds referenced anywhere, so the backend can load them up front.
    const assetPaths = new Set<string>();
    for (const block of [base, ...Object.values(categories), ...Object.values(types)]) {
        if (isObject(block) && Array.isArray(block.sound) && typeof block.sound[0] === 'string' && block.sound[0]) assetPaths.add(block.sound[0]);
    }

    return { styleFor, assetPaths: [...assetPaths], warnings };
}

// --- CSS generation -------------------------------------------------------------------

/** Steam's default font sizes for the three text parts (px), which size_pct scales. */
const BASE_PX = { title: 11, body: 12, subtext: 11 };

function textRule(sel: string | undefined, root: string, t: TextStyle, basePx: number): string {
    if (!sel) return '';
    const decls = [
        t.color ? `color: ${t.color} !important;` : '',
        t.sizePct !== null && t.sizePct !== 100 ? `font-size: ${((basePx * t.sizePct) / 100).toFixed(1)}px !important;` : '',
        t.style === 'bold' ? 'font-weight: 700 !important;' : t.style === 'regular' ? 'font-weight: 400 !important;' : '',
        t.style === 'italic' ? 'font-style: italic !important;' : '',
    ].join('');
    return decls ? `${root} ${sel} { ${decls} }\n` : '';
}

/**
 * Scoped CSS for one notification type. Every rule starts with
 * `body[data-en-type="<type>"]`, the attribute the injector sets on a toast
 * window while it shows that type (surfaces/style/injector.ts), so nothing can match
 * any other toast or any non-toast window. Returns '' when the style is all stock.
 */
export function buildCss(typeName: string, s: ResolvedStyle, sel: ToastSelectors): string {
    const root = `body[data-en-type="${typeName.replace(/[^\w-]/g, '')}"]`;
    const popup = [sel.desktopPopup, sel.gamepadPopup].filter(Boolean).map((p) => `${root} ${p}`).join(', ');
    let css = '';

    const popupDecls: string[] = [];
    if (s.background) {
        const bg = s.background.length > 1 ? `linear-gradient(${s.gradientAngle}deg, ${s.background.join(', ')})` : s.background[0];
        popupDecls.push(`background: ${bg} !important;`);
        // Big Picture paints its background on the template, not the popup.
        if (sel.shortTemplate) css += `${root} ${sel.shortTemplate} { background: transparent !important; }\n`;
    }
    if (s.border) {
        popupDecls.push(
            s.border.width > 0 ? `border: ${s.border.width}px solid ${s.border.color} !important;` : 'border: none !important;',
            `border-radius: ${s.border.radius}px !important;`,
            'overflow: hidden !important;',
        );
    }
    if (s.glow && s.glow.spread > 0) {
        popupDecls.push(`box-shadow: inset 0 0 ${s.glow.spread}px ${s.glow.color} !important;`);
        if (s.glow.pulseMs > 0) {
            const name = `en-pulse-${typeName.replace(/[^\w-]/g, '')}`;
            css += `@keyframes ${name} { from { box-shadow: inset 0 0 0 ${s.glow.color}; } to { box-shadow: inset 0 0 ${s.glow.spread}px ${s.glow.color}; } }\n`;
            popupDecls.push(`animation: ${name} ${s.glow.pulseMs}ms ease-in-out infinite alternate;`);
        }
    }
    if (s.fontFamily) popupDecls.push(`font-family: ${s.fontFamily} !important;`);
    if (popup && popupDecls.length) css += `${popup} { ${popupDecls.join(' ')} }\n`;
    if (s.fontFamily && sel.templates) css += `${root} ${sel.templates}, ${root} ${sel.templates} * { font-family: ${s.fontFamily} !important; }\n`;

    if (s.watermark === false && sel.watermark) css += `${root} ${sel.watermark} { display: none !important; }\n`;

    css += textRule(sel.title, root, s.text.title, BASE_PX.title);
    css += textRule(sel.body, root, s.text.body, BASE_PX.body);
    css += textRule(sel.subtext, root, s.text.subtext, BASE_PX.subtext);

    if (s.logo.visible === false && sel.logoBox) css += `${root} ${sel.logoBox} { display: none !important; }\n`;
    if (s.logo.radius !== null && sel.appLogo) {
        css += `${root} ${sel.appLogo}, ${root} ${sel.appLogo} img { border-radius: ${s.logo.radius}px !important; overflow: hidden; }\n`;
    }
    if (s.headerIcon === false && sel.headerIcon) css += `${root} ${sel.headerIcon} { display: none !important; }\n`;

    return css;
}
