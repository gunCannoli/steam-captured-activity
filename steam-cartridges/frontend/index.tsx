import { definePlugin, IconsModule } from "@steambrew/client";
import { logger } from "./logger";
import { rpc } from "./rpc";
import {
    createCapturesSurface,
    patch as patchLibraryApp,
    refresh as refreshLibraryApp,
    setContentListener,
    setNativeActivitySource,
    unpatch as unpatchLibraryApp,
} from "./surfaces/captures";
import {
    createLibraryHomeSurface,
    ready as libraryHomeReady,
    refresh as refreshLibraryHome,
} from "./surfaces/library-home";
import { initGameInfo } from "./features/game-info";
import { initSourceView, onSourceView, setRouting as setSourceViewRouting } from "./features/source-view";
import { createNativeLinksSurface, setNativeAppid } from "./surfaces/native-links";
import { artworkWriter, createArtworkSurface } from "./surfaces/artwork";
import {
    initAchievements,
    loadAchievementsForApp,
    triggerAchievement,
    resetAchievements,
    getLocalAchievements,
    getLocalSchema,
    handleAppLaunchAchievements,
    checkObserverUnlocks,
    startAchievementsObserver,
    dispatchAchievementToast,
} from "./features/achievements";
import { initSettings, resetSettings, setSetting, setting, setRouting as setSettingsRouting } from "./settings/settings";
import { SettingsPanel } from "./settings/settings-panel";
import { createRouting } from "./app/routing";
import { triggerSync, setRouting as setSyncRouting } from "./features/scraper/sync-manager";
import { setRouting as setOnUpdateRouting } from "./features/scraper/on-update";
import { features } from "./safety/switches";
import type { FeatureId } from "./safety/features";
import { beginBoot, watchBoot } from "./safety/boot";
import type { ShortcutId } from "./kernel/appid";
import { bus } from "./app/bus";
import { installViewSensor } from "./sensors/view";
import { installLifecycleSensor } from "./sensors/lifecycle";
import { collectionsSource } from "./sensors/collections";
import { createSurfaceRunner, type SurfaceDeps } from "./kernel/surface";
import {
    createSectionsSurface,
    refreshSections,
    setExtraSections,
    setGameInfoProbe,
    setHasContent,
} from "./surfaces/sections";
import {
    createGameInfoSurface,
    ensureAppOverviewHooked,
    gameInfoWriter,
    isAppEnriched,
    trackInstance,
} from "./surfaces/game-info";
import { createPlaybarSurface } from "./surfaces/playbar";
import { getCachedLibraryMetadata, libraryCacheAppids, setGameInfoWriter, setRouting as setGameInfoRouting } from "./features/game-info";
import { controllerContext } from "./features/game-info/controller";
import {
    setArtworkSink,
    setCapturesSinks,
    setExtraSectionsSink,
    setGameInfoSink,
    setNativeLinksSink,
} from "./features/steam-store";
import { setCapturesRefresher, setGameInfoEnricher } from "./features/scraper/on-update";
import { achievementsStore, createAchievementsSurface } from "./surfaces/achievements";
import { setAchievementsStore } from "./features/achievements/store-port";
import { createToastsSurface, dispatchAchievementToast as showAchievementToast, dispatchLaunchToast } from "./surfaces/toasts";
import { setToasts } from "./features/achievements/toast-port";

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

/** Routing (app/routing.ts, plan M4a / ADR-0040), wired to every former buckets caller through D3 setters. */
const routing = createRouting({
    buckets: () => setting("buckets"),
    autoMode: () => setting("autoRoutingMode"),
    collections: collectionsSource,
    titleOf: (appid) => {
        try {
            const name = (window as any).appStore?.GetAppOverviewByAppID?.(appid)?.display_name;
            return typeof name === "string" ? name : undefined;
        } catch {
            return undefined;
        }
    },
    shortcuts: () => {
        const all: any[] = (window as any).appStore?.allApps ?? [];
        return all
            .filter((a) => a?.appid >= 0x8000_0000)
            .map((a) => ({ appid: a.appid as number, name: String(a.display_name ?? a.appid) }));
    },
    loadProfiles: async () => (await rpc.getAutoRoutingProfiles())?.profiles ?? {},
    metadataAppids: () => libraryCacheAppids(),
});

export { setSetting, resetSettings };
/** Kill switches, error counts and safe mode (migration plan M0b). */
export const safetyDiagnostics = () => features.diagnostics();
export const bucketReport = () => routing.bucketReport();
export const loadAutoRoutingProfiles = () => routing.loadAutoRoutingProfiles();
export {
    clearSteamStore,
    setSteamStoreMapping,
    steamStoreState,
} from "./features/steam-store";

