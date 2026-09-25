import { logger } from '../logger';
import { setting, onSettingChange } from '../settings/settings';
import { activeTheme, audio, onThemeChange } from '../theme/active-theme';
import { completesGame, selectTier, type Tier } from '../theme/theme';
import { onUnlock, suppressNextCaptures } from '../capture/captures';

/**
 * Hooks into Steam's NotificationStore: the achievement sound, the toast
 * duration, and the per-notification rarity tier.
 *
 * Verified live (docs/steam-components.md § Resolution signatures & toast
 * windows):
 * - `PlayNotificationSound(n)` is a plain prototype method: it looks up the
 *   per-type config and asks `this.ChooseSound(config, n)`, which already
 *   honours Steam's "play sound on toast" setting.
 * - `ProcessNotification` is a bound, non-writable own property, so it cannot
 *   be wrapped. The toast duration comes from the per-type config's
 *   `toastDurationMS` instead, which both the desktop and in-game overlay paths read.
 * - Achievement notifications carry `data.getClassName() ===
 *   "CClientNotificationAchievement"`. The numeric eType is discovered from
 *   that at startup, never hardcoded.
 */

const ACHIEVEMENT_CLASS = 'CClientNotificationAchievement';

export interface AchievementData {
    appid(): number;
    name(): string;
    description(): string;
    image_url(): string;
    achieved(): boolean;
    global_achieved_pct(): number;
    achievement_id(): string;
}

export interface SteamNotification {
    eType: number;
    data: AchievementData;
    nToastDurationMS?: number;
    /** Unix seconds; set in OnNotification on arrival (Phase 7, unlock offset calc). */
    rtCreated?: number;
    notificationID?: number;
}

interface NotificationStoreProto {
    PlayNotificationSound(this: unknown, n: SteamNotification): void;
    ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown;
}

interface NotificationStore {
    TestAchievement(appid: number): Promise<void>;
    OnNotification(id: number, eType: number, bytes: Uint8Array): void;
    m_nNextTestNotificationID?: number;
}

interface TypeConfig {
    toastDurationMS?: number;
    proto?: (new () => { getClassName?(): string }) & { fromObject(o: Record<string, unknown>): { serializeBinary(): Uint8Array } };
}

let store: NotificationStore | null = null;
let proto: NotificationStoreProto | null = null;
let originalPlaySound: NotificationStoreProto['PlayNotificationSound'] | null = null;
let achievementType: number | null = null;
let achievementConfig: TypeConfig | null = null;
let originalDurationMs: number | undefined;

/** The numeric eType of achievement notifications on this Steam build. */
export function achievementEType(): number | null {
    return achievementType;
}

/** O(1): is this an unlocked-achievement notification (not a progress toast)? */
export function isAchievementUnlock(n: SteamNotification | undefined): n is SteamNotification {
    if (!n || achievementType === null || n.eType !== achievementType) return false;
    try {
        return n.data.achieved() === true;
    } catch {
        return false;
    }
}

// --- tier per notification ----------------------------------------------------

/** Tier memo keyed by the notification's data object: computed once, read by sound and banner. */
const tiers = new WeakMap<object, Tier>();
let forced: { tier: Tier; until: number } | null = null;

interface ProgressCache {
    m_achievementProgress?: { mapCache?: Map<number, { unlocked?: number; total?: number; all_unlocked?: boolean }> };
}

export function tierFor(n: SteamNotification): Tier {
    const memo = tiers.get(n.data);
    if (memo) return memo;

    let tier: Tier = 'normal';
    try {
        if (n.data.achievement_id?.() === 'EA_100_PERCENT') {
            tier = 'exceptional';
        } else if (forced && Date.now() < forced.until) {
            tier = forced.tier;
        } else {
            const theme = activeTheme()?.theme;
            if (theme) {
                // Real achievement unlocks are evaluated for their own tier (normal, magic, rare)
                tier = selectTier(theme, { globalPct: n.data.global_achieved_pct(), completesGame: false });
            }
        }
    } catch (error) {
        logger.warn('Could not determine rarity tier; using normal.', error);
    }
    forced = null;
    tiers.set(n.data, tier);
    return tier;
}

