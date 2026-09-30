import type { Events } from '../../kernel/events.ts';

/**
 * The synthetic 100% toast rule (migration plan § 4.7): an unlock that completes
 * the game posts one completion toast 1.5 s later. `achievement.unlocked` fires
 * once per notification (the sensor), so the rule needs no dedupe of its own.
 * Gated by both `completion` and `toasts` in the caller. Pure.
 */
export const COMPLETION_DELAY_MS = 1500;

export function createCompletion(deps: {
    isEnabled(): boolean;
    post(appid: number): void;
    schedule(fn: () => void, ms: number): void;
}): (e: Events['achievement.unlocked']) => void {
    return (e) => {
        if (!e.completesGame || !deps.isEnabled()) return;
        const appid = e.n.data.appid(); // read now, not when the timer fires
        deps.schedule(() => deps.post(appid), COMPLETION_DELAY_MS);
    };
}
