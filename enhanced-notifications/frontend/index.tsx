import { definePlugin, IconsModule } from '@steambrew/client';
import { logger } from './logger';
import { initSettings, onSettingChange, setting } from './settings/settings';
import { SettingsPanel } from './settings/settings-panel';
import { beginBoot, watchBoot } from './safety/boot';
import { errorCount, initSafety, isEnabled, reloadSafety, reportError } from './safety/runtime';
import type { FeatureId } from './safety/features';
import { createEventBus } from './kernel/events';
import { installSurfaces, type SurfaceStatus } from './kernel/surface';
import { achievementEType, resolveNotificationStore } from './steam/notification-store';
import { installNotificationHook } from './steam/notification-hook';
import { resolveToastSelectors } from './steam/selectors';
import { initNotificationSettingsDetection } from './steam/notification-settings';
import { achievementTheme, initActiveTheme, setSelectors } from './theme/active-theme';
import { TIERS } from './theme/achievements';
import { installUnlockSensor } from './sensors/unlock';
import { createSoundSurface } from './surfaces/sound';
import { createDurationSurface } from './surfaces/duration';
import { createQueueSurface } from './surfaces/queue';
import { createStyleSurface } from './surfaces/style';
import { createPreviewSurface, preview, previewOptions } from './surfaces/preview';
import { completionHandler, createToastsSurface } from './surfaces/toasts';
import { previewTier } from './surfaces/toasts/post';
import { createBannerSurface } from './surfaces/banner';
import { toastPatchInstalled } from './surfaces/banner/toast-patch';
import { achievementReset, createResetSurface } from './surfaces/reset';
import { capturesHandler, createCapturesSurface } from './surfaces/captures';

// Named exports are published by Millennium on window.PLUGIN_LIST[<plugin>],
// which is how tests/*.mjs drive the same code paths as the settings panel.
export { allSettings, resetSettings, setSetting } from './settings/settings';
export { preview, previewIds, previewOptions } from './surfaces/preview';
export { previewTier, fireTestUnlock, fireExceptionalCompletionToast } from './surfaces/toasts/post';
export { activeTheme, achievementTheme, themeCss } from './theme/active-theme';
export { toastsEnabled } from './steam/notification-settings';
export { safetyDiagnostics } from './safety/runtime';
export { debugBigPicture, bigPictureTrace, debugBigPictureType } from './surfaces/style/bp-debug';
export { jsxDiagnostics } from './surfaces/banner/toast-patch';
export { captureLog, setCaptureDryRun } from './surfaces/captures/captures';
export { recordingDiagnostics, runningGameAppid } from './surfaces/captures/recording';
export { achievementReset } from './surfaces/reset';

/**
 * enhanced-notifications: restyles every Steam notification toast in place, and replaces achievement toasts with a
 * themed banner per rarity tier when the theme has an `achievements` block (enhanced-achievements, merged; ADR-0050).
 *
 * Scope: hooks only NotificationStore (sound, durations, synthetic achievement toasts), the toast dispatcher (the
 * banner) and toast windows (a scoped <style>). It never touches AppOverview, StoreItemCache, the section registry or
 * the activity/spotlight stores, and never imports from another plugin. Layers and owners:
 * docs/enhanced-notifications.md.
 */
let surfaceReport: SurfaceStatus[] = [];

/** Which surfaces installed and why one did not (window.PLUGIN_LIST[...].surfaceStatus()). */
export function surfaceStatus(): SurfaceStatus[] {
    return surfaceReport;
}

/**
 * Does the achievement banner draw toasts of this type right now? Then the notification style, its desktop placement
 * and its Big Picture place leave them to the banner. O(1): the style surface asks on every toast.
 */
function bannerDraws(eType: number | undefined): boolean {
    return eType !== undefined && eType === achievementEType() && achievementTheme() !== null && toastPatchInstalled() && isEnabled('banner');
}

async function init(): Promise<void> {
    await initSettings();
    // Kill switches, error budget and safe mode (ADR-0043).
    const boot = beginBoot(window.localStorage);
    // A feature that trips its error budget has its surface uninstalled, not only gated.
    const uninstallers: Partial<Record<FeatureId, () => void>> = {};
    initSafety({
        readDisabled: () => setting('disabledFeatures'),
        safeMode: boot.safeMode,
        onTrip: (id) => uninstallers[id]?.(),
        log: (level, message, err) => (err === undefined ? logger[level](message) : logger[level](message, err)),
    });
    onSettingChange((key) => {
        if (key === 'disabledFeatures') reloadSafety();
    });
    watchBoot(window.localStorage, errorCount, window);
    if (boot.safeMode) {
        logger.warn(`Safe mode: the last ${boot.unclean} starts did not end cleanly, so nothing is hooked. The next clean start leaves safe mode.`);
        return; // stock Steam, untouched
    }
    const handle = resolveNotificationStore();
    if (!handle) return; // stock Steam, untouched

    // One event stream: the hook reports each toast Steam shows, the sensor turns an unlock into one
    // `achievement.unlocked`, and the 100% toast and captures subscribe.
    const bus = createEventBus((event, err) => logger.warn(`A handler of ${event} threw.`, err));
    const hook = installNotificationHook(handle.proto, handle.store, {
        reportError,
        warn: (message, err) => logger.warn(message, err),
    });
    installUnlockSensor(hook, bus);
    logger.info(`Notification hook installed (${handle.configs.size} types, achievement eType ${handle.achievement?.eType ?? 'not found'}).`);
    initNotificationSettingsDetection(); // its failure only disables the settings-panel warning
    const sel = resolveToastSelectors();
    setSelectors(sel.theme);
    await initActiveTheme();

    const surfaces = [
        createSoundSurface(hook),
        createDurationSurface(handle),
        createQueueSurface(handle),
        createStyleSurface(hook, sel.placeholder, bannerDraws),
        // A random preview's achievement is the banner's own synthetic preview, in a random tier (never TestAchievement).
        createPreviewSurface(() => previewTier(TIERS[Math.floor(Math.random() * TIERS.length)]!)),
        createToastsSurface(handle),
        createBannerSurface(),
        createCapturesSurface(),
        createResetSurface(),
    ];
    for (const s of surfaces) uninstallers[s.id as FeatureId] = () => s.uninstall();
    surfaceReport = installSurfaces(surfaces, {
        isEnabled: (id) => isEnabled(id as FeatureId),
        reportError: (id, err) => reportError(id as FeatureId, err),
    });
    bus.on('achievement.unlocked', (e) => {
        try {
            completionHandler(e);
        } catch (error) {
            reportError('completion', error);
        }
    });
    bus.on('achievement.unlocked', capturesHandler);
}

/** The settings panel's injected actions: the panel never imports a surface. */
const panelProps = {
    // With an `achievements` block the panel previews achievements per tier, so a random preview leaves them out.
    onPreview: (id?: string) => preview(id, achievementTheme() === null),
    previewOptions: previewOptions(),
    onPreviewTier: previewTier,
    achievementReset,
};

/** The settings panel as a component, so live tests can mount it without opening Steam's settings window. */
export const SettingsPanelView = () => <SettingsPanel {...panelProps} />;

export default definePlugin(() => {
    init().catch((error) => logger.error('Initialisation failed; Steam is left stock.', error));
    return {
        title: 'Enhanced Notifications',
        icon: <IconsModule.Settings />,
        content: <SettingsPanel {...panelProps} />,
    };
});
