// app/epic-launcher: the Epic Steam Overlay Workaround (ADR-0057). Steam's overlay reaches an Epic game only when Steam
// itself starts the Epic Games Launcher (launch-tracking plan § 7). With the user's setting on (off by default):
//   - Play: the launch-hold surface holds Steam's launch of an Epic launcher-link copy (the list this app sends in
//     `launch.hold-mode`); the backend closes a running launcher (never during a download); then `launch.release` lets Steam
//     launch. Every other game is never held. The list is read at start-up, when the setting turns on, when auto-add adds a
//     shortcut and after each launch.
//   - While the game runs: a tick every TICK_MS asks the backend's reaper to end the launcher once the game has exited and
//     Epic's cloud sync is done, so Steam stops showing the game as running. Nothing runs while no Epic game runs.
import { logger } from "../logger.ts";
import type { ShortcutId } from "../kernel/appid";
import type { EventBus } from "../kernel/events";
import type { backend as Backend } from "../ports/backend";

export interface EpicLauncherDeps {
    backend: Pick<typeof Backend, "storeEpicLaunchShortcuts" | "storeEpicPrelaunch" | "storeEpicReap">;
    bus: Pick<EventBus, "emit" | "on">;
    /** Setting epicOverlayWorkaround. */
    enabled(): boolean;
    /** The clock for a held launch's time (ms); default Date.now. */
    now?: () => number;
    /** The reaper's tick (default 3000 ms; tests pass a few). */
    tickMs?: number;
}

export interface EpicLauncher {
    /** Subscribe to the bus and send the hold list. */
    install(): void;
    /** The setting changed: send the new hold list. */
    settingChanged(): void;
}

const TICK_MS = 3000;

export function createEpicLauncher(deps: EpicLauncherDeps): EpicLauncher {
    /** The Epic launcher-link copies, as the backend last listed them. */
    let epic = new Set<number>();
    /** Shortcuts the reaper watches, and their next tick. */
    const watching = new Map<ShortcutId, ReturnType<typeof setTimeout> | undefined>();

    const sendMode = () => deps.bus.emit("launch.hold-mode", { appids: deps.enabled() ? ([...epic] as ShortcutId[]) : [] });

    /** Read the list again (only while the setting is on) and send it. */
    async function refresh(): Promise<void> {
        if (!deps.enabled()) {
            sendMode();
            return;
        }
        try {
            const r = await deps.backend.storeEpicLaunchShortcuts();
            if (Array.isArray(r?.appids)) epic = new Set<number>(r.appids);
        } catch (err) {
            logger.warn("Epic overlay workaround: could not list the Epic shortcuts.", err);
        }
        sendMode();
    }

    async function onHeld(appid: ShortcutId): Promise<void> {
        const heldAt = (deps.now ?? Date.now)();
        try {
            if (!deps.enabled() || !epic.has(appid)) return;
            const r = await deps.backend.storeEpicPrelaunch(appid, heldAt);
            if (r?.epic && r.closed) logger.info(`Epic overlay workaround: launcher closed before ${appid} starts.`);
            else if (r?.epic && r.reason === "pending") logger.warn(`Epic overlay workaround: a download is pending; the launcher stays open and Steam's overlay will not reach ${appid}.`);
            else if (r?.epic && r.reason === "late") logger.warn(`Epic overlay workaround: the backend answered too late; ${appid} starts with the launcher as it was.`);
        } catch (err) {
            logger.warn("Epic overlay workaround: prelaunch failed; launching anyway.", err);
        } finally {
            deps.bus.emit("launch.release", { appid });
        }
    }

    function schedule(appid: ShortcutId): void {
        watching.set(appid, setTimeout(() => void tick(appid), deps.tickMs ?? TICK_MS));
    }

    async function tick(appid: ShortcutId): Promise<void> {
        if (!watching.has(appid)) return;
        if (!deps.enabled()) {
            watching.delete(appid);
            await deps.backend.storeEpicReap(appid, "stop").catch(() => undefined);
            return;
        }
        const r = await deps.backend.storeEpicReap(appid, "tick").catch(() => undefined);
        if (!watching.has(appid)) return;
        if (!r || !r.active) {
            watching.delete(appid);
            if (r?.phase === "done") logger.info(`Epic overlay workaround: ${appid} finished (${r.reason ?? "done"}).`);
            return;
        }
        schedule(appid);
    }

    async function onLaunched(appid: ShortcutId): Promise<void> {
        if (!deps.enabled()) return;
        if (!watching.has(appid)) {
            const r = await deps.backend.storeEpicReap(appid, "start").catch(() => undefined);
            if (r?.active && !watching.has(appid)) schedule(appid);
        }
        void refresh(); // a shortcut converted or added by hand is held from its next launch on
    }

    function onQuit(appid: ShortcutId): void {
        if (!watching.has(appid)) return;
        clearTimeout(watching.get(appid));
        watching.delete(appid);
        void deps.backend.storeEpicReap(appid, "stop").catch(() => undefined);
    }

    return {
        install() {
            deps.bus.on("launch.held", ({ appid }) => void onHeld(appid));
            deps.bus.on("shortcut.launched", ({ appid }) => void onLaunched(appid));
            deps.bus.on("shortcut.quit", ({ appid }) => onQuit(appid));
            deps.bus.on("store.shortcut-added", (e) => {
                if (e.kind === "epic" && e.appid !== undefined) void refresh();
            });
            void refresh();
        },
        settingChanged: () => void refresh(),
    };
}
