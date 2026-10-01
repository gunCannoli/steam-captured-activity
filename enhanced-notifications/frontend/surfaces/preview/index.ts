import type { Surface } from '../../kernel/surface';
import { achievementsClaims } from '../../steam/coexistence';
import { audio } from '../../theme/active-theme';
import { isEnabled, reportError } from '../../safety/runtime';
import { pickPreview } from './pick';

/**
 * Preview: one of Steam's own test toasts, picked at random each time (./pick.ts), from the settings panel (injected
 * as `onPreview`, never imported by it) and the live tests. Only test toasts that Steam shows whatever the user's
 * Friends notification settings are listed (verified live 2026-10-01: friend, message, gift, wishlist, trade and
 * comment test toasts showed nothing here); the incoming voice chat is left out (it is a call). Achievements are
 * offered only while enhanced-achievements does not draw them, since that is its style, not this theme's.
 */

type TestStore = Record<string, ((...args: unknown[]) => unknown) | undefined>;

/** Preview id (Steam's test method without `Test`) -> how to call it. */
const PREVIEWS: Record<string, (store: TestStore, appid: number) => unknown> = {
    DownloadComplete: (s, appid) => s.TestDownloadComplete?.(appid),
    GameRecordingInstantClip: (s) => s.TestGameRecordingInstantClip?.(),
    GameRecordingStart: (s) => s.TestGameRecordingStart?.(),
    CloudSyncFailure: (s, appid) => s.TestCloudSyncFailure?.(appid),
    CloudSyncConflict: (s, appid) => s.TestCloudSyncConflict?.(appid),
    LowBatteryNotification: (s) => s.TestLowBatteryNotification?.(),
    HardwareUpdateNotification: (s) => s.TestHardwareUpdateNotification?.(),
    PlaytimeWarning: (s) => s.TestPlaytimeWarning?.(),
    Achievement: (s, appid) => s.TestAchievement?.(appid),
};

let last: string | null = null;

/** The ids a random preview picks from right now. */
export function previewIds(): string[] {
    return Object.keys(PREVIEWS).filter((id) => id !== 'Achievement' || !achievementsClaims('banner'));
}

/**
 * Show a test toast: `id` (one of `previewIds()`), or a random one. Returns the id shown, or null when nothing was
 * (switched off: safety/features.ts `preview`, or no store).
 */
export async function preview(id?: string): Promise<string | null> {
    if (!isEnabled('preview')) return null;
    const store = Reflect.get(globalThis, 'NotificationStore') as TestStore | undefined;
    const pick = id && PREVIEWS[id] ? id : pickPreview(previewIds(), last);
    if (!store || !pick) return null;
    last = pick;
    try {
        const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as { m_achievementProgress?: { mapCache?: Map<number, unknown> } } | undefined;
        const appid = cache?.m_achievementProgress?.mapCache?.keys().next().value ?? 480;
        void audio().resume(); // a click is a user gesture: unlock audio for the preview
        await PREVIEWS[pick]!(store, appid);
        return pick;
    } catch (error) {
        reportError('preview', error);
        return null;
    }
}

/** Nothing to patch: previews only call Steam's test methods, on demand. */
export function createPreviewSurface(): Surface {
    return {
        id: 'preview',
        touches: ['NotificationStore.Test*'],
        install: () => !!Reflect.get(globalThis, 'NotificationStore'),
        uninstall() {},
    };
}
