// Sensor `installs` (ADR-0056 follow-up): notices, while Steam runs, that a store game was installed after Steam started.
// Neither store tells Steam, and Steam has no file watcher for them, so the sensor is a slow tick (60 s) that asks
// app/store-sync to look again. The tick costs nothing while both auto-add toggles are off (`run()` returns before any
// backend call) and one local read (the Epic manifests folder and the Xbox package list, no network) while one is on.
// Read-only; the library-shortcuts surface does the writing.

export interface InstallsWatchOptions {
    intervalMs?: number;
    timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
}

/** Calls `onTick` every `intervalMs` (default 60 s), never at once: the caller runs its own first check. Returns a stop function. */
export function watchInstalls(onTick: () => void, opts: InstallsWatchOptions = {}): () => void {
    const timers = opts.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as any) };
    const handle = timers.setInterval(onTick, opts.intervalMs ?? 60_000);
    return () => timers.clearInterval(handle);
}
