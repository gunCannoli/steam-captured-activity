import { definePlugin, IconsModule } from '@steambrew/client';
import { logger } from './logger';
import { initSettings, onSettingChange, setting } from './settings/settings';
import { beginBoot, watchBoot } from './safety/boot';
import { errorCount, initSafety, reloadSafety } from './safety/runtime';

// Named exports are published by Millennium on window.PLUGIN_LIST[<plugin>],
// which is how tests/*.mjs drive the same code paths as the settings panel.
export { allSettings, resetSettings, setSetting } from './settings/settings';
export { previewTier, fireTestUnlock, fireExceptionalCompletionToast } from './steam/notifications';
export { activeTheme } from './theme/active-theme';
export { claims } from './claims';
export { jsxDiagnostics } from './steam/toast-patch';
export { captureLog, setCaptureDryRun } from './capture/captures';
export { recordingDiagnostics, runningGameAppid } from './steam/recording';
export { toastsEnabled } from './steam/notification-settings';
export { safetyDiagnostics } from './safety/runtime';
import { SettingsPanel } from './settings/settings-panel';
import { initNotifications } from './steam/notifications';
import { initToastPatch } from './steam/toast-patch';
import { initActiveTheme } from './theme/active-theme';
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
    initSafety({
        readDisabled: () => setting('disabledFeatures'),
        safeMode: boot.safeMode,
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
    const hooked = initNotifications();
    if (!hooked) return; // stock Steam, untouched
    initRecording(); // its failure only disables captures, not the rest of the plugin
    initNotificationSettingsDetection(); // its failure only disables the settings-panel warning
    await initActiveTheme();
    initToastPatch();
}

export default definePlugin(() => {
    init().catch((error) => logger.error('Initialisation failed; Steam is left stock.', error));
    return {
        title: 'Enhanced Achievements',
        icon: <IconsModule.Settings />,
        content: <SettingsPanel />,
    };
});
