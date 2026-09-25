/**
 * One achievement banner visible at a time. A second (or later) unlock's
 * `ThemedToast` render is held back until the currently-showing one signals
 * it is fully gone (its exit animation ends, or its popup unmounts —
 * whichever happens; both are wired in themed-toast.tsx), then a fixed
 * `QUEUE_GAP_MS` later it becomes "current" and renders for real.
 *
 * Pure: no Steam, SDK or `logger` import, so tests/queue.test.ts can run it
 * directly under `npm test` (Node's raw ESM loader does not resolve
 * `../logger`'s extensionless import the way the build tool does — this file
 * must stay import-free, same constraint as theme/theme.ts and capture/plan.ts).
 * The overflow case logs through a caller-supplied callback instead.
 *
 * Deliberately not a promise chain: React can mount/unmount a toast's
 * `Banner` more than once for the same logical toast (Steam re-renders its
 * toast stack on layout changes), so identity is the notification object
 * itself (a WeakMap-safe key), and `enter`/`leave` are idempotent.
 */

const QUEUE_GAP_MS = 100;
/** Bounded: an unbounded queue would hold popups Steam has already started
 * hiding on their own timer (banner-geometry-fix.md's lesson: don't fight
 * Steam's own timing). Anything past this many waiting is dropped from the
 * queue and shown immediately instead of risking a silently-skipped unlock. */
const MAX_QUEUE = 5;

let current: object | null = null;
const waiting: object[] = [];
const callbacks = new Map<object, () => void>();

function promote(): void {
    const next = waiting.shift();
    if (!next) {
        current = null;
        return;
    }
    current = next;
    const cb = callbacks.get(next);
    callbacks.delete(next);
    cb?.();
}

/**
 * True if `key` may render now; otherwise it is queued and `onTurn` fires
 * later. `onOverflow` (optional) is called once if the queue is full and
 * `key` is shown immediately instead of waiting.
 */
export function requestTurn(key: object, onTurn: () => void, onOverflow?: () => void): boolean {
    if (current === null) {
        current = key;
        return true;
    }
    if (current === key || waiting.includes(key)) return current === key;
    if (waiting.length >= MAX_QUEUE) {
        onOverflow?.();
        return true;
    }
    waiting.push(key);
    callbacks.set(key, onTurn);
    return false;
}

/** Call when `key`'s toast is fully gone (exit animation ended or unmounted). */
export function releaseTurn(key: object): void {
    callbacks.delete(key);
    const idx = waiting.indexOf(key);
    if (idx >= 0) waiting.splice(idx, 1);
    if (current !== key) return;
    setTimeout(promote, QUEUE_GAP_MS);
}

/** Test/dry-run only: drops all queue state. */
export function resetQueue(): void {
    current = null;
    waiting.length = 0;
    callbacks.clear();
}
