// Surface `launch-hold` (ADR-0057, Epic Steam Overlay Workaround): holds Steam's launch of an Epic shortcut for a moment, so
// the backend can close a running Epic Games Launcher first. Steam's overlay reaches an Epic game only when Steam itself
// starts the launcher (launch-tracking plan § 7, E1 and E8). It decides nothing and fetches nothing: app/epic-launcher names
// the shortcuts to hold (`launch.hold-mode`, empty = none) and answers each `launch.held` with `launch.release`. Any other
// launch goes to Steam untouched.
//
// Verified live 2026-10-03 (plan § 4 P, E8): SteamClient.Apps.RunGame is an own, writable, configurable property, and
// Steam's Play paths look it up when called (the library Play action, with its Big Picture branch, and the game list), so a
// wrap here sees Steam's own Play button; their callers ignore its return value. A launch from outside Steam's UI (a desktop
// shortcut, a steam://rungameid link) does not pass through it. Fail-open: a held launch goes on after MAX_HOLD_MS even
// without an answer (the backend closes nothing for a request older than 3 s, store_launch.LATE), and Steam's original is
// called with the same arguments.
import { fromGameId, type ShortcutId } from "../../kernel/appid.ts";
import type { Events, EventBus } from "../../kernel/events";
import type { Surface, SurfaceDeps } from "../../kernel/surface";

interface Deps extends SurfaceDeps {
    bus: Pick<EventBus, "emit">;
    /** The longest a launch is held without an answer (default 10000 ms; tests pass a few). */
    maxHoldMs?: number;
}

const ID = "launch-hold";
const MAX_HOLD_MS = 10_000;

const deps: Deps = { isEnabled: () => true, reportError: () => {}, bus: { emit: () => {} } };

let holding = new Set<number>();
let original: ((...args: unknown[]) => unknown) | undefined;
let wrapped: ((...args: unknown[]) => unknown) | undefined;
const held = new Map<ShortcutId, { args: unknown[]; timer: ReturnType<typeof setTimeout> }>();

const steamApps = (): any => (window as any).SteamClient?.Apps;

function release(appid: ShortcutId): void {
    const h = held.get(appid);
    if (!h) return;
    clearTimeout(h.timer);
    held.delete(appid);
    try {
        original?.apply(steamApps(), h.args);
    } catch (err) {
        deps.reportError(ID, err);
    }
}

/** `launch.hold-mode` (index.tsx subscribes it): the shortcuts to hold at Play (empty = none). */
export function onHoldMode(e: Events["launch.hold-mode"]): void {
    holding = new Set<number>(e.appids);
    for (const appid of [...held.keys()]) if (!holding.has(appid)) release(appid);
}

/** `launch.release` (index.tsx subscribes it): let a held launch go on. */
export function onRelease(e: Events["launch.release"]): void {
    release(e.appid);
}

function install(): void {
    const apps = steamApps();
    if (typeof apps?.RunGame !== "function" || original) return;
    original = apps.RunGame;
    wrapped = function (this: unknown, ...args: unknown[]) {
        try {
            const appid = holding.size > 0 && deps.isEnabled(ID) ? fromGameId(String(args[0])) : undefined;
            if (appid !== undefined && holding.has(appid)) {
                if (held.has(appid)) return undefined; // Play pressed again while held: the first press goes on
                const timer = setTimeout(() => release(appid), deps.maxHoldMs ?? MAX_HOLD_MS);
                held.set(appid, { args, timer });
                deps.bus.emit("launch.held", { appid });
                return undefined;
            }
        } catch (err) {
            deps.reportError(ID, err);
        }
        return original!.apply(apps, args);
    };
    apps.RunGame = wrapped;
}

function uninstall(): void {
    for (const appid of [...held.keys()]) release(appid);
    const apps = steamApps();
    if (apps && wrapped && apps.RunGame === wrapped && original) apps.RunGame = original;
    original = wrapped = undefined;
    holding = new Set<number>();
}

export function createLaunchHoldSurface(d: Deps): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.bus = d.bus;
    deps.maxHoldMs = d.maxHoldMs;
    return {
        id: ID,
        touches: ["SteamClient.Apps.RunGame"],
        reads: [],
        install,
        render() {
            /* event-driven (launch.hold-mode, launch.release), never per record */
        },
        clear() {},
        uninstall,
    };
}
