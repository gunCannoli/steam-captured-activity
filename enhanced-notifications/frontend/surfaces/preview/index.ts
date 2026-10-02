import type { Surface } from '../../kernel/surface';
import { audio } from '../../theme/active-theme';
import { isEnabled, reportError } from '../../safety/runtime';
import { pickPreview } from './pick';

/**
 * Preview: one of Steam's own test toasts, picked at random each time (./pick.ts), from the settings panel (injected
 * as `onPreview`, never imported by it) and the live tests. Only test toasts that Steam shows whatever the user's
 * Friends notification settings are listed (verified live 2026-10-01: friend, message, gift, wishlist, trade and
 * comment test toasts showed nothing here); the incoming voice chat is left out (it is a call).
 *
 * Achievements are never Steam's `TestAchievement`: it posts a real achievement id, which the unlock sensor would take
 * for a real unlock (screenshot, clip, a 100% toast). The achievement preview is injected instead (index.tsx: the
 * banner's own preview, surfaces/toasts/post.ts `previewTier`, whose ids the sensor skips): a surface never imports another.
 */

type TestStore = Record<string, ((...args: unknown[]) => unknown) | undefined>;

/** The injected achievement preview (createPreviewSurface); null until installed. */
let previewAchievement: (() => Promise<unknown>) | null = null;

/** Preview id (Steam's test method without `Test`, or `Achievement`) -> how to call it. */
const PREVIEWS: Record<string, (store: TestStore, appid: number) => unknown> = {
    DownloadComplete: (s, appid) => s.TestDownloadComplete?.(appid),
    GameRecordingInstantClip: (s) => s.TestGameRecordingInstantClip?.(),
    GameRecordingStart: (s) => s.TestGameRecordingStart?.(),
    CloudSyncFailure: (s, appid) => s.TestCloudSyncFailure?.(appid),
    CloudSyncConflict: (s, appid) => s.TestCloudSyncConflict?.(appid),
    LowBatteryNotification: (s) => s.TestLowBatteryNotification?.(),
    HardwareUpdateNotification: (s) => s.TestHardwareUpdateNotification?.(),
    PlaytimeWarning: (s) => s.TestPlaytimeWarning?.(),
    Achievement: () => previewAchievement?.(),
};

/** The settings panel's name for each preview id, in the dropdown's order. */
const LABELS: Record<string, string> = {
    Achievement: 'Achievement unlocked',
    DownloadComplete: 'Download complete',
    GameRecordingInstantClip: 'Clip saved',
    GameRecordingStart: 'Recording started',
    CloudSyncFailure: 'Cloud sync failed',
    CloudSyncConflict: 'Cloud sync conflict',
    LowBatteryNotification: 'Low battery',
    HardwareUpdateNotification: 'Hardware update',
    PlaytimeWarning: 'Playtime warning',
};

let last: string | null = null;

/** The ids a random preview picks from right now. */
export function previewIds(): string[] {
    return Object.keys(PREVIEWS);
}

/** Every preview with its name, for the settings panel's dropdown. */
export function previewOptions(): { id: string; label: string }[] {
    return Object.keys(LABELS)
        .filter((id) => id in PREVIEWS)
        .map((id) => ({ id, label: LABELS[id]! }));
}

/**
 * Show a test toast: `id` (one of `previewIds()`), or a random one; a random one is never an achievement when
 * `withAchievement` is false (the panel previews those per tier when the theme has an `achievements` block). Returns
 * the id shown, or null when nothing was (switched off: safety/features.ts `preview`, or no store).
 */
export async function preview(id?: string, withAchievement = true): Promise<string | null> {
    if (!isEnabled('preview')) return null;
    const store = Reflect.get(globalThis, 'NotificationStore') as TestStore | undefined;
    const pool = withAchievement ? previewIds() : previewIds().filter((n) => n !== 'Achievement');
    const pick = id && PREVIEWS[id] ? id : pickPreview(pool, last);
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

/** Nothing to patch: previews only call Steam's test methods (and `achievement`), on demand. */
export function createPreviewSurface(achievement: () => Promise<unknown>): Surface {
    return {
        id: 'preview',
        touches: ['NotificationStore.Test*'],
        install: () => {
            previewAchievement = achievement;
            return !!Reflect.get(globalThis, 'NotificationStore');
        },
        uninstall() {
            previewAchievement = null;
        },
    };
}
