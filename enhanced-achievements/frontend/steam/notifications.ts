import { logger } from '../logger';
import { activeTheme, audio, onThemeChange } from '../theme/active-theme';
import { completesGame, selectTier, TIERS, type ResolvedTheme, type Tier } from '../theme/theme';
import { bannerTiming } from '../banner/timing';
import { onUnlock } from '../capture/captures';
import { phaseOf, subscribe } from '../banner/queue';

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
    /**
     * When set, Steam's desktop toast loop keeps the toast showing until this
     * returns true, instead of timing it by `nToastDurationMS` (read every frame).
     */
    fnNotificationResolved?: () => boolean;
}

/** Synthetic achievement ids this plugin posts. Never real Steam ids. */
export const PREVIEW_ID_PREFIX = 'EA_PREVIEW_';
export const COMPLETION_ID = 'EA_100_PERCENT';
export const TEST_UNLOCK_ID = 'EA_TEST';

/** The tier a settings-panel preview was posted for, or null for any other notification. */
export function previewTierOf(n: SteamNotification): Tier | null {
    try {
        const id = n.data.achievement_id?.();
        if (typeof id !== 'string' || !id.startsWith(PREVIEW_ID_PREFIX)) return null;
        const tier = id.slice(PREVIEW_ID_PREFIX.length) as Tier;
        return TIERS.includes(tier) ? tier : null;
    } catch {
        return null;
    }
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
/** Unlocks whose completion check already ran: Steam calls PlayNotificationSound once per toast shown, possibly more than once. */
const completionChecked = new WeakSet<object>();
/** Unlocks whose sound is already waiting for their banner's turn. */
const soundDeferred = new WeakSet<object>();

interface ProgressCache {
    m_achievementProgress?: { mapCache?: Map<number, { unlocked?: number; total?: number; all_unlocked?: boolean }> };
}

export function tierFor(n: SteamNotification): Tier {
    const memo = tiers.get(n.data);
    if (memo) return memo;

    let tier: Tier = 'normal';
    try {
        // Previews carry their tier in their own id, so rapid clicks can never
        // hand one preview's tier to another toast (or to a real unlock).
        const preview = previewTierOf(n);
        if (preview) {
            tier = preview;
        } else if (n.data.achievement_id?.() === COMPLETION_ID) {
            tier = 'exceptional';
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
                // Previews never capture (A2.4), and the synthetic 100% toast does not
                // capture again: the unlock that triggered it already did. Decided by
                // id, so a real unlock right after either still captures.
                if (!previewTierOf(n) && n.data.achievement_id?.() !== COMPLETION_ID) onUnlock(n, tier);

                // An unlock that completes the game schedules the synthetic 100%
                // completion toast right after, once. Previews and that toast itself
                // never do (EA_TEST does: it stands in for a real unlock).
                const synthetic = previewTierOf(n) !== null || n.data.achievement_id?.() === COMPLETION_ID;
                if (!synthetic && !completionChecked.has(n.data)) {
                    completionChecked.add(n.data);
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
        // Queued banner: its sound waits for its turn, so a burst of unlocks
        // is heard one at a time with the banners, not all at once on arrival.
        if (isAchievementUnlock(n) && phaseOf(n.data) === 'waiting') {
            if (!soundDeferred.has(n.data)) {
                soundDeferred.add(n.data);
                const self = this;
                const off = subscribe(n.data, () => {
                    const phase = phaseOf(n.data);
                    if (phase === 'waiting') return;
                    off();
                    if (phase === 'showing') playSound(self, n); // dismissed before its turn: silent
                });
            }
            return;
        }
        return playSound(this, n);
    };

    function playSound(self: { ChooseSound?: unknown }, n: SteamNotification): void {
        try {
            if (isAchievementUnlock(n)) {
                const clip = activeTheme()?.sounds.get(tierFor(n));
                const ctx = clip ? audio() : null;
                if (clip && ctx?.state === 'running') {
                    // Let Steam decide whether a sound is wanted (its mute setting),
                    // but take the decision instead of playing its chime.
                    let wanted = false;
                    self.ChooseSound = function (this: unknown, config: unknown, notification: SteamNotification) {
                        wanted = !!originalChoose.call(this, config, notification);
                        return null;
                    };
                    try {
                        original.call(self, n);
                    } finally {
                        delete self.ChooseSound;
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
        original.call(self, n);
    }
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
            originalDurationMs = pristineDuration(config);
            return;
        }
    }
}

/**
 * Steam's own `toastDurationMS` for a type config, before any plugin wrote it.
 * SAME HELPER in enhanced-notifications (plugins may not import each other):
 * the first plugin to see a config records its value in a shared global
 * WeakMap, so whichever loads second still restores Steam's value, not the
 * other plugin's.
 */
function pristineDuration(config: object & { toastDurationMS?: number }): number | undefined {
    const g = globalThis as { __enhancedPristineToastDurations?: WeakMap<object, number | undefined> };
    const stash = (g.__enhancedPristineToastDurations ??= new WeakMap());
    if (!stash.has(config)) stash.set(config, config.toastDurationMS);
    return stash.get(config);
}

/** How long a themed banner is fully visible: the theme's `display_time_ms`, else Steam's own duration. */
export function themedDisplayMs(theme: ResolvedTheme): number {
    return theme.displayTimeMs ?? (originalDurationMs || 5000); // Steam: `toastDurationMS || 5e3`
}

/**
 * With a theme, Steam's toast lasts the banner's whole lifetime (entrance +
 * display + exit), so where Steam times the toast itself (Big Picture) the
 * exit animation is never cut short; on desktop the banner holds its popup
 * anyway. Without a theme: Steam's own duration.
 */
function applyDuration(): void {
    if (!achievementConfig) return;
    const theme = activeTheme()?.theme;
    achievementConfig.toastDurationMS = theme ? bannerTiming(theme.animation, themedDisplayMs(theme)).totalMs : originalDurationMs;
}

// --- synthetic toasts -------------------------------------------------------------

interface AchievementFields {
    appid: number;
    achievement_id: string;
    name: string;
    description: string;
    image_url?: string;
    global_achieved_pct: number;
}

/**
 * Post an achievement notification through Steam's own path
 * (docs/steam-components.md § Test toast): the same toast, sound, timing and
 * hooks as a real unlock. Each call gets its own notification id and data object.
 */
function postAchievement(fields: AchievementFields): boolean {
    if (!store || !achievementConfig?.proto || achievementType === null) return false;
    const msg = achievementConfig.proto.fromObject({
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
    if (!store) return;
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
    logger.info(`Notification hooks installed (achievement eType ${achievementType}).`);
    return true;
}

export function disposeNotifications(): void {
    if (proto && originalPlaySound) proto.PlayNotificationSound = originalPlaySound;
    if (achievementConfig) achievementConfig.toastDurationMS = originalDurationMs;
}
