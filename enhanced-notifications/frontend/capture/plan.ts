/**
 * Pure capture planning logic for Phase 7 (auto-captures on achievement
 * unlock). No Steam, SDK or settings imports, so `npm test` runs this under
 * plain Node, like `theme/theme.ts`.
 *
 * Everything here is deterministic: given settings, an unlock and a timeline
 * snapshot, it returns a plan of actions to schedule. The actual RPC calls,
 * `setTimeout` scheduling and Steam object reads live in
 * `capture/captures.ts` and `steam/recording.ts`.
 *
 * See docs/plans/phase7-and-alpha-plan.md § A2/A3.1 for the full spec.
 */

export const CAPTURE_RANGES = {
    'screenshot.delay_ms': { min: 0, max: 5000, step: 100 },
    'recording.duration_s': { min: 0, max: 60, step: 5 },
    'recording.delay_ms': { min: 0, max: 5000, step: 100 },
} as const;

export const SETTLE_MS = 1500;
export const MAX_CLIP_MS = 120_000;
/** Below this age (ms) a toast is considered "just arrived", not queued. */
export const FRESH_MS = 1500;

/** ETimelineEntryType wire values (protobuf network contract) we use. */
export const ENTRY_TYPE = { Event: 2, UserMarker: 5 } as const;

export interface CaptureSettings {
    screenshot: { enabled: boolean; delayMs: number };
    clip: { enabled: boolean; durationS: number; delayMs: number };
    marker: { enabled: boolean };
}

function num(v: unknown, min: number, max: number): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

/**
 * Apply a tier's `screenshot` / `recording` overrides (themes.md § Capture
 * overrides) on top of the base plugin settings. A bad field (wrong type, out
 * of range, unknown key) is ignored and a warning is returned; the override
 * never throws. `recording.add_timeline_marker` (marker.enabled) is not
 * overridable per tier: themes.md does not document it.
 */
export function resolveCaptureSettings(
    base: CaptureSettings,
    tier?: { screenshot?: Record<string, unknown>; recording?: Record<string, unknown> },
): { settings: CaptureSettings; warnings: string[] } {
    const warnings: string[] = [];
    const settings: CaptureSettings = {
        screenshot: { ...base.screenshot },
        clip: { ...base.clip },
        marker: { ...base.marker },
    };

    const ss = tier?.screenshot;
    if (ss) {
        for (const key of Object.keys(ss)) {
            if (key === 'enabled' && typeof ss.enabled === 'boolean') settings.screenshot.enabled = ss.enabled;
            else if (key === 'delay_ms') {
                const v = num(ss.delay_ms, CAPTURE_RANGES['screenshot.delay_ms'].min, CAPTURE_RANGES['screenshot.delay_ms'].max);
                if (v !== undefined) settings.screenshot.delayMs = v;
                else warnings.push(`screenshot.delay_ms override is invalid; using the plugin setting.`);
            } else if (key !== 'enabled') {
                warnings.push(`screenshot.${key} is not a recognised override; ignored.`);
            }
        }
    }

    const rr = tier?.recording;
    if (rr) {
        for (const key of Object.keys(rr)) {
            if (key === 'enabled' && typeof rr.enabled === 'boolean') settings.clip.enabled = rr.enabled;
            else if (key === 'duration_s') {
                const v = num(rr.duration_s, CAPTURE_RANGES['recording.duration_s'].min, CAPTURE_RANGES['recording.duration_s'].max);
                if (v !== undefined) settings.clip.durationS = v;
                else warnings.push(`recording.duration_s override is invalid; using the plugin setting.`);
            } else if (key === 'delay_ms') {
                const v = num(rr.delay_ms, CAPTURE_RANGES['recording.delay_ms'].min, CAPTURE_RANGES['recording.delay_ms'].max);
                if (v !== undefined) settings.clip.delayMs = v;
                else warnings.push(`recording.delay_ms override is invalid; using the plugin setting.`);
            } else if (key === 'add_timeline_marker') {
                warnings.push(`recording.add_timeline_marker cannot be overridden per tier; ignored.`);
            } else if (key !== 'enabled') {
                warnings.push(`recording.${key} is not a recognised override; ignored.`);
            }
        }
    }

    return { settings, warnings };
}

export function anyEnabled(s: CaptureSettings): boolean {
    return s.screenshot.enabled || s.clip.enabled || s.marker.enabled;
}

/** The two candidate `game_id` forms for an appid (AGENTS.md § two identifiers). */
export function gameIdCandidates(appid: number): { native: string; shortcut: string } {
    const a = BigInt(appid >>> 0);
    return { native: String(appid), shortcut: ((a << 32n) | 0x02000000n).toString() };
}

/**
 * The unlock's offset into the running timeline right now.
 *
 * `rtCreatedS` is when Steam queued the notification (unix seconds); our hook
 * fires when the toast is *displayed*, which can be seconds later if other
 * toasts are queued. A fresh toast (< FRESH_MS old) uses `nowOffsetMs`
 * unchanged; an older one is walked back by its age. Never negative.
 */
