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
export { jsxDiagnostics } from './steam/toast-patch';
export { captureLog, setCaptureDryRun } from './capture/captures';
export { recordingDiagnostics, runningGameAppid } from './steam/recording';
export { toastsEnabled } from './steam/notification-settings';
export { safetyDiagnostics } from './safety/runtime';
import { SettingsPanel } from './settings/settings-panel';
import { resolveNotificationStore } from './steam/notification-store';
import { installNotificationHook } from './steam/notification-hook';
import { initToastPatch } from './steam/toast-patch';
import { initActiveTheme, tierFor } from './theme/active-theme';
import { createEventBus } from './kernel/events';
import { installSurfaces } from './kernel/surface';
import { installUnlockSensor } from './sensors/unlock';
import { createSoundSurface } from './surfaces/sound';
import { createDurationSurface } from './surfaces/duration';
import { completionHandler, createToastsSurface } from './surfaces/toasts';
import { previewTier } from './surfaces/toasts/post';
import { onUnlock } from './capture/captures';
import { initRecording } from './steam/recording';
import { initNotificationSettingsDetection } from './steam/notification-settings';

/**
 * enhanced-achievements: themed achievement toasts and sounds.
 *
 * Scope: hooks only NotificationStore and the toast dispatcher. It never
 * touches AppOverview, StoreItemCache, the section registry or the
 * activity/spotlight stores that steam-cartridges feeds, and never imports
 * from that plugin.
 */
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
    initRecording(); // its failure only disables captures, not the rest of the plugin
    initNotificationSettingsDetection(); // its failure only disables the settings-panel warning
    await initActiveTheme();

    const surfaces = [createSoundSurface(hook), createDurationSurface(handle), createToastsSurface(handle)];
    for (const s of surfaces) uninstallers[s.id as FeatureId] = () => s.uninstall();
    installSurfaces(surfaces, {
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
    // Captures run one macrotask after the toast is shown, never inside Steam's call; onUnlock reports its own errors.
    bus.on('achievement.unlocked', (e) => {
        if (isEnabled('captures')) onUnlock(e.n, tierFor(e.n));
    });
    initToastPatch();
}

export default definePlugin(() => {
    init().catch((error) => logger.error('Initialisation failed; Steam is left stock.', error));
    return {
        title: 'Enhanced Achievements',
        icon: <IconsModule.Settings />,
        content: <SettingsPanel onPreview={previewTier} />,
    };
});
