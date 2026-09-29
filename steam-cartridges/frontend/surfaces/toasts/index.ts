// Surface `toasts` (migration plan M3.6, ADR-0039): the only code that shows Steam
// notifications. No hooks: two writes into NotificationStore. index.tsx shows one toast per id of
// `achievements.unlocked` (reading the name, description and icon from the record's schema) and
// the launch toast policy in app/achievements.ts calls dispatchLaunchToast (plan M6b).
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
            /* event-driven: achievements.unlocked, wired in index.tsx (plan M6b) */
        },
        clear() {},
        uninstall() {},
    };
}
