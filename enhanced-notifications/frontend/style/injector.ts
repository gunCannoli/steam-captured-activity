import { logger } from '../logger';
import { setting, onSettingChange } from '../settings/settings';
import { handles, knownTypeNames, onToastShown, typeName } from '../steam/notifications';
import { activeTheme, cssFor, onThemeChange } from '../theme/active-theme';

/**
 * Styles Steam's toast windows without touching React.
 *
 * - One `<style>` per toast window holds the CSS for every type the theme styles.
 *   Each rule is scoped to `body[data-en-type="<Type>"]`.
 * - While a toast shows, its window's `<body>` carries `data-en-type` = the
 *   notification's Steam type name. The type comes from two Steam signals: the
 *   "toast shown" call every toast container makes (steam/notifications.ts,
 *   onToastShown; desktop popups only have this one) and NotificationStore's
 *   current-toast value (Big Picture). No attribute means no rule matches, so
 *   the toast stays stock.
 *
 * Toast windows come from two different sources, per mode
 * (fixed and verified live 2026-09-24, see docs/steam-components.md § Toast windows):
 * - Desktop and the in-game overlay: Steam opens one popup per notification
 *   through its popup manager, so `Millennium.AddWindowCreateHook` sees it.
 * - Big Picture: one persistent BrowserView popup, created via
 *   `SteamClient.BrowserView.CreatePopup` + `window.open` and never registered
 *   with the popup manager. It is instead reached from the
 *   `GamepadToastPlaceholder` div Steam renders into the (popup-manager-visible)
 *   Big Picture main window: a few `.return` steps up that div's React fiber, a
 *   hook holds the BrowserView popup object, whose `GetViewWindow()` is the
 *   toast window. Scanned once per toast shown, no new timers.
 *
 * Why not wrap the dispatcher element through react/jsx-runtime, as
 * enhanced-achievements does? Verified live 2026-09-24: for these toasts the
 * wrapped element was not the one React committed. This approach needs no
 * React interception at all, which is also less risky.
 */

interface Popup {
    m_strName?: string;
    window?: Window;
}

interface CurrentToast {
    eType?: number;
}

interface Subscribable<T> {
    Value?: T;
    m_currentValue?: T;
    Subscribe(cb: (value: T) => void): { Unsubscribe(): void };
}

/** A React fiber, narrowly typed to the fields the placeholder walk touches. */
interface Fiber {
    return: Fiber | null;
    memoizedState: Hook | null;
}

interface Hook {
    memoizedState: unknown;
    next: Hook | null;
}

/** Big Picture's persistent toast popup object, found via the placeholder fiber walk. */
interface BrowserViewPopup {
    GetViewWindow(): Window | undefined;
    GetRenderElement(): Element | undefined;
}

const STYLE_ID = 'enhanced-notifications-theme';
const toastWindows = new Set<Window>();
let themeCss = '';
let currentType: string | null = null;
let placeholderSelector: string | undefined;

/** Every styled type's CSS, built once per theme load (cssFor caches per type). */
function buildThemeCss(): string {
    if (!activeTheme()) return '';
    return knownTypeNames().map(cssFor).filter(Boolean).join('\n');
}

function applyStyle(win: Window): void {
    const doc = win.document;
    if (!doc?.head) return;
    let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = doc.createElement('style');
        el.id = STYLE_ID;
        doc.head.appendChild(el);
    }
    if (el.textContent !== themeCss) el.textContent = themeCss;
}

function applyType(win: Window): void {
    const body = win.document?.body;
    if (!body) return;
    if (currentType) body.setAttribute('data-en-type', currentType);
    else body.removeAttribute('data-en-type');
}

function forEachToastWindow(fn: (win: Window) => void): void {
    for (const win of toastWindows) {
        if (win.closed) {
            toastWindows.delete(win);
            continue;
        }
        try {
            fn(win);
        } catch (error) {
            logger.warn('Could not update a toast window:', error);
        }
    }
}

