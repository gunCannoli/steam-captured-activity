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
 * Why not wrap the dispatcher element through react/jsx-runtime, as
 * enhanced-achievements does? Verified live 2026-09-24: for these toasts the
 * wrapped element was not the one React committed (see
 * docs/enhanced-notifications-plan.md § 3). This approach needs no React
 * interception at all, which is also less risky.
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

const STYLE_ID = 'enhanced-notifications-theme';
const toastWindows = new Set<Window>();
let themeCss = '';
let currentType: string | null = null;

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

function onPopup(popup: Popup): void {
    const win = popup?.window;
    if (!win || !/notificationtoasts/i.test(popup.m_strName ?? '')) return;
    if (!toastWindows.has(win)) {
        toastWindows.add(win);
        applyStyle(win);
    }
    applyType(win);
}

/**
 * Pick up toast windows the create hook could not: Big Picture's toast popup is
 * created when Big Picture opens, before it has a `window`. Runs once per toast
 * shown (a handful of popups), never on a hot path.
 */
function scanPopups(): void {
    const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<Popup> } | undefined;
    try {
        for (const popup of manager?.GetPopups?.() ?? []) onPopup(popup);
    } catch (error) {
        logger.warn('Could not scan popups:', error);
    }
}

/** Decide which type (if any) the current toast should be styled as. */
function onCurrentToast(toast: CurrentToast | null | undefined): void {
    const eType = toast?.eType;
    const name = typeName(eType);
    currentType =
        name && setting('style.enabled') && activeTheme() && handles(eType!, 'banner') && cssFor(name) !== '' ? name : null;
    scanPopups();
    forEachToastWindow(applyType);
}

function refresh(): void {
    themeCss = buildThemeCss();
    forEachToastWindow(applyStyle);
    const store = Reflect.get(globalThis, 'NotificationStore') as { CurrentToastSubscribableValue?: Subscribable<CurrentToast> } | undefined;
    const value = store?.CurrentToastSubscribableValue;
    onCurrentToast(value?.Value ?? value?.m_currentValue ?? null);
}

export function initInjector(): boolean {
    const store = Reflect.get(globalThis, 'NotificationStore') as { CurrentToastSubscribableValue?: Subscribable<CurrentToast> } | undefined;
    const current = store?.CurrentToastSubscribableValue;
    const millennium = Reflect.get(globalThis, 'Millennium') as { AddWindowCreateHook?: (cb: (popup: Popup) => void) => void } | undefined;
    if (!current?.Subscribe || typeof millennium?.AddWindowCreateHook !== 'function') {
        logger.warn('Current-toast value or window hook unavailable; styling disabled.');
        return false;
    }

    themeCss = buildThemeCss();
    current.Subscribe((toast) => toast && onCurrentToast(toast));
    onToastShown((eType) => onCurrentToast({ eType }));
    millennium.AddWindowCreateHook(onPopup); // existing popups now, and every new one
    onThemeChange(refresh);
    onSettingChange((key) => key === 'style.enabled' && refresh());
    logger.info('Toast styling installed.');
    return true;
}
