import type { Surface } from '../../kernel/surface';
import type { NotificationHook } from '../../steam/notification-hook';
import { installInjector, uninstallInjector } from './injector';

/**
 * Restyles Steam's toast windows in place: one scoped `<style>` per window and the shown type on its `<body>`; places
 * desktop and overlay toast popups through each one's own `MoveTo` (./toast-window.ts, kill switch `placement`).
 */
export function createStyleSurface(hook: NotificationHook, placeholder: string | undefined): Surface {
    return {
        id: 'style',
        touches: [
            'toastWindow <style id=enhanced-notifications-theme>',
            'toastWindow body data-en-type',
            'toastPopup SteamClient.Window.MoveTo',
            'NotificationStore PopNextToastNotification (own property)',
        ],
        install: () => installInjector(placeholder, hook.onShown),
        uninstall: uninstallInjector,
    };
}
