/**
 * Which Big Picture toast container may show a toast: Big Picture's own, or the running game's overlay.
 *
 * In game, Big Picture has two toast containers, one per window (its own and the game overlay's), and both pop from
 * the same queue: Steam's toast manager passes each `bFocusedLocation: !inVR || ...`, so outside VR every window
 * counts as the focused location (module 48197, read live 2026-10-08). Two toasts close together are then split, and
 * the one Big Picture's own view takes is drawn behind the game, never seen (docs/steam-components.md § Big Picture
 * toast view; consistency plan B3). `bFocusedLocation` is Steam's own switch for this (VR uses it), read by the
 * container on every render; the container re-renders on every toast arrival. So the prop becomes a getter that asks
 * which app has focus at that moment, from Steam's own focus tracking (`RegisterForFocusChangeEvents`, kept per window
 * as `m_CompositionStateStore.m_currentlyFocusedAppid`): the game overlay's container (it carries the game's appid)
 * pops only while that game has focus; Big Picture's own pops unless an overlay is open and a running game has focus.
 * Not `document.visibilityState`: CEF's occlusion state follows Windows' desktop (a minimised RDP client leaves no
 * foreground window and flips it either way), not the game (B3-loc runs, 2026-10-08).
 *
 * No imports: the kill switch comes in as a function, so `npm test` checks the decision and the getter with fakes.
 */

export interface LocationState {
    /** A game overlay window exists (`gamepadoverlay_uid<pid>` in the popup manager). */
    overlayOpen: boolean;
    /** The app Steam says has focus (413080 "Steam Controller Configs - Desktop" when nothing does); null: unknown. */
    focusedAppid: number | null;
    /** Steam's running apps. */
    runningAppids: readonly number[];
}

/**
 * Whether a container may pop. `appid`: the game overlay's container carries its game's appid, Big Picture's own 0.
 * `steam`: Steam's own `bFocusedLocation`, never overridden to true. Focus unknown: Steam's value. With one game
 * running the two are never both blocked (two games, one focused, the other's overlay: that one waits, as before B3).
 */
export function locationMayShow(appid: number, steam: boolean, s: LocationState): boolean {
    if (!steam) return false;
    if (s.focusedAppid === null) return true;
    if (appid) return s.focusedAppid === appid;
    return !(s.overlayOpen && s.runningAppids.includes(s.focusedAppid));
}

interface PopupLike {
    m_strName?: string;
    window?: { closed?: boolean } | null;
}

interface SteamUIWindowLike {
    m_CompositionStateStore?: { m_currentlyFocusedAppid?: { Value?: unknown } };
}

interface SteamUIStoreLike {
    WindowStore?: { SteamUIWindows?: Iterable<SteamUIWindowLike> };
    RunningApps?: Iterable<{ appid?: unknown }>;
}

/** Which app has focus now, from Steam's popup manager and UI store. A few objects, read on a container render only. */
export function readLocationState(): LocationState {
    const manager = Reflect.get(globalThis, 'g_PopupManager') as { GetPopups?: () => Iterable<PopupLike> } | undefined;
    let overlayOpen = false;
    for (const p of manager?.GetPopups?.() ?? []) {
        if (p?.window && !p.window.closed && (p.m_strName ?? '').startsWith('gamepadoverlay')) overlayOpen = true;
    }
    const store = Reflect.get(globalThis, 'SteamUIStore') as SteamUIStoreLike | undefined;
    let focusedAppid: number | null = null;
    for (const w of store?.WindowStore?.SteamUIWindows ?? []) {
        const v = w?.m_CompositionStateStore?.m_currentlyFocusedAppid?.Value;
        if (typeof v === 'number') {
            focusedAppid = v;
            break;
        }
    }
    const runningAppids: number[] = [];
    for (const a of store?.RunningApps ?? []) if (typeof a?.appid === 'number') runningAppids.push(a.appid);
    return { overlayOpen, focusedAppid, runningAppids };
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
    const appid = typeof props.appid === 'number' ? props.appid : 0;
    Object.defineProperty(props, 'bFocusedLocation', {
        configurable: true,
        enumerable: true,
        get(): boolean {
            if (!enabled()) return steam;
            try {
                return locationMayShow(appid, steam, state());
            } catch {
                return steam;
            }
        },
    });
}
