import type { SoundCall, SoundHandler } from '../../steam/notification-hook.ts';
import type { SteamNotification } from '../../kernel/notification.ts';

/**
 * The sound decision (migration plan § 4.7): our theme's clip, or Steam's chime.
 * Pure: the audio context, the theme and the scheduler come in through `deps`.
 *
 * - Not an unlock, or `sound` switched off: Steam's chime at once, nothing deferred.
 * - A queued banner still waiting: silent until its turn (then this same decision),
 *   and never if it is dismissed first, so a burst is heard one at a time.
 * - Otherwise: the theme's clip if the audio context is running (Steam still decides
 *   whether any sound is wanted); a suspended context is resumed and this toast
 *   gets Steam's chime, ours from the next one.
 */
export interface SoundDeps {
    isEnabled(): boolean;
    isAchievementUnlock(n: SteamNotification): boolean;
    clipFor(n: SteamNotification): { buffer: AudioBuffer; volume: number } | undefined;
    audioState(): string;
    resumeAudio(): void;
    playClip(clip: { buffer: AudioBuffer; volume: number }): void;
    /** The banner scheduler's phase for this toast; undefined when no banner of ours was admitted for it. */
    peek(key: object): 'waiting' | 'showing' | 'done' | undefined;
    whenShowing(key: object, onShow: () => void): { at: 'now' | 'never' } | { at: 'later'; cancel(): void };
}

export function createSoundHandler(deps: SoundDeps): SoundHandler {
    /** Unlocks whose sound is already waiting for their banner's turn. */
    const deferred = new WeakSet<object>();

    function playNow(call: SoundCall): void {
        const clip = deps.clipFor(call.n);
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
        if (!deps.isAchievementUnlock(n) || !deps.isEnabled()) return call.playSteam();
        if (deps.peek(n.data) === 'waiting') {
            if (deferred.has(n.data)) return;
            deferred.add(n.data);
            // Silent until its turn, and never if it is dismissed first.
            deps.whenShowing(n.data, () => {
                try {
                    playNow(call);
                } catch {
                    call.playSteam(); // the queue swallows listener errors; this toast gets Steam's chime
                }
            });
            return;
        }
        playNow(call);
    };
}
