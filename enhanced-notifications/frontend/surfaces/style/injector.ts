import { logger } from '../../logger';
import { setting, onSettingChange } from '../../settings/settings';
import { typeName } from '../../steam/notification-store';
import { handles } from '../../steam/coexistence';
import type { NotificationHook } from '../../steam/notification-hook';
import { activeTheme, animationCss, onThemeChange, themeCss, themeStyle } from '../../theme/active-theme';
import { buildPlaceholderCss } from '../../theme/theme';
import { isEnabled, reportError } from '../../safety/runtime';
import { attachToastWindow, detachToastWindows, displayMsFor, pruneToastWindows } from './toast-window';
import { bpLog, bpTracing, setManualTypeSink, typeSource } from './bp-debug';
import { installToastPop } from '../../steam/toast-pop';
import { takesSignal, type TypeSignal } from './type-source';

/**
 * Styles Steam's toast windows without touching React.
 *
 * - One `<style>` per toast window holds the CSS for every type the theme styles.
 *   Each rule is scoped to `body[data-en-type="<Type>"]`.
 * - While a toast shows, its window's `<body>` carries `data-en-type` = the
 *   notification's Steam type name. The type comes from the moment Steam hands
 *   the toast to a toast view (`PopNextToastNotification`, steam/toast-pop.ts),
 *   before it renders; without that method, from the shared hook's `onShown`
 *   (steam/notification-hook.ts), a frame late. Never from NotificationStore's
 *   current-toast value: it changes when a toast arrives, so a queued toast
 *   restyled the one on screen (./type-source.ts). No attribute means no rule
 *   matches, so the toast stays stock.
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
 * Desktop shows several toasts at once, so each per-toast popup gets its own type
 * as soon as it is known (./toast-window.ts reads it at Steam's first move of that
 * popup, and also places the popup); until then, and for Big Picture's one
 * window, the current toast's type is used. A per-toast window also carries
 * `--en-display-ms`, its type's toast duration, which times a theme's exit animation.
 *
 * Why not wrap the dispatcher element through react/jsx-runtime, as
 * enhanced-achievements does? Verified live 2026-09-24: for these toasts the
 * wrapped element was not the one React committed. This approach needs no
 * React interception at all, which is also less risky.
 *
 * Kill switch `style` (safety/features.ts): switched off, no toast gets the
 * attribute (so no rule matches) and uninstall removes what was written.
 * `Millennium.AddWindowCreateHook` cannot be removed, so its callback checks
 * `installed` first.
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
/** In the Big Picture window: the toast placeholder's position (theme `position` / `popup.margin`). */
const PLACEMENT_ID = 'enhanced-notifications-placement';
/** Big Picture windows holding a toast placeholder, for the placement `<style>`. */
const placeholderDocs = new Set<Document>();
const toastWindows = new Set<Window>();
/** Per-toast popups whose own notification type is known (./toast-window.ts). */
const ownTypes = new Map<Window, number>();
let windowCss = '';
let currentType: string | null = null;
/** The eType behind `currentType`, so a theme or setting refresh keeps a debug type source's choice (./bp-debug.ts). */
let currentEType: number | undefined;
let placeholderSelector: string | undefined;
let installed = false;
/** Steam has `PopNextToastNotification` and it is wrapped (steam/toast-pop.ts); false: the type follows `onShown`. */
let popAvailable = false;
/** Registered once: Millennium has no way to remove a window-create hook. */
let windowHookAdded = false;
let offs: (() => void)[] = [];

/** The theme's CSS and its animation, each built once per theme load. */
function buildThemeCss(): string {
    if (!activeTheme()) return '';
    return [animationCss(), themeCss()].filter(Boolean).join('\n');
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
    if (el.textContent !== windowCss) el.textContent = windowCss;
}

/** The type name to mark a toast of `eType` with, or null to leave it stock. O(1) (the CSS is cached per theme). */
function styledName(eType: number | undefined): string | null {
    const name = typeName(eType);
    if (!name || !isEnabled('style') || !setting('style.enabled') || !activeTheme() || !handles(eType!, 'banner')) return null;
    return themeCss() !== '' || animationCss() !== '' ? name : null;
}

