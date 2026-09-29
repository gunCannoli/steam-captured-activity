// Surface `toasts` (migration plan M3.6): the "Achievements Enabled" launch notification
// through NotificationStore.ProcessNotification. Moved from features/achievements/launch-toast.ts;
// the launch policy stays there.
import { logger } from "../../logger";
import { deps } from "./deps";

/**
 * Dispatches a native Steam notification toast when game launches with active achievements.
 */
export function dispatchLaunchToast(
    title: string = "Achievements Enabled",
    body: string = "Enjoy your game!",
    icon?: string,
): boolean {
    if (!deps.isEnabled("toasts")) return false;
    const store = (window as any).NotificationStore;
    if (!store || typeof store.ProcessNotification !== "function") {
        logger.warn("NotificationStore.ProcessNotification is unavailable for launch toast.");
        return false;
    }

    try {
        const notifId = 999990000 + ((store.m_nNextTestNotificationID++) || 1);
        const notif = {
            notification_id: notifId,
            notification_targets: 3,
            notification_type: 18, // General announcement toast
            body_data: JSON.stringify({
                display_name: title,
                body: body,
                image: icon || "https://community.cloudflare.steamstatic.com/public/images/apps/435150/118837130f1d53086eb0155b4105fe8b69ff2262.jpg",
            }),
            read: false,
            timestamp: Math.floor(Date.now() / 1000),
        };

        store.ProcessNotification(notif);
        logger.info(`Dispatched launch notification: "${title}"`);
        return true;
    } catch (e) {
        logger.error("Failed dispatching launch toast:", e);
        return false;
    }
}
