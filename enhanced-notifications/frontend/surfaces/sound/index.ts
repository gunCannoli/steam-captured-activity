import type { Surface } from '../../kernel/surface';
import type { NotificationHook } from '../../steam/notification-hook';
import { typeName } from '../../steam/notification-store';
import { handles } from '../../steam/coexistence';
import { setting } from '../../settings/settings';
import { audio, soundFor } from '../../theme/active-theme';
import { isEnabled } from '../../safety/runtime';
import { createSoundHandler } from './sound';

/** The theme's sound per type instead of Steam's chime: owns the hook's one sound slot. */
export function createSoundSurface(hook: NotificationHook): Surface {
    return {
        id: 'sound',
        touches: ['NotificationStore.PlayNotificationSound#sound'],
        install() {
            hook.setSoundHandler(
                createSoundHandler({
                    isEnabled: () => isEnabled('sound') && setting('sound.enabled'),
                    nameOf: typeName,
                    handles: (eType) => handles(eType, 'sound'),
                    clipFor: soundFor,
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
                }),
            );
            return true;
        },
        uninstall() {
            hook.setSoundHandler(null);
        },
    };
}