function applyType(win: Window): void {
    const body = win.document?.body;
    if (!body) return;
    const own = ownTypes.get(win);
    const type = own === undefined ? currentType : styledName(own);
    if (bpTracing() && own === undefined && body.getAttribute('data-en-type') !== type) {
        bpLog('attr', { win: win.name, from: body.getAttribute('data-en-type'), to: type });
    }
    if (type) body.setAttribute('data-en-type', type);
    else body.removeAttribute('data-en-type');
    if (own !== undefined) body.style.setProperty('--en-display-ms', `${displayMsFor(own)}ms`);
}

/** ./toast-window.ts read a per-toast popup's own notification type. */
function onWindowType(win: Window, eType: number): void {
    if (!installed || win.closed) return;
    ownTypes.set(win, eType);
    try {
        applyType(win);
    } catch (error) {
        reportError('style', error);
    }
}

function forEachToastWindow(fn: (win: Window) => void): void {
    for (const win of toastWindows) {
        if (win.closed) {
            toastWindows.delete(win);
            ownTypes.delete(win);
            continue;
        }
        try {
            fn(win);
        } catch (error) {
            reportError('style', error);
        }
    }
}

function track(win: Window | undefined | null): void {
    if (!win) return;
    if (!toastWindows.has(win)) {
        toastWindows.add(win);
        applyStyle(win);
        attachToastWindow(win, onWindowType);
    }
    applyType(win);
}

function onPopup(popup: Popup): void {
    if (!installed) return;
    const win = popup?.window;
    if (!win || !/notificationtoasts/i.test(popup.m_strName ?? '')) return;
    pruneToastWindows();
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
/** The placeholder CSS for the current theme and switches ('' = Steam's place). */
function placementCss(): string {
    const theme = activeTheme()?.theme;
    if (!theme || !isEnabled('placement') || !isEnabled('style') || !setting('style.enabled')) return '';
    return buildPlaceholderCss(theme.position, themeStyle()?.margin ?? null, placeholderSelector);
}

/** Big Picture's toast position: one `<style>` in the window that holds the placeholder (theme/theme.ts buildPlaceholderCss). */
function applyPlacement(doc: Document): void {
    placeholderDocs.add(doc);
    const css = placementCss();
    let el = doc.getElementById(PLACEMENT_ID) as HTMLStyleElement | null;
    if (!css) {
        if (el) bpLog('placement', { action: 'removed' });
        el?.remove();
        return;
    }
    if (!el) {
        el = doc.createElement('style');
        el.id = PLACEMENT_ID;
        doc.head.appendChild(el);
    }
    if (el.textContent !== css) {
        bpLog('placement', { action: el.textContent ? 'changed' : 'added', css });
        el.textContent = css;
    }
}

function scanBigPictureToastWindows(): void {
    if (!placeholderSelector) return;
    const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<Popup> } | undefined;
    try {
        for (const popup of manager?.GetPopups?.() ?? []) {
            const doc = popup.window?.document;
            if (!doc) continue;
            const placeholders = doc.querySelectorAll(placeholderSelector);
            if (placeholders.length && doc.head) {
                try {
                    applyPlacement(doc);
                } catch (error) {
                    reportError('placement', error);
                }
            }
            for (const el of placeholders) {
                const win = viewWindowFromFiber(el);
                if (bpTracing()) bpLog('scan', { doc: doc.title, view: win?.name ?? null, placeholderDisplay: popup.window?.getComputedStyle(el).display });
                if (win && !win.closed && /^notificationtoasts/i.test(win.name)) track(win);
            }
        }
    } catch (error) {
        reportError('style', error);
    }
}

