// The background observer (ADR-0063): steam-cartridges says when a shortcut is viewed, launched or quit; this plugin
// reads or watches the game's files and pushes what it finds with `reportUnlocks`. The core keeps only what is new.
// The first snapshot of a session is silent (old unlocks never toast); later changes are announced.
import { callLocalBackend, unlocksOf, type AppContext, type LocalUnlock } from "./backend";
import { getSetting } from "./settings/settings";

const PROVIDER_ID = "steam-cartridges-local";
/** The pause after one poll settles before the next. */
const POLL_MS = 2000;

interface CoreApi {
    version?: string;
    reportUnlocks?(appid: number, unlocks: LocalUnlock[], opts: { providerId: string; silent?: boolean }): Promise<{ accepted: string[] }>;
    onAppViewed?(cb: (ctx: AppContext) => void): () => void;
    onAppLaunched?(cb: (ctx: AppContext) => void): () => void;
    onAppQuit?(cb: (ctx: AppContext) => void): () => void;
}

/** Subscribes to the core's lifecycle. false when the core is too old to take pushed unlocks (before 1.1.0). */
export function installObserver(api: CoreApi): boolean {
    const push = api.reportUnlocks;
    const onLaunched = api.onAppLaunched;
    if (typeof push !== "function" || typeof onLaunched !== "function") {
        console.warn(`[${PROVIDER_ID}] steam-cartridges ${api.version ?? "?"} cannot take pushed unlocks (needs 1.1.0); the observer is off.`);
        return false;
    }
    const report = (appid: number, unlocks: LocalUnlock[], silent: boolean) => {
        if (unlocks.length === 0) return;
        void push.call(api, appid, unlocks, { providerId: PROVIDER_ID, silent }).catch(() => undefined);
    };
    const sessions = new Map<number, () => void>();

    api.onAppViewed?.((ctx) => {
        void callLocalBackend<{ unlocks?: unknown }>("LocalReadUnlocks", ctx).then((res) => report(ctx.appid, unlocksOf(res), true));
    });

    onLaunched.call(api, (ctx) => {
        void (async () => {
            if (!(await getSetting("watchWhilePlaying"))) return;
            sessions.get(ctx.appid)?.();
            const start = await callLocalBackend<{ unlocks?: unknown }>("LocalWatchStart", ctx);
            report(ctx.appid, unlocksOf(start), true);
            let stopped = false;
            let handle: ReturnType<typeof setTimeout> | undefined;
            const arm = () => {
                handle = setTimeout(() => {
                    void callLocalBackend<{ changed?: boolean; unlocks?: unknown }>("LocalWatchPoll", { appid: ctx.appid })
                        .then((res) => {
                            if (res?.changed) report(ctx.appid, unlocksOf(res), false);
                        })
                        .finally(() => {
                            if (!stopped) arm();
                        });
                }, POLL_MS);
            };
            arm();
            sessions.set(ctx.appid, () => {
                stopped = true;
                if (handle !== undefined) clearTimeout(handle);
                sessions.delete(ctx.appid);
            });
        })();
    });

    api.onAppQuit?.((ctx) => {
        const stop = sessions.get(ctx.appid);
        if (!stop) return;
        stop();
        void callLocalBackend<{ changed?: boolean; unlocks?: unknown }>("LocalWatchStop", { appid: ctx.appid }).then((res) => {
            if (res?.changed) report(ctx.appid, unlocksOf(res), false);
        });
    });
    return true;
}
