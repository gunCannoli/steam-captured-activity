import { logger } from '../../logger';
import { findExports } from '../../steam/webpack';
import { ownManualClip } from '../../capture/plan';

/**
 * The only file that touches Steam's Game Recording objects: the RPC service
 * (`GameRecording.TakeScreenshot#1` / `SaveClip#1`)
 * and the live recording store (`window.g_GRS`, `CGameRecordingStore`).
 *
 * Resolution signatures and RPC shapes: docs/plans/phase7-and-alpha-plan.md
 * § A1.1-A1.4. Resolved once at startup (guardrail 3); `window.g_GRS` is read
 * fresh on every call (never cached), because Steam can recreate it.
 */

interface RpcResult<T = unknown> {
    GetEResult(): number;
    BSuccess(): boolean;
    Body(): { toObject(): T };
}

interface GameRecordingService {
    TakeScreenshotHandler?: { name?: string };
    TakeScreenshot(req: { game_id: string; timeline_id: string; timeline_offset_ms: string }): Promise<RpcResult<{ screenshot_id: string }>>;
    SaveClip(req: {
        game_id: string;
        start: { timeline_id: string; offset_ms: string };
        end: { timeline_id: string; offset_ms: string };
        name: string;
        temporary: boolean;
        force_thumbnail: boolean;
    }): Promise<RpcResult>;
}

interface RunningRecording {
    recording_id: string;
    start_offset_ms: number;
    duration_ms: number;
    recording_type: number;
}

interface TimelineLoader {
    BIsTimelineRunning(tid: string): boolean;
    GetRunningTimelineDurationMS(tid: string): number;
    GetGameID(): string;
    m_mapRunningTimelines: Map<string, { m_metadata?: unknown; m_runningRecording: RunningRecording | null }>;
}

interface GameRecordingStore {
    m_mapActiveTimelines: Map<string, { loader: TimelineLoader; release?: () => void }>;
    m_recordingState: unknown;
    /** The overlay's record button and the Ctrl+F11 hotkey (steam-components.md § Game Recording RPCs). */
    StartRecording?(gameId: string): Promise<RpcResult | undefined>;
    /** Stops it and adds the saved clip to the store; resolves to nothing. */
    StopRecording?(gameId: string): Promise<void>;
    DeleteClip?(clipId: string): Promise<number>;
    GetClipSummariesForGame?(gameId: string): { clip_id: string }[] | undefined;
}

let service: GameRecordingService | null = null;

/** One `findExports` scan at startup (guardrail 3). */
export function initRecording(): boolean {
    const hits = findExports(
        (src) => src.includes('GameRecording.TakeScreenshot#1'),
        (v) => {
            const svc = v as GameRecordingService;
            return svc?.TakeScreenshotHandler?.name === 'GameRecording.TakeScreenshot#1' && typeof svc.TakeScreenshot === 'function' && typeof svc.SaveClip === 'function';
        },
    );
    if (hits.length !== 1) {
        logger.warn(`Game Recording service not found (${hits.length} matches); captures are inactive.`);
        service = null;
        return false;
    }
    service = hits[0] as GameRecordingService;
    return true;
}

function grs(): GameRecordingStore | null {
    const store = Reflect.get(globalThis, 'g_GRS') as GameRecordingStore | undefined;
    return store && store.m_mapActiveTimelines instanceof Map ? store : null;
}

export interface TimelineSnapshot {
    timelineId: string;
    gameId: string;
    nowOffsetMs: number;
    recording: { startOffsetMs: number } | null;
}

/**
 * Find a running timeline matching either game_id candidate. Stale entries
 * stay in `m_mapActiveTimelines` after a timeline stops (Steam calls
 * `release()` but never deletes them), so `BIsTimelineRunning` is mandatory.
 */
export function snapshotTimeline(candidates: { native: string; shortcut: string }): { snap: TimelineSnapshot | null; reason?: string } {
    const store = grs();
    if (!store) return { snap: null, reason: 'recording-store-unavailable' };

    for (const [tid, entry] of store.m_mapActiveTimelines) {
        const loader = entry?.loader;
        if (!loader || !loader.BIsTimelineRunning(tid)) continue;
        let gameId: string;
        try {
            gameId = loader.GetGameID();
        } catch {
            continue;
        }
        if (gameId !== candidates.native && gameId !== candidates.shortcut) continue;
        const running = loader.m_mapRunningTimelines?.get(tid)?.m_runningRecording ?? null;
        return {
            snap: {
                timelineId: tid,
                gameId,
                nowOffsetMs: loader.GetRunningTimelineDurationMS(tid),
                recording: running ? { startOffsetMs: running.start_offset_ms } : null,
            },
        };
    }
    return { snap: null, reason: 'no-running-timeline' };
}

/** Read at send time for the clamps (A2.1/A2.2): the loader is fetched fresh, never cached. */
export function liveOffset(timelineId: string): number | null {
    const store = grs();
    for (const [tid, entry] of store?.m_mapActiveTimelines ?? []) {
        if (tid === timelineId) return entry.loader.GetRunningTimelineDurationMS(tid);
    }
    return null;
}

