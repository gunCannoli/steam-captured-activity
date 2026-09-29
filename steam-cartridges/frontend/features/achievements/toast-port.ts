// The toasts surface as the features see it (migration plan M3.6, § 7.0 D3): wired in
// index.tsx to surfaces/toasts, no-ops until then. Remove in M6 (purge ledger).

/** Structural copy of surfaces/toasts ToastAchievementPayload. */
export interface ToastAchievementPayload {
    id: string;
    name: string;
    description: string;
    icon: string;
    global_pct?: number;
    rtime_unlocked?: number;
}

let toasts: {
    achievement(shortcutAppId: number, item: ToastAchievementPayload): boolean;
    launch(title?: string, body?: string, icon?: string): boolean;
} = { achievement: () => false, launch: () => false };

export function setToasts(next: typeof toasts): void {
    toasts = next;
}

export const dispatchAchievementToast = (shortcutAppId: number, item: ToastAchievementPayload) =>
    toasts.achievement(shortcutAppId, item);
export const dispatchLaunchToast = (title?: string, body?: string, icon?: string) => toasts.launch(title, body, icon);
