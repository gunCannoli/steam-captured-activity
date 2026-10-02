/**
 * The notifications queue (the `queue.enabled` setting): one toast on screen at a time, for every type. Pure.
 *
 * Steam already has the rule: a type whose config has `displayToastAlone: true` waits until no toast is showing, and
 * holds every other toast back while it shows (NotificationStore `BAnyToastDisplayAlone` / `BNextToastDisplayAlone`,
 * read by the desktop and in-game overlay toast stack before it pops the next toast; verified live 2026-10-02: three
 * test toasts at once opened 3 windows stock, never more than 1 with the flag on every type). Steam sets it only on a
 * few types itself (33, 34, 35 here). With the queue on every type gets `true`; off, Steam's own value comes back.
 * Big Picture shows one toast at a time anyway.
 */
export interface AloneEntry {
    eType: number;
    /** Steam's own `displayToastAlone` for the type, before this plugin wrote it. */
    pristine: boolean | undefined;
}

export function planAlone(entries: Iterable<AloneEntry>, queued: boolean): [eType: number, alone: boolean | undefined][] {
    const out: [number, boolean | undefined][] = [];
    for (const e of entries) out.push([e.eType, queued ? true : e.pristine]);
    return out;
}
