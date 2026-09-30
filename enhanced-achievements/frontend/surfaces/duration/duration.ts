import type { AnimationPair } from '../../theme/theme.ts';
import { bannerTiming, themedDisplayMs } from '../../banner/timing.ts';

/**
 * The toast duration written into Steam's achievement type config (migration
 * plan § 4.7). With a theme, Steam's toast lasts the banner's whole lifetime
 * (entrance + display + exit), so where Steam times the toast itself (Big
 * Picture) the exit animation is never cut short; on desktop the banner holds
 * its popup anyway. Without a theme: Steam's own value. Pure.
 */
export function durationFor(theme: { animation: AnimationPair; displayTimeMs: number | null } | null, pristineMs: number | undefined): number | undefined {
    return theme ? bannerTiming(theme.animation, themedDisplayMs(theme.displayTimeMs, pristineMs)).totalMs : pristineMs;
}

/**
 * Switched off (safety/features.ts `duration`): writes nothing, so Steam's (or
 * enhanced-notifications') value stays; a value already written stays until
 * Steam restarts or the surface is uninstalled.
 */
export function applyDuration(deps: {
    isEnabled(): boolean;
    theme(): { animation: AnimationPair; displayTimeMs: number | null } | null;
    pristineMs: number | undefined;
    write(ms: number | undefined): void;
    reportError(err: unknown): void;
}): void {
    if (!deps.isEnabled()) return;
    try {
        deps.write(durationFor(deps.theme(), deps.pristineMs));
    } catch (error) {
        deps.reportError(error);
    }
}
