// app/achievements: a shortcut's achievements in its record, and Flow C (launch -> observe ->
// unlock) (migration plan M6b). The backend picks the source (ach_service.lua); this loads the
// part, runs the launch toast policy and the in-game unlock polling, and announces unlocks and the
// launch toast on the bus. The surfaces (achievements, toasts, captures) only render what the record
// and the `achievements.unlocked` / `achievements.launch-toast` events say (M10: no surface callbacks).
import { logger } from "../logger.ts";
import { toShortcutId, type ShortcutId } from "../kernel/appid.ts";
import type { EventBus, UnlockedAchievement } from "../kernel/events";
import type { AchievementSet, AchievementUnlockRecord, Part, RecordStore, Route } from "../kernel/record";
import type { AchievementResetSource, backend as Backend, Lane, ResetSourceResult } from "../ports/backend";
import { asList } from "../kernel/lists.ts";

export type LaunchPolicy = "off" | "first_run" | "all_runs";

/** In-game unlock polling: the pause after one check settles before the next (today's value). */
const POLL_MS = 2000;

export interface AchievementsDeps {
    backend: Pick<typeof Backend, "ensureFresh" | "checkUnlocks" | "unlockAchievement" | "resetAchievements" | "resetAchievementSources" | "steamStoreGetMapping" | "getAllRecords">;
    records: RecordStore;
    bus: EventBus;
    /** Creates the base record if the appid has none yet (app/records.ts ensureBase). */
    ensureBase(appid: ShortcutId): void;
    titleOf(appid: number): string | undefined;
    routeOf(appid: ShortcutId): Route;
    /** Setting raHardcoreMode. */
    hardcore(): boolean;
    /** Setting localAchievementsNotifyOnLaunch. */
    launchPolicy(): LaunchPolicy;
    /** Kill switch `achievements-observer`: gates the launch toast and the polling session. */
    observerEnabled(): boolean;
    /** Settings services.epicEnabled / xboxEnabled (ADR-0056); absent = both on. */
    stores?(): { epic: boolean; xbox: boolean };
    /** The poll re-arms only after a check settles, so a busy backend never has two checks queued (ADR-0060). */
    timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
    now(): number;
}

export interface AchievementsService {
    /** Subscribe to shortcut.launched / shortcut.quit (Flow C). */
    install(): void;
    /**
     * Load the achievements part into the record (one backend call at a time per shortcut). `noNetwork`: the stored
     * part only, never a source (the view's paint, ADR-0060); it reaches the record only when it has data, and comes
     * back `stale` when a refresh is due. `lane`: the call queue lane, default "view".
     */
    ensure(appid: ShortcutId, route: Route, opts?: EnsureOptions): Promise<Part<AchievementSet>>;
    /** One CheckUnlocks; returns how many new unlocks it found. */
    checkNow(appid: ShortcutId, opts?: { native?: number; title?: string }): Promise<number>;
    /** Poll while a game runs; the returned function stops it (with one final check). */
    startSession(appid: ShortcutId, opts?: { native?: number; title?: string }): () => void;
    /** Unlock one achievement (the given id, else the next locked one). */
    trigger(appid: ShortcutId, achievementId?: string): Promise<boolean>;
    /** Clears the unlocks, and the chosen sources' files (ids from `resetSources`). */
    reset(appid: ShortcutId, sources?: string[]): Promise<{ ok: boolean; sources: ResetSourceResult[] }>;
    /** Where the unlocks come from besides the plugin's store (Steam emulator saves, trophy files, RetroAchievements). */
    resetSources(appid: ShortcutId): Promise<AchievementResetSource[]>;
    /** Unlocked and total count from the record, for the settings panel's audit. */
    summary(appid: number): { nAchieved: number; nTotal: number } | undefined;
    /**
     * Can this shortcut's achievements be reset? false for an Epic or Xbox copy: its unlocks live on the store's account
     * and the next sync brings them back (ADR-0056, decision 7). Record only, synchronous.
     */
    resettable(appid: number): boolean;
    /**
     * Start-up: every stored achievements part of a shortcut into its record (disk only, no
     * request), so the achievements surface fills Steam's stores for every shortcut, as Steam does for an owned
     * game (ADR-0045). A part already in the record (a view that ran first) is kept. Resolves to how many it added.
     */
    preload(): Promise<number>;
    /**
     * Steam replaced its progress cache (it loads its own file after login): render every record that has an
     * achievements part again so the surface refills it (ADR-0045). Resolves to how many records it re-emitted.
     */
    rerenderAll(): number;
}

