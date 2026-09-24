import { logger } from '../logger';
import { setting, onSettingChange } from '../settings/settings';
import { activeTheme, audio, onThemeChange } from '../theme/active-theme';
import { completesGame, selectTier, type Tier } from '../theme/theme';

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
}

export interface SteamNotification {
    eType: number;
    data: AchievementData;
    nToastDurationMS?: number;
}

interface NotificationStoreProto {
    PlayNotificationSound(this: unknown, n: SteamNotification): void;
    ChooseSound(this: unknown, config: unknown, n: SteamNotification): unknown;
}

interface NotificationStore {
    TestAchievement(appid: number): Promise<void>;
}

interface TypeConfig {
    toastDurationMS?: number;
    proto?: new () => { getClassName?(): string };
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
        if (forced && Date.now() < forced.until) {
            tier = forced.tier;
        } else {
            const theme = activeTheme()?.theme;
            if (theme) {
                const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as ProgressCache | undefined;
                const progress = cache?.m_achievementProgress?.mapCache?.get(n.data.appid());
                tier = selectTier(theme, { globalPct: n.data.global_achieved_pct(), completesGame: completesGame(progress) });
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
    forced = { tier, until: Date.now() + 10_000 };
    // A click is a user gesture: unlock audio so the preview can play the theme's sound.
    void audio().resume();
    await store.TestAchievement(appid);
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
    onThemeChange(applyDuration);
    onSettingChange((key) => key === 'banner.enabled' && applyDuration());
    logger.info(`Notification hooks installed (achievement eType ${achievementType}).`);
    return true;
}

export function disposeNotifications(): void {
    if (proto && originalPlaySound) proto.PlayNotificationSound = originalPlaySound;
    if (achievementConfig) achievementConfig.toastDurationMS = originalDurationMs;
}
