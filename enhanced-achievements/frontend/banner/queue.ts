/**
 * The toast scheduler: decides when each themed banner is on screen, and for
 * how long. The only owner of banner lifetime; themed-toast.tsx renders
 * whatever phase this reports and never keeps its own "is it my turn" state.
 *
 * Every toast goes `waiting -> showing -> done` (or straight to `showing`).
 * `showing` ends on our own timer (`showMs`, from banner/timing.ts), never on
 * an animation event: a theme with `animation.out: "none"` fires no
 * `animationend`, and a render-side signal cannot be trusted when React
 * remounts the toast. With the queue on, one toast shows at a time and the
 * next starts `QUEUE_GAP_MS` after the previous one is done.
 *
 * Identity is the notification's data object (WeakMap key), and every call is
 * idempotent, because Steam may mount the same toast more than once.
 *
 * Pure: no Steam, SDK or `logger` import, so tests/queue.test.ts runs it under
 * `npm test` (same constraint as theme/theme.ts and capture/plan.ts).
 */

export type Phase = 'waiting' | 'showing' | 'done';

const QUEUE_GAP_MS = 100;
/**
 * Bounded: a waiting toast keeps its (invisible) Steam popup open, so an
 * unbounded queue could hold popups for minutes. Past this many waiting, a
 * new toast shows at once instead, never silently dropped.
 */
export const MAX_QUEUE = 5;

interface Entry {
    phase: Phase;
    showMs: number;
    timer?: ReturnType<typeof setTimeout>;
    listeners: Set<() => void>;
}

const entries = new WeakMap<object, Entry>();
let current: object | null = null;
const waiting: object[] = [];
/** Every toast not yet done (strong refs only until then), so a reset can cancel all timers. */
const live = new Set<object>();
let promoteTimer: ReturnType<typeof setTimeout> | undefined;

function notify(entry: Entry): void {
    for (const listener of [...entry.listeners]) {
        try {
            listener();
        } catch {
            /* a listener must not break the queue */
        }
    }
}

function start(key: object, entry: Entry): void {
    entry.phase = 'showing';
    entry.timer = setTimeout(() => finish(key), entry.showMs);
    notify(entry);
}

function promote(): void {
    promoteTimer = undefined;
    while (current === null && waiting.length) {
        const next = waiting.shift()!;
        const entry = entries.get(next);
        if (!entry || entry.phase !== 'waiting') continue;
        current = next;
        start(next, entry);
    }
}

function schedulePromote(): void {
    if (promoteTimer === undefined) promoteTimer = setTimeout(promote, QUEUE_GAP_MS);
}

/**
 * Register a toast and return its phase. `queued` is the queue setting at the
 * toast's arrival. A key seen before just returns its current phase.
 * `onOverflow` is called when the queue is full and the toast shows at once.
 */
export function admit(key: object, showMs: number, queued: boolean, onOverflow?: () => void): Phase {
    const known = entries.get(key);
    if (known) return known.phase;

    const entry: Entry = { phase: 'waiting', showMs, listeners: new Set() };
    entries.set(key, entry);
    live.add(key);

    if (!queued) {
        start(key, entry);
    } else if (current === null && waiting.length === 0 && promoteTimer === undefined) {
        current = key;
        start(key, entry);
    } else if (waiting.length >= MAX_QUEUE) {
        onOverflow?.();
        start(key, entry);
    } else {
        waiting.push(key);
    }
    return entry.phase;
}

/** Unknown keys are `done`: nothing of ours is holding them. */
export function phaseOf(key: object): Phase {
    return entries.get(key)?.phase ?? 'done';
}

/** Called on every phase change of `key`. Returns an unsubscribe function. */
export function subscribe(key: object, listener: () => void): () => void {
    const entry = entries.get(key);
    if (!entry) return () => {};
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
}

/** End `key` now (its timer ran out, it was dismissed, or it unmounted). Idempotent. */
export function finish(key: object): void {
    const entry = entries.get(key);
    if (!entry || entry.phase === 'done') return;
    clearTimeout(entry.timer);
    const idx = waiting.indexOf(key);
    if (idx >= 0) waiting.splice(idx, 1);
    entry.phase = 'done';
    live.delete(key);
    notify(entry);
    if (current === key) {
        current = null;
        schedulePromote();
    }
}

/** The toast unmounted: finish it and drop its listeners. */
export function forget(key: object): void {
    finish(key);
    entries.get(key)?.listeners.clear();
}

/** Test/dry-run only: drops all queue state (existing keys keep their last phase). */
export function resetQueue(): void {
    clearTimeout(promoteTimer);
    promoteTimer = undefined;
    for (const key of live) {
        const entry = entries.get(key);
        if (entry) {
            clearTimeout(entry.timer);
            entry.phase = 'done';
        }
    }
    live.clear();
    current = null;
    waiting.length = 0;
}
