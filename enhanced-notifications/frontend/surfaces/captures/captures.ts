import { logger } from '../../logger';
import { setting } from '../../settings/settings';
import type { Tier } from '../../theme/achievements';
import { deleteClip, recordingStart, runningGameAppid, saveClip, snapshotTimeline, startManualRecording, stopManualRecording, takeScreenshot, type TimelineSnapshot } from './recording';
import { gameIdCandidates, MANUAL_MIN_SHOT_MS, mergeClip, mergeManual, planCaptures, type Action, type CaptureSettings, type ManualAction, type Plan } from '../../capture/plan';
import type { SteamNotification } from '../../kernel/notification';
import { reportError } from '../../safety/runtime';

/**
 * Schedules Phase 7 auto-captures (screenshot / clip) on
 * achievement unlock. The `achievement.unlocked` subscriber in `index.tsx` calls `onUnlock`
 * synchronously (O(1): dedupe, snapshot, schedule); every RPC runs later, in a
 * `setTimeout` callback, never in the hook itself (the one scoped exception to
 * guardrail 5 — see docs/plans/phase7-and-alpha-plan.md (deleted; `git show 0cc6249^:docs/plans/phase7-and-alpha-plan.md`) § A1.7).
 */

const seen = new WeakSet<object>();
let dryRun = false;

interface LogAction {
    kind: Action['kind'];
    request: unknown;
    eresult?: number;
}
interface LogEntry {
    at: number;
    appid: number;
    tier: Tier;
    gameId?: string;
    shortcut?: boolean | null;
    dryRun: boolean;
    actions: LogAction[];
    skipped: Plan['skipped'];
}

const LOG_MAX = 20;
const log: LogEntry[] = [];

function pushLog(entry: LogEntry): void {
    log.push(entry);
    if (log.length > LOG_MAX) log.shift();
}

export function captureLog(): readonly LogEntry[] {
    return log;
}

export function setCaptureDryRun(on: boolean): void {
    dryRun = on;
}

function baseSettings(): CaptureSettings {
    return {
        screenshot: { enabled: setting('screenshot.enabled'), delayMs: setting('screenshot.delay_ms') },
        clip: { enabled: setting('recording.enabled'), durationS: setting('recording.duration_s'), delayMs: setting('recording.delay_ms') },
    };
}

/**
 * Our manual recordings (ADR-0061), one per game: started at the first unlock with no recording running, stopped by
 * `timer`. Only a recording in this map is ever stopped: a recording the user started is never touched.
 */
const manualSessions = new Map<string, { action: ManualAction; timelineId: string; startedAt: number; timer: ReturnType<typeof setTimeout> | null; appid: number; tier: Tier }>();

// One pending (unsent) clip timer per timelineId, for coalescing (A2.2).
const pendingClips = new Map<string, { action: Extract<Action, { kind: 'clip' }>; count: number; timer: ReturnType<typeof setTimeout> }>();
const timers = new Set<ReturnType<typeof setTimeout>>();

function schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
        timers.delete(t);
        fn();
    }, ms);
    timers.add(t);
    return t;
}

async function sendScreenshot(gameId: string, timelineId: string, action: Extract<Action, { kind: 'screenshot' }>, appid: number, tier: Tier): Promise<void> {
    const request = { game_id: gameId, timeline_id: timelineId, timeline_offset_ms: String(Math.floor(action.targetOffsetMs)) };
    if (dryRun) {
        logger.info(`[dry-run] screenshot`, request);
        pushLog({ at: Date.now(), appid, tier, gameId, dryRun: true, actions: [{ kind: 'screenshot', request }], skipped: [] });
        return;
    }
    const res = await takeScreenshot(request);
    if (!res.ok) logger.warn(`Screenshot failed (EResult ${res.eresult}).`, res.error ?? res.body);
    pushLog({ at: Date.now(), appid, tier, gameId, dryRun: false, actions: [{ kind: 'screenshot', request, eresult: res.eresult }], skipped: [] });
}

async function sendClip(gameId: string, timelineId: string, action: Extract<Action, { kind: 'clip' }>, appid: number, tier: Tier): Promise<void> {
    const request = {
        game_id: gameId,
        start: { timeline_id: timelineId, offset_ms: String(Math.floor(action.startOffsetMs)) },
        end: { timeline_id: timelineId, offset_ms: String(Math.floor(action.endOffsetMs)) },
        name: action.name,
        temporary: false,
        force_thumbnail: true,
    };
    if (dryRun) {
        logger.info(`[dry-run] clip`, request);
        pushLog({ at: Date.now(), appid, tier, gameId, dryRun: true, actions: [{ kind: 'clip', request }], skipped: [] });
        return;
    }
    const res = await saveClip(request);
    if (!res.ok) logger.warn(`Clip failed (EResult ${res.eresult}).`, res.error ?? res.body);
    pushLog({ at: Date.now(), appid, tier, gameId, dryRun: false, actions: [{ kind: 'clip', request, eresult: res.eresult }], skipped: [] });
}

