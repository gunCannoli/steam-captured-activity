import { logger } from "../../logger";
import { setting } from "../../settings/settings";
import { getLocalAchievements } from "./store";

const notifiedShortcuts = new Set<number>();

/**
 * Dispatches a native Steam notification toast when game launches with active achievements.
 */
export function dispatchLaunchToast(
    title: string = "Local Achievements Enabled",
    body: string = "Enjoy your game!",
    icon?: string,
): boolean {
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

/**
 * Checks setting policy and fires the launch notification on app start.
 */
export function handleAppLaunchAchievements(shortcutAppId: number): void {
    const policy = setting("localAchievementsNotifyOnLaunch");
    if (policy === "off") return;

    // Check if achievements are available for this shortcut
    const ach = getLocalAchievements(shortcutAppId);
    if (!ach || ach.nTotal === 0) return;

    if (policy === "first_run") {
        if (notifiedShortcuts.has(shortcutAppId)) return;
        notifiedShortcuts.add(shortcutAppId);
    }

    dispatchLaunchToast("Local Achievements Enabled", "Enjoy your game!");
}
