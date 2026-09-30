import type { Animation, AnimationPair } from '../theme/theme';

/**
 * Banner timing: one source for the entrance/exit lengths the CSS animates
 * and the lifetime the scheduler (queue.ts) holds the toast for.
 *
 * Pure: no Steam or SDK imports (tests/queue.test.ts).
 *
 * The banner owns its whole visible lifetime: entrance, then `displayMs`
 * fully shown, then exit. Steam keeps the popup open until we report done
 * (themed-toast.tsx, `fnNotificationResolved`), so an entrance or exit longer
 * than Steam's own 300 ms fades is never cut off.
 */

/** [entrance, exit] ms. ps5's direction comes from the position class; its length does not. */
const ANIMATION_MS: Record<Animation, [number, number]> = {
    fade: [400, 300],
    slide: [350, 300],
    up: [350, 300],
    down: [350, 300],
    ps5: [450, 400],
    none: [0, 0],
};

/** Covers timer and first-frame jitter so the exit always finishes before we report done. */
const SETTLE_MS = 100;

export interface BannerTiming {
    inMs: number;
    displayMs: number;
    outMs: number;
    /** Entrance + display + exit + settle: how long the scheduler keeps this toast "showing". */
    totalMs: number;
}

/** How long a themed banner is fully visible: the theme's `display_time_ms`, else Steam's own duration, else 5 s. */
export function themedDisplayMs(displayTimeMs: number | null | undefined, steamDurationMs: number | undefined): number {
    return displayTimeMs ?? (steamDurationMs || 5000); // Steam: `toastDurationMS || 5e3`
}

export function bannerTiming(animation: AnimationPair, displayMs: number): BannerTiming {
    const inMs = ANIMATION_MS[animation.in][0];
    const outMs = ANIMATION_MS[animation.out][1];
    const shown = Math.max(0, displayMs);
    return { inMs, displayMs: shown, outMs, totalMs: inMs + shown + outMs + SETTLE_MS };
}
