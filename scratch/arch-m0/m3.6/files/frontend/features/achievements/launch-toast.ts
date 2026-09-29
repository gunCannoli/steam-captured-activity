import { setting } from "../../settings/settings";
import { getLocalAchievements } from "./store-port";
import { dispatchLaunchToast } from "./toast-port";

const notifiedShortcuts = new Set<number>();

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

    dispatchLaunchToast("Achievements Enabled", "Enjoy your game!");
}
