// Mute Steam's notifications while an Xbox game runs (ADR-0065, setting "muteXboxNotifications", off by default).
// Xbox games get no Steam overlay, so Steam's toasts pop on the desktop over the game (or behind it in Big Picture).
//
// Start: Steam reports a shortcut running and the backend says it is an Xbox copy.
// End:   Steam no longer reports it running and no process runs from the game's package folder. A UWP game (U0,
//        ADR-0058) runs under Steam's tree, so Steam's state alone is right; a GDK game is opened through Explorer
//        and leaves Steam's tree within seconds (launch-tracking plan F18), so the backend checks its folder every
//        POLL_MS, and a launch that never shows a process is given START_GRACE_MS before it counts as over.
import { pluginConfig, subscribePluginConfig } from "@steambrew/client";
import { backend } from "./backend";
import { setToastsMuted } from "./toast-mute";

const SETTING = "muteXboxNotifications";
const POLL_MS = 15_000;
const START_GRACE_MS = 90_000;

interface Session {
    steamRunning: boolean;
    startedAt: number;
    seen: boolean;
}

const sessions = new Map<number, Session>();
let enabled = false;
let timer: number | undefined;
let polling = false;

function update(): void {
    const on = enabled && sessions.size > 0;
    setToastsMuted(on);
    if (on && timer === undefined) timer = window.setInterval(() => void poll(), POLL_MS);
    if (!on && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
    }
}

async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
        for (const [appid, s] of [...sessions]) {
            const r = await backend.storeXboxRunning(appid).catch(() => undefined);
            if (r?.running) {
                s.seen = true;
                continue;
            }
            if (r === undefined || s.steamRunning) continue; // a failed call keeps the mute; Steam still runs it
            if (s.seen || Date.now() - s.startedAt > START_GRACE_MS) sessions.delete(appid);
        }
    } finally {
        polling = false;
        update();
    }
}

async function onLifetime(appid: number, running: boolean): Promise<void> {
    const known = sessions.get(appid);
    if (!running) {
        if (known) {
            known.steamRunning = false;
            void poll();
        }
        return;
    }
    if (!enabled) return;
    if (known) {
        known.steamRunning = true;
        return;
    }
    const r = await backend.storeXboxRunning(appid).catch(() => undefined);
    if (!r?.xbox) return;
    sessions.set(appid, { steamRunning: true, startedAt: Date.now(), seen: r.running === true });
    update();
}

function setEnabled(on: unknown): void {
    enabled = on === true;
    if (!enabled) sessions.clear();
    update();
}

let installed = false;

export function installXboxMute(): void {
    if (installed) return;
    installed = true;
    pluginConfig.get<boolean>(SETTING).then(setEnabled).catch(() => {});
    subscribePluginConfig((key: string, val: unknown) => {
        if (key === SETTING) setEnabled(val);
    });
    const sessionsApi = (window as any).SteamClient?.GameSessions;
    if (typeof sessionsApi?.RegisterForAppLifetimeNotifications !== "function") {
        console.warn("[steam-cartridges-third-party] SteamClient.GameSessions.RegisterForAppLifetimeNotifications not found; Xbox notification mute unavailable.");
        return;
    }
    sessionsApi.RegisterForAppLifetimeNotifications((n: { unAppID?: number; bRunning?: boolean }) => {
        const appid = Number(n?.unAppID) >>> 0;
        if (appid) void onLifetime(appid, n?.bRunning === true);
    });
}
