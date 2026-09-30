import type { Surface } from '../../kernel/surface';
import type { NotificationHook } from '../../steam/notification-hook';
import { isAchievementUnlock } from '../../steam/notification-store';
import { phaseOf, subscribe } from '../../banner/queue';
import { activeTheme, audio, tierFor } from '../../theme/active-theme';
import { isEnabled } from '../../safety/runtime';
import { createSoundHandler } from './sound';

/** The theme's clip instead of Steam's chime: owns the hook's one sound slot. */
export function createSoundSurface(hook: NotificationHook): Surface {
    return {
        id: 'sound',
        touches: ['NotificationStore.PlayNotificationSound#sound'],
        install() {
            hook.setSoundHandler(
                createSoundHandler({
                    isEnabled: () => isEnabled('sound'),
                    isAchievementUnlock,
                    clipFor: (n) => activeTheme()?.sounds.get(tierFor(n)),
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
                    phaseOf,
                    subscribe,
                }),
            );
            return true;
        },
        uninstall() {
            hook.setSoundHandler(null);
        },
    };
}
