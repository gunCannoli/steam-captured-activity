import { logger } from '../../logger';

/**
 * Big Picture toast debugging (off by default, never persisted): a trace of what the style surface saw and did for
 * Big Picture's one toast view, and a switch for where the Big Picture toast type comes from, so alternatives can be
 * compared live without a rebuild. Read by tests/probes/bp-toast-trace.mjs, which merges this trace with what Steam
 * does (SetBounds / SetVisible on the toast view, the placeholder's rect). Investigation: docs/plans/
 * enhanced-notifications-bigpicture-toast-fix-plan.md.
 *
 * From the SharedJSContext console:
 *   PLUGIN_LIST['enhanced-notifications-dev'].debugBigPicture({ enabled: true, echo: true })
 *   PLUGIN_LIST['enhanced-notifications-dev'].bigPictureTrace()          // entries, `t` is performance.now()
 *   PLUGIN_LIST['enhanced-notifications-dev'].debugBigPicture({ typeSource: 'shown' })
 *
 * Type sources (which Steam signal sets the type used for Big Picture's window and a desktop popup not yet typed):
 * - `arrival` (today): NotificationStore's current toast, which changes when a toast ARRIVES, even while another one is
 *   still on screen (queued), plus the shared hook's `onShown`.
 * - `shown`: only `onShown` (Steam's toast component asking for its sound, in an effect after the toast is committed).
 * - `manual`: neither; the type is set by `debugBigPictureType(eType)`, so a probe can drive it from any signal
 *   (the probe's `--source pop` wraps `NotificationStore.PopNextToastNotification` from CDP).
 */

export type TypeSource = 'arrival' | 'shown' | 'manual';

export interface TraceEntry {
    t: number;
    ev: string;
    [key: string]: unknown;
}

const MAX_ENTRIES = 1000;
let enabled = false;
let echo = false;
let source: TypeSource = 'arrival';
let entries: TraceEntry[] = [];
let manualSink: ((eType: number | null) => void) | null = null;

/** Record one event when tracing is on. O(1) when off (one boolean check). */
export function bpLog(ev: string, data?: Record<string, unknown>): void {
    if (!enabled) return;
    const entry: TraceEntry = { t: Math.round(performance.now() * 10) / 10, ev, ...data };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES / 2);
    if (echo) logger.info(`[bp] ${ev} ${data ? JSON.stringify(data) : ''}`);
}

export function bpTracing(): boolean {
    return enabled;
}

export function typeSource(): TypeSource {
    return source;
}

/** The injector registers how a manual type is applied (it owns the attribute). */
export function setManualTypeSink(sink: ((eType: number | null) => void) | null): void {
    manualSink = sink;
}

/** Switch tracing / echo / the type source; returns the current state. Not persisted: a restart resets it. */
export function debugBigPicture(opts: { enabled?: boolean; echo?: boolean; typeSource?: TypeSource } = {}): { enabled: boolean; echo: boolean; typeSource: TypeSource } {
    if (opts.enabled !== undefined) enabled = opts.enabled;
    if (opts.echo !== undefined) echo = opts.echo;
    if (opts.typeSource && ['arrival', 'shown', 'manual'].includes(opts.typeSource)) {
        source = opts.typeSource;
        bpLog('typeSource', { source });
    }
    return { enabled, echo, typeSource: source };
}

/** The trace so far; `clear` empties it after reading. */
export function bigPictureTrace(clear = false): TraceEntry[] {
    const out = entries;
    if (clear) entries = [];
    return out;
}

/** Type source `manual`: set the current toast type (null = unstyled). Ignored in the other modes. */
export function debugBigPictureType(eType: number | null): boolean {
    if (source !== 'manual' || !manualSink) return false;
    bpLog('manualType', { eType });
    manualSink(eType);
    return true;
}