export interface EnsureOptions {
    native?: number;
    force?: boolean;
    noNetwork?: boolean;
    lane?: Lane;
}

interface NewUnlock {
    id: string;
    rtime_unlocked?: number;
}

export function createAchievements(deps: AchievementsDeps): AchievementsService {
    const timers = deps.timers ?? {
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    const inflight = new Map<ShortcutId, Promise<Part<AchievementSet>>>();
    const notified = new Set<ShortcutId>();
    const sessions = new Map<ShortcutId, () => void>();
    /** Games running now: a quit while the mapping is still loading must not start a session. */
    const running = new Set<ShortcutId>();

    const current = (appid: ShortcutId) => deps.records.get(appid)?.achievements;

    /**
     * An Epic or Xbox copy (ADR-0056): its unlocks are synced from the store, which already notified the player in game,
     * so there is no launch toast and no in-game polling (decision 4). The record's store part, or a synced source.
     */
    const isSynced = (appid: ShortcutId) => {
        const rec = deps.records.get(appid);
        const source = rec?.achievements?.source;
        return (rec?.store?.status === "ok" && !!rec.store.data) || source === "epic" || source === "xbox";
    };

    /** The mapped native app (0 = none): the record's identity, else the saved mapping. */
    async function resolveNative(appid: ShortcutId): Promise<number> {
        const known = deps.records.get(appid)?.identity?.data?.native?.appid;
        if (known) return known;
        const res = await deps.backend.steamStoreGetMapping(appid).catch(() => null);
        return res?.mapping?.steam_appid || 0;
    }

    /** Announce new unlocks with what the surfaces show (from the record's schema). */
    function announce(appid: ShortcutId, ids: string[]): void {
        const set = current(appid)?.data;
        const items: UnlockedAchievement[] = [];
        for (const id of ids) {
            const a = set?.schema.achievements.find((x) => x.id === id);
            if (!a) continue;
            const at = set!.unlocks[id]?.unlocked_time ?? Math.floor(deps.now() / 1000);
            items.push({ id: a.id, name: a.name, description: a.description, icon: a.icon, global_pct: a.global_pct, unlockedAt: at });
        }
        deps.bus.emit("achievements.unlocked", { appid, ids, items });
    }

    async function load(appid: ShortcutId, route: Route, opts: EnsureOptions): Promise<Part<AchievementSet>> {
        deps.ensureBase(appid);
        const known = deps.records.get(appid)?.identity;
        const identity = opts.native && !known?.data?.native
            ? { status: "ok" as const, data: { native: { appid: opts.native, source: "manual" as const } } }
            : known;
        const res = await deps.backend.ensureFresh(appid, ["achievements"], {
            title: deps.titleOf(appid) ?? "",
            route,
            identity,
            hardcore: deps.hardcore(),
            allowEpic: deps.stores?.().epic ?? true,
            allowXbox: deps.stores?.().xbox ?? true,
            force: opts.force,
            noNetwork: opts.noNetwork,
        }, { lane: opts.lane ?? "view" });
        const raw = res.error ? undefined : (res.parts.achievements as Part<AchievementSet> | undefined);
        const part: Part<AchievementSet> = raw ?? { status: "error", message: res.error ?? "no achievements part" };
        // A disk-only answer without data (nothing stored yet) must not replace what the record holds.
        if (opts.noNetwork && !part.data) return part;
        const changed = deps.records.update(appid, { achievements: part });
        if (changed.length > 0) {
            const total = part.data?.schema.total ?? 0;
            const done = Object.keys(part.data?.unlocks ?? {}).length;
            logger.info(`Achievements ${appid}: ${part.status}${part.source ? " " + part.source : ""}${part.data ? ` ${done}/${total}` : ""}`);
        }
        return part;
    }

    async function ensure(appid: ShortcutId, route: Route, opts: EnsureOptions = {}) {
        if (route.bucket === "none") {
            const part: Part<AchievementSet> = { status: "unsupported" };
            deps.ensureBase(appid);
            deps.records.update(appid, { achievements: part });
            return part;
        }
        // A disk read is not shared with a source lookup in flight: each answers its own question.
        if (opts.noNetwork) return load(appid, route, opts);
        const existing = inflight.get(appid);
        if (existing) return existing;
        const promise = load(appid, route, opts).finally(() => inflight.delete(appid));
        inflight.set(appid, promise);
        return promise;
    }

    async function checkNow(appid: ShortcutId, opts: { native?: number; title?: string } = {}): Promise<number> {
        try {
            const native = opts.native ?? (await resolveNative(appid));
            const res = await deps.backend.checkUnlocks(appid, native, opts.title ?? deps.titleOf(appid), { lane: "normal" });
            const fresh = asList<NewUnlock>(res?.new_unlocks).filter((u) => u && typeof u.id === "string");
            if (fresh.length === 0) return 0;

            const set = current(appid)?.data;
            if (set) {
                const unlocks: Record<string, AchievementUnlockRecord> = { ...set.unlocks };
                for (const u of fresh) unlocks[u.id] = { unlocked_time: u.rtime_unlocked || Math.floor(deps.now() / 1000) };
                deps.records.update(appid, { achievements: { ...current(appid)!, data: { ...set, unlocks } } });
            } else {
                // The record has no schema yet: load it (the backend already persisted the unlocks).
                await ensure(appid, deps.routeOf(appid), { native, lane: "normal" });
            }
            const ids = fresh.map((u) => u.id);
            logger.info(`Observer detected ${ids.length} new unlock(s) for shortcut ${appid}: ${ids.join(", ")}`);
            announce(appid, ids);
            return ids.length;
        } catch (e) {
            logger.error(`Error checking unlocks for ${appid}:`, e);
            return 0;
        }
    }

    function startSession(appid: ShortcutId, opts: { native?: number; title?: string } = {}): () => void {
        sessions.get(appid)?.();
        logger.info(`Starting in-game achievement observer for shortcut ${appid}`);
        let stopped = false;
        let handle: unknown;
        const arm = () => {
            handle = timers.setTimeout(() => {
                void checkNow(appid, opts).finally(() => {
                    if (!stopped) arm();
                });
            }, POLL_MS);
        };
        arm();
        const stop = () => {
            stopped = true;
            timers.clearTimeout(handle);
            sessions.delete(appid);
            void checkNow(appid, opts); // final check on quit
            logger.info(`Stopped in-game achievement observer for shortcut ${appid}`);
        };
        sessions.set(appid, stop);
        return stop;
    }

    /**
     * A store sync after the game quit (ADR-0056): ask the store now (force), and announce what it found that the record
     * did not have, for the Post-Game Summary. No toast: the store's overlay already showed each unlock in game.
     */
    async function syncAfterQuit(appid: ShortcutId): Promise<void> {
        const before = new Set(Object.keys(current(appid)?.data?.unlocks ?? {}));
        const part = await ensure(appid, deps.routeOf(appid), { force: true, lane: "normal" });
        const set = part.data;
        if (part.status !== "ok" || !set) return;
        const items: UnlockedAchievement[] = [];
        for (const [id, u] of Object.entries(set.unlocks ?? {})) {
            if (before.has(id)) continue;
            const a = set.schema.achievements.find((x) => String(x.id) === id);
            if (!a) continue;
            items.push({ id, name: a.name, description: a.description, icon: a.icon, global_pct: a.global_pct, unlockedAt: u.unlocked_time || Math.floor(deps.now() / 1000) });
        }
        if (items.length === 0) return;
        logger.info(`Store sync found ${items.length} new unlock(s) for shortcut ${appid}: ${items.map((i) => i.id).join(", ")}`);
        deps.bus.emit("achievements.synced", { appid, items });
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
        deps.bus.emit("achievements.launch-toast", { appid });
    }

    return {
        install() {
            deps.bus.on("shortcut.launched", ({ appid, name }) => {
                if (!deps.observerEnabled()) return;
                if (isSynced(appid)) return; // the store's overlay notifies; synced when the game quits (ADR-0056)
                running.add(appid);
                launchToast(appid);
                void resolveNative(appid).then((n) => {
                    if (!running.has(appid)) return; // the game quit while the mapping loaded
                    startSession(appid, { native: n, title: name });
                });
            });
            deps.bus.on("shortcut.quit", ({ appid }) => {
                running.delete(appid);
                const stop = sessions.get(appid);
                stop?.();
                if (isSynced(appid)) {
                    void syncAfterQuit(appid);
                    return;
                }
                // New captures and unlocks: reload what the record holds for this shortcut.
                void ensure(appid, deps.routeOf(appid), { lane: "normal" });
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
                announce(appid, [item.id]);
                return true;
            } catch (e) {
                logger.error(`Error triggering achievement ${item.id}:`, e);
                return false;
            }
        },
        async resetSources(appid) {
            try {
                const res = await deps.backend.resetAchievementSources(appid, await resolveNative(appid));
                return Array.isArray(res.sources) ? res.sources : [];
            } catch (e) {
                logger.warn(`Could not list achievement sources for shortcut ${appid}:`, e);
                return [];
            }
        },
        async reset(appid, sources = []) {
            try {
                const res = await deps.backend.resetAchievements(appid, {
                    native: await resolveNative(appid),
                    sources,
                    title: deps.titleOf(appid) ?? "",
                });
                if (res.error) {
                    logger.error(`Failed resetting achievements: ${res.error}`);
                    return { ok: false, sources: [] };
                }
                const done = Array.isArray(res.sources) ? res.sources : [];
                for (const r of done) {
                    if (!r.ok) logger.warn(`Reset achievements: ${r.id}: ${r.error ?? "failed"}`);
                }
                const set = current(appid)?.data;
                if (set) deps.records.update(appid, { achievements: { ...current(appid)!, data: { ...set, unlocks: {} } } });
                logger.info(`Reset achievements for shortcut ${appid}`);
                return { ok: true, sources: done };
            } catch (e) {
                logger.error(`Error resetting achievements for shortcut ${appid}:`, e);
                return { ok: false, sources: [] };
            }
        },
        async preload() {
            const res = await deps.backend.getAllRecords({ lane: "view" });
            let added = 0;
            for (const [key, parts] of Object.entries(res.records ?? {})) {
                const appid = toShortcutId(Number(key));
                const part = parts.achievements as Part<AchievementSet> | undefined;
                if (appid === undefined || part?.status !== "ok" || !part.data) continue;
                // No library check: at start-up Steam's appStore is not populated yet (verified live 2026-09-30:
                // a titleOf check skipped every shortcut). A key for a removed shortcut is harmless, as in app/metadata's preload.
                if (current(appid)) continue;
                deps.ensureBase(appid);
                // Achievements only: preloading `identity` would make other surfaces fetch at start-up (knowledgebase Part 7).
                deps.records.update(appid, { achievements: part });
                added++;
            }
            logger.info(`Preloaded stored achievements for ${added} shortcut(s).`);
            return added;
        },
        rerenderAll() {
            let n = 0;
            for (const rec of deps.records.all()) {
                if (rec.achievements?.status !== "ok") continue;
                deps.bus.emit("record.updated", { appid: rec.appid, parts: ["achievements"] });
                n++;
            }
            return n;
        },
        resettable(appid) {
            const id = toShortcutId(appid);
            return id === undefined || !isSynced(id);
        },
        summary(appid) {
            const id = toShortcutId(appid); // the panel hands Steam's appids, signed or not
            const set = id === undefined ? undefined : current(id)?.data;
            if (!set) return undefined;
            return { nAchieved: Object.keys(set.unlocks ?? {}).length, nTotal: set.schema.total ?? 0 };
        },
    };
}
