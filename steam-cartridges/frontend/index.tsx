import { definePlugin, IconsModule } from "@steambrew/client";
import { onPopupCreate, PopupType } from "steambrew-utils/watchers";
import { logger } from "./logger";
import { rpc } from "./rpc";
import {
    patch as patchLibraryApp,
    refresh as refreshLibraryApp,
    register as registerLibraryApp,
    unpatch as unpatchLibraryApp,
} from "./renderers/library-app";
import {
    refresh as refreshLibraryHome,
    register as registerLibraryHome,
} from "./renderers/library-home";
import { installHeadlinePatch } from "./steam/headline-patch";
import { installActivityCardsPatch } from "./steam/activity-cards-patch";
import { ensureStoreCacheHooked } from "./steam/activity";
import { initGameInfo } from "./features/game-info";
import { initSourceView, onSourceView } from "./features/source-view";
import { installNativeSections } from "./features/steam-store/native-sections";
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
import { initSettings, resetSettings, setSetting } from "./settings/settings";
import { SettingsPanel } from "./settings/settings-panel";
import { bucketReport, loadAutoRoutingProfiles } from "./features/buckets";
import { triggerSync } from "./features/scraper/sync-manager";
import { features } from "./safety/switches";
import { beginBoot, watchBoot } from "./safety/boot";
import type { ShortcutId } from "./kernel/appid";
import { bus } from "./app/bus";
import { installViewSensor } from "./sensors/view";
import { installLifecycleSensor } from "./sensors/lifecycle";
import { collectionsSource } from "./sensors/collections";
import { setCollectionsSource } from "./features/buckets/collections";

export { setSetting, resetSettings };
/** Kill switches, error counts and safe mode (migration plan M0b). */
export const safetyDiagnostics = () => features.diagnostics();
export { bucketReport, loadAutoRoutingProfiles };
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

export { registerSummaryProvider } from "./steam/summary";
export { jsxDiagnostics } from "./steam/gamepad-appid";
export { headlineJsxDiagnostics } from "./steam/headline-patch";
export { activityCardsJsxDiagnostics } from "./steam/activity-cards-patch";
export { nativeSectionsDiagnostics } from "./features/steam-store/native-sections";
export type {
    SummaryContext,
    SummaryContribution,
    SummaryProvider,
} from "./steam/summary";

const LEGACY_PLUGINS = [
    "non-steam-games-activity",
    "non-steam-games-activity-dev",
    "steamgriddb-artwork",
    "steamgriddb-artwork-dev",
];

async function init() {
    // Buckets read collection membership through the collections sensor (migration plan M2).
    setCollectionsSource(collectionsSource);

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
    if (features.isEnabled("sections") && !features.run("sections", () => registerLibraryApp())) {
        logger.error(
            "Could not restore Steam's app detail sections; summaries are unavailable.",
        );
    }

    // ===== Store Cache Immunity Hook =====
    // Permanently immunizes non-Steam shortcuts from StoreItemCache negative blacklist
    features.run("store-cache", () => ensureStoreCacheHooked());

    // ===== Headline phrasing =====
    // Replaces community UGC string ("cannoliGun shared 2 screenshots") with native action
    // phrasing ("cannoliGun captured") for non-Steam captures.
    features.run("headline", () => installHeadlinePatch());

    // ===== Native Activity Cards =====
    // Replaces community screenshot viewer with genuine Post-Game Summary cards
    // (PostGameSummaryClip and SummaryScreenshot) with hover video scrubbers and native playback.
    features.run("activity-cards", () => installActivityCardsPatch());

    // ===== Native sections for mapped games (parity plan C) =====
    // Steam's own Links / Friends / Community sections read the native appid
    // of a Steam Store match; unmatched shortcuts keep Steam's stock sections.
    features.run("native-links", () => installNativeSections());

    // ===== Native Achievements Subsystem =====
    features.run("achievements", () => initAchievements());

    // ===== Game Info (ex steamgriddb-artwork) =====
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
    if (features.isEnabled("library-home")) {
        try {
            await registerLibraryHome();
        } catch (e) {
            features.reportError("library-home", e);
        }
    }

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

    onPopupCreate((popup, type) => {
        if (!features.isEnabled("captures")) return undefined;
        if (type === PopupType.Gamepad) {
            // Big Picture renders through a React portal from SharedJSContext
            // into the gamepad popup window (ADR-0029). Both UI modes share the
            // same store singletons, webpack chunks, and CAppDetailsSections registry.
            //
            // Because Ge.T (module 53074) is already built into Big Picture's
            // "ACTIVITY" tab, feeding appSpotlightStore via patchLibraryApp(appid)
            // makes Steam render its genuine native GamePlaySummaryContainer with
            // controller focus rings and carousel scrolling automatically.

            // Inject scoped BPM activity feed thumbnail styling into the gamepad popup document
            const doc = popup.window?.document;
            let styleEl: HTMLStyleElement | null = doc
                ? doc.createElement("style")
                : null;
            if (styleEl && doc) {
                styleEl.id = "nsga-bpm-activity-thumbs";
                styleEl.textContent = `
          [class*="CarouselThumbs"] {
            display: flex !important;
            flex-direction: row !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            gap: 16px !important;
            width: 100% !important;
            max-width: 100% !important;
            flex: 1 1 auto !important;
          }
          [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) {
            width: 320px !important;
            height: 180px !important;
            max-width: 320px !important;
            max-height: 180px !important;
            flex: 0 0 320px !important;
            border-radius: 4px !important;
            overflow: hidden !important;
          }
          [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) [class*="ImageWrapper"] {
            width: 100% !important;
            height: 100% !important;
          }
          [class*="CarouselThumb"]:not([class*="CarouselThumbs"]) img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
          }
        `;
                doc.head?.appendChild(styleEl);
            }

            return () => {
                if (styleEl && styleEl.parentNode) {
                    styleEl.parentNode.removeChild(styleEl);
                }
            };
        }

        // Desktop, Modal, ContextMenu, Unknown: no styling needed.
        return undefined;
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
