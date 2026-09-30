import { logger } from '../../logger';
import { COMPLETION_ID, PREVIEW_ID_PREFIX, TEST_UNLOCK_ID } from '../../kernel/notification';
import { notificationStore } from '../../steam/notification-store';
import { activeTheme, audio } from '../../theme/active-theme';
import type { Tier } from '../../theme/theme';
import { isEnabled } from '../../safety/runtime';

/**
 * Synthetic toasts: settings-panel previews, the 100% completion toast and the
 * capture test unlock, posted through Steam's own path. Every entry point does
 * nothing when the `toasts` feature is switched off.
 */

interface AchievementFields {
    appid: number;
    achievement_id: string;
    name: string;
    description: string;
    image_url?: string;
    global_achieved_pct: number;
}

interface ProtoClass {
    fromObject(o: Record<string, unknown>): { serializeBinary(): Uint8Array };
}

interface ProgressCache {
    m_achievementProgress?: { mapCache?: Map<number, unknown> };
}

/**
 * Post an achievement notification through Steam's own path
 * (docs/steam-components.md § Test toast): the same toast, sound, timing and
 * hooks as a real unlock. Each call gets its own notification id and data object.
 */
function postAchievement(fields: AchievementFields): boolean {
    const handle = notificationStore();
    const proto = handle?.config.proto as ProtoClass | undefined;
    if (!handle || !proto) return false;
    const { store, achievementType } = handle;
    const msg = proto.fromObject({
        ...fields,
        image_url: fields.image_url ?? '',
        achieved: true,
        rtime_unlocked: Math.floor(Date.now() / 1000),
    });
    const id = typeof store.m_nNextTestNotificationID === 'number' ? store.m_nNextTestNotificationID++ : Date.now() & 0x7fffffff;
    store.OnNotification(id, achievementType, msg.serializeBinary());
    return true;
}

interface Highlight {
    strName?: string;
    strDescription?: string;
    strImage?: string;
}

interface AppDetailsStore {
    RequestAppDetails?(appid: number): Promise<{ achievements?: { vecHighlight?: Highlight[] } } | undefined>;
}

/** Steam's own fallback in `TestAchievement`, for apps without highlighted achievements. */
const MADE_UP: Highlight = {
    strName: 'won a race',
    strDescription: 'You placed 1st!',
    strImage: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/270880/2aec8af4b4b23cb6054d9aea06194621cdd66945.jpg',
};

const samples = new Map<number, Promise<Highlight[]>>();

/**
 * Real achievements to dress previews in, the way `TestAchievement` does
 * (`appDetailsStore.RequestAppDetails(appid).achievements.vecHighlight`).
 * Fetched once per app and cached, so rapid preview clicks never wait on it twice.
 */
function sampleAchievements(appid: number): Promise<Highlight[]> {
    let pending = samples.get(appid);
    if (!pending) {
        const ds = Reflect.get(globalThis, 'appDetailsStore') as AppDetailsStore | undefined;
        const request = (async () => (await ds?.RequestAppDetails?.(appid))?.achievements?.vecHighlight ?? [])();
        const timeout = new Promise<Highlight[]>((resolve) => setTimeout(() => resolve([]), 2000));
        pending = Promise.race([request, timeout]).catch(() => []);
        samples.set(appid, pending);
    }
    return pending;
}

/**
 * Settings panel "Preview": post a synthetic unlock whose id carries its tier
 * (`EA_PREVIEW_<tier>`), so the tier is exact however fast previews are
 * clicked, and captures skip it by id (never by a time window that could
 * swallow a real unlock).
 */
export async function previewTier(tier: Tier): Promise<void> {
    if (!isEnabled('toasts') || !notificationStore()) return;
    // A click is a user gesture: unlock audio so the preview can play the theme's sound.
    void audio().resume();

    const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as ProgressCache | undefined;
    // Any owned game with achievements gives a real achievement image; 480 (Spacewar) makes one up.
    const appid: number = cache?.m_achievementProgress?.mapCache?.keys().next().value ?? 480;
    const pool = await sampleAchievements(appid);
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)]! : MADE_UP;

    const theme = activeTheme()?.theme;
    const exceptional = tier === 'exceptional' ? theme?.tiers.exceptional.text : undefined;
    const threshold = theme?.tiers[tier].threshold;
    postAchievement({
        appid,
        achievement_id: PREVIEW_ID_PREFIX + tier,
        name: exceptional?.titleText || pick.strName || 'Achievement unlocked',
        description: exceptional?.descText || pick.strDescription || '',
        image_url: pick.strImage,
        global_achieved_pct: typeof threshold === 'number' ? threshold : 50,
    });
}

/**
 * Fire synthetic 100% completion (Platinum) notification.
 * Steam has no native 100% completion achievement, so the plugin synthesizes
 * this toast when all achievements in a game have been unlocked.
 */
export function fireExceptionalCompletionToast(appid: number): boolean {
    if (!isEnabled('toasts')) return false;
    try {
        const text = activeTheme()?.theme.tiers.exceptional.text;
        return postAchievement({
            appid,
            achievement_id: COMPLETION_ID,
            name: text?.titleText || '100% Complete',
            description: text?.descText || "You've unlocked all achievements!",
            global_achieved_pct: 0,
        });
    } catch (error) {
        logger.warn('Could not fire 100% completion toast.', error);
        return false;
    }
}

/**
 * Fire a real (non-preview) test unlock for `appid`, running the full capture
 * pipeline through the normal hook. Used by tests/captures.mjs (the settings
 * panel's own "Test captures" button was removed; this export stays for the
 * live regression test). Does not use `TestAchievement`: that awaits
 * `RequestAppDetails(appid)`, unverified for shortcut appids.
 */
export function fireTestUnlock(appid: number, name: string): boolean {
    if (!isEnabled('toasts')) return false;
    try {
        return postAchievement({
            appid,
            achievement_id: TEST_UNLOCK_ID,
            name,
            description: 'Enhanced Achievements capture test',
            global_achieved_pct: 50,
        });
    } catch (error) {
        logger.warn('Could not fire test unlock.', error);
        return false;
    }
}
