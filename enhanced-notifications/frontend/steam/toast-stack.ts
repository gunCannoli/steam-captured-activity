/**
 * Steam's desktop toast stack (module 48197, the `he` component that renders `Q`): unsticking it.
 *
 * The stack pops the next toast only while its react-query cache of `SteamClient.Window.DefaultMonitorHasFullscreenWindow`
 * is fresh (staleTime 5 s): a stale cache reads as `undefined` and no toast is popped. The query refetches only when its
 * `enabled` input flips (`!!currentToast && stack.length < 3 && ...`). In stock Steam it flips when a toast arrives in
 * an empty queue or a full stack of three frees a slot. With every type `displayToastAlone` (the notifications queue)
 * the next toast is already the current one when the previous one leaves, nothing flips, and after 5 s the stack stalls
 * for good (found live 2026-10-02: 49 toasts waiting, none shown, the query 9 minutes stale). `refreshFullscreenQuery`
 * refetches that query through its own observer, as Steam would, so the stack goes on.
 *
 * The observer is found once by walking SharedJSContext's React tree (the stack is the fiber whose props carry
 * `appid`, `notifications` and `onDismiss`; its owner's hooks hold the observer) and cached while it stays subscribed.
 */

interface QueryObserverLike {
    refetch(): Promise<unknown>;
    hasListeners?(): boolean;
    getCurrentQuery?(): { queryKey?: unknown[]; isStale?(): boolean } | undefined;
    getCurrentResult?(): { isStale?: boolean };
}

interface FiberLike {
    child?: FiberLike | null;
    sibling?: FiberLike | null;
    return?: FiberLike | null;
    memoizedProps?: Record<string, unknown> | null;
    memoizedState?: { memoizedState?: unknown; next?: unknown } | null;
}

const QUERY_NAME = 'DefaultMonitorHasFullscreenWindow';
const MAX_FIBERS = 300_000;
let cached: QueryObserverLike | null = null;

function isFullscreenObserver(v: unknown): v is QueryObserverLike {
    if (!v || typeof v !== 'object' || typeof (v as QueryObserverLike).refetch !== 'function') return false;
    const key = (v as QueryObserverLike).getCurrentQuery?.()?.queryKey;
    return Array.isArray(key) && key[1] === QUERY_NAME;
}

/** The desktop stack's fullscreen query observer, or null. Walks the React tree only when nothing is cached. */
function findObserver(doc: Document): QueryObserverLike | null {
    if (cached && cached.hasListeners?.() !== false) return cached;
    cached = null;
    for (const el of Array.from(doc.querySelectorAll('*'))) {
        const key = Object.keys(el).find((k) => k.startsWith('__reactContainer$'));
        if (!key) continue;
        const stack: (FiberLike | null | undefined)[] = [(el as unknown as Record<string, FiberLike>)[key]];
        let seen = 0;
        while (stack.length && seen < MAX_FIBERS) {
            const f = stack.pop();
            seen++;
            if (!f) continue;
            const p = f.memoizedProps;
            if (p && Array.isArray(p.notifications) && 'onDismiss' in p && p.appid === 0) {
                let hook = f.return?.memoizedState ?? null;
                for (let i = 0; hook && i < 64; i++) {
                    if (isFullscreenObserver(hook.memoizedState)) return (cached = hook.memoizedState);
                    hook = (hook.next as typeof hook) ?? null;
                }
            }
            if (f.sibling) stack.push(f.sibling);
            if (f.child) stack.push(f.child);
        }
    }
    return null;
}

/**
 * Refetch the stack's fullscreen query if its cache is stale. Returns `refetched`, `fresh` (nothing to do) or
 * `not-found` (Steam changed; the caller logs it once).
 */
export function refreshFullscreenQuery(doc: Document = document): 'refetched' | 'fresh' | 'not-found' {
    const observer = findObserver(doc);
    if (!observer) return 'not-found';
    const stale = observer.getCurrentQuery?.()?.isStale?.() ?? observer.getCurrentResult?.()?.isStale ?? true;
    if (!stale) return 'fresh';
    void observer.refetch();
    return 'refetched';
}

type Fn = (this: unknown, ...args: unknown[]) => unknown;
const RENDERING_KEY = 'SetContextRenderingToast';

/**
 * Steam's stack calls `NotificationStore.SetContextRenderingToast(context, false)` the moment its on-screen list
 * empties (an effect on `list.length > 0`). Wrapped as an own property of the store instance, like
 * steam/toast-pop.ts: the wrapper calls what the store resolved before it (an own property, or the prototype's method
 * looked up at call time), then `onIdle()` one macrotask later when the call says "not rendering". So the next queued
 * toast is unstuck as soon as the previous one leaves, not at the watchdog's next look. Returns an uninstall function,
 * or null when Steam has no such method.
 */
export function installStackIdle(store: object, onIdle: () => void, reportError: (error: unknown) => void): (() => void) | null {
    const target = store as Record<string, unknown>;
    if (typeof target[RENDERING_KEY] !== 'function') return null;
    const own = Object.prototype.hasOwnProperty.call(store, RENDERING_KEY) ? (target[RENDERING_KEY] as Fn) : null;
    let active = true;
    const wrapper: Fn = function (this: unknown, ...args: unknown[]) {
        const next = own ?? ((Object.getPrototypeOf(store) as Record<string, unknown>)[RENDERING_KEY] as Fn);
        const result = next.apply(this, args);
        if (active && args[1] === false) {
            setTimeout(() => {
                try {
                    onIdle();
                } catch (error) {
                    reportError(error);
                }
            }, 0);
        }
        return result;
    };
    target[RENDERING_KEY] = wrapper;
    return () => {
        active = false;
        if (target[RENDERING_KEY] !== wrapper) return; // someone wrapped on top of us: stay in the chain, passing through
        if (own) target[RENDERING_KEY] = own;
        else delete target[RENDERING_KEY];
    };
}

/** Is the desktop stack stuck right now: toasts waiting, none on screen? O(1). */
export function stackLooksStuck(store: { m_rgNotificationToasts?: unknown[]; m_setContextsRenderingToasts?: { size: number } } | undefined): boolean {
    if (!store) return false;
    return (store.m_rgNotificationToasts?.length ?? 0) > 0 && (store.m_setContextsRenderingToasts?.size ?? 0) === 0;
}
