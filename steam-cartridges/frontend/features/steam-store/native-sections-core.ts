/**
 * Pure part of the section appid redirection (parity plan C). No imports, so
 * Node can run the unit tests with type stripping.
 *
 * Steam's own Links, Friends and Community sections load their data by appid
 * (`overview.appid`, `details.unAppID`, `appid`). For a shortcut with a Steam
 * match we hand them the native appid, so Steam fetches and renders the native
 * game's links, friends who play and community content itself (ADR-0022,
 * ADR-0009). A shortcut without a match gets Steam's stock behaviour: no links
 * (a shortcut's own appid has no store page).
 */
export type RedirectKind = 'links' | 'friends' | 'community';

export const SHORTCUT_MIN = 0x8000_0000;

const proxies = new WeakMap<object, Map<number, object>>();

/** One proxy per (target, native) so React sees a stable object across renders. */
function cached<T extends object>(target: T, key: number, make: () => T): T {
    let byKey = proxies.get(target);
    if (!byKey) {
        byKey = new Map();
        proxies.set(target, byKey);
    }
    let p = byKey.get(key) as T | undefined;
    if (!p) {
        p = make();
        byKey.set(key, p);
    }
    return p;
}

/** Reads go to the target (getters run with the target as `this`); methods stay bound to it. */
function passThrough(t: object, prop: string | symbol): unknown {
    const v = Reflect.get(t, prop, t);
    return typeof v === 'function' ? v.bind(t) : v;
}

/** The overview the Links component sees. native undefined = stock shortcut behaviour (no links). */
export function linksOverview<T extends object>(overview: T, native: number | undefined): T {
    return cached(overview, native ?? 0, () =>
        new Proxy(overview, {
            get(t, prop) {
                if (prop === 'BIsModOrShortcut') return native === undefined ? () => true : () => false;
                if (native !== undefined && prop === 'appid') return native;
                return passThrough(t, prop);
            },
        }),
    );
}

/** The details the Friends components see: `unAppID` is the native app. */
export function nativeDetails<T extends object>(details: T, native: number): T {
    return cached(details, native, () =>
        new Proxy(details, {
            get(t, prop) {
                if (prop === 'unAppID') return native;
                return passThrough(t, prop);
            },
        }),
    );
}

/**
 * Rewrite one element's props in place (the jsx hook passes the props object
 * before React sees it). Returns the native appid used, or undefined when
 * nothing changed. O(1).
 */
export function redirectProps(
    kind: RedirectKind,
    props: Record<string, any> | null | undefined,
    nativeOf: (appid: number) => number | undefined,
): number | undefined {
    if (!props) return undefined;
    if (kind === 'links') {
        const ov = props.overview;
        if (!ov || typeof ov !== 'object' || !(ov.appid >= SHORTCUT_MIN)) return undefined;
        const native = nativeOf(ov.appid);
        props.overview = linksOverview(ov, native);
        return native ?? 0;
    }
    if (kind === 'friends') {
        const d = props.details;
        if (!d || typeof d !== 'object' || !(d.unAppID >= SHORTCUT_MIN)) return undefined;
        const native = nativeOf(d.unAppID);
        if (native === undefined) return undefined;
        props.details = nativeDetails(d, native);
        return native;
    }
    const appid = props.appid;
    if (!(appid >= SHORTCUT_MIN)) return undefined;
    const native = nativeOf(appid);
    if (native === undefined) return undefined;
    props.appid = native;
    return native;
}
