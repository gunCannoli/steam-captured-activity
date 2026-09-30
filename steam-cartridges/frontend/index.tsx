import { definePlugin, IconsModule } from "@steambrew/client";
import { logger } from "./logger";
import {
    createCapturesSurface,
    patch as patchLibraryApp,
    refresh as refreshLibraryApp,
    onUnlocked as capturesOnUnlocked,
    onWindowClosed as capturesWindowClosed,
    onWindowOpened as capturesWindowOpened,
    setContentListener,
    unpatch as unpatchLibraryApp,
} from "./surfaces/captures";
import {
    createLibraryHomeSurface,
    ready as libraryHomeReady,
    refresh as refreshLibraryHome,
} from "./surfaces/library-home";
import { createView } from "./app/view";
import { createIngest } from "./app/ingest";
import { createNativeLinksSurface, wrapNavigators } from "./surfaces/native-links";
import { createArtworkSurface } from "./surfaces/artwork";
import {
    initSettings,
    onSettingChange,
    resetSettings,
    setSetting,
    setting,
} from "./settings/settings";
import { SettingsPanel } from "./settings/panel";
import { createRouting } from "./app/routing";
import { createRecords } from "./app/records";
import { createRenderQueue } from "./app/render-queue";
import { createIdentity } from "./app/identity";
import { createMetadata } from "./app/metadata";
import { createArtwork } from "./app/artwork";
import { fetchImage } from "./ports/image";
import { createAchievements } from "./app/achievements";
import { ownedCandidates } from "./sensors/owned-apps";
import { loadStoreItem } from "./sensors/store-item";
import { createFeatureSwitches, FEATURE_IDS, type FeatureId } from "./safety/features";
import { beginBoot, watchBoot } from "./safety/boot";
import type { ShortcutId } from "./kernel/appid";
import { bus } from "./app/bus";
import { installViewSensor } from "./sensors/view";
import { installLifecycleSensor } from "./sensors/lifecycle";
import { collectionsSource } from "./sensors/collections";
import { listShortcuts, shortcutTitle } from "./sensors/shortcuts";
import { createSurfaceRunner, type SurfaceDeps } from "./kernel/surface";
import { backend } from "./ports/backend";
import {
    createSectionsSurface,
    refreshSections,
    setHasContent,
} from "./surfaces/sections";
import {
    createGameInfoSurface,
    ensureAppOverviewHooked,
    trackInstance,
} from "./surfaces/game-info";
import { createPlaybarSurface } from "./surfaces/playbar";
import { createController } from "./app/controller";
import { setPanelContext } from "./settings/context";
import { createSteamStore } from "./app/steam-store";
import {
    createAchievementsSurface,
    ensureAchievementsStoreHooked,
    getLocalAchievements,
    getLocalSchema,
} from "./surfaces/achievements";
import {
    createToastsSurface,
    dispatchAchievementToast,
    installTestHook as installToastTestHook,
    onLaunchToast as toastsOnLaunch,
    onUnlocked as toastsOnUnlocked,
} from "./surfaces/toasts";

/** The plugin's one FeatureSwitches instance: the kill switches come from the `disabledFeatures` setting (M0b, M9a). */
const features = createFeatureSwitches({
    readDisabled: () => String(setting("disabledFeatures") ?? ""),
    log: (level, message, err) => {
        if (level === "error") logger.error(message, err ?? "");
        else logger.warn(message, err ?? "");
    },
});
onSettingChange((key) => {
    if (key === "disabledFeatures") features.reload();
});

/** What every surface gets: the kill switches and error counter of safety/ (plan § 7.0 D6). */
const surfaceDeps: SurfaceDeps = {
    isEnabled: (id) => features.isEnabled(id as FeatureId),
    reportError: (id, err) => features.reportError(id as FeatureId, err),
};

/** The one surface runner (plan § 4.4): installs each surface in isolation, in registration order. */
const runner = createSurfaceRunner({
    isEnabled: surfaceDeps.isEnabled,
    log: (level, message, err) => {
        if (level === "error") logger.error(message, err ?? "");
        else logger.warn(message, err ?? "");
    },
});

/** Records (app/records.ts, plan M4c): the one read model every record-driven surface reads. */
const records = createRecords(bus);