/** Stops our manual recording, takes its screenshots from the frames now on disk, and drops the clip if only screenshots were wanted. */
async function finishManual(gameId: string): Promise<void> {
    const session = manualSessions.get(gameId);
    if (!session) return;
    manualSessions.delete(gameId);
    const { action, timelineId, appid, tier } = session;
    const actions: LogAction[] = [];
    try {
        const recStart = recordingStart(timelineId); // read before the stop clears it
        const stop = await stopManualRecording(gameId);
        actions.push({ kind: 'manual', request: { stop: gameId, clipId: stop.clipId, recStart }, eresult: stop.ok ? 1 : 0 });
        if (!stop.ok) logger.warn(`Manual recording stop for ${gameId} saved no clip.`, stop.error ?? '');
        for (const target of action.shotOffsetsMs) {
            const offset = recStart !== null ? Math.max(target, Number(recStart) + MANUAL_MIN_SHOT_MS) : target;
            const request = { game_id: gameId, timeline_id: timelineId, timeline_offset_ms: String(Math.floor(offset)) };
            const res = await takeScreenshot(request);
            if (!res.ok) logger.warn(`Screenshot failed (EResult ${res.eresult}).`, res.error ?? res.body);
            actions.push({ kind: 'screenshot', request, eresult: res.eresult });
        }
        if (!action.keepClip && stop.clipId) {
            const eresult = await deleteClip(stop.clipId);
            actions.push({ kind: 'manual', request: { deleteClip: stop.clipId }, eresult });
        }
    } catch (error) {
        reportError('captures', error);
    }
    pushLog({ at: Date.now(), appid, tier, gameId, dryRun: false, actions, skipped: [] });
}

/** No recording runs: start ours (or extend the one already ours) and schedule its stop. */
function runManual(gameId: string, timelineId: string, action: ManualAction, appid: number, tier: Tier): void {
    if (dryRun) {
        logger.info(`[dry-run] manual recording`, { gameId, ...action });
        pushLog({ at: Date.now(), appid, tier, gameId, dryRun: true, actions: [{ kind: 'manual', request: { gameId, ...action } }], skipped: [] });
        return;
    }
    const current = manualSessions.get(gameId);
    if (current) {
        const merged = mergeManual(current.action, action, Date.now() - current.startedAt);
        current.action = merged;
        if (current.timer) {
            clearTimeout(current.timer);
            timers.delete(current.timer);
            current.timer = schedule(() => void finishManual(gameId), Math.max(0, current.startedAt + merged.stopAfterMs - Date.now()));
        }
        return;
    }
    const session = { action, timelineId, startedAt: Date.now(), timer: null as ReturnType<typeof setTimeout> | null, appid, tier };
    manualSessions.set(gameId, session);
    void startManualRecording(gameId).then((res) => {
        if (manualSessions.get(gameId) !== session) return;
        if (!res.ok) {
            manualSessions.delete(gameId);
            logger.warn(`Manual recording could not start for ${gameId} (EResult ${res.eresult}).`, res.error ?? '');
            pushLog({ at: Date.now(), appid, tier, gameId, dryRun: false, actions: [{ kind: 'manual', request: { start: gameId }, eresult: res.eresult }], skipped: [] });
            return;
        }
        session.timer = schedule(() => void finishManual(gameId), Math.max(0, session.startedAt + session.action.stopAfterMs - Date.now()));
    });
}

/** Called from the `achievement.unlocked` event, one macrotask after the toast. O(1): dedupe, tier merge, snapshot, schedule. Never awaits an RPC. */
export function onUnlock(n: SteamNotification, tier: Tier): void {
    try {
        if (seen.has(n.data)) return;
        seen.add(n.data);

        const settings = baseSettings();

        const appid = n.data.appid();
        const nowMs = Date.now();
        const candidates = gameIdCandidates(appid);
        const { snap, reason } = snapshotTimeline(candidates);

        // Our own manual recording is running for this game: plan as if none ran, so the unlock joins it (ADR-0061).
        const timelineSnap: TimelineSnapshot | null = snap && manualSessions.has(snap.gameId) ? { ...snap, recording: null } : snap;
        const plan = planCaptures(
            settings,
            { appid, name: n.data.name(), nowMs, rtCreatedS: n.rtCreated },
            timelineSnap,
        );

        if (plan.actions.length === 0) {
            if (plan.skipped.length) {
                logger.info(`Unlock captures skipped for appid ${appid}: ${plan.skipped.map((s) => s.reason).join(', ')}${reason && !snap ? ` (${reason})` : ''}`);
                pushLog({ at: nowMs, appid, tier, dryRun, actions: [], skipped: plan.skipped });
            }
            return;
        }

        const gameId = timelineSnap!.gameId;
        const timelineId = timelineSnap!.timelineId;
        logger.info(`Unlock captures planned for appid ${appid} (${plan.actions.map((a) => a.kind).join(', ')}).`);

        for (const action of plan.actions) {
            if (action.kind === 'manual') {
                runManual(gameId, timelineId, action, appid, tier);
            } else if (action.kind === 'screenshot') {
                schedule(() => void sendScreenshot(gameId, timelineId, action, appid, tier), action.sendAfterMs);
            } else {
                const pending = pendingClips.get(timelineId);
                if (pending) {
                    clearTimeout(pending.timer);
                    timers.delete(pending.timer);
                    const merged = mergeClip(pending.action, action, pending.count + 1);
                    const timer = schedule(() => {
                        pendingClips.delete(timelineId);
                        void sendClip(gameId, timelineId, merged, appid, tier);
                    }, merged.sendAfterMs);
                    pendingClips.set(timelineId, { action: merged, count: pending.count + 1, timer });
                } else {
                    const timer = schedule(() => {
                        pendingClips.delete(timelineId);
                        void sendClip(gameId, timelineId, action, appid, tier);
                    }, action.sendAfterMs);
                    pendingClips.set(timelineId, { action, count: 0, timer });
                }
            }
        }
    } catch (error) {
        reportError('captures', error); // no captures for this unlock
    }
}

export function disposeCaptures(): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const p of pendingClips.values()) clearTimeout(p.timer);
    pendingClips.clear();
    // Never leave a recording we started running: stop it now (no screenshots, the clip is kept).
    for (const gameId of manualSessions.keys()) void stopManualRecording(gameId);
    manualSessions.clear();
}

export { runningGameAppid };
