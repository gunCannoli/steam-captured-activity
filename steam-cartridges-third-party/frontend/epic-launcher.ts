// The Epic Steam Overlay Workaround (ADR-0057; moved here from steam-cartridges by ADR-0067). Steam's overlay reaches an
// Epic game only when Steam itself starts the Epic Games Launcher (launch-tracking plan § 7). With the setting on (off by
// default):
//   - Play: Steam's launch of an Epic launcher-link copy is held for a moment (a wrap of SteamClient.Apps.RunGame) while
//     the backend closes a running launcher (never during a download); then Steam launches. Any other game goes to Steam
//     untouched. Fail-open: a held launch goes on after MAX_HOLD_MS even without an answer.
//   - While the game runs: a tick every TICK_MS asks the backend's reaper to end the launcher once the game has exited and
//     Epic's cloud sync is done, so Steam stops showing the game as running.
//
// Verified live 2026-10-03 (plan § 4 P, E8): SteamClient.Apps.RunGame is an own, writable, configurable property, and
// Steam's Play paths look it up when called (the library Play action, with its Big Picture branch, and the game list);
// their callers ignore its return value. A launch from outside Steam's UI (a desktop shortcut, a steam://rungameid link)
// does not pass through it.
import { backend } from "./backend";
import { logger } from "./logger";
import { onLaunched, onQuit } from "./lifecycle";
import { onSettingChange, setting } from "./settings/current";

const TICK_MS = 3000;
const MAX_HOLD_MS = 10_000;

/** The Epic launcher-link copies, as the backend last listed them (held at Play while the setting is on). */
let epic = new Set<number>();
const watching = new Map<number, ReturnType<typeof setTimeout> | undefined>();
const held = new Map<number, { args: unknown[]; timer: ReturnType<typeof setTimeout> }>();
let original: ((...args: unknown[]) => unknown) | undefined;
let wrapped: ((...args: unknown[]) => unknown) | undefined;

const enabled = () => setting("epicOverlayWorkaround") === true;
const steamApps = (): any => (window as any).SteamClient?.Apps;

/** The shortcut appid of a 64-bit game id (`appid << 32 | 0x02000000`), or undefined for anything else. */
function shortcutOf(gameId: unknown): number | undefined {
    try {
        const big = BigInt(String(gameId));
        if ((big & 0xffffffffn) !== 0x02000000n) return undefined;
        return Number(big >> 32n);
    } catch {
        return undefined;
    }
}

function release(appid: number): void {
    const h = held.get(appid);
    if (!h) return;
    clearTimeout(h.timer);
    held.delete(appid);
    try {
        original?.apply(steamApps(), h.args);
    } catch (err) {
        logger.warn("Epic overlay workaround: Steam's launch failed after the hold:", err);
    }
}

async function onHeld(appid: number): Promise<void> {
    const heldAt = Date.now();
    try {
        const r = await backend.storeEpicPrelaunch(appid, heldAt);
        if (r?.epic && r.closed) logger.info(`Epic overlay workaround: launcher closed before ${appid} starts.`);
        else if (r?.epic && r.reason === "pending") logger.warn(`Epic overlay workaround: a download is pending; the launcher stays open and Steam's overlay will not reach ${appid}.`);
        else if (r?.epic && r.reason === "late") logger.warn(`Epic overlay workaround: the backend answered too late; ${appid} starts with the launcher as it was.`);
        else if (r?.epic && r.reason === "not-running") logger.info(`Epic overlay workaround: no Epic launcher was running; Steam starts it for ${appid}.`);
        else if (r?.epic) logger.warn(`Epic overlay workaround: the launcher was not closed before ${appid} (${r.reason ?? "unknown"}).`);
    } catch (err) {
        logger.warn("Epic overlay workaround: prelaunch failed; launching anyway.", err);
    } finally {
        release(appid);
    }
}

function wrapRunGame(): void {
    const apps = steamApps();
    if (typeof apps?.RunGame !== "function" || original) return;
    original = apps.RunGame;
    wrapped = function (this: unknown, ...args: unknown[]) {
        try {
            const appid = enabled() && epic.size > 0 ? shortcutOf(args[0]) : undefined;
            if (appid !== undefined && epic.has(appid)) {
                if (held.has(appid)) return undefined; // Play pressed again while held: the first press goes on
                const timer = setTimeout(() => release(appid), MAX_HOLD_MS);
                held.set(appid, { args, timer });
                void onHeld(appid);
                return undefined;
            }
        } catch (err) {
            logger.warn("Epic overlay workaround: the hold failed; launching normally.", err);
        }
        return original!.apply(apps, args);
    };
    apps.RunGame = wrapped;
}

/** Read the list of Epic launcher-link copies again (only while the setting is on). */
export async function refreshEpicList(): Promise<void> {
    if (!enabled()) {
        epic = new Set<number>();
        for (const appid of [...held.keys()]) release(appid);
        return;
    }
    try {
        const r = await backend.storeEpicLaunchShortcuts();
        if (Array.isArray(r?.appids)) epic = new Set<number>(r.appids);
    } catch (err) {
        logger.warn("Epic overlay workaround: could not list the Epic shortcuts.", err);
    }
}

function schedule(appid: number): void {
    watching.set(appid, setTimeout(() => void tick(appid), TICK_MS));
}

async function tick(appid: number): Promise<void> {
    if (!watching.has(appid)) return;
    if (!enabled()) {
        watching.delete(appid);
        await backend.storeEpicReap(appid, "stop").catch(() => undefined);
        return;
    }
    const r = await backend.storeEpicReap(appid, "tick").catch(() => undefined);
    if (!watching.has(appid)) return;
    if (!r || !r.active) {
        watching.delete(appid);
        if (r?.phase === "done") logger.info(`Epic overlay workaround: ${appid} finished (${r.reason ?? "done"}).`);
        return;
    }
    schedule(appid);
}

export function installEpicLauncher(): void {
    wrapRunGame();
    onLaunched((appid) => {
        if (!enabled()) return;
        void (async () => {
            if (!watching.has(appid)) {
                const r = await backend.storeEpicReap(appid, "start").catch(() => undefined);
                if (r?.active && !watching.has(appid)) schedule(appid);
            }
            void refreshEpicList(); // a shortcut converted or added by hand is held from its next launch on
        })();
    });
    onQuit((appid) => {
        if (!watching.has(appid)) return;
        clearTimeout(watching.get(appid));
        watching.delete(appid);
        void backend.storeEpicReap(appid, "stop").catch(() => undefined);
    });
    onSettingChange((key) => {
        if (key === "epicOverlayWorkaround") void refreshEpicList();
    });
    void refreshEpicList();
}
