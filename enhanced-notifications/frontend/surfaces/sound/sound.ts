import type { SoundCall, SoundHandler } from '../../steam/notification-hook.ts';
import type { SteamNotification } from '../../kernel/notification.ts';

/**
 * The sound decision per toast: the theme's clip, silence, or Steam's chime. Pure: the audio context, the theme and
 * the banner scheduler come in through `deps`.
 *
 * - Unknown type, or `sound` switched off (kill switch or setting): Steam's chime.
 * - An achievement unlock whose banner is queued behind another: silent until its turn (then this same decision), and
 *   never if it is dismissed first, so a burst is heard one at a time.
 * - An achievement unlock whose tier has a sound (the theme's `achievements` block): that clip.
 * - Otherwise the theme's notification sound: `false` mutes (Steam is still asked, so its own call runs as it would);
 *   a clip plays if Steam wants a sound at all (its mute setting); none (or a clip that did not load) is Steam's chime.
 * - A clip with the audio context suspended: it is resumed and this toast gets Steam's chime, ours from the next one.
 */
export interface Clip {
    buffer: AudioBuffer;
    volume: number;
}

export interface SoundDeps {
    isEnabled(): boolean;
    nameOf(eType: number): string | null;
    /** The theme's notification sound for this type. */
    clipFor(name: string): Clip | false | null;
    isAchievementUnlock(n: SteamNotification): boolean;
    /** The unlock's tier sound; undefined when its tier has none or the theme has no `achievements` block. */
    tierClipFor(n: SteamNotification): Clip | undefined;
    audioState(): string;
    resumeAudio(): void;
    playClip(clip: Clip): void;
    /** The banner scheduler's phase for this toast; undefined when no banner was admitted for it. */
    peek(key: object): 'waiting' | 'showing' | 'done' | undefined;
    whenShowing(key: object, onShow: () => void): { at: 'now' | 'never' } | { at: 'later'; cancel(): void };
}

export function createSoundHandler(deps: SoundDeps): SoundHandler {
    /** Unlocks whose sound is already waiting for their banner's turn. */
    const deferred = new WeakSet<object>();

    function playNow(call: SoundCall, name: string, unlock: boolean): void {
        const clip = (unlock ? deps.tierClipFor(call.n) : undefined) ?? deps.clipFor(name);
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
    }

    return (call) => {
        const n = call.n;
        const eType = n?.eType;
        const name = typeof eType === 'number' ? deps.nameOf(eType) : null;
        if (name === null || !deps.isEnabled()) return call.playSteam();
        const unlock = deps.isAchievementUnlock(n);
        if (unlock && deps.peek(n.data) === 'waiting') {
            if (deferred.has(n.data)) return;
            deferred.add(n.data);
            // Silent until its turn, and never if it is dismissed first.
            deps.whenShowing(n.data, () => {
                try {
                    playNow(call, name, true);
                } catch {
                    call.playSteam(); // the queue swallows listener errors; this toast gets Steam's chime
                }
            });
            return;
        }
        playNow(call, name, unlock);
    };
}
