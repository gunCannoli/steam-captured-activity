// Auto-add (ADR-0056 decision 6, moved here from steam-cartridges by ADR-0067). With a store's "Auto-add installed
// games" toggle on, every installed game of that store with no shortcut yet gets one, in a collection named after the
// store, so routing rules can treat the store's games together (ADR-0036); a shortcut whose game was uninstalled is
// removed. The Xbox repair (ADR-0058, ADR-0065) repoints a shortcut that runs an older version's exe, or the retired
// uwp_presenter wrapper, keeping its appid. A slow tick (TICK_MS) notices games installed while Steam runs: neither
// store tells Steam. Nothing runs while both toggles are off and the Xbox store is off.
//
// Steam's calls (verified live 2026-10-02, plan § 4.8): SteamClient.Apps.AddShortcut(name, exe, startDir, launchOptions)
// resolves to the new appid but ignores the name and the launch options, so both are set right after with
// SetShortcutName and SetShortcutLaunchOptions (the appid stays). SetShortcutExe / SetShortcutStartDir keep the appid
// too (2026-10-03). Collections: Steam's collectionStore (NewUnsavedCollection, Save, AsDragDropCollection().AddApps),
// read only once its storage map exists and the user's collections loaded (guardrail 13); fail-open.
import { backend, type InstalledStoreGame } from "./backend";
import { logger } from "./logger";
import { pushGame } from "./push";
import { setting, storesOn } from "./settings/current";

export const STORE_COLLECTIONS = { epic: "Epic Games", xbox: "Xbox" } as const;
type Kind = keyof typeof STORE_COLLECTIONS;

const TICK_MS = 60_000;
const COLLECTION_TRIES = 8;

/** Games requested this session: a game whose add/remove failed is not asked again until the next start. */
const requested = new Set<string>();
/** Repairs requested this session (appid -> exe). */
const repaired = new Map<number, string>();
let running: Promise<number> | undefined;
let added: ((appid: number, kind: Kind) => void) | undefined;

const steamApps = (): any => (window as any).SteamClient?.Apps;

function collectionStoreReady(store: any): boolean {
    const m = store?.m_mapCollectionsFromStorage;
    if (!m || typeof m.values !== "function") return false;
    try {
        return Array.isArray(store.userCollections) && store.userCollections.length > 0;
    } catch {
        return false;
    }
}

async function addToCollection(appid: number, name: string): Promise<boolean> {
    const store = (window as any).collectionStore;
    if (!name || !collectionStoreReady(store)) return false;
    const overview = (window as any).appStore?.GetAppOverviewByAppID?.(appid);
    if (!overview) return false;
    let collection = (Array.isArray(store.userCollections) ? store.userCollections : []).find((c: any) => c?.displayName === name);
    if (!collection && typeof store.NewUnsavedCollection === "function") {
        collection = store.NewUnsavedCollection(name, undefined, []);
        await collection?.Save?.();
    }
    const target = collection?.AsDragDropCollection?.();
    if (typeof target?.AddApps !== "function") return false;
    target.AddApps([overview]);
    return true;
}

async function overviewReady(appid: number, tries = 20): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
        if ((window as any).appStore?.GetAppOverviewByAppID?.(appid)) return true;
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

async function addShortcut(kind: Kind, game: InstalledStoreGame & { key?: string; launch?: { exe: string; start_dir: string; launch_options: string } }): Promise<void> {
    const apps = steamApps();
    if (typeof apps?.AddShortcut !== "function" || !game.launch) return;
    try {
        const appid = await apps.AddShortcut(game.title, game.launch.exe, game.launch.start_dir, game.launch.launch_options);
        if (typeof appid !== "number") {
            logger.warn(`Auto-add: ${kind} game ${game.key} was not added: AddShortcut answered ${JSON.stringify(appid)}`);
            return;
        }
        apps.SetShortcutName?.(appid, game.title);
        apps.SetShortcutLaunchOptions?.(appid, game.launch.launch_options);
        let filed = false;
        if (await overviewReady(appid)) {
            for (let i = 0; i < COLLECTION_TRIES && !filed; i++) {
                try {
                    filed = await addToCollection(appid, STORE_COLLECTIONS[kind]);
                } catch (err) {
                    logger.warn("Auto-add: collection failed:", err);
                    break;
                }
                if (!filed) await new Promise((r) => setTimeout(r, 1000));
            }
        }
        logger.info(`Auto-add: ${kind} game ${game.key} is shortcut ${appid}${filed ? ` in "${STORE_COLLECTIONS[kind]}"` : " (not filed in a collection)"}.`);
        void pushGame(appid >>> 0);
        added?.(appid >>> 0, kind);
    } catch (err) {
        logger.warn(`Auto-add: ${kind} game ${game.key} was not added:`, err);
    }
}

