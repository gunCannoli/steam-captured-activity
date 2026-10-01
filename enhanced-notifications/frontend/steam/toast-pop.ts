/**
 * The moment Steam hands a toast to a toast view: `NotificationStore.PopNextToastNotification(context)`. Every toast
 * container (Big Picture, desktop, in-game overlay) calls it inside a React state updater, so before that toast
 * renders (verified live 2026-10-01, docs/steam-components.md § Big Picture toast view).
 *
 * Wrapped as an own property of the store instance, nothing global. The wrapper calls what the store resolved
 * before it (an own property someone else set, or else the prototype's method looked up at call time, so a later
 * prototype wrapper still runs) and returns its value unchanged. `onPop` sees only real toasts (a non-null object)
 * and cannot break Steam's pop: its error goes to `reportError`. Pure (no imports), so `npm test` checks it.
 *
 * Shared, identical, by enhanced-notifications (the type of the toast on screen) and enhanced-achievements (its
 * forced Big Picture position): each architecture test fails when the copies differ. Whichever plugin installs second
 * wraps the first one's own property, so both listeners run on every pop, in either load order.
 */
type PopFn = (this: unknown, ...args: unknown[]) => unknown;

const KEY = 'PopNextToastNotification';

/** Returns an uninstall function, or null when Steam has no such method (the caller falls back to `onShown`). */
export function installToastPop(store: object, onPop: (notification: { eType?: number }) => void, reportError: (error: unknown) => void): (() => void) | null {
    const target = store as Record<string, unknown>;
    if (typeof target[KEY] !== 'function') return null;
    const own = Object.prototype.hasOwnProperty.call(store, KEY) ? (target[KEY] as PopFn) : null;
    let active = true;
    const wrapper: PopFn = function (this: unknown, ...args: unknown[]) {
        const next = own ?? ((Object.getPrototypeOf(store) as Record<string, unknown>)[KEY] as PopFn);
        const n = next.apply(this, args);
        if (active && n && typeof n === 'object') {
            try {
                onPop(n as { eType?: number });
            } catch (error) {
                reportError(error);
            }
        }
        return n;
    };
    target[KEY] = wrapper;
    return () => {
        active = false;
        if (target[KEY] !== wrapper) return; // someone wrapped on top of us: stay in the chain, passing through
        if (own) target[KEY] = own;
        else delete target[KEY];
    };
}