function track(win: Window | undefined | null): void {
    if (!win) return;
    if (!toastWindows.has(win)) {
        toastWindows.add(win);
        applyStyle(win);
    }
    applyType(win);
}

function onPopup(popup: Popup): void {
    const win = popup?.window;
    if (!win || !/notificationtoasts/i.test(popup.m_strName ?? '')) return;
    track(win);
}

/**
 * Walk up a `GamepadToastPlaceholder` element's React fiber looking for a hook
 * whose state is Big Picture's `BrowserViewPopup` object (duck-typed on Steam's
 * method names, never a minified identifier). Verified live: two `.return`
 * hops, hook 0. Bounded so a shape change degrades to "not found", never a hang.
 */
function viewWindowFromFiber(el: Element): Window | null {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let fiber: Fiber | null = key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
    for (let depth = 0; fiber && depth < 4; depth++, fiber = fiber.return) {
        for (let hook = fiber.memoizedState, i = 0; hook && i < 16; hook = hook.next, i++) {
            const v = hook.memoizedState as Partial<BrowserViewPopup> | null;
            if (v && typeof v.GetViewWindow === 'function' && typeof v.GetRenderElement === 'function') {
                return v.GetViewWindow() ?? null;
            }
        }
    }
    return null;
}

/**
 * Find Big Picture's persistent toast window: not in `g_PopupManager` itself,
 * so it is reached via the `GamepadToastPlaceholder` div Steam renders into
 * windows that ARE in the popup manager (the Big Picture main window). Runs
 * once per toast shown, no new timers.
 */
function scanBigPictureToastWindows(): void {
    if (!placeholderSelector) return;
    const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<Popup> } | undefined;
    try {
        for (const popup of manager?.GetPopups?.() ?? []) {
            const doc = popup.window?.document;
            if (!doc) continue;
            for (const el of doc.querySelectorAll(placeholderSelector)) {
                const win = viewWindowFromFiber(el);
                if (win && !win.closed && /^notificationtoasts/i.test(win.name)) track(win);
            }
        }
    } catch (error) {
        logger.warn('Could not scan for Big Picture toast windows:', error);
    }
}

/** Decide which type (if any) the current toast should be styled as. */
function onCurrentToast(toast: CurrentToast | null | undefined): void {
    const eType = toast?.eType;
    const name = typeName(eType);
    currentType =
        name && setting('style.enabled') && activeTheme() && handles(eType!, 'banner') && cssFor(name) !== '' ? name : null;
    scanBigPictureToastWindows();
    forEachToastWindow(applyType);
}

function refresh(): void {
    themeCss = buildThemeCss();
    forEachToastWindow(applyStyle);
    scanBigPictureToastWindows();
    const store = Reflect.get(globalThis, 'NotificationStore') as { CurrentToastSubscribableValue?: Subscribable<CurrentToast> } | undefined;
    const value = store?.CurrentToastSubscribableValue;
    onCurrentToast(value?.Value ?? value?.m_currentValue ?? null);
}

export function initInjector(placeholder?: string): boolean {
    const store = Reflect.get(globalThis, 'NotificationStore') as { CurrentToastSubscribableValue?: Subscribable<CurrentToast> } | undefined;
    const current = store?.CurrentToastSubscribableValue;
    const millennium = Reflect.get(globalThis, 'Millennium') as { AddWindowCreateHook?: (cb: (popup: Popup) => void) => void } | undefined;
    if (!current?.Subscribe || typeof millennium?.AddWindowCreateHook !== 'function') {
        logger.warn('Current-toast value or window hook unavailable; styling disabled.');
        return false;
    }

    placeholderSelector = placeholder;
    themeCss = buildThemeCss();
    current.Subscribe((toast) => toast && onCurrentToast(toast));
    onToastShown((eType) => onCurrentToast({ eType }));
    millennium.AddWindowCreateHook(onPopup); // existing popups now, and every new one
    scanBigPictureToastWindows(); // style already in place before the first Big Picture toast
    onThemeChange(refresh);
    onSettingChange((key) => key === 'style.enabled' && refresh());
    logger.info('Toast styling installed.');
    return true;
}
