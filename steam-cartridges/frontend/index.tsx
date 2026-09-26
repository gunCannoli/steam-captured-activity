import { definePlugin, IconsModule } from "@steambrew/client";
import { Steam } from "steambrew-utils";
import {
    onAppLaunch,
    onLocationChange,
    onPopupCreate,
    PopupType,
} from "steambrew-utils/watchers";
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
import { watchGamepadAppid } from "./steam/gamepad-appid";
import { installHeadlinePatch } from "./steam/headline-patch";
import { installActivityCardsPatch } from "./steam/activity-cards-patch";
import { ensureStoreCacheHooked } from "./steam/activity";
import { NON_STEAM_APPID_MIN, appIdFromPath } from "./steam/route";
import { initGameInfo } from "./features/game-info";
import { initSourceView } from "./features/source-view";
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

export { setSetting, resetSettings };
export { bucketReport } from "./features/buckets";
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
    // Settings first: the Game Info gate reads them (ADR-0033).
    await initSettings();

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
    if (!registerLibraryApp()) {
        logger.error(
            "Could not restore Steam's app detail sections; summaries are unavailable.",
        );
    }

    // ===== Store Cache Immunity Hook =====
    // Permanently immunizes non-Steam shortcuts from StoreItemCache negative blacklist
    ensureStoreCacheHooked();

    // ===== Headline phrasing =====
    // Replaces community UGC string ("cannoliGun shared 2 screenshots") with native action
    // phrasing ("cannoliGun captured") for non-Steam captures.
    installHeadlinePatch();

    // ===== Native Activity Cards =====
    // Replaces community screenshot viewer with genuine Post-Game Summary cards
    // (PostGameSummaryClip and SummaryScreenshot) with hover video scrubbers and native playback.
    installActivityCardsPatch();

    // ===== Native sections for mapped games (parity plan C) =====
    // Steam's own Links / Friends / Community sections read the native appid
    // of a Steam Store match; unmatched shortcuts keep Steam's stock sections.
    installNativeSections();

    // ===== Native Achievements Subsystem =====
    initAchievements();

    // ===== Game Info (ex steamgriddb-artwork) =====
    // Not awaited: the two halves load independently, as the two plugins did
    // (ADR-0010), and a failure here must not affect activity.
    initSourceView();
    void initGameInfo().catch((e) =>
        logger.error("Game Info feature failed; activity is unaffected.", e),
    );

    // ===== Library grid =====
    // Fills in last-played dates Steam does not have, from capture timestamps.
    await registerLibraryHome();

    // ===== App detail pages =====
    // Publishing is keyed on the app, not the window: Steam's store is global, so
    // one publish serves every window showing that game.

    onPopupCreate((popup, type) => {
        if (type === PopupType.Desktop) {
            // Desktop feeds Steam's own store (steam/summary.ts) - Steam's own
            // component renders in whichever window is open, so this is global,
            // not per-window.
            let current: number | undefined;

            const stopWatching = onLocationChange(
                () => Steam.MainWindowBrowserManager?.m_lastLocation,
                ({ pathname }) => {
                    const appid = appIdFromPath(pathname);

                    if (appid !== undefined && appid >= NON_STEAM_APPID_MIN) {
                        current = appid;
                        void patchLibraryApp(appid);
                    } else if (current !== undefined) {
                        // Either a native Steam game, which we leave alone, or another page.
                        unpatchLibraryApp(current);
                        current = undefined;
                    }
                },
            );

            return () => {
                stopWatching();
                if (current !== undefined) unpatchLibraryApp(current);
            };
        }

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

            let current: number | undefined;

            const stopWatching = watchGamepadAppid((appid) => {
                if (appid >= NON_STEAM_APPID_MIN) {
                    if (current !== undefined && current !== appid) {
                        unpatchLibraryApp(current);
                    }
                    current = appid;
                    void patchLibraryApp(appid);
                } else if (current !== undefined) {
                    unpatchLibraryApp(current);
                    current = undefined;
                }
            });

            return () => {
                stopWatching();
                if (current !== undefined) unpatchLibraryApp(current);
                if (styleEl && styleEl.parentNode) {
                    styleEl.parentNode.removeChild(styleEl);
                }
            };
        }

        // Modal, ContextMenu, Unknown: not a page we touch.
        return undefined;
    });

    // ===== Refresh after play =====
    // Quitting a game is exactly when new screenshots and clips exist, so
    // invalidate then rather than polling (ADR-0007).

    onAppLaunch((app, { onQuit }) => {
        if (app.appid < NON_STEAM_APPID_MIN) return;

        // Startup notification if enabled ("Local Achievements Enabled")
        handleAppLaunchAchievements(app.appid);

        // Start active observer session while game is running
        void rpc.steamStoreGetMapping(app.appid).then((res) => {
            const nativeAppId = res?.mapping?.steam_appid;
            if (nativeAppId) {
                const stopObserver = startAchievementsObserver(app.appid, nativeAppId, app.display_name);
                onQuit(() => stopObserver());
            }
        }).catch((e) => logger.warn("Failed resolving mapping for achievement observer:", e));

        onQuit(() => {
            logger.info(`${app.display_name} closed; refreshing its activity.`);
            void refreshLibraryApp(app.appid);
            void refreshLibraryHome();
        });
    });

    logger.info("Ready. Non-Steam games now use Steam's own detail sections.");
}

export default definePlugin(() => {
    init().catch((e) => logger.error("Plugin init failed.", e));
    return {
        title: "Steam Cartridges",
        icon: <IconsModule.Settings />,
        content: <SettingsPanel />,
    };
});