/** Routing (app/routing.ts, plan M4a / ADR-0040), wired to every former buckets caller through D3 setters. */
const routing = createRouting({
    buckets: () => setting("buckets"),
    autoMode: () => setting("autoRoutingMode"),
    rules: () => setting("routingRules"),
    collections: collectionsSource,
    titleOf: shortcutTitle,
    shortcuts: listShortcuts,
    loadProfiles: async () => (await backend.getAutoRoutingProfiles())?.profiles ?? {},
    metadataAppids: () => records.store.all().filter((r) => r.metadata).map((r) => r.appid),
});

/** Render queue (app/render-queue.ts, plan § 7.0 D5): coalesces record.updated into one
 *  runner.render() per appid per tick, never from inside a Steam render. */
const renderQueue = createRenderQueue((appid, parts) => runner.render(appid, records.store.get(appid), parts));

/** Identity (app/identity.ts, plan M4c): resolves a shortcut's Steam Store match through
 *  one EnsureFresh call instead of up to three round trips. */
const identity = createIdentity({
    backend,
    records: records.store,
    owned: ownedCandidates,
    titleOf: shortcutTitle,
});

/** Metadata (app/metadata.ts, plan M5b): selects Game Info for a shortcut through one
 *  EnsureFresh call instead of the old scattered local/store/IGDB pipeline. */
const metadata = createMetadata({
    backend,
    records: records.store,
    titleOf: (appid) => shortcutTitle(appid),
    ensureBase: (appid) => records.ensureBase(appid, shortcutTitle(appid) ?? ""),
    storeItemFor: (steamAppid) => loadStoreItem(steamAppid),
    allowWeb: (appid) => setting("services").igdbEnabled !== false && routing.serviceAllowed("igdb", appid),
    allowScreenscraper: (appid) => setting("services").screenscraperEnabled !== false && routing.serviceAllowed("screenscraper", appid),
});

/** Achievements (app/achievements.ts, plan M6b): the record's achievements part and Flow C
 *  (launch toast, in-game unlock polling, unlock announcements). */
const achievements = createAchievements({
    backend,
    records: records.store,
    bus,
    ensureBase: (appid) => records.ensureBase(appid, shortcutTitle(appid) ?? ""),
    titleOf: (appid) => shortcutTitle(appid),
    routeOf: (appid) => routing.getBucket(appid),
    hardcore: () => setting("raHardcoreMode"),
    launchPolicy: () => setting("localAchievementsNotifyOnLaunch"),
    observerEnabled: () => features.isEnabled("achievements-observer"),
    now: () => Date.now(),
});

/** Artwork (app/artwork.ts, plan M5c): SteamGridDB for shortcuts with no Steam match, the Steam
 *  CDN for mapped ones; the artwork surface executes the plan it puts in the record. */
const artwork = createArtwork({
    backend,
    records: records.store,
    ensureBase: (appid) => records.ensureBase(appid, shortcutTitle(appid) ?? ""),
    titleOf: (appid) => shortcutTitle(appid),
    storeItemFor: (steamAppid) => loadStoreItem(steamAppid),
    fetchImage,
    allowSgdb: (appid) => setting("services").steamgriddbEnabled !== false && routing.serviceAllowed("steamgriddb", appid),
    now: () => Date.now(),
});

/** The view pipeline (app/view.ts, plan M7b): what happens when a shortcut's page opens. */
const view = createView({ routing, identity, metadata, artwork, achievements });

/** Manual Steam Store mapping (app/steam-store.ts): the settings panel and the public API below. */
const steamStore = createSteamStore({ backend, identity, metadata, artwork });

/** Controller support inferred from each shortcut's emulator (app/controller.ts). */
const controller = createController({ backend });

