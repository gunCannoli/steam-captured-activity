import type { SoundHandler } from '../../steam/notification-hook.ts';

/**
 * The sound decision per toast type: the theme's clip, silence, or Steam's
 * chime. Pure: the audio context, the theme and the coexistence check come in
 * through `deps`.
 *
 * - Unknown type, `sound` switched off (kill switch or setting), or the type
 *   handed to enhanced-achievements: Steam's chime.
 * - The theme mutes the type (`false`): silence; Steam is still asked, so its
 *   own call runs as it would.
 * - The theme has a clip and audio is running: the clip, if Steam wants a sound
 *   at all (its mute setting). A suspended context is resumed and this toast
 *   gets Steam's chime, ours from the next one.
 * - The theme keeps Steam's sound (`null`, or a clip that did not load): Steam's chime.
 */
export interface Clip {
    buffer: AudioBuffer;
    volume: number;
}

export interface SoundDeps {
    isEnabled(): boolean;
    nameOf(eType: number): string | null;
    handles(eType: number): boolean;
    clipFor(name: string): Clip | false | null;
    audioState(): string;
    resumeAudio(): void;
    playClip(clip: Clip): void;
}

export function createSoundHandler(deps: SoundDeps): SoundHandler {
    return (call) => {
        const eType = call.n?.eType;
        const name = typeof eType === 'number' ? deps.nameOf(eType) : null;
        if (name === null || !deps.isEnabled() || !deps.handles(eType)) return call.playSteam();
        const clip = deps.clipFor(name);
        if (clip === false) {
            call.askSteam(); // muted: plays nothing
            return;
        }
        if (clip) {
            const state = deps.audioState();
            if (state === 'running') {
                if (call.askSteam()) deps.playClip(clip);
                return;
            }
            // Audio not unlocked yet: Steam's chime this time, ours from the next toast.
            if (state === 'suspended') deps.resumeAudio();
        }
        call.playSteam();
    };
}
