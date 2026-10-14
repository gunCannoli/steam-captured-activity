// Which shortcut starts and stops: Steam's own app lifetime events (SteamClient.GameSessions), one listener for the
// whole plugin (the push after a game, the Epic launcher reaper, the Xbox notification mute). Independent of
// steam-cartridges: it works whatever the core is doing.
import { logger } from "./logger";

type Listener = (appid: number) => void;

const launched: Listener[] = [];
const quit: Listener[] = [];
let installed = false;

function fan(list: Listener[], appid: number): void {
    for (const fn of list) {
        try {
            fn(appid);
        } catch (err) {
            logger.warn("lifecycle listener failed:", err);
        }
    }
}

export function installLifecycle(): void {
    if (installed) return;
    installed = true;
    const sessions = (window as any).SteamClient?.GameSessions;
    if (typeof sessions?.RegisterForAppLifetimeNotifications !== "function") {
        logger.warn("SteamClient.GameSessions.RegisterForAppLifetimeNotifications not found; launches are not followed.");
        return;
    }
    sessions.RegisterForAppLifetimeNotifications((n: { unAppID?: number; bRunning?: boolean }) => {
        const appid = Number(n?.unAppID) >>> 0;
        if (!appid) return;
        fan(n?.bRunning === true ? launched : quit, appid);
    });
}

export function onLaunched(fn: Listener): void {
    launched.push(fn);
}

export function onQuit(fn: Listener): void {
    quit.push(fn);
}