// --- sound --------------------------------------------------------------------

function playClip(clip: { buffer: AudioBuffer; volume: number }): void {
    const ctx = audio();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = clip.volume;
    source.buffer = clip.buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
}

function installSoundHook(p: NotificationStoreProto, owner: object): void {
    const original = p.PlayNotificationSound;
    const originalChoose = p.ChooseSound;
    originalPlaySound = original;

    p.PlayNotificationSound = function (this: { ChooseSound?: unknown }, n: SteamNotification) {
        // Only Steam's own calls (on the store) are toasts; stand-in calls that
        // read a type's config (ours, enhanced-notifications') pass through.
        if (this !== owner) return original.call(this, n);
        try {
            if (isAchievementUnlock(n)) {
                const tier = tierFor(n);
                onUnlock(n, tier);

                // If this is a real unlock (not the synthetic platinum itself) and it completes the game,
                // schedule the synthetic 100% completion toast right after.
                if (n.data.achievement_id?.() !== 'EA_100_PERCENT') {
                    const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as ProgressCache | undefined;
                    const progress = cache?.m_achievementProgress?.mapCache?.get(n.data.appid());
                    if (completesGame(progress)) {
                        const appid = n.data.appid();
                        setTimeout(() => {
                            fireExceptionalCompletionToast(appid);
                        }, 1500);
                    }
                }
            }
        } catch (error) {
            logger.warn('Capture scheduling failed; continuing.', error);
        }
        try {
            if (setting('sound.enabled') && isAchievementUnlock(n)) {
                const clip = activeTheme()?.sounds.get(tierFor(n));
                const ctx = clip ? audio() : null;
                if (clip && ctx?.state === 'running') {
                    // Let Steam decide whether a sound is wanted (its mute setting),
                    // but take the decision instead of playing its chime.
                    let wanted = false;
                    this.ChooseSound = function (this: unknown, config: unknown, notification: SteamNotification) {
                        wanted = !!originalChoose.call(this, config, notification);
                        return null;
                    };
                    try {
                        original.call(this, n);
                    } finally {
                        delete this.ChooseSound;
                    }
                    if (wanted) playClip(clip);
                    return;
                }
                // Audio not unlocked yet: Steam's chime this time, ours from the next toast.
                if (ctx && ctx.state === 'suspended') void ctx.resume();
            }
        } catch (error) {
            logger.warn('Achievement sound hook failed; using Steam chime.', error);
        }
        return original.call(this, n);
    };
}

// --- duration -----------------------------------------------------------------

/**
 * Find the per-type config for achievements. `PlayNotificationSound` only
 * reads `this.ChooseSound` and the config table, so calling the original on a
 * stand-in object hands us each type's config without playing anything.
 */
function discoverAchievementType(p: NotificationStoreProto): void {
    let captured: TypeConfig | undefined;
    const standIn = {
        ChooseSound(config: TypeConfig) {
            captured = config;
            return null;
        },
    };
    for (let eType = 0; eType < 256; eType++) {
        captured = undefined;
        try {
            p.PlayNotificationSound.call(standIn, { eType } as SteamNotification);
        } catch {
            continue;
        }
        // Assigned inside standIn.ChooseSound, which TS cannot see.
        const config = captured as TypeConfig | undefined;
        if (!config?.proto) continue;
        let className: string | undefined;
        try {
            className = new config.proto().getClassName?.();
        } catch {
            continue;
        }
        if (className === ACHIEVEMENT_CLASS) {
            achievementType = eType;
            achievementConfig = config;
            originalDurationMs = config.toastDurationMS;
            return;
        }
    }
}

function applyDuration(): void {
    if (!achievementConfig) return;
    const themed = setting('banner.enabled') ? activeTheme()?.theme.displayTimeMs : null;
    achievementConfig.toastDurationMS = themed ?? originalDurationMs;
}

// --- preview ------------------------------------------------------------------

