import type { Surface } from '../../kernel/surface';
import type { NotificationHook } from '../../steam/notification-hook';
import { installInjector, uninstallInjector, type BannerDraws } from './injector';

/**
 * Restyles Steam's toast windows in place: one scoped `<style>` per window and the shown type on its `<body>`; places
 * desktop and overlay toast popups through each one's own `MoveTo` (./toast-window.ts, kill switch `placement`) and
 * Big Picture's one toast place. A toast the achievement banner draws (`bannerDraws`, injected by index.tsx: a surface
 * never imports another) is left to the banner, except for its Big Picture place, which follows the banner's theme.
 */
export function createStyleSurface(hook: NotificationHook, placeholder: string | undefined, bannerDraws: BannerDraws): Surface {
    return {
        id: 'style',
        touches: [
            'toastWindow <style id=enhanced-notifications-theme>',
            'toastWindow body data-en-type',
            'toastPopup SteamClient.Window.MoveTo (remap)',
            'NotificationStore PopNextToastNotification (own property)',
            'Big Picture window <style id=enhanced-notifications-placement>',
        ],
        install: () => installInjector(placeholder, hook.onShown, bannerDraws),
        uninstall: uninstallInjector,
    };
}
