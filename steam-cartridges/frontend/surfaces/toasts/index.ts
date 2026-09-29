// Surface `toasts` (migration plan M3.6, ADR-0039): the only code that shows Steam
// notifications. No hooks: two writes into NotificationStore. The features reach it only
// through features/achievements/toast-port.ts, wired in index.tsx (plan § 7.0 D3).
import type { Surface, SurfaceDeps } from "../../kernel/surface";
import { dispatchAchievementToast } from "./achievement";
import { deps } from "./deps";
import { dispatchLaunchToast } from "./launch";

export { dispatchAchievementToast, dispatchLaunchToast };
export type { ToastAchievementPayload } from "./achievement";

export function createToastsSurface(d: SurfaceDeps): Surface {
    deps.isEnabled = d.isEnabled;
    deps.reportError = d.reportError;
    return {
        id: "toasts",
        touches: [
            "NotificationStore.OnNotification",
            "NotificationStore.ProcessNotification",
            "NotificationStore.m_nNextTestNotificationID",
        ],
        reads: ["achievements"],
        install() {},
        render() {
            /* event-driven (achievements.unlocked) from M6 (plan § 7.0 D4) */
        },
        clear() {},
        uninstall() {},
    };
}
