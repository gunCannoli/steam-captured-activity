import type { Surface } from '../../kernel/surface';
import { disposeToastPatch, initToastPatch } from './toast-patch';

/** Replaces Steam's achievement toast with the themed banner (jsx replacement, popup hold and pin). */
export function createBannerSurface(): Surface {
    return {
        id: 'banner',
        // The jsx patch also routes in-game toasts to the visible toast view (kill switch `location`, steam/toast-location.ts).
        touches: ['jsx-runtime:toast-dispatcher', 'notification.fnNotificationResolved', 'achievement banner popup SteamClient.Window.MoveTo (pin)', 'toast container bFocusedLocation'],
        install: () => initToastPatch(),
        uninstall: () => disposeToastPatch(),
    };
}
