// Surface `library-shortcuts` (ADR-0056, ADR-0058): the only code that adds a shortcut to the user's library, or repoints
// one of the plugin's Xbox shortcuts after an app update. It runs what
// app/store-sync decided (an installed Epic or Xbox game that has no shortcut yet, with the "Auto-add" toggle on)
// and reports the result as its own event; it decides nothing and fetches nothing.
//
// Verified live 2026-10-02 (plan § 4.8, step 0.7): SteamClient.Apps.AddShortcut(name, exe, startDir, launchOptions)
// resolves to the new appid and writes shortcuts.vdf at once, but ignores the name (the shortcut is named after the
// exe) and the launch options (stored empty): both are set right after with SetShortcutName and
// SetShortcutLaunchOptions, which keep the appid. Exe and start dir are stored as given.
//
// The collection: Steam's collectionStore (NewUnsavedCollection, a collection's Save and AsDragDropCollection().AddApps,
// the calls Steam's own UI makes); read only once its storage map exists (guardrail 13). Not verified on this build:
// fail-open, the shortcut is added either way and the log says the collection was skipped.
import { logger } from "../../logger.ts";
import type { Events, EventBus } from "../../kernel/events";
import type { Surface, SurfaceDeps } from "../../kernel/surface";

interface Deps extends SurfaceDeps {
    bus: Pick<EventBus, "emit">;
    /** Pause between attempts to file a shortcut in its collection (default 1000 ms; tests pass a few). */
    retryMs?: number;
}

const deps: Deps = { isEnabled: () => true, reportError: () => {}, bus: { emit: () => {} } };

/** At start-up Steam's collections load a moment after its storage map exists: how often, and how long, to wait for them. */
const COLLECTION_TRIES = 8;

const steamApps = (): any => (window as any).SteamClient?.Apps;

/**
 * Guardrail 13: userCollections is a keepAlive computed that throws (and stays poisoned) before its storage exists, so the
 * storage map is checked first. Then the user's collections must have loaded (every library has some): a list still empty
 * would make us create a second "Epic Games" collection instead of finding the first (found live 2026-10-03: the first
 * add after a restart could not be filed).
 */
function collectionStoreReady(store: any): boolean {
    const m = store?.m_mapCollectionsFromStorage;
    if (!m || typeof m.values !== "function") return false;
    try {
        return Array.isArray(store.userCollections) && store.userCollections.length > 0;
    } catch {
        return false;
    }
}

/** Put a shortcut in the named user collection, creating the collection when missing. false when Steam's API is not there. */
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

/** Waits for Steam to know the new shortcut (its overview appears a moment after AddShortcut resolves). */
async function overviewReady(appid: number, tries = 20): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
        if ((window as any).appStore?.GetAppOverviewByAppID?.(appid)) return true;
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

/** `store.add-requested` (index.tsx subscribes it): add the shortcut, name it, set its launch options, file it. */
export async function onAddRequested(e: Events["store.add-requested"]): Promise<void> {
    if (!deps.isEnabled("library-shortcuts")) return;
    const apps = steamApps();
    if (typeof apps?.AddShortcut !== "function") {
        deps.bus.emit("store.shortcut-added", { kind: e.kind, key: e.key, error: "SteamClient.Apps.AddShortcut not found" });
        return;
    }
    try {
        const appid = await apps.AddShortcut(e.title, e.launch.exe, e.launch.start_dir, e.launch.launch_options);
        if (typeof appid !== "number") {
            deps.bus.emit("store.shortcut-added", { kind: e.kind, key: e.key, error: `AddShortcut answered ${JSON.stringify(appid)}` });
            return;
        }
        apps.SetShortcutName?.(appid, e.title);
        apps.SetShortcutLaunchOptions?.(appid, e.launch.launch_options);
        let filed = false;
        if (e.collection && (await overviewReady(appid))) {
            for (let i = 0; i < COLLECTION_TRIES && !filed; i++) {
                try {
                    filed = await addToCollection(appid, e.collection);
                } catch (err) {
                    deps.reportError("library-shortcuts", err);
                    break;
                }
                if (!filed) await new Promise((r) => setTimeout(r, deps.retryMs ?? 1000));
            }
            if (!filed) logger.warn(`Added "${e.title}" but could not put it in the "${e.collection}" collection.`);
        }
        deps.bus.emit("store.shortcut-added", { kind: e.kind, key: e.key, appid, collection: filed ? e.collection : undefined });
    } catch (err) {
        deps.reportError("library-shortcuts", err);
        deps.bus.emit("store.shortcut-added", { kind: e.kind, key: e.key, error: String(err) });
    }
}

/**
 * `store.repair-requested` (index.tsx subscribes it, ADR-0058): point an Xbox U0 shortcut at the current version's exe after an
 * app update. SetShortcutExe / SetShortcutStartDir keep the appid (verified live 2026-10-03 on an Epic shortcut), so the
 * game's playtime and activity stay.
 */
export function onRepairRequested(e: Events["store.repair-requested"]): void {
    if (!deps.isEnabled("library-shortcuts")) return;
    const apps = steamApps();
    if (typeof apps?.SetShortcutExe !== "function" || typeof apps?.SetShortcutStartDir !== "function") {
        deps.bus.emit("store.shortcut-repaired", { appid: e.appid, title: e.title, error: "SteamClient.Apps.SetShortcutExe not found" });
        return;
    }
    try {
        apps.SetShortcutExe(e.appid, e.exe);
        apps.SetShortcutStartDir(e.appid, e.start_dir);
        deps.bus.emit("store.shortcut-repaired", { appid: e.appid, title: e.title });
    } catch (err) {
        deps.reportError("library-shortcuts", err);
        deps.bus.emit("store.shortcut-repaired", { appid: e.appid, title: e.title, error: String(err) });
    }
}

/** `store.remove-requested` (index.tsx subscribes it): remove the shortcut for an uninstalled store game. */
export async function onRemoveRequested(e: Events["store.remove-requested"]): Promise<void> {
    if (!deps.isEnabled("library-shortcuts")) return;
    const apps = steamApps();
    if (typeof apps?.RemoveShortcut !== "function") {
        deps.bus.emit("store.shortcut-removed", { kind: e.kind, key: e.key, appid: e.appid, title: e.title, error: "SteamClient.Apps.RemoveShortcut not found" });
        return;
    }
    try {
        await apps.RemoveShortcut(e.appid);
        deps.bus.emit("store.shortcut-removed", { kind: e.kind, key: e.key, appid: e.appid, title: e.title });
    } catch (err) {
        deps.reportError("library-shortcuts", err);
        deps.bus.emit("store.shortcut-removed", { kind: e.kind, key: e.key, appid: e.appid, title: e.title, error: String(err) });
    }
}

export function createLibraryShortcutsSurface(d: Deps): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    deps.bus = d.bus;
    deps.retryMs = d.retryMs;
    return {
        id: "library-shortcuts",
        touches: [
            "SteamClient.Apps.AddShortcut",
            "SteamClient.Apps.RemoveShortcut",
            "SteamClient.Apps.SetShortcutName",
            "SteamClient.Apps.SetShortcutLaunchOptions",
            "SteamClient.Apps.SetShortcutExe",
            "SteamClient.Apps.SetShortcutStartDir",
            "collectionStore.NewUnsavedCollection",
            "Collection.AsDragDropCollection.AddApps",
        ],
        reads: [],
        install() {},
        render() {
            /* event-driven (store.add-requested, store.remove-requested, store.repair-requested), never per record */
        },
        clear() {},
        uninstall() {},
    };
}
