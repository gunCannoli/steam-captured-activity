import { achievementIdOf, syntheticKind, type SteamNotification } from '../../kernel/notification.ts';
import type { Events } from '../../kernel/events.ts';
import { completesGame } from '../../theme/theme.ts';

/**
 * The unlock sensor (migration plan § 4.6, D4): turns "Steam showed a toast" into
 * one `achievement.unlocked` event per real (or test) unlock. It is the only
 * listener of the hook that emits; sound, captures and the 100% toast all
 * subscribe to its event instead of doing their own work inside Steam's call.
 *
 * Pure: everything it touches comes in through `deps`.
 */
export interface UnlockSensorDeps {
    isAchievementUnlock(n: SteamNotification): boolean;
    progressFor(appid: number): { unlocked?: unknown; total?: unknown; all_unlocked?: unknown } | undefined;
    emit(payload: Events['achievement.unlocked']): void;
    /** production: (fn) => setTimeout(fn, 0) */
    defer(fn: () => void): void;
    /** production: Date.now */
    now(): number;
}

export function createUnlockSensor(deps: UnlockSensorDeps): (n: SteamNotification) => void {
    /** Steam calls PlayNotificationSound once per toast shown, and sometimes more than once. */
    const seen = new WeakSet<object>();
    return (n) => {
        if (!deps.isAchievementUnlock(n)) return;
        const kind = syntheticKind(achievementIdOf(n));
        if (kind === 'preview' || kind === 'completion') return; // EA_TEST counts as a real unlock
        if (seen.has(n.data)) return;
        seen.add(n.data);
        // Read now: Steam refreshes its progress cache after the toast arrives.
        const atMs = deps.now();
        const completes = completesGame(deps.progressFor(n.data.appid()));
        deps.defer(() => deps.emit({ n, atMs, completesGame: completes }));
    };
}