export function unlockOffsetMs(nowOffsetMs: number, nowMs: number, rtCreatedS: number | undefined): number {
    if (typeof rtCreatedS !== 'number' || !Number.isFinite(rtCreatedS)) return Math.max(0, nowOffsetMs);
    const ageMs = Math.max(0, nowMs - rtCreatedS * 1000);
    const offset = ageMs < FRESH_MS ? nowOffsetMs : nowOffsetMs - ageMs;
    return Math.max(0, offset);
}

export interface TimelineSnapshot {
    timelineId: string;
    gameId: string;
    nowOffsetMs: number;
    startBeforeZeroMs: number;
    recording: { startOffsetMs: number } | null;
}

export interface UnlockInfo {
    appid: number;
    name: string;
    description: string;
    nowMs: number;
    rtCreatedS?: number;
}

export type Action =
    | { kind: 'screenshot'; sendAfterMs: number; targetOffsetMs: number }
    | { kind: 'clip'; sendAfterMs: number; startOffsetMs: number; endOffsetMs: number; name: string }
    | { kind: 'marker'; sendAfterMs: 0; time: number; name: string; description: string };

export interface Plan {
    actions: Action[];
    skipped: { kind: 'screenshot' | 'clip' | 'marker' | 'all'; reason: string }[];
    /** true = shortcut, false = native Steam game, null = no running timeline (unknown). */
    shortcut: boolean | null;
}

/**
 * Decide what to do for one unlock. Pure: takes a timeline snapshot already
 * read from Steam (or null), returns a plan the caller schedules with
 * `setTimeout`. Never sends an RPC itself.
 */
export function planCaptures(s: CaptureSettings, unlock: UnlockInfo, timeline: TimelineSnapshot | null): Plan {
    if (!anyEnabled(s)) return { actions: [], skipped: [], shortcut: null };

    if (!timeline) {
        return { actions: [], skipped: [{ kind: 'all', reason: 'no-running-timeline' }], shortcut: null };
    }

    const candidates = gameIdCandidates(unlock.appid);
    const shortcut = timeline.gameId === candidates.shortcut ? true : timeline.gameId === candidates.native ? false : null;
    if (shortcut === null) {
        return { actions: [], skipped: [{ kind: 'all', reason: 'no-running-timeline' }], shortcut: null };
    }

    const unlockOffset = unlockOffsetMs(timeline.nowOffsetMs, unlock.nowMs, unlock.rtCreatedS);
    const actions: Action[] = [];
    const skipped: Plan['skipped'] = [];
    const recordingActive = timeline.recording !== null;

    if (s.screenshot.enabled) {
        if (!recordingActive) {
            skipped.push({ kind: 'screenshot', reason: 'recording-not-active' });
        } else {
            const targetOffsetMs = unlockOffset + s.screenshot.delayMs;
            actions.push({ kind: 'screenshot', sendAfterMs: s.screenshot.delayMs + SETTLE_MS, targetOffsetMs });
        }
    }

    if (s.clip.enabled) {
        if (!recordingActive) {
            skipped.push({ kind: 'clip', reason: 'recording-not-active' });
        } else {
            const endOffsetMs = unlockOffset + s.clip.delayMs;
            const earliestStart = timeline.recording ? timeline.recording.startOffsetMs : 0;
            const startOffsetMs = Math.max(endOffsetMs - s.clip.durationS * 1000, earliestStart, 0);
            actions.push({
                kind: 'clip',
                sendAfterMs: s.clip.delayMs + SETTLE_MS,
                startOffsetMs,
                endOffsetMs,
                name: unlock.name.slice(0, 100),
            });
        }
    }

    if (s.marker.enabled) {
        if (!shortcut) {
            skipped.push({ kind: 'marker', reason: 'steam-marks-achievements' });
        } else {
            actions.push({
                kind: 'marker',
                sendAfterMs: 0,
                time: Math.floor(unlockOffset + timeline.startBeforeZeroMs),
                name: unlock.name,
                description: unlock.description,
            });
        }
    }

    return { actions, skipped, shortcut };
}

/**
 * Coalesce a new clip action into a still-pending one (A2.2 "Coalescing"): the
 * end (and therefore duration) extends to the new unlock, capped at
 * `start + MAX_CLIP_MS`, and the name gets a `"<first> (+N)"` suffix.
 */
export function mergeClip(pending: Extract<Action, { kind: 'clip' }>, next: Extract<Action, { kind: 'clip' }>, count: number): Extract<Action, { kind: 'clip' }> {
    const endOffsetMs = Math.min(Math.max(pending.endOffsetMs, next.endOffsetMs), pending.startOffsetMs + MAX_CLIP_MS);
    return {
        kind: 'clip',
        sendAfterMs: next.sendAfterMs,
        startOffsetMs: pending.startOffsetMs,
        endOffsetMs,
        name: `${pending.name.replace(/ \(\+\d+\)$/, '')} (+${count})`,
    };
}