export {
    initAchievements,
    loadAchievementsForApp,
    triggerAchievement,
    resetAchievements,
    getLocalAchievements,
    getLocalSchema,
    checkObserverUnlocks,
    startAchievementsObserver,
    dispatchAchievementToast,
};

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
    // Routing reaches every former buckets caller only through these setters (plan § 7.0 D3).
    setSourceViewRouting(routing);
    setGameInfoRouting(routing);
    setSyncRouting(routing);
    setOnUpdateRouting(routing);
    setSettingsRouting(routing);

    // Surface APIs reach the features only through these setters (plan § 7.0 D3).
    setGameInfoProbe(isAppEnriched);
    setContentListener(setHasContent);
    setExtraSectionsSink(setExtraSections);
    setAchievementsStore(achievementsStore);
    setToasts({ achievement: showAchievementToast, launch: dispatchLaunchToast });
    setCapturesSinks({ setNativeActivitySource, republish: patchLibraryApp });
    setCapturesRefresher(refreshLibraryApp);
    setGameInfoWriter(gameInfoWriter);
    setGameInfoSink(gameInfoWriter);
    setNativeLinksSink(setNativeAppid);
    setArtworkSink(artworkWriter);
    setGameInfoEnricher(gameInfoWriter.enrich);

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
    runner.register(createArtworkSurface({ ...surfaceDeps, downloadImage: (url) => rpc.steamStoreDownloadImage(url) }));
    runner.installAll();

    // ===== Native Achievements Subsystem =====
    // Steam's achievement stores (surfaces/achievements, plan M3.5); the loader below feeds them.
    runner.register(createAchievementsSurface({ ...surfaceDeps, refreshSections }));
    // Steam's notification toasts (surfaces/toasts, plan M3.6).
    runner.register(createToastsSurface(surfaceDeps));
    runner.installAll();
    features.run("achievements", () => initAchievements());

    // ===== Game Info (surfaces/game-info, plan M3.3) =====
    // Steam's Game Info components and AppOverview hooks; the data pipeline below fills it.
    runner.register(createGameInfoSurface({ ...surfaceDeps, controllerContext, metadataOf: getCachedLibraryMetadata }));
    // The desktop PlayBar's ⓘ button (surfaces/playbar, plan M3.4); on only while game-info is.
    runner.register(createPlaybarSurface({ ...surfaceDeps, hookOverview: ensureAppOverviewHooked, track: trackInstance }));
    runner.installAll();

    // ===== Game Info data (ex steamgriddb-artwork) =====
    // Not awaited: the two halves load independently, as the two plugins did
    // (ADR-0010), and a failure here must not affect activity.
    features.run("game-info", () => {
        void loadAutoRoutingProfiles();
        initSourceView();
        bus.on("shortcut.viewed", ({ appid }) => void onSourceView(appid));
        void initGameInfo().catch((e) => {
            features.reportError("game-info", e);
            logger.error("Game Info feature failed; activity is unaffected.", e);
        });
    });

    // ===== Library grid =====
    // Fills in last-played dates Steam does not have, from capture timestamps.
    runner.register(createLibraryHomeSurface({ ...surfaceDeps, loadLibraryStats: () => rpc.getLibraryStats() }));
    runner.installAll();
    await libraryHomeReady();

    // ===== App detail pages =====
    // Publishing is keyed on the app, not the window: Steam's store is global, so
    // one publish serves every window showing that game.

    // Views come from the view sensor (sensors/view, migration plan M2), for desktop
    // and Big Picture alike.
    bus.on("shortcut.viewed", ({ appid }) => {
        if (features.isEnabled("captures")) void patchLibraryApp(appid);
    });
    bus.on("shortcut.left", ({ appid }) => {
        if (features.isEnabled("captures")) unpatchLibraryApp(appid);
    });

    // ===== Refresh after play =====
    // Quitting a game is exactly when new screenshots and clips exist, so
    // invalidate then rather than polling (ADR-0007). Launch and quit come from the
    // lifecycle sensor (sensors/lifecycle, migration plan M2).

    /** Running shortcuts: display name and the achievement observer's stop function. */
    const sessions = new Map<ShortcutId, { name: string; stop?: () => void; quit?: boolean }>();

    bus.on("shortcut.launched", ({ appid, name }) => {
        const session: { name: string; stop?: () => void; quit?: boolean } = { name };
        sessions.set(appid, session);

        // Startup notification if enabled ("Local Achievements Enabled")
        features.run("achievements-observer", () => handleAppLaunchAchievements(appid));

        // Start active observer session while game is running
        if (features.isEnabled("achievements-observer")) void rpc.steamStoreGetMapping(appid).then((res) => {
            const nativeAppId = res?.mapping?.steam_appid || 0;
            const stopObserver = startAchievementsObserver(appid, nativeAppId, name);
            // The game may have quit while the mapping loaded.
            if (session.quit) stopObserver();
            else session.stop = stopObserver;
        }).catch((e) => logger.warn("Failed resolving mapping for achievement observer:", e));
    });

    bus.on("shortcut.quit", ({ appid }) => {
        const session = sessions.get(appid);
        sessions.delete(appid);
        if (session) {
            session.quit = true;
            session.stop?.();
        }
        logger.info(`${session?.name ?? appid} closed; refreshing its activity.`);
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
    features.run("background-sync", () => triggerSync(3000));
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
