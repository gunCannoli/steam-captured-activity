import { logger } from "../../logger";
import { steamRequire } from "../../steam/modules";

interface AchievementProtoResolution {
    ProtoClass: any;
    typeId: number;
}

let cachedProto: AchievementProtoResolution | undefined;

/**
 * Resolves the protobuf class for CClientNotificationAchievement and notification type ID (5).
 * Uses real prototype method signatures ("set_achievement_id" & "global_achieved_pct")
 * which survive Steam build minification (ADR-0005).
 */
function resolveAchievementProto(): AchievementProtoResolution | undefined {
    if (cachedProto) return cachedProto;

    const req = steamRequire();
    if (!req || !req.m) return undefined;

    for (const [id, factory] of Object.entries(req.m)) {
        if (!factory) continue;
        const src = factory.toString();
        if (src.includes("achievement_id") && src.includes("global_achieved_pct")) {
            try {
                const mod = req(id) as Record<string, any>;
                if (!mod) continue;

                let ProtoClass: any;
                let typeId = 5;

                for (const key of Object.keys(mod)) {
                    const val = mod[key];
                    if (
                        val?.prototype &&
                        typeof val.prototype.set_achievement_id === "function" &&
                        typeof val.prototype.set_global_achieved_pct === "function"
                    ) {
                        ProtoClass = val;
                    }
                    if (val && typeof val === "object" && typeof val.ok === "number") {
                        typeId = val.ok;
                    }
                }

                if (ProtoClass) {
                    cachedProto = { ProtoClass, typeId };
                    return cachedProto;
                }
            } catch (err) {
                logger.warn(`Failed evaluating achievement proto module ${id}:`, err);
            }
        }
    }

    return undefined;
}

export interface ToastAchievementPayload {
    id: string;
    name: string;
    description: string;
    icon: string;
    global_pct?: number;
    rtime_unlocked?: number;
}

/**
 * Dispatches a native Steam achievement toast popup and chime via NotificationStore.OnNotification.
 */
export function dispatchAchievementToast(
    shortcutAppId: number,
    item: ToastAchievementPayload,
): boolean {
    const store = (window as any).NotificationStore;
    if (!store || typeof store.OnNotification !== "function") {
        logger.warn("NotificationStore.OnNotification is unavailable.");
        return false;
    }

    const res = resolveAchievementProto();
    if (!res) {
        logger.warn("Could not resolve Steam achievement notification protobuf.");
        return false;
    }

    try {
        const { ProtoClass, typeId } = res;
        const msg = new ProtoClass();
        msg.set_achievement_id(item.id);
        msg.set_appid(shortcutAppId);
        msg.set_name(item.name);
        msg.set_description(item.description);
        msg.set_image_url(item.icon);
        msg.set_achieved(true);
        msg.set_rtime_unlocked(item.rtime_unlocked ?? Math.floor(Date.now() / 1000));
        msg.set_global_achieved_pct(item.global_pct ?? 0);

        const binary = msg.serializeBinary();
        const notifId = typeof store.m_nNextTestNotificationID === "number"
            ? store.m_nNextTestNotificationID++
            : Math.floor(Date.now() % 1000000);

        store.OnNotification(notifId, typeId, binary);
        logger.info(`Dispatched native achievement toast for shortcut ${shortcutAppId}: "${item.name}"`);
        return true;
    } catch (e) {
        logger.error("Failed to dispatch achievement toast:", e);
        return false;
    }
}
