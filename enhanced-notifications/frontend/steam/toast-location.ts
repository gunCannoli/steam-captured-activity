/**
 * Which Big Picture toast container may show a toast: Big Picture's own, or the running game's overlay.
 *
 * In game, Big Picture has two toast containers, one per window (its own and the game overlay's), and both pop from
 * the same queue: Steam's toast manager passes each `bFocusedLocation: !inVR || ...`, so outside VR every window
 * counts as the focused location (module 48197, read live 2026-10-08). Two toasts close together are then split, and
 * the one Big Picture's own view takes is drawn behind the game, never seen (docs/steam-components.md § Big Picture
 * toast view; consistency plan B3). `bFocusedLocation` is Steam's own switch for this (VR uses it), read by the
 * container on every render; the container re-renders on every toast arrival. So the prop becomes a getter that asks
 * where the user is looking at that moment: with a game overlay open and the Big Picture window hidden (the game in
 * front), only the overlay's container may pop; with the Big Picture window in front, only Big Picture's.
 *
 * No imports: the kill switch comes in as a function, so `npm test` checks the decision and the getter with fakes.
 */

export interface LocationState {
    /** A game overlay window exists (`gamepadoverlay_uid<pid>` in the popup manager). */
    overlayOpen: boolean;
    /** The Big Picture window is in front (`document.visibilityState === 'visible'`). */
    bigPictureVisible: boolean;
}

/**
 * Whether a container may pop. `overlay`: the game overlay's container (Steam gives it the game's appid), else Big
 * Picture's own. `steam`: Steam's own `bFocusedLocation`, never overridden to true. Never both blocked: without an
 * overlay Big Picture's container is free, and with one exactly one of the two follows the window in front.
 */
export function locationMayShow(overlay: boolean, steam: boolean, s: LocationState): boolean {
    if (!steam) return false;
    if (overlay) return !s.bigPictureVisible;
    return !(s.overlayOpen && !s.bigPictureVisible);
}

interface PopupLike {
    m_strName?: string;
    window?: { closed?: boolean; document?: { visibilityState?: string } } | null;
}

/** Where the user is looking now, from Steam's popup manager. A few popups, read on a container render only. */
export function readLocationState(): LocationState {
    const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<PopupLike> } | undefined;
    let overlayOpen = false;
    let bigPictureVisible = false;
    for (const p of manager?.GetPopups?.() ?? []) {
        const name = p?.m_strName ?? '';
        if (!p?.window || p.window.closed) continue;
        if (name.startsWith('gamepadoverlay')) overlayOpen = true;
        else if (name.startsWith('SP BPM') && p.window.document?.visibilityState === 'visible') bigPictureVisible = true;
    }
    return { overlayOpen, bigPictureVisible };
}

/** Big Picture's toast containers are the only elements Steam creates with a boolean `bFocusedLocation`. O(1). */
export function isLocationProps(props: unknown): props is { bFocusedLocation: boolean; appid?: unknown } {
    return !!props && typeof (props as { bFocusedLocation?: unknown }).bFocusedLocation === 'boolean';
}

/**
 * Replace a container's `bFocusedLocation` with a live getter (React 19 keeps a key-less props object as the element's
 * props, and props are not frozen in production). `enabled` is the kill switch, read on every get: off gives Steam's
 * value. Idempotent per props object. `state` is injectable for tests.
 */
export function routeLocationProps(props: unknown, enabled: () => boolean, state: () => LocationState = readLocationState): void {
    if (!isLocationProps(props)) return;
    const desc = Object.getOwnPropertyDescriptor(props, 'bFocusedLocation');
    if (!desc || !desc.configurable || desc.get) return;
    const steam = desc.value as boolean;
    const overlay = !!props.appid;
    Object.defineProperty(props, 'bFocusedLocation', {
        configurable: true,
        enumerable: true,
        get(): boolean {
            if (!enabled()) return steam;
            try {
                return locationMayShow(overlay, steam, state());
            } catch {
                return steam;
            }
        },
    });
}
