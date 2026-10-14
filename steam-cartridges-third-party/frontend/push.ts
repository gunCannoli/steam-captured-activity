// The push to steam-cartridges (ADR-0067): for every shortcut that is an Epic or Xbox copy, this plugin asks its own
// backend for the game's Game Info, screenshots and the player's achievements (StoreGameData) and reports them through
// the core's extension API (`reportGame`, `reportAchievementSet`). The core stores them and shows them like any
// source; it never asks a store itself.
//   - start-up: every copy in the library, one at a time, Game Info and achievements;
//   - a page view: that copy again when its last push is older than REFRESH_MS (unlocks made outside Steam);
//   - after a copy quits: its achievements (the store's overlay already showed the unlocks; the core's Post-Game
//     Summary and feed get them, no toast), again after QUIT_RETRY_MS (Epic syncs a few seconds late).
// A copy the core learns about from auto-add is pushed by store-sync right after it is added.
import { backend } from "./backend";
import { logger } from "./logger";
import { onQuit } from "./lifecycle";
import { storesOn } from "./settings/current";

export const PROVIDER_ID = "steam-cartridges-third-party";
const REFRESH_MS = 15 * 60 * 1000;
const QUIT_RETRY_MS = 20_000;

interface CoreApi {
    version?: string;
    reportGame?(appid: number, game: unknown, opts: { providerId: string }): Promise<{ ok: boolean; changed?: boolean }>;
    reportAchievementSet?(appid: number, set: unknown, opts: { providerId: string }): Promise<{ ok: boolean; new: string[] }>;
    forgetGame?(appid: number, opts: { providerId: string }): Promise<{ ok: boolean }>;
    onAppViewed?(cb: (ctx: { appid: number }) => void): () => void;
}

let api: CoreApi | undefined;
/** When each copy was last pushed (ms), and which shortcuts are copies (from the last library read). */
const pushedAt = new Map<number, number>();
const copies = new Set<number>();
let chain: Promise<unknown> = Promise.resolve();

/** One push at a time: the backend's Lua host serves one call at a time, and the store APIs prefer it too. */
function queue<T>(job: () => Promise<T>): Promise<T | undefined> {
    const next = chain.then(job, job).catch((err) => {
        logger.warn("push failed:", err);
        return undefined;
    });
    chain = next;
    return next;
}

/** Ask the backend for a copy and report it. `achievements`: also the player's set. Resolves to whether it is a copy. */
export function pushGame(appid: number, opts: { achievements?: boolean } = {}): Promise<boolean | undefined> {
    return queue(async () => {
        if (!api?.reportGame) return false;
        const stores = storesOn();
        const data = await backend.storeGameData(appid, stores.epic, stores.xbox, opts.achievements !== false);
        if (!data || (data as any).error) return false;
        if (!data.copy) {
            if (copies.has(appid)) {
                copies.delete(appid);
                await api.forgetGame?.(appid, { providerId: PROVIDER_ID });
            }
            return false;
        }
        copies.add(appid);
        await api.reportGame(appid, {
            source: data.copy.kind,
            title: data.copy.title,
            metadata: data.metadata ?? undefined,
            media: Array.isArray(data.media) ? data.media : undefined,
        }, { providerId: PROVIDER_ID });
        if (data.achievements && api.reportAchievementSet) {
            const res = await api.reportAchievementSet(appid, data.achievements, { providerId: PROVIDER_ID });
            if (res?.new?.length) logger.info(`${data.copy.kind} reports ${res.new.length} new unlock(s) for ${appid}.`);
        }
        pushedAt.set(appid, Date.now());
        return true;
    });
}

/** Start-up: every copy in the library. */
async function pushLibrary(): Promise<void> {
    const stores = storesOn();
    const res = await backend.storeLibraryCopies(stores.epic, stores.xbox).catch(() => undefined);
    const list = Array.isArray(res?.copies) ? res!.copies : [];
    for (const c of list) copies.add(c.appid);
    logger.info(`Pushing ${list.length} store cop${list.length === 1 ? "y" : "ies"} to Steam Cartridges.`);
    for (const c of list) await pushGame(c.appid);
}

/** Start the push once the core's API is there. */
export function installPush(core: CoreApi): void {
    if (api) return;
    if (typeof core?.reportGame !== "function") {
        logger.warn(`Steam Cartridges ${core?.version ?? "?"} has no reportGame (needs 1.2.0): Epic and Xbox data are not shown.`);
        return;
    }
    api = core;
    core.onAppViewed?.((ctx) => {
        const appid = Number(ctx?.appid) >>> 0;
        if (!appid) return;
        const last = pushedAt.get(appid);
        if (last !== undefined && Date.now() - last < REFRESH_MS) return;
        if (last === undefined && !copies.has(appid)) return; // not a copy as of the library read; auto-add pushes new ones
        void pushGame(appid);
    });
    onQuit((appid) => {
        if (!copies.has(appid)) return;
        void pushGame(appid);
        setTimeout(() => void pushGame(appid), QUIT_RETRY_MS);
    });
    void pushLibrary();
}

/** A store was switched on or off: push again (a switched-off store's copies are forgotten by the next push). */
export function storesChanged(): void {
    for (const appid of [...copies]) void pushGame(appid);
    void pushLibrary();
}
