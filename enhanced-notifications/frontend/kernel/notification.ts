/**
 * Kernel: the shape of Steam's notification as this plugin reads it. Only the
 * type is read; the type's name comes from steam/notification-store.ts. Pure.
 * (enhanced-achievements' copy of this file also types the achievement data; the
 * shared steam/notification-hook.ts only needs this shape.)
 */

export interface SteamNotification {
    eType: number;
}