/** Fire Steam's own test toast with the given tier forced (settings panel "Preview"). */
export async function previewTier(tier: Tier): Promise<void> {
    if (!store) return;
    const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as ProgressCache | undefined;
    // Any owned game with achievements gives a real achievement image; 480 (Spacewar) makes one up.
    const appid = cache?.m_achievementProgress?.mapCache?.keys().next().value ?? 480;

    // Previews must never trigger a real capture (A2.4), same pattern as `forced`.
    suppressNextCaptures(10_000);
    // A click is a user gesture: unlock audio so the preview can play the theme's sound.
    void audio().resume();

    if (tier === 'exceptional') {
        fireExceptionalCompletionToast(appid);
        return;
    }

    forced = { tier, until: Date.now() + 10_000 };
    await store.TestAchievement(appid);
}

/**
 * Fire synthetic 100% completion (Platinum) notification.
 * Steam has no native 100% completion achievement, so the plugin synthesizes
 * this toast when all achievements in a game have been unlocked.
 */
export function fireExceptionalCompletionToast(appid: number): boolean {
    if (!store || !achievementConfig?.proto) return false;
    try {
        const theme = activeTheme()?.theme;
        const exceptional = theme?.tiers.exceptional;
        const title = exceptional?.text.titleText || '100% Complete';
        const desc = exceptional?.text.descText || "You've unlocked all achievements!";
        const nowS = Math.floor(Date.now() / 1000);
        const msg = achievementConfig.proto.fromObject({
            appid,
            achievement_id: 'EA_100_PERCENT',
            name: title,
            description: desc,
            achieved: true,
            global_achieved_pct: 0,
            rtime_unlocked: nowS,
        });
        const id = typeof store.m_nNextTestNotificationID === 'number' ? store.m_nNextTestNotificationID++ : Date.now() & 0x7fffffff;
        if (achievementType === null) return false;
        store.OnNotification(id, achievementType, msg.serializeBinary());
        return true;
    } catch (error) {
        logger.warn('Could not fire 100% completion toast.', error);
        return false;
    }
}

/**
 * Fire a real (non-preview) test unlock for `appid`, running the full capture
 * pipeline through the normal hook. Used by the "Test captures" button
 * (docs/plans/phase7-and-alpha-plan.md § A3.4). Does not use `TestAchievement`:
 * that awaits `RequestAppDetails(appid)`, unverified for shortcut appids.
 */
export function fireTestUnlock(appid: number, name: string): boolean {
    if (!store || !achievementConfig?.proto) return false;
    try {
        const nowS = Math.floor(Date.now() / 1000);
        const msg = achievementConfig.proto.fromObject({
            appid,
            achievement_id: 'EA_TEST',
            name,
            description: 'Enhanced Achievements capture test',
            achieved: true,
            global_achieved_pct: 50,
            rtime_unlocked: nowS,
        });
        const id = typeof store.m_nNextTestNotificationID === 'number' ? store.m_nNextTestNotificationID++ : Date.now() & 0x7fffffff;
        if (achievementType === null) return false;
        store.OnNotification(id, achievementType, msg.serializeBinary());
        return true;
    } catch (error) {
        logger.warn('Could not fire test unlock.', error);
        return false;
    }
}

// --- lifecycle ----------------------------------------------------------------

export function initNotifications(): boolean {
    const candidate = Reflect.get(globalThis, 'NotificationStore') as NotificationStore | undefined;
    const p = candidate ? (Object.getPrototypeOf(candidate) as NotificationStoreProto) : null;
    if (!candidate || typeof p?.PlayNotificationSound !== 'function' || typeof p.ChooseSound !== 'function') {
        logger.warn('NotificationStore not found; enhanced-achievements is inactive.');
        return false;
    }
    store = candidate;
    proto = p;

    discoverAchievementType(p);
    if (achievementType === null) {
        logger.warn('Could not identify the achievement notification type; enhanced-achievements is inactive.');
        return false;
    }

    installSoundHook(p, candidate);
    applyDuration();
    onThemeChange(() => {
        applyDuration();
    });
    onSettingChange((key) => {
        if (key === 'banner.enabled') {
            applyDuration();
        }
    });
    logger.info(`Notification hooks installed (achievement eType ${achievementType}).`);
    return true;
}

export function disposeNotifications(): void {
    if (proto && originalPlaySound) proto.PlayNotificationSound = originalPlaySound;
    if (achievementConfig) achievementConfig.toastDurationMS = originalDurationMs;
}
