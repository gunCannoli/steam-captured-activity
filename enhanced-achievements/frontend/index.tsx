import { definePlugin, IconsModule } from '@steambrew/client';
import { logger } from './logger';
import { initSettings, onSettingChange, setting } from './settings/settings';
import { beginBoot, watchBoot } from './safety/boot';
import { errorCount, initSafety, isEnabled, reloadSafety, reportError } from './safety/runtime';
import type { FeatureId } from './safety/features';

// Named exports are published by Millennium on window.PLUGIN_LIST[<plugin>],
// which is how tests/*.mjs drive the same code paths as the settings panel.
export { allSettings, resetSettings, setSetting } from './settings/settings';
export { previewTier, fireTestUnlock, fireExceptionalCompletionToast } from './surfaces/toasts/post';
export { activeTheme } from './theme/active-theme';
export { claims } from './claims';
export { jsxDiagnostics } from './surfaces/banner/toast-patch';
export { captureLog, setCaptureDryRun } from './surfaces/captures/captures';
export { recordingDiagnostics, runningGameAppid } from './surfaces/captures/recording';
export { toastsEnabled } from './steam/notification-settings';
export { safetyDiagnostics } from './safety/runtime';
export { achievementReset } from './surfaces/reset';
import { SettingsPanel } from './settings/settings-panel';
import { resolveNotificationStore } from './steam/notification-store';
import { installNotificationHook } from './steam/notification-hook';
import { initActiveTheme } from './theme/active-theme';
import { createEventBus } from './kernel/events';
import { installSurfaces, type SurfaceStatus } from './kernel/surface';
import { installUnlockSensor } from './sensors/unlock';
import { createSoundSurface } from './surfaces/sound';
import { createDurationSurface } from './surfaces/duration';
import { completionHandler, createToastsSurface } from './surfaces/toasts';
import { previewTier } from './surfaces/toasts/post';
import { createBannerSurface } from './surfaces/banner';
import { achievementReset, createResetSurface } from './surfaces/reset';
import { capturesHandler, createCapturesSurface } from './surfaces/captures';
import { initNotificationSettingsDetection } from './steam/notification-settings';

/**
 * enhanced-achievements: themed achievement toasts and sounds.
 *
 * Scope: hooks only NotificationStore and the toast dispatcher. It never
 * touches AppOverview, StoreItemCache, the section registry or the
 * activity/spotlight stores that steam-cartridges feeds, and never imports
 * from that plugin.
 */
let surfaceReport: SurfaceStatus[] = [];

/** Which surfaces installed and why one did not (window.PLUGIN_LIST[...].surfaceStatus()). */
export function surfaceStatus(): SurfaceStatus[] {
    return surfaceReport;
}

async function init(): Promise<void> {
    await initSettings();
    // Kill switches, error budget and safe mode (migration plan § E0a).
    const boot = beginBoot(window.localStorage);
    // A feature that trips its error budget has its surface uninstalled, not only gated (migration D9).
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

    // One event stream: the hook reports each toast Steam shows, the sensor turns it into
    // one `achievement.unlocked`, and the surfaces and captures subscribe (migration plan § 4.1).
    const bus = createEventBus((event, err) => logger.warn(`A handler of ${event} threw.`, err));
    const hook = installNotificationHook(handle.proto, handle.store, {
        reportError,
        warn: (message, err) => logger.warn(message, err),
    });
    installUnlockSensor(hook, bus);
    logger.info(`Notification hook installed (achievement eType ${handle.achievementType}).`);
    initNotificationSettingsDetection(); // its failure only disables the settings-panel warning
    await initActiveTheme();

    const surfaces = [createSoundSurface(hook), createDurationSurface(handle), createToastsSurface(handle), createBannerSurface(), createCapturesSurface(), createResetSurface()];
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

/** The settings panel as a component, so live tests can mount it without opening Steam's settings window. */
export const SettingsPanelView = () => <SettingsPanel onPreview={previewTier} achievementReset={achievementReset} />;

export default definePlugin(() => {
    init().catch((error) => logger.error('Initialisation failed; Steam is left stock.', error));
    return {
        title: 'Enhanced Achievements',
        icon: <IconsModule.Settings />,
        content: <SettingsPanel onPreview={previewTier} achievementReset={achievementReset} />,
    };
});
