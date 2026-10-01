import type { Surface } from '../../kernel/surface';
import type { NotificationHook } from '../../steam/notification-hook';
import { isAchievementUnlock, typeName } from '../../steam/notification-store';
import { setting } from '../../settings/settings';
import { peek, whenShowing } from '../../banner/queue';
import { achievementTheme, audio, themeSound, tierFor } from '../../theme/active-theme';
import { isEnabled } from '../../safety/runtime';
import { createSoundHandler } from './sound';

/** The theme's sounds instead of Steam's chime (a tier's for an achievement unlock): owns the hook's one sound slot. */
export function createSoundSurface(hook: NotificationHook): Surface {
    return {
        id: 'sound',
        touches: ['NotificationStore.PlayNotificationSound#sound'],
        install() {
            hook.setSoundHandler(
                createSoundHandler({
                    isEnabled: () => isEnabled('sound') && setting('sound.enabled'),
                    nameOf: typeName,
                    clipFor: themeSound,
                    isAchievementUnlock,
                    tierClipFor: (n) => achievementTheme()?.sounds.get(tierFor(n)),
                    audioState: () => audio().state,
                    resumeAudio: () => void audio().resume(),
                    playClip(clip) {
                        const ctx = audio();
                        const source = ctx.createBufferSource();
                        const gain = ctx.createGain();
                        gain.gain.value = clip.volume;
                        source.buffer = clip.buffer;
                        source.connect(gain).connect(ctx.destination);
                        source.start();
                    },
                    peek,
                    whenShowing,
                }),
            );
            return true;
        },
        uninstall() {
            hook.setSoundHandler(null);
        },
    };
}
