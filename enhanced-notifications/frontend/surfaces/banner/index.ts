import type { Surface } from '../../kernel/surface';
import { disposeToastPatch, initToastPatch } from './toast-patch';

/** Replaces Steam's achievement toast with the themed banner (jsx replacement, popup hold and pin). */
export function createBannerSurface(): Surface {
    return {
        id: 'banner',
        touches: ['jsx-runtime:toast-dispatcher', 'notification.fnNotificationResolved', 'achievement banner popup SteamClient.Window.MoveTo (pin)'],
        install: () => initToastPatch(),
        uninstall: () => disposeToastPatch(),
    };
}