/** The background job (app/ingest.ts, plan M7b): only new shortcuts at start-up; "sync now" from the panel. */
const ingest = createIngest({
    backend,
    shortcuts: () => routing.listShortcuts(),
    ready: async () => {
        await routing.loadAutoRoutingProfiles();
        await routing.waitForCollections();
    },
    routeOf: (appid) => routing.getBucket(appid),
    isAllowed: (appid) => routing.serviceAllowed("all", appid),
    owned: ownedCandidates,
    allowWeb: (appid) => setting("services").igdbEnabled !== false && routing.serviceAllowed("igdb", appid),
    allowScreenscraper: (appid) => setting("services").screenscraperEnabled !== false && routing.serviceAllowed("screenscraper", appid),
    hardcore: () => setting("raHardcoreMode"),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

export { setSetting, resetSettings, SettingsPanel };
/** Kill switches, error counts and safe mode (migration plan M0b). */
export const safetyDiagnostics = () => features.diagnostics();
/** K6: how often Game Info was re-applied from Steam's overview rebuild (`viaTrigger`) or from a render (`viaRender`, the fallback). */
export { gameInfoRepairDiagnostics } from "./surfaces/game-info";
export const bucketReport = () => routing.bucketReport();
export const loadAutoRoutingProfiles = () => routing.loadAutoRoutingProfiles();
export const clearSteamStore = (appid: number, reject: boolean) => steamStore.clear(appid, reject);
export const setSteamStoreMapping = (appid: number, steamAppid: number, name?: string) => steamStore.setMapping(appid, steamAppid, name);
export const steamStoreState = () => steamStore.state();

export { getLocalAchievements, getLocalSchema, dispatchAchievementToast };

/** Public API (D8): the fake-achievement test hook and one store hook attempt (the surface retries on install). */
export function initAchievements(): void {
    installToastTestHook();
    ensureAchievementsStoreHooked();
}

/** Loads a shortcut's achievements into its record (`nativeAppId` overrides the identity when given). */
export async function loadAchievementsForApp(shortcutAppId: number, nativeAppId: number) {
    await achievements.ensure(shortcutAppId as ShortcutId, routing.getBucket(shortcutAppId), { native: nativeAppId || undefined });
    return getLocalAchievements(shortcutAppId) ?? null;
}

/** Unlocks one achievement (the given id, else the next locked one): persists, updates the stores, toasts. */
export const triggerAchievement = (shortcutAppId: number, targetAchievementId?: string) =>
    achievements.trigger(shortcutAppId as ShortcutId, targetAchievementId);

/** Resets all unlocked achievements for a shortcut. */
export const resetAchievements = (shortcutAppId: number) => achievements.reset(shortcutAppId as ShortcutId);

/** One unlock check against the backend observer; resolves to the number of new unlocks. */
export const checkObserverUnlocks = (shortcutAppId: number, nativeAppId: number, gameTitle?: string) =>
    achievements.checkNow(shortcutAppId as ShortcutId, { native: nativeAppId, title: gameTitle });

/** Starts a polling observer session while a game runs; the returned function stops it. */
export const startAchievementsObserver = (shortcutAppId: number, nativeAppId: number, gameTitle?: string) =>
    achievements.startSession(shortcutAppId as ShortcutId, { native: nativeAppId, title: gameTitle });

export { registerSummaryProvider } from "./surfaces/captures";
export { jsxDiagnostics } from "./steam/gamepad-appid";
export { headlineJsxDiagnostics } from "./surfaces/captures";
export { activityCardsJsxDiagnostics } from "./surfaces/captures";
export { nativeSectionsDiagnostics } from "./surfaces/native-links";
export type {
    SummaryContext,
    SummaryContribution,
    SummaryProvider,
} from "./surfaces/captures";

const LEGACY_PLUGINS = [
    "non-steam-games-activity",
    "non-steam-games-activity-dev",
    "steamgriddb-artwork",
    "steamgriddb-artwork-dev",
];

async function init() {
    // Panels reach the app only through this context (plan M8b, § 7.0 D3).
    setPanelContext({
        routing: {
            listCollections: () => routing.listCollections(),
            listShortcuts: () => routing.listShortcuts(),
            membersOf: (id) => routing.membersOf(id),
            shortcutName: (appid) => routing.listShortcuts().find((s) => s.appid === appid)?.name ?? String(appid),
            getAutoRoutingProfile: (appid) => routing.getAutoRoutingProfile(appid),
            serviceAllowed: (service, appid) => routing.serviceAllowed(service, appid),
            reloadProfiles: () => routing.loadAutoRoutingProfiles(),
        },
        ingest: {
            progress: ingest.getSyncProgress,
            onProgress: ingest.onSyncProgress,
            trigger: ingest.triggerSync,
            start: ingest.startSync,
        },
        records: { achievementsOf: (appid) => achievements.summary(appid as ShortcutId) },
        controller: { load: controller.load, inferredFor: controller.inferredFor },
        steamStore: { setMapping: steamStore.setMapping },
        safety: { featureIds: FEATURE_IDS, diagnostics: () => features.diagnostics(), surfaces: () => runner.status() },
    });

    // Surface and app APIs reach the settings panel and the features only through these setters (plan § 7.0 D3).
    setContentListener(setHasContent);

    // Record-driven surfaces (sections, native-links, captures; plan § 7.0 D4) render on a
    // timer after record.updated, never from inside a Steam render (plan § 7.0 D5).
    bus.on("record.updated", ({ appid, parts }) => renderQueue.push(appid, parts));
    // The record must exist before anything writes a part to it (kernel/record.ts update()
    // is a no-op for an unknown appid); every view ensures its base record first.
    bus.on("shortcut.viewed", ({ appid }) => records.ensureBase(appid, shortcutTitle(appid) ?? ""));

    // Settings first: the Game Info gate reads them (ADR-0033).
    await initSettings();

    // ===== Safety (migration plan M0b) =====
    // Kill switches come from the `disabledFeatures` setting. Two starts in a row that
    // never finished cleanly switch safe mode on (capture tier only, ADR-0012).
    features.reload();
    try {
        const boot = beginBoot(window.localStorage);
        if (boot.safeMode) {
            features.setSafeMode(true);
            logger.error(
                `Safe mode: the last ${boot.unclean} starts did not finish cleanly; only sections and captures are on.`,
            );
        }
        watchBoot(window.localStorage, () => features.errorCount(), window);
    } catch (e) {
        logger.warn("Boot sentinel unavailable.", e);
    }

    // ===== Legacy guard =====
    // Log only; never skip init.
    try {
        const list = (window as any).PLUGIN_LIST ?? {};
        for (const name of LEGACY_PLUGINS) {
            if (list[name]) {
                logger.error(
                    `Legacy plugin "${name}" is still loaded next to steam-cartridges; disable it (sections and hooks would be installed twice).`,
                );
            }
        }
    } catch {
        /* diagnostics only */
    }

    // ===== Native sections =====
    // Steam hides Post-Game Summary from shortcuts with an app-type filter in its
    // section registry. Putting the name back is what makes the native component
    // render at all, so nothing else matters if this fails.
    runner.register(createSectionsSurface(surfaceDeps));
    runner.installAll();
    if (features.isEnabled("sections") && !runner.status().find((s) => s.id === "sections")?.installed) {
        logger.error(
            "Could not restore Steam's app detail sections; summaries are unavailable.",
        );
    }

    // ===== Captures (surfaces/captures, plan M3.2) =====
    // StoreItemCache immunity (store-cache), "{Username} captured" headlines (headline),
    // native Post-Game Summary cards in the activity feed (activity-cards) and Big
    // Picture thumbnail styling; each part keeps its own kill switch.
    runner.register(
        createCapturesSurface({
            ...surfaceDeps,
            activityOptions: () => ({
                showAdded: setting("activityShowAddedToLibrary") !== false,
                showFirstPlayed: setting("activityShowFirstPlayed") !== false,
            }),
        }),
    );
    runner.installAll();

    // ===== Native sections for mapped games (parity plan C) =====
    // Steam's own Links / Friends / Community sections read the native appid
    // of a Steam Store match; unmatched shortcuts keep Steam's stock sections.
    runner.register(createNativeLinksSurface(surfaceDeps));
    // Custom artwork slots and logo position for mapped games (surfaces/artwork, plan M3.9).
    runner.register(
        createArtworkSurface({
            ...surfaceDeps,
            downloadImage: (url) => backend.steamStoreDownloadImage(url),
            recordArtwork: (appid, info) =>
                backend.steamStoreRecordArtwork(
                    appid,
                    info.steamAppid,
                    info.slots,
                    info.failed,
                    info.source === "steamgriddb" ? { source: "steamgriddb", tried: info.tried } : undefined,
                ),
            saveIcon: (appid, url, source, steamAppid, base64) => backend.steamStoreSaveIcon(appid, url, source, steamAppid, base64),
            recordIcon: (appid, info) => backend.steamStoreRecordIcon(appid, info),
        }),
    );
    runner.installAll();

    // ===== Native Achievements Subsystem =====
    // Steam's achievement stores (surfaces/achievements, plan M3.5); the loader below feeds them.
    runner.register(createAchievementsSurface({ ...surfaceDeps, refreshSections }));
    // Steam's notification toasts (surfaces/toasts, plan M3.6).
    runner.register(createToastsSurface(surfaceDeps));
    runner.installAll();
    features.run("achievements", () => initAchievements());
    // Flow C (launch toast, unlock polling, quit reload) and the unlock announcements.
    achievements.install();
    // Each new unlock: a toast and a Post-Game Summary line; a launch with achievements: the launch toast.
    bus.on("achievements.unlocked", toastsOnUnlocked);
    bus.on("achievements.unlocked", capturesOnUnlocked);
    bus.on("achievements.launch-toast", toastsOnLaunch);

    // ===== Game Info (surfaces/game-info, plan M3.3; record-driven from M5b) =====
    // Steam's Game Info components and AppOverview hooks; app/metadata (below) fills the record.
    runner.register(
        createGameInfoSurface({
            ...surfaceDeps,
            controllerContext: (appid) => ({ inferred: controller.inferredFor(appid), defaultFull: setting("defaultFullController") }),
            metadataOf: (appid) => records.store.get(appid as ShortcutId)?.metadata?.data,
        }),
    );
    // The desktop PlayBar's ⓘ button (surfaces/playbar, plan M3.4); on only while game-info is.
    runner.register(createPlaybarSurface({ ...surfaceDeps, hookOverview: ensureAppOverviewHooked, track: trackInstance }));
    runner.installAll();

    // ===== Game Info data (ex steamgriddb-artwork) =====
    // Not awaited: a failure here must not affect activity (ADR-0010).
    features.run("game-info", () => {
        void loadAutoRoutingProfiles();
        view.init();
        bus.on("shortcut.viewed", ({ appid }) => void view.onSourceView(appid));
        void metadata.preload().catch((e) => {
            features.reportError("game-info", e);
            logger.error("Game Info preload failed; activity is unaffected.", e);
        });
    });

    // ===== Library grid =====
    // Fills in last-played dates Steam does not have, from capture timestamps.
    runner.register(createLibraryHomeSurface({ ...surfaceDeps, loadLibraryStats: () => backend.getLibraryStats() }));
    runner.installAll();
    await libraryHomeReady();

    // ===== App detail pages =====
    // Publishing is keyed on the app, not the window: Steam's store is global, so
    // one publish serves every window showing that game.

    // Views come from the view sensor (sensors/view, migration plan M2), for desktop
    // and Big Picture alike.
    bus.on("shortcut.viewed", ({ appid }) => {
        if (features.isEnabled("native-links")) features.run("native-links", () => wrapNavigators());
        if (features.isEnabled("captures")) void patchLibraryApp(appid);
    });
    bus.on("shortcut.left", ({ appid }) => {
        if (features.isEnabled("captures")) unpatchLibraryApp(appid);
    });
    // Big Picture thumbnail styling goes into each gamepad window the view sensor reports.
    bus.on("window.opened", capturesWindowOpened);
    bus.on("window.closed", capturesWindowClosed);

    // ===== Refresh after play =====
    // Quitting a game is exactly when new screenshots and clips exist, so
    // invalidate then rather than polling (ADR-0007). Launch and quit come from the
    // lifecycle sensor (sensors/lifecycle, migration plan M2).

    // Achievements (launch toast, unlock polling, reload on quit) run in app/achievements.ts.
    bus.on("shortcut.quit", ({ appid, name }) => {
        logger.info(`${name} closed; refreshing its activity.`);
        void refreshLibraryApp(appid);
        void refreshLibraryHome();
    });

    // ===== Sensors (migration plan M2) =====
    // Installed after every subscriber above: they report the current page and the
    // windows already open immediately.
    installViewSensor(bus);
    installLifecycleSensor(bus);

    logger.info("Ready. Non-Steam games now use Steam's own detail sections.");
    // Automatically start background sync for un-scraped games after startup
    features.run("background-sync", () => ingest.triggerSync(3000));
}

export default definePlugin(() => {
    init().catch((e) => logger.error("Plugin init failed.", e));

    // Guardrail: Ensure Settings panel and Plugin list are indexed under both "steam-cartridges"
    // and "steam-cartridges-dev" so Millennium can always resolve the settings page.
    setTimeout(() => {
        try {
            const panels = (window as any).MILLENNIUM_SIDEBAR_NAVIGATION_PANELS;
            if (panels) {
                if (panels["steam-cartridges"] && !panels["steam-cartridges-dev"]) {
                    panels["steam-cartridges-dev"] = panels["steam-cartridges"];
                }
                if (panels["steam-cartridges-dev"] && !panels["steam-cartridges"]) {
                    panels["steam-cartridges"] = panels["steam-cartridges-dev"];
                }
            }
            const pl = (window as any).PLUGIN_LIST;
            if (pl) {
                if (pl["steam-cartridges"] && !pl["steam-cartridges-dev"]) {
                    pl["steam-cartridges-dev"] = pl["steam-cartridges"];
                }
                if (pl["steam-cartridges-dev"] && !pl["steam-cartridges"]) {
                    pl["steam-cartridges"] = pl["steam-cartridges-dev"];
                }
            }
        } catch {
            // ignore
        }
    }, 0);

    return {
        title: "Steam Cartridges",
        icon: <IconsModule.Settings />,
        content: <SettingsPanel />,
    };
});