export function recordingStart(timelineId: string): number | null {
    const store = grs();
    for (const [tid, entry] of store?.m_mapActiveTimelines ?? []) {
        if (tid !== timelineId) continue;
        return entry.loader.m_mapRunningTimelines?.get(tid)?.m_runningRecording?.start_offset_ms ?? null;
    }
    return null;
}

export interface RpcOutcome {
    ok: boolean;
    eresult: number;
    body?: unknown;
    error?: string;
}

async function invoke<T>(fn: (() => Promise<RpcResult<T>>) | undefined): Promise<RpcOutcome> {
    if (!service || !fn) return { ok: false, eresult: 0, error: 'service-unavailable' };
    try {
        const res = await fn();
        const eresult = res.GetEResult();
        return { ok: res.BSuccess(), eresult, body: res.Body()?.toObject() };
    } catch (error) {
        return { ok: false, eresult: 0, error: String(error) };
    }
}

export function takeScreenshot(req: { game_id: string; timeline_id: string; timeline_offset_ms: string }): Promise<RpcOutcome> {
    return invoke(() => service!.TakeScreenshot(req));
}

export function saveClip(req: {
    game_id: string;
    start: { timeline_id: string; offset_ms: string };
    end: { timeline_id: string; offset_ms: string };
    name: string;
    temporary: boolean;
    force_thumbnail: boolean;
}): Promise<RpcOutcome> {
    return invoke(() => service!.SaveClip(req));
}

// ---------- manual recording (ADR-0061), through Steam's own store so its clip list stays in sync ----------

function clipIds(gameId: string): Set<string> {
    const list = grs()?.GetClipSummariesForGame?.(gameId) ?? [];
    return new Set(list.map((c) => c.clip_id));
}

/** Starts a manual recording of the game (what Ctrl+F11 does). */
export async function startManualRecording(gameId: string): Promise<RpcOutcome> {
    const store = grs();
    if (!store?.StartRecording) return { ok: false, eresult: 0, error: 'recording-store-unavailable' };
    try {
        const res = await store.StartRecording(gameId);
        return { ok: res?.BSuccess() ?? false, eresult: res?.GetEResult() ?? 0 };
    } catch (error) {
        return { ok: false, eresult: 0, error: String(error) };
    }
}

/**
 * Stops the game's manual recording; resolves to the clip it saved, if it can be told apart for sure: new after the
 * stop, and named for this game at the stop's time (`ownManualClip`). Only that id may ever be deleted.
 */
export async function stopManualRecording(gameId: string): Promise<{ ok: boolean; clipId?: string; error?: string }> {
    const store = grs();
    if (!store?.StopRecording) return { ok: false, error: 'recording-store-unavailable' };
    try {
        const before = clipIds(gameId);
        const stopStart = Date.now();
        await store.StopRecording(gameId);
        const fresh = [...clipIds(gameId)].filter((id) => !before.has(id));
        const clipId = ownManualClip(fresh, gameId, stopStart, Date.now());
        return { ok: clipId !== undefined, clipId };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}

/** Deletes a clip through Steam's store; resolves to the EResult (1 = deleted). */
export async function deleteClip(clipId: string): Promise<number> {
    const store = grs();
    if (!store?.DeleteClip) return 0;
    try {
        return await store.DeleteClip(clipId);
    } catch {
        return 0;
    }
}

/** For tests/captures.mjs: the appid of the game with a running timeline, if any. */
export function runningGameAppid(): number | null {
    const store = grs();
    if (!store) return null;
    for (const [tid, entry] of store.m_mapActiveTimelines) {
        if (!entry.loader.BIsTimelineRunning(tid)) continue;
        let gid: bigint;
        try {
            gid = BigInt(entry.loader.GetGameID());
        } catch {
            continue;
        }
        const appid = (gid & 0xffffffffn) === 0x02000000n ? gid >> 32n : gid;
        if (appid >= 0n && appid <= 0xffffffffn) return Number(appid);
    }
    return null;
}

export function recordingDiagnostics(): { service: boolean; grs: boolean; activeTimelines: number; running: { gameId: string; recording: boolean }[] } {
    const store = grs();
    const running: { gameId: string; recording: boolean }[] = [];
    if (store) {
        for (const [tid, entry] of store.m_mapActiveTimelines) {
            if (!entry.loader.BIsTimelineRunning(tid)) continue;
            let gameId = 'unknown';
            try {
                gameId = entry.loader.GetGameID();
            } catch {
                /* keep 'unknown' */
            }
            running.push({ gameId, recording: !!entry.loader.m_mapRunningTimelines?.get(tid)?.m_runningRecording });
        }
    }
    return { service: !!service, grs: !!store, activeTimelines: store?.m_mapActiveTimelines.size ?? 0, running };
}
