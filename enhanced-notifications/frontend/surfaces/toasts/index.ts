import type { Events } from '../../kernel/events';
import type { Surface } from '../../kernel/surface';
import type { NotificationStoreHandle } from '../../steam/notification-store';
import { isEnabled } from '../../safety/runtime';
import { createCompletion } from './completion';
import { fireExceptionalCompletionToast } from './post';

/** Pending 100% toast timers, so uninstalling the surface cancels them. */
const timers = new Set<ReturnType<typeof setTimeout>>();

/** Posts our synthetic toasts (previews, 100% completion, test unlock) through Steam's NotificationStore. */
export function createToastsSurface(handle: NotificationStoreHandle): Surface {
    return {
        id: 'toasts',
        touches: ['NotificationStore.OnNotification', 'NotificationStore.m_nNextTestNotificationID'],
        install: () => !!handle.achievement?.config.proto, // nothing to patch: only posts, and only if the achievement type has its protobuf class
        uninstall() {
            for (const t of timers) clearTimeout(t);
            timers.clear();
        },
    };
}

/** The `achievement.unlocked` subscriber that posts the 100% toast; gated by both `completion` and `toasts`. */
export const completionHandler: (e: Events['achievement.unlocked']) => void = createCompletion({
    isEnabled: () => isEnabled('completion') && isEnabled('toasts'),
    post: (appid) => void fireExceptionalCompletionToast(appid),
    schedule(fn, ms) {
        const t = setTimeout(() => {
            timers.delete(t);
            fn();
        }, ms);
        timers.add(t);
    },
});
