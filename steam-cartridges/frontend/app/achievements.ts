// app/achievements: a shortcut's achievements in its record, and Flow C (launch -> observe ->
// unlock) (migration plan M6b). The backend picks the source (ach_service.lua); this loads the
// part, runs the launch toast policy and the in-game unlock polling, and announces unlocks on the
// bus. The surfaces (achievements, toasts, captures) only render what the record and the
// `achievements.unlocked` event say.
import { logger } from "../logger.ts";
import type { ShortcutId } from "../kernel/appid";
import type { EventBus } from "../kernel/events";
import type { AchievementSet, AchievementUnlockRecord, Part, RecordStore, Route } from "../kernel/record";
import type { backend as Backend } from "../ports/backend";

export type LaunchPolicy = "off" | "first_run" | "all_runs";

/** In-game unlock polling interval (today's value). */
const POLL_MS = 2000;

export interface AchievementsDeps {
    backend: Pick<typeof Backend, "ensureFresh" | "checkUnlocks" | "unlockAchievement" | "resetAchievements">;
    records: RecordStore;
    bus: EventBus;
    /** Creates the base record if the appid has none yet (app/records.ts ensureBase). */
    ensureBase(appid: ShortcutId): void;
    titleOf(appid: number): string | undefined;
    routeOf(appid: ShortcutId): Route;
    /** The mapped native app (0 = none): the record's identity, else the saved mapping. */
    resolveNative(appid: ShortcutId): Promise<number>;
    /** Setting raHardcoreMode. */
    hardcore(): boolean;
    /** Setting localAchievementsNotifyOnLaunch. */
    launchPolicy(): LaunchPolicy;
    /** The toasts surface's launch toast (wired in index.tsx). */
    showLaunchToast(): void;
    /** Kill switch `achievements-observer`: gates the launch toast and the polling session. */
    observerEnabled(): boolean;
    timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
    now(): number;
}

export interface AchievementsService {
    /** Subscribe to shortcut.launched / shortcut.quit (Flow C). */
    install(): void;
    /** Load the achievements part into the record (one backend call at a time per shortcut). */
    ensure(appid: ShortcutId, route: Route, opts?: { native?: number }): Promise<Part<AchievementSet>>;
    /** One CheckUnlocks; returns how many new unlocks it found. */
    checkNow(appid: ShortcutId, opts?: { native?: number; title?: string }): Promise<number>;
    /** Poll while a game runs; the returned function stops it (with one final check). */
    startSession(appid: ShortcutId, opts?: { native?: number; title?: string }): () => void;
    /** Unlock one achievement (the given id, else the next locked one). */
    trigger(appid: ShortcutId, achievementId?: string): Promise<boolean>;
    reset(appid: ShortcutId): Promise<boolean>;
}

/** K1: Millennium's cjson encodes an empty Lua table as `{}`; accept an array or an object of items. */
function asList<T>(v: unknown): T[] {
    if (Array.isArray(v)) return v as T[];
    if (v && typeof v === "object") return Object.values(v as Record<string, T>);
    return [];
}

interface NewUnlock {
    id: string;
    rtime_unlocked?: number;
}