/** Decide which type (if any) the current toast should be styled as. */
function onCurrentToast(toast: CurrentToast | null | undefined, signal: TypeSignal = 'refresh'): void {
    if (!installed) return;
    const used = takesSignal(typeSource(), signal, popAvailable);
    bpLog(signal, { eType: toast?.eType ?? null, used });
    if (!used) return;
    currentEType = toast?.eType;
    currentType = styledName(toast?.eType);
    scanBigPictureToastWindows();
    forEachToastWindow(applyType);
}

function refresh(): void {
    windowCss = buildThemeCss();
    forEachToastWindow(applyStyle);
    scanBigPictureToastWindows();
    const store = Reflect.get(globalThis, 'NotificationStore') as { CurrentToastSubscribableValue?: Subscribable<CurrentToast> } | undefined;
    const value = store?.CurrentToastSubscribableValue;
    if (typeSource() === 'arrival') onCurrentToast(value?.Value ?? value?.m_currentValue ?? null);
    else onCurrentToast(currentEType === undefined ? null : { eType: currentEType });
}

/** false: Steam lacks the NotificationStore or Millennium the window hook; toasts stay stock. */
export function installInjector(placeholder: string | undefined, onShown: NotificationHook['onShown']): boolean {
    const store = Reflect.get(globalThis, 'NotificationStore') as (object & { CurrentToastSubscribableValue?: Subscribable<CurrentToast> }) | undefined;
    const millennium = Reflect.get(globalThis, 'Millennium') as { AddWindowCreateHook?: (cb: (popup: Popup) => void) => void } | undefined;
    if (!store || typeof millennium?.AddWindowCreateHook !== 'function') {
        logger.warn('NotificationStore or window hook unavailable; styling disabled.');
        return false;
    }

    installed = true;
    placeholderSelector = placeholder;
    windowCss = buildThemeCss();
    const unpop = installToastPop(store, (n) => onCurrentToast(n, 'pop'), (error) => reportError('style', error));
    popAvailable = unpop !== null;
    if (!popAvailable) logger.warn('PopNextToastNotification unavailable; the toast type follows onShown, a frame late.');
    // Arrivals are read only for the debug trace and the `arrival` debug source (./type-source.ts).
    const subscription = store.CurrentToastSubscribableValue?.Subscribe?.((toast) => toast && onCurrentToast(toast, 'arrival'));
    setManualTypeSink((eType) => onCurrentToast(eType === null ? null : { eType }, 'manual'));
    offs = [
        () => unpop?.(),
        () => subscription?.Unsubscribe(),
        onShown((n) => {
            if (typeof n?.eType === 'number') onCurrentToast(n, 'shown');
        }),
        onThemeChange(refresh),
        onSettingChange((key) => {
            if (key === 'style.enabled' || key === 'disabledFeatures') refresh();
        }),
    ];
    if (!windowHookAdded) {
        windowHookAdded = true;
        millennium.AddWindowCreateHook(onPopup); // existing popups now, and every new one
    }
    scanBigPictureToastWindows(); // style already in place before the first Big Picture toast
    logger.info('Toast styling installed.');
    return true;
}

/** Stop styling and remove our `<style>` and attribute from every toast window. Idempotent. */
export function uninstallInjector(): void {
    installed = false;
    for (const off of offs) {
        try {
            off();
        } catch {
            /* one failed unsubscribe must not keep the rest */
        }
    }
    offs = [];
    setManualTypeSink(null);
    popAvailable = false;
    currentType = null;
    currentEType = undefined;
    detachToastWindows();
    ownTypes.clear();
    for (const doc of placeholderDocs) {
        try {
            doc.getElementById(PLACEMENT_ID)?.remove();
        } catch {
            /* a window going away mid-cleanup is fine */
        }
    }
    placeholderDocs.clear();
    for (const win of toastWindows) {
        try {
            if (win.closed) continue;
            win.document?.getElementById(STYLE_ID)?.remove();
            win.document?.body?.removeAttribute('data-en-type');
            win.document?.body?.style.removeProperty('--en-display-ms');
        } catch {
            /* a window going away mid-cleanup is fine */
        }
    }
    toastWindows.clear();
}