async function removeShortcut(kind: Kind, appid: number, title: string): Promise<void> {
    const apps = steamApps();
    if (typeof apps?.RemoveShortcut !== "function") return;
    try {
        await apps.RemoveShortcut(appid);
        logger.info(`Auto-add: ${kind} shortcut "${title}" (${appid}) removed (uninstalled from the store).`);
    } catch (err) {
        logger.warn(`Auto-add: ${kind} shortcut "${title}" (${appid}) was not removed:`, err);
    }
}

async function runOnce(): Promise<number> {
    const want = { epic: setting("autoAddEpicGames") === true, xbox: setting("autoAddXboxGames") === true };
    const stores = storesOn();
    want.epic = want.epic && stores.epic;
    want.xbox = want.xbox && stores.xbox;
    if (!want.epic && !want.xbox) return 0;
    const res = await backend.storeInstalledGames(stores.xbox).catch(() => undefined);
    if (!res) return 0;
    let n = 0;
    for (const kind of ["epic", "xbox"] as const) {
        if (!want[kind]) continue;
        for (const game of Array.isArray(res[kind]) ? (res[kind] as any[]) : []) {
            const id = `add:${kind}:${game.key ?? game.id}`;
            if (game.inLibrary || !game.launch || requested.has(id)) continue;
            requested.add(id);
            await addShortcut(kind, game);
            n++;
        }
        const gone = (res.uninstalled as any)?.[kind];
        for (const u of Array.isArray(gone) ? gone : []) {
            const id = `remove:${kind}:${u.appid}`;
            if (requested.has(id)) continue;
            requested.add(id);
            await removeShortcut(kind, u.appid, u.title);
            n++;
        }
    }
    return n;
}

/** Add what is missing and remove what was uninstalled; one run at a time. */
export function runSync(): Promise<number> {
    if (!running) {
        running = runOnce().catch((err) => {
            logger.warn("Auto-add failed:", err);
            return 0;
        }).finally(() => (running = undefined));
    }
    return running;
}

/** The Xbox repairs (ADR-0058, ADR-0065). */
export async function runRepairs(): Promise<number> {
    if (!storesOn().xbox) return 0;
    const res = await backend.storeXboxRepairs().catch(() => undefined);
    const apps = steamApps();
    if (typeof apps?.SetShortcutExe !== "function" || typeof apps?.SetShortcutStartDir !== "function") return 0;
    let n = 0;
    for (const r of Array.isArray(res?.repairs) ? res!.repairs : []) {
        if (repaired.get(r.appid) === r.exe) continue;
        repaired.set(r.appid, r.exe);
        try {
            apps.SetShortcutExe(r.appid, r.exe);
            apps.SetShortcutStartDir(r.appid, r.start_dir);
            if (typeof r.launch_options === "string") apps.SetShortcutLaunchOptions?.(r.appid, r.launch_options);
            logger.info(`Xbox shortcut "${(r as any).title ?? r.appid}" (${r.appid}) now runs ${r.exe}.`);
            n++;
        } catch (err) {
            logger.warn(`Xbox shortcut ${r.appid} could not be repointed:`, err);
        }
    }
    return n;
}

/** Start: a first look once Steam's collections are loaded, then one every TICK_MS. `onAdded`: a new shortcut. */
export function installStoreSync(onAdded?: (appid: number, kind: Kind) => void): void {
    added = onAdded;
    const start = async () => {
        for (let i = 0; i < 60 && !collectionStoreReady((window as any).collectionStore); i++) {
            await new Promise((r) => setTimeout(r, 1000));
        }
        await runSync();
        await runRepairs();
        setInterval(() => {
            void runSync();
            void runRepairs();
        }, TICK_MS);
    };
    void start();
}
