import { definePlugin, IconsModule } from '@steambrew/client';
import { logger } from './logger';
import { initSettings } from './settings/settings';

// Named exports are published by Millennium on window.PLUGIN_LIST[<plugin>],
// which is how tests/*.mjs drive the same code paths as the settings panel.
export { resetSettings, setSetting } from './settings/settings';
export { previewTier, fireTestUnlock, fireExceptionalCompletionToast } from './steam/notifications';
export { activeTheme } from './theme/active-theme';
export { claims } from './claims';
export { jsxDiagnostics } from './steam/toast-patch';
export { captureLog, setCaptureDryRun } from './capture/captures';
export { recordingDiagnostics, runningGameAppid } from './steam/recording';
export { toastsEnabled } from './steam/notification-settings';
import { SettingsPanel } from './settings/settings-panel';
import { initNotifications } from './steam/notifications';
import { initToastPatch } from './steam/toast-patch';
import { initActiveTheme } from './theme/active-theme';
import { initRecording } from './steam/recording';
import { initNotificationSettingsDetection } from './steam/notification-settings';

/**
 * enhanced-achievements: themed achievement toasts and sounds.
 *
 * Scope (docs/plans/enhanced-achievements-plan.md § 5): hooks only NotificationStore
 * and the toast dispatcher. It never touches AppOverview, StoreItemCache, the
 * section registry or the activity/spotlight stores that
 * non-steam-games-activity feeds, and never imports from that plugin.
 */
async function init(): Promise<void> {
    await initSettings();
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
