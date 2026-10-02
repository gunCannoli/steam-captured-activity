import { notificationStore, typeName } from '../../steam/notification-store';
import { activeTheme, themeStyle } from '../../theme/active-theme';
import { animatedOffset, placeToast, stackOffset, steamCorner, STEAM_TOAST_HEIGHT, STEAM_TOAST_WIDTH, type Corner } from '../../theme/placement';
import { isEnabled, reportError } from '../../safety/runtime';

/**
 * One desktop or in-game overlay toast popup: which notification it shows, and where it goes.
 *
 * Steam opens one popup per toast there and moves it every frame of its slide in, slide out and restack through the
 * popup's own `SteamClient.Window.MoveTo` (an own, writable property; verified live 2026-09-25 and 2026-10-01, see
 * docs/steam-components.md § Desktop toast stack). This replaces that one property on that one popup, so nothing
 * global is patched and the popup takes the wrapper with it when it closes:
 *
 * - **Type.** By Steam's first `MoveTo` the popup has rendered its toast, and the notification is a prop on a fiber
 *   above its content (verified live: `eType` readable at the first call). Read once, bounded, then cached; the
 *   style surface then gives this window its own `data-en-type` (desktop shows several toasts at once, so one shared
 *   "current toast" would restyle the older ones).
 * - **Place.** With the theme's `position`, `popup.margin` or `animation`, each of Steam's moves is
 *   remapped from Steam's corner to the theme's (theme/placement.ts), so Steam keeps its timing and stacking.
 *
 * Passed through untouched: a toast the achievement banner draws (`bannerDraws`: the banner pins that popup itself,
 * ../banner/window-pin.ts, wrapping this wrapper, and its pin calls it with its own position), feature `placement`
 * off, no theme (Steam default), or any error.
 * Every call is O(1) once the type is known: map lookups and arithmetic (docs/plugins.md guardrail 2).
 */

type MoveTo = (x: number, y: number, dpi?: unknown) => void;
interface WindowApi {
    MoveTo: MoveTo;
}

interface Fiber {
    return: Fiber | null;
    memoizedProps?: { notification?: { eType?: unknown } } | null;
}

/** Per-toast popups on desktop (`_desktop`) and in the in-game overlay (`uid…-…`); never Big Picture's one popup. */
const PER_TOAST_POPUP = /^notificationtoasts_(\d+_desktop|uid\d+-\d+)$/;
/** Moves to try reading the type on before giving up (the toast is rendered by the first one, verified live). */
const TYPE_TRIES = 30;

export function isPerToastPopup(win: Window): boolean {
    return PER_TOAST_POPUP.test(win.name);
}

/** The notification type this toast window renders, from its React fibers; bounded, so a shape change gives null. */
function readType(win: Window): number | null {
    const elements = win.document?.body?.querySelectorAll('*');
    if (!elements) return null;
    for (let i = 0; i < elements.length && i < 60; i++) {
        const el = elements[i]!;
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        let fiber: Fiber | null = key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
        for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
            const eType = fiber.memoizedProps?.notification?.eType;
            if (typeof eType === 'number') return eType;
        }
    }
    return null;
}

/** The type's toast duration as Steam will use it (Steam: `toastDurationMS || 5e3`). */
export function displayMsFor(eType: number): number {
    return notificationStore()?.configs.get(eType)?.config.toastDurationMS || 5000;
}

interface Attached {
    api: WindowApi;
    original: MoveTo;
    wrapper: MoveTo;
}

const attached = new Map<Window, Attached>();

/**
 * Wrap one per-toast popup's `MoveTo`. `onType` gets the popup's notification type once it is known. false when `win`
 * is not a per-toast popup or has no own `MoveTo`; the caller then styles it as a shared toast window.
 */
export function attachToastWindow(win: Window, onType: (win: Window, eType: number) => void, bannerDraws: (eType: number) => boolean): boolean {
    if (attached.has(win)) return true;
    if (!isPerToastPopup(win)) return false;
    const api = (win as unknown as { SteamClient?: { Window?: WindowApi } }).SteamClient?.Window;
    if (!api || typeof api.MoveTo !== 'function') return false;

    const original = api.MoveTo;
    let eType: number | null = null;
    let tries = 0;
    let corner: Corner | null = null;
    let startedAt = 0;
    let lastOffset: number | null = null;

    const place = (x: number, y: number): { x: number; y: number } | null => {
        if (eType === null || !isEnabled('placement') || bannerDraws(eType)) return null;
        const theme = activeTheme()?.theme;
        if (!theme || !typeName(eType)) return null;
        const margin = themeStyle()?.margin ?? null;
        if (!theme.position && !margin && !theme.animation) return null;

        const screen = win.screen as Screen & { availLeft?: number; availTop?: number };
        const avail = { left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight };
        const size = { width: STEAM_TOAST_WIDTH, height: win.innerHeight > 0 ? win.innerHeight : STEAM_TOAST_HEIGHT };
        corner ??= steamCorner(x, y, size, avail);
        let offset = stackOffset(corner, y, size.height, avail);
        if (theme.animation) offset = animatedOffset(offset, performance.now() - startedAt, displayMsFor(eType), lastOffset);
        lastOffset = offset;
        return placeToast(theme.position ?? corner, margin ?? { top: 0, bottom: 0, left: 0, right: 0 }, offset, size, avail);
    };

    const wrapper: MoveTo = function (this: unknown, x, y, dpi) {
        // Detached while another plugin's wrapper still calls us: stay in its chain, passing through.
        if (attached.get(win)?.wrapper !== wrapper) return original.call(api, x, y, dpi);
        let at: { x: number; y: number } | null = null;
        try {
            if (!startedAt) startedAt = performance.now();
            if (eType === null && tries < TYPE_TRIES) {
                tries++;
                eType = readType(win);
                if (eType !== null) onType(win, eType);
            }
            at = place(x, y);
        } catch (error) {
            reportError('placement', error);
            at = null;
        }
        return at ? original.call(api, at.x, at.y, dpi) : original.call(api, x, y, dpi);
    };

    api.MoveTo = wrapper;
    attached.set(win, { api, original, wrapper });
    return true;
}

/** Forget closed popups (called as new ones open, so the map never grows). */
export function pruneToastWindows(): void {
    for (const win of attached.keys()) if (win.closed) attached.delete(win);
}

/** Put Steam's `MoveTo` back on every open popup we wrapped (only where ours is still the outermost). Idempotent. */
export function detachToastWindows(): void {
    for (const [win, a] of attached) {
        try {
            if (!win.closed && a.api.MoveTo === a.wrapper) a.api.MoveTo = a.original;
        } catch {
            /* a window going away mid-cleanup is fine */
        }
    }
    attached.clear();
}
