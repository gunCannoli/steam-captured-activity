// app/store-sync: auto-add (ADR-0056, decision 6). With a store's "Auto-add installed games" toggle on, every installed
// game of that store with no shortcut yet gets one, in a collection named after the store, so the routing rules can
// treat the store's games together (ADR-0036). Off by default; a shortcut is never removed automatically (the user's
// decisions, 2026-10-02). The library-shortcuts surface does the writing (`store.add-requested`).
import { logger } from "../logger.ts";
import type { EventBus } from "../kernel/events";
import type { StoreKind } from "../kernel/record";
import type { backend as Backend, InstalledStoreGame } from "../ports/backend";

/** The collection each store's added games go into. */
export const STORE_COLLECTIONS: Record<StoreKind, string> = { epic: "Epic Games", xbox: "Xbox" };

export interface StoreSyncDeps {
    backend: Pick<typeof Backend, "storeInstalledGames">;
    bus: Pick<EventBus, "emit" | "on">;
    /** Settings autoAddEpicGames / autoAddXboxGames. */
    autoAdd(): Record<StoreKind, boolean>;
    /** Settings services.xboxEnabled: may the catalog be asked for a game's name. */
    allowXbox(): boolean;
}

export interface StoreSync {
    /** Log the surface's results. */
    install(): void;
    /** Add what is missing; resolves to how many shortcuts were requested. One run at a time. */
    run(): Promise<number>;
    /** The installed games of both stores, for the Third-party settings section. */
    installed(): Promise<{ epic: InstalledStoreGame[]; xbox: InstalledStoreGame[]; epicLauncher: boolean }>;
}

export function createStoreSync(deps: StoreSyncDeps): StoreSync {
    /** Games requested this session: a game whose add failed is not asked again until the next start. */
    const requested = new Set<string>();
    let running: Promise<number> | undefined;

    async function installed() {
        const res = await deps.backend.storeInstalledGames(deps.allowXbox());
        return {
            epic: Array.isArray(res?.epic) ? res.epic : [],
            xbox: Array.isArray(res?.xbox) ? res.xbox : [],
            epicLauncher: res?.epicLauncher === true,
        };
    }

    async function runOnce(): Promise<number> {
        const want = deps.autoAdd();
        if (!want.epic && !want.xbox) return 0;
        const list = await installed();
        let n = 0;
        for (const kind of ["epic", "xbox"] as const) {
            if (!want[kind]) continue;
            for (const game of list[kind]) {
                const id = `${kind}:${game.key}`;
                if (game.inLibrary || !game.launch || requested.has(id)) continue;
                requested.add(id);
                deps.bus.emit("store.add-requested", { kind, key: game.key, title: game.title, launch: game.launch, collection: STORE_COLLECTIONS[kind] });
                n++;
            }
        }
        if (n > 0) logger.info(`Auto-add: ${n} installed store game(s) requested as shortcuts.`);
        return n;
    }

    return {
        install() {
            deps.bus.on("store.shortcut-added", (e) => {
                if (e.error) logger.warn(`Auto-add: ${e.kind} game ${e.key} was not added: ${e.error}`);
                else logger.info(`Auto-add: ${e.kind} game ${e.key} is shortcut ${e.appid}${e.collection ? ` in "${e.collection}"` : ""}.`);
            });
        },
        run() {
            if (!running) running = runOnce().catch((err) => {
                logger.warn("Auto-add failed:", err);
                return 0;
            }).finally(() => (running = undefined));
            return running;
        },
        installed,
    };
}
