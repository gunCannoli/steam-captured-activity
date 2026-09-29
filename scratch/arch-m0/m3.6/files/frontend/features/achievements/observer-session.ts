import { logger } from "../../logger";
import { rpc, type AchievementUnlockRecord } from "../../rpc";
import { dispatchAchievementToast } from "./toast-port";
import { getLocalAchievements, getLocalSchema, getLocalUnlocks, updateShortcutState } from "./store-port";

const activeSessions = new Map<number, () => void>();

/**
 * Checks for new unlocks via backend observer and updates UI sinks.
 */
export async function checkObserverUnlocks(
    shortcutAppId: number,
    nativeAppId: number,
    gameTitle?: string,
): Promise<number> {
    try {
        const res = await rpc.cartridgesAchievementsCheckUnlocks(
            shortcutAppId,
            nativeAppId,
            gameTitle,
        );

        if (!res || !res.new_unlocks || res.new_unlocks.length === 0) {
            return 0;
        }

        const newUnlocks = res.new_unlocks;
        logger.info(
            `Observer detected ${newUnlocks.length} new unlock(s) for shortcut ${shortcutAppId}: ` +
            newUnlocks.map((u: { name: string }) => u.name).join(", "),
        );

        // Update in-memory unlocks
        const existingUnlocks: Record<string, AchievementUnlockRecord> = {
            ...(getLocalUnlocks(shortcutAppId) || {}),
        };

        for (const unlock of newUnlocks) {
            const unlockTime = unlock.rtime_unlocked || Math.floor(Date.now() / 1000);
            existingUnlocks[unlock.id] = { unlocked_time: unlockTime };

            // 1. Dispatch native Steam toast & sound
            dispatchAchievementToast(shortcutAppId, {
                id: unlock.id,
                name: unlock.name,
                description: unlock.description,
                icon: unlock.icon,
                global_pct: unlock.global_pct,
                rtime_unlocked: unlockTime,
            });

            // 2. Feed Post-Game Summary session (CAppSpotlightStore)
            try {
                const spotlight = (window as any).appSpotlightStore;
                const appData = spotlight?.GetOrCreateAppData?.(shortcutAppId);
                if (appData?.m_session && typeof appData.m_session.AddAchievement === "function") {
                    appData.m_session.AddAchievement(
                        {
                            strID: unlock.id,
                            strName: unlock.name,
                            strDescription: unlock.description,
                            strImage: unlock.icon,
                            bAchieved: true,
                            rtUnlocked: unlockTime,
                        },
                        Date.now(),
                    );
                }
            } catch (err) {
                logger.warn("Could not push achievement to spotlight store session:", err);
            }
        }

        // 3. Update store and trigger AppDetailsChanged
        const schema = getLocalSchema(nativeAppId) || (getLocalAchievements(shortcutAppId) ? {
            native_appid: nativeAppId,
            total: getLocalAchievements(shortcutAppId)!.nTotal,
            achievements: [
                ...getLocalAchievements(shortcutAppId)!.vecAchieved,
                ...getLocalAchievements(shortcutAppId)!.vecUnachieved,
            ].map((a) => ({
                id: a.strID,
                name: a.strName,
                description: a.strDescription,
                icon: a.strImage,
                global_pct: a.flAchieved ?? 0,
            })),
        } : undefined);

        if (schema) {
            updateShortcutState(shortcutAppId, nativeAppId, schema, existingUnlocks);
        }

        return newUnlocks.length;
    } catch (e) {
        logger.error(`Error checking observer unlocks for ${shortcutAppId}:`, e);
        return 0;
    }
}

/**
 * Starts a polling observer session while a game is actively running.
 */
export function startAchievementsObserver(
    shortcutAppId: number,
    nativeAppId: number,
    gameTitle?: string,
): () => void {
    // If a session is already active for this shortcut, stop it first
    if (activeSessions.has(shortcutAppId)) {
        activeSessions.get(shortcutAppId)!();
    }

    logger.info(`Starting in-game achievement observer for shortcut ${shortcutAppId} (native ${nativeAppId})`);

    // Poll every 2000 ms
    const interval = setInterval(() => {
        void checkObserverUnlocks(shortcutAppId, nativeAppId, gameTitle);
    }, 2000);

    const stop = () => {
        clearInterval(interval);
        activeSessions.delete(shortcutAppId);
        // Final check on quit
        void checkObserverUnlocks(shortcutAppId, nativeAppId, gameTitle);
        logger.info(`Stopped in-game achievement observer for shortcut ${shortcutAppId}`);
    };

    activeSessions.set(shortcutAppId, stop);
    return stop;
}
