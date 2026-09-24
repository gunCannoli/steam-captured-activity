import { definePlugin, IconsModule } from '@steambrew/client';
import { logger } from './logger';
import { initSettings } from './settings/settings';
import { SettingsPanel } from './settings/settings-panel';
import { initNotifications } from './steam/notifications';
import { resolveToastSelectors } from './steam/selectors';
import { initInjector } from './style/injector';
import { initActiveTheme, setSelectors } from './theme/active-theme';
import { initNotificationSettingsDetection } from './steam/notification-settings';

// Named exports are published by Millennium on window.PLUGIN_LIST[<plugin>],
// which is how tests/*.mjs drive the same code paths as the settings panel.
export { resetSettings, setSetting } from './settings/settings';
export { previewCategory } from './steam/notifications';
export { activeTheme, cssFor } from './theme/active-theme';
export { toastsEnabled } from './steam/notification-settings';

/**
 * enhanced-notifications: restyles every Steam notification toast in place.
 *
 * Scope (docs/plans/enhanced-notifications-plan.md): hooks only NotificationStore
 * (sound, durations) and adds a scoped <style> to toast windows. It never touches
 * AppOverview, StoreItemCache, the section registry or the activity/spotlight
 * stores, and never imports from another plugin.
 */
async function init(): Promise<void> {
    await initSettings();
    if (!initNotifications()) return; // stock Steam, untouched
    initNotificationSettingsDetection(); // its failure only disables the settings-panel warning
    const sel = resolveToastSelectors();
    setSelectors(sel.theme);
    await initActiveTheme();
    initInjector(sel.placeholder);
}

export default definePlugin(() => {
    init().catch((error) => logger.error('Initialisation failed; Steam is left stock.', error));
    return {
        title: 'Enhanced Notifications',
        icon: <IconsModule.Settings />,
        content: <SettingsPanel />,
    };
});
