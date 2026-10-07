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
 * See docs/plans/phase7-and-alpha-plan.md (deleted; `git show 0cc6249^:docs/plans/phase7-and-alpha-plan.md`) § A2/A3.1 for the full spec.
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

export interface CaptureSettings {
    screenshot: { enabled: boolean; delayMs: number };
    clip: { enabled: boolean; durationS: number; delayMs: number };
}

function num(v: unknown, min: number, max: number): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

/**
 * Apply a tier's `screenshot` / `recording` overrides (themes.md § Capture
 * overrides) on top of the base plugin settings. A bad field (wrong type, out
 * of range, unknown key) is ignored and a warning is returned; the override
 * never throws.
 */
export function resolveCaptureSettings(
    base: CaptureSettings,
    tier?: { screenshot?: Record<string, unknown>; recording?: Record<string, unknown> },
): { settings: CaptureSettings; warnings: string[] } {
    const warnings: string[] = [];
    const settings: CaptureSettings = {
        screenshot: { ...base.screenshot },
        clip: { ...base.clip },
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
            } else if (key !== 'enabled') {
                warnings.push(`recording.${key} is not a recognised override; ignored.`);
            }
        }
    }

    return { settings, warnings };
}

export function anyEnabled(s: CaptureSettings): boolean {
    return s.screenshot.enabled || s.clip.enabled;
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
    recording: { startOffsetMs: number } | null;
}

export interface UnlockInfo {
    appid: number;
    name: string;
    nowMs: number;
    rtCreatedS?: number;
}

/**
 * No recording runs (ADR-0061): start a manual recording now, stop it after `stopAfterMs`, then take the screenshots
 * (timeline offsets) from the frames now on disk; the stop saves a clip, kept only when the clip setting is on.
 */
export interface ManualAction {
    kind: 'manual';
    stopAfterMs: number;
    shotOffsetsMs: number[];
    keepClip: boolean;
}

export type Action =
    | { kind: 'screenshot'; sendAfterMs: number; targetOffsetMs: number }
    | { kind: 'clip'; sendAfterMs: number; startOffsetMs: number; endOffsetMs: number; name: string }
    | ManualAction;

/** A manual recording's screenshot frame is at least this long after the unlock, so it lies inside the recording. */
export const MANUAL_MIN_SHOT_MS = 1000;
/** Recording kept running past the last screenshot frame (a frame 1 s behind live was not on disk yet, steam-components.md). */
export const MANUAL_SHOT_TAIL_MS = 2000;

export interface Plan {
    actions: Action[];
    skipped: { kind: 'screenshot' | 'clip' | 'all'; reason: string }[];
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

    if (!recordingActive) {
        const manual = planManual(s, timeline.nowOffsetMs);
        return { actions: manual ? [manual] : [], skipped: manual ? [] : [{ kind: 'all', reason: 'nothing-to-record' }], shortcut };
    }

    if (s.screenshot.enabled) {
        const targetOffsetMs = unlockOffset + s.screenshot.delayMs;
        actions.push({ kind: 'screenshot', sendAfterMs: s.screenshot.delayMs + SETTLE_MS, targetOffsetMs });
    }

    if (s.clip.enabled) {
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

/**
 * The manual recording for an unlock with no recording running (ADR-0061). `nowOffsetMs` is the timeline's offset at
 * the unlock; the recording starts right after it. The screenshot frame is `screenshot.delayMs` after the unlock (at
 * least MANUAL_MIN_SHOT_MS); the clip is the first `max(duration, delay)` of the recording. null = nothing enabled.
 */
export function planManual(s: CaptureSettings, nowOffsetMs: number): ManualAction | null {
    const keepClip = s.clip.enabled && s.clip.durationS > 0;
    if (!s.screenshot.enabled && !keepClip) return null;
    const shotAfterMs = Math.max(s.screenshot.delayMs, MANUAL_MIN_SHOT_MS);
    const clipMs = keepClip ? Math.max(s.clip.durationS * 1000, s.clip.delayMs) : 0;
    const shotMs = s.screenshot.enabled ? shotAfterMs + MANUAL_SHOT_TAIL_MS : 0;
    return {
        kind: 'manual',
        stopAfterMs: Math.min(Math.max(clipMs, shotMs), MAX_CLIP_MS),
        shotOffsetsMs: s.screenshot.enabled ? [Math.max(0, nowOffsetMs) + shotAfterMs] : [],
        keepClip,
    };
}

/**
 * A second unlock while our manual recording runs (ADR-0061): one recording, its stop moved to cover the new unlock
 * (never past MAX_CLIP_MS after the first unlock), the new screenshot frame added, the clip kept if either wanted it.
 * `elapsedMs` is the time since the first unlock's recording was started.
 */
export function mergeManual(pending: ManualAction, next: ManualAction, elapsedMs: number): ManualAction {
    return {
        kind: 'manual',
        stopAfterMs: Math.min(Math.max(pending.stopAfterMs, elapsedMs + next.stopAfterMs), MAX_CLIP_MS),
        shotOffsetsMs: [...pending.shotOffsetsMs, ...next.shotOffsetsMs],
        keepClip: pending.keepClip || next.keepClip,
    };
}

/** Seconds of slack around our stop when matching the clip it saved (Steam names it by the stop time, to the second). */
export const OWN_CLIP_SLACK_S = 10;

/**
 * The clip our manual recording's stop saved, or undefined (ADR-0061; never delete anything else). Steam names a clip
 * `clip_<gameid>_<YYYYMMDD>_<HHMMSS>`, the time in UTC at the stop (log 2026-10-07: stopped 01:20:51 UTC-3, clip
 * `clip_12391904938840555520_20261007_042051`). A clip id counts as ours only when it is new after the stop, names this
 * game, and its time falls within the stop's window: a "new" id that is really an old clip (Steam's list not yet loaded
 * before the stop) is never chosen. More than one match: none (no guessing).
 */
export function ownManualClip(freshIds: readonly string[], gameId: string, stopStartMs: number, stopEndMs: number): string | undefined {
    const lo = Math.floor(stopStartMs / 1000) - OWN_CLIP_SLACK_S;
    const hi = Math.ceil(stopEndMs / 1000) + OWN_CLIP_SLACK_S;
    const prefix = `clip_${gameId}_`;
    const matches = freshIds.filter((id) => {
        if (!id.startsWith(prefix)) return false;
        const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(id.slice(prefix.length));
        if (!m) return false;
        const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) / 1000;
        return t >= lo && t <= hi;
    });
    return matches.length === 1 ? matches[0] : undefined;
}
