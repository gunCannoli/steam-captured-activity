import { definePlugin, IconsModule } from '@steambrew/client';
import { logger } from './logger';
import { initSettings, onSettingChange, setting } from './settings/settings';
import { SettingsPanel } from './settings/settings-panel';
import { beginBoot, watchBoot } from './safety/boot';
import { errorCount, initSafety, isEnabled, reloadSafety, reportError } from './safety/runtime';
import type { FeatureId } from './safety/features';
import { installSurfaces, type SurfaceStatus } from './kernel/surface';
import { resolveNotificationStore } from './steam/notification-store';
import { installNotificationHook } from './steam/notification-hook';
import { resolveToastSelectors } from './steam/selectors';
import { initNotificationSettingsDetection } from './steam/notification-settings';
import { initActiveTheme, setSelectors } from './theme/active-theme';
import { createSoundSurface } from './surfaces/sound';
import { createDurationSurface } from './surfaces/duration';
import { createStyleSurface } from './surfaces/style';
import { createPreviewSurface, preview } from './surfaces/preview';

// Named exports are published by Millennium on window.PLUGIN_LIST[<plugin>],
// which is how tests/*.mjs drive the same code paths as the settings panel.
export { resetSettings, setSetting } from './settings/settings';
export { preview, previewIds } from './surfaces/preview';
export { activeTheme, themeCss } from './theme/active-theme';
export { toastsEnabled } from './steam/notification-settings';
export { safetyDiagnostics } from './safety/runtime';
export { debugBigPicture, bigPictureTrace, debugBigPictureType } from './surfaces/style/bp-debug';

/**
 * enhanced-notifications: restyles every Steam notification toast in place.
 *
 * Scope: hooks only NotificationStore (sound, durations) and adds a scoped
 * <style> to toast windows. It never touches AppOverview, StoreItemCache, the
 * section registry or the activity/spotlight stores, and never imports from
 * another plugin. Layers and owners: docs/enhanced-notifications/architecture.md.
 */
let surfaceReport: SurfaceStatus[] = [];

/** Which surfaces installed and why one did not (window.PLUGIN_LIST[...].surfaceStatus()). */
export function surfaceStatus(): SurfaceStatus[] {
    return surfaceReport;
}

async function init(): Promise<void> {
    await initSettings();
    // Kill switches, error budget and safe mode (same design as enhanced-achievements, ADR-0043).
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

    const hook = installNotificationHook(handle.proto, handle.store, {
        reportError,
        warn: (message, err) => logger.warn(message, err),
    });
    logger.info(`Notification hook installed (${handle.configs.size} types).`);
    initNotificationSettingsDetection(); // its failure only disables the settings-panel warning
    const sel = resolveToastSelectors();
    setSelectors(sel.theme);
    await initActiveTheme();

    const surfaces = [createSoundSurface(hook), createDurationSurface(handle), createStyleSurface(hook, sel.placeholder), createPreviewSurface()];
    for (const s of surfaces) uninstallers[s.id as FeatureId] = () => s.uninstall();
    surfaceReport = installSurfaces(surfaces, {
        isEnabled: (id) => isEnabled(id as FeatureId),
        reportError: (id, err) => reportError(id as FeatureId, err),
    });
}

/** The settings panel as a component, so live tests can mount it without opening Steam's settings window. */
export const SettingsPanelView = () => <SettingsPanel onPreview={() => preview()} />;

export default definePlugin(() => {
    init().catch((error) => logger.error('Initialisation failed; Steam is left stock.', error));
    return {
        title: 'Enhanced Notifications',
        icon: <IconsModule.Settings />,
        content: <SettingsPanel onPreview={() => preview()} />,
    };
});