export function createAchievements(deps: AchievementsDeps): AchievementsService {
    const timers = deps.timers ?? {
        setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
        clearInterval: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
    };
    const inflight = new Map<ShortcutId, Promise<Part<AchievementSet>>>();
    const notified = new Set<ShortcutId>();
    const sessions = new Map<ShortcutId, () => void>();
    /** Games running now: a quit while the mapping is still loading must not start a session. */
    const running = new Set<ShortcutId>();

    const current = (appid: ShortcutId) => deps.records.get(appid)?.achievements;

    async function load(appid: ShortcutId, route: Route, native?: number): Promise<Part<AchievementSet>> {
        deps.ensureBase(appid);
        const known = deps.records.get(appid)?.identity;
        const identity = native && !known?.data?.native
            ? { status: "ok" as const, data: { native: { appid: native, source: "manual" as const } } }
            : known;
        const res = await deps.backend.ensureFresh(appid, ["achievements"], {
            title: deps.titleOf(appid) ?? "",
            route,
            identity,
            hardcore: deps.hardcore(),
        });
        const raw = res.error ? undefined : (res.parts.achievements as Part<AchievementSet> | undefined);
        const part: Part<AchievementSet> = raw ?? { status: "error", message: res.error ?? "no achievements part" };
        const changed = deps.records.update(appid, { achievements: part });
        if (changed.length > 0) {
            const total = part.data?.schema.total ?? 0;
            const done = Object.keys(part.data?.unlocks ?? {}).length;
            logger.info(`Achievements ${appid}: ${part.status}${part.source ? " " + part.source : ""}${part.data ? ` ${done}/${total}` : ""}`);
        }
        return part;
    }

    async function ensure(appid: ShortcutId, route: Route, opts: { native?: number } = {}) {
        if (route.bucket === "none") {
            const part: Part<AchievementSet> = { status: "unsupported" };
            deps.ensureBase(appid);
            deps.records.update(appid, { achievements: part });
            return part;
        }
        const existing = inflight.get(appid);
        if (existing) return existing;
        const promise = load(appid, route, opts.native).finally(() => inflight.delete(appid));
        inflight.set(appid, promise);
        return promise;
    }

    async function checkNow(appid: ShortcutId, opts: { native?: number; title?: string } = {}): Promise<number> {
        try {
            const native = opts.native ?? (await deps.resolveNative(appid));
            const res = await deps.backend.checkUnlocks(appid, native, opts.title ?? deps.titleOf(appid));
            const fresh = asList<NewUnlock>(res?.new_unlocks).filter((u) => u && typeof u.id === "string");
            if (fresh.length === 0) return 0;

            const set = current(appid)?.data;
            if (set) {
                const unlocks: Record<string, AchievementUnlockRecord> = { ...set.unlocks };
                for (const u of fresh) unlocks[u.id] = { unlocked_time: u.rtime_unlocked || Math.floor(deps.now() / 1000) };
                deps.records.update(appid, { achievements: { ...current(appid)!, data: { ...set, unlocks } } });
            } else {
                // The record has no schema yet: load it (the backend already persisted the unlocks).
                await ensure(appid, deps.routeOf(appid), { native });
            }
            const ids = fresh.map((u) => u.id);
            logger.info(`Observer detected ${ids.length} new unlock(s) for shortcut ${appid}: ${ids.join(", ")}`);
            deps.bus.emit("achievements.unlocked", { appid, ids });
            return ids.length;
        } catch (e) {
            logger.error(`Error checking unlocks for ${appid}:`, e);
            return 0;
        }
    }

    function startSession(appid: ShortcutId, opts: { native?: number; title?: string } = {}): () => void {
        sessions.get(appid)?.();
        logger.info(`Starting in-game achievement observer for shortcut ${appid}`);
        const handle = timers.setInterval(() => void checkNow(appid, opts), POLL_MS);
        const stop = () => {
            timers.clearInterval(handle);
            sessions.delete(appid);
            void checkNow(appid, opts); // final check on quit
            logger.info(`Stopped in-game achievement observer for shortcut ${appid}`);
        };
        sessions.set(appid, stop);
        return stop;
    }

    function launchToast(appid: ShortcutId): void {
        const policy = deps.launchPolicy();
        if (policy === "off") return;
        const total = current(appid)?.data?.schema.total ?? 0;
        if (total === 0) return;
        if (policy === "first_run") {
            if (notified.has(appid)) return;
            notified.add(appid);
        }
        deps.showLaunchToast();
    }

    return {
        install() {
            deps.bus.on("shortcut.launched", ({ appid, name }) => {
                if (!deps.observerEnabled()) return;
                running.add(appid);
                launchToast(appid);
                void deps.resolveNative(appid).then((n) => {
                    if (!running.has(appid)) return; // the game quit while the mapping loaded
                    startSession(appid, { native: n, title: name });
                });
            });
            deps.bus.on("shortcut.quit", ({ appid }) => {
                running.delete(appid);
                const stop = sessions.get(appid);
                stop?.();
                // New captures and unlocks: reload what the record holds for this shortcut.
                void ensure(appid, deps.routeOf(appid));
            });
        },
        ensure,
        checkNow,
        startSession,
        async trigger(appid, achievementId) {
            const set = current(appid)?.data;
            const item = set?.schema.achievements.find((a) =>
                achievementId ? a.id === achievementId : !set.unlocks[a.id],
            );
            if (!set || !item) {
                logger.warn(`Cannot unlock: no achievement found for shortcut ${appid}`);
                return false;
            }
            try {
                const unlockTime = Math.floor(deps.now() / 1000);
                const res = await deps.backend.unlockAchievement(appid, item.id, unlockTime);
                if (res.error) {
                    logger.error(`Failed to record achievement unlock via RPC: ${res.error}`);
                    return false;
                }
                const unlocks = { ...(res.unlocks && typeof res.unlocks === "object" ? res.unlocks : {}) };
                deps.records.update(appid, { achievements: { ...current(appid)!, data: { ...set, unlocks } } });
                deps.bus.emit("achievements.unlocked", { appid, ids: [item.id] });
                return true;
            } catch (e) {
                logger.error(`Error triggering achievement ${item.id}:`, e);
                return false;
            }
        },
        async reset(appid) {
            try {
                const res = await deps.backend.resetAchievements(appid);
                if (res.error) {
                    logger.error(`Failed resetting achievements: ${res.error}`);
                    return false;
                }
                const set = current(appid)?.data;
                if (set) deps.records.update(appid, { achievements: { ...current(appid)!, data: { ...set, unlocks: {} } } });
                logger.info(`Reset achievements for shortcut ${appid}`);
                return true;
            } catch (e) {
                logger.error(`Error resetting achievements for shortcut ${appid}:`, e);
                return false;
            }
        },
    };
}
