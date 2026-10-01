import type { Surface } from '../../kernel/surface';
import type { Category } from '../../theme/theme';
import { audio } from '../../theme/active-theme';
import { isEnabled, reportError } from '../../safety/runtime';

/**
 * Previews: Steam's own test toast for each category, from the settings panel
 * (injected as `onPreview`, never imported by it) and the live tests. Friend
 * and message toasts only appear if Steam's Friends notification settings
 * allow them (friend-online toasts are off by default), so those previews can
 * legitimately show nothing.
 */

type TestStore = Record<string, ((...args: unknown[]) => unknown) | undefined>;

const PREVIEWS: Record<Category, (store: TestStore, appid: number) => unknown> = {
    friends: (s) => s.TestFriendOnline?.(),
    messages: (s) => s.TestFriendMessage?.(),
    downloads: (s, appid) => s.TestDownloadComplete?.(appid),
    recording: (s) => s.TestGameRecordingInstantClip?.(),
    achievement: (s, appid) => s.TestAchievement?.(appid),
    system: (s, appid) => s.TestCloudSyncFailure?.(appid),
};

/** Switched off (safety/features.ts `preview`): does nothing. */
export async function previewCategory(category: Category): Promise<void> {
    if (!isEnabled('preview')) return;
    const store = Reflect.get(globalThis, 'NotificationStore') as TestStore | undefined;
    if (!store) return;
    try {
        const cache = Reflect.get(globalThis, 'appAchievementProgressCache') as { m_achievementProgress?: { mapCache?: Map<number, unknown> } } | undefined;
        const appid = cache?.m_achievementProgress?.mapCache?.keys().next().value ?? 480;
        void audio().resume(); // a click is a user gesture: unlock audio for the preview
        await PREVIEWS[category](store, appid);
    } catch (error) {
        reportError('preview', error);
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
