import { logger } from '../../logger';

/**
 * Pins one desktop / in-game overlay toast popup to our computed position.
 *
 * Steam's toast stack moves every toast popup each frame of its fade-in and
 * fade-out, anchored with its own position setting and a fixed 283 px width
 * (verified live 2026-09-25, see docs/steam-components.md § Desktop toast
 * stack). Instead of racing it, this replaces **that popup's own**
 * `SteamClient.Window.MoveTo` (an own, writable property; verified live) so
 * Steam keeps the timing and we decide the place. Nothing global is patched,
 * and the popup is destroyed with the toast.
 *
 * The style surface's remap (../style/toast-window.ts) wraps the same property
 * first, when the popup opens; this pin wraps on top of it, for the banner's own
 * popups only, and the remap passes those through (`bannerDraws`). One Steam
 * target, two writers in a fixed order (ADR-0050; tests/architecture.test.ts).
 *
 * Big Picture's single persistent toast popup is never pinned (it is not
 * registered with Steam's per-toast popup manager — see docs/steam-components.md
 * § Toast windows).
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

export interface PinnedWindow {
    /** Stack slot this popup holds (0 = nearest the anchor corner). */
    slot: number;
    /** Move/resize the popup; Steam's per-frame MoveTo keeps landing on it. */
    retarget(target: PinTarget): void;
    unpin(): void;
}

/** True for the per-toast popups Steam opens on desktop and in the in-game overlay. */
export function isPerToastPopup(win: Window): boolean {
    return PER_TOAST_POPUP.test(win.name);
}

/** Pin a per-toast popup; null when `win` is not one (Big Picture) or the API is missing. */
export function pinToastWindow(win: Window, targetFor: (slot: number) => PinTarget): PinnedWindow | null {
    if (!isPerToastPopup(win)) return null;
    const api = (win as unknown as { SteamClient?: { Window?: WindowApi } }).SteamClient?.Window;
    if (!api || typeof api.MoveTo !== 'function' || typeof api.ResizeTo !== 'function') return null;

    let slot = slots.indexOf(null);
    if (slot < 0) slot = slots.length;
    slots[slot] = win;

    let target = targetFor(slot);
    const original = api.MoveTo;
    const dpiOf = (dpi: unknown) => (typeof dpi === 'number' && dpi > 0 ? dpi : win.devicePixelRatio || 1);
    const pinned: MoveTo = (_x, _y, dpi) => original.call(api, target.x, target.y, dpiOf(dpi));
    const release = () => {
        if (api.MoveTo === pinned) api.MoveTo = original;
        if (slots[slot] === win) slots[slot] = null;
        while (slots.length && slots[slots.length - 1] === null) slots.pop();
    };

    try {
        api.ResizeTo(target.width, target.height, true);
        api.MoveTo = pinned;
        original.call(api, target.x, target.y, dpiOf(undefined));
    } catch (error) {
        logger.warn('Could not pin the toast window; Steam places it.', error);
        release();
        return null;
    }

    return {
        slot,
        retarget(next) {
            const resized = next.width !== target.width || next.height !== target.height;
            target = next;
            try {
                if (resized) api.ResizeTo(next.width, next.height, true);
                original.call(api, next.x, next.y, dpiOf(undefined));
            } catch (error) {
                logger.warn('Could not move the toast window.', error);
            }
        },
        unpin: release,
    };
}
