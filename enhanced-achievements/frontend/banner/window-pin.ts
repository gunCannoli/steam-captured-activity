import { logger } from '../logger';

/**
 * Pins one desktop / in-game overlay toast popup to our computed position.
 *
 * Steam's toast stack moves every toast popup each frame of its fade-in and
 * fade-out, anchored with its own position setting and a fixed 283 px width
 * (docs/plans/enhanced-achievements-banner-geometry-fix.md § 2.1). Instead of
 * racing it, this replaces **that popup's own** `SteamClient.Window.MoveTo`
 * (an own, writable property; verified live) so Steam keeps the timing and we
 * decide the place. Nothing global is patched, and the popup is destroyed with the toast.
 *
 * Big Picture's single persistent toast popup is never pinned (§ 3.4).
 */

type MoveTo = (x: number, y: number, dpi?: number | boolean) => void;
interface WindowApi {
    MoveTo: MoveTo;
    ResizeTo(width: number, height: number, applyBrowserScale: boolean): void;
}

const PER_TOAST_POPUP = /^notificationtoasts_(\d+_desktop|uid\d+-\d+)$/;

/** Live pinned popups by stack slot; `null` is a free slot. */
const slots: (Window | null)[] = [];

export interface PinTarget {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Returns an unpin function, or null when this window is not a per-toast popup. */
export function pinToastWindow(win: Window, targetFor: (slot: number) => PinTarget): (() => void) | null {
    if (!PER_TOAST_POPUP.test(win.name)) return null;
    const api = (win as unknown as { SteamClient?: { Window?: WindowApi } }).SteamClient?.Window;
    if (!api || typeof api.MoveTo !== 'function' || typeof api.ResizeTo !== 'function') return null;

    let slot = slots.indexOf(null);
    if (slot < 0) slot = slots.length;
    slots[slot] = win;

    const target = targetFor(slot);
    const original = api.MoveTo;
    const dpiOf = (dpi: unknown) => (typeof dpi === 'number' && dpi > 0 ? dpi : win.devicePixelRatio || 1);
    const pinned: MoveTo = (_x, _y, dpi) => original.call(api, target.x, target.y, dpiOf(dpi));

    try {
        api.ResizeTo(target.width, target.height, true);
        api.MoveTo = pinned;
        original.call(api, target.x, target.y, dpiOf(undefined));
    } catch (error) {
        logger.warn('Could not pin the toast window; Steam places it.', error);
        api.MoveTo = original;
        slots[slot] = null;
        return null;
    }

    return () => {
        if (api.MoveTo === pinned) api.MoveTo = original;
        slots[slot] = null;
        while (slots.length && slots[slots.length - 1] === null) slots.pop();
    };
}
